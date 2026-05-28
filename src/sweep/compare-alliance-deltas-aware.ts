// ABOUTME: compare-alliance-deltas-aware — Phase 5 of the alliance-aware-agent-policy plan.
// ABOUTME: Re-run the Phase 7 (blind) alliance-delta comparison with the now-alliance-aware heuristic to see whether the alliance dynamic changes.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { GamePool } from "./pool";
import { runConfigParallel } from "./run-parallel";
import { defaultConfig, type RuleConfig } from "../engine/config";
import { elapsedS, fmtMetrics } from "./format";
import { appendResultAndCommit, commitFileAndPush } from "./incremental-results";
import { workerCount } from "./worker-count";
import type { SweepMetrics } from "./metrics";

const INCREMENTAL_PATH = resolve(process.cwd(), "docs/sweeps/data/2026-05-28-alliance-deltas-aware.jsonl");
const OUT_PATH = resolve(process.cwd(), "docs/2026-05-28-alliance-comparison-aware.md");

/**
 * Same base seed as the Phase 7 sweep so the seed-indexed games line up — any
 * differences between the two reports trace directly to the agent change
 * (alliance-blind → alliance-aware), not a different draw of boards/seats.
 */
const BASE_SEED = 8_000n;
const TURN_CAP = 60;
const GAMES = 150;
const WORKERS = workerCount();
const PLAYER_COUNTS = [3, 4];

const BASE_CONFIG: RuleConfig = {
  ...defaultConfig(),
  boardSize: 96,
  radius: 2,
  ironCount: 14,
  victoryThreshold: 10,
  noIronRequiresPerimeter: true,
};

interface AllianceVariant {
  label: string;
  description: string;
  flags: Partial<RuleConfig>;
}

const VARIANTS: AllianceVariant[] = [
  { label: "alliances OFF (baseline)", description: "No alliances available; heuristic self-play.", flags: { alliancesEnabled: false } },
  { label: "alliances ON, delta=2", description: "Alliances enabled, +2 iron per ally member needed for coalition victory.", flags: { alliancesEnabled: true, allianceVictoryDelta: 2 } },
  { label: "alliances ON, delta=3", description: "Alliances enabled, +3 iron per ally member.", flags: { alliancesEnabled: true, allianceVictoryDelta: 3 } },
  { label: "alliances ON, delta=4 (default)", description: "Alliances enabled, +4 iron per ally member (proposed default).", flags: { alliancesEnabled: true, allianceVictoryDelta: 4 } },
  { label: "alliances ON, delta=5", description: "Alliances enabled, +5 iron per ally member (more aggressive anti-gang-up).", flags: { alliancesEnabled: true, allianceVictoryDelta: 5 } },
];

interface VariantResult {
  variant: AllianceVariant;
  metrics: SweepMetrics | null;
  elapsedSec: number;
  coalitionWins: number;
  totalGames: number;
}

