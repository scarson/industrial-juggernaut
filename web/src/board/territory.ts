// ABOUTME: Board-wide territory fill and overlap-zone derivation, built on top of controlOf().
// ABOUTME: Radiating disks and perimeter hulls both fall out of Control.hexes; no hull math lives here.
import { controlOf } from "../engine-client/selectors";
import type { GameState, PlayerId } from "../engine-client/barrel";

/**
 * For every board hex controlled by at least one non-eliminated player, the list
 * of controlling `PlayerId`s in ascending id order, keyed by canonical `hexKey`
 * (GEO-4). Hexes no player controls are omitted rather than mapped to an empty
 * array.
 *
 * Ascending order falls out of iterating `state.players` array order without an
 * explicit sort: `state.players[i].id === i` is an engine-wide invariant (e.g.
 * `control.ts` itself indexes `state.players[player]!` directly), so a single
 * forward pass already yields ids 0, 1, 2, ... for each hex's controllers.
 *
 * A `Map<string, PlayerId[]>` (not `Set<PlayerId>`) because the board's fill
 * renderer wants a stable, ordered list per hex — a single controller paints a
 * solid fill; multiple controllers (an overlap zone) paint a split/blended fill
 * by iterating the list in a deterministic order.
 *
 * Both control regimes (radiating disk below 4 bases, perimeter hull at 4+
 * non-colinear bases) fall out of `controlOf(state, p).hexes` automatically —
 * this function never computes a hull itself.
 */
export function territoryFills(state: GameState): Map<string, PlayerId[]> {
  const fills = new Map<string, PlayerId[]>();
  for (const p of state.players) {
    if (p.eliminated) continue;
    for (const key of controlOf(state, p.id).hexes) {
      let controllers = fills.get(key);
      if (controllers === undefined) {
        controllers = [];
        fills.set(key, controllers);
      }
      controllers.push(p.id);
    }
  }
  return fills;
}

/** Canonical `hexKey`s controlled by two or more players — derived from `territoryFills`. */
export function overlapZones(state: GameState): Set<string> {
  const zones = new Set<string>();
  for (const [key, controllers] of territoryFills(state)) {
    if (controllers.length >= 2) zones.add(key);
  }
  return zones;
}
