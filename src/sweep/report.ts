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
  const balance = balanceSection(input);
  if (balance.length > 0) {
    sections.push("");
    sections.push(balance);
  }
  return sections.join("\n") + "\n";
}
