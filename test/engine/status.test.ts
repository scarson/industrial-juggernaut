// ABOUTME: Tests for status.ts — coalitions, coalition iron (union dedup), victory check, elimination causes & bounty.
// ABOUTME: Structural assertions only; on-board fixtures via mkState (iron unioned onto the board so control() resolves it).

import { describe, it, expect } from "vitest";
import { hex, key } from "../../src/geometry/cube";
import { mkState } from "../helpers/state";
import { coalitions, coalitionIron, status, applyEliminations } from "../../src/engine/status";
import { defaultConfig } from "../../src/engine/config";
import type { GameState } from "../../src/engine/types";

// 10 distinct iron hexes all within cube-distance 5 of the origin (radiating disk).
const TEN_IRON = [
  hex(1, -1, 0),
  hex(2, -2, 0),
  hex(3, -3, 0),
  hex(4, -4, 0),
  hex(5, -5, 0),
  hex(0, 1, -1),
  hex(0, 2, -2),
  hex(0, 3, -3),
  hex(0, 4, -4),
  hex(0, 5, -5),
];

function withAlliance(s: GameState, a: number, b: number): GameState {
  // Mutual alliance between players a and b (alliance includes self by convention).
  const players = s.players.map((p) => {
    if (p.id === a) return { ...p, alliance: [a, b] };
    if (p.id === b) return { ...p, alliance: [b, a] };
    return p;
  });
  return { ...s, players };
}

describe("coalitions", () => {
  it("two solo players form two singletons", () => {
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(8, -8, 0)] });
    const cs = coalitions(s).map((c) => [...c].sort((x, y) => x - y));
    expect(cs).toContainEqual([0]);
    expect(cs).toContainEqual([1]);
    expect(cs.length).toBe(2);
  });

  it("two players with mutual alliance form one coalition of both", () => {
    let s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(8, -8, 0)] });
    s = withAlliance(s, 0, 1);
    const cs = coalitions(s);
    expect(cs.length).toBe(1);
    expect([...cs[0]!].sort((x, y) => x - y)).toEqual([0, 1]);
  });

  it("excludes eliminated players", () => {
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(8, -8, 0)] });
    s.players[1]!.eliminated = true;
    const cs = coalitions(s);
    expect(cs).toEqual([[0]]);
  });
});

describe("coalitionIron", () => {
  it("unions distinct iron across members (sum of distinct hexes)", () => {
    // p0 controls iron near origin, p1 controls iron near its base; distinct hexes.
    const s = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      basesP1: [hex(20, -20, 0)],
      iron: [hex(1, -1, 0), hex(2, -2, 0), hex(20, -19, -1)],
    });
    // p0 controls the two near origin; p1 controls the one near (20,-20,0).
    expect(coalitionIron(s, [0, 1])).toBe(3);
  });

  it("dedups a shared iron hex controlled by two allied radiating players", () => {
    // Shared iron (4,-4,0) is within radius 5 of both bases; counted once.
    const s = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      basesP1: [hex(8, -8, 0)],
      iron: [hex(4, -4, 0)],
    });
    expect(coalitionIron(s, [0, 1])).toBe(1);
  });
});

