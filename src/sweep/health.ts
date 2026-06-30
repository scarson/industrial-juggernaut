// ABOUTME: Config-health gate and composite ranker for the balance-sweep harness.
// ABOUTME: isHealthy checks SweepMetrics against thresholds; rankHealthy filters to passers and ranks best-first.

import type { SweepMetrics } from "./metrics";
import type { RuleConfig } from "../index";

// ---------------------------------------------------------------------------
// Threshold contract
// ---------------------------------------------------------------------------

/**
 * Thresholds that define a "healthy" game-config metric set.
 *
 * Each field is a scalar bound; see `defaultHealthThresholds` for documented
 * starting values and rationale for each choice.
 */
export interface HealthThresholds {
  /** Minimum acceptable median game length in turns (inclusive). */
  minMedianTurns: number;
  /** Maximum acceptable median game length in turns (inclusive). */
  maxMedianTurns: number;
  /**
   * Maximum fraction of games decided at setup (iron-victory threshold met
   * before any actions — degenerate configs score 1.0 here).
   */
  maxSetupDecided: number;
  /** Minimum fraction of games won by iron victory (not cap-hit or coalition). */
  minIronVictory: number;
  /** Maximum fraction of games that hit the turn cap (no winner from time). */
  maxCapHit: number;
  /**
   * Maximum seat-win bias: `seatWinBias.maxBiasAcrossGroups` must be at or below
   * this value. A bias of 0 means every seat wins at the expected uniform rate.
   */
  maxSeatBias: number;
  /**
   * Minimum lead volatility: fraction of games where the eventual winner was NOT
   * the turn-1 leader. Configs where the turn-1 leader always wins score 0.0 here.
   */
  minLeadVolatility: number;
}

/**
 * Documented starting values for the health thresholds.
 *
 * Calibration notes:
 *   minMedianTurns=3   — anything shorter is a degenerate immediate-win config.
 *   maxMedianTurns=25  — configs that consistently run to the cap are not fun.
 *   maxSetupDecided=0.05 — setup-decided outcomes should be rare (<5% of games).
 *   minIronVictory=0.5 — the majority of games should resolve via iron, not cap.
 *   maxCapHit=0.02     — very few games should hit the turn cap.
 *   maxSeatBias=0.20   — seat bias above 20% indicates a structural first-player advantage.
 *   minLeadVolatility=0.2 — at least 20% of games should have a comeback winner.
 */
export function defaultHealthThresholds(): HealthThresholds {
  return {
    minMedianTurns: 3,
    maxMedianTurns: 25,
    maxSetupDecided: 0.05,
    minIronVictory: 0.5,
    maxCapHit: 0.02,
    maxSeatBias: 0.20,
    minLeadVolatility: 0.2,
  };
}

// ---------------------------------------------------------------------------
// isHealthy
// ---------------------------------------------------------------------------

/** Result of a health check: pass/fail with human-readable failure reasons. */
export interface HealthResult {
  pass: boolean;
  /** Each entry describes one failed criterion, e.g. "setupDecidedFraction 0.42 > maxSetupDecided 0.05". */
  reasons: string[];
}

/**
 * Check whether a `SweepMetrics` set satisfies all health thresholds.
 *
 * Returns `{ pass: true, reasons: [] }` when ALL criteria hold.
 * Returns `{ pass: false, reasons: [...] }` listing every FAILED criterion.
 *
 * NOTE: `seatWinBias.maxBiasAcrossGroups` is compared against `maxSeatBias` —
 * the bias object is the carrier; the headline scalar is the gated value.
 */
