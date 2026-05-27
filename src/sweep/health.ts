// ABOUTME: Config-health gate (isHealthy) + composite rank (rankHealthy) over SweepMetrics for the balance sweep.
// ABOUTME: Pure/deterministic; gate decides if a config is "balanced", composite ranks only among passers.

import type { SweepMetrics } from "./metrics";
import type { RuleConfig } from "../engine/config";

/** Thresholds for the multi-criteria config-health gate (all inclusive bounds). */
export interface HealthThresholds {
  minMedianTurns: number;
  maxMedianTurns: number;
  maxSetupDecided: number;
  minIronVictory: number;
  maxCapHit: number;
  maxSeatBias: number;
  minLeadVolatility: number;
}

/**
 * Provisional starting thresholds. These are deliberately exposed (and passable
 * as an argument) so they can be retuned: the S4 report surfaces the full grid
 * health table, which is the basis for revising these once we see real data.
 * They are defensible starting points, NOT calibrated final values.
 */
export function defaultHealthThresholds(): HealthThresholds {
  return {
    minMedianTurns: 3,
    maxMedianTurns: 25,
    maxSetupDecided: 0.05,
    minIronVictory: 0.5,
    maxCapHit: 0.02,
    maxSeatBias: 0.2,
    minLeadVolatility: 0.2,
  };
}

/**
 * A config is healthy iff ALL criteria hold:
 * - medianTurns within [minMedianTurns, maxMedianTurns] (multi-turn but terminating),
 * - setupDecidedFraction ≤ maxSetupDecided (not decided before play),
 * - ironVictoryFraction ≥ minIronVictory (the iron condition drives games),
 * - capHitFraction ≤ maxCapHit (games terminate),
 * - seatWinBias ≤ maxSeatBias (no overwhelming seat advantage),
 * - leadVolatility ≥ minLeadVolatility (outcomes aren't fully determined early).
 *
 * `reasons` lists one short string per FAILED criterion (empty when pass).
 */
export function isHealthy(
  m: SweepMetrics,
  t: HealthThresholds = defaultHealthThresholds(),
): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (m.medianTurns < t.minMedianTurns) {
    reasons.push(`medianTurns ${m.medianTurns} below min ${t.minMedianTurns}`);
  } else if (m.medianTurns > t.maxMedianTurns) {
    reasons.push(`medianTurns ${m.medianTurns} above max ${t.maxMedianTurns}`);
  }
  if (m.setupDecidedFraction > t.maxSetupDecided) {
    reasons.push(`setupDecidedFraction ${m.setupDecidedFraction} above max ${t.maxSetupDecided}`);
  }
  if (m.ironVictoryFraction < t.minIronVictory) {
    reasons.push(`ironVictoryFraction ${m.ironVictoryFraction} below min ${t.minIronVictory}`);
  }
  if (m.capHitFraction > t.maxCapHit) {
    reasons.push(`capHitFraction ${m.capHitFraction} above max ${t.maxCapHit}`);
  }
  if (m.seatWinBias > t.maxSeatBias) {
    reasons.push(`seatWinBias ${m.seatWinBias} above max ${t.maxSeatBias}`);
  }
  if (m.leadVolatility < t.minLeadVolatility) {
    reasons.push(`leadVolatility ${m.leadVolatility} below min ${t.minLeadVolatility}`);
  }

  return { pass: reasons.length === 0, reasons };
}

/**
 * Composite health score (higher = better), defined ONLY over the gated band so
 * each term sits in ~[0,1]; the four terms are blended with equal weight. Because
 * this ranks among already-healthy configs, the weighting is low-stakes (gate
 * first, rank second).
 *
 *   score = leadVolatility            // ↑ strategic swing       (already [0,1])
 *         − seatWinBias               // ↓ seat advantage        (already [0,1])
 *         + ironVictoryFraction       // ↑ iron-driven outcomes  (already [0,1])
 *         − |medianTurns − bandCenter| / bandHalfWidth   // ↓ off-center length
 *
 * where bandCenter = midpoint of [minMedianTurns, maxMedianTurns] and
 * bandHalfWidth = half its width. For a passer medianTurns ∈ [min,max], so the
 * length penalty is in [0,1]. A degenerate band (min == max) contributes 0.
 */
function compositeScore(m: SweepMetrics, t: HealthThresholds): number {
  const bandCenter = (t.minMedianTurns + t.maxMedianTurns) / 2;
  const bandHalfWidth = (t.maxMedianTurns - t.minMedianTurns) / 2;
  const lengthPenalty =
    bandHalfWidth > 0 ? Math.abs(m.medianTurns - bandCenter) / bandHalfWidth : 0;
  return m.leadVolatility - m.seatWinBias + m.ironVictoryFraction - lengthPenalty;
}

/**
 * Filter `scored` to configs passing the health gate, then rank them by the
 * composite (best first). A failing config is NEVER returned, regardless of its
 * composite — gating bounds the arbitrariness of the composite weights.
 */
export function rankHealthy(
  scored: { config: RuleConfig; metrics: SweepMetrics }[],
  t: HealthThresholds = defaultHealthThresholds(),
): { config: RuleConfig; metrics: SweepMetrics; score: number }[] {
  return scored
    .filter((s) => isHealthy(s.metrics, t).pass)
    .map((s) => ({ config: s.config, metrics: s.metrics, score: compositeScore(s.metrics, t) }))
    .sort((a, b) => b.score - a.score);
}
