// ABOUTME: Runnable balance sweep (npx tsx src/sweep/main.ts) — two-stage geometry search + OFAT, writes the markdown report.
// ABOUTME: Stage 1 coarse-gates a wide geometry grid at low games; stage 2 refines top candidates + critique OFAT at high games.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { findBalancedConfig, balanceSweep, selectBalanced, type GridEntry } from "./orchestrate";
import { report } from "./report";
import { defaultHealthThresholds, isHealthy } from "./health";
import { defaultConfig, type RuleConfig } from "../engine/config";
import type { SweepMetrics } from "./metrics";

/**
 * Common-random-numbers base seed for the whole run. A single fixed seed across
 * every config makes the entire sweep reproducible and lets config-to-config
 * metric differences reflect the config, not seed noise.
 */
const BASE_SEED = 1_000n;

/**
 * Refine/OFAT turn cap: high enough that genuine multi-turn games terminate
 * naturally rather than being clipped (clipping would inflate capHitFraction).
 */
const REFINE_TURN_CAP = 100;

/**
 * Search-stage turn cap: kept LOW because the coarse grid is large and the slow
 * cells are precisely the deep big-board games — a 100-turn cap makes them
 * crippling. The health gate's medianTurns band tops out at 25, so a cap of 40
 * gives comfortable headroom above the ceiling: a config that mostly terminates
 * within the healthy band finishes well under 40, while one that needs >40 turns
 * has a median far above the band ceiling and fails `maxMedianTurns` regardless.
 * capHitFraction > maxCapHit at cap 40 is a legitimate "doesn't terminate" signal.
 * Survivors are re-measured at REFINE_TURN_CAP so the recommended metrics are honest.
 */
const SEARCH_TURN_CAP = 40;

/** Games per config for the coarse geometry SEARCH — enough to gate health + rank, kept small because the grid is large and big boards are slow. */
const SEARCH_GAMES = 30;

/** Games per config for the REFINE + OFAT stage — high, for tight confidence intervals on the headline balance proportions. */
const REFINE_GAMES = 150;

/** How many top healthy candidates to re-run at high games for tight metrics. */
const TOP_CANDIDATES = 3;

// Resolved against the process cwd — run from the repo root: `npx tsx src/sweep/main.ts`.
const OUT_PATH = resolve(process.cwd(), "docs/sweeps/2026-05-27-balance-report.md");

/**
 * Wide geometry grid. Includes LARGER boards deliberately — on a bigger board a
 * radius-N base disk covers a smaller fraction of the iron, which the design spec
 * and the S4 0/8-healthy small-grid signal flag as the most likely healthy region.
 *
 * boardSize and radius (the dominant, tightly-coupled geometry dims) keep their
 * full 4-value sweep. ironCount and victoryThreshold are sampled at the LOW and
 * HIGH ends of their ranges rather than every value: a board300 config costs
 * ~50s at SEARCH_GAMES, and the full 4×4×4×3 product (192 cells, ~half on the slow
 * big boards) does not finish in a sane wall-clock. Spanning the endpoints of the
 * two cheaper-to-coarsen axes (with the recommended baseline's threshold then
 * refined locally by the OFAT victoryThreshold sweep) keeps the search tractable
 * while still covering the wide boardSize range that is the point of this search.
 */
const GEOMETRY_AXES = {
  boardSize: [96, 150, 220, 300],
  radius: [2, 3, 4, 5],
  ironCount: [12, 16],
  victoryThreshold: [8, 12],
} as const satisfies Partial<Record<keyof RuleConfig, (number | boolean | string)[]>>;

/**
 * Whether a config is unwinnable-by-iron by construction: a victory threshold
 * above the total iron on the board can never be reached. findBalancedConfig owns
 * the cartesian enumeration, so such combos still get run, but we filter them out
 * of the reported grid and the candidate pool (they carry no balance signal). The
 * iron-CSP infeasibility guard inside findBalancedConfig handles the separate case
 * of iron that can't be placed at all on a small board.
 */
function isPrunable(config: RuleConfig): boolean {
  return config.ironCount < config.victoryThreshold;
}

function fmtConfig(c: RuleConfig): string {
  return `boardSize=${c.boardSize}, radius=${c.radius}, ironCount=${c.ironCount}, victoryThreshold=${c.victoryThreshold}`;
}

