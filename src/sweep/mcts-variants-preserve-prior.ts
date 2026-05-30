// ABOUTME: MCTS variants v4 — tests preserveSoftmaxPrior, the structural fix for PW's uniform-prior bottleneck.
// ABOUTME: v3 showed PW variants stuck at 0% while fixed-candidate variants reached 6.3% (within noise).

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { GamePool } from "./pool";
import { roundRobinParallel, type NamedAgentSpec } from "./run-parallel";
import { defaultConfig, type RuleConfig } from "../engine/config";
import { elapsedS } from "./format";
import { appendResultAndCommit, commitFileAndPush } from "./incremental-results";
import { workerCount } from "./worker-count";
import type { AgentSpec } from "./agent-spec";

const INCREMENTAL_PATH = resolve(process.cwd(), "docs/sweeps/data/2026-05-29-mcts-variants-preserve-prior.jsonl");
const OUT_PATH = resolve(process.cwd(), "docs/2026-05-29-mcts-variants-preserve-prior.md");

const BASE_SEED = 38_000n;
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
 * v4 hypothesis: PW's uniform-prior normalization (each opened edge gets prior=1/k) is
 * the structural cause of MCTS@50's 0% rate against the heuristic. samplePolicy ranks
 * candidates by typeValue softmax, but expandNode discards the distribution and assigns
 * equal priors. At low iteration budgets, PUCT can't differentiate candidates → mostVisited
 * returns essentially random picks.
 *
 * preserveSoftmaxPrior (v4 infra, committed in 9bbe9ac) keeps `softmax(typeValue/temperature)`
 * over the opened set as the prior. If this is the bottleneck, the prior-preserving variants
 * should noticeably outperform v3's all-0% PW variants.
 */
const VARIANTS: Variant[] = [
  { label: "v4-baseline",                description: "@50 control — default PW, uniform 1/k prior",                                       spec: { kind: "mcts", iterations: 50 } },
  { label: "v4-preserve",                description: "@50 + preserveSoftmaxPrior (PW)",                                                   spec: { kind: "mcts", iterations: 50, preserveSoftmaxPrior: true } },
  { label: "v4-preserve+d1",             description: "@50 + preserveSoftmaxPrior + maxDepth=1",                                           spec: { kind: "mcts", iterations: 50, maxDepth: 1, preserveSoftmaxPrior: true } },
  { label: "v4-preserve+d2",             description: "@50 + preserveSoftmaxPrior + maxDepth=2 (Opus-like structure)",                     spec: { kind: "mcts", iterations: 50, maxDepth: 2, preserveSoftmaxPrior: true } },
  { label: "v4-preserve+temp-0.5",       description: "@50 + preserveSoftmaxPrior + T=0.5 (sharper softmax)",                              spec: { kind: "mcts", iterations: 50, temperature: 0.5, preserveSoftmaxPrior: true } },
  { label: "v4-preserve+temp-0.1",       description: "@50 + preserveSoftmaxPrior + T=0.1 (near-argmax softmax)",                          spec: { kind: "mcts", iterations: 50, temperature: 0.1, preserveSoftmaxPrior: true } },
  { label: "v4-preserve+iron-share",     description: "@50 + preserveSoftmaxPrior + iron-share leaf eval",                                 spec: { kind: "mcts", iterations: 50, preserveSoftmaxPrior: true, evalOpts: { ironShare: true } } },
  { label: "v4-preserve+d1+prng-aware",  description: "@50 + preserveSoftmaxPrior + maxDepth=1 + prng-aware (everything combined)",        spec: { kind: "mcts", iterations: 50, maxDepth: 1, preserveSoftmaxPrior: true, evalOpts: { prngAwareDeterministic: true } } },
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
            meta: { label: "mcts-variants-preserve-prior", done, total, summary },
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
  console.log(`=== MCTS variants preserve-prior comparison (baseSeed ${BASE_SEED}, ${WORKERS} workers) ===`);
  console.log(`All variants @50 iterations vs heuristic on (c) 2P, ${GAMES} games each.`);

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
  lines.push(`# MCTS Variants v4 — preserveSoftmaxPrior @50 iterations`);
  lines.push(``);
  lines.push(`**Date:** 2026-05-29. **Trigger:** v3 PW variants stuck at 0%; fixed-candidate variants reached 6.3% (within noise). Hypothesis: PW's uniform-1/k prior discards \`samplePolicy\`'s softmax ranking — at 50 iterations PUCT can't differentiate candidates. v4 tests \`preserveSoftmaxPrior\` (committed in 9bbe9ac), which restores \`softmax(typeValue/temperature)\` priors over the opened set.`);
  lines.push(``);
  lines.push(`**Reference:**`);
  lines.push(`- heuristic = baseline strong.`);
  lines.push(`- lookahead2 = 80.7% vs heuristic on (c) 2P (target ceiling).`);
  lines.push(`- v2/v3 baseline @50 = 0%; v3 fixed-candidate variants = 6.3% (1/16, within noise).`);
  lines.push(``);
  lines.push(`**Methodology:** ${GAMES} 2P games per variant, variant (c), baseSeed ${BASE_SEED}.`);
  lines.push(``);
  lines.push(`## Results (sorted by win rate)`);
  lines.push(``);
  lines.push(`| Variant | Win rate | Δ vs v4-baseline | Description |`);
  lines.push(`| --- | ---: | ---: | --- |`);
  const baseline = results.find((r) => r.variant.label === "v4-baseline")?.winRate ?? 0;
  for (const r of results) {
    const delta = r.winRate - baseline;
    const sign = delta >= 0 ? "+" : "";
    lines.push(`| ${r.variant.label} | ${(r.winRate * 100).toFixed(1)}% | ${sign}${(delta * 100).toFixed(1)}pp | ${r.variant.description} |`);
  }
  lines.push(``);
  lines.push(`## Interpretation`);
  lines.push(``);
  const winners = results.filter((r) => r.winRate > baseline + 0.10);
  if (winners.length > 0) {
    lines.push(`**Promising variants** (more than +10pp over v4-baseline — likely real signal):`);
    for (const w of winners) {
      lines.push(`- **${w.variant.label}** at ${(w.winRate * 100).toFixed(1)}% — ${w.variant.description}`);
    }
  } else {
    lines.push(`No variant beats v4-baseline by >10pp. preserveSoftmaxPrior alone does not close the gap; the bottleneck is more than the PW prior — likely also search-rng / game-rng turn-order mismatch, or the heuristic's leaf eval being insensitive to fine-grained turn-1 distinctions.`);
  }
  lines.push(``);
  lines.push(`At n=${GAMES} per variant, 95% CI on a fair coin is ~±25pp, so differences of <10pp are within noise.`);
  lines.push(``);
  lines.push(`---`);
  lines.push(`*Generated by \`src/sweep/mcts-variants-preserve-prior.ts\`.*`);
  const md = lines.join("\n") + "\n";
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, md, "utf8");
  commitFileAndPush(OUT_PATH, `report: ${OUT_PATH.split("/").pop()}`);
  console.log(`\nDone in ${elapsedS(t0)}. Report: ${OUT_PATH}`);
}

main().catch((e: unknown) => {
  console.error(`mcts-variants-preserve-prior aborted: ${e instanceof Error ? e.message : String(e)}`);
});
