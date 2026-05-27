// ABOUTME: Perimeter reassessment — opponent-perimeter sight blockers, stranded-base detection, and encircled-base removal.
// ABOUTME: Pure; recomputed from current bases every call (GEO-5), all hex membership keyed by canonical "x,y,z" strings (GEO-4).

import { key, neighbors } from "../geometry/cube";
import { convexHull, hexInHull, hullArea } from "../geometry/hull";
import { segmentBlocked } from "../geometry/sightline";
import type { Base, GameEvent, GameState, PlayerId } from "./types";

const PERIMETER_BASE_COUNT = 4;
const MIN_PERIMETER_BASES = 3;
const MIN_FRIENDLY_VISIBILITY = 2;

// A player is an OPPONENT of `player` iff it is not listed in `player`'s alliance.
function isOpponent(state: GameState, player: PlayerId, other: PlayerId): boolean {
  if (other === player) return false;
  const me = state.players.find((p) => p.id === player);
  const alliance = me?.alliance ?? [player];
  return !alliance.includes(other);
}

/**
 * The set of `key()` of all board hexes inside any OPPONENT's valid perimeter.
 *
 * An opponent here is a player not in `player`'s alliance that has a valid
 * perimeter: `>= 4` bases AND a non-degenerate hull (`hullArea > 0`). For each
 * such opponent, every board hex `h` with `hexInHull(h, theirHull)` is added.
 * This is the M1 "opponent perimeter hexes" sight-line blocker approximation,
 * consistent with `control` (Task 5.1). Recomputed each call (GEO-5).
 */
export function opponentPerimeterBlockers(state: GameState, player: PlayerId): Set<string> {
  const blockers = new Set<string>();

  for (const opp of state.players) {
    if (!isOpponent(state, player, opp.id)) continue;

    const oppBases = state.bases.filter((b) => b.owner === opp.id);
    if (oppBases.length < PERIMETER_BASE_COUNT) continue;

    const hull = convexHull(oppBases.map((b) => b.hex));
    if (hullArea(hull) <= 0) continue; // degenerate / colinear -> no perimeter

    for (const h of state.board.hexes) {
      if (hexInHull(h, hull)) blockers.add(key(h));
    }
  }

  return blockers;
}

/**
 * The `player`'s bases that are STRANDED.
 *
 * Builds the friendly-base VISIBILITY GRAPH: nodes are `player`'s bases, and an
 * edge connects b1,b2 iff `segmentBlocked(b1.hex, b2.hex, blockers)` is false
 * (they see each other without crossing an opponent perimeter). A base is
 * stranded iff its degree in this graph is `< 2` (it encloses no territory / is
 * not part of the perimeter).
 *
 * With fewer than 3 bases the perimeter concept is moot (the player is still
 * radiating), so `[]` is returned. At exactly 3 bases the degree-<2 rule applies
 * normally. Pure; recomputed from bases each call (GEO-5).
 */
export function strandedBases(state: GameState, player: PlayerId): Base[] {
  const myBases = state.bases.filter((b) => b.owner === player);
  if (myBases.length < MIN_PERIMETER_BASES) return [];

  const blockers = opponentPerimeterBlockers(state, player);

  const degree = new Array<number>(myBases.length).fill(0);
  for (let i = 0; i < myBases.length; i++) {
    for (let j = i + 1; j < myBases.length; j++) {
      if (!segmentBlocked(myBases[i]!.hex, myBases[j]!.hex, blockers)) {
        degree[i]!++;
        degree[j]!++;
      }
    }
  }

  return myBases.filter((_, i) => degree[i]! < MIN_FRIENDLY_VISIBILITY);
}

/**
 * Remove every stranded base that is FULLY ENCIRCLED, returning a new state and
 * the resulting `baseDestroyed` events.
 *
 * A stranded base is fully encircled iff each of its six neighbours is EITHER
 * off-board (not in `state.board.hexes`) OR occupied by a base owned by a player
 * not in the stranded base's owner's alliance (an opponent base). The board edge
 * counts as a wall — the rules leave "fully encircle" unspecified at the edge, so
 * per the plan's R5 note an off-board neighbour is treated as enclosing.
 *
 * Removed bases are destroyed (taken off the board); `basesInHand` is unchanged.
 * Pure: a NEW state is returned and the input is never mutated. If nothing
 * qualifies, `{ state, events: [] }` is returned. "Rescue" is implicit — once a
 * later base grants two-base visibility, the base is no longer stranded and so is
 * never considered here.
 */
export function removeEncircledStrandedBases(state: GameState): { state: GameState; events: GameEvent[] } {
  const onBoard = new Set(state.board.hexes.map(key));

  // Map every occupied hex to its owner, so we can test neighbour ownership.
  const ownerAt = new Map<string, PlayerId>();
  for (const b of state.bases) ownerAt.set(key(b.hex), b.owner);

  const allianceOf = (player: PlayerId): PlayerId[] =>
    state.players.find((p) => p.id === player)?.alliance ?? [player];

  const toRemove = new Set<string>();
  const events: GameEvent[] = [];

  for (const player of state.players) {
    const stranded = strandedBases(state, player.id);
    if (stranded.length === 0) continue;

    const alliance = allianceOf(player.id);

    for (const base of stranded) {
      const encircled = neighbors(base.hex).every((n) => {
        const nk = key(n);
        if (!onBoard.has(nk)) return true; // board edge counts as a wall
        const occupant = ownerAt.get(nk);
        if (occupant === undefined) return false; // empty neighbour -> not encircled
        return !alliance.includes(occupant); // opponent base encloses; own/ally does not
      });

      if (encircled && !toRemove.has(key(base.hex))) {
        toRemove.add(key(base.hex));
        events.push({ kind: "baseDestroyed", hex: base.hex, owner: base.owner });
      }
    }
  }

  if (toRemove.size === 0) return { state, events: [] };

  const nextState: GameState = {
    ...state,
    bases: state.bases.filter((b) => !toRemove.has(key(b.hex))),
  };

  return { state: nextState, events };
}
