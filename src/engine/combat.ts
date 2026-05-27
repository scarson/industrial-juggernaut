// ABOUTME: Closed-form Bernoulli combat resolution — one PRNG draw against the rules win-table.
// ABOUTME: Pure: threads RngState through; commit 6 auto-wins without consuming the PRNG.

import { nextFloat, type RngState } from "../rng/pcg";
import type { RuleConfig } from "./config";

export function resolveCombat(
  rng: RngState,
  commit: 3 | 4 | 5 | 6,
  config: RuleConfig,
): { attackerWon: boolean; state: RngState } {
  if (commit === 6 && config.autoWinAt6) {
    return { attackerWon: true, state: rng };
  }
  const { value, state } = nextFloat(rng);
  return { attackerWon: value < config.combatTable[commit], state };
}
