// ABOUTME: Run just mcts500-preserve+d2 (the variant lost to the container restart) + writes a tiny report.
// ABOUTME: Recovery from second crash. The other 3 v5a variants are in the JSONL already.

import { resolve } from "node:path";
import { GamePool } from "./pool";
import { roundRobinParallel, type NamedAgentSpec } from "./run-parallel";
import { defaultConfig, type RuleConfig } from "../engine/config";
import { elapsedS } from "./format";
import { appendResultAndCommit } from "./incremental-results";
import { workerCount } from "./worker-count";

const INCREMENTAL_PATH = resolve(process.cwd(), "docs/sweeps/data/2026-05-29-mcts-preserve-500.jsonl");
const BASE_SEED = 39_000n;
const TURN_CAP = 30;
const GAMES = 16;
const WORKERS = workerCount();

const CONFIG_C: RuleConfig = {
  ...defaultConfig(),
  boardSize: 96, radius: 2, ironCount: 14, victoryThreshold: 10,
  noIronRequiresPerimeter: true,
};

async function main(): Promise<void> {
  const t0 = Date.now();
  const pool = new GamePool(WORKERS);
  const label = "mcts500-preserve+d2";
  console.log(`-- ${label} (${GAMES} games vs heuristic on (c) 2P) --`);

  const agents: NamedAgentSpec[] = [
    { name: label, spec: { kind: "mcts", iterations: 500, maxDepth: 2, preserveSoftmaxPrior: true } },
    { name: "heuristic", spec: { kind: "heuristic" } },
  ];

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
            data: { variant: label, done, total, turns: r.turns, victoryType: r.victoryType, winner: r.winnerOrCoalition, hitTurnCap: r.hitTurnCap, elapsedSec: (Date.now() - t0) / 1000 },
            meta: { label: "mcts-preserve-500-recover", done, total, summary },
          });
        },
      },
      pool,
    );
    console.log(`${label} winRate: ${((rr.winRates[label] ?? 0) * 100).toFixed(1)}%`);
  } finally {
    pool.close();
  }
  console.log(`Done in ${elapsedS(t0)}.`);
}

main().catch((e: unknown) => {
  console.error(`mcts-preserve-500-recover aborted: ${e instanceof Error ? e.message : String(e)}`);
});
