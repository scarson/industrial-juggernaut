// ABOUTME: report — pure markdown builder for the balance sweep (recommended config, grid health table, OFAT balance tables).
// ABOUTME: No file I/O (the S5 main writes the string); a proportionCI annotates the headline balance proportion.

import { proportionCI } from "./run";
import type { GridEntry } from "./orchestrate";
import type { HealthThresholds } from "./health";
import type { SweepMetrics } from "./metrics";
import type { RuleConfig } from "../engine/config";

/** Input for the report: the search result, optional OFAT balance tables, and context. */
export interface ReportInput {
  recommended: RuleConfig | null;
  ranked: { config: RuleConfig; metrics: SweepMetrics; score: number }[];
  grid: GridEntry[];
  /** Per-axis OFAT effect tables, keyed by axis name (when balance sweeps were run). */
  balance?: Record<string, { value: number | boolean | string; metrics: SweepMetrics | null }[]>;
  gamesPerConfig: number;
  thresholds: HealthThresholds;
}

/** The geometry/balance fields surfaced for a config in tables (the ones the sweep varies). */
const KEY_FIELDS: (keyof RuleConfig)[] = [
  "boardSize",
  "radius",
  "ironCount",
  "victoryThreshold",
  "attackRange",
  "autoWinAt6",
  "killBounty",
];

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3);
}

/** A `field=value` summary of a config's key fields, for inline prose. */
function configSummary(config: RuleConfig): string {
  return KEY_FIELDS.map((f) => `${f}=${String(config[f])}`).join(", ");
}

/** A markdown table row of a config's key fields (cells only; no leading/trailing pipe handling). */
function configCells(config: RuleConfig): string {
  return KEY_FIELDS.map((f) => String(config[f])).join(" | ");
}

/** The recommended-config (or none-found) section. */
function recommendedSection(input: ReportInput): string {
  const lines: string[] = [];
  if (input.recommended !== null) {
    const top = input.ranked[0]!;
    lines.push("## Recommended balanced config");
    lines.push("");
    lines.push(`Config: ${configSummary(input.recommended)}`);
    lines.push("");
    lines.push(`Composite score: ${fmtNum(top.score)}`);
    lines.push("");
    const m = top.metrics;
    lines.push("| metric | value |");
    lines.push("| --- | --- |");
    lines.push(`| medianTurns | ${fmtNum(m.medianTurns)} |`);
    lines.push(`| meanTurns | ${fmtNum(m.meanTurns)} |`);
    lines.push(`| setupDecidedFraction | ${fmtNum(m.setupDecidedFraction)} |`);
    lines.push(`| ironVictoryFraction | ${fmtNum(m.ironVictoryFraction)} |`);
    lines.push(`| capHitFraction | ${fmtNum(m.capHitFraction)} |`);
    lines.push(`| seatWinBias | ${fmtNum(m.seatWinBias)} |`);
    lines.push(`| leadVolatility | ${fmtNum(m.leadVolatility)} |`);
    return lines.join("\n");
  }

  // None found: list the nearest misses (feasible failers with the fewest
  // failing reasons first) and their failing reasons.
  lines.push("## No healthy config found in the searched grid — nearest misses:");
  lines.push("");
  const misses = input.grid
    .filter((g) => g.metrics !== null)
    .slice()
    .sort((a, b) => a.health.reasons.length - b.health.reasons.length);
  if (misses.length === 0) {
    lines.push("(No feasible configs ran — every grid cell was infeasible.)");
    return lines.join("\n");
  }
  for (const miss of misses) {
    lines.push(`- ${configSummary(miss.config)}`);
    for (const reason of miss.health.reasons) {
      lines.push(`  - ${reason}`);
    }
  }
  return lines.join("\n");
}

/** The grid health table: one row per config with key fields, headline metrics, and PASS/FAIL+reasons. */
function gridTableSection(input: ReportInput): string {
  const lines: string[] = [];
  lines.push("## Grid health");
  lines.push("");
  lines.push(
    `| ${KEY_FIELDS.join(" | ")} | medianTurns | setupDecided | ironVic | seatBias | leadVol | health |`,
  );
  const dashes = KEY_FIELDS.map(() => "---").join(" | ");
  lines.push(`| ${dashes} | --- | --- | --- | --- | --- | --- |`);
  for (const entry of input.grid) {
    const m = entry.metrics;
    const median = m === null ? "—" : fmtNum(m.medianTurns);
    const setup = m === null ? "—" : fmtNum(m.setupDecidedFraction);
    const iron = m === null ? "—" : fmtNum(m.ironVictoryFraction);
    const seat = m === null ? "—" : fmtNum(m.seatWinBias);
    const lead = m === null ? "—" : fmtNum(m.leadVolatility);
    const verdict = entry.health.pass
      ? "PASS"
      : `FAIL: ${entry.health.reasons.join("; ")}`;
    lines.push(
      `| ${configCells(entry.config)} | ${median} | ${setup} | ${iron} | ${seat} | ${lead} | ${verdict} |`,
    );
  }
  return lines.join("\n");
}

