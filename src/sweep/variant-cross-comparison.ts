// ABOUTME: Track V — cross-comparison of lookahead2-multi vs heuristic across variants × player counts.
// ABOUTME: Find regimes where the stronger agent shows >5pp gain over baseline — those are where strategic depth lives.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { GamePool } from "./pool";
import { roundRobinParallel, type NamedAgentSpec } from "./run-parallel";
import { defaultConfig, type RuleConfig } from "../engine/config";
import { elapsedS } from "./format";
import { appendResultAndCommit, commitFileAndPush } from "./incremental-results";
import { workerCount } from "./worker-count";

const INCREMENTAL_PATH = resolve(process.cwd(), "docs/sweeps/data/2026-05-29-variant-cross-comparison.jsonl");
const OUT_PATH = resolve(process.cwd(), "docs/2026-05-29-variant-cross-comparison.md");

const BASE_SEED = 23_000n;
const TURN_CAP = 30;
const GAMES_PER_CELL = 60;
const WORKERS = workerCount();

interface VariantDef {
  label: string;
  description: string;
  config: RuleConfig;
}

const VARIANTS: VariantDef[] = [
  { label: "default", description: "Engine default — no variants enabled.", config: defaultConfig() },
  { label: "c", description: "Variant (c) — noIronRequiresPerimeter only.", config: { ...defaultConfig(), boardSize: 96, radius: 2, ironCount: 14, victoryThreshold: 10, noIronRequiresPerimeter: true } },
  { label: "c+baseTypes", description: "Variant (c) + baseTypesEnabled — asymmetric base subtypes (forge / watchtower / outpost).", config: { ...defaultConfig(), boardSize: 96, radius: 2, ironCount: 14, victoryThreshold: 10, noIronRequiresPerimeter: true, baseTypesEnabled: true } },
];
const PLAYER_COUNTS = [2, 3, 4] as const;

interface CellResult {
  variant: VariantDef;
  nPlayers: number;
  lookaheadWinRate: number;
  heuristicWinRate: number;
  baseline: number;     // 1/nPlayers
  delta: number;        // lookaheadWinRate - baseline
  medianTurns: number;
  elapsedSec: number;
}

