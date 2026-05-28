// ABOUTME: explore-c-variant — wider grid search under variant (c) noIronRequiresPerimeter, then MCTS-revalidate the top cells.
// ABOUTME: Follow-up to compare-variants — if a (c) config passes the gates under MCTS, Sam's adoption decision is much cleaner.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { GamePool } from "./pool";
import { runConfigParallel, findBalancedConfigParallel } from "./run-parallel";
import { defaultConfig, type RuleConfig } from "../engine/config";
import { defaultHealthThresholds, isHealthy } from "./health";
import { elapsedS, fmtMetrics, fmtConfig } from "./format";
import type { SweepMetrics } from "./metrics";
import type { GridEntry } from "./orchestrate";

const BASE_SEED = 6_000n;
const GREEDY_TURN_CAP = 100;
const MCTS_TURN_CAP = 60;
const MCTS_ITERS = 100;
const GAMES_PER_CONFIG = 150;
const MCTS_HEALTH_GAMES = 12;
const MCTS_HEALTH_COUNTS = [2, 3];
const WORKERS = 4;
const TOP_N_REVALIDATE = 3;
const OUT_PATH = resolve(process.cwd(), "docs/2026-05-28-c-variant-deeper.md");

/** Wider grid than the comparison run: 2 board sizes, 3 radii, 3 iron counts, 3 thresholds. After
 * the "vt >= ironCount is unwinnable-by-iron" infeasibility prune, ~45 of 54 cells are viable. */
const GRID: Partial<Record<keyof RuleConfig, (number | boolean | string)[]>> = {
  boardSize: [96, 150],
  radius: [2, 3, 4],
  ironCount: [12, 14, 16],
  victoryThreshold: [10, 12, 14],
};

const BASE_CONFIG: RuleConfig = {
  ...defaultConfig(),
  noIronRequiresPerimeter: true, // <-- the variant (c) flag, ON
};

/** Rank a grid entry: primarily by # of gate failures (fewer better), then ironVic (higher better),
 * then median turns closest to the middle of the [3, 25] healthy band. Used to pick the top cells. */