describe("status", () => {
  it("iron victory: a player controlling >=10 iron wins, reason iron", () => {
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(30, -30, 0)], iron: TEN_IRON });
    const r = status(s);
    expect(r.kind).toBe("victory");
    if (r.kind === "victory") {
      expect(r.reason).toBe("iron");
      expect(r.players).toEqual([0]);
    }
  });

  it("last-standing: one of two players eliminated => survivor wins, reason last-standing", () => {
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(8, -8, 0)], iron: [hex(4, -4, 0)] });
    s.players[1]!.eliminated = true;
    const r = status(s);
    expect(r.kind).toBe("victory");
    if (r.kind === "victory") {
      expect(r.reason).toBe("last-standing");
      expect(r.players).toEqual([0]);
    }
  });

  it("ongoing: two live players, neither at threshold", () => {
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(8, -8, 0)], iron: [hex(4, -4, 0)] });
    expect(status(s).kind).toBe("ongoing");
  });

  it("iron is checked before last-standing (precedence)", () => {
    // Lone survivor who ALSO has >=10 iron => reason iron, not last-standing.
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(30, -30, 0)], iron: TEN_IRON });
    s.players[1]!.eliminated = true;
    const r = status(s);
    expect(r.kind).toBe("victory");
    if (r.kind === "victory") expect(r.reason).toBe("iron");
  });

  it("coalition iron victory: two allies union to >=10 iron together", () => {
    // 5 iron near p0, 5 near p1; neither alone hits 10, together they do.
    const ironP0 = TEN_IRON.slice(0, 5);
    const ironP1 = [
      hex(40, -40, 0),
      hex(41, -41, 0),
      hex(42, -42, 0),
      hex(43, -43, 0),
      hex(44, -44, 0),
    ];
    let s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(40, -40, 0)], iron: [...ironP0, ...ironP1] });
    s = withAlliance(s, 0, 1);
    const r = status(s);
    expect(r.kind).toBe("victory");
    if (r.kind === "victory") {
      expect(r.reason).toBe("iron");
      expect([...r.players].sort((a, b) => a - b)).toEqual([0, 1]);
    }
  });
});

describe("DER #17 victory exclusivity", () => {
  it("radiating blanketer wins no false iron victory; perimetered owner wins instead (DER #17)", () => {
    const ironHex = hex(0, 0, 0);
    const p1Bases = [hex(2, -2, 0), hex(-2, 2, 0), hex(2, 0, -2), hex(-2, 0, 2)]; // hull encloses origin
    const p0Base = hex(5, 0, -5); // radiating, dist 5 to origin (<= radius 5), outside p1's hull
    const s = mkState({
      board: 96,
      basesP0: [p0Base],
      basesP1: p1Bases,
      iron: [ironHex],
      config: { ...defaultConfig(), victoryThreshold: 1 },
    });
    // Counterfactual (pre-fix): p0's raw disk covers the iron, so coalitionIron(p0) would be 1 >= 1,
    // tying p1 and winning the iron victory on the lowest-id tiebreak — a FALSE victory.
    // Post-fix: the iron sits inside non-ally p1's perimeter, so p0 commands 0 of it.
    expect(coalitionIron(s, [0])).toBe(0);
    expect(coalitionIron(s, [1])).toBe(1);
    const st = status(s);
    expect(st.kind).toBe("victory");
    expect(st.kind === "victory" && st.reason).toBe("iron");
    expect(st.kind === "victory" && st.players).toEqual([1]); // perimetered owner, not radiating p0
  });
});

