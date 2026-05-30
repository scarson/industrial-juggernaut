// ABOUTME: MCTS v5b — hybrid (ii): rootBootstrap=lookahead2 overrides root edge priors with 2-ply lookahead scores.
// ABOUTME: Tests whether deterministic lookahead2 guidance at the decision point can fix MCTS's root prior problem.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { GamePool } from "./pool";
import { roundRobinParallel, type NamedAgentSpec } from "./run-parallel";
import { defaultConfig, type RuleConfig } from "../engine/config";
import { elapsedS } from "./format";
import { appendResultAndCommit, commitFileAndPush } from "./incremental-results";
import { workerCount } from "./worker-count";
import type { AgentSpec } from "./agent-spec";

const INCREMENTAL_PATH = resolve(process.cwd(), "docs/sweeps/data/2026-05-29-mcts-hybrid-bootstrap.jsonl");
const OUT_PATH = resolve(process.cwd(), "docs/2026-05-29-mcts-hybrid-bootstrap.md");

const BASE_SEED = 40_000n;
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

/**
 * v5b hybrid (ii): use lookahead2's per-action score to bootstrap the ROOT edge priors.
 * The tree below the root still uses cheap heuristic eval. This bypasses MCTS's noisy
 * root prior problem at minimal cost (~15 lookahead2 evaluations per move).
 *
 * Test grid:
 *  - bootstrap@50 vs bootstrap@100 vs bootstrap@500 — does iteration budget matter once
 *    the prior is good?
 *  - bootstrap + preserveSoftmaxPrior@500 — combines both fixes (root prior from
 *    lookahead2, deeper priors from softmax(typeValue))
 *  - bootstrap + d1 — does the lookahead2 prior interact with the maxDepth=1 trick?
 */
const VARIANTS: Variant[] = [
  { label: "bootstrap@50",                description: "@50 + rootBootstrap=lookahead2",                                            spec: { kind: "mcts", iterations: 50, rootBootstrap: "lookahead2" } },
  { label: "bootstrap@100",               description: "@100 + rootBootstrap=lookahead2",                                           spec: { kind: "mcts", iterations: 100, rootBootstrap: "lookahead2" } },
  { label: "bootstrap@500",               description: "@500 + rootBootstrap=lookahead2",                                           spec: { kind: "mcts", iterations: 500, rootBootstrap: "lookahead2" } },
  { label: "bootstrap+preserve@500",      description: "@500 + rootBootstrap=lookahead2 + preserveSoftmaxPrior (both fixes)",       spec: { kind: "mcts", iterations: 500, rootBootstrap: "lookahead2", preserveSoftmaxPrior: true } },
  { label: "bootstrap+d1@50",             description: "@50 + rootBootstrap=lookahead2 + maxDepth=1",                               spec: { kind: "mcts", iterations: 50, maxDepth: 1, rootBootstrap: "lookahead2" } },
  { label: "bootstrap+temp-0.1@50",       description: "@50 + rootBootstrap=lookahead2 + T=0.1 (sharper bootstrap softmax)",        spec: { kind: "mcts", iterations: 50, temperature: 0.1, rootBootstrap: "lookahead2" } },
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
            meta: { label: "mcts-hybrid-bootstrap", done, total, summary },
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
  console.log(`=== MCTS hybrid bootstrap (lookahead2 root prior) comparison (baseSeed ${BASE_SEED}, ${WORKERS} workers) ===`);

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
  lines.push(`# MCTS Hybrid Bootstrap — lookahead2 root prior`);
  lines.push(``);
  lines.push(`**Date:** 2026-05-29. **Trigger:** v2-v4 all-0% across 27 config/eval/structural variants. v5b tests hybrid (ii): override MCTS's noisy root edge priors with deterministic \`scoreActionLookahead2\` values. If this works, it's a cheap way to give MCTS a "lookahead2-quality decision at the root" without paying lookahead2 cost at every node.`);
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
  lines.push(`*Generated by \`src/sweep/mcts-hybrid-bootstrap.ts\`.*`);
  const md = lines.join("\n") + "\n";
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, md, "utf8");
  commitFileAndPush(OUT_PATH, `report: ${OUT_PATH.split("/").pop()}`);
  console.log(`\nDone in ${elapsedS(t0)}. Report: ${OUT_PATH}`);
}

main().catch((e: unknown) => {
  console.error(`mcts-hybrid-bootstrap aborted: ${e instanceof Error ? e.message : String(e)}`);
});