/**
 * Per-count seatBias table. `seatWinBias` (the gate metric) is the MAX over
 * player counts, so it is dominated by the highest count — which has the fewest
 * games per seat and thus the largest sampling noise. Breaking it out per count
 * lets a reader judge whether a high `seatBias` is genuine low-count first-mover
 * advantage or just an under-sampled high-count artifact. Emitted only when at
 * least one feasible config carries per-count data.
 */
function perCountSeatBiasSection(input: ReportInput): string {
  const feasible = input.grid.filter(
    (g): g is GridEntry & { metrics: SweepMetrics } => g.metrics !== null,
  );
  const counts = [
    ...new Set(feasible.flatMap((g) => Object.keys(g.metrics.seatWinBiasByCount).map(Number))),
  ].sort((a, b) => a - b);
  if (counts.length === 0) return "";

  const lines: string[] = [];
  lines.push("## Per-count seatBias");
  lines.push("");
  lines.push(
    "`seatWinBias` (the gate metric) is the MAX over player counts, so it is dominated by the highest count, which has the fewest games per seat and thus the largest sampling noise. This table breaks it out per count so a high seatBias can be read as genuine low-count bias vs. an under-sampled high-count artifact.",
  );
  lines.push("");
  lines.push(`| config | ${counts.map((n) => `${n}P`).join(" | ")} | max(gate) |`);
  lines.push(`| ${["---", ...counts.map(() => "---"), "---"].join(" | ")} |`);
  for (const g of feasible) {
    const cells = counts.map((n) => {
      const b = g.metrics.seatWinBiasByCount[n];
      return b === undefined ? "—" : fmtNum(b);
    });
    lines.push(`| ${configSummary(g.config)} | ${cells.join(" | ")} | ${fmtNum(g.metrics.seatWinBias)} |`);
  }
  lines.push("");
  // Per-seat CI assuming games are split evenly across the counts present; shows
  // which counts can't yet be distinguished from a fair (uniform) win-rate.
  const gamesPerCount = input.gamesPerConfig / counts.length;
  lines.push(
    `Per-seat 95% CI half-width on a fair win-rate at ${input.gamesPerConfig} games/config: ` +
      counts.map((n) => `${n}P≈±${fmtNum(proportionCI(1 / n, gamesPerCount / n))}`).join(", "),
  );
  return lines.join("\n");
}

/** Per-axis OFAT balance-effect tables; the headline proportion (ironVictoryFraction) gets a 95% CI. */
function balanceSection(input: ReportInput): string {
  const balance = input.balance;
  if (balance === undefined) return "";
  const lines: string[] = [];
  lines.push("## Balance (OFAT effects)");
  lines.push("");
  for (const axis of Object.keys(balance)) {
    lines.push(`### ${axis}`);
    lines.push("");
    lines.push(
      "| value | medianTurns | ironVictoryFraction (±95% CI) | setupDecided | seatBias | leadVol |",
    );
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const row of balance[axis]!) {
      const m = row.metrics;
      if (m === null) {
        lines.push(`| ${String(row.value)} | — | infeasible | — | — | — |`);
        continue;
      }
      const ci = proportionCI(m.ironVictoryFraction, m.gamesPlayed);
      lines.push(
        `| ${String(row.value)} | ${fmtNum(m.medianTurns)} | ${fmtNum(m.ironVictoryFraction)} ± ${fmtNum(ci)} | ${fmtNum(m.setupDecidedFraction)} | ${fmtNum(m.seatWinBias)} | ${fmtNum(m.leadVolatility)} |`,
      );
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

/**
 * Build the markdown balance-sweep report as a string (no file I/O — the S5 main
 * writes it). Sections: (1) the recommended balanced config + its metrics, or a
 * "no healthy config found" header with the nearest-miss configs and their
 * failing reasons; (2) the full grid health table; (3) when `balance` is given,
 * per-axis OFAT effect tables with a 95% CI on the headline iron-victory rate.
 */
export function report(input: ReportInput): string {
  const sections: string[] = [];
  sections.push("# Balance Sweep Report");
  sections.push("");
  sections.push(`Games per config: ${input.gamesPerConfig}`);
  sections.push("");
  sections.push("Health thresholds:");
  sections.push("");
  sections.push("```json");
  sections.push(JSON.stringify(input.thresholds, null, 2));
  sections.push("```");
  sections.push("");
  sections.push(recommendedSection(input));
  sections.push("");
  sections.push(gridTableSection(input));
  const perCount = perCountSeatBiasSection(input);
  if (perCount.length > 0) {
    sections.push("");
    sections.push(perCount);
  }
  const balance = balanceSection(input);
  if (balance.length > 0) {
    sections.push("");
    sections.push(balance);
  }
  return sections.join("\n") + "\n";
}
