// ABOUTME: mcts-300-on-c — stress-test variant (c)'s best cell with a stronger MCTS (300 iter) to disambiguate the gate-2 failure.
// ABOUTME: Hypothesis: MCTS@100 lost h2h to the heuristic because the heuristic is near-optimal on (c)-modified games; MCTS@300 should recover.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { GamePool } from "./pool";
import { runConfigParallel, roundRobinParallel, type NamedAgentSpec } from "./run-parallel";
import { defaultConfig, type RuleConfig } from "../engine/config";
import { defaultHealthThresholds, isHealthy } from "./health";
import { elapsedS, fmtMetrics } from "./format";
import { appendResultAndCommit } from "./incremental-results";
import type { SweepMetrics } from "./metrics";

const INCREMENTAL_PATH = resolve(process.cwd(), "docs/sweeps/data/2026-05-28-mcts-300-on-c.jsonl");

const BASE_SEED = 7_000n;
const TURN_CAP = 60;
const HEALTH_GAMES = 12;
const HEALTH_COUNTS = [2, 3];
const H2H_GAMES = 16;
const WORKERS = 4;
const OUT_PATH = resolve(process.cwd(), "docs/2026-05-28-mcts-300-on-c.md");

/** Variant (c)'s best cell from the comparison run. */
const CONFIG_C: RuleConfig = {
  ...defaultConfig(),
  boardSize: 96,
  radius: 2,
  ironCount: 14,
  victoryThreshold: 10,
  noIronRequiresPerimeter: true,
};

