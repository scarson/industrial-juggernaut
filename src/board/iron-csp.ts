// ABOUTME: CSP placement of iron hexes — 14 by default, none in the outer two rings,
// ABOUTME: with the iron-adjacency subgraph constrained to maximum degree <= 1 (singletons/pairs only).

import { nextInt } from "../rng/pcg";
import type { RngState } from "../rng/pcg";
import { ringDepthFromEdge } from "./shape";
import { key, neighbors } from "../geometry/cube";
import type { Hex } from "../engine/types";

// Cap on re-shuffle attempts before declaring the constraints infeasible. The
// search is randomized greedy-with-restart; a generous bound prevents an
// infinite loop while never silently returning a short list.
const MAX_RESTARTS = 1000;

/**
 * Place `count` iron hexes on `board` using a seeded greedy CSP with restart.
 *
 * Constraints:
 *  - Iron only on hexes with `ringDepthFromEdge >= 2` (no iron in the outer two rings).
 *  - The iron-adjacency subgraph (distance-1 edges) is a *matching*: every node has
 *    degree <= 1, so only isolated hexes and isolated pairs are allowed — never a
 *    three-in-a-row or any larger cluster.
 *
 * Threads `rng` through every PRNG draw (Fisher–Yates swaps) and returns the
 * advanced state. Pure: no Math.random, no module-level mutable state (GEO-3).
 *
 * @throws Error if no valid placement is found within MAX_RESTARTS attempts.
 */
export function placeIron(
  rng: RngState,
  board: Hex[],
  count: number,
): { iron: Hex[]; rng: RngState } {
  // Eligible hexes are independent of randomness — compute ONCE (the property
  // test calls this 200 times, so we avoid recomputing per call where possible).
  const eligible = board.filter((h) => ringDepthFromEdge(h, board) >= 2);

  let state = rng;
  for (let attempt = 0; attempt < MAX_RESTARTS; attempt++) {
    // Fisher–Yates shuffle of a fresh copy, threading rng through every swap (GEO-3).
    const shuffled = eligible.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const draw = nextInt(state, i + 1);
      state = draw.state;
      const j = draw.value;
      // `i` and `j` are in-bounds (0 <= j <= i < length), so both reads are
      // defined; the local binds appease noUncheckedIndexedAccess without a cast.
      const a = shuffled[i] as Hex;
      const b = shuffled[j] as Hex;
      shuffled[i] = b;
      shuffled[j] = a;
    }

    const iron: Hex[] = [];
    const placed = new Set<string>(); // canonical "x,y,z" keys (GEO-4)
    const degree = new Map<string, number>(); // key -> current iron-degree (GEO-4), O(1) checks

    for (const c of shuffled) {
      // Find placed iron adjacent to candidate `c` by checking its 6 neighbors
      // against the membership set (O(1)) rather than scanning all iron.
      const adjacentKeys: string[] = [];
      for (const nb of neighbors(c)) {
        const k = key(nb);
        if (placed.has(k)) adjacentKeys.push(k);
      }

      // Matching constraint: accept iff adding `c` keeps every node's degree <= 1.
      // - 0 adjacent iron: always fine (c becomes degree 0).
      // - exactly 1 adjacent iron: fine ONLY if that neighbor currently has
      //   degree 0 (i.e. it is a singleton). Adding c makes both degree 1.
      //   If the neighbor already has degree 1, adding c would push it to 2.
      // - 2+ adjacent iron: c itself would become degree 2.
      let accept = false;
      if (adjacentKeys.length === 0) {
        accept = true;
      } else if (adjacentKeys.length === 1) {
        const only = adjacentKeys[0] as string;
        accept = (degree.get(only) ?? 0) === 0;
      }

      if (accept) {
        const ck = key(c);
        iron.push(c);
        placed.add(ck);
        // c gains degree equal to the number of adjacent iron (0 or 1); each
        // adjacent neighbor's degree increases by 1.
        degree.set(ck, adjacentKeys.length);
        for (const ak of adjacentKeys) {
          degree.set(ak, (degree.get(ak) ?? 0) + 1);
        }
        if (iron.length === count) {
          return { iron, rng: state };
        }
      }
    }
    // Full pass yielded fewer than `count`; restart with a fresh shuffle,
    // continuing to thread the PRNG state forward.
  }

  throw new Error(
    `placeIron: failed to place ${count} iron on a board of ${board.length} hexes ` +
      `(eligible: ${eligible.length}) within ${MAX_RESTARTS} restarts; ` +
      `board/count/max-degree-1 constraints may be infeasible`,
  );
}
