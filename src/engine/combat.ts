// ABOUTME: Closed-form Bernoulli combat resolution — one PRNG draw against the rules win-table.
// ABOUTME: Pure: threads RngState through; commit 6 auto-wins without consuming the PRNG; Phase 4 watchtower +1 defense.

import { nextFloat, type RngState } from "../rng/pcg";
import type { RuleConfig } from "./config";
import type { BaseType } from "./types";

/**
 * Attacker's win probability against a base of the given defender type.
 *
 * Tactical Depth Phase 4 — watchtower defense:
 *   When `baseTypesEnabled` and the defender's base type is "watchtower", the
 *   attacker's effective commit for table lookup is `commit - 1` (the plan's
 *   "+1 defense, combat-table effectively −1 attacker for kills"). For
 *   `commit=3` against a watchtower, the lookup would fall below the table's
 *   minimum index (3), so we use a synthetic 0.5 floor. `autoWinAt6` is
 *   suppressed against watchtowers (commit=6 vs WT → table[5] = 0.889, not 1.0).
 *
 * When the flag is off, the defender type is ignored and the probability is
 * `config.combatTable[commit]` — bit-for-bit identical to pre-Phase-4 behavior.
 */
export function attackWinProbability(
  config: RuleConfig,
  commit: 3 | 4 | 5 | 6,
  defenderType: BaseType = "forge",
): number {
  const watchtower = config.baseTypesEnabled && defenderType === "watchtower";
  if (commit === 6 && config.autoWinAt6 && !watchtower) return 1;
  if (!watchtower) return config.combatTable[commit];
  // Watchtower-defended branch: effective commit = commit - 1.
  if (commit === 3) return 0.5; // synthetic floor below the table's range.
  const effective = (commit - 1) as 3 | 4 | 5;
  return config.combatTable[effective];
}

export function resolveCombat(
  rng: RngState,
  commit: 3 | 4 | 5 | 6,
  config: RuleConfig,
  defenderType: BaseType = "forge",
): { attackerWon: boolean; state: RngState } {
  const p = attackWinProbability(config, commit, defenderType);
  if (p >= 1) return { attackerWon: true, state: rng }; // deterministic — no PRNG consumption
  const { value, state } = nextFloat(rng);
  return { attackerWon: value < p, state };
}