async function main(): Promise<void> {
  const t0 = Date.now();
  const pool = new GamePool(WORKERS);
  console.log(`=== MCTS@300 stress test on variant (c) (baseSeed ${BASE_SEED}, ${WORKERS} workers) ===`);
  console.log(`Cell: bs=96 r=2 iron=14 vt=10 noIronRequiresPerimeter=true`);

  try {
    // --- All-MCTS@300 self-play health ---
    console.log(`\n-- All-MCTS@300 health: ${HEALTH_GAMES} games, counts ${HEALTH_COUNTS.join(",")}, turnCap ${TURN_CAP} --`);
    let mctsMetrics: SweepMetrics | null = null;
    try {
      mctsMetrics = await runConfigParallel(
        CONFIG_C,
        {
          games: HEALTH_GAMES,
          turnCap: TURN_CAP,
          baseSeed: BASE_SEED,
          playerCounts: HEALTH_COUNTS,
          agentSpec: { kind: "mcts", iterations: 300 },
          onGame: (done, total, n, r) => {
            const w = r.winnerOrCoalition.length === 0 ? "none" : r.winnerOrCoalition.join("+");
            const summary = `${n}P t=${r.turns} ${r.victoryType} w=${w}`;
            console.log(`  [mcts@300 ${done}/${total}] ${summary} (${elapsedS(t0)})`);
            appendResultAndCommit(INCREMENTAL_PATH, {
              data: { phase: "health", done, total, nPlayers: n, turns: r.turns, victoryType: r.victoryType, winner: r.winnerOrCoalition, hitTurnCap: r.hitTurnCap, elapsedSec: (Date.now() - t0) / 1000 },
              meta: { label: "mcts-300-on-c-health", done, total, summary },
            });
          },
        },
        pool,
      );
    } catch (err) {
      console.error(`  all-MCTS@300 health FAILED: ${err instanceof Error ? err.message : String(err)} — recording partial data and continuing.`);
    }

    // --- 2P MCTS@300 vs heuristic head-to-head ---
    console.log(`\n-- 2P MCTS@300 vs heuristic head-to-head: ${H2H_GAMES} games, turnCap ${TURN_CAP} --`);
    const agents: NamedAgentSpec[] = [
      { name: "mcts300", spec: { kind: "mcts", iterations: 300 } },
      { name: "heuristic", spec: { kind: "heuristic" } },
    ];
    let h2h: { mctsWinRate: number; heuristicWinRate: number; decisive: number } | null = null;
    try {
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
            const summary = `2P h2h t=${r.turns} ${r.victoryType} w=${w}`;
            console.log(`  [h2h ${done}/${total}] ${summary} (${elapsedS(t0)})`);
            appendResultAndCommit(INCREMENTAL_PATH, {
              data: { phase: "h2h", done, total, nPlayers: 2, turns: r.turns, victoryType: r.victoryType, winner: r.winnerOrCoalition, hitTurnCap: r.hitTurnCap, elapsedSec: (Date.now() - t0) / 1000 },
              meta: { label: "mcts-300-on-c-h2h", done, total, summary },
            });
          },
        },
        pool,
      );
      h2h = {
        mctsWinRate: rr.winRates["mcts300"] ?? 0,
        heuristicWinRate: rr.winRates["heuristic"] ?? 0,
        decisive: (rr.headToHead["mcts300"]?.["heuristic"] ?? 0) + (rr.headToHead["heuristic"]?.["mcts300"] ?? 0),
      };
    } catch (err) {
      console.error(`  h2h FAILED: ${err instanceof Error ? err.message : String(err)} — recording partial data and continuing.`);
    }

    // --- Report ---
    const lines: string[] = [];
    lines.push(`# MCTS@300 Stress Test on Variant (c)`);
    lines.push(``);
    lines.push(`**Date:** 2026-05-28 (overnight). **Trigger:** Sam — diagnose whether the comparison-run gate-2 failure (MCTS@100 lost h2h to heuristic 0-6% under (c)) reflects (a) heuristic being genuinely near-optimal on the (c) regime, or (b) MCTS@100 being too weak. MCTS@300 (3x search) should recover h2h if (b); should not recover if (a).`);
    lines.push(``);
    lines.push(`**Config:** boardSize=96, radius=2, ironCount=14, victoryThreshold=10, noIronRequiresPerimeter=true.`);
    lines.push(`**Methodology:** ${HEALTH_GAMES} all-MCTS@300 games on counts ${HEALTH_COUNTS.join(",")}, turnCap ${TURN_CAP}; ${H2H_GAMES}-game 2P MCTS@300 vs heuristic h2h. baseSeed ${BASE_SEED}.`);
    lines.push(``);
    lines.push(`## Results`);
    lines.push(``);
    if (mctsMetrics) {
      const verdict = isHealthy(mctsMetrics, defaultHealthThresholds());
      lines.push(`**All-MCTS@300 health:** ${fmtMetrics(mctsMetrics)} ${verdict.pass ? "PASS (default gate)" : `FAIL on (default gate): ${verdict.reasons.join("; ")}`}`);
      const vt = mctsMetrics.victoryType;
      lines.push(`- victoryType mix: iron=${vt.iron ?? 0}, last-standing=${vt["last-standing"] ?? 0}, none(cap)=${vt.none ?? 0} of ${mctsMetrics.gamesPlayed}.`);
    } else {
      lines.push(`**All-MCTS@300 health:** FAILED to run.`);
    }
    if (h2h) {
      lines.push(``);
      lines.push(`**2P MCTS@300 vs heuristic h2h:** mctsWinRate=${(h2h.mctsWinRate * 100).toFixed(1)}% vs heuristicWinRate=${(h2h.heuristicWinRate * 100).toFixed(1)}% over ${H2H_GAMES} games (decisive ${h2h.decisive}).`);
      const compMcts100Rate = 6.3; // From the comparison run for reference
      const delta = (h2h.mctsWinRate * 100) - compMcts100Rate;
      lines.push(`- Comparison baseline: MCTS@100 lost h2h ${compMcts100Rate}% vs 93.8% heuristic. MCTS@300 delta = ${delta > 0 ? "+" : ""}${delta.toFixed(1)} percentage points.`);
      lines.push(``);
      if (h2h.mctsWinRate > 0.30) {
        lines.push(`**Interpretation:** MCTS@300 recovered meaningfully vs heuristic; the gate-2 failure at @100 was a SEARCH-DEPTH issue, not a structural one. Variant (c) is healthy under stronger MCTS.`);
      } else {
        lines.push(`**Interpretation:** MCTS@300 did NOT recover meaningfully (still ≤30% win rate). The heuristic appears near-optimal on the (c) regime — adding search depth doesn't help. This is a finding about agent strength on (c), not about (c)'s validity.`);
      }
    } else {
      lines.push(`**2P MCTS@300 vs heuristic h2h:** FAILED to run.`);
    }
    lines.push(``);
    lines.push(`---`);
    lines.push(`*Generated by \`src/sweep/mcts-300-on-c.ts\`.*`);

    const md = lines.join("\n") + "\n";
    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(OUT_PATH, md, "utf8");
    console.log(`\nAll done in ${elapsedS(t0)}. Report: ${OUT_PATH}`);
  } finally {
    pool.close();
  }
}

void main().catch((err: unknown) => {
  console.error(`mcts-300-on-c aborted: ${err instanceof Error ? err.message : String(err)}`);
});
