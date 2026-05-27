// ABOUTME: Procedural board source — composes the oval landmass shape with seeded iron placement.
// ABOUTME: Pure and seed-deterministic; threads the PRNG state through so game replay is reproducible.

import { ovalHexes } from "./shape";
import { placeIron } from "./iron-csp";
import type { Board, RngState } from "../engine/types";

export interface GenerateParams {
  size: number;
  ironCount: number;
}

/**
 * Generate a board from an explicit PRNG state. The shape (`ovalHexes`) is pure
 * and the iron placement (`placeIron`) is seed-deterministic, so two calls with
 * an equal seed and params produce identical boards. Returns the advanced PRNG
 * state (from `placeIron`) so callers can keep threading it forward (GEO-3).
 */
export function generateBoard(
  rng: RngState,
  params: GenerateParams,
): { board: Board; rng: RngState } {
  const hexes = ovalHexes(params.size);
  const { iron, rng: rng2 } = placeIron(rng, hexes, params.ironCount);
  return { board: { hexes, iron }, rng: rng2 };
}
