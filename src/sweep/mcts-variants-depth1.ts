// ABOUTME: MCTS variants v3 — maxDepth=1 variants that force evalOpts to fire at non-terminal leaves.
// ABOUTME: Per Sam's request to test MCTS fixes; v2's terminal-leaf bypass meant prng-aware/iron-share never fired.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { GamePool } from "./pool";
import { roundRobinParallel, type NamedAgentSpec } from "./run-parallel";
import { defaultConfig, type RuleConfig } from "../engine/config";
import { elapsedS } from "./format";
import { appendResultAndCommit, commitFileAndPush } from "./incremental-results";
import { workerCount } from "./worker-count";
import type { AgentSpec } from "./agent-spec";

const INCREMENTAL_PATH = resolve(process.cwd(), "docs/sweeps/data/2026-05-29-mcts-variants-depth1.jsonl");
const OUT_PATH = resolve(process.cwd(), "docs/2026-05-29-mcts-variants-depth1.md");

const BASE_SEED = 37_000n;
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
 * v3 hypothesis: maxDepth=1 forces leafValue to use the NON-TERMINAL softmax over
 * evaluate() — which is where evalOpts (prng-aware, iron-share) actually fire.
 *
 * At maxDepth=8 (v2 baseline), most (c) 2P rollouts hit terminal at depth ≤ 2,
 * where leafValue returns a hard [1/0] win-loss vector that DOES NOT call evaluate.
 * So the evalOpts variants saw the bonus only during PW candidate scoring, never
 * in the leaf value — and they all came out at 0%.
 *
 * At maxDepth=1, we cut search before the game's natural terminal. The leaf is
 * almost always non-terminal, and evalOpts directly bias the softmax. This is the
 * cleanest test of whether the playtest-derived eval extensions move MCTS.
 */
const VARIANTS: Variant[] = [
  { label: "d1-baseline",            description: "@50 + maxDepth=1 (non-terminal softmax eval — vanilla heuristic)",                            spec: { kind: "mcts", iterations: 50, maxDepth: 1 } },
  { label: "d1-prng-aware",          description: "@50 + maxDepth=1 + PRNG-aware leaf eval (weight=5)",                                          spec: { kind: "mcts", iterations: 50, maxDepth: 1, evalOpts: { prngAwareDeterministic: true } } },
  { label: "d1-prng-aware-strong",   description: "@50 + maxDepth=1 + PRNG-aware (weight=20)",                                                   spec: { kind: "mcts", iterations: 50, maxDepth: 1, evalOpts: { prngAwareDeterministic: true, prngAwareWeight: 20 } } },
  { label: "d1-iron-share",          description: "@50 + maxDepth=1 + iron-share leaf eval (tabletop-valid, weight=5)",                          spec: { kind: "mcts", iterations: 50, maxDepth: 1, evalOpts: { ironShare: true } } },
  { label: "d1-iron-share-strong",   description: "@50 + maxDepth=1 + iron-share (weight=20)",                                                   spec: { kind: "mcts", iterations: 50, maxDepth: 1, evalOpts: { ironShare: true, ironShareWeight: 20 } } },
  { label: "d1-fixed",               description: "@50 + maxDepth=1 + candidateMode=fixed (greedy always included)",                             spec: { kind: "mcts", iterations: 50, maxDepth: 1, candidateMode: "fixed" } },
  { label: "d1-fixed+prng-aware",    description: "@50 + maxDepth=1 + fixed + PRNG-aware",                                                       spec: { kind: "mcts", iterations: 50, maxDepth: 1, candidateMode: "fixed", evalOpts: { prngAwareDeterministic: true } } },
  { label: "d1-fixed+iron-share",    description: "@50 + maxDepth=1 + fixed + iron-share",                                                       spec: { kind: "mcts", iterations: 50, maxDepth: 1, candidateMode: "fixed", evalOpts: { ironShare: true } } },
  { label: "d1-temp-0.01+prng-aware", description: "@50 + maxDepth=1 + temperature=0.01 (near-greedy PW) + PRNG-aware",                          spec: { kind: "mcts", iterations: 50, maxDepth: 1, temperature: 0.01, evalOpts: { prngAwareDeterministic: true } } },
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
            meta: { label: "mcts-variants-depth1", done, total, summary },
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
  console.log(`=== MCTS variants depth-1 comparison (baseSeed ${BASE_SEED}, ${WORKERS} workers) ===`);
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
  lines.push(`# MCTS Variants v3 — maxDepth=1 + eval-opts at @50 iterations`);
  lines.push(``);
  lines.push(`**Date:** 2026-05-29. **Trigger:** v2 variants all scored 0% because (c) 2P games end at turn 2, so leafValue returned hard terminal win/loss vectors before evalOpts could bias the softmax. v3 caps search at depth=1 so leafValue ALWAYS uses softmax over \`evaluate(state, opts)\` — the path where prng-aware / iron-share extensions actually live.`);
  lines.push(``);
  lines.push(`**Reference:**`);
  lines.push(`- heuristic = baseline strong.`);
  lines.push(`- lookahead2 = 80.7% vs heuristic on (c) 2P (target ceiling).`);
  lines.push(`- v2 baseline @50 maxDepth=8 = 0%.`);
  lines.push(``);
  lines.push(`**Methodology:** ${GAMES} 2P games per variant, variant (c), baseSeed ${BASE_SEED}.`);
  lines.push(``);
  lines.push(`## Results (sorted by win rate)`);
  lines.push(``);
  lines.push(`| Variant | Win rate | Δ vs d1-baseline | Description |`);
  lines.push(`| --- | ---: | ---: | --- |`);
  const baseline = results.find((r) => r.variant.label === "d1-baseline")?.winRate ?? 0;
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
    lines.push(`**Promising variants** (more than +10pp over d1-baseline — likely real signal):`);
    for (const w of winners) {
      lines.push(`- **${w.variant.label}** at ${(w.winRate * 100).toFixed(1)}% — ${w.variant.description}`);
    }
  } else {
    lines.push(`No variant beats d1-baseline by >10pp. The eval-opts bonus alone is insufficient at maxDepth=1; the structural issue is deeper (PW prior equalization or search-rng / game-rng mismatch).`);
  }
  lines.push(``);
  lines.push(`At n=${GAMES} per variant, 95% CI on a fair coin is ~±25pp, so differences of <10pp are within noise.`);
  lines.push(``);
  lines.push(`---`);
  lines.push(`*Generated by \`src/sweep/mcts-variants-depth1.ts\`.*`);
  const md = lines.join("\n") + "\n";
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, md, "utf8");
  commitFileAndPush(OUT_PATH, `report: ${OUT_PATH.split("/").pop()}`);
  console.log(`\nDone in ${elapsedS(t0)}. Report: ${OUT_PATH}`);
}

main().catch((e: unknown) => {
  console.error(`mcts-variants-depth1 aborted: ${e instanceof Error ? e.message : String(e)}`);
});
