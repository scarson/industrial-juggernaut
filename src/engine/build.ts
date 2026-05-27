// ABOUTME: Build-action legality predicates and the build budget (spec §8 "Build").
// ABOUTME: Pure functions; perimeter/control recomputed per call (GEO-5), hex sets keyed by canonical string (GEO-4).

import { distance, key } from "../geometry/cube";
import { convexHull, hexInHull, hullArea } from "../geometry/hull";
import { segmentBlocked } from "../geometry/sightline";
import { control, resourceCount } from "./control";
import type { Base, GameState, Hex, PlayerId } from "./types";

const PERIMETER_BASE_COUNT = 4;

/** Bases owned by `player`, in placement order is irrelevant — caller may reorder. */
function basesOf(state: GameState, player: PlayerId): Base[] {
  return state.bases.filter((b) => b.owner === player);
}

/** The player's first/oldest base = the one with the minimum `order`. */
function oldestBase(bases: Base[]): Base | undefined {
  let oldest: Base | undefined;
  for (const b of bases) {
    if (oldest === undefined || b.order < oldest.order) oldest = b;
  }
  return oldest;
}

/**
 * A player's valid perimeter hull, or null when they have no perimeter regime
 * (fewer than 4 bases, or a degenerate/colinear hull per R3). Derived every
 * call (GEO-5); the convex hull is over the player's base centers.
 */
function validHull(state: GameState, player: PlayerId): Hex[] | null {
  const bases = basesOf(state, player);
  if (bases.length < PERIMETER_BASE_COUNT) return null;
  const hull = convexHull(bases.map((b) => b.hex));
  if (hullArea(hull) <= 0) return null; // degenerate/colinear (R3)
  return hull;
}

/** Is `h` a real board coordinate? Keyed by the canonical "x,y,z" string (GEO-4). */
function onBoard(state: GameState, h: Hex): boolean {
  const target = key(h);
  return state.board.hexes.some((b) => key(b) === target);
}

/** Is `h` occupied by any base or factory? */
function occupied(state: GameState, h: Hex): boolean {
  const target = key(h);
  if (state.bases.some((b) => key(b.hex) === target)) return true;
  if (state.factories.some((f) => key(f.hex) === target)) return true;
  return false;
}

/** Is `h` an iron hex on the board? */
function isIron(state: GameState, h: Hex): boolean {
  const target = key(h);
  return state.board.iron.some((i) => key(i) === target);
}

/**
 * Build budget (spec §8): `floor(resourceCount / 2)`, with the bootstrap
 * exception — a player with fewer than 4 bases controlling >=1 iron and 0
 * factories may build 1 factory even at resource count 1. So the budget is
 * `max(floor(rc/2), bootstrap ? 1 : 0)`.
 */
export function buildBudget(state: GameState, player: PlayerId): number {
  const ctl = control(state, player);
  const rc = ctl.iron.length + ctl.factories.length;
  const baseCount = basesOf(state, player).length;
  const bootstrap = baseCount < PERIMETER_BASE_COUNT && ctl.iron.length >= 1 && ctl.factories.length === 0;
  return Math.max(Math.floor(rc / 2), bootstrap ? 1 : 0);
}

/**
 * The player's base(s) farthest (by cube distance) from their first/oldest base
 * (min `order`). Returns ALL bases tied for the maximum distance (R4). If the
 * player has only the first base, returns that base.
 */
export function farthestBases(state: GameState, player: PlayerId): Base[] {
  const bases = basesOf(state, player);
  const first = oldestBase(bases);
  if (first === undefined) return [];

  let maxDist = -1;
  for (const b of bases) {
    const d = distance(first.hex, b.hex);
    if (d > maxDist) maxDist = d;
  }
  // maxDist is 0 only when the player has just the first base (distance to self).
  return bases.filter((b) => distance(first.hex, b.hex) === maxDist);
}

/**
 * Factory placement legality (spec §8):
 *   - `h` on the board, empty (no base/factory), and NOT an iron hex;
 *   - within `config.placeRange` of at least one of `farthestBases` (R4 ties =>
 *     any tied base);
 *   - the central factory supply must be > 0.
 */
export function isLegalFactoryPlacement(state: GameState, player: PlayerId, h: Hex): boolean {
  if (state.factorySupply <= 0) return false;
  if (!onBoard(state, h)) return false;
  if (occupied(state, h)) return false;
  if (isIron(state, h)) return false;

  const farthest = farthestBases(state, player);
  if (farthest.length === 0) return false;
  return farthest.some((b) => distance(b.hex, h) <= state.config.placeRange);
}

/**
 * The blocker set for triangle-visibility: the canonical keys of all board
 * hexes inside any OPPONENT's valid perimeter (their controlled perimeter
 * region — the M1 approximation of "opponent perimeter hexes"). Friendly /
 * own hexes are never blockers.
 */
function opponentPerimeterBlockers(state: GameState, player: PlayerId): Set<string> {
  const blockers = new Set<string>();
  for (const opp of state.players) {
    if (opp.id === player) continue;
    const hull = validHull(state, opp.id);
    if (hull === null) continue;
    for (const bh of state.board.hexes) {
      if (hexInHull(bh, hull)) blockers.add(key(bh));
    }
  }
  return blockers;
}

/** Is `h` inside any opponent's valid perimeter? */
function insideAnyOpponentPerimeter(state: GameState, player: PlayerId, h: Hex): boolean {
  for (const opp of state.players) {
    if (opp.id === player) continue;
    const hull = validHull(state, opp.id);
    if (hull === null) continue;
    if (hexInHull(h, hull)) return true;
  }
  return false;
}

/**
 * Base placement legality (spec §8 "Placing Bases").
 *
 * `h` must be on the board and empty. Two cases:
 *  - INSIDE OWN PERIMETER (player has a valid >=4-base non-degenerate hull and
 *    `h` is inside it): legal anywhere empty in territory (fortifies, claims
 *    nothing).
 *  - OUTSIDE OWN PERIMETER: legal iff
 *      (1) within `config.placeRange` of at least one friendly base;
 *      (2) NOT inside any opponent's valid perimeter;
 *      (3) forms an unobstructed triangle with TWO distinct friendly bases —
 *          two friendly bases b1,b2 with `segmentBlocked(h, b.hex, OPP)` false,
 *          where OPP is the opponent-perimeter blocker set. Seeing only ONE
 *          friendly base is illegal (encloses no new territory).
 */
export function isLegalBasePlacement(state: GameState, player: PlayerId, h: Hex): boolean {
  if (!onBoard(state, h)) return false;
  if (occupied(state, h)) return false;

  // Inside own perimeter: legal anywhere empty in territory.
  const ownHull = validHull(state, player);
  if (ownHull !== null && hexInHull(h, ownHull)) return true;

  // Outside own perimeter.
  const friendly = basesOf(state, player);

  // (1) within placeRange of at least one friendly base.
  if (!friendly.some((b) => distance(b.hex, h) <= state.config.placeRange)) return false;

  // (2) not inside any opponent perimeter.
  if (insideAnyOpponentPerimeter(state, player, h)) return false;

  // (3) unobstructed triangle with two distinct friendly bases.
  const opp = opponentPerimeterBlockers(state, player);
  let visibleCount = 0;
  for (const b of friendly) {
    if (!segmentBlocked(h, b.hex, opp)) {
      visibleCount++;
      if (visibleCount >= 2) return true;
    }
  }
  return false;
}
