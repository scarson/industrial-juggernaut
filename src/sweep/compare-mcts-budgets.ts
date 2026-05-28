// ABOUTME: compare-mcts-budgets — h2h MCTS-at-various-iterations vs heuristic on variant (c)'s best cell.
// ABOUTME: Tests whether MCTS@25/@50 is indistinguishable from @100/@300 — if so, drop arena budgets even further.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { GamePool } from "./pool";
import { roundRobinParallel, type NamedAgentSpec } from "./run-parallel";
import { defaultConfig, type RuleConfig } from "../engine/config";
import { elapsedS } from "./format";
import { appendResultAndCommit, commitFileAndPush } from "./incremental-results";
import { workerCount } from "./worker-count";

const INCREMENTAL_PATH = resolve(process.cwd(), "docs/sweeps/data/2026-05-28-mcts-budgets.jsonl");
const OUT_PATH = resolve(process.cwd(), "docs/2026-05-28-mcts-budgets-on-c.md");

const BASE_SEED = 9_000n;
const TURN_CAP = 60;
const H2H_GAMES = 16;
const WORKERS = workerCount();

/** Variant (c) best cell — same one MCTS@300 ran on, so the data is directly comparable. */
const CONFIG_C: RuleConfig = {
  ...defaultConfig(),
  boardSize: 96,
  radius: 2,
  ironCount: 14,
  victoryThreshold: 10,
  noIronRequiresPerimeter: true,
};

// @300 is NOT re-run here — `docs/2026-05-28-mcts-300-on-c.md` already established
// MCTS@300 vs heuristic = 6.3% on a different-seed copy of the same cell. Reusing
// that data point in the report; this script only measures the cheaper budgets.
const BUDGETS = [25, 50, 100];

interface BudgetResult {
  iterations: number;
  mctsWinRate: number;
  heuristicWinRate: number;
  decisive: number;
  draws: number;
  elapsedSec: number;
}

