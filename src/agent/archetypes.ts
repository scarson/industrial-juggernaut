// ABOUTME: Archetype presets — weight vectors + softmax temperature per playstyle (spec §11, roadmap Part 1).
// ABOUTME: All presets keep a HIGH `iron` weight because controlled iron is the victory metric.

import type { Weights } from "./score";

/** The three M1 archetypes (roadmap Part 1): weight presets + temperature. */
export type Archetype = "aggressive" | "economic" | "expansionist";

export interface Preset {
  weights: Weights;
  temperature: number;
}

/**
 * Resolve an archetype name to its scoring preset. Tuning rationale:
 *  - Every preset keeps `iron` dominant (10) — iron wins games, so no archetype
 *    is ever willing to trade iron control for its flavour stat.
 *  - `aggressive`: heavy `aggr` (5) and a SHARP temperature (0.5) so it commits to
 *    high-EV attacks rather than spreading probability across builds.
 *  - `economic`: heavy `fact` (5) and a higher `fatigueCost` (0.5) so it dislikes
 *    burning bases in combat; neutral temperature (1.0).
 *  - `expansionist`: heavy `area` (5) and a modest `aggr` (2) so it attacks to grow
 *    territory but is led primarily by perimeter-area gains; neutral temperature.
 */
export function preset(a: Archetype): Preset {
  switch (a) {
    case "aggressive":
      return { weights: { iron: 10, fact: 1, area: 1, aggr: 5, fatigueCost: 0.1 }, temperature: 0.5 };
    case "economic":
      return { weights: { iron: 10, fact: 5, area: 1, aggr: 1, fatigueCost: 0.5 }, temperature: 1.0 };
    case "expansionist":
      return { weights: { iron: 10, fact: 1, area: 5, aggr: 2, fatigueCost: 0.3 }, temperature: 1.0 };
  }
}
