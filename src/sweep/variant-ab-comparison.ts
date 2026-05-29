// ABOUTME: Variants (a) and (b) — comparison sweep. Does either shift gameplay vs (c)?
// ABOUTME: (a) victoryIronRequiresPerimeter=true. (b) victoryIronHoldRounds=2. Both layered over (c).

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { GamePool } from "./pool";
import { runConfigParallel } from "./run-parallel";
import { defaultConfig, type RuleConfig } from "../engine/config";
import { elapsedS, fmtMetrics } from "./format";
import { appendResultAndCommit, commitFileAndPush } from "./incremental-results";
import { workerCount } from "./worker-count";
import type { SweepMetrics } from "./metrics";

const INCREMENTAL_PATH = resolve(process.cwd(), "docs/sweeps/data/2026-05-29-variant-ab-comparison.jsonl");
const OUT_PATH = resolve(process.cwd(), "docs/2026-05-29-variant-ab-comparison.md");

const BASE_SEED = 26_000n;
const TURN_CAP = 60;
const GAMES = 60;
const WORKERS = workerCount();
const PLAYER_COUNTS = [2, 3];

interface VariantDef {
  label: string;
  config: RuleConfig;
}

const BASE_C: RuleConfig = {
  ...defaultConfig(),
  boardSize: 96, radius: 2, ironCount: 14, victoryThreshold: 10,
  noIronRequiresPerimeter: true,
};

const VARIANTS: VariantDef[] = [
  { label: "(c) reference", config: BASE_C },
  { label: "(c)+(a) victoryIronRequiresPerimeter", config: { ...BASE_C, victoryIronRequiresPerimeter: true } },
  { label: "(c)+(b) victoryIronHoldRounds=2", config: { ...BASE_C, victoryIronHoldRounds: 2 } },
  { label: "(c)+(a)+(b) both", config: { ...BASE_C, victoryIronRequiresPerimeter: true, victoryIronHoldRounds: 2 } },
];

interface CellResult {
  variant: VariantDef;
  nPlayers: number;
  metrics: SweepMetrics | null;
  elapsedSec: number;
}

async function runCell(variant: VariantDef, nPlayers: number, pool: GamePool, t0: number): Promise<CellResult> {
  const tStart = Date.now();
  const label = `${variant.label}/${nPlayers}P`;
  console.log(`\n-- ${label}, ${GAMES} heuristic self-play --`);
  let metrics: SweepMetrics | null = null;
  try {
    metrics = await runConfigParallel(
      variant.config,
      {
        games: GAMES,
        turnCap: TURN_CAP,
        baseSeed: BASE_SEED,
        playerCounts: [nPlayers],
        agentSpec: { kind: "heuristic" },
        onGame: (done, total, n, r) => {
          const w = r.winnerOrCoalition.length === 0 ? "none" : r.winnerOrCoalition.join("+");
          const summary = `${label} t=${r.turns} ${r.victoryType} w=${w}`;
          if (done % 20 === 0 || done === total) {
            console.log(`  [${label} ${done}/${total}] ${summary} (${elapsedS(t0)})`);
          }
          appendResultAndCommit(INCREMENTAL_PATH, {
            data: {
              variant: variant.label, nPlayers, done, total,
              turns: r.turns, victoryType: r.victoryType,
              winner: r.winnerOrCoalition, hitTurnCap: r.hitTurnCap,
              elapsedSec: (Date.now() - t0) / 1000,
            },
            meta: { label: "variant-ab", done, total, summary },
          });
        },
      },
      pool,
    );
  } catch (e) {
    console.error(`  ${label} FAILED: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { variant, nPlayers, metrics, elapsedSec: (Date.now() - tStart) / 1000 };
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const pool = new GamePool(WORKERS);
  console.log(`=== Variants (a) + (b) comparison (baseSeed ${BASE_SEED}, ${WORKERS} workers) ===`);
  const results: CellResult[] = [];
  try {
    for (const v of VARIANTS) {
      for (const n of PLAYER_COUNTS) {
        const r = await runCell(v, n, pool, t0);
        results.push(r);
      }
    }
  } finally {
    pool.close();
  }

  const lines: string[] = [];
  lines.push(`# Variants (a) & (b) Comparison`);
  lines.push(``);
  lines.push(`**Date:** 2026-05-29. **Trigger:** test whether layering (a) victoryIronRequiresPerimeter or (b) victoryIronHoldRounds=2 onto (c) shifts gameplay metrics. Both flags exist in the engine but haven't been benchmarked recently.`);
  lines.push(``);
  lines.push(`**Methodology:** heuristic self-play, ${GAMES} games per cell, baseSeed ${BASE_SEED}, turnCap ${TURN_CAP}.`);
  lines.push(``);
  lines.push(`## Results`);
  lines.push(``);
  lines.push(`| Variant | nP | Median turns | Iron-vic% | Last-stand% | CapHit% | Elapsed |`);
  lines.push(`| --- | ---: | ---: | ---: | ---: | ---: | ---: |`);
  for (const r of results) {
    if (r.metrics === null) { lines.push(`| ${r.variant.label} | ${r.nPlayers} | — | — | — | — | FAILED |`); continue; }
    const m = r.metrics;
    const vt = m.victoryType;
    const lsPct = ((vt["last-standing"] ?? 0) / m.gamesPlayed * 100).toFixed(0);
    const ironPct = (m.ironVictoryFraction * 100).toFixed(0);
    const capPct = (m.capHitFraction * 100).toFixed(0);
    lines.push(`| ${r.variant.label} | ${r.nPlayers} | ${m.medianTurns} | ${ironPct}% | ${lsPct}% | ${capPct}% | ${r.elapsedSec.toFixed(0)}s |`);
  }
  lines.push(``);
  lines.push(`A meaningful (a) or (b) effect should produce visible shifts in median turns, iron-vic%, or capHit% vs the (c) reference row. Within-noise shifts mean the flag doesn't change strategic shape under heuristic play.`);
  lines.push(``);
  lines.push(`---`);
  lines.push(`*Generated by \`src/sweep/variant-ab-comparison.ts\`.*`);
  const md = lines.join("\n") + "\n";
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, md, "utf8");
  commitFileAndPush(OUT_PATH, `report: ${OUT_PATH.split("/").pop()}`);
  console.log(`\nDone in ${elapsedS(t0)}. Report: ${OUT_PATH}`);
}

main().catch((e: unknown) => {
  console.error(`variant-ab aborted: ${e instanceof Error ? e.message : String(e)}`);
});
