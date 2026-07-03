// ABOUTME: TEST-ONLY. Deterministic GameState fixtures for the territory/overlap board tests —
// ABOUTME: a single-controller radiating disk and a two-player overlap, shared by territory.test + Board.test.
import { initGame, defaultConfig } from "../engine-client/barrel";
import type { GameState } from "../engine-client/barrel";

// Fixed-seed setup-phase base (2 players, size-96 board) — deterministic across runs. The two
// override fixtures below reuse its real generated board and swap in a hand-placed base layout.
export function setupState(): GameState {
  return initGame({
    seed: 1n,
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    nPlayers: 2,
    config: defaultConfig(),
  });
}

// ---------------------------------------------------------------------------
// Radius-disk (radiating, <4 bases) fixture: a single base at the origin on the
// setup-phase size-96 board. config.radius defaults to 5 (src/engine/config.ts),
// so board hexes within cube distance 5 of (0,0,0) are controlled — a clean
// single-controller territory with no overlap.
// ---------------------------------------------------------------------------
export function radiatingFixtureState(): GameState {
  const base = setupState();
  return {
    ...base,
    phase: { ...base.phase, turn: 1 },
    bases: [{ owner: 0 as const, hex: { x: 0, y: 0, z: 0 }, state: "fresh" as const, order: 0 }],
  };
}

// ---------------------------------------------------------------------------
// Overlap fixture: two radiating players with adjacent bases, structurally
// overridden onto the size-96 setup board so their radius-5 disks share hexes.
// p0Base=(0,0,0), p1Base=(2,-2,0) are distance 2 apart (well inside each
// other's radius-5 reach); their exact midpoint (1,-1,0) is distance 1 from
// each — a clean shared hex both players control.
// ---------------------------------------------------------------------------
export const P0_BASE = { x: 0, y: 0, z: 0 };
export const P1_BASE = { x: 2, y: -2, z: 0 };
export const SHARED_HEX = { x: 1, y: -1, z: 0 };

export function overlapFixtureState(): GameState {
  const base = setupState();
  return {
    ...base,
    phase: { ...base.phase, turn: 1 },
    bases: [
      { owner: 0 as const, hex: P0_BASE, state: "fresh" as const, order: 0 },
      { owner: 1 as const, hex: P1_BASE, state: "fresh" as const, order: 0 },
    ],
  };
}