describe("applyEliminations", () => {
  it("noBases: player with 0 bases is eliminated, full bounty to byPlayer", () => {
    // p1 has no bases; p0 is the killer.
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [] });
    const before = s.players[0]!.basesInHand;
    const { state, events } = applyEliminations(s, 0);
    const evt = events.find((e) => e.kind === "eliminated" && e.player === 1);
    expect(evt).toBeDefined();
    if (evt && evt.kind === "eliminated") {
      expect(evt.cause).toBe("noBases");
      expect(evt.bountyTo).toBe(0);
    }
    expect(state.players[1]!.eliminated).toBe(true);
    expect(state.players[0]!.basesInHand).toBe(before + 12);
  });

  it("noIron: player with bases but 0 controlled iron is eliminated", () => {
    // p0 has a base but no iron anywhere it controls; p1 elsewhere with iron so it survives.
    const s = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      basesP1: [hex(30, -30, 0)],
      iron: [hex(30, -29, -1)],
    });
    const { state, events } = applyEliminations(s, null);
    const evt = events.find((e) => e.kind === "eliminated" && e.player === 0);
    expect(evt).toBeDefined();
    if (evt && evt.kind === "eliminated") expect(evt.cause).toBe("noIron");
    expect(state.players[0]!.eliminated).toBe(true);
    expect(state.players[1]!.eliminated).toBe(false);
  });

  // brokenPerimeterAt18Factories is now a PER-PLAYER clock: a <4-base player is
  // eliminated by this cause once THAT PLAYER controls >= threshold factories
  // (control(state,p).factories.length), decoupled from the shared placed-factory
  // pool. The EliminationCause name is preserved as a stable identifier (the "18"
  // and "shared" in the name are historical). These fixtures set a small explicit
  // threshold so the per-player controlled-factory counts stay tractable.
  it("brokenPerimeterAt18Factories: <4 bases AND controls >= threshold factories => eliminated", () => {
    const cfg = { ...defaultConfig(), brokenPerimeterDeathAtFactories: 3 };
    // P0: 3 radiating bases near origin; controls iron (so noIron doesn't fire) AND
    // 3 factories (all within radius 5 of a P0 base) => >= threshold => eliminated.
    // P1: 4 bases far away with its own iron => survives, never hit by the clock.
    const s = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0), hex(1, -1, 0), hex(2, -2, 0)],
      basesP1: [hex(40, -40, 0), hex(41, -41, 0), hex(42, -42, 0), hex(43, -43, 0)],
      iron: [hex(3, -3, 0), hex(40, -39, -1)],
      factories: [hex(0, 1, -1), hex(0, 2, -2), hex(0, 3, -3)],
      config: cfg,
    });
    const { state, events } = applyEliminations(s, null);
    const evt = events.find((e) => e.kind === "eliminated" && e.player === 0);
    expect(evt).toBeDefined();
    if (evt && evt.kind === "eliminated") expect(evt.cause).toBe("brokenPerimeterAt18Factories");
    expect(state.players[0]!.eliminated).toBe(true);
    // P1 (>=4 bases, own iron) survives — its fate is decoupled from P0's factories.
    expect(state.players[1]!.eliminated).toBe(false);
  });

  it("brokenPerimeterAt18Factories: <4 bases but controls FEWER than threshold factories => NOT eliminated", () => {
    const cfg = { ...defaultConfig(), brokenPerimeterDeathAtFactories: 3 };
    // DISCRIMINATING fixture (per-player vs shared): the SHARED placed pool is 3
    // (>= threshold), but all 3 factories sit near P1 — P0 controls 0 of them. Under
    // the old shared clock P0 would die; under the per-player clock P0 survives.
    // P0: 3 bases, controls iron, controls 0 factories => survives.
    const s = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0), hex(1, -1, 0), hex(2, -2, 0)],
      basesP1: [hex(40, -40, 0), hex(41, -41, 0), hex(42, -42, 0), hex(43, -43, 0)],
      iron: [hex(3, -3, 0), hex(40, -39, -1)],
      factories: [hex(40, -41, 1), hex(41, -42, 1), hex(42, -43, 1)],
      config: cfg,
    });
    const { state, events } = applyEliminations(s, null);
    expect(events.find((e) => e.kind === "eliminated" && e.player === 0)).toBeUndefined();
    expect(state.players[0]!.eliminated).toBe(false);
  });

  it("brokenPerimeterAt18Factories: a >=4-base player is NEVER hit by this cause even with many factories", () => {
    const cfg = { ...defaultConfig(), brokenPerimeterDeathAtFactories: 3 };
    // P0: 4 non-colinear bases forming a perimeter that encloses iron; controls 3
    // factories. >= threshold, but >=4 bases means the broken-perimeter clock never fires.
    const s = mkState({
      board: 96,
      basesP0: [hex(-2, 2, 0), hex(2, 0, -2), hex(2, -2, 0), hex(-2, 0, 2)],
      basesP1: [hex(40, -40, 0), hex(41, -41, 0), hex(42, -42, 0), hex(43, -43, 0)],
      iron: [hex(0, 0, 0), hex(40, -39, -1)],
      factories: [hex(1, -1, 0), hex(0, 1, -1), hex(-1, 1, 0)],
      config: cfg,
    });
    const { state, events } = applyEliminations(s, null);
    expect(events.find((e) => e.kind === "eliminated" && e.player === 0)).toBeUndefined();
    expect(state.players[0]!.eliminated).toBe(false);
  });

  it("self-destruct: byPlayer === eliminated player & cause noIron => emptyPerimeter, no bounty", () => {
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(30, -30, 0)], iron: [hex(30, -29, -1)] });
    const { state, events } = applyEliminations(s, 0);
    const evt = events.find((e) => e.kind === "eliminated" && e.player === 0);
    expect(evt).toBeDefined();
    if (evt && evt.kind === "eliminated") {
      expect(evt.cause).toBe("emptyPerimeter");
      expect(evt.bountyTo).toBe(null);
    }
    // Self-inflicted: no bounty is awarded to anyone. The self-destructed player is
    // eliminated and owns nothing (its forfeited bases are given to no one), while the
    // surviving player's hand is untouched.
    expect(state.players[0]!.basesInHand).toBe(0);
    expect(state.players[1]!.basesInHand).toBe(s.players[1]!.basesInHand);
  });

  it("killBounty half => +6", () => {
    const cfg = { ...mkState({ board: 96 }).config, killBounty: "half" as const };
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [], config: cfg });
    const before = s.players[0]!.basesInHand;
    const { state } = applyEliminations(s, 0);
    expect(state.players[0]!.basesInHand).toBe(before + 6);
  });

  it("killBounty none => +0", () => {
    const cfg = { ...mkState({ board: 96 }).config, killBounty: "none" as const };
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [], config: cfg });
    const before = s.players[0]!.basesInHand;
    const { state } = applyEliminations(s, 0);
    expect(state.players[0]!.basesInHand).toBe(before + 0);
  });

  it("no eliminations => empty events", () => {
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(8, -8, 0)], iron: [hex(4, -4, 0)] });
    const { events } = applyEliminations(s, null);
    expect(events).toEqual([]);
  });

  it("purity: input state is not mutated", () => {
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [] });
    const basesLenBefore = s.bases.length;
    const p0HandBefore = s.players[0]!.basesInHand;
    const p1ElimBefore = s.players[1]!.eliminated;
    applyEliminations(s, 0);
    expect(s.bases.length).toBe(basesLenBefore);
    expect(s.players[0]!.basesInHand).toBe(p0HandBefore);
    expect(s.players[1]!.eliminated).toBe(p1ElimBefore);
  });

  it("eliminated player's bases are removed from the board", () => {
    const s = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      basesP1: [hex(30, -30, 0)],
      iron: [hex(30, -29, -1)],
    });
    // p0 controls no iron => eliminated; its base should be removed.
    const { state } = applyEliminations(s, null);
    expect(state.bases.some((b) => b.owner === 0)).toBe(false);
    expect(state.bases.some((b) => b.owner === 1)).toBe(true);
  });

  it("eliminated player's basesInHand is zeroed (all their tokens leave play)", () => {
    const s = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      basesP1: [hex(30, -30, 0)],
      iron: [hex(30, -29, -1)],
    });
    // Precondition: p0 still holds unplaced bases in hand.
    expect(s.players[0]!.basesInHand).toBeGreaterThan(0);
    // p0 controls no iron => eliminated. On elimination its on-board bases are
    // removed AND its in-hand bases leave play (an eliminated player owns nothing).
    const { state } = applyEliminations(s, null);
    expect(state.players[0]!.eliminated).toBe(true);
    expect(state.players[0]!.basesInHand).toBe(0);
    // The surviving player's hand is untouched.
    expect(state.players[1]!.basesInHand).toBe(s.players[1]!.basesInHand);
  });
});