function fmtMetrics(m: SweepMetrics): string {
  return `med=${m.medianTurns} cap=${m.capHitFraction.toFixed(2)} setup=${m.setupDecidedFraction.toFixed(2)} iron=${m.ironVictoryFraction.toFixed(2)} seat=${m.seatWinBias.toFixed(2)} lead=${m.leadVolatility.toFixed(2)}`;
}

/** Like fmtConfig but also the OFAT-varied balance knobs, so an OFAT line shows exactly which knob is set to what. */
function fmtConfigFull(c: RuleConfig): string {
  return `${fmtConfig(c)}, autoWinAt6=${c.autoWinAt6}, killBounty=${c.killBounty}, attackRange=${c.attackRange}`;
}

/** Seconds elapsed since `t0`, as a heartbeat suffix for live progress lines. */
function elapsedS(t0: number): string {
  return `${((Date.now() - t0) / 1000).toFixed(0)}s`;
}

function main(): void {
  const t0 = Date.now();
  const thresholds = defaultHealthThresholds();
  const base = defaultConfig();

  console.log("=== Balance sweep ===");
  console.log(
    `baseSeed=${BASE_SEED} searchTurnCap=${SEARCH_TURN_CAP} refineTurnCap=${REFINE_TURN_CAP} searchGames=${SEARCH_GAMES} refineGames=${REFINE_GAMES}`,
  );
  console.log("Health thresholds:", JSON.stringify(thresholds));

  // --- Stage 1: coarse geometry search over the wide grid (small games). ---
  // Live per-config logging via onProgress — the grid runs cell-by-cell, so this
  // streams progress as each config finishes instead of going silent until the
  // whole grid is done (which made "stalled vs. slow" undiagnosable). Prunable
  // (structurally-unwinnable) cells still run but are tagged so the log is honest.
  console.log("\n--- Stage 1: geometry grid search (coarse) ---");
  const search = findBalancedConfig(GEOMETRY_AXES, base, {
    games: SEARCH_GAMES,
    turnCap: SEARCH_TURN_CAP,
    baseSeed: BASE_SEED,
    thresholds,
    onProgress: (done, total, config, metrics) => {
      if (metrics === null) {
        console.log(`[${done}/${total}] ${fmtConfig(config)} -> infeasible (${elapsedS(t0)})`);
        return;
      }
      const h = isHealthy(metrics, thresholds);
      const prunedTag = isPrunable(config) ? " [pruned: unwinnable]" : "";
      const verdict = h.pass ? "PASS" : `fail(${h.reasons.length})`;
      console.log(`[${done}/${total}] ${fmtConfig(config)} -> ${fmtMetrics(metrics)} ${verdict}${prunedTag} (${elapsedS(t0)})`);
    },
  });

  // Drop prunable combos from the reported grid so the report isn't padded with
  // structurally-unwinnable configs; the search already ran them but they add no
  // signal. (Cheap to run; clearer to exclude from the table.)
  const prunedGrid: GridEntry[] = search.grid.filter((g) => !isPrunable(g.config));
  const ran = prunedGrid.filter((g) => g.metrics !== null);
  const infeasible = prunedGrid.length - ran.length;
  const passers = prunedGrid.filter((g) => g.health.pass);

  console.log(
    `\nStage 1 done: ${ran.length} feasible, ${infeasible} infeasible/pruned-infeasible, ${passers.length} healthy at ${SEARCH_GAMES} games. (${elapsedS(t0)})`,
  );

  // --- Stage 2: refine the top candidates at high games. ---
  // Re-select over the pruned grid so prunable combos can't be recommended.
  const coarseSel = selectBalanced(prunedGrid, thresholds);

  // Candidate pool: healthy passers first (ranked), else fall back to nearest
  // misses (feasible failers with the fewest failing reasons) so the refine stage
  // still produces tight metrics on the most-promising region for the report.
  let candidates: RuleConfig[] = coarseSel.ranked.slice(0, TOP_CANDIDATES).map((r) => r.config);
  let candidateSource = "healthy passers";
  if (candidates.length === 0) {
    candidates = ran
      .slice()
      .sort((a, b) => a.health.reasons.length - b.health.reasons.length)
      .slice(0, TOP_CANDIDATES)
      .map((g) => g.config);
    candidateSource = "nearest misses (no healthy config at coarse games)";
  }

  console.log(`\n--- Stage 2: refine ${candidates.length} candidate(s) [${candidateSource}] at ${REFINE_GAMES} games ---`);
  const refinedGrid: GridEntry[] = candidates.map((config, idx) => {
    const t = Date.now();
    // Re-run this one candidate at high games through the same gate by giving
    // findBalancedConfig a single-cell grid (each axis pinned to the candidate's
    // own value). This reuses the run+gate+infeasibility-guard path without a
    // separate runConfig import.
    const single = findBalancedConfig(
      {
        boardSize: [config.boardSize],
        radius: [config.radius],
        ironCount: [config.ironCount],
        victoryThreshold: [config.victoryThreshold],
      },
      config,
      { games: REFINE_GAMES, turnCap: REFINE_TURN_CAP, baseSeed: BASE_SEED, thresholds },
    );
    const entry = single.grid[0]!;
    const m = entry.metrics;
    const verdict = entry.health.pass ? "PASS" : `FAIL: ${entry.health.reasons.join("; ")}`;
    console.log(
      `[refine ${idx + 1}/${candidates.length}] ${fmtConfig(config)} -> ${m === null ? "infeasible" : `med=${m.medianTurns} cap=${m.capHitFraction.toFixed(3)} setup=${m.setupDecidedFraction.toFixed(3)} iron=${m.ironVictoryFraction.toFixed(3)} seat=${m.seatWinBias.toFixed(3)} lead=${m.leadVolatility.toFixed(3)}`} ${verdict} (${((Date.now() - t) / 1000).toFixed(0)}s)`,
    );
    return entry;
  });

  const refinedSel = selectBalanced(refinedGrid, thresholds);
  const recommended = refinedSel.recommended;

  // --- Stage 3: OFAT balance sweep around the recommended (or best-candidate) baseline. ---
  const ofatBaseline: RuleConfig = recommended ?? candidates[0] ?? base;
  console.log(`\n--- Stage 3: OFAT balance sweep around ${fmtConfig(ofatBaseline)} at ${REFINE_GAMES} games ---`);
  const balanceAxes: (keyof RuleConfig)[] = ["autoWinAt6", "killBounty", "victoryThreshold", "attackRange"];
  const valuesPerAxis: Record<string, (number | boolean | string)[]> = {
    autoWinAt6: [true, false],
    killBounty: ["full", "half", "none"],
    // Around the baseline threshold so the OFAT is local, not a re-search.
    victoryThreshold: [ofatBaseline.victoryThreshold - 2, ofatBaseline.victoryThreshold, ofatBaseline.victoryThreshold + 2],
    attackRange: [5, 6],
  };
  const balance = balanceSweep(ofatBaseline, balanceAxes, valuesPerAxis, {
    games: REFINE_GAMES,
    turnCap: REFINE_TURN_CAP,
    baseSeed: BASE_SEED,
    onProgress: (done, total, config, metrics) => {
      console.log(
        `[ofat ${done}/${total}] ${fmtConfigFull(config)} -> ${metrics === null ? "infeasible" : fmtMetrics(metrics)} (${elapsedS(t0)})`,
      );
    },
  });

  // --- Report: recommended config (refined) + full coarse grid + OFAT tables. ---
  // The grid table shows the coarse search (the breadth); the recommended section
  // uses the refined (tight) metrics. We splice the refined entries to the front
  // of the reported grid so the recommended-config metrics are the high-games ones.
  const reportGrid: GridEntry[] = [...refinedGrid, ...prunedGrid];
  const reportSel = selectBalanced(reportGrid, thresholds);
  const md = report({
    recommended: reportSel.recommended,
    ranked: reportSel.ranked,
    grid: reportGrid,
    balance,
    gamesPerConfig: REFINE_GAMES,
    thresholds,
  });

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, md, "utf8");

  const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
  console.log(`\n=== Done in ${elapsed} min ===`);
  if (recommended !== null) {
    const refinedMetrics = refinedGrid.find((g) => g.config === recommended)?.metrics;
    console.log(`RECOMMENDED (healthy): ${fmtConfig(recommended)}`);
    if (refinedMetrics) {
      console.log(
        `  metrics: med=${refinedMetrics.medianTurns} cap=${refinedMetrics.capHitFraction.toFixed(3)} setup=${refinedMetrics.setupDecidedFraction.toFixed(3)} iron=${refinedMetrics.ironVictoryFraction.toFixed(3)} seat=${refinedMetrics.seatWinBias.toFixed(3)} lead=${refinedMetrics.leadVolatility.toFixed(3)}`,
      );
    }
  } else {
    console.log("NO HEALTHY CONFIG found in the wide grid (even after refinement). See report nearest-misses.");
  }
  console.log(`Report written to ${OUT_PATH}`);
}

main();
