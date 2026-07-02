// ABOUTME: Sweep orchestrator — findBalancedConfig selects the top healthy config from a grid, balanceSweep runs OFAT around the balanced baseline.
// ABOUTME: report() is a pure markdown string builder; no I/O — the caller writes it to disk.

import { rankHealthy, isHealthy, defaultHealthThresholds, scoreMetrics } from "./health";
import type { HealthThresholds, HealthResult, ScoredConfig } from "./health";
import { sweepOFAT } from "./run";
import type { NumericRuleConfigKey, RunConfigOpts } from "./run";
import type { SweepMetrics } from "./metrics";
import type { RuleConfig } from "../engine/config";


// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * One entry in the full grid table — every config that was swept, whether it
 * passed or failed the health gate. Used in `findBalancedConfig`'s return value
 * (both the full `gridTable` and the `nearestMisses` subset) and in the report.
 */
export interface GridEntry {
  config: RuleConfig;
  metrics: SweepMetrics;
  /** The result of `isHealthy(metrics, thresholds)` for this entry. */
  health: HealthResult;
}

/** Return value of `findBalancedConfig`. */
export interface FindResult {
  /**
   * The top-ranked passing config, or `null` if no config in the grid passes
   * all health thresholds. When `null`, see `nearestMisses` for the closest
   * failers.
   */
  recommended: ScoredConfig | null;

  /**
   * All passing configs, ranked best-first by the composite health score.
   * Empty when `recommended === null`.
   */
  ranked: ScoredConfig[];

  /**
   * Every config that was swept — passers and failers — each annotated with
   * its `HealthResult`. Use this to render the full grid health table.
   */
  gridTable: GridEntry[];

  /**
   * Present only when `recommended === null`. The top-N failers ranked by how
   * close they are to passing:
   *
   *   Primary sort: ascending `health.reasons.length` (fewest failing criteria
   *   first — "closest" means failing the least number of gates).
   *
   *   Tie-break: descending composite score (the canonical `scoreMetrics`
   *   formula, applied WITHOUT the health-gate filter so failers can be ranked
   *   on quality too — a failer with a higher composite score is "closer" to
   *   the quality a passer would have).
   *
   * At most `NEAREST_MISSES_COUNT` entries are returned. Entries are the same
   * `GridEntry` objects that appear in `gridTable`.
   */
  nearestMisses?: GridEntry[];
}

/** Per-axis result of `balanceSweep`. */
export type BalanceResult = Partial<Record<NumericRuleConfigKey, { value: number; metrics: SweepMetrics }[]>>;

/** Options for `findBalancedConfig`. */
export interface FindOptions {
  /** Health thresholds to apply; defaults to `defaultHealthThresholds()`. */
  thresholds?: HealthThresholds;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of nearest-miss entries to surface when no config passes. */
export const NEAREST_MISSES_COUNT = 5;

// ---------------------------------------------------------------------------
// findBalancedConfig
// ---------------------------------------------------------------------------

/**
 * Select the best balanced config from a pre-computed sweep grid.
 *
 * 1. Annotates every grid entry with its `HealthResult` (pass/fail + reasons).
 * 2. Calls `rankHealthy` to filter to passers and rank best-first.
 * 3. When at least one passer exists: `recommended` = top passer; `ranked` = all passers; no `nearestMisses`.
 * 4. When no passers exist: `recommended = null`; `ranked = []`; `nearestMisses` = top-N
 *    failers ranked by (ascending reasons.length, descending `scoreMetrics`).
 *
 * This is pure SELECTION over an already-computed grid: it never runs games and
 * never applies a `fixed` overlay — `fixed` is applied upstream at the
 * `sweepGrid` call that produced `grid`.
 *
 * @param grid  The output of `sweepGrid` — `{ config, metrics }[]`.
 * @param opts  Optional thresholds override.
 */
export function findBalancedConfig(
  grid: { config: RuleConfig; metrics: SweepMetrics }[],
  opts: FindOptions = {},
): FindResult {
  const thresholds = opts.thresholds;

  // Build the full grid table — annotate every entry with its health result.
  const gridTable: GridEntry[] = grid.map(({ config, metrics }) => ({
    config,
    metrics,
    health: isHealthy(metrics, thresholds),
  }));

  // Filter to passers and rank best-first.
  const ranked: ScoredConfig[] = rankHealthy(grid, thresholds);

  if (ranked.length > 0) {
    return {
      recommended: ranked[0]!,
      ranked,
      gridTable,
    };
  }

  // No passers — compute nearest-misses.
  if (gridTable.length === 0) {
    return {
      recommended: null,
      ranked: [],
      gridTable: [],
    };
  }

  // Resolve thresholds for composite score computation (mirrors rankHealthy's default).
  const resolvedThresholds = thresholds ?? defaultHealthThresholds();

  // Rank failers: ascending reasons.length (fewest failures = closest to passing),
  // tie-broken descending by composite score (higher = better quality, closer to passing).
  // Entries are the same GridEntry objects from gridTable; the score is used only
  // for ordering, not stored on the returned entries.
  const nearestMisses: GridEntry[] = gridTable
    .filter((e) => !e.health.pass)
    .sort((a, b) => {
      const reasonDiff = a.health.reasons.length - b.health.reasons.length;
      if (reasonDiff !== 0) return reasonDiff;
      return (
        scoreMetrics(b.metrics, resolvedThresholds) -
        scoreMetrics(a.metrics, resolvedThresholds)
      ); // descending score as tie-break
    })
    .slice(0, NEAREST_MISSES_COUNT);

  return {
    recommended: null,
    ranked: [],
    gridTable,
    nearestMisses,
  };
}

// ---------------------------------------------------------------------------
// balanceSweep
// ---------------------------------------------------------------------------

/**
 * One-factor-at-a-time balance sweep around a balanced `baseline` config.
 *
 * For each axis in `axes`, varies `valuesPerAxis[axis]` while holding all other
 * fields at `baseline`, and returns the per-value metrics. Axes with no entry
 * or an empty array in `valuesPerAxis` are skipped (consistent with S3's
 * empty-values documented behavior: `sweepOFAT` returns `[]` for empty values,
 * and we omit the key entirely when there are no values to sweep).
 *
 * @param baseline      The starting config (typically the recommended balanced config).
 * @param axes          Which axes to sweep (ordered list of `NumericRuleConfigKey`).
 * @param valuesPerAxis Values to test per axis.
 * @param opts          Run options (games, turnCap, baseSeed, …).
 * @returns             A partial record keyed by axis; each value is `{ value, metrics }[]`.
 */
export function balanceSweep(
  baseline: RuleConfig,
  axes: NumericRuleConfigKey[],
  valuesPerAxis: Partial<Record<NumericRuleConfigKey, number[]>>,
  opts: RunConfigOpts,
): BalanceResult {
  const result: BalanceResult = {};

  for (const axis of axes) {
    const values = valuesPerAxis[axis];
    if (values === undefined || values.length === 0) {
      // Skip axes with no values — consistent with S3's empty-values behavior.
      continue;
    }
    const entries = sweepOFAT(baseline, axis, values, opts);
    (result as Record<string, unknown>)[axis] = entries;
  }

  return result;
}
