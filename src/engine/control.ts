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
    //
    // The membership test is the same `distance(base, h) <= radius` as the
    // disk union; we inline it over a manual loop (no per-hex closure) and
    // compare twice the L1 component sum against `2*radius` so the cube
    // distance never divides. Identical result, fewer allocations per hex.
    const reach2 = state.config.radius * 2;
    const baseCount = myBases.length;
    for (const h of state.board.hexes) {
      for (let i = 0; i < baseCount; i++) {
        const b = myBases[i]!.hex;
        if (Math.abs(b.x - h.x) + Math.abs(b.y - h.y) + Math.abs(b.z - h.z) <= reach2) {
          hexes.add(key(h));
          break;
        }
      }
    }
  }

  let iron = state.board.iron.filter((h) => hexes.has(key(h)));
  let factories = state.factories.filter((f) => hexes.has(key(f.hex))).map((f) => f.hex);

  // EXCLUSIVITY (DER #17): a RADIATING player does not command resources that sit
  // inside a non-ally opponent's valid perimeter — the perimeter claims its interior
  // iron/factories ("no longer available to adjacent radiating players", rules v10).
  // Perimetered players keep their whole hull interior; ally perimeters never subtract
  // (the coalition keeps the resource via the ally — coalitionIron unions). Only the
  // resource lists shrink; `hexes` (territory/reach) is unchanged. Recomputed every
  // call, never cached (GEO-5) — this just reads other players' bases.
  if (!perimeter) {
    const allies = state.players[player]!.alliance;
    const oppHulls: Hex[][] = [];
    for (const q of state.players) {
      if (q.eliminated || allies.includes(q.id)) continue;
      const qBases = state.bases.filter((b) => b.owner === q.id);
      if (qBases.length < PERIMETER_BASE_COUNT) continue;
      const qHull = convexHull(qBases.map((b) => b.hex));
      if (hullArea(qHull) > 0) oppHulls.push(qHull);
    }
    if (oppHulls.length > 0) {
      iron = iron.filter((h) => !oppHulls.some((hl) => hexInHull(h, hl)));
      factories = factories.filter((h) => !oppHulls.some((hl) => hexInHull(h, hl)));
    }
  }

  return { hexes, iron, factories };
}

/** Count of controlled resources (iron + factories) — drives the build budget. */
export function resourceCount(state: GameState, player: PlayerId): number {
  const ctl = control(state, player);
  return ctl.iron.length + ctl.factories.length;
}
