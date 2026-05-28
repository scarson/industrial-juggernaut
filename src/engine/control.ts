// ABOUTME: Territory control — which hexes (and thus iron/factories) a player commands.
// ABOUTME: Radiating disks below 4 bases (overlaps shared); convex-hull interior at 4+ non-colinear bases (R1). Derived every call (GEO-5).

import { distance, key } from "../geometry/cube";
import { convexHull, hexInHull, hullArea } from "../geometry/hull";
import type { GameState, Hex, PlayerId } from "./types";

const PERIMETER_BASE_COUNT = 4;

export interface Control {
  hexes: Set<string>;
  iron: Hex[];
  factories: Hex[];
  /**
   * True iff the player is in the PERIMETER regime (≥4 non-colinear bases with positive-area hull).
   * False under the RADIATING regime (<4 bases, or degenerate/colinear hull → R3 radiating fallback).
   * Surfaced so callers (e.g. variant-(a)/P3 victory-iron gating, variant-(a)/(c) noIron-perimeter
   * gating) can branch on regime without re-deriving the hull.
   */
  perimeter: boolean;
}

/**
 * Hexes a player controls, plus the controlled iron and factories.
 *
 * Recomputed from the current bases every call — never cached (GEO-5). All
 * membership is keyed by the canonical "x,y,z" string (GEO-4). In both regimes
 * the controlled set is intersected with the board, so `hexes` only ever holds
 * real board coordinates (spec §7).
 *
 * - RADIATING (<4 bases, or 4+ but degenerate/colinear hull → R3 fallback):
 *   board hexes within `config.radius` of any base. Non-exclusive; overlaps
 *   with other radiating players are shared (we do not subtract them here).
 * - PERIMETER (4+ non-colinear bases): the convex-hull interior, on-edge inside
 *   per R1.
 */
export function control(state: GameState, player: PlayerId): Control {
  const myBases = state.bases.filter((b) => b.owner === player);
  const hexes = new Set<string>();

  let perimeter = false;
  let hull: Hex[] = [];
  if (myBases.length >= PERIMETER_BASE_COUNT) {
    hull = convexHull(myBases.map((b) => b.hex));
    // Degenerate/colinear hull (R3): no enclosed territory → radiating fallback.
    perimeter = hullArea(hull) > 0;
  }

  if (perimeter) {
    // PERIMETER: convex-hull interior, intersected with the board (R1 on-edge=inside).
    for (const h of state.board.hexes) {
      if (hexInHull(h, hull)) hexes.add(key(h));
    }
  } else {
    // RADIATING: union of radius-disks around each base, intersected with the
    // board (spec §7) — a board hex is controlled iff it lies within
    // `config.radius` (cube distance) of at least one of the player's bases.
    const radius = state.config.radius;
    for (const h of state.board.hexes) {
      if (myBases.some((base) => distance(base.hex, h) <= radius)) hexes.add(key(h));
    }
  }

  const iron = state.board.iron.filter((h) => hexes.has(key(h)));
  const factories = state.factories.filter((f) => hexes.has(key(f.hex))).map((f) => f.hex);

  return { hexes, iron, factories, perimeter };
}

/** Count of controlled resources (iron + factories) — drives the build budget. */
export function resourceCount(state: GameState, player: PlayerId): number {
  const ctl = control(state, player);
  return ctl.iron.length + ctl.factories.length;
}
