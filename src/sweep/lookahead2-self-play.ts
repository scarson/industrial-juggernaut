// ABOUTME: Track L — lookahead2 self-play across (c) variant × 2P/3P/4P. Does stronger-agent self-play produce deeper games?
// ABOUTME: If turn-count distribution shifts (longer games) vs heuristic self-play, the game has skill ceiling.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { GamePool } from "./pool";
import { runConfigParallel } from "./run-parallel";
import { defaultConfig, type RuleConfig } from "../engine/config";
import { elapsedS, fmtMetrics } from "./format";
import { appendResultAndCommit, commitFileAndPush } from "./incremental-results";
import { workerCount } from "./worker-count";
import type { SweepMetrics } from "./metrics";

const INCREMENTAL_PATH = resolve(process.cwd(), "docs/sweeps/data/2026-05-29-lookahead2-self-play.jsonl");
const OUT_PATH = resolve(process.cwd(), "docs/2026-05-29-lookahead2-self-play.md");

const BASE_SEED = 24_000n;
const TURN_CAP = 60;
const GAMES = 50;
const WORKERS = workerCount();
const PLAYER_COUNTS = [2, 3, 4] as const;

const CONFIG_C: RuleConfig = {
  ...defaultConfig(),
  boardSize: 96, radius: 2, ironCount: 14, victoryThreshold: 10,
  noIronRequiresPerimeter: true,
};

interface CellResult {
  nPlayers: number;
  metrics: SweepMetrics | null;
  turns: number[];
  elapsedSec: number;
}

async function runCell(nPlayers: number, pool: GamePool, t0: number): Promise<CellResult> {
  const tStart = Date.now();
  const label = `${nPlayers}P all-lookahead2`;
  console.log(`\n-- ${label}, ${GAMES} games --`);
  const turns: number[] = [];
  let metrics: SweepMetrics | null = null;
  try {
    metrics = await runConfigParallel(
      CONFIG_C,
      {
        games: GAMES,
        turnCap: TURN_CAP,
        baseSeed: BASE_SEED,
        playerCounts: [nPlayers],
        agentSpec: { kind: "lookahead2" },
        onGame: (done, total, n, r) => {
          turns.push(r.turns);
          const w = r.winnerOrCoalition.length === 0 ? "none" : r.winnerOrCoalition.join("+");
          const summary = `${label} t=${r.turns} ${r.victoryType} w=${w}`;
          if (done % 10 === 0 || done === total) {
            console.log(`  [${label} ${done}/${total}] ${summary} (${elapsedS(t0)})`);
          }
          appendResultAndCommit(INCREMENTAL_PATH, {
            data: {
              nPlayers, done, total,
              turns: r.turns, victoryType: r.victoryType,
              winner: r.winnerOrCoalition, hitTurnCap: r.hitTurnCap,
              elapsedSec: (Date.now() - t0) / 1000,
            },
            meta: { label: "lookahead2-self-play", done, total, summary },
          });
        },
      },
      pool,
    );
  } catch (e) {
    console.error(`  ${label} FAILED: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { nPlayers, metrics, turns, elapsedSec: (Date.now() - tStart) / 1000 };
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const pool = new GamePool(WORKERS);
  console.log(`=== lookahead2 self-play (baseSeed ${BASE_SEED}, ${WORKERS} workers) ===`);
  const results: CellResult[] = [];
  try {
    for (const n of PLAYER_COUNTS) {
      const r = await runCell(n, pool, t0);
      results.push(r);
    }
  } finally {
    pool.close();
  }

  const lines: string[] = [];
  lines.push(`# lookahead2 Self-Play (Track L)`);
  lines.push(``);
  lines.push(`**Date:** 2026-05-29. **Trigger:** if BOTH agents have 2-ply lookahead, does the game last longer or shift to last-standing victories? Indicator of whether strategic depth lives beyond the 1-step heuristic.`);
  lines.push(``);
  lines.push(`**Methodology:** lookahead2 self-play on variant (c). ${GAMES} games per player count, baseSeed ${BASE_SEED}, turnCap ${TURN_CAP}.`);
  lines.push(``);
  lines.push(`## Results`);
  lines.push(``);
  lines.push(`| nPlayers | Median turns | Iron-vic% | Last-stand% | CapHit% | Max turns observed | Elapsed |`);
  lines.push(`| ---: | ---: | ---: | ---: | ---: | ---: | ---: |`);
  for (const r of results) {
    if (r.metrics === null) {
      lines.push(`| ${r.nPlayers} | — | — | — | — | — | FAILED |`);
      continue;
    }
    const m = r.metrics;
    const vt = m.victoryType;
    const lsPct = ((vt["last-standing"] ?? 0) / m.gamesPlayed * 100).toFixed(0);
    const ironPct = (m.ironVictoryFraction * 100).toFixed(0);
    const capPct = (m.capHitFraction * 100).toFixed(0);
    const maxT = r.turns.length > 0 ? Math.max(...r.turns) : 0;
    lines.push(`| ${r.nPlayers} | ${m.medianTurns} | ${ironPct}% | ${lsPct}% | ${capPct}% | ${maxT} | ${r.elapsedSec.toFixed(0)}s |`);
  }
  lines.push(``);
  lines.push(`## Comparison reference (heuristic self-play on same config)`);
  lines.push(``);
  lines.push(`From earlier sweeps: heuristic self-play on (c) ends in median 2 turns regardless of player count. If lookahead2 self-play differs (e.g. median 3+), the stronger agent has revealed strategic structure the 1-step heuristic couldn't.`);
  lines.push(``);
  lines.push(`---`);
  lines.push(`*Generated by \`src/sweep/lookahead2-self-play.ts\`.*`);
  const md = lines.join("\n") + "\n";
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, md, "utf8");
  commitFileAndPush(OUT_PATH, `report: ${OUT_PATH.split("/").pop()}`);
  console.log(`\nDone in ${elapsedS(t0)}. Report: ${OUT_PATH}`);
}

main().catch((e: unknown) => {
  console.error(`lookahead2-self-play aborted: ${e instanceof Error ? e.message : String(e)}`);
});