async function runVariant(variant: AllianceVariant, pool: GamePool, t0: number): Promise<VariantResult> {
  const tStart = Date.now();
  const config: RuleConfig = { ...BASE_CONFIG, ...variant.flags };
  let coalitionWins = 0;
  let totalGames = 0;

  console.log(`\n=== ${variant.label} ===`);
  let metrics: SweepMetrics | null = null;
  try {
    metrics = await runConfigParallel(
      config,
      {
        games: GAMES,
        turnCap: TURN_CAP,
        baseSeed: BASE_SEED,
        playerCounts: PLAYER_COUNTS,
        // Default heuristic now enumerates ally/break-alliance candidates (Phase 1+2). The
        // chosen weight (5) is the Phase 3 sweep's recommendation. Spec is serializable so
        // worker processes rebuild the same agent.
        agentSpec: { kind: "heuristic", allianceWeight: 5, breakAllianceWeight: 5 },
        onGame: (done, total, n, r) => {
          totalGames += 1;
          if (r.winnerOrCoalition.length > 1) coalitionWins += 1;
          const w = r.winnerOrCoalition.length === 0 ? "none" : r.winnerOrCoalition.join("+");
          const summary = `${variant.label} ${n}P t=${r.turns} ${r.victoryType} w=${w}`;
          if (done % 25 === 0 || done === total) {
            console.log(`  [${variant.label} ${done}/${total}] ${summary} (${elapsedS(t0)})`);
          }
          appendResultAndCommit(INCREMENTAL_PATH, {
            data: {
              variant: variant.label,
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
            meta: { label: "alliance-deltas-aware", done, total, summary },
          });
        },
      },
      pool,
    );
  } catch (err) {
    console.error(`  ${variant.label} FAILED: ${err instanceof Error ? err.message : String(err)}`);
  }
  return {
    variant,
    metrics,
    elapsedSec: (Date.now() - tStart) / 1000,
    coalitionWins,
    totalGames,
  };
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const pool = new GamePool(WORKERS);
  console.log(`=== Alliance-delta comparison (alliance-aware agent) (baseSeed ${BASE_SEED}, ${WORKERS} workers) ===`);
  console.log(`Common config: boardSize=96 radius=2 ironCount=14 victoryThreshold=10 noIronRequiresPerimeter=true`);
  console.log(`Player counts: ${PLAYER_COUNTS.join(",")}; games/variant: ${GAMES}`);
  console.log(`Agent: heuristic, allianceWeight=5, breakAllianceWeight=5 (Phase 3 recommendation)`);

  try {
    const results: VariantResult[] = [];
    for (const v of VARIANTS) {
      const r = await runVariant(v, pool, t0);
      results.push(r);
    }

    const lines: string[] = [];
    lines.push(`# Alliance-Delta Comparison Sweep — Alliance-Aware Agent (Phase 5)`);
    lines.push(``);
    lines.push(`**Date:** 2026-05-28. **Trigger:** Phase 5 of the alliance-aware-agent-policy plan. Re-run the original alliance-delta comparison (Phase 7, alliance-blind heuristic) with the now-alliance-aware heuristic (default weight=5 from Phase 3). Same seeds + same configs → any difference traces to the agent change.`);
    lines.push(``);
    lines.push(`**Compare to:** \`docs/2026-05-28-alliance-comparison.md\` (the original alliance-blind run with the SAME seeds and configs).`);
    lines.push(``);
    lines.push(`## Verdict matrix`);
    lines.push(``);
    lines.push(`| Variant | Median turns | Iron-vic | Last-standing | CapHit | Coalition-win rate | Notes |`);
    lines.push(`| --- | --- | --- | --- | --- | --- | --- |`);
    for (const r of results) {
      if (r.metrics === null) {
        lines.push(`| ${r.variant.label} | — | — | — | — | — | FAILED |`);
        continue;
      }
      const vt = r.metrics.victoryType;
      const lsFraction = ((vt["last-standing"] ?? 0) / r.metrics.gamesPlayed).toFixed(2);
      const coalRate = r.totalGames > 0 ? r.coalitionWins / r.totalGames : 0;
      lines.push(
        `| ${r.variant.label} | ${r.metrics.medianTurns} | ${r.metrics.ironVictoryFraction.toFixed(2)} | ${lsFraction} | ${r.metrics.capHitFraction.toFixed(2)} | ${(coalRate * 100).toFixed(1)}% | ${r.elapsedSec.toFixed(0)}s |`,
      );
    }
    lines.push(``);
    lines.push(`## Per-variant detail`);
    for (const r of results) {
      lines.push(``);
      lines.push(`### ${r.variant.label}`);
      lines.push(``);
      lines.push(r.variant.description);
      if (r.metrics) {
        lines.push(`**Metrics:** ${fmtMetrics(r.metrics)}`);
        const vt = r.metrics.victoryType;
        lines.push(`**Victory mix:** iron=${vt.iron ?? 0}, last-standing=${vt["last-standing"] ?? 0}, none(cap)=${vt.none ?? 0} of ${r.metrics.gamesPlayed} games.`);
        lines.push(`**Coalition wins (size ≥ 2):** ${r.coalitionWins} of ${r.totalGames} (${((r.coalitionWins / r.totalGames) * 100).toFixed(1)}%).`);
      }
    }
    lines.push(``);
    lines.push(`## Interpretation notes (auto-flagged)`);
    const baseline = results[0]?.metrics;
    if (baseline) {
      const baseIron = baseline.ironVictoryFraction;
      for (let i = 1; i < results.length; i++) {
        const r = results[i]!;
        if (r.metrics === null) continue;
        const deltaIron = r.metrics.ironVictoryFraction - baseIron;
        const sign = deltaIron > 0 ? "+" : "";
        lines.push(`- **${r.variant.label}**: iron-vic ${sign}${deltaIron.toFixed(2)} vs baseline.`);
      }
    }
    lines.push(``);
    lines.push(`---`);
    lines.push(`*Generated by \`src/sweep/compare-alliance-deltas-aware.ts\`.*`);
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
  console.error(`compare-alliance-deltas-aware aborted: ${err instanceof Error ? err.message : String(err)}`);
});