export function isHealthy(
  m: SweepMetrics,
  thresholds: HealthThresholds = defaultHealthThresholds(),
): HealthResult {
  const reasons: string[] = [];

  if (m.medianTurns < thresholds.minMedianTurns) {
    reasons.push(
      `medianTurns ${m.medianTurns} < minMedianTurns ${thresholds.minMedianTurns}`,
    );
  }

  if (m.medianTurns > thresholds.maxMedianTurns) {
    reasons.push(
      `medianTurns ${m.medianTurns} > maxMedianTurns ${thresholds.maxMedianTurns}`,
    );
  }

  if (m.setupDecidedFraction > thresholds.maxSetupDecided) {
    reasons.push(
      `setupDecidedFraction ${m.setupDecidedFraction} > maxSetupDecided ${thresholds.maxSetupDecided}`,
    );
  }

  if (m.ironVictoryFraction < thresholds.minIronVictory) {
    reasons.push(
      `ironVictoryFraction ${m.ironVictoryFraction} < minIronVictory ${thresholds.minIronVictory}`,
    );
  }

  if (m.capHitFraction > thresholds.maxCapHit) {
    reasons.push(
      `capHitFraction ${m.capHitFraction} > maxCapHit ${thresholds.maxCapHit}`,
    );
  }

  if (m.seatWinBias.maxBiasAcrossGroups > thresholds.maxSeatBias) {
    reasons.push(
      `seatWinBias.maxBiasAcrossGroups ${m.seatWinBias.maxBiasAcrossGroups} > maxSeatBias ${thresholds.maxSeatBias}`,
    );
  }

  if (m.leadVolatility < thresholds.minLeadVolatility) {
    reasons.push(
      `leadVolatility ${m.leadVolatility} < minLeadVolatility ${thresholds.minLeadVolatility}`,
    );
  }

  return { pass: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// rankHealthy
// ---------------------------------------------------------------------------

/** A config + its metrics + its composite health score. */
export interface ScoredConfig {
  config: RuleConfig;
  metrics: SweepMetrics;
  /** Higher is better. Computed by the composite formula; see `scoreMetrics`. */
  score: number;
}

/**
 * The canonical composite-quality score for a `SweepMetrics` set (higher is
 * better). This is the SINGLE SOURCE OF TRUTH for the scoring formula — both
 * `rankHealthy` (to rank passers) and the orchestrator's nearest-miss ranking
 * (to compare failers on quality) call it, so the formula lives in exactly one
 * place and cannot drift between callers.
 *
 * Each term is normalized to a roughly [0, 1] range and equally weighted (sum 1.0):
 *
 *   score = w_vol  * (leadVolatility)                        // [0, 1] natural range
 *         + w_bias * (1 − seatWinBias.maxBiasAcrossGroups)   // inverted: lower bias = higher score
 *         + w_iron * (ironVictoryFraction)                   // [0, 1] natural range
 *         + w_turn * turnProximity                           // [0, 1] — 1 at band center, 0 at band edges
 *
 * where turnProximity = 1 − |medianTurns − bandCenter| / halfWidth
 *       bandCenter    = (minMedianTurns + maxMedianTurns) / 2
 *       halfWidth     = (maxMedianTurns − minMedianTurns) / 2
 *
 * Weights:
 *   w_vol  = 0.25  (lead volatility: upstream upsets reward replayability)
 *   w_bias = 0.25  (seat balance: structural fairness)
 *   w_iron = 0.25  (iron victory: the intended win condition should dominate)
 *   w_turn = 0.25  (game length proximity to band center: midrange is ideal)
 *
 * Degenerate band (`minMedianTurns === maxMedianTurns`, so `halfWidth === 0`)
 * yields full turnProximity (1) — there is no band to be off-center within.
 *
 * Higher leadVolatility, higher ironVictoryFraction, lower seatBias, and
 * medianTurns nearer the band center all push the score UP.
 */
export function scoreMetrics(metrics: SweepMetrics, thresholds: HealthThresholds): number {
  const bandCenter = (thresholds.minMedianTurns + thresholds.maxMedianTurns) / 2;
  const halfWidth = (thresholds.maxMedianTurns - thresholds.minMedianTurns) / 2;
  const turnProximity =
    halfWidth > 0
      ? 1 - Math.abs(metrics.medianTurns - bandCenter) / halfWidth
      : 1; // degenerate band (min === max) → full score

  return (
    0.25 * metrics.leadVolatility +
    0.25 * (1 - metrics.seatWinBias.maxBiasAcrossGroups) +
    0.25 * metrics.ironVictoryFraction +
    0.25 * turnProximity
  );
}

/**
 * Filter `scored` to configs that pass all health thresholds, then rank
 * passers best-first by their `scoreMetrics` composite score.
 *
 * Invariants guaranteed by the filter step:
 *   - Failing configs are excluded before scoring, so they can never appear in output.
 *   - The composite formula and its directional behavior are documented on `scoreMetrics`.
 */
export function rankHealthy(
  input: { config: RuleConfig; metrics: SweepMetrics }[],
  thresholds: HealthThresholds = defaultHealthThresholds(),
): ScoredConfig[] {
  // Filter to passers only.
  const passers = input.filter(({ metrics }) => isHealthy(metrics, thresholds).pass);

  // Compute composite scores via the canonical formula.
  const scored: ScoredConfig[] = passers.map(({ config, metrics }) => ({
    config,
    metrics,
    score: scoreMetrics(metrics, thresholds),
  }));

  // Sort descending (best first).
  return scored.sort((a, b) => b.score - a.score);
}
