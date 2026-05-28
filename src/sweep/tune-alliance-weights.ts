// ABOUTME: tune-alliance-weights — Phase 3 of the alliance-aware-agent-policy plan. Sweep allianceWeight ∈ {0,1,3,5,10}
// ABOUTME: in 3P heuristic self-play on variant (c); measure coalition-win rate, victory mix, median turns. Pick a default.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { GamePool } from "./pool";
import { runConfigParallel } from "./run-parallel";
import { defaultConfig, type RuleConfig } from "../engine/config";
import { elapsedS } from "./format";
import { appendResultAndCommit, commitFileAndPush } from "./incremental-results";
import { workerCount } from "./worker-count";
import type { SweepMetrics } from "./metrics";

const INCREMENTAL_PATH = resolve(process.cwd(), "docs/sweeps/data/2026-05-28-alliance-weights.jsonl");
const OUT_PATH = resolve(process.cwd(), "docs/2026-05-28-alliance-weights-tuning.md");

const BASE_SEED = 11_000n;
const TURN_CAP = 60;
const GAMES_PER_WEIGHT = 50;
const PLAYER_COUNTS = [3] as const;
const WORKERS = workerCount();

/** Variant (c) with alliances enabled (the regime where alliance dynamics should be most visible). */
const CONFIG_C_ALLIANCE: RuleConfig = {
  ...defaultConfig(),
  boardSize: 96,
  radius: 2,
  ironCount: 14,
  victoryThreshold: 10,
  noIronRequiresPerimeter: true,
  alliancesEnabled: true,
  allianceVictoryDelta: 4,
};

/**
 * Weight grid. Includes 0 as a control (alliance-blind heuristic — matches Phase 7 baseline).
 * Includes 10 to test whether high weight produces over-coupling.
 */
const ALLIANCE_WEIGHTS = [0, 1, 3, 5, 10];

