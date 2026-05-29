// ABOUTME: Track D — does enabling baseTypesEnabled actually shift gameplay? Heuristic self-play, flag on vs off.
// ABOUTME: If the metrics shift meaningfully, the asymmetric base types open strategic space the agents can find.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { GamePool } from "./pool";
import { runConfigParallel } from "./run-parallel";
import { defaultConfig, type RuleConfig } from "../engine/config";
import { elapsedS, fmtMetrics } from "./format";
import { appendResultAndCommit, commitFileAndPush } from "./incremental-results";
import { workerCount } from "./worker-count";
import type { SweepMetrics } from "./metrics";

const INCREMENTAL_PATH = resolve(process.cwd(), "docs/sweeps/data/2026-05-29-tactical-depth-effect.jsonl");
const OUT_PATH = resolve(process.cwd(), "docs/2026-05-29-tactical-depth-effect.md");

const BASE_SEED = 22_000n;
const TURN_CAP = 60;
const GAMES = 100;
const WORKERS = workerCount();
const PLAYER_COUNTS = [2, 3, 4] as const;

const CONFIG_C_BASE: RuleConfig = {
  ...defaultConfig(),
  boardSize: 96, radius: 2, ironCount: 14, victoryThreshold: 10,
  noIronRequiresPerimeter: true,
};

interface CellResult {
  nPlayers: number;
  flag: boolean;
  metrics: SweepMetrics | null;
  elapsedSec: number;
}

async function runCell(nPlayers: number, flag: boolean, pool: GamePool, t0: number): Promise<CellResult> {
  const tStart = Date.now();
  const config: RuleConfig = { ...CONFIG_C_BASE, baseTypesEnabled: flag };
  const label = `${nPlayers}P/baseTypes=${flag}`;
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
              nPlayers, baseTypesEnabled: flag, done, total,
              turns: r.turns, victoryType: r.victoryType,
              winner: r.winnerOrCoalition, hitTurnCap: r.hitTurnCap,
              elapsedSec: (Date.now() - t0) / 1000,
            },
            meta: { label: "tactical-depth-effect", done, total, summary },
          });
        },
      },
      pool,
    );
  } catch (e) {
    console.error(`  ${label} FAILED: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { nPlayers, flag, metrics, elapsedSec: (Date.now() - tStart) / 1000 };
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const pool = new GamePool(WORKERS);
  console.log(`=== Tactical depth effect (baseSeed ${BASE_SEED}, ${WORKERS} workers) ===`);
  console.log(`Player counts: ${PLAYER_COUNTS.join(",")} × flag in [false, true]. Games per cell: ${GAMES}.`);

  const results: CellResult[] = [];
  try {
    for (const n of PLAYER_COUNTS) {
      for (const flag of [false, true]) {
        const r = await runCell(n, flag, pool, t0);
        results.push(r);
      }
    }
  } finally {
    pool.close();
  }

  // Report.
  const lines: string[] = [];
  lines.push(`# Tactical Depth Effect (Track D)`);
  lines.push(``);
  lines.push(`**Date:** 2026-05-29. **Trigger:** does enabling \`baseTypesEnabled\` shift gameplay metrics? If yes, asymmetric base types open strategic space the heuristic can find (it now composes per-subtype). If no, the flag is a placebo and the agents still play forge-only.`);
  lines.push(``);
  lines.push(`**Methodology:** heuristic self-play on variant (c) base, ${GAMES} games/cell, baseSeed ${BASE_SEED}, turnCap ${TURN_CAP}.`);
  lines.push(``);
  lines.push(`## Results`);
  lines.push(``);
  lines.push(`| nPlayers | baseTypesEnabled | Median turns | Iron-vic% | Last-stand% | CapHit% | Elapsed |`);
  lines.push(`| ---: | :---: | ---: | ---: | ---: | ---: | ---: |`);
  for (const r of results) {
    if (r.metrics === null) {
      lines.push(`| ${r.nPlayers} | ${r.flag} | — | — | — | — | FAILED |`);
      continue;
    }
    const m = r.metrics;
    const vt = m.victoryType;
    const lsPct = ((vt["last-standing"] ?? 0) / m.gamesPlayed * 100).toFixed(0);
    const ironPct = (m.ironVictoryFraction * 100).toFixed(0);
    const capPct = (m.capHitFraction * 100).toFixed(0);
    lines.push(`| ${r.nPlayers} | ${r.flag} | ${m.medianTurns} | ${ironPct}% | ${lsPct}% | ${capPct}% | ${r.elapsedSec.toFixed(0)}s |`);
  }
  lines.push(``);

  // Auto-interpretation: compare each player count's flag-off vs flag-on metrics.
  lines.push(`## Interpretation`);
  lines.push(``);
  for (const n of PLAYER_COUNTS) {
    const off = results.find((r) => r.nPlayers === n && r.flag === false);
    const on = results.find((r) => r.nPlayers === n && r.flag === true);
    if (!off || !on || !off.metrics || !on.metrics) continue;
    const dTurns = on.metrics.medianTurns - off.metrics.medianTurns;
    const dIron = (on.metrics.ironVictoryFraction - off.metrics.ironVictoryFraction) * 100;
    const dCap = (on.metrics.capHitFraction - off.metrics.capHitFraction) * 100;
    lines.push(`- **${n}P:** flag-on vs flag-off — median turns Δ${dTurns >= 0 ? "+" : ""}${dTurns}, iron-vic Δ${dIron >= 0 ? "+" : ""}${dIron.toFixed(0)}pp, capHit Δ${dCap >= 0 ? "+" : ""}${dCap.toFixed(0)}pp.`);
  }
  lines.push(``);
  lines.push(`A flag with meaningful effect should produce visible shifts in median turns or victory mix. If all Δs are within noise (~5pp), the heuristic isn't yet exploiting the subtype machinery in a balance-shifting way even though it CAN compose per-subtype builds — meaning the position evaluator (\`evaluate\`) doesn't reward type asymmetry in a way that changes choices.`);
  lines.push(``);
  lines.push(`---`);
  lines.push(`*Generated by \`src/sweep/tactical-depth-effect.ts\`.*`);
  const md = lines.join("\n") + "\n";
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, md, "utf8");
  commitFileAndPush(OUT_PATH, `report: ${OUT_PATH.split("/").pop()}`);
  console.log(`\nDone in ${elapsedS(t0)}. Report: ${OUT_PATH}`);
}

main().catch((e: unknown) => {
  console.error(`tactical-depth-effect aborted: ${e instanceof Error ? e.message : String(e)}`);
});
