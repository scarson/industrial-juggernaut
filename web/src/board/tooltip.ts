// ABOUTME: Per-hex tooltip content — control, iron membership, and base/factory occupancy — for
// ABOUTME: the hex the pointer is currently hovering, built on territoryFills() and board.iron/bases/factories.
import { territoryFills } from "./territory";
import { hexKey } from "./projection";
import type { GameState, Hex, PlayerId } from "../engine-client/barrel";

export type TooltipData = {
  /**
   * The controlling player, or `null` if no non-eliminated player controls this hex.
   *
   * Contested hexes (an overlap zone controlled by 2+ players) report the LOWEST `PlayerId` —
   * the first entry of `territoryFills`' ascending controller list (GEO-8-safe: it reads
   * `controlOf`'s output rather than re-deriving control). The type is `PlayerId | null`, not
   * `PlayerId[] | null` — a tooltip shows one owner line, so a deterministic single winner
   * beats a variable-length list the caller would have to render specially. Display copy that
   * wants to say "contested" should consult `overlapZones(state)` / `territoryFills(state)`
   * alongside this field rather than growing this shape with a redundant flag.
   */
  controlledBy: PlayerId | null;
  /** Whether this hex is one of `board.iron`'s deposits. */
  isIron: boolean;
  /**
   * What's built on this hex, or `null` if empty.
   *
   * A base and a factory can never legally cohabit a hex: the build paths share
   * `src/engine/build.ts`'s `occupied()` (rejecting either piece on a hex holding either), and
   * the non-build mutation paths preserve the invariant too — setup's `placeFirstBase` runs
   * before any factory exists, and combat's base replacement reuses a hex that held a base.
   * A base is checked first purely as a defensive tie-break for a structurally-overridden state
   * (e.g. a test fixture), matching `Board.tsx`'s paint order (bases render on top of factories);
   * this branch is unreachable via any sequence of legal engine actions.
   */
  occupant: "base" | "factory" | null;
};

/** Tooltip content for a single hex, given the current game state. */
export function tooltipData(state: GameState, hex: Hex): TooltipData {
  const key = hexKey(hex);

  // territoryFills already computes (and memoizes, GEO-5) the ascending controller
  // list per hex — its first entry IS the lowest-id controller.
  const controlledBy: PlayerId | null = territoryFills(state).get(key)?.[0] ?? null;

  const isIron = state.board.iron.some((i) => hexKey(i) === key);

  let occupant: "base" | "factory" | null = null;
  if (state.bases.some((b) => hexKey(b.hex) === key)) {
    occupant = "base";
  } else if (state.factories.some((f) => hexKey(f.hex) === key)) {
    occupant = "factory";
  }

  return { controlledBy, isIron, occupant };
}