describe("DER #18 setup-phase guard", () => {
  it("suppresses iron victory during setup (turn 0) but resolves it once play begins (turn 1), same board", () => {
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(30, -30, 0)], iron: TEN_IRON });
    const setup = { ...s, phase: { ...s.phase, turn: 0 } };

    expect(status(setup).kind).toBe("ongoing");

    const r = status(s);
    expect(r.kind).toBe("victory");
    if (r.kind === "victory") {
      expect(r.reason).toBe("iron");
      expect(r.players).toEqual([0]);
    }
  });
});

describe("DER #17 elimination ripple", () => {
  it("B-noIron: radiating p0 whose only iron sits inside non-ally perimeter is eliminated with cause noIron", () => {
    const ironHex = hex(0, 0, 0);
    const p1Bases = [hex(2, -2, 0), hex(-2, 2, 0), hex(2, 0, -2), hex(-2, 0, 2)];
    const s = mkState({ board: 96, basesP0: [hex(5, 0, -5)], basesP1: p1Bases, iron: [ironHex] });
    // Counterfactual: pre-fix p0 controlled the origin iron (1) and survived; post-fix it controls 0.
    const { events } = applyEliminations(s, null);
    expect(events.some((e) => e.kind === "eliminated" && e.player === 0 && e.cause === "noIron")).toBe(true);
  });

  it("B-clock: radiating p0 with a legit iron outside p1's hull and a borrowed factory inside is NOT eliminated by the factory-death clock", () => {
    const legitIron = hex(5, -5, 0);   // outside p1's hull, dist 5 from p0 base
    const borrowedFac = hex(0, 0, 0);  // inside p1's hull
    const p1Bases = [hex(2, -2, 0), hex(-2, 2, 0), hex(2, 0, -2), hex(-2, 0, 2)];
    const s = mkState({
      board: 96, basesP0: [hex(5, 0, -5)], basesP1: p1Bases,
      iron: [legitIron], factories: [borrowedFac],
      config: { ...defaultConfig(), brokenPerimeterDeathAtFactories: 1 },
    });
    // Counterfactual: pre-fix p0 controlled 1 factory (origin) >= threshold 1 with baseCount < 4
    // => eliminated brokenPerimeterAt18Factories. Post-fix the borrowed factory is excluded
    // (controlled factories = 0 < 1), and p0 has 1 legit iron, so it is NOT eliminated.
    const { events } = applyEliminations(s, null);
    expect(events.some((e) => e.kind === "eliminated" && e.player === 0)).toBe(false);
  });
});