async function runBudget(iterations: number, pool: GamePool, t0: number): Promise<BudgetResult> {
  const tStart = Date.now();
  const label = `mcts@${iterations}`;
  console.log(`\n-- ${label} vs heuristic, ${H2H_GAMES} 2P games --`);
  const agents: NamedAgentSpec[] = [
    { name: label, spec: { kind: "mcts", iterations } },
    { name: "heuristic", spec: { kind: "heuristic" } },
  ];
  const rr = await roundRobinParallel(
    agents,
    {
      playerCounts: [2],
      gamesPerMatchup: H2H_GAMES,
      seed: BASE_SEED,
      config: CONFIG_C,
      turnCap: TURN_CAP,
      onGame: (done, total, _pc, r) => {
        const w = r.winnerOrCoalition.length === 0 ? "none" : r.winnerOrCoalition.join("+");
        const summary = `${label} t=${r.turns} ${r.victoryType} w=${w}`;
        console.log(`  [${label} ${done}/${total}] ${summary} (${elapsedS(t0)})`);
        appendResultAndCommit(INCREMENTAL_PATH, {
          data: { iterations, done, total, nPlayers: 2, turns: r.turns, victoryType: r.victoryType, winner: r.winnerOrCoalition, hitTurnCap: r.hitTurnCap, elapsedSec: (Date.now() - t0) / 1000 },
          meta: { label: "mcts-budgets", done, total, summary },
        });
      },
    },
    pool,
  );
  const decisive = (rr.headToHead[label]?.["heuristic"] ?? 0) + (rr.headToHead["heuristic"]?.[label] ?? 0);
  return {
    iterations,
    mctsWinRate: rr.winRates[label] ?? 0,
    heuristicWinRate: rr.winRates["heuristic"] ?? 0,
    decisive,
    draws: H2H_GAMES - decisive,
    elapsedSec: (Date.now() - tStart) / 1000,
  };
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const pool = new GamePool(WORKERS);
  console.log(`=== MCTS budgets vs heuristic on variant (c) (baseSeed ${BASE_SEED}, ${WORKERS} workers) ===`);
  console.log(`Budgets: ${BUDGETS.join(", ")}; ${H2H_GAMES} 2P games per budget; turnCap ${TURN_CAP}`);
  console.log(`Cell: bs=96 r=2 iron=14 vt=10 noIronRequiresPerimeter=true`);

  try {
    const results: BudgetResult[] = [];
    for (const iters of BUDGETS) {
      const r = await runBudget(iters, pool, t0);
      results.push(r);
    }

    // --- Report ---
    const lines: string[] = [];
    lines.push(`# MCTS Budget Comparison on Variant (c)`);
    lines.push(``);
    lines.push(`**Date:** 2026-05-28. **Trigger:** MCTS@300 = MCTS@100 on (c); test whether even lower budgets (@25, @50) are indistinguishable, to drop arena compute further.`);
    lines.push(``);
    lines.push(`**Config:** boardSize=96, radius=2, ironCount=14, victoryThreshold=10, noIronRequiresPerimeter=true.`);
    lines.push(`**Methodology:** ${H2H_GAMES} 2P games per budget vs the perimeter-aware heuristic, baseSeed ${BASE_SEED}. Each game uses CRN.`);
    lines.push(``);
    lines.push(`## Results`);
    lines.push(``);
    lines.push(`| Budget | MCTS win% | Heuristic win% | Decisive | Draws | Elapsed (s) | Source |`);
    lines.push(`| ---: | ---: | ---: | ---: | ---: | ---: | --- |`);
    for (const r of results) {
      lines.push(`| ${r.iterations} | ${(r.mctsWinRate * 100).toFixed(1)}% | ${(r.heuristicWinRate * 100).toFixed(1)}% | ${r.decisive} | ${r.draws} | ${r.elapsedSec.toFixed(0)} | this run (seed ${BASE_SEED}) |`);
    }
    // Pre-existing @300 data point: from docs/2026-05-28-mcts-300-on-c.md (baseSeed 7000, same cell).
    lines.push(`| 300 | 6.3% | 93.8% | 16 | 0 | ~3000 | mcts-300-on-c run (seed 7000) |`);
    lines.push(``);

    // Auto-interpretation.
    const winRates = results.map((r) => r.mctsWinRate);
    const range = Math.max(...winRates) - Math.min(...winRates);
    lines.push(`## Interpretation`);
    lines.push(``);
    lines.push(`**Win-rate range across budgets:** ${(range * 100).toFixed(1)} percentage points.`);
    lines.push(``);
    if (range < 0.10) {
      lines.push(`**At ${H2H_GAMES} games per budget, the per-budget 95% CI on a fair win-rate is ~±${(1.96 * Math.sqrt(0.5 * 0.5 / H2H_GAMES) * 100).toFixed(0)}pp.** A range of ${(range * 100).toFixed(1)}pp is within (or comparable to) that CI — the budgets are statistically INDISTINGUISHABLE on this matchup. Recommendation: drop arena-default MCTS budget to the cheapest in this range (@${BUDGETS[0]}) for sweep throughput.`);
    } else {
      lines.push(`The win-rate range exceeds the sample CI; some budgets ARE different from others. The cheapest budget that matches @100's performance is the right choice for arena-default.`);
    }
    lines.push(``);
    const baselineRate = results.find((r) => r.iterations === 100)?.mctsWinRate ?? 0;
    lines.push(`Baseline @100 from MCTS-300-on-c run: 6.3% win rate. This run's @100: ${(baselineRate * 100).toFixed(1)}% (different seed; should be in the same ballpark).`);
    lines.push(``);
    lines.push(`---`);
    lines.push(`*Generated by \`src/sweep/compare-mcts-budgets.ts\`.*`);
    const md = lines.join("\n") + "\n";
    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(OUT_PATH, md, "utf8");
    commitFileAndPush(OUT_PATH, `report: ${OUT_PATH.split("/").pop()}`);
    console.log(`\nAll done in ${elapsedS(t0)}. Report: ${OUT_PATH}`);
  } finally {
    pool.close();
  }
}

void main().catch((err: unknown) => {
  console.error(`compare-mcts-budgets aborted: ${err instanceof Error ? err.message : String(err)}`);
});