interface PerWeightResult {
  allianceWeight: number;
  games: number;
  metrics: SweepMetrics | null;
  coalitionWins: number;
  ironWins: number;
  lastStandingWins: number;
  noWins: number;
  meanCoalitionSizeAtWin: number;
  medianTurns: number;
  elapsedSec: number;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

async function runAtWeight(allianceWeight: number, pool: GamePool, t0: number): Promise<PerWeightResult> {
  const tStart = Date.now();
  const label = `aw=${allianceWeight}`;
  console.log(`\n-- allianceWeight = ${allianceWeight}, ${GAMES_PER_WEIGHT} 3P games --`);

  let coalitionWins = 0;
  let ironWins = 0;
  let lastStandingWins = 0;
  let noWins = 0;
  const coalitionSizesAtWin: number[] = [];
  const turnsList: number[] = [];

  let metrics: SweepMetrics | null = null;
  try {
    metrics = await runConfigParallel(
      CONFIG_C_ALLIANCE,
      {
        games: GAMES_PER_WEIGHT,
        turnCap: TURN_CAP,
        baseSeed: BASE_SEED,
        playerCounts: [...PLAYER_COUNTS],
        agentSpec: { kind: "heuristic", allianceWeight },
        onGame: (done, total, n, r) => {
          turnsList.push(r.turns);
          if (r.victoryType === "iron") {
            ironWins += 1;
            if (r.winnerOrCoalition.length > 1) {
              coalitionWins += 1;
              coalitionSizesAtWin.push(r.winnerOrCoalition.length);
            }
          } else if (r.victoryType === "last-standing") {
            lastStandingWins += 1;
            if (r.winnerOrCoalition.length > 1) {
              coalitionWins += 1;
              coalitionSizesAtWin.push(r.winnerOrCoalition.length);
            }
          } else {
            noWins += 1;
          }
          const w = r.winnerOrCoalition.length === 0 ? "none" : r.winnerOrCoalition.join("+");
          const summary = `${label} ${n}P t=${r.turns} ${r.victoryType} w=${w}`;
          console.log(`  [${label} ${done}/${total}] ${summary} (${elapsedS(t0)})`);
          appendResultAndCommit(INCREMENTAL_PATH, {
            data: {
              allianceWeight,
              done,
              total,
              nPlayers: n,
              turns: r.turns,
              victoryType: r.victoryType,
              winner: r.winnerOrCoalition,
              coalitionSize: r.winnerOrCoalition.length,
              hitTurnCap: r.hitTurnCap,
              elapsedSec: (Date.now() - t0) / 1000,
            },
            meta: { label: "alliance-weights", done, total, summary },
          });
        },
      },
      pool,
    );
  } catch (err) {
    console.error(`  weight ${allianceWeight} FAILED: ${err instanceof Error ? err.message : String(err)}`);
  }

  const meanCoalitionSizeAtWin =
    coalitionSizesAtWin.length === 0
      ? 0
      : coalitionSizesAtWin.reduce((a, b) => a + b, 0) / coalitionSizesAtWin.length;

  return {
    allianceWeight,
    games: turnsList.length,
    metrics,
    coalitionWins,
    ironWins,
    lastStandingWins,
    noWins,
    meanCoalitionSizeAtWin,
    medianTurns: median(turnsList),
    elapsedSec: (Date.now() - tStart) / 1000,
  };
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const pool = new GamePool(WORKERS);
  console.log(`=== Alliance-weight tuning sweep (baseSeed ${BASE_SEED}, ${WORKERS} workers) ===`);
  console.log(`Weights: ${ALLIANCE_WEIGHTS.join(", ")}; ${GAMES_PER_WEIGHT} 3P games per weight; turnCap ${TURN_CAP}`);
  console.log(`Cell: bs=96 r=2 iron=14 vt=10 noIronRequiresPerimeter=true alliancesEnabled=true delta=4`);

  try {
    const results: PerWeightResult[] = [];
    for (const w of ALLIANCE_WEIGHTS) {
      const r = await runAtWeight(w, pool, t0);
      results.push(r);
    }

    // --- Report ---
    const lines: string[] = [];
    lines.push(`# Alliance-Weight Tuning Sweep`);
    lines.push(``);
    lines.push(`**Date:** 2026-05-28. **Trigger:** Phase 3 of the alliance-aware-agent-policy plan. Pick a default \`POLICY_ALLIANCE_WEIGHT\` for the alliance-aware heuristic.`);
    lines.push(``);
    lines.push(`**Config:** boardSize=96, radius=2, ironCount=14, victoryThreshold=10, noIronRequiresPerimeter=true, alliancesEnabled=true, allianceVictoryDelta=4.`);
    lines.push(`**Methodology:** for each weight in ${JSON.stringify(ALLIANCE_WEIGHTS)}, ${GAMES_PER_WEIGHT} 3P heuristic-self-play games on variant (c), baseSeed ${BASE_SEED}.`);
    lines.push(``);
    lines.push(`## Results`);
    lines.push(``);
    lines.push(`| Weight | Games | Iron-win | Last-std | Cap-hit | Coalition wins | Mean coal. size | Median turns | Elapsed (s) |`);
    lines.push(`| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`);
    for (const r of results) {
      const coalRate = r.games > 0 ? r.coalitionWins / r.games : 0;
      lines.push(
        `| ${r.allianceWeight} | ${r.games} | ${r.ironWins} | ${r.lastStandingWins} | ${r.noWins} | ${r.coalitionWins} (${(coalRate * 100).toFixed(1)}%) | ${r.meanCoalitionSizeAtWin.toFixed(2)} | ${r.medianTurns.toFixed(1)} | ${r.elapsedSec.toFixed(0)} |`,
      );
    }
    lines.push(``);

    // Auto-interpretation.
    const w0 = results.find((r) => r.allianceWeight === 0);
    const wMax = results.find((r) => r.allianceWeight === ALLIANCE_WEIGHTS[ALLIANCE_WEIGHTS.length - 1]);
    lines.push(`## Interpretation`);
    lines.push(``);
    if (w0 && wMax) {
      const baseCoal = w0.games > 0 ? w0.coalitionWins / w0.games : 0;
      const maxCoal = wMax.games > 0 ? wMax.coalitionWins / wMax.games : 0;
      lines.push(
        `**Coalition-win rate at weight=0:** ${(baseCoal * 100).toFixed(1)}% (control — alliance-blind heuristic).`,
      );
      lines.push(
        `**Coalition-win rate at weight=${wMax.allianceWeight}:** ${(maxCoal * 100).toFixed(1)}%.`,
      );
      lines.push(``);
      if (maxCoal - baseCoal > 0.1) {
        lines.push(
          `Coalition wins INCREASED meaningfully with allianceWeight — the heuristic is using alliances strategically when the weight is on. A weight that produces ~30-50% coalition-win rate (or the highest non-monotone-collapse value) is the recommended default.`,
        );
      } else {
        lines.push(
          `Coalition wins DID NOT increase meaningfully with allianceWeight (Δ ≤ 10pp). Either: (a) alliances rarely become game-deciding under the current configuration (despite the heuristic choosing them); (b) the heuristic's alliance choices are not converting to coalition victories (e.g., alliances form and then break / get exploited). Investigate via per-game alliance-event instrumentation in a follow-up.`,
        );
      }
      lines.push(``);
      lines.push(`**Recommended default:** see the row with the highest coalition-win rate that is below 75% (avoid over-coupling where alliances dominate every game).`);
    }
    lines.push(``);
    lines.push(`---`);
    lines.push(`*Generated by \`src/sweep/tune-alliance-weights.ts\`.*`);
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
  console.error(`tune-alliance-weights aborted: ${err instanceof Error ? err.message : String(err)}`);
});
