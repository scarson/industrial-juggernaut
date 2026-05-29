// ABOUTME: Quick MCTS variant comparison at @50 iterations. Tests config tweaks to see which closes the gap vs heuristic.
// ABOUTME: All variants test on (c) 2P, 16 games each. Per Sam's request to identify MCTS fixes that play "more like Opus."

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { GamePool } from "./pool";
import { roundRobinParallel, type NamedAgentSpec } from "./run-parallel";
import { defaultConfig, type RuleConfig } from "../engine/config";
import { elapsedS } from "./format";
import { appendResultAndCommit, commitFileAndPush } from "./incremental-results";
import { workerCount } from "./worker-count";
import type { AgentSpec } from "./agent-spec";

const INCREMENTAL_PATH = resolve(process.cwd(), "docs/sweeps/data/2026-05-29-mcts-variants-quick.jsonl");
const OUT_PATH = resolve(process.cwd(), "docs/2026-05-29-mcts-variants-quick.md");

const BASE_SEED = 36_000n;
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
 * Variants to test at MCTS@50:
 *
 * Hypotheses:
 *  - baseline: control. Expected 0% per prior data.
 *  - fixed: candidateMode="fixed" — always includes the heuristic's greedy action. Expected: ties heuristic.
 *  - temp-0.1: PW with low temperature — samples closer to argmax. Expected: closer to heuristic.
 *  - temp-0.01: PW with near-zero temperature — effectively argmax sampling. Expected: matches heuristic.
 *  - maxdepth-2: capped search depth to 2 — matches Opus's 2-ply minimax structure. Expected: maybe better than baseline.
 *  - maxdepth-2+fixed: depth=2 + fixed candidates. Expected: closest to lookahead2 in structure.
 *  - low-cpuct: cPuct=0.5 (default ~1.4). Less exploration → more exploitation. Expected: closer to argmax.
 */
const VARIANTS: Variant[] = [
  { label: "baseline",          description: "Default @50: PW, T=1, cPuct default, maxDepth 8",                       spec: { kind: "mcts", iterations: 50 } },
  { label: "fixed-candidates",  description: "@50 + candidateMode=fixed (greedy action always included)",             spec: { kind: "mcts", iterations: 50, candidateMode: "fixed" } },
  { label: "temp-0.1",          description: "@50 + PW temperature=0.1 (samples close to argmax)",                    spec: { kind: "mcts", iterations: 50, temperature: 0.1 } },
  { label: "temp-0.01",         description: "@50 + PW temperature=0.01 (near-pure-argmax sampling)",                 spec: { kind: "mcts", iterations: 50, temperature: 0.01 } },
  { label: "depth-2",           description: "@50 + maxDepth=2 (matches Opus's 2-ply structure)",                     spec: { kind: "mcts", iterations: 50, maxDepth: 2 } },
  { label: "depth-2+fixed",     description: "@50 + maxDepth=2 + candidateMode=fixed",                                spec: { kind: "mcts", iterations: 50, candidateMode: "fixed", maxDepth: 2 } },
  { label: "low-cpuct",         description: "@50 + cPuct=0.5 (less exploration, more exploitation)",                 spec: { kind: "mcts", iterations: 50, cPuct: 0.5 } },
  // Eval-opts variants — code-level fixes that augment the heuristic leaf eval.
  { label: "prng-aware",        description: "@50 + PRNG-aware leaf eval (peeks T2 turn-order draw, weight=5)",       spec: { kind: "mcts", iterations: 50, evalOpts: { prngAwareDeterministic: true } } },
  { label: "iron-share",        description: "@50 + iron-share leaf eval (tabletop-valid 'who probably goes first')", spec: { kind: "mcts", iterations: 50, evalOpts: { ironShare: true } } },
  { label: "prng-aware+fixed",  description: "@50 + PRNG-aware + candidateMode=fixed (combo)",                        spec: { kind: "mcts", iterations: 50, candidateMode: "fixed", evalOpts: { prngAwareDeterministic: true } } },
  { label: "prng-aware-strong", description: "@50 + PRNG-aware with weight=20 (stronger turn-order bias)",            spec: { kind: "mcts", iterations: 50, evalOpts: { prngAwareDeterministic: true, prngAwareWeight: 20 } } },
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
            meta: { label: "mcts-variants-quick", done, total, summary },
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
  console.log(`=== MCTS variants quick comparison (baseSeed ${BASE_SEED}, ${WORKERS} workers) ===`);
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

  // Sort results by win rate descending so the best variants surface at the top.
  results.sort((a, b) => b.winRate - a.winRate);

  const lines: string[] = [];
  lines.push(`# MCTS Variants — Quick Comparison @50 iterations`);
  lines.push(``);
  lines.push(`**Date:** 2026-05-29. **Trigger:** Sam asked which MCTS fix approaches play "more like Opus." Each variant tests one architectural tweak on top of the @50 baseline (which gets 0% vs heuristic).`);
  lines.push(``);
  lines.push(`**Reference:**`);
  lines.push(`- heuristic = baseline strong (target to match or beat).`);
  lines.push(`- lookahead2 = 80.7% vs heuristic on (c) 2P. The "ceiling" we're trying to approach.`);
  lines.push(`- MCTS@50 baseline = 0% (per A1-era earlier data).`);
  lines.push(``);
  lines.push(`**Methodology:** ${GAMES} 2P games per variant, variant (c), baseSeed ${BASE_SEED}.`);
  lines.push(``);
  lines.push(`## Results (sorted by win rate)`);
  lines.push(``);
  lines.push(`| Variant | Win rate | Δ vs baseline | Description |`);
  lines.push(`| --- | ---: | ---: | --- |`);
  const baseline = results.find((r) => r.variant.label === "baseline")?.winRate ?? 0;
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
    lines.push(`**Promising variants** (more than +10pp over baseline — likely real signal):`);
    for (const w of winners) {
      lines.push(`- **${w.variant.label}** at ${(w.winRate * 100).toFixed(1)}% — ${w.variant.description}`);
    }
  } else {
    lines.push(`No variant shows clear improvement >10pp over baseline. May need code-level fixes (PRNG-aware leaf eval, broader PW candidate diversity beyond config knobs).`);
  }
  lines.push(``);
  lines.push(`At n=${GAMES} per variant, 95% CI on a fair coin is ~±25pp, so differences of <10pp are within noise. The best variants should be re-tested at higher n (50+) to confirm.`);
  lines.push(``);
  lines.push(`---`);
  lines.push(`*Generated by \`src/sweep/mcts-variants-quick.ts\`.*`);
  const md = lines.join("\n") + "\n";
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, md, "utf8");
  commitFileAndPush(OUT_PATH, `report: ${OUT_PATH.split("/").pop()}`);
  console.log(`\nDone in ${elapsedS(t0)}. Report: ${OUT_PATH}`);
}

main().catch((e: unknown) => {
  console.error(`mcts-variants-quick aborted: ${e instanceof Error ? e.message : String(e)}`);
});
