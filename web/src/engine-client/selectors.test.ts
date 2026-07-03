// ABOUTME: Tests the memoized engine selectors — identity-keyed caching plus structural
// ABOUTME: correctness against the direct engine calls each selector wraps.
import { describe, expect, test } from "vitest";
import {
  controlOf,
  currentSeat,
  factoriesPlaced,
  budgetOf,
  strandedHexKeys,
} from "./selectors";
import { control, currentPlayer, buildBudget, initGame, defaultConfig, strandedBases } from "./barrel";
import { hex, key } from "../../../src/geometry/cube";
import type { GameState } from "./barrel";

// Fixed-seed setup-phase fixture (2 players, size-96 board) — deterministic across runs.
function setupState(): GameState {
  return initGame({
    seed: 1n,
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    nPlayers: 2,
    config: defaultConfig(),
  });
}

// ---------------------------------------------------------------------------
// Stranded-base fixture geometry, reused verbatim from test/engine/stranded.test.ts's
// "detection" case (same fixed seed-1n/size-96 board — verified on-board there and in
// this task's exploration). That suite already proves the strandedBases() predicate
// itself; this file only proves the selector's union/keying/memoization on top of it.
//
// Opponent (p1) holds a 4-base hull (hullArea ~7.79 > 0) that blocks sightlines:
//     (0,2,-2) (0,-1,1) (1,1,-2) (1,-2,1)
// Player 0 holds four bases:
//     S  = (4,-1,-3)  sees only F1 across the strip -> degree 1 -> STRANDED
//     F1 = (-1,4,-3)  sees S, F2, F3 -> degree 3
//     F2 = (-4,3,1)   sees F1, F3 -> degree 2
//     F3 = (-4,2,2)   sees F1, F2 -> degree 2
// Elimination is tested by giving a third player (id 2, ELIMINATED) the same stranded
// shape at negated coordinates (S2/F1_2/F2_2/F3_2, disjoint from player 0's hexes) and
// asserting its stranded hex is excluded from the union solely because `eliminated: true`.
// ---------------------------------------------------------------------------
const OPP_STRIP = [hex(0, 2, -2), hex(0, -1, 1), hex(1, 1, -2), hex(1, -2, 1)];
const S = hex(4, -1, -3);
const F1 = hex(-1, 4, -3);
const F2 = hex(-4, 3, 1);
const F3 = hex(-4, 2, 2);

// A second, disjoint stranded-base shape for the eliminated player, built by negating
// every fixture coordinate (still sums to 0, still on the seed-1n/size-96 board — the
// board is symmetric about the origin because generateBoard grows a radius-based oval).
function negate(h: { x: number; y: number; z: number }) {
  return hex(-h.x, -h.y, -h.z);
}
const OPP_STRIP_2 = OPP_STRIP.map(negate);
const S2 = negate(S);
const F1_2 = negate(F1);
const F2_2 = negate(F2);
const F3_2 = negate(F3);

function strandedFixtureState(): GameState {
  const base = setupState();
  return {
    ...base,
    phase: { ...base.phase, turn: 1 },
    bases: [
      ...[S, F1, F2, F3].map((h, i) => ({ owner: 0 as const, hex: h, state: "fresh" as const, order: i })),
      ...OPP_STRIP.map((h, i) => ({ owner: 1 as const, hex: h, state: "fresh" as const, order: i })),
    ],
    players: [
      { id: 0, basesInHand: 8, alliance: [0], eliminated: false },
      { id: 1, basesInHand: 8, alliance: [1], eliminated: false },
    ],
  };
}

// Same S/F1/F2/F3 shape (negated coordinates) but owned by an ELIMINATED player 2 in a
// 3-player game — proves strandedHexKeys skips eliminated players' stranded bases.
function strandedFixtureWithEliminatedPlayer(): GameState {
  const base = strandedFixtureState();
  return {
    ...base,
    bases: [
      ...base.bases,
      ...[S2, F1_2, F2_2, F3_2].map((h, i) => ({ owner: 2 as const, hex: h, state: "fresh" as const, order: i })),
      ...OPP_STRIP_2.map((h, i) => ({ owner: 1 as const, hex: h, state: "fresh" as const, order: i + 10 })),
    ],
    players: [
      ...base.players,
      { id: 2, basesInHand: 8, alliance: [2], eliminated: true },
    ],
  };
}

