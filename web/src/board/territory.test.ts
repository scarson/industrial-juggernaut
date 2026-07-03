// ABOUTME: Pins territoryFills/overlapZones against controlOf() for both control regimes
// ABOUTME: (radiating disk, perimeter hull) and their shared-hex overlap, with a regime-boundary case.
import { describe, expect, test } from "vitest";
import { territoryFills, overlapZones } from "./territory";
import { controlOf } from "../engine-client/selectors";
import { hexKey } from "./projection";
import { initGame, defaultConfig, generateBoard, seed } from "../engine-client/barrel";
import type { GameState } from "../engine-client/barrel";

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
// Radius-disk (radiating, <4 bases) fixture: a single base at the origin on the
// setup-phase size-96 board. config.radius defaults to 5 (src/engine/config.ts),
// so board hexes within cube distance 5 of (0,0,0) are controlled.
// ---------------------------------------------------------------------------
function radiatingFixtureState(): GameState {
  const base = setupState();
  return {
    ...base,
    phase: { ...base.phase, turn: 1 },
    bases: [{ owner: 0 as const, hex: { x: 0, y: 0, z: 0 }, state: "fresh" as const, order: 0 }],
  };
}

// ---------------------------------------------------------------------------
// Perimeter-hull (4+ bases) fixture. Player 0 holds 4 bases on a size-150 board
// (seed 1n) — a wider board than the size-96 default so the hull can enclose a
// hex that clears every base's radius-5 disk (size 96 is too small: its widest
// possible on-board 4-base hull tops out at exactly radius-5 minimum distance,
// never exceeding it — verified by exhaustive search over its board hexes).
//
//     N = (0,5,-5)   S = (0,-5,5)   E = (8,-7,-1)   W = (-7,7,0)
//
// convexHull(N,S,E,W) is a quadrilateral (CCW order W,N,E,S) with hullArea
// ~194.86 > 0 (a valid perimeter, not R3-colinear). All 4 hexes are on-board
// for seed-1n/size-150 (verified against generateBoard's own hex list).
//
// Regime-boundary hex: (3,-1,-2).
//   - Edge midpoint of N=(0,5,-5) and E=(8,-7,-1) is exactly (4,-1,-3) (integer
//     average of both components) — a point ON the N-E hull edge, hence inside
//     per R1 but not a useful "interior-only" witness (edge points are a
//     boundary case, not a clean interior/disk-regime split).
//   - Stepping ONE hex further inward from that edge midpoint, in the
//     direction (-1,0,1) (one of the 6 canonical unit directions from
//     src/geometry/cube.ts's DIRECTIONS), lands on (3,-1,-2) — strictly
//     interior to the hull (off every edge's supporting line, confirmed via
//     the hull's own cross-product sidedness test in exploration).
//   - Distances from (3,-1,-2) to each base: N=6, S=7, E=6, W=10 (cube
//     distance, src/geometry/cube.ts's `distance`) — every one exceeds
//     config.radius=5, so no base's radiating disk reaches it. It is
//     controlled ONLY because the perimeter regime is active (4 non-colinear
//     bases), proving the fill switches regime at the 4-base boundary.
//   Ground truth cross-check (not the basis of the assertion, which is
//   derived above from the hull/edge/direction geometry): controlOf(state, 0)
//   .hexes.has(hexKey({x:3,y:-1,z:-2})) is asserted true as a sanity check
//   that the derivation matches the engine's own predicate.
// ---------------------------------------------------------------------------
const N = { x: 0, y: 5, z: -5 };
const S = { x: 0, y: -5, z: 5 };
const E = { x: 8, y: -7, z: -1 };
const W = { x: -7, y: 7, z: 0 };
const HULL_INTERIOR_HEX = { x: 3, y: -1, z: -2 };

function perimeterFixtureState(): GameState {
  const { board, rng } = generateBoard(seed(1n), { size: 150, ironCount: 14 });
  const config = defaultConfig();
  return {
    board,
    bases: [N, S, E, W].map((h, i) => ({ owner: 0 as const, hex: h, state: "fresh" as const, order: i })),
    factories: [],
    players: [
      { id: 0, basesInHand: 8, alliance: [0], eliminated: false },
      { id: 1, basesInHand: 12, alliance: [1], eliminated: false },
    ],
    phase: { turn: 1, order: [0, 1], indexInOrder: 0 },
    factorySupply: config.factorySupply,
    config,
    rngState: rng,
  };
}

// ---------------------------------------------------------------------------
// A player at exactly 3 bases (radiating) vs the same shape plus a 4th base
// (perimetered) — proves the fill switches regime when the 4th base lands.
// The 3-base shape is N, S, E from the perimeter fixture above (still on the
// size-150 board); adding W crosses the PERIMETER_BASE_COUNT=4 threshold
// (src/engine/control.ts).
// ---------------------------------------------------------------------------
function threeBaseFixtureState(): GameState {
  const four = perimeterFixtureState();
  return { ...four, bases: four.bases.filter((b) => b.hex !== W) };
}

// ---------------------------------------------------------------------------
// Overlap fixture: two radiating players with adjacent bases, structurally
// overridden onto the size-96 setup board so their radius-5 disks share hexes.
// p0Base=(0,0,0), p1Base=(2,-2,0) are distance 2 apart (well inside each
// other's radius-5 reach); their exact midpoint (1,-1,0) is distance 1 from
// each — a clean shared hex both players control.
// ---------------------------------------------------------------------------
const P0_BASE = { x: 0, y: 0, z: 0 };
const P1_BASE = { x: 2, y: -2, z: 0 };
const SHARED_HEX = { x: 1, y: -1, z: 0 };

