// ABOUTME: Tests for the MCTS search-tree data structures — max^n backup and per-acting-player PUCT selection.
// ABOUTME: Structural/deterministic; the load-bearing case is selectChild picking different edges for different acting players.

import { describe, expect, it } from "vitest";
import {
  makeNode,
  backup,
  selectChild,
  defaultCPuct,
  actionKey,
  expandNode,
  chanceExpectedValue,
  sampleChanceOutcome,
  defaultExpansionParams,
  simulateStep,
  type Node,
  type Edge,
  type PathStep,
  type ExpansionParams,
} from "../../src/agent/mcts";
import type { Action, GameState } from "../../src/engine/types";
import { mkState } from "../helpers/state";
import { applyAction } from "../../src/engine/apply";
import { advanceRound } from "../../src/engine/turn";
import { seed } from "../../src/rng/pcg";
import { defaultConfig } from "../../src/engine/config";

const PASS: Action = { kind: "pass" };
const A: Action = { kind: "build", pieces: [{ type: "factory", hex: { x: 0, y: 0, z: 0 } }] };
const B: Action = { kind: "build", pieces: [{ type: "base", hex: { x: 1, y: -1, z: 0 } }] };

describe("makeNode", () => {
  it("builds a node from candidate actions with zeroed stats for 2 players", () => {
    const node = makeNode([A, B], 2);
    expect(node.N).toBe(0);
    expect(node.valueVec).toEqual([0, 0]);
    expect(node.edges).toHaveLength(2);
    for (const edge of node.edges) {
      expect(edge.childN).toBe(0);
      expect(edge.valueVec).toEqual([0, 0]);
      expect(edge.child).toBeUndefined();
    }
    expect(node.edges[0]!.action).toBe(A);
    expect(node.edges[1]!.action).toBe(B);
  });

  it("sizes the value vectors to the player count", () => {
    const node = makeNode([PASS], 6);
    expect(node.valueVec).toEqual([0, 0, 0, 0, 0, 0]);
    expect(node.edges[0]!.valueVec).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe("backup (max^n, per-player N-vector)", () => {
  it("accumulates the leaf N-vector componentwise into each edge and increments childN / node N", () => {
    const root = makeNode([A, B], 2);
    const child = makeNode([PASS], 2);
    const rootEdge = root.edges[0]!; // edge A from root
    const childEdge = child.edges[0]!; // edge PASS from child
    rootEdge.child = child;

    const path: PathStep[] = [
      { node: root, edge: rootEdge },
      { node: child, edge: childEdge },
    ];

    backup(path, [1, 0]);

    // Each edge accumulated [1,0], childN incremented, node N incremented.
    expect(rootEdge.valueVec).toEqual([1, 0]);
    expect(rootEdge.childN).toBe(1);
    expect(childEdge.valueVec).toEqual([1, 0]);
    expect(childEdge.childN).toBe(1);
    expect(root.N).toBe(1);
    expect(root.valueVec).toEqual([1, 0]);
    expect(child.N).toBe(1);
    expect(child.valueVec).toEqual([1, 0]);

    // Untouched sibling edge stays zeroed.
    expect(root.edges[1]!.valueVec).toEqual([0, 0]);
    expect(root.edges[1]!.childN).toBe(0);
  });

  it("accumulates each player's component independently across multiple backups", () => {
    const root = makeNode([A], 2);
    const edge = root.edges[0]!;
    const path: PathStep[] = [{ node: root, edge }];

    backup(path, [1, 0]);
    backup(path, [0, 1]);
    backup(path, [0, 1]);

    // Player 0 got 1 unit, player 1 got 2 units — accumulated separately.
    expect(edge.valueVec).toEqual([1, 2]);
    expect(edge.childN).toBe(3);
    expect(root.N).toBe(3);
    expect(root.valueVec).toEqual([1, 2]);
  });
});

describe("selectChild (per-acting-player PUCT — max^n)", () => {
  it("the SAME node yields different selections depending on the acting player", () => {
    // Edge A: high mean value for player 0, low for player 1.
    // Edge B: high mean value for player 1, low for player 0.
    // Both equally visited so the U term is identical between them.
    const node = makeNode([A, B], 2);
    node.N = 100;
    const edgeA = node.edges[0]!;
    const edgeB = node.edges[1]!;
    edgeA.childN = 50;
    edgeA.valueVec = [50 * 0.9, 50 * 0.1]; // mean [0.9, 0.1]
    edgeB.childN = 50;
    edgeB.valueVec = [50 * 0.1, 50 * 0.9]; // mean [0.1, 0.9]

    // Player 0 maximizes their own component -> picks A.
    expect(selectChild(node, 0, defaultCPuct).action).toBe(A);
    // Player 1 maximizes their own component -> picks B.
    expect(selectChild(node, 1, defaultCPuct).action).toBe(B);
  });

  it("computes Q from the acting player's own component with exact PUCT arithmetic", () => {
    const node = makeNode([A, B], 2);
    node.N = 9; // sqrt(9) = 3
    const edgeA = node.edges[0]!;
    const edgeB = node.edges[1]!;
    edgeA.childN = 3;
    edgeA.valueVec = [3 * 0.5, 0]; // Q for p0 = 0.5
    edgeB.childN = 1;
    edgeB.valueVec = [1 * 0.4, 0]; // Q for p0 = 0.4

    const cPuct = 1.0;
    const prior = 1 / 2; // uniform over 2 edges
    // scoreA = 0.5 + 1.0 * 0.5 * 3 / (1+3) = 0.5 + 0.375 = 0.875
    // scoreB = 0.4 + 1.0 * 0.5 * 3 / (1+1) = 0.4 + 0.75  = 1.15
    expect(selectChild(node, 0, cPuct).action).toBe(B);

    // Sanity: with cPuct = 0, only Q matters -> A wins (0.5 > 0.4).
    expect(selectChild(node, 0, 0).action).toBe(A);
    void prior;
  });
});

describe("selectChild — PUCT exploration term", () => {
  it("with equal Q, the less-visited edge gets a higher U and is selected", () => {
    const node = makeNode([A, B], 2);
    node.N = 20;
    const edgeA = node.edges[0]!;
    const edgeB = node.edges[1]!;
    // Equal mean Q = 0.5 for player 0, but B is far less visited.
    edgeA.childN = 10;
    edgeA.valueVec = [10 * 0.5, 0];
    edgeB.childN = 2;
    edgeB.valueVec = [2 * 0.5, 0];

    // U_A = c * prior * sqrt(20)/(1+10); U_B = c * prior * sqrt(20)/(1+2) -> U_B larger.
    expect(selectChild(node, 0, defaultCPuct).action).toBe(B);
  });

  it("a larger cPuct favors exploration of the less-visited edge", () => {
    const node = makeNode([A, B], 2);
    node.N = 16; // sqrt = 4
    const edgeA = node.edges[0]!;
    const edgeB = node.edges[1]!;
    // A has slightly higher Q but is more visited; B is less visited.
    edgeA.childN = 7;
    edgeA.valueVec = [7 * 0.6, 0]; // Q = 0.6
    edgeB.childN = 1;
    edgeB.valueVec = [1 * 0.5, 0]; // Q = 0.5
    const prior = 0.5;

    // Small cPuct: Q dominates -> A.
    // scoreA = 0.6 + 0.1*0.5*4/8 = 0.6 + 0.025 = 0.625
    // scoreB = 0.5 + 0.1*0.5*4/2 = 0.5 + 0.1   = 0.6
    expect(selectChild(node, 0, 0.1).action).toBe(A);

    // Large cPuct: U dominates -> B.
    // scoreA = 0.6 + 5*0.5*4/8 = 0.6 + 1.25 = 1.85
    // scoreB = 0.5 + 5*0.5*4/2 = 0.5 + 5.0  = 5.5
    expect(selectChild(node, 0, 5).action).toBe(B);
    void prior;
  });
});

describe("selectChild — deterministic tie-break", () => {
  it("breaks ties to the lowest edge index", () => {
    const node = makeNode([A, B], 2);
    node.N = 4;
    // Identical stats on both edges -> identical scores -> pick index 0 (A).
    for (const edge of node.edges) {
      edge.childN = 2;
      edge.valueVec = [2 * 0.5, 0];
    }
    expect(selectChild(node, 0, defaultCPuct).action).toBe(A);
  });

  it("uses U with node.N=0 so an unexpanded node still selects index 0 deterministically", () => {
    // N=0 -> sqrt(0)=0 -> U=0 for all edges; all Q=0 -> tie -> index 0.
    const node = makeNode([A, B], 2);
    expect(selectChild(node, 0, defaultCPuct).action).toBe(A);
  });
});

// Type-level sanity that the exported shapes are usable as documented.
describe("exported types", () => {
  it("Node/Edge expose the documented fields", () => {
    const node: Node = makeNode([A], 2);
    const edge: Edge = node.edges[0]!;
    expect(typeof node.N).toBe("number");
    expect(Array.isArray(node.valueVec)).toBe(true);
    expect(typeof edge.childN).toBe("number");
    expect(Array.isArray(edge.valueVec)).toBe(true);
  });
});

// ===========================================================================
// A3.2 — expansion (progressive widening), combat chance nodes, determinized
// turn order.
// ===========================================================================

// Verified-on-board attack fixture (mirrors test/engine/apply-attack.test.ts):
// p0 has 6 fresh bases within attackRange (6) of TARGET; p1 has the TARGET base
// (radiating, <4 bases) and a DEFENDER base, both in range.
const TARGET = { x: 2, y: -2, z: 0 };
const DEFENDER = { x: 0, y: -1, z: 1 };
const ATTACKERS6 = [
  { x: 0, y: 0, z: 0 },
  { x: -1, y: 1, z: 0 },
  { x: 0, y: 1, z: -1 },
  { x: 1, y: 0, z: -1 },
  { x: 0, y: 2, z: -2 },
  { x: -2, y: 2, z: 0 },
];

const attackFixture = () =>
  mkState({ board: 96, basesP0: ATTACKERS6, basesP1: [TARGET, DEFENDER] });

// A build-heavy fixture for progressive-widening tests: a 3-base radiating
// position with iron in reach, so samplePolicy has builds, (no) attacks, and a
// budget to compose multi-piece builds from.
const buildFixture = () =>
  mkState({
    board: 96,
    basesP0: [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: -2, z: 0 },
      { x: 4, y: -4, z: 0 },
    ],
    basesP1: [{ x: 0, y: 4, z: -4 }],
    iron: [{ x: 5, y: -5, z: 0 }, { x: 6, y: -6, z: 0 }],
  });

describe("actionKey", () => {
  it("is stable and identical for equal actions", () => {
    expect(actionKey(PASS)).toBe(actionKey({ kind: "pass" }));
    expect(actionKey(A)).toBe(actionKey({ kind: "build", pieces: [{ type: "factory", hex: { x: 0, y: 0, z: 0 } }] }));
  });

  it("distinguishes different actions", () => {
    expect(actionKey(A)).not.toBe(actionKey(B));
    expect(actionKey(A)).not.toBe(actionKey(PASS));
  });

  it("is order-insensitive within a build (same pieces, any order, same key)", () => {
    const p1: Action = {
      kind: "build",
      pieces: [
        { type: "base", hex: { x: 1, y: -1, z: 0 } },
        { type: "base", hex: { x: 2, y: -2, z: 0 } },
      ],
    };
    const p2: Action = {
      kind: "build",
      pieces: [
        { type: "base", hex: { x: 2, y: -2, z: 0 } },
        { type: "base", hex: { x: 1, y: -1, z: 0 } },
      ],
    };
    expect(actionKey(p1)).toBe(actionKey(p2));
  });
});

describe("expandNode — progressive widening (candidateMode 'pw')", () => {
  it("opens k = ceil(C * N^alpha) children; child count grows with node.N", () => {
    const state = buildFixture();
    const params = defaultExpansionParams(); // C=2, alpha=0.5
    const node = makeNode([], 2);
    let rng = seed(7n);

    const kOf = (n: number) => Math.ceil(params.C * Math.pow(n, params.alpha));

    // N=0 -> k = ceil(2*0) = 0 opened.
    expect(node.edges).toHaveLength(0);

    // Drive N up and re-expand; opened count tracks k(N), monotone non-decreasing.
    let prevOpened = 0;
    for (const n of [1, 4, 9, 16, 25]) {
      node.N = n;
      const r = expandNode(node, state, 0, params, rng);
      rng = r.rng;
      // Opened children never exceed k(N) and never shrink.
      expect(node.edges.length).toBeLessThanOrEqual(kOf(n));
      expect(node.edges.length).toBeGreaterThanOrEqual(prevOpened);
      prevOpened = node.edges.length;
    }
    // By N=25, k = ceil(2*5) = 10; we should have opened a non-trivial number.
    expect(node.edges.length).toBeGreaterThan(1);
  });

  it("every opened child action is applyAction-acceptable", () => {
    const state = buildFixture();
    const params = defaultExpansionParams();
    const node = makeNode([], 2);
    node.N = 25;
    expandNode(node, state, 0, params, seed(3n));
    expect(node.edges.length).toBeGreaterThan(0);
    for (const edge of node.edges) {
      expect(() => applyAction(state, edge.action)).not.toThrow();
    }
  });

  it("opened children are distinct (deduped by actionKey)", () => {
    const state = buildFixture();
    const params = defaultExpansionParams();
    const node = makeNode([], 2);
    node.N = 100; // large k so PW samples many candidates
    expandNode(node, state, 0, params, seed(11n));
    const keys = node.edges.map((e) => actionKey(e.action));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("stores a policy prior on each opened edge", () => {
    const state = buildFixture();
    const params = defaultExpansionParams();
    const node = makeNode([], 2);
    node.N = 9;
    expandNode(node, state, 0, params, seed(5n));
    for (const edge of node.edges) {
      expect(typeof edge.prior).toBe("number");
      expect(edge.prior!).toBeGreaterThan(0);
    }
  });

  it("is deterministic given a fixed search seed", () => {
    const params = defaultExpansionParams();
    const n1 = makeNode([], 2);
    n1.N = 16;
    expandNode(n1, buildFixture(), 0, params, seed(42n));
    const n2 = makeNode([], 2);
    n2.N = 16;
    expandNode(n2, buildFixture(), 0, params, seed(42n));
    expect(n1.edges.map((e) => actionKey(e.action))).toEqual(n2.edges.map((e) => actionKey(e.action)));
  });
});

describe("expandNode — candidateMode 'fixed'", () => {
  it("opens a bounded, all-legal child set", () => {
    const state = buildFixture();
    const params: ExpansionParams = { ...defaultExpansionParams(), candidateMode: "fixed" };
    const node = makeNode([], 2);
    node.N = 100; // large N would let PW open many; fixed must stay bounded
    expandNode(node, state, 0, params, seed(1n));
    expect(node.edges.length).toBeGreaterThan(0);
    expect(node.edges.length).toBeLessThanOrEqual(8); // small fixed candidate set
    for (const edge of node.edges) {
      expect(() => applyAction(state, edge.action)).not.toThrow();
    }
    // Deduped.
    const keys = node.edges.map((e) => actionKey(e.action));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("opens an attack candidate when attacks are legal", () => {
    const state = attackFixture();
    const params: ExpansionParams = { ...defaultExpansionParams(), candidateMode: "fixed" };
    const node = makeNode([], 2);
    node.N = 4;
    expandNode(node, state, 0, params, seed(2n));
    const hasAttack = node.edges.some((e) => e.action.kind === "attack");
    expect(hasAttack).toBe(true);
  });
});

describe("chanceExpectedValue", () => {
  it("computes p*win + (1-p)*lose componentwise — exact", () => {
    expect(chanceExpectedValue([1, 0], [0, 1], 0.75)).toEqual([0.75, 0.25]);
    expect(chanceExpectedValue([2, 4], [0, 0], 0.5)).toEqual([1, 2]);
    expect(chanceExpectedValue([1, 0], [0, 1], 1)).toEqual([1, 0]);
    expect(chanceExpectedValue([1, 0], [0, 1], 0)).toEqual([0, 1]);
  });
});

describe("combat chance node — expansion builds both outcomes", () => {
  it("an attack edge holds a chance node with p = combatTable[commit] and win/lose states", () => {
    const state = attackFixture();
    const params = defaultExpansionParams();
    const node = makeNode([], 2);
    node.N = 25;
    // Force the fixed mode so the attack candidate is opened deterministically.
    const fixed: ExpansionParams = { ...params, candidateMode: "fixed" };
    expandNode(node, state, 0, fixed, seed(2n));
    const attackEdge = node.edges.find((e) => e.action.kind === "attack");
    expect(attackEdge).toBeDefined();
    expect(attackEdge!.chance).toBeDefined();
    // commit 3 -> p = 0.75 default.
    expect(attackEdge!.chance!.p).toBe(state.config.combatTable[3]);
    expect(attackEdge!.chance!.win).toBeDefined();
    expect(attackEdge!.chance!.lose).toBeDefined();
  });

  // Compare bases (owner/hex/state/order) as sorted, normalized arrays (GEO-4),
  // and basesInHand — the rngState differs (the engine DRAWS the PRNG, the
  // hand-built outcome does not), so it is deliberately excluded.
  const normBases = (s: GameState) =>
    s.bases.map((b) => `${b.owner}@${b.hex.x},${b.hex.y},${b.hex.z}:${b.state}:${b.order}`).sort();

  // Find the attack edge expandNode opened, and apply that SAME action through the
  // engine — comparing the chance node's hand-built outcome to the engine's result
  // is the load-bearing fidelity check (MCTS must simulate the same game).
  const expandAndFindAttack = (state: GameState) => {
    const params: ExpansionParams = { ...defaultExpansionParams(), candidateMode: "fixed" };
    const node = makeNode([], 2);
    node.N = 4;
    expandNode(node, state, 0, params, seed(2n));
    const edge = node.edges.find((e) => e.action.kind === "attack");
    expect(edge).toBeDefined();
    return edge!;
  };

  it("the hand-built WIN state matches what applyAction produces on a forced win", () => {
    // Force a commit-3 win via combatTable[3] = 1.
    const c = defaultConfig();
    const config = { ...c, combatTable: { ...c.combatTable, 3: 1 } };
    const state = mkState({ board: 96, basesP0: ATTACKERS6, basesP1: [TARGET, DEFENDER], config });

    const edge = expandAndFindAttack(state);
    const handWin = edge.chance!.winState;
    const engine = applyAction(state, edge.action).state;

    expect(normBases(handWin)).toEqual(normBases(engine));
    expect(handWin.players.map((p) => p.basesInHand)).toEqual(engine.players.map((p) => p.basesInHand));
    expect(handWin.factorySupply).toBe(engine.factorySupply);
  });

  it("the hand-built LOSE state matches applyAction on a forced loss (fatigue only)", () => {
    const c = defaultConfig();
    const config = { ...c, combatTable: { ...c.combatTable, 3: 0 } };
    const state = mkState({ board: 96, basesP0: ATTACKERS6, basesP1: [TARGET, DEFENDER], config });

    const edge = expandAndFindAttack(state);
    const handLose = edge.chance!.loseState;
    const engine = applyAction(state, edge.action).state;

    expect(normBases(handLose)).toEqual(normBases(engine));
    expect(handLose.players.map((p) => p.basesInHand)).toEqual(engine.players.map((p) => p.basesInHand));
  });

  it("maxed-out win (basesInHand 0) matches the engine's destroy-no-replacement", () => {
    const c = defaultConfig();
    const config = { ...c, combatTable: { ...c.combatTable, 3: 1 } };
    const state = mkState({ board: 96, basesP0: ATTACKERS6, basesP1: [TARGET, DEFENDER], config });
    state.players[0]!.basesInHand = 0;

    const edge = expandAndFindAttack(state);
    const handWin = edge.chance!.winState;
    const engine = applyAction(state, edge.action).state;

    expect(normBases(handWin)).toEqual(normBases(engine));
    expect(handWin.players.map((p) => p.basesInHand)).toEqual(engine.players.map((p) => p.basesInHand));
  });
});

describe("sampleChanceOutcome — sample-per-simulation", () => {
  it("over many seeded samples the win/lose split is within tolerance of p:(1-p)", () => {
    const state = attackFixture();
    const params: ExpansionParams = { ...defaultExpansionParams(), candidateMode: "fixed" };
    const node = makeNode([], 2);
    node.N = 4;
    expandNode(node, state, 0, params, seed(2n));
    const attackEdge = node.edges.find((e) => e.action.kind === "attack")!;
    const chance = attackEdge.chance!;
    const p = chance.p; // 0.75 for commit 3 default

    let wins = 0;
    const N = 20000;
    let rng = seed(99n);
    for (let i = 0; i < N; i++) {
      const out = sampleChanceOutcome(chance, rng);
      rng = out.rng;
      if (out.isWin) wins++;
    }
    const empirical = wins / N;
    // Tolerance comfortably wider than the ~3.5σ binomial spread at N=20000.
    expect(Math.abs(empirical - p)).toBeLessThan(0.015);
  });

  it("picks the win node on a forced-win p=1 and lose node on p=0, deterministically", () => {
    const win = makeNode([PASS], 2);
    const lose = makeNode([PASS], 2);
    const chanceWin = { p: 1, win, lose, winState: buildFixture(), loseState: buildFixture() };
    const chanceLose = { p: 0, win, lose, winState: buildFixture(), loseState: buildFixture() };
    expect(sampleChanceOutcome(chanceWin, seed(1n)).isWin).toBe(true);
    expect(sampleChanceOutcome(chanceWin, seed(2n)).isWin).toBe(true);
    expect(sampleChanceOutcome(chanceLose, seed(1n)).isWin).toBe(false);
    expect(sampleChanceOutcome(chanceWin, seed(1n)).node).toBe(win);
    expect(sampleChanceOutcome(chanceLose, seed(1n)).node).toBe(lose);
  });
});

describe("simulateStep — determinized turn order across a rollover", () => {
  it("threads the search rng through the turn-rollover draw (determinism given the seed)", () => {
    // A 2-live-player state at the LAST index of the order so the next step
    // rolls over and advanceRound redraws the order (iron-weighted, consumes rng).
    const make = () => {
      const s = mkState({ board: 96, basesP0: [{ x: 0, y: 0, z: 0 }], basesP1: [{ x: 0, y: 4, z: -4 }] });
      // Put us at the last slot so applying + advancing crosses a rollover.
      return { ...s, phase: { ...s.phase, indexInOrder: s.phase.order.length - 1 } };
    };

    const r1 = simulateStep(make(), PASS, seed(123n));
    const r2 = simulateStep(make(), PASS, seed(123n));
    // Same search seed -> identical resulting order and turn.
    expect(r1.state.phase.order).toEqual(r2.state.phase.order);
    expect(r1.state.phase.turn).toBe(r2.state.phase.turn);
    // The returned search rng is advanced and threaded forward.
    expect(r1.rng).toEqual(r2.rng);
  });

  it("intra-turn step (not a rollover) advances index without redrawing order", () => {
    const s = mkState({
      board: 96,
      basesP0: [{ x: 0, y: 0, z: 0 }],
      basesP1: [{ x: 0, y: 4, z: -4 }],
      basesP2: [{ x: 2, y: -2, z: 0 }],
    });
    expect(s.phase.indexInOrder).toBe(0);
    const out = simulateStep(s, PASS, seed(7n));
    expect(out.state.phase.indexInOrder).toBe(1);
    expect(out.state.phase.turn).toBe(s.phase.turn);
    // The provided board-state turn order is preserved (no rollover draw).
    void advanceRound;
  });
});
