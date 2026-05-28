// ABOUTME: dashboard — read every committed JSONL under docs/sweeps/data/ and emit a single overview markdown.
// ABOUTME: One-shot run; rebuild any time with `npx tsx src/sweep/dashboard.ts`. Output: docs/2026-05-28-sweep-dashboard.md.

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execSync } from "node:child_process";

const DATA_DIR = resolve(process.cwd(), "docs/sweeps/data");
const OUT_PATH = resolve(process.cwd(), "docs/2026-05-28-sweep-dashboard.md");

/** All JSONL files we know how to render. */
const KNOWN_SCHEMAS = [
  "2026-05-28-mcts-300-on-c.jsonl",
  "2026-05-28-rules-variants-comparison.jsonl", // alias for compare-variants
  "2026-05-28-compare-variants.jsonl",
  "2026-05-28-alliance-deltas.jsonl",
  "2026-05-28-explore-c-variant.jsonl",
  "2026-05-28-profile-turn-complexity.jsonl",
  "2026-05-28-revalidate.jsonl",
  "main-sweep.jsonl",
  "calibrate-sweep.jsonl",
];

function readJsonl<T = Record<string, unknown>>(path: string): T[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

function listJsonlFiles(): string[] {
  // ls -1 docs/sweeps/data/*.jsonl, deterministic.
  if (!existsSync(DATA_DIR)) return [];
  try {
    const output = execSync(`ls -1 ${JSON.stringify(DATA_DIR)} 2>/dev/null || true`, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
    return output.split("\n").filter((f) => f.endsWith(".jsonl")).sort();
  } catch {
    return [];
  }
}

/** ASCII bar of width `width` for a fraction in [0,1]. */
function bar(fraction: number, width = 20): string {
  const n = Math.round(Math.max(0, Math.min(1, fraction)) * width);
  return "█".repeat(n) + "·".repeat(width - n);
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

interface VictoryMix {
  iron: number;
  lastStanding: number;
  none: number;
  total: number;
}
function victoryMix(records: Array<{ victoryType?: string }>): VictoryMix {
  let iron = 0,
    lastStanding = 0,
    none = 0;
  for (const r of records) {
    if (r.victoryType === "iron") iron++;
    else if (r.victoryType === "last-standing") lastStanding++;
    else if (r.victoryType !== undefined) none++;
  }
  return { iron, lastStanding, none, total: records.length };
}

/** Render a per-(phase × variant)-bucketed view of game records. */
function renderGroupedTable(
  records: Array<{ phase?: string; variant?: string; nPlayers?: number; turns?: number; victoryType?: string; hitTurnCap?: boolean; elapsedSec?: number }>,
  groupKey: "phase" | "variant" | "phase+variant",
): string {
  const groups = new Map<string, typeof records>();
  for (const r of records) {
    const key =
      groupKey === "phase"
        ? r.phase ?? "(no phase)"
        : groupKey === "variant"
          ? r.variant ?? "(no variant)"
          : `${r.phase ?? "?"}/${r.variant ?? "?"}`;
    const cur = groups.get(key) ?? [];
    cur.push(r);
    groups.set(key, cur);
  }
  const rows: string[] = [];
  rows.push(`| ${groupKey} | games | iron | last-std | none | median t | iron-vic | victory bar |`);
  rows.push(`| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |`);
  for (const [key, group] of [...groups.entries()].sort()) {
    const mix = victoryMix(group);
    const med = median(group.map((r) => r.turns ?? 0).filter((t) => t > 0));
    const ironFrac = mix.total > 0 ? mix.iron / mix.total : 0;
    rows.push(
      `| \`${key}\` | ${mix.total} | ${mix.iron} | ${mix.lastStanding} | ${mix.none} | ${Number.isNaN(med) ? "—" : med.toFixed(1)} | ${(ironFrac * 100).toFixed(1)}% | \`${bar(ironFrac)}\` |`,
    );
  }
  return rows.join("\n");
}

/** Per-known-schema renderer. Falls back to a generic table if unknown. */
function renderSection(filename: string): string {
  const path = resolve(DATA_DIR, filename);
  if (!existsSync(path)) return `### ${filename}\n\n*(no data yet — file not present)*\n`;
  const records = readJsonl<Record<string, unknown>>(path);
  if (records.length === 0) return `### ${filename}\n\n*(empty)*\n`;

  const lines: string[] = [];
  lines.push(`### ${filename}`);
  lines.push("");
  lines.push(`**Records:** ${records.length}`);

  // Phase + variant pivot when present.
  const hasPhase = records.some((r) => "phase" in r);
  const hasVariant = records.some((r) => "variant" in r);

  if (hasPhase && hasVariant) {
    lines.push("");
    lines.push(renderGroupedTable(records as never, "phase+variant"));
  } else if (hasPhase) {
    lines.push("");
    lines.push(renderGroupedTable(records as never, "phase"));
  } else if (hasVariant) {
    lines.push("");
    lines.push(renderGroupedTable(records as never, "variant"));
  } else if (records.some((r) => "turns" in r)) {
    // Plain per-game records with no grouping key — render aggregate.
    const cast = records as Array<{ turns?: number; victoryType?: string; nPlayers?: number }>;
    const mix = victoryMix(cast);
    const med = median(cast.map((r) => r.turns ?? 0).filter((t) => t > 0));
    lines.push(`**Aggregate:** ${mix.total} games · iron=${mix.iron} · last-standing=${mix.lastStanding} · none=${mix.none} · median turns=${Number.isNaN(med) ? "—" : med.toFixed(1)}`);
    lines.push(`**Iron-vic:** ${(mix.iron / Math.max(1, mix.total) * 100).toFixed(1)}% \`${bar(mix.iron / Math.max(1, mix.total))}\``);
  } else if (records.some((r) => "scenario" in r && "rounds" in r)) {
    // profile-turn-complexity schema: per-scenario record with full rounds-log.
    const cast = records as Array<{ scenario?: string; finalTurns?: number; victoryType?: string; winner?: number[]; rounds?: Array<{ turn: number; legalActionsForActed: number; elapsedMs: number }> }>;
    lines.push("");
    lines.push(`| scenario | finalTurns | victoryType | winner | rounds | legal[turn1] | legal[final turn] | ms[turn1] | ms[final turn] |`);
    lines.push(`| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: |`);
    for (const r of cast) {
      const rounds = r.rounds ?? [];
      const t1 = rounds.find((rr) => rr.turn === 1);
      const tF = rounds[rounds.length - 1];
      lines.push(
        `| \`${r.scenario ?? "?"}\` | ${r.finalTurns ?? "—"} | ${r.victoryType ?? "—"} | [${(r.winner ?? []).join(",")}] | ${rounds.length} | ${t1?.legalActionsForActed ?? "—"} | ${tF?.legalActionsForActed ?? "—"} | ${t1?.elapsedMs ?? "—"} | ${tF?.elapsedMs ?? "—"} |`,
      );
    }
  } else if (records.some((r) => "stage" in r)) {
    // Config-stage records (main / calibrate).
    const cast = records as Array<{ stage?: string; healthy?: boolean; infeasible?: boolean; metrics?: { medianTurns?: number; ironVictoryFraction?: number } }>;
    const byStage = new Map<string, typeof cast>();
    for (const r of cast) {
      const key = r.stage ?? "(no stage)";
      const cur = byStage.get(key) ?? [];
      cur.push(r);
      byStage.set(key, cur);
    }
    lines.push("");
    lines.push(`| stage | configs | feasible | healthy | median ironVic | median turns |`);
    lines.push(`| --- | ---: | ---: | ---: | ---: | ---: |`);
    for (const [stage, group] of [...byStage.entries()].sort()) {
      const feasible = group.filter((r) => !r.infeasible).length;
      const healthy = group.filter((r) => r.healthy === true).length;
      const ironVic = median(group.filter((r) => r.metrics?.ironVictoryFraction !== undefined).map((r) => r.metrics!.ironVictoryFraction!));
      const turns = median(group.filter((r) => r.metrics?.medianTurns !== undefined).map((r) => r.metrics!.medianTurns!));
      lines.push(`| \`${stage}\` | ${group.length} | ${feasible} | ${healthy} | ${Number.isNaN(ironVic) ? "—" : ironVic.toFixed(2)} | ${Number.isNaN(turns) ? "—" : turns.toFixed(1)} |`);
    }
  } else {
    lines.push("");
    lines.push(`*(${records.length} records of an unknown shape; first keys: ${Object.keys(records[0]!).slice(0, 6).join(", ")})*`);
  }

  lines.push("");
  return lines.join("\n");
}

function main(): void {
  const all = listJsonlFiles();
  const lines: string[] = [];
  lines.push(`# Sweep Dashboard`);
  lines.push("");
  lines.push(`**Date:** generated ${new Date().toISOString()}. **Source:** every JSONL under \`docs/sweeps/data/\`.`);
  lines.push("");
  lines.push(`Run \`npx tsx src/sweep/dashboard.ts\` to refresh.`);
  lines.push("");
  if (all.length === 0) {
    lines.push(`*No JSONL files found in \`${DATA_DIR}\`.*`);
    writeOut(lines);
    return;
  }
  lines.push(`## Files`);
  lines.push("");
  lines.push(`| File | Records |`);
  lines.push(`| --- | ---: |`);
  for (const f of all) {
    const records = readJsonl(resolve(DATA_DIR, f));
    lines.push(`| \`${f}\` | ${records.length} |`);
  }
  lines.push("");
  lines.push(`## Per-file detail`);
  lines.push("");
  // Render known schemas first, then any unknown extras.
  const known = all.filter((f) => KNOWN_SCHEMAS.includes(f));
  const unknown = all.filter((f) => !KNOWN_SCHEMAS.includes(f));
  for (const f of [...known, ...unknown]) lines.push(renderSection(f));
  lines.push("---");
  lines.push(`*Generated by \`src/sweep/dashboard.ts\`.*`);
  writeOut(lines);
}

function writeOut(lines: string[]): void {
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, lines.join("\n") + "\n", "utf8");
  // eslint-disable-next-line no-console
  console.log(`Wrote ${OUT_PATH} (${lines.length} lines)`);
}

main();