function overlapFixtureState(): GameState {
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

describe("fixture validity", () => {
  // The negative assertions below (has(...) === false) would pass vacuously if a
  // fixture hex were accidentally off-board — control() intersects with the board's
  // hex list, so an off-board hex is never controlled for the wrong reason. Pinning
  // on-board membership here keeps those negative assertions meaningful.
  test("every fixture hex used in assertions is on its board", () => {
    const perimeter = perimeterFixtureState();
    const perimeterKeys = new Set(perimeter.board.hexes.map((h) => hexKey(h)));
    for (const h of [N, S, E, W, HULL_INTERIOR_HEX]) {
      expect(perimeterKeys.has(hexKey(h))).toBe(true);
    }

    const overlap = overlapFixtureState();
    const overlapKeys = new Set(overlap.board.hexes.map((h) => hexKey(h)));
    for (const h of [P0_BASE, P1_BASE, SHARED_HEX, { x: 5, y: -5, z: 0 }, { x: 6, y: -6, z: 0 }]) {
      expect(overlapKeys.has(hexKey(h))).toBe(true);
    }
  });
});

describe("territoryFills", () => {
  test("radiating regime (<4 bases): fills the radius disk around the single base", () => {
    const state = radiatingFixtureState();
    const fills = territoryFills(state);

    // In-disk hex: distance 5 from (0,0,0), at the radius boundary (config.radius=5).
    const inDisk = hexKey({ x: 5, y: -5, z: 0 });
    // Out-of-disk hex: distance 6, one step beyond the radius.
    const outOfDisk = hexKey({ x: 6, y: -6, z: 0 });

    expect(fills.get(inDisk)).toEqual([0]);
    expect(fills.has(outOfDisk)).toBe(false);
  });

  test("perimeter regime (>=4 non-colinear bases, hull area >0): fills the hull interior", () => {
    const state = perimeterFixtureState();
    const fills = territoryFills(state);

    // Ground truth ties the fixture's derived expectation to the engine's own predicate.
    const ctl = controlOf(state, 0);
    expect(ctl.hexes.has(hexKey(HULL_INTERIOR_HEX))).toBe(true);

    expect(fills.get(hexKey(HULL_INTERIOR_HEX))).toEqual([0]);
    // A hull vertex is also filled (on-edge counts as inside per R1).
    expect(fills.get(hexKey(N))).toEqual([0]);
  });

  test("regime-boundary: a hex inside the 4-base hull but outside every base's radius disk is filled only once a 4th base is placed", () => {
    const threeBaseState = threeBaseFixtureState();
    const fourBaseState = perimeterFixtureState();

    // With only 3 bases (radiating fallback, R3's PERIMETER_BASE_COUNT=4 not met),
    // the regime-boundary hex is unreachable: distances to N/S/E are 6/7/6, all
    // beyond config.radius=5.
    const threeBaseFills = territoryFills(threeBaseState);
    expect(threeBaseFills.has(hexKey(HULL_INTERIOR_HEX))).toBe(false);

    // Adding the 4th base (W) crosses into the perimeter regime; the hull interior
    // now includes the same hex even though no single base's disk reaches it.
    const fourBaseFills = territoryFills(fourBaseState);
    expect(fourBaseFills.get(hexKey(HULL_INTERIOR_HEX))).toEqual([0]);
  });

  test("excludes eliminated players' controlled hexes", () => {
    const base = overlapFixtureState();
    const eliminatedState: GameState = {
      ...base,
      players: base.players.map((p) => (p.id === 1 ? { ...p, eliminated: true } : p)),
    };
    const fills = territoryFills(eliminatedState);

    // The shared hex was controlled by both; with p1 eliminated only p0 remains.
    expect(fills.get(hexKey(SHARED_HEX))).toEqual([0]);
  });
});

describe("overlapZones", () => {
  test("returns hexes controlled by >=2 players, keyed by canonical hexKey", () => {
    const state = overlapFixtureState();
    const zones = overlapZones(state);

    expect(zones.has(hexKey(SHARED_HEX))).toBe(true);

    // Cross-check against territoryFills: the shared hex's controller list has
    // both players, and every zone hex has >=2 controllers.
    const fills = territoryFills(state);
    expect(Array.from(fills.get(hexKey(SHARED_HEX)) ?? []).sort()).toEqual([0, 1]);
    for (const k of zones) {
      expect((fills.get(k) ?? []).length).toBeGreaterThanOrEqual(2);
    }
  });

  test("a hex controlled by only one player is not an overlap zone", () => {
    const state = overlapFixtureState();
    const zones = overlapZones(state);

    // Distance 5 from p0Base (inside p0's radius-5 disk), distance 7 from p1Base
    // (outside p1's radius-5 disk) — controlled by p0 alone.
    const p0OnlyHex = { x: -5, y: 5, z: 0 };
    expect(controlOf(state, 0).hexes.has(hexKey(p0OnlyHex))).toBe(true);
    expect(controlOf(state, 1).hexes.has(hexKey(p0OnlyHex))).toBe(false);
    expect(zones.has(hexKey(p0OnlyHex))).toBe(false);
  });
});