describe("controlOf", () => {
  test("returns the same Control object on a second call with the same state reference", () => {
    const state = strandedFixtureState();
    const first = controlOf(state, 0);
    const second = controlOf(state, 0);
    expect(second).toBe(first);
  });

  test("returns a fresh object for a different state", () => {
    const stateA = strandedFixtureState();
    const stateB = strandedFixtureState();
    const a = controlOf(stateA, 0);
    const b = controlOf(stateB, 0);
    expect(a).not.toBe(b);
  });

  test("matches control(state, player) structurally", () => {
    const state = strandedFixtureState();
    const viaSelector = controlOf(state, 0);
    const viaEngine = control(state, 0);
    expect(Array.from(viaSelector.hexes).sort()).toEqual(Array.from(viaEngine.hexes).sort());
    expect(viaSelector.iron.map(key).sort()).toEqual(viaEngine.iron.map(key).sort());
    expect(viaSelector.factories.map(key).sort()).toEqual(viaEngine.factories.map(key).sort());
  });
});

describe("currentSeat", () => {
  test("equals currentPlayer(state)", () => {
    const state = setupState();
    expect(currentSeat(state)).toBe(currentPlayer(state));
  });
});

describe("factoriesPlaced", () => {
  test("equals config.factorySupply - state.factorySupply (rule-agnostic, not hardcoded 36)", () => {
    const state = setupState();
    // No factories placed yet in a fresh setup-phase state.
    expect(factoriesPlaced(state)).toBe(0);
    expect(factoriesPlaced(state)).toBe(state.config.factorySupply - state.factorySupply);

    // Simulate 5 placed factories via a non-default config knob (37, not 36) to prove
    // the formula reads config.factorySupply rather than a hardcoded constant.
    const customConfig = { ...defaultConfig(), factorySupply: 37 };
    const withPlacedFactories: GameState = { ...state, config: customConfig, factorySupply: 32 };
    expect(factoriesPlaced(withPlacedFactories)).toBe(5);
  });
});

describe("budgetOf", () => {
  test("equals buildBudget(state, player)", () => {
    const state = strandedFixtureState();
    expect(budgetOf(state, 0)).toBe(buildBudget(state, 0));
    expect(budgetOf(state, 1)).toBe(buildBudget(state, 1));
  });
});

describe("strandedHexKeys", () => {
  test("unions strandedBases(state, p) over non-eliminated players as canonical hexKeys", () => {
    const state = strandedFixtureState();
    const result = strandedHexKeys(state);

    // Ground truth: call the engine's own predicate directly for every non-eliminated
    // player and union the canonical keys — proves the selector doesn't reimplement or
    // diverge from strandedBases's own notion of "stranded."
    const expectedKeys = new Set<string>();
    for (const p of state.players) {
      if (p.eliminated) continue;
      for (const b of strandedBases(state, p.id)) expectedKeys.add(key(b.hex));
    }

    expect(Array.from(result).sort()).toEqual(Array.from(expectedKeys).sort());
    // Structural sanity: S (p0, blocked by p1's strip) and the strip hex (0,2,-2) (p1,
    // symmetrically blocked by p0's own 4-base shape) are each independently stranded —
    // verified directly against strandedBases() for both players above.
    expect(Array.from(result).sort()).toEqual([key(hex(0, 2, -2)), key(S)]);
  });

  test("skips eliminated players' stranded bases", () => {
    const state = strandedFixtureWithEliminatedPlayer();
    const result = strandedHexKeys(state);

    // Player 2 (eliminated) has the identical stranded-base shape as player 0 (negated
    // coordinates), so S2 would be stranded and included if elimination weren't
    // respected. Assert it is excluded, while player 0's S is still present.
    expect(result.has(key(S2))).toBe(false);
    expect(result.has(key(S))).toBe(true);

    // Cross-check against a manual union that also skips eliminated players.
    const expectedKeys = new Set<string>();
    for (const p of state.players) {
      if (p.eliminated) continue;
      for (const b of strandedBases(state, p.id)) expectedKeys.add(key(b.hex));
    }
    expect(Array.from(result).sort()).toEqual(Array.from(expectedKeys).sort());
  });

  test("returns the same Set object on a second call with the same state reference", () => {
    const state = strandedFixtureState();
    const first = strandedHexKeys(state);
    const second = strandedHexKeys(state);
    expect(second).toBe(first);
  });
});
