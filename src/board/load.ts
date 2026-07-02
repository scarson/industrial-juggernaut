// ABOUTME: Fixed board source — validates a serializable BoardDefinition and yields a Board value.
// ABOUTME: Pure; lets a canonical/digitized board be supplied without code changes (spec §6).

import { key } from "../geometry/cube";
import type { Board, BoardDefinition, Hex } from "../engine/types";

// Fixed boards aren't size-bounded the way generateBoard's oval sizing is (src/board/shape.ts
// grows A/B from the requested `size`); the largest board actually served today is the DO-host
// create surface's size-300 oval, whose extent stays well inside 1024. 1024 is a generous but
// finite ceiling that keeps key()'s string canonicalization and distance()'s arithmetic
// well-behaved for any coordinate a fixed board could legitimately need.
const MAX_BOARD_COORD = 1024;

/**
 * Build a `Board` from an explicit definition, validating its invariants:
 *  1. every hex coordinate (x, y, z) is an integer within [-MAX_BOARD_COORD, MAX_BOARD_COORD];
 *  2. every hex satisfies the cube constraint x + y + z === 0;
 *  3. no duplicate hexes (by canonical key, GEO-4);
 *  4. every iron hex is a member of `def.hexes` (by key);
 *  5. no duplicate iron.
 * Throws `Error` with a descriptive message on any violation. The returned
 * arrays are shallow copies so the caller cannot mutate the definition through
 * the board (or vice versa).
 */
export function loadBoard(def: BoardDefinition): Board {
  const checkCoords = (h: Hex, source: "def.hexes" | "def.iron"): void => {
    for (const [name, v] of [
      ["x", h.x],
      ["y", h.y],
      ["z", h.z],
    ] as const) {
      if (!Number.isInteger(v)) {
        throw new Error(
          `loadBoard: hex (${h.x},${h.y},${h.z}) in ${source} has non-integer coordinate ${name}=${v}`,
        );
      }
      if (Math.abs(v) > MAX_BOARD_COORD) {
        throw new Error(
          `loadBoard: hex (${h.x},${h.y},${h.z}) in ${source} has coordinate ${name}=${v} exceeding MAX_BOARD_COORD=${MAX_BOARD_COORD}`,
        );
      }
    }
  };

  const hexKeys = new Set<string>();
  for (const h of def.hexes) {
    checkCoords(h, "def.hexes");
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
    checkCoords(ir, "def.iron");
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
