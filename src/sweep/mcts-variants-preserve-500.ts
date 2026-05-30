// ABOUTME: MCTS v5a — preserveSoftmaxPrior at MCTS@500 to test if the structural fix needs more iterations to surface.
// ABOUTME: v4 showed @50/@100 all 0%. Per Sam: test if @500 + the prior fix beats the prior @500 baseline of 10.4%.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { GamePool } from "./pool";
import { roundRobinParallel, type NamedAgentSpec } from "./run-parallel";
import { defaultConfig, type RuleConfig } from "../engine/config";
import { elapsedS } from "./format";
import { appendResultAndCommit, commitFileAndPush } from "./incremental-results";
import { workerCount } from "./worker-count";
import type { AgentSpec } from "./agent-spec";

const INCREMENTAL_PATH = resolve(process.cwd(), "docs/sweeps/data/2026-05-29-mcts-preserve-500.jsonl");
const OUT_PATH = resolve(process.cwd(), "docs/2026-05-29-mcts-preserve-500.md");

const BASE_SEED = 39_000n;
const TURN_CAP = 30;
const GAMES = 16;
const WORKERS = workerCount();

const CONFIG_C: RuleConfig = {
  ...defaultConfig(),
  boardSize: 96, radius: 2, ironCount: 14, victoryThreshold: 10,
  noIronRequiresPerimeter: true,
};

interface Variant {
  label: string;
  description: string;
  spec: AgentSpec;
}

const VARIANTS: Variant[] = [
  { label: "mcts500-baseline",     description: "@500 control — default PW (prior B2 baseline = 10.4%)",                       spec: { kind: "mcts", iterations: 500 } },
  { label: "mcts500-preserve",     description: "@500 + preserveSoftmaxPrior (structural fix at meaningful iteration budget)", spec: { kind: "mcts", iterations: 500, preserveSoftmaxPrior: true } },
  { label: "mcts500-preserve+d1",  description: "@500 + preserveSoftmaxPrior + maxDepth=1",                                    spec: { kind: "mcts", iterations: 500, maxDepth: 1, preserveSoftmaxPrior: true } },
  { label: "mcts500-preserve+d2",  description: "@500 + preserveSoftmaxPrior + maxDepth=2",                                    spec: { kind: "mcts", iterations: 500, maxDepth: 2, preserveSoftmaxPrior: true } },
];

interface CellResult {
  variant: Variant;
  winRate: number;
  elapsedSec: number;
}

async function runCell(variant: Variant, pool: GamePool, t0: number): Promise<CellResult> {
  const tStart = Date.now();
  const label = variant.label;
  console.log(`\n-- ${label} (${GAMES} games vs heuristic on (c) 2P) --`);

  const agents: NamedAgentSpec[] = [
    { name: label, spec: variant.spec },
    { name: "heuristic", spec: { kind: "heuristic" } },
  ];

  let winRate = 0;
  try {
    const rr = await roundRobinParallel(
      agents,
      {
        playerCounts: [2],
        gamesPerMatchup: GAMES,
        seed: BASE_SEED,
        config: CONFIG_C,
        turnCap: TURN_CAP,
        onGame: (done, total, _pc, r) => {
          const w = r.winnerOrCoalition.length === 0 ? "none" : r.winnerOrCoalition.join("+");
          const summary = `${label} t=${r.turns} ${r.victoryType} w=${w}`;
          if (done % 4 === 0 || done === total) {
            console.log(`  [${label} ${done}/${total}] ${summary} (${elapsedS(t0)})`);
          }
          appendResultAndCommit(INCREMENTAL_PATH, {
            data: {
              variant: label,
              done, total,
              turns: r.turns, victoryType: r.victoryType,
              winner: r.winnerOrCoalition, hitTurnCap: r.hitTurnCap,
              elapsedSec: (Date.now() - t0) / 1000,
            },
            meta: { label: "mcts-preserve-500", done, total, summary },
          });
        },
      },
      pool,
    );
    winRate = rr.winRates[label] ?? 0;
  } catch (e) {
    console.error(`  ${label} FAILED: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { variant, winRate, elapsedSec: (Date.now() - tStart) / 1000 };
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const pool = new GamePool(WORKERS);
  console.log(`=== MCTS preserveSoftmaxPrior @500 comparison (baseSeed ${BASE_SEED}, ${WORKERS} workers) ===`);

  const results: CellResult[] = [];
  try {
    for (const v of VARIANTS) {
      const r = await runCell(v, pool, t0);
      results.push(r);
    }
  } finally {
    pool.close();
  }

  results.sort((a, b) => b.winRate - a.winRate);

  const lines: string[] = [];
  lines.push(`# MCTS preserveSoftmaxPrior @500 iterations`);
  lines.push(``);
  lines.push(`**Date:** 2026-05-29. **Trigger:** v4 @50/@100 all 0%. Per Sam, test whether \`preserveSoftmaxPrior\` at @500 beats the prior baseline (B2 era: MCTS@500 = 10.4%).`);
  lines.push(``);
  lines.push(`**Methodology:** ${GAMES} 2P games per variant, variant (c), baseSeed ${BASE_SEED}.`);
  lines.push(``);
  lines.push(`## Results (sorted by win rate)`);
  lines.push(``);
  lines.push(`| Variant | Win rate | Description |`);
  lines.push(`| --- | ---: | --- |`);
  for (const r of results) {
    lines.push(`| ${r.variant.label} | ${(r.winRate * 100).toFixed(1)}% | ${r.variant.description} |`);
  }
  lines.push(``);
  lines.push(`---`);
  lines.push(`*Generated by \`src/sweep/mcts-variants-preserve-500.ts\`.*`);
  const md = lines.join("\n") + "\n";
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, md, "utf8");
  commitFileAndPush(OUT_PATH, `report: ${OUT_PATH.split("/").pop()}`);
  console.log(`\nDone in ${elapsedS(t0)}. Report: ${OUT_PATH}`);
}

main().catch((e: unknown) => {
  console.error(`mcts-preserve-500 aborted: ${e instanceof Error ? e.message : String(e)}`);
});
