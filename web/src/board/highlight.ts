// ABOUTME: The HighlightSets type and highlightSets() — the three canonical-hexKey sets the
// ABOUTME: board renders as cell treatments (build / attack / placement).
import { legalActions, legalFirstBaseHexes } from "../engine-client/barrel";
import type { GameState } from "../engine-client/barrel";
import { hexKey } from "./projection";

/**
 * The hexes the board should decorate for the active composer, as canonical `hexKey`s
 * (see projection.ts — `"x,y,z"`). Each set is an independent channel the board renders
 * as a distinct cell treatment:
 *
 * - `buildHexes` — where the current player may place a factory/base this round.
 * - `attackTargets` — enemy-held hexes that are legal attack targets.
 * - `placementHexes` — legal first-base hexes during setup.
 *
 * P1 renders these; the `highlightSets(state, ...)` function that computes them lands in
 * this same file in P1.5, so Board.tsx can depend on the type now.
 */
export type HighlightSets = {
  buildHexes: Set<string>;
  attackTargets: Set<string>;
  placementHexes: Set<string>;
};

/**
 * The hexes to highlight for `state`'s active composer.
 *
 * During setup (`phase.turn === 0`) only `placementHexes` is populated, from
 * `legalFirstBaseHexes`. `legalActions` is not called in setup: with zero bases on
 * the board it can enumerate no build or attack action (see `buildBudget` — it
 * requires at least one controlled iron or factory), so it falls through to its
 * stuck-player fallback and returns `[{kind: "pass"}]`. Calling it would be a
 * wasted traversal of every board hex for a result this function ignores anyway.
 *
 * In the play phase, `buildHexes`/`attackTargets` are every hex that appears in
 * some action `legalActions(state)` enumerates: build actions contribute their
 * pieces' hexes, attack actions contribute their declarations' `target`, and
 * `pass` contributes nothing. `legalActions` enumerates representatives (e.g. one
 * attack per target per commitment level) rather than every combination, but a
 * representative's hexes are exactly the hexes the UI should offer as legal —
 * the composer refines commitment/attacker choices from there.
 *
 * `legalActions` acts for `currentPlayer(state)` (the seat whose turn it is), so
 * the highlighted hexes always belong to the acting seat, not necessarily seat 0.
 */
export function highlightSets(state: GameState): HighlightSets {
  const buildHexes = new Set<string>();
  const attackTargets = new Set<string>();
  const placementHexes = new Set<string>();

  if (state.phase.turn === 0) {
    for (const hex of legalFirstBaseHexes(state)) placementHexes.add(hexKey(hex));
    return { buildHexes, attackTargets, placementHexes };
  }

  for (const action of legalActions(state)) {
    if (action.kind === "build") {
      for (const piece of action.pieces) buildHexes.add(hexKey(piece.hex));
    } else if (action.kind === "attack") {
      for (const decl of action.attacks) attackTargets.add(hexKey(decl.target));
    }
  }

  return { buildHexes, attackTargets, placementHexes };
}
