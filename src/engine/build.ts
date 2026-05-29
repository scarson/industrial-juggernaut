// ABOUTME: Build-action legality predicates and the build budget (spec §8 "Build").
// ABOUTME: Pure functions; perimeter/control recomputed per call (GEO-5), hex sets keyed by canonical string (GEO-4).

import { distance, key } from "../geometry/cube";
import { convexHull, hexInHull, hullArea } from "../geometry/hull";
import { segmentBlocked } from "../geometry/sightline";
import { control, resourceCount } from "./control";
import type { Base, BaseType, GameState, Hex, PlayerId } from "./types";
import type { RuleConfig } from "./config";

const PERIMETER_BASE_COUNT = 4;

/**
 * Per-base-piece cost in resources (Tactical Depth Phase 3). When
 * `baseTypesEnabled`, the asymmetric subtypes have different costs:
 *   - forge:      2 resources / piece (unchanged from pre-Phase-3 semantics)
 *   - watchtower: 4 resources / piece (twice the cost)
 *   - outpost:    1 resource  / piece (half the cost)
 * When the flag is false, ALL base pieces cost 2 regardless of subtype, so
 * existing callers and fixtures behave identically.
 *
 * Factories always cost 2 resources / piece (no per-type variation).
 */
export const BASE_PIECE_COST_FORGE = 2;
const BASE_PIECE_COST_WATCHTOWER = 4;
const BASE_PIECE_COST_OUTPOST = 1;
const FACTORY_PIECE_COST = 2;

/**
 * Per-piece cost lookup. Phase 3 default costs are the constants above; per-config
 * overrides via `basePieceCosts?: Partial<Record<BaseType, number>>` let sweeps tune
 * the cost model (post-Track-D recalibration finding — see
 * `docs/2026-05-29-tactical-depth-cost-recalibration.md`).
 *
 * If the flag is off, every type returns the forge cost (bit-for-bit pre-Phase-3
 * behavior). If the flag is on AND a per-type override is present in
 * `config.basePieceCosts`, use the override; otherwise fall back to the constant.
 */
export function basePieceCost(config: RuleConfig, type: BaseType): number {
  if (!config.baseTypesEnabled) return BASE_PIECE_COST_FORGE;
  const overrides = config.basePieceCosts ?? {};
  switch (type) {
    case "forge":      return overrides.forge      ?? BASE_PIECE_COST_FORGE;
    case "watchtower": return overrides.watchtower ?? BASE_PIECE_COST_WATCHTOWER;
    case "outpost":    return overrides.outpost    ?? BASE_PIECE_COST_OUTPOST;
  }
}

export function factoryPieceCost(): number {
  return FACTORY_PIECE_COST;
}

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
 *
 * Returns the FORGE-base-piece (and factory-piece, same cost) budget — the
 * legacy single value. Callers that need a per-base-type budget under
 * `baseTypesEnabled` should use {@link buildBudgetForType}.
 */
export function buildBudget(state: GameState, player: PlayerId): number {
  return buildBudgetForType(state, player, "forge");
}

/**
 * Per-base-type build budget (Tactical Depth Phase 3). Returns
 * `max(floor(rc / basePieceCost(config, type)), bootstrap ? 1 : 0)`. With
 * `baseTypesEnabled=false`, every call returns the legacy `floor(rc/2)`
 * regardless of `type` — preserving bit-for-bit existing behavior.
 *
 * Bootstrap retained: the bootstrap factory carve-out is per the existing
 * rule (only when <4 bases, ≥1 iron, 0 factories) and applies independently
 * of base type — the bootstrap covers a factory, not a base.
 */
export function buildBudgetForType(state: GameState, player: PlayerId, type: BaseType): number {
  const ctl = control(state, player);
  const rc = ctl.iron.length + ctl.factories.length;
  const baseCount = basesOf(state, player).length;
  const bootstrap = baseCount < PERIMETER_BASE_COUNT && ctl.iron.length >= 1 && ctl.factories.length === 0;
  const cost = basePieceCost(state.config, type);
  return Math.max(Math.floor(rc / cost), bootstrap ? 1 : 0);
}

/**
 * The player's base(s) farthest (by cube distance) from their first/oldest base
 * (min `order`). Returns ALL bases tied for the maximum distance (R4). If the
 * player has only the first base, returns that base.
 *
 * Tactical Depth Phase 4: when `baseTypesEnabled`, ONLY forge bases generate
 * factories — so a factory placement's anchor must be a forge, not a watchtower
 * or outpost. We filter to forges BEFORE computing the farthest base. If a player
 * has no forge bases (e.g. an all-outpost strategy), `farthestBases` returns []
 * and `isLegalFactoryPlacement` will correctly reject every factory placement.
 *
 * When the flag is off, every base is treated as a forge (the existing behavior).
 */
export function farthestBases(state: GameState, player: PlayerId): Base[] {
  let bases = basesOf(state, player);
  if (state.config.baseTypesEnabled) {
    bases = bases.filter((b) => (b.type ?? "forge") === "forge");
  }
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
 * The acting player must have a base in hand (`basesInHand > 0`); a maxed-out
 * player can place nothing. Beyond that, `h` must be on the board and empty.
 * Two cases:
 *  - INSIDE OWN PERIMETER (player has a valid >=4-base non-degenerate hull and
 *    `h` is inside it): legal anywhere empty in territory (fortifies, claims
 *    nothing).
 *  - OUTSIDE OWN PERIMETER: always requires
 *      (1) within `config.placeRange` of at least one friendly base;
 *      (2) NOT inside any opponent's valid perimeter.
 *    Beyond that, the triangle requirement depends on how many bases the player
 *    already has on the board (rules v10 §"Radiating Bases" / §"Placing Bases"):
 *      - RADIATING PHASE (< 3 existing bases — placing the 2nd or 3rd): each base
 *        radiates a control circle and there is NO perimeter yet, so (1)+(2) alone
 *        suffice. No triangle is required.
 *      - PERIMETER ESTABLISHMENT/EXTENSION (>= 3 existing bases — placing the 4th
 *        or later): the placement extends a perimeter, so it MUST additionally
 *      (3) form an unobstructed triangle with TWO distinct friendly bases —
 *          two friendly bases b1,b2 with `segmentBlocked(h, b.hex, OPP)` false,
 *          where OPP is the opponent-perimeter blocker set. Seeing only ONE
 *          friendly base is illegal (encloses no new territory).
 */
export function isLegalBasePlacement(state: GameState, player: PlayerId, h: Hex): boolean {
  // You cannot place a base you don't have: a maxed-out player (all 12 bases on
  // the board) has none in hand, so no placement is legal regardless of geometry.
  if (state.players[player]!.basesInHand <= 0) return false;
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

  // Radiating phase (< 3 existing bases): no perimeter exists yet, so the 2nd/3rd
  // base needs only proximity + not-in-opponent-perimeter (rules v10 §"Radiating
  // Bases"). The triangle rule below governs the 4th+ base that establishes or
  // extends a perimeter (rules v10 §"Placing Bases").
  if (friendly.length < PERIMETER_BASE_COUNT - 1) return true;

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
