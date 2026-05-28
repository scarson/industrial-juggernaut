// ABOUTME: regenerate-mcts-300-report — rebuild docs/2026-05-28-mcts-300-on-c.md from the JSONL data, in case the run died before writing its end-of-run report.
// ABOUTME: Aggregates the per-game records (committed by appendResultAndCommit) into the same shape the live script produces; partial data → partial report.

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const IN_PATH = resolve(process.cwd(), "docs/sweeps/data/2026-05-28-mcts-300-on-c.jsonl");
const OUT_PATH = resolve(process.cwd(), "docs/2026-05-28-mcts-300-on-c.md");

interface GameRecord {
  phase: "health" | "h2h";
  done: number;
  total: number;
  nPlayers: number;
  turns: number;
  victoryType: "iron" | "last-standing" | "none";
  winner: number[];
  hitTurnCap: boolean;
  elapsedSec: number;
}

function readJsonl(path: string): GameRecord[] {
  if (!existsSync(path)) {
    throw new Error(`JSONL not found: ${path} (no per-game data committed yet — has the run produced any games?)`);
  }
  const text = readFileSync(path, "utf8");
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as GameRecord);
}

function summarize(records: GameRecord[]): { health: GameRecord[]; h2h: GameRecord[] } {
  return {
    health: records.filter((r) => r.phase === "health"),
    h2h: records.filter((r) => r.phase === "h2h"),
  };
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function victoryMix(games: GameRecord[]): { iron: number; lastStanding: number; none: number; total: number } {
  let iron = 0,
    lastStanding = 0,
    none = 0;
  for (const g of games) {
    if (g.victoryType === "iron") iron++;
    else if (g.victoryType === "last-standing") lastStanding++;
    else none++;
  }
  return { iron, lastStanding, none, total: games.length };
}

function main(): void {
  const records = readJsonl(IN_PATH);
  const { health, h2h } = summarize(records);
  const lines: string[] = [];
  lines.push(`# MCTS@300 Stress Test on Variant (c) — Report (regenerated from per-game JSONL)`);
  lines.push(``);
  lines.push(`**Date:** 2026-05-28 (regenerated). **Source data:** \`docs/sweeps/data/2026-05-28-mcts-300-on-c.jsonl\` (${records.length} records).`);
  lines.push(``);
  if (health.length === 0 && h2h.length === 0) {
    lines.push(`No game records yet. The sweep has not produced any committed data.`);
    writeOut(lines);
    return;
  }
  lines.push(`**Config:** boardSize=96, radius=2, ironCount=14, victoryThreshold=10, noIronRequiresPerimeter=true.`);
  lines.push(``);
  lines.push(`## Results — All-MCTS@300 health phase`);
  lines.push(``);
  if (health.length === 0) {
    lines.push(`No health games committed yet.`);
  } else {
    const mix = victoryMix(health);
    const med = median(health.map((r) => r.turns));
    const ironVic = mix.iron / mix.total;
    lines.push(`**Games completed:** ${health.length} (of expected 12; partial if < 12).`);
    lines.push(`**Median turns:** ${med}`);
    lines.push(`**Iron-victory fraction:** ${ironVic.toFixed(3)} (${mix.iron}/${mix.total})`);
    lines.push(`**Victory mix:** iron=${mix.iron}, last-standing=${mix.lastStanding}, none(cap)=${mix.none}`);
    lines.push(``);
    lines.push(`| game | nPlayers | turns | victoryType | winner | hitTurnCap | elapsedSec |`);
    lines.push(`| --- | --- | --- | --- | --- | --- | --- |`);
    for (const r of health) {
      lines.push(`| ${r.done}/${r.total} | ${r.nPlayers}P | ${r.turns} | ${r.victoryType} | [${r.winner.join(",")}] | ${r.hitTurnCap} | ${r.elapsedSec.toFixed(0)} |`);
    }
  }
  lines.push(``);
  lines.push(`## Results — 2P MCTS@300 vs heuristic h2h phase`);
  lines.push(``);
  if (h2h.length === 0) {
    lines.push(`No h2h games committed yet.`);
  } else {
    const mix = victoryMix(h2h);
    const med = median(h2h.map((r) => r.turns));
    // h2h winner is a player id (0 or 1); under seat-rotation 0/1 ≠ a fixed agent. We can't infer
    // mcts vs heuristic win rate from raw winner IDs without also knowing the seat assignment
    // (which roundRobinParallel knows but doesn't put in the per-game record). So we report only
    // the raw mix; the live script computes win-rates with full seat info.
    lines.push(`**Games completed:** ${h2h.length} (of expected 16).`);
    lines.push(`**Median turns:** ${med}`);
    lines.push(`**Victory mix:** iron=${mix.iron}, last-standing=${mix.lastStanding}, none(cap)=${mix.none}`);
    lines.push(``);
    lines.push(`**Note:** h2h-win-rate (MCTS@300 vs heuristic) cannot be reconstructed from this data alone — the seat-rotation mapping needed for that lives in the live script's roundRobinParallel, not the per-game record. For h2h win-rates, see the live end-of-run report; if the live run failed before producing it, manual reconstruction is needed.`);
    lines.push(``);
    lines.push(`| game | turns | victoryType | winnerSeat | hitTurnCap | elapsedSec |`);
    lines.push(`| --- | --- | --- | --- | --- | --- |`);
    for (const r of h2h) {
      lines.push(`| ${r.done}/${r.total} | ${r.turns} | ${r.victoryType} | [${r.winner.join(",")}] | ${r.hitTurnCap} | ${r.elapsedSec.toFixed(0)} |`);
    }
  }
  lines.push(``);
  lines.push(`---`);
  lines.push(`*Regenerated from JSONL by \`src/sweep/regenerate-mcts-300-report.ts\`.*`);
  writeOut(lines);
}

function writeOut(lines: string[]): void {
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, lines.join("\n") + "\n", "utf8");
  // eslint-disable-next-line no-console
  console.log(`Wrote ${OUT_PATH}`);
}

main();
