// ABOUTME: Per-hex tooltip content — control, iron membership, and base/factory occupancy — for
// ABOUTME: the hex the pointer is currently hovering, built on controlOf() and board.iron/bases/factories.
import { controlOf } from "../engine-client/selectors";
import { hexKey } from "./projection";
import type { GameState, Hex, PlayerId } from "../engine-client/barrel";

export type TooltipData = {
  /**
   * The controlling player, or `null` if no non-eliminated player controls this hex.
   *
   * Contested hexes (an overlap zone controlled by 2+ players) report the LOWEST `PlayerId` —
   * the same ascending order `territoryFills` already produces by iterating `state.players` in
   * id order (GEO-8-safe: it reads `controlOf`'s output rather than re-deriving control). The
   * type is `PlayerId | null`, not `PlayerId[] | null` — a tooltip shows one owner line, so a
   * deterministic single winner beats a variable-length list the caller would have to render
   * specially. Lowest-id is arbitrary but consistent with the codebase's existing ordering
   * convention, and is documented here as that convention rather than left implicit.
   */
  controlledBy: PlayerId | null;
  /** Whether this hex is one of `board.iron`'s deposits. */
  isIron: boolean;
  /**
   * What's built on this hex, or `null` if empty.
   *
   * The engine's build-legality checks (`src/engine/build.ts`'s `occupied()`, shared by
   * `isLegalBasePlacement` and `isLegalFactoryPlacement`) reject placing a base OR a factory on
   * a hex that already holds either — so a base and a factory can never legally cohabit a hex.
   * A base is checked first purely as a defensive tie-break for a structurally-overridden state
   * (e.g. a test fixture), matching `Board.tsx`'s paint order (bases render on top of factories);
   * this branch is unreachable via any sequence of legal engine actions.
   */
  occupant: "base" | "factory" | null;
};

/** Tooltip content for a single hex, given the current game state. */
export function tooltipData(state: GameState, hex: Hex): TooltipData {
  const key = hexKey(hex);

  let controlledBy: PlayerId | null = null;
  for (const p of state.players) {
    if (p.eliminated) continue;
    if (controlOf(state, p.id).hexes.has(key)) {
      if (controlledBy === null || p.id < controlledBy) controlledBy = p.id;
    }
  }

  const isIron = state.board.iron.some((i) => hexKey(i) === key);

  let occupant: "base" | "factory" | null = null;
  if (state.bases.some((b) => hexKey(b.hex) === key)) {
    occupant = "base";
  } else if (state.factories.some((f) => hexKey(f.hex) === key)) {
    occupant = "factory";
  }

  return { controlledBy, isIron, occupant };
}
