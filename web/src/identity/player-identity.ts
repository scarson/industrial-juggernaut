// ABOUTME: Maps a player id (0-5) to its CVD-safe identity — color, shape, and pattern are
// ABOUTME: three independently-readable channels so no player relies on color alone.
// Type-only import: erased at build, so this cannot pull engine runtime code into the
// client bundle (see docs/pitfalls and the P0 plan's engine-import discipline).
import type { PlayerId } from "../../../src/index";
import { color, playerColors } from "../design/tokens";

/**
 * The 6-set of shapes assigned to players, positionally stable with `playerColors`
 * (index 0 = oxide, 1 = cobalt, 2 = violet, 3 = gold, 4 = steel, 5 = forest — see
 * design/tokens.ts). id 0 (oxide) = circle is pinned by the plan.
 *
 * ids 1 (cobalt) and 2 (violet) are the CVD floor pair: cobalt × violet collapses to
 * ΔE76 ≈ 9.4 under deuteranopia — barely above the 9.0 separability gate (see
 * cvd-check.test.ts). For that pair, shape CARRIES the identity distinction rather than
 * merely reinforcing it, so cobalt and violet hold hard-edged, orientation-distinct
 * shapes (square vs triangle) instead of two round-ish shapes (circle/pentagon/six-point)
 * that blur together at hex-token size.
 */
export const PLAYER_SHAPES = [
  "circle", // 0 oxide
  "square", // 1 cobalt — CVD floor pair, hard-edged
  "triangle", // 2 violet — CVD floor pair, hard-edged
  "diamond", // 3 gold
  "pentagon", // 4 steel
  "six-point", // 5 forest
] as const;

export type PlayerShape = (typeof PLAYER_SHAPES)[number];

/** The 6-set of fill patterns — a third redundant channel alongside color and shape. */
export const PLAYER_PATTERNS = ["solid", "ring", "dots", "hatch", "cross", "checker"] as const;

export type PlayerPattern = (typeof PLAYER_PATTERNS)[number];

export interface PlayerIdentity {
  readonly colorVar: string;
  readonly shape: PlayerShape;
  readonly pattern: PlayerPattern;
}

const PLAYER_COLOR_NAMES = ["oxide", "cobalt", "violet", "gold", "steel", "forest"] as const;

const MIN_PLAYER_ID = 0;
const MAX_PLAYER_ID = 5;

/**
 * Returns the CVD-safe identity (color, shape, pattern) for a player id. Total over the
 * game's supported id range (0-5, i.e. 2-6 players); throws for anything else since a 7th
 * identity is a caller bug, not a runtime condition to degrade gracefully from.
 */
export function playerIdentity(id: PlayerId): PlayerIdentity {
  if (!Number.isInteger(id) || id < MIN_PLAYER_ID || id > MAX_PLAYER_ID) {
    throw new Error(
      `playerIdentity: id must be an integer in [0, 5] (2-6 players); got ${id}`,
    );
  }

  return {
    colorVar: color(PLAYER_COLOR_NAMES[id]!),
    shape: PLAYER_SHAPES[id]!,
    pattern: PLAYER_PATTERNS[id]!,
  };
}

// Sanity-checks the lookup tables agree in length with the id-space at module load —
// guards against a future edit that grows one table without the others. The shape and
// pattern assignments read the exported PLAYER_SHAPES/PLAYER_PATTERNS directly, so
// assignment-vs-export desync is impossible by construction.
if (
  playerColors.length !== PLAYER_SHAPES.length ||
  playerColors.length !== PLAYER_PATTERNS.length ||
  playerColors.length !== PLAYER_COLOR_NAMES.length
) {
  throw new Error("player-identity: color/shape/pattern/name tables must be the same length");
}
