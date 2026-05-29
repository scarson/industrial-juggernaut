// ABOUTME: Track D-prime — re-test Tactical Depth with recalibrated outpost cost (=2 forge-equivalent).
// ABOUTME: Implements Option 1 from docs/2026-05-29-tactical-depth-cost-recalibration.md.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { GamePool } from "./pool";
import { runConfigParallel } from "./run-parallel";
import { defaultConfig, type RuleConfig } from "../engine/config";
import { elapsedS } from "./format";
import { appendResultAndCommit, commitFileAndPush } from "./incremental-results";
import { workerCount } from "./worker-count";
import type { SweepMetrics } from "./metrics";

const INCREMENTAL_PATH = resolve(process.cwd(), "docs/sweeps/data/2026-05-29-tactical-depth-recalibrated.jsonl");
const OUT_PATH = resolve(process.cwd(), "docs/2026-05-29-tactical-depth-recalibrated.md");

const BASE_SEED = 32_000n;
const TURN_CAP = 60;
const GAMES = 100;
const WORKERS = workerCount();
const PLAYER_COUNTS = [2, 3, 4] as const;

const CONFIG_C_BASE: RuleConfig = {
  ...defaultConfig(),
  boardSize: 96, radius: 2, ironCount: 14, victoryThreshold: 10,
  noIronRequiresPerimeter: true,
};

// 3 calibrations:
//   default — outpost=1 (original Track D found median 1 turn at flag on)
//   recal-2 — outpost=2 (Option 1: same as forge)
//   recal-3 — outpost=3 (more extreme — outpost more expensive than forge)
const CALIBRATIONS: { label: string; basePieceCosts?: RuleConfig["basePieceCosts"] }[] = [
  { label: "default (outpost=1)" },
  { label: "recal outpost=2", basePieceCosts: { outpost: 2 } },
  { label: "recal outpost=3", basePieceCosts: { outpost: 3 } },
];

interface CellResult {
  calibration: string;
  nPlayers: number;
  metrics: SweepMetrics | null;
  elapsedSec: number;
}

async function runCell(calibration: { label: string; basePieceCosts?: RuleConfig["basePieceCosts"] }, nPlayers: number, pool: GamePool, t0: number): Promise<CellResult> {
  const tStart = Date.now();
  const config: RuleConfig = {
    ...CONFIG_C_BASE,
    baseTypesEnabled: true,
    ...(calibration.basePieceCosts && { basePieceCosts: calibration.basePieceCosts }),
  };
  const label = `${calibration.label}/${nPlayers}P`;
  console.log(`\n-- ${label}, ${GAMES} heuristic self-play --`);

  let metrics: SweepMetrics | null = null;
  try {
    metrics = await runConfigParallel(
      config,
      {
        games: GAMES,
        turnCap: TURN_CAP,
        baseSeed: BASE_SEED,
        playerCounts: [nPlayers],
        agentSpec: { kind: "heuristic" },
        onGame: (done, total, n, r) => {
          const w = r.winnerOrCoalition.length === 0 ? "none" : r.winnerOrCoalition.join("+");
          const summary = `${label} t=${r.turns} ${r.victoryType} w=${w}`;
          if (done % 25 === 0 || done === total) {
            console.log(`  [${label} ${done}/${total}] ${summary} (${elapsedS(t0)})`);
          }
          appendResultAndCommit(INCREMENTAL_PATH, {
            data: {
              calibration: calibration.label, nPlayers, done, total,
              turns: r.turns, victoryType: r.victoryType,
              winner: r.winnerOrCoalition, hitTurnCap: r.hitTurnCap,
              elapsedSec: (Date.now() - t0) / 1000,
            },
            meta: { label: "tactical-depth-recalibrated", done, total, summary },
          });
        },
      },
      pool,
    );
  } catch (e) {
    console.error(`  ${label} FAILED: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { calibration: calibration.label, nPlayers, metrics, elapsedSec: (Date.now() - tStart) / 1000 };
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const pool = new GamePool(WORKERS);
  console.log(`=== Tactical depth recalibrated (baseSeed ${BASE_SEED}, ${WORKERS} workers) ===`);
  const results: CellResult[] = [];
  try {
    for (const c of CALIBRATIONS) {
      for (const n of PLAYER_COUNTS) {
        const r = await runCell(c, n, pool, t0);
        results.push(r);
      }
    }
  } finally {
    pool.close();
  }

  const lines: string[] = [];
  lines.push(`# Tactical Depth Recalibrated (Track D-prime)`);
  lines.push(``);
  lines.push(`**Date:** 2026-05-29. **Trigger:** Track D found subtype-enabled gameplay accelerates from median 2 turns to median 1. Test whether raising outpost cost to forge-parity (2) or higher (3) shifts the median back toward 2 turns.`);
  lines.push(``);
  lines.push(`**Methodology:** heuristic self-play on variant (c) with baseTypesEnabled=true, sweeping outpost cost ∈ {1 (default), 2, 3}. ${GAMES} games/cell, baseSeed ${BASE_SEED}.`);
  lines.push(``);
  lines.push(`## Results`);
  lines.push(``);
  lines.push(`| Calibration | nPlayers | Median turns | Iron-vic% | Last-stand% | CapHit% | Elapsed |`);
  lines.push(`| --- | ---: | ---: | ---: | ---: | ---: | ---: |`);
  for (const r of results) {
    if (r.metrics === null) {
      lines.push(`| ${r.calibration} | ${r.nPlayers} | — | — | — | — | FAILED |`);
      continue;
    }
    const m = r.metrics;
    const vt = m.victoryType;
    const lsPct = ((vt["last-standing"] ?? 0) / m.gamesPlayed * 100).toFixed(0);
    const ironPct = (m.ironVictoryFraction * 100).toFixed(0);
    const capPct = (m.capHitFraction * 100).toFixed(0);
    lines.push(`| ${r.calibration} | ${r.nPlayers} | ${m.medianTurns} | ${ironPct}% | ${lsPct}% | ${capPct}% | ${r.elapsedSec.toFixed(0)}s |`);
  }
  lines.push(``);
  lines.push(`## Interpretation`);
  lines.push(``);
  lines.push(`A successful recalibration restores median turns to 2 (or higher) — meaning subtypes no longer dominate the iron-grab by sheer piece count. If outpost=2 fixes it (Option 1), the cheapest recalibration works. If outpost=3 is needed, the cost asymmetry needs to be larger. If even outpost=3 still produces median 1, then the root cause is positional (outposts at small radii still cover enough iron) and a different lever (e.g., forge-anchor constraint) is needed.`);
  lines.push(``);
  lines.push(`---`);
  lines.push(`*Generated by \`src/sweep/tactical-depth-recalibrated.ts\`.*`);
  const md = lines.join("\n") + "\n";
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, md, "utf8");
  commitFileAndPush(OUT_PATH, `report: ${OUT_PATH.split("/").pop()}`);
  console.log(`\nDone in ${elapsedS(t0)}. Report: ${OUT_PATH}`);
}

main().catch((e: unknown) => {
  console.error(`tactical-depth-recalibrated aborted: ${e instanceof Error ? e.message : String(e)}`);
});
