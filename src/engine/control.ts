// ABOUTME: Territory control — which hexes (and thus iron/factories) a player commands.
// ABOUTME: Radiating disks below 4 bases (overlaps shared); convex-hull interior at 4+ non-colinear bases (R1). Derived every call (GEO-5).

import { key } from "../geometry/cube";
import { convexHull, hexInHull, hullArea } from "../geometry/hull";
import type { GameState, Hex, PlayerId } from "./types";

const PERIMETER_BASE_COUNT = 4;

export interface Control {
  hexes: Set<string>;
  iron: Hex[];
  factories: Hex[];
}

/**
 * Hexes a player controls, plus the controlled iron and factories.
 *
 * Recomputed from the current bases every call — never cached (GEO-5). All
 * membership is keyed by the canonical "x,y,z" string (GEO-4).
 *
 * - RADIATING (<4 bases, or 4+ but degenerate/colinear hull → R3 fallback):
 *   union of `config.radius`-disks around each base. Non-exclusive; overlaps
 *   with other radiating players are shared (we do not subtract them here).
 * - PERIMETER (4+ non-colinear bases): the convex-hull interior, on-edge inside
 *   per R1.
 *
 * Iron/factories are resolved against the board state, so off-board phantom
 * hexes never contribute resources.
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
    // RADIATING: union of radius-disks around each base. The disk is the set of
    // valid lattice hexes within `config.radius` of a base; off-board hexes never
    // carry iron/factories (those are resolved against board state below), so the
    // raw disk membership is harmless and keeps a base's full reach addressable.
    const radius = state.config.radius;
    for (const base of myBases) {
      forEachInDisk(base.hex, radius, (h) => hexes.add(key(h)));
    }
  }

  const iron = state.board.iron.filter((h) => hexes.has(key(h)));
  const factories = state.factories.filter((f) => hexes.has(key(f.hex))).map((f) => f.hex);

  return { hexes, iron, factories };
}

/** Count of controlled resources (iron + factories) — drives the build budget. */
export function resourceCount(state: GameState, player: PlayerId): number {
  const ctl = control(state, player);
  return ctl.iron.length + ctl.factories.length;
}

/** Visit every valid lattice hex within `radius` (cube distance) of `center`. */
function forEachInDisk(center: Hex, radius: number, visit: (h: Hex) => void): void {
  for (let dx = -radius; dx <= radius; dx++) {
    const lo = Math.max(-radius, -dx - radius);
    const hi = Math.min(radius, -dx + radius);
    for (let dy = lo; dy <= hi; dy++) {
      const dz = -dx - dy;
      visit({ x: center.x + dx, y: center.y + dy, z: center.z + dz });
    }
  }
}