// ===========================================================================
// DER #18 boundary resolution (turn 1): once the setup→play transition lands
// (phase.turn === 1, mkState's default), status() resolves the ONE victory over
// the whole board via the DER #14 tie-break — among coalitions >= victoryThreshold
// iron, the winner is the coalition with the MOST iron, ties broken by the LOWEST
// player id. These are pure status() unit tests over hand-crafted boundary states
// (mkState does not ring-validate, so bases sit at arbitrary hexes with iron set
// directly). Two singleton, non-allied players hold DISJOINT iron clusters, each
// within radius 5 of its own base and > radius 5 from the other's, so control is
// clean (a single base radiates its full disk; no DER #17 perimeter effect with
// <=1 base each). Iron counts are asserted explicitly via coalitionIron so each
// fixture is self-documenting; coordinates were generated + verified to give the
// exact stated counts with zero cluster overlap.
// ===========================================================================

// P0's cluster: 11 distinct hexes within cube-distance 5 of P0_BASE and > 5 from
// P1_BASE (slice to 10 for the most-iron and winner-flip cases; all 11 for the tie).
const P0_BASE = hex(1, 3, -4);
const P0_IRON_11 = [
  hex(-4, 3, 1), hex(-4, 4, 0), hex(-4, 5, -1), hex(-4, 6, -2), hex(-4, 7, -3),
  hex(-4, 8, -4), hex(-3, 8, -5), hex(-2, 8, -6), hex(-1, 8, -7), hex(0, 8, -8),
  hex(1, 8, -9),
];
// P1's cluster: 11 distinct hexes within cube-distance 5 of P1_BASE and > 5 from P0_BASE.
const P1_BASE = hex(2, 2, -4);
const P1_IRON_11 = [
  hex(2, -3, 1), hex(3, -3, 0), hex(4, -3, -1), hex(5, -3, -2), hex(6, -3, -3),
  hex(7, -3, -4), hex(7, -2, -5), hex(7, -1, -6), hex(7, 0, -7), hex(7, 1, -8),
  hex(7, 2, -9),
];