function rankScore(entry: GridEntry): number {
  if (entry.metrics === null) return 1e6; // infeasible: rank last
  const failPenalty = entry.health.reasons.length * 1000;
  const ironBonus = -entry.metrics.ironVictoryFraction * 100; // higher iron => more negative => better rank
  const medTurns = entry.metrics.medianTurns;
  const target = 8; // middle of [3, 15] heuristic-band
  const lengthPenalty = Math.abs(medTurns - target);
  return failPenalty + ironBonus + lengthPenalty;
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const thresholds = defaultHealthThresholds();
  const pool = new GamePool(WORKERS);

  console.log(`=== Explore variant (c) — wider grid (${BASE_SEED} seed, ${WORKERS} workers) ===`);
  console.log(`Flag: noIronRequiresPerimeter=true. Grid: bs × r × iron × vt = ${Object.values(GRID).map((v) => v.length).join("×")} = ${Object.values(GRID).reduce((a, b) => a * b.length, 1)} cells (pruned where vt >= ironCount).`);

  try {
    // --- Greedy grid search ---
    console.log(`\n-- Greedy grid (${GAMES_PER_CONFIG} games/config, turnCap ${GREEDY_TURN_CAP}) --`);
    const gridResult = await findBalancedConfigParallel(
      GRID,
      BASE_CONFIG,
      {
        games: GAMES_PER_CONFIG,
        turnCap: GREEDY_TURN_CAP,
        baseSeed: BASE_SEED,
        agentSpec: { kind: "heuristic" },
        thresholds,
        onConfig: (done, total, config, metrics) => {
          const m = metrics === null ? "INFEASIBLE" : fmtMetrics(metrics);
          console.log(`  [${done}/${total}] bs=${config.boardSize} r=${config.radius} iron=${config.ironCount} vt=${config.victoryThreshold} -> ${m} (${elapsedS(t0)})`);
        },
      },
      pool,
    );

    const healthyCount = gridResult.grid.filter((g) => g.health.pass).length;
    const feasibleCount = gridResult.grid.filter((g) => g.metrics !== null).length;
    console.log(`\nGrid summary: ${gridResult.grid.length} total cells, ${feasibleCount} feasible, ${healthyCount} healthy under greedy.`);

    // --- Pick top cells to MCTS-revalidate ---
    const ranked = gridResult.grid
      .filter((g) => g.metrics !== null)
      .slice()
      .sort((a, b) => rankScore(a) - rankScore(b));
    const top = ranked.slice(0, TOP_N_REVALIDATE);
    console.log(`\n-- Top ${top.length} cells by rank, to MCTS-revalidate --`);
    for (let i = 0; i < top.length; i++) {
      const g = top[i]!;
      console.log(`  #${i + 1}: ${fmtConfig(g.config)} -> ${fmtMetrics(g.metrics!)} ${g.health.pass ? "GREEDY HEALTHY" : `(fails ${g.health.reasons.length}: ${g.health.reasons.join("; ")})`}`);
    }

    // --- MCTS revalidate each top cell ---
    interface MctsCellResult {
      config: RuleConfig;
      greedy: SweepMetrics;
      greedyHealthy: boolean;
      mcts: SweepMetrics | null;
      mctsHealthy: boolean | null;
      elapsedSec: number;
    }
    const mctsResults: MctsCellResult[] = [];
    for (const entry of top) {
      const tCell = Date.now();
      console.log(`\n-- MCTS revalidation of ${fmtConfig(entry.config)} (${MCTS_HEALTH_GAMES} games, counts ${MCTS_HEALTH_COUNTS.join(",")}, turnCap ${MCTS_TURN_CAP}, ${MCTS_ITERS}-iter) --`);
      let mctsMetrics: SweepMetrics | null = null;
      let mctsHealthy: boolean | null = null;
      try {
        mctsMetrics = await runConfigParallel(
          entry.config,
          {
            games: MCTS_HEALTH_GAMES,
            turnCap: MCTS_TURN_CAP,
            baseSeed: BASE_SEED,
            playerCounts: MCTS_HEALTH_COUNTS,
            agentSpec: { kind: "mcts", iterations: MCTS_ITERS },
            onGame: (done, total, nPlayers, result) => {
              const w = result.winnerOrCoalition.length === 0 ? "none" : result.winnerOrCoalition.join("+");
              console.log(`    [${done}/${total}] ${nPlayers}P -> t=${result.turns} ${result.victoryType} w=${w} (${elapsedS(t0)})`);
            },
          },
          pool,
        );
        mctsHealthy = isHealthy(mctsMetrics, thresholds).pass;
      } catch (err) {
        console.error(`  MCTS revalidation FAILED: ${err instanceof Error ? err.message : String(err)} — continuing.`);
      }
      mctsResults.push({
        config: entry.config,
        greedy: entry.metrics!,
        greedyHealthy: entry.health.pass,
        mcts: mctsMetrics,
        mctsHealthy,
        elapsedSec: (Date.now() - tCell) / 1000,
      });
    }

    // --- Write report ---
    const lines: string[] = [];
    lines.push(`# Variant (c) noIronRequiresPerimeter — Deeper Grid Validation`);
    lines.push(``);
    lines.push(`**Date:** 2026-05-28 (overnight follow-up to the comparison run).`);
    lines.push(`**Driving question:** with the load-bearing flag from the comparison experiment, does ANY config in a wider grid pass health under MCTS — making variant (c) adoption-ready?`);
    lines.push(`**Companion:** \`2026-05-28-rules-variants-synthesis.md\` (the comparison that surfaced (c) as the load-bearing fix).`);
    lines.push(`**Methodology:** focused wider grid, all under \`noIronRequiresPerimeter: true\`. Greedy: ${GAMES_PER_CONFIG} games/config, baseSeed ${BASE_SEED}. MCTS revalidation: ${MCTS_HEALTH_GAMES} games on counts ${MCTS_HEALTH_COUNTS.join(",")}, turnCap ${MCTS_TURN_CAP}, ${MCTS_ITERS}-iter, on the top-${TOP_N_REVALIDATE} ranked cells.`);
    lines.push(``);
    lines.push(`## Grid summary`);
    lines.push(`- Total cells: ${gridResult.grid.length}`);
    lines.push(`- Feasible (iron-CSP + vt < ironCount): ${feasibleCount}`);
    lines.push(`- Greedy-healthy (all 7 gates passed): ${healthyCount}`);
    lines.push(``);
    lines.push(`## Top-${TOP_N_REVALIDATE} ranked cells — greedy vs MCTS`);
    lines.push(``);
    lines.push(`| Rank | Config | Greedy healthy? | Greedy metrics | MCTS healthy? | MCTS metrics | MCTS iron-vic | MCTS median |`);
    lines.push(`| --- | --- | --- | --- | --- | --- | --- | --- |`);
    for (let i = 0; i < mctsResults.length; i++) {
      const r = mctsResults[i]!;
      const cfg = fmtConfig(r.config);
      const gh = r.greedyHealthy ? "YES" : "no";
      const gm = fmtMetrics(r.greedy);
      const mh = r.mctsHealthy === null ? "—" : r.mctsHealthy ? "YES" : "no";
      const mm = r.mcts === null ? "—" : fmtMetrics(r.mcts);
      const miron = r.mcts === null ? "—" : r.mcts.ironVictoryFraction.toFixed(2);
      const mmed = r.mcts === null ? "—" : r.mcts.medianTurns.toString();
      lines.push(`| #${i + 1} | ${cfg} | ${gh} | ${gm} | ${mh} | ${mm} | ${miron} | ${mmed} |`);
    }
    lines.push(``);

    // Greedy-healthy cells (the "easy" wins under greedy — for reference)
    const greedyHealthy = gridResult.grid.filter((g) => g.health.pass);
    if (greedyHealthy.length > 0) {
      lines.push(`## Greedy-healthy cells (${greedyHealthy.length})`);
      lines.push(``);
      lines.push(`| Config | Greedy metrics |`);
      lines.push(`| --- | --- |`);
      for (const g of greedyHealthy) {
        lines.push(`| ${fmtConfig(g.config)} | ${fmtMetrics(g.metrics!)} |`);
      }
      lines.push(``);
    } else {
      lines.push(`## Greedy-healthy cells`);
      lines.push(``);
      lines.push(`None — no cell passed all 7 health gates under greedy in this grid.`);
      lines.push(``);
    }

    // Interpretation
    lines.push(`## Interpretation (auto-flagged, not Sam's verdict)`);
    const mctsHealthyAny = mctsResults.some((r) => r.mctsHealthy === true);
    const ironRevived = mctsResults.some((r) => r.mcts !== null && r.mcts.ironVictoryFraction >= 0.3);
    if (mctsHealthyAny) {
      const winners = mctsResults.filter((r) => r.mctsHealthy === true).map((r) => fmtConfig(r.config));
      lines.push(`- **At least one cell PASSED all 7 gates under MCTS:** ${winners.join(", ")}. Variant (c) is adoption-feasible at this geometry.`);
    } else {
      lines.push(`- **No cell passed all 7 strict gates under MCTS** in this top-${TOP_N_REVALIDATE} sample. The strict gate may need recalibration for the (c) regime, OR a wider/different grid is needed.`);
    }
    if (ironRevived) {
      lines.push(`- **Iron victory revived under MCTS** (≥30% on at least one cell) — the substantive game-character improvement (c) delivers, even where strict gates don't all pass.`);
    }
    lines.push(`- Recall: even at 150 games, gate stability (seatBias, leadVolatility) is noise-limited at 12 MCTS games. A passing/failing gate at MCTS-revalidation should be read directionally, not as a hard verdict.`);
    lines.push(``);
    lines.push(`---`);
    lines.push(`*Generated by \`src/sweep/explore-c-variant.ts\`.*`);

    const md = lines.join("\n") + "\n";
    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(OUT_PATH, md, "utf8");
    console.log(`\nAll done in ${elapsedS(t0)}. Report: ${OUT_PATH}`);
  } finally {
    pool.close();
  }
}

void main().catch((err: unknown) => {
  console.error(`explore-c-variant aborted: ${err instanceof Error ? err.message : String(err)}`);
});