async function runCell(variant: VariantDef, nPlayers: number, pool: GamePool, t0: number): Promise<CellResult> {
  const tStart = Date.now();
  const baseline = 1 / nPlayers;
  const label = `${variant.label}/${nPlayers}P`;
  console.log(`\n-- ${label} (${GAMES_PER_CELL} games, lookahead2-multi vs heuristic) --`);

  // Build N named agents: lookahead2-multi at slot 0, heuristics filling the rest.
  const agents: NamedAgentSpec[] = [{ name: "lookahead2-multi", spec: { kind: "lookahead2-multi" } }];
  for (let i = 1; i < nPlayers; i++) {
    agents.push({ name: `heuristic-${String.fromCharCode(64 + i)}`, spec: { kind: "heuristic" } });
  }

  const turnsList: number[] = [];
  let lookaheadWinRate = 0;
  let heuristicWinRate = 0;

  try {
    const rr = await roundRobinParallel(
      agents,
      {
        playerCounts: [nPlayers],
        gamesPerMatchup: GAMES_PER_CELL,
        seed: BASE_SEED,
        config: variant.config,
        turnCap: TURN_CAP,
        onGame: (done, total, _pc, r) => {
          turnsList.push(r.turns);
          const w = r.winnerOrCoalition.length === 0 ? "none" : r.winnerOrCoalition.join("+");
          const summary = `${label} t=${r.turns} ${r.victoryType} w=${w}`;
          if (done % 20 === 0 || done === total) {
            console.log(`  [${label} ${done}/${total}] ${summary} (${elapsedS(t0)})`);
          }
          appendResultAndCommit(INCREMENTAL_PATH, {
            data: {
              variant: variant.label, nPlayers, done, total,
              turns: r.turns, victoryType: r.victoryType,
              winner: r.winnerOrCoalition, hitTurnCap: r.hitTurnCap,
              elapsedSec: (Date.now() - t0) / 1000,
            },
            meta: { label: "variant-cross", done, total, summary },
          });
        },
      },
      pool,
    );
    lookaheadWinRate = rr.winRates["lookahead2-multi"] ?? 0;
    // Heuristic win rate = sum of all heuristic-X seats.
    let h = 0;
    for (let i = 1; i < nPlayers; i++) {
      const name = `heuristic-${String.fromCharCode(64 + i)}`;
      h += rr.winRates[name] ?? 0;
    }
    heuristicWinRate = h;
  } catch (e) {
    console.error(`  ${label} FAILED: ${e instanceof Error ? e.message : String(e)}`);
  }

  const sortedTurns = [...turnsList].sort((a, b) => a - b);
  const medianTurns = sortedTurns.length === 0 ? 0
    : sortedTurns.length % 2 === 0 ? (sortedTurns[sortedTurns.length / 2 - 1]! + sortedTurns[sortedTurns.length / 2]!) / 2
    : sortedTurns[Math.floor(sortedTurns.length / 2)]!;

  return {
    variant, nPlayers, lookaheadWinRate, heuristicWinRate, baseline,
    delta: lookaheadWinRate - baseline,
    medianTurns,
    elapsedSec: (Date.now() - tStart) / 1000,
  };
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const pool = new GamePool(WORKERS);
  console.log(`=== Variant cross-comparison (baseSeed ${BASE_SEED}, ${WORKERS} workers) ===`);
  console.log(`Variants: ${VARIANTS.map((v) => v.label).join(", ")} × playerCounts: ${PLAYER_COUNTS.join(",")}, ${GAMES_PER_CELL} games/cell.`);

  const results: CellResult[] = [];
  try {
    for (const v of VARIANTS) {
      for (const n of PLAYER_COUNTS) {
        const r = await runCell(v, n, pool, t0);
        results.push(r);
      }
    }
  } finally {
    pool.close();
  }

  // Report.
  const lines: string[] = [];
  lines.push(`# Variant Cross-Comparison (Track V)`);
  lines.push(``);
  lines.push(`**Date:** 2026-05-29. **Trigger:** find regimes where lookahead2-multi shows >5pp gain over per-player baseline. Those are regimes where strategic depth (= the 2-ply search advantage) actually MATTERS. Regimes where Δ ≈ 0 are "mechanical" — the heuristic plays at near-optimal strength and skill ceiling is low.`);
  lines.push(``);
  lines.push(`**Methodology:** ${GAMES_PER_CELL} games/cell, lookahead2-multi at seat 0 (rotating across seats via round-robin), other seats heuristic, baseSeed ${BASE_SEED}, turnCap ${TURN_CAP}.`);
  lines.push(``);
  lines.push(`## Results`);
  lines.push(``);
  lines.push(`| Variant | nP | Baseline | lookahead2-multi% | Heuristic combined% | Δ (vs baseline) | Median turns | Verdict |`);
  lines.push(`| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |`);
  for (const r of results) {
    const verdict = r.delta > 0.05 ? "**strategic depth**" : r.delta < -0.05 ? "agent under" : "mechanical";
    lines.push(`| ${r.variant.label} | ${r.nPlayers} | ${(r.baseline * 100).toFixed(1)}% | ${(r.lookaheadWinRate * 100).toFixed(1)}% | ${(r.heuristicWinRate * 100).toFixed(1)}% | ${r.delta >= 0 ? "+" : ""}${(r.delta * 100).toFixed(1)}pp | ${r.medianTurns} | ${verdict} |`);
  }
  lines.push(``);
  lines.push(`## Interpretation`);
  lines.push(``);
  const strategic = results.filter((r) => r.delta > 0.05);
  const mechanical = results.filter((r) => Math.abs(r.delta) <= 0.05);
  if (strategic.length > 0) {
    lines.push(`**Strategic-depth regimes** (lookahead2-multi shows >5pp gain — there IS room for skill expression here):`);
    for (const r of strategic) {
      lines.push(`- ${r.variant.label} / ${r.nPlayers}P: +${(r.delta * 100).toFixed(1)}pp over ${(r.baseline * 100).toFixed(0)}% baseline.`);
    }
    lines.push(``);
  }
  if (mechanical.length > 0) {
    lines.push(`**Mechanical regimes** (lookahead2-multi within ±5pp of baseline — the heuristic plays at near-optimal strength):`);
    for (const r of mechanical) {
      lines.push(`- ${r.variant.label} / ${r.nPlayers}P: Δ ${r.delta >= 0 ? "+" : ""}${(r.delta * 100).toFixed(1)}pp.`);
    }
    lines.push(``);
  }
  lines.push(`A "mechanical" regime is one where a 2-ply lookahead can't beat the 1-ply heuristic — meaning either the heuristic IS playing near-optimally OR the game's setup-decided structure leaves no room for late-game improvement. Both interpretations have the same gameplay implication: low skill ceiling.`);
  lines.push(``);
  lines.push(`---`);
  lines.push(`*Generated by \`src/sweep/variant-cross-comparison.ts\`.*`);
  const md = lines.join("\n") + "\n";
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, md, "utf8");
  commitFileAndPush(OUT_PATH, `report: ${OUT_PATH.split("/").pop()}`);
  console.log(`\nDone in ${elapsedS(t0)}. Report: ${OUT_PATH}`);
}

main().catch((e: unknown) => {
  console.error(`variant-cross-comparison aborted: ${e instanceof Error ? e.message : String(e)}`);
});
