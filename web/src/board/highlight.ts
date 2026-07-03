// ABOUTME: The HighlightSets type — the three canonical-hexKey sets the board renders as cell
// ABOUTME: treatments (build / attack / placement). P1.5 adds the highlightSets() function here.

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
