// ABOUTME: Markdown report builder for the balance-sweep harness — pure function, no I/O.
// ABOUTME: Renders recommended config, grid health table, and per-variable balance-effect tables.

import { proportionCI } from "./run";
import type { FindResult, GridEntry, BalanceResult } from "./orchestrate";
import type { SweepMetrics } from "./metrics";
import type { RuleConfig } from "../engine/config";

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Round a fraction to 3 decimal places for display. */
function frac(n: number): string {
  return n.toFixed(3);
}

/** Round a number to 1 decimal place for display. */
function turns(n: number): string {
  return n.toFixed(1);
}

/** Format a proportion metric with its 95% CI half-width: "0.720 ± 0.062". */
function fracCI(p: number, n: number): string {
  const hw = proportionCI(p, n);
  return `${frac(p)} ± ${frac(hw)}`;
}

/** Render a RuleConfig's key numeric fields as a compact string. */
function configSummary(c: RuleConfig): string {
  return [
    `boardSize=${c.boardSize}`,
    `ironCount=${c.ironCount}`,
    `radius=${c.radius}`,
    `victoryThreshold=${c.victoryThreshold}`,
    `attackRange=${c.attackRange}`,
    `factorySupply=${c.factorySupply}`,
    `brokenPerimeterDeathAtFactories=${c.brokenPerimeterDeathAtFactories}`,
  ].join(", ");
}

/** Render core metrics as a compact summary block. */
function metricsSummary(m: SweepMetrics): string {
  const n = m.gamesPlayed;
  const lines: string[] = [
    `- Games played: ${n}`,
    `- Median turns: ${turns(m.medianTurns)} (mean: ${turns(m.meanTurns)})`,
    `- Iron victory fraction: ${fracCI(m.ironVictoryFraction, n)}`,
    `- Setup-decided fraction: ${fracCI(m.setupDecidedFraction, n)}`,
    `- Cap-hit fraction: ${fracCI(m.capHitFraction, n)}`,
    `- Lead volatility: ${fracCI(m.leadVolatility, n)}`,
    `- Seat-win bias (max across groups): ${frac(m.seatWinBias.maxBiasAcrossGroups)}`,
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

/** Section (a): recommended config or "none found" + nearest misses. */
function sectionRecommended(result: FindResult): string {
  if (result.recommended !== null) {
    const { config, metrics, score } = result.recommended;
    return [
      "## Recommended Balanced Config",
      "",
      `Composite score: **${score.toFixed(4)}**`,
      "",
      "### Config parameters",
      "",
      configSummary(config),
      "",
      "### Metrics (95% CI for proportions)",
      "",
      metricsSummary(metrics),
      "",
    ].join("\n");
  }

  // No passer found.
  const lines: string[] = [
    "## No Healthy Config Found in Grid",
    "",
    "No config in the swept grid passed all health thresholds.",
    "",
  ];

  if (result.nearestMisses !== undefined && result.nearestMisses.length > 0) {
    lines.push("### Nearest Misses", "");
    lines.push(
      "Ranked by fewest failing criteria (ascending), tie-broken by composite score (descending).",
      "",
    );

    for (let i = 0; i < result.nearestMisses.length; i++) {
      const miss = result.nearestMisses[i]!;
      lines.push(`#### Nearest Miss #${i + 1}`);
      lines.push("");
      lines.push(configSummary(miss.config));
      lines.push("");
      lines.push(`**Failing criteria (${miss.health.reasons.length}):**`);
      for (const reason of miss.health.reasons) {
        lines.push(`- ${reason}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

/** Section (b): grid health table. */
function sectionGridTable(gridTable: GridEntry[]): string {
  const lines: string[] = [
    "## Grid Health Table",
    "",
    "Every swept config, annotated with pass/fail and the key metrics.",
    "",
  ];

  if (gridTable.length === 0) {
    lines.push("*(No configs swept.)*", "");
    return lines.join("\n");
  }

  // Table header
  lines.push(
    "| # | boardSize | ironCount | radius | victoryThreshold | medianTurns | setupDecided | ironVictory | seatBias | leadVolatility | Pass | Failing reasons |",
  );
  lines.push(
    "|---|-----------|-----------|--------|-----------------|-------------|-------------|-------------|----------|----------------|------|-----------------|",
  );

  for (let i = 0; i < gridTable.length; i++) {
    const { config: c, metrics: m, health } = gridTable[i]!;
    const passStr = health.pass ? "Yes" : "No";
    const reasonStr = health.reasons.length === 0 ? "—" : health.reasons.join("; ");
    lines.push(
      `| ${i + 1} | ${c.boardSize} | ${c.ironCount} | ${c.radius} | ${c.victoryThreshold} | ${turns(m.medianTurns)} | ${frac(m.setupDecidedFraction)} | ${frac(m.ironVictoryFraction)} | ${frac(m.seatWinBias.maxBiasAcrossGroups)} | ${frac(m.leadVolatility)} | ${passStr} | ${reasonStr} |`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

/** Section (c): per-variable balance-effect tables from balanceSweep output. */
function sectionBalanceTables(balance: BalanceResult): string {
  const lines: string[] = [
    "## Balance-Effect Tables",
    "",
    "One-factor-at-a-time results: each table shows how varying a single axis affects key metrics.",
    "",
  ];

  const axes = Object.keys(balance) as (keyof BalanceResult)[];
  if (axes.length === 0) {
    lines.push("*(No OFAT balance data provided.)*", "");
    return lines.join("\n");
  }

  for (const axis of axes) {
    const entries = balance[axis];
    if (entries === undefined || entries.length === 0) continue;

    lines.push(`### ${axis}`, "");
    lines.push(
      `| ${axis} value | medianTurns | ironVictory | setupDecided | leadVolatility | seatBias |`,
    );
    lines.push("|---|---|---|---|---|---|");

    for (const { value, metrics: m } of entries) {
      lines.push(
        `| ${value} | ${turns(m.medianTurns)} | ${frac(m.ironVictoryFraction)} | ${frac(m.setupDecidedFraction)} | ${frac(m.leadVolatility)} | ${frac(m.seatWinBias.maxBiasAcrossGroups)} |`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main report builder
// ---------------------------------------------------------------------------

/** Input to `report`. */
export interface ReportInput {
  /** The result of `findBalancedConfig`. */
  result: FindResult;
  /** The result of `balanceSweep`, keyed by axis. */
  balance: BalanceResult;
}

/**
 * Build a markdown report string from the sweep results.
 *
 * Pure function — no I/O, no side effects. The caller is responsible for
 * writing the string to disk (e.g. `docs/sweeps/`).
 *
 * Sections:
 *   (a) Recommended balanced config (or "No healthy config found" + nearest misses).
 *   (b) Grid health table — every swept config with pass/fail + key metrics.
 *   (c) Per-variable balance-effect tables from `balanceSweep` OFAT output.
 */
export function report({ result, balance }: ReportInput): string {
  const parts: string[] = [
    "# Balance Sweep Report",
    "",
    sectionRecommended(result),
    sectionGridTable(result.gridTable),
    sectionBalanceTables(balance),
  ];

  return parts.join("\n");
}