describe("DER #18 boundary tie-break + winner-flip", () => {
  const cfg = () => ({ ...defaultConfig(), victoryThreshold: 10 });

  it("tie-break among qualifiers: two players both >= threshold with DIFFERENT iron => most iron wins (higher-iron player)", () => {
    // P0 controls 10 (its 11-hex cluster sliced to 10); P1 controls all 11 of its cluster.
    // Both clear the threshold (10), so the DER #14 tie-break decides: MOST iron wins.
    const s = mkState({
      board: 96,
      basesP0: [P0_BASE],
      basesP1: [P1_BASE],
      iron: [...P0_IRON_11.slice(0, 10), ...P1_IRON_11],
      config: cfg(),
    });
    // Self-documenting: both qualify (>= 10), P1 has strictly more.
    expect(coalitionIron(s, [0])).toBe(10);
    expect(coalitionIron(s, [1])).toBe(11);
    const r = status(s);
    expect(r.kind).toBe("victory");
    if (r.kind === "victory") {
      expect(r.reason).toBe("iron");
      expect(r.players).toEqual([1]); // most iron, NOT lowest id — the counts differ
    }
  });

  it("tie-break among qualifiers: two players with EQUAL iron >= threshold => lowest player id wins the tie", () => {
    // P0 and P1 each control 11 (disjoint clusters). Equal iron, both >= threshold =>
    // the DER #14 tie-break falls through to the LOWEST player id.
    const s = mkState({
      board: 96,
      basesP0: [P0_BASE],
      basesP1: [P1_BASE],
      iron: [...P0_IRON_11, ...P1_IRON_11],
      config: cfg(),
    });
    expect(coalitionIron(s, [0])).toBe(11);
    expect(coalitionIron(s, [1])).toBe(11);
    const r = status(s);
    expect(r.kind).toBe("victory");
    if (r.kind === "victory") {
      expect(r.reason).toBe("iron");
      expect(r.players).toEqual([0]); // equal counts => lowest id
    }
  });

  it("DER #18 winner-flip: the boundary picks the higher-iron answerer, not the first-clincher", () => {
    // The semantic change DER #18 introduces, pinned as a regression test.
    //
    // OLD (first-clinch) semantics: during setup, the FIRST player to reach the iron
    // threshold ended the game and won AT ITS OWN placement — here P0, reaching exactly
    // 10, would have clinched and won before P1 ever answered.
    //
    // DER #18 semantics: NO victory resolves during setup (phase.turn === 0). Every seat
    // places; the setup→play transition (phase.turn -> 1) is the FIRST moment status()
    // resolves, and it resolves over the WHOLE board via the DER #14 tie-break. So P1's
    // answering 11 (> P0's 10) takes the win — the winner FLIPS from P0 to P1.
    //
    // Base hexes are the design's near-center coords (1,3,-4)/(2,2,-4); mkState does not
    // ring-validate, and it is the 10-vs-11 iron counts (verified below) that decide.
    const s = mkState({
      board: 96,
      basesP0: [P0_BASE],
      basesP1: [P1_BASE],
      iron: [...P0_IRON_11.slice(0, 10), ...P1_IRON_11],
      config: cfg(),
    });
    // P0 clinches exactly the threshold; P1 answers with one more. (Empirically confirmed.)
    expect(coalitionIron(s, [0])).toBe(10);
    expect(coalitionIron(s, [1])).toBe(11);
    const r = status(s);
    expect(r.kind).toBe("victory");
    if (r.kind === "victory") {
      expect(r.reason).toBe("iron");
      // The boundary resolves to P1 (the higher-iron answerer) — NOT P0, who under the
      // old first-clinch rule would have won at its own setup placement.
      expect(r.players).toEqual([1]);
    }
  });
});
