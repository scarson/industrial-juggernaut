// ABOUTME: Sweep orchestrator — findBalancedConfig searches a geometry grid (gate+rank), balanceSweep runs OFAT per axis.
// ABOUTME: Guards infeasible geometry (iron-CSP) per config so one bad combo can't abort the whole sweep.

import { runConfig, sweepOFAT, type RunConfigOptions } from "./run";
import { rankHealthy, isHealthy, defaultHealthThresholds, type HealthThresholds } from "./health";
import type { SweepMetrics } from "./metrics";
import type { RuleConfig } from "../engine/config";

/**
 * One grid cell's outcome: its config, its metrics (or `null` when the geometry
 * was infeasible and `runConfig` threw), and the health verdict. Infeasible
 * cells carry `metrics: null` and a single `infeasible: <error>` reason so the
 * report can surface them without the sweep aborting.
 */
export interface GridEntry {
  config: RuleConfig;
  metrics: SweepMetrics | null;
  health: { pass: boolean; reasons: string[] };
}

/** The result of a balanced-config search: the pick, the ranked passers, and the full grid. */
export interface FindResult {
  recommended: RuleConfig | null;
  ranked: { config: RuleConfig; metrics: SweepMetrics; score: number }[];
  grid: GridEntry[];
}

/** Cartesian product of `axes` value-lists; each element is a chosen value per axis key. */
function cartesian(
  axes: Partial<Record<keyof RuleConfig, (number | boolean | string)[]>>,
): Partial<RuleConfig>[] {
  const keys = Object.keys(axes) as (keyof RuleConfig)[];
  let combos: Partial<RuleConfig>[] = [{}];
  for (const k of keys) {
    const values = axes[k] ?? [];
    const next: Partial<RuleConfig>[] = [];
    for (const combo of combos) {
      for (const v of values) {
        next.push({ ...combo, [k]: v });
      }
    }
    combos = next;
  }
  return combos;
}

/**
 * Rank + select over already-computed grid entries. Pure: no games run. Drops
 * infeasible cells (`metrics: null`), gates+ranks the rest via {@link rankHealthy}
 * (failers are excluded regardless of composite), and recommends the top passer
 * (or `null` when none pass). Exported so the selection logic is unit-testable
 * with hand-built grids, independent of whether the real game has a healthy region.
 */
export function selectBalanced(
  grid: GridEntry[],
  thresholds: HealthThresholds = defaultHealthThresholds(),
): { recommended: RuleConfig | null; ranked: { config: RuleConfig; metrics: SweepMetrics; score: number }[] } {
  const scored = grid
    .filter((g): g is GridEntry & { metrics: SweepMetrics } => g.metrics !== null)
    .map((g) => ({ config: g.config, metrics: g.metrics }));
  const ranked = rankHealthy(scored, thresholds);
  return { recommended: ranked[0]?.config ?? null, ranked };
}

/**
 * Search the full Cartesian product of `axes` applied over `base` for a balanced
 * config. Each cell runs `runConfig` (CRN: same `opts.baseSeed` across cells);
 * infeasible geometry that throws in `runConfig` (e.g. the iron-CSP can't place
 * the requested iron count on a small board) is caught and recorded as a
 * `metrics: null` cell with an `infeasible:` reason rather than aborting the
 * sweep. The feasible cells are gated, ranked, and the top passer recommended.
 */
export function findBalancedConfig(
  axes: Partial<Record<keyof RuleConfig, (number | boolean | string)[]>>,
  base: RuleConfig,
  opts: RunConfigOptions & { thresholds?: HealthThresholds },
): FindResult {
  const thresholds = opts.thresholds ?? defaultHealthThresholds();

  const grid: GridEntry[] = cartesian(axes).map((overrides) => {
    const config: RuleConfig = { ...base, ...overrides };
    try {
      const metrics = runConfig(config, opts);
      return { config, metrics, health: isHealthy(metrics, thresholds) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { config, metrics: null, health: { pass: false, reasons: [`infeasible: ${message}`] } };
    }
  });

  const { recommended, ranked } = selectBalanced(grid, thresholds);
  return { recommended, ranked, grid };
}

/**
 * OFAT (one-factor-at-a-time) balance sweep: vary each `axis` around `baseline`
 * over its values in `valuesPerAxis`, keyed by axis name. Each axis run uses
 * `sweepOFAT` (CRN). Infeasible values are guarded the same way as the grid
 * search — a throwing run records `metrics: null` rather than aborting.
 */
export function balanceSweep(
  baseline: RuleConfig,
  axes: (keyof RuleConfig)[],
  valuesPerAxis: Record<string, (number | boolean | string)[]>,
  opts: RunConfigOptions,
): Record<string, { value: number | boolean | string; metrics: SweepMetrics | null }[]> {
  const out: Record<string, { value: number | boolean | string; metrics: SweepMetrics | null }[]> = {};
  for (const axis of axes) {
    const values = valuesPerAxis[axis as string] ?? [];
    out[axis as string] = values.map((value) => {
      try {
        const metrics = sweepOFAT(baseline, axis, [value], opts)[0]!.metrics;
        return { value, metrics };
      } catch {
        return { value, metrics: null };
      }
    });
  }
  return out;
}
