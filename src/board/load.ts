// ABOUTME: Fixed board source — validates a serializable BoardDefinition and yields a Board value.
// ABOUTME: Pure; lets a canonical/digitized board be supplied without code changes (spec §6).

import { key } from "../geometry/cube";
import type { Board, BoardDefinition } from "../engine/types";

/**
 * Build a `Board` from an explicit definition, validating its invariants:
 *  1. every hex satisfies the cube constraint x + y + z === 0;
 *  2. no duplicate hexes (by canonical key, GEO-4);
 *  3. every iron hex is a member of `def.hexes` (by key);
 *  4. no duplicate iron.
 * Throws `Error` with a descriptive message on any violation. The returned
 * arrays are shallow copies so the caller cannot mutate the definition through
 * the board (or vice versa).
 */
export function loadBoard(def: BoardDefinition): Board {
  const hexKeys = new Set<string>();
  for (const h of def.hexes) {
    if (h.x + h.y + h.z !== 0) {
      throw new Error(
        `loadBoard: hex (${h.x},${h.y},${h.z}) violates the cube invariant x+y+z===0`,
      );
    }
    const k = key(h);
    if (hexKeys.has(k)) {
      throw new Error(`loadBoard: duplicate hex ${k} in def.hexes`);
    }
    hexKeys.add(k);
  }

  const ironKeys = new Set<string>();
  for (const ir of def.iron) {
    const k = key(ir);
    if (!hexKeys.has(k)) {
      throw new Error(`loadBoard: iron hex ${k} is not a member of def.hexes`);
    }
    if (ironKeys.has(k)) {
      throw new Error(`loadBoard: duplicate iron hex ${k} in def.iron`);
    }
    ironKeys.add(k);
  }

  return { hexes: def.hexes.slice(), iron: def.iron.slice() };
}
