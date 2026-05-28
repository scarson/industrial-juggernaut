// ABOUTME: Calibrated re-run (npx tsx src/sweep/calibrate.ts) — high-games focused search around S5's b96/r2/vt12 near-misses.
// ABOUTME: Answers "is the seatBias failure real or a small-sample artifact?" by running 600 games/config and reporting per-count seatBias.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { findBalancedConfig, balanceSweep, selectBalanced, type GridEntry } from "./orchestrate";
import { report } from "./report";
import { defaultHealthThresholds, isHealthy } from "./health";
import { fmtConfig, fmtConfigFull, fmtMetrics, elapsedS } from "./format";
import { appendResultAndCommit } from "./incremental-results";
import { defaultConfig, type RuleConfig } from "../engine/config";

const INCREMENTAL_PATH = resolve(process.cwd(), "docs/sweeps/data/calibrate-sweep.jsonl");

/** CRN base seed (shared across configs so config-to-config differences aren't seed noise). */
const BASE_SEED = 1_000n;

/** Turn cap: bs96 games are short, so 100 never clips a genuine multi-turn game. */
const TURN_CAP = 100;

/**
 * Games per config. S5 ran 150; the headline S5 finding was that seatBias failures
 * sit at the statistical noise floor (per-seat CI ≈ ±0.18 at ~30 games/seat-count).
 * 600 quadruples the sample so the lower player counts (2–4P) get enough games/seat
 * to separate real first-mover advantage from noise. The 6P bucket (120 games ÷ 6
 * seats ≈ 20/seat) is STILL noisy — which is exactly why this run reports per-count
 * seatBias, not just the max-over-counts aggregate the gate uses.
 */
const GAMES = 600;

const OUT_PATH = resolve(process.cwd(), "docs/sweeps/2026-05-27-calibration-report.md");

/**
 * Narrow grid around S5's two single-criterion near-misses (both boardSize=96,
 * radius=2, victoryThreshold=12): `iron12/vt12` failed only seatBias 0.233 (the
 * suspected-noise miss), `iron16/vt12` failed only medianTurns=2 (one under the
 * min-3 "has depth" band). We sweep a tight neighborhood: radius {2,3}, ironCount
 * {12,14,16}, victoryThreshold {11,12,13}. The vt axis is the established length
 * lever (S5 OFAT: vt10→median 2, vt12→3, vt14→18-but-ironVic-collapses), so vt13
 * probes the median-3-with-healthy-ironVic sweet spot above the near-miss.
 */
const CALIBRATION_AXES = {
  boardSize: [96],
  radius: [2, 3],
  ironCount: [12, 14, 16],
  victoryThreshold: [11, 12, 13],
} as const satisfies Partial<Record<keyof RuleConfig, (number | boolean | string)[]>>;

/** ironCount < victoryThreshold is unwinnable-by-iron by construction; run but tag/skip in tables. */
function isPrunable(config: RuleConfig): boolean {
  return config.ironCount < config.victoryThreshold;
}

function main(): void {
  const t0 = Date.now();
  const thresholds = defaultHealthThresholds();
  const base = defaultConfig();

  console.log("=== Calibrated re-run (focused, high-games) ===");
  console.log(`baseSeed=${BASE_SEED} turnCap=${TURN_CAP} games=${GAMES}`);
  console.log("Health thresholds:", JSON.stringify(thresholds));
  console.log("Grid:", JSON.stringify(CALIBRATION_AXES));

  // --- Focused grid search at high games. ---
  console.log("\n--- Focused grid search ---");
  const search = findBalancedConfig(CALIBRATION_AXES, base, {
    games: GAMES,
    turnCap: TURN_CAP,
    baseSeed: BASE_SEED,
    thresholds,
    onProgress: (done, total, config, metrics) => {
      if (metrics === null) {
        const summary = `${fmtConfig(config)} infeasible`;
        console.log(`[${done}/${total}] ${fmtConfig(config)} -> infeasible (${elapsedS(t0)})`);
        appendResultAndCommit(INCREMENTAL_PATH, {
          data: { stage: "grid", done, total, config, metrics: null, infeasible: true, elapsedSec: (Date.now() - t0) / 1000 },
          meta: { label: "calibrate-grid", done, total, summary },
        });
        return;
      }
      const h = isHealthy(metrics, thresholds);
      const prunedTag = isPrunable(config) ? " [pruned: unwinnable]" : "";
      const verdict = h.pass ? "PASS" : `fail(${h.reasons.length}: ${h.reasons.join("; ")})`;
      const summary = `${fmtConfig(config)} ${h.pass ? "PASS" : `fail(${h.reasons.length})`}${prunedTag}`;
      console.log(`[${done}/${total}] ${fmtConfig(config)} -> ${fmtMetrics(metrics)} ${verdict}${prunedTag} (${elapsedS(t0)})`);
      appendResultAndCommit(INCREMENTAL_PATH, {
        data: { stage: "grid", done, total, config, metrics, healthy: h.pass, reasons: h.reasons, pruned: isPrunable(config), elapsedSec: (Date.now() - t0) / 1000 },
        meta: { label: "calibrate-grid", done, total, summary },
      });
    },
  });

  const grid: GridEntry[] = search.grid.filter((g) => !isPrunable(g.config));
  const ran = grid.filter((g) => g.metrics !== null);
  const passers = grid.filter((g) => g.health.pass);
  console.log(
    `\nGrid done: ${ran.length} feasible, ${passers.length} healthy at ${GAMES} games. (${elapsedS(t0)})`,
  );

  const sel = selectBalanced(grid, thresholds);
  const recommended = sel.recommended;

  // OFAT around the recommended (or the lowest-reason near-miss) baseline.
  const ofatBaseline: RuleConfig =
    recommended ??
    ran.slice().sort((a, b) => a.health.reasons.length - b.health.reasons.length)[0]?.config ??
    base;
  console.log(`\n--- OFAT balance sweep around ${fmtConfig(ofatBaseline)} at ${GAMES} games ---`);
  const balanceAxes: (keyof RuleConfig)[] = ["autoWinAt6", "killBounty", "victoryThreshold", "attackRange"];
  const valuesPerAxis: Record<string, (number | boolean | string)[]> = {
    autoWinAt6: [true, false],
    killBounty: ["full", "half", "none"],
    victoryThreshold: [ofatBaseline.victoryThreshold - 1, ofatBaseline.victoryThreshold, ofatBaseline.victoryThreshold + 1],
    attackRange: [5, 6],
  };
  const balance = balanceSweep(ofatBaseline, balanceAxes, valuesPerAxis, {
    games: GAMES,
    turnCap: TURN_CAP,
    baseSeed: BASE_SEED,
    onProgress: (done, total, config, metrics) => {
      const summary = `OFAT ${fmtConfigFull(config)} ${metrics === null ? "infeasible" : fmtMetrics(metrics)}`;
      console.log(
        `[ofat ${done}/${total}] ${fmtConfigFull(config)} -> ${metrics === null ? "infeasible" : fmtMetrics(metrics)} (${elapsedS(t0)})`,
      );
      appendResultAndCommit(INCREMENTAL_PATH, {
        data: { stage: "ofat", done, total, config, metrics, infeasible: metrics === null, elapsedSec: (Date.now() - t0) / 1000 },
        meta: { label: "calibrate-ofat", done, total, summary },
      });
    },
  });

  // --- Report (the per-count seatBias section is emitted by report() itself). ---
  const md = report({
    recommended: sel.recommended,
    ranked: sel.ranked,
    grid,
    balance,
    gamesPerConfig: GAMES,
    thresholds,
  });

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, md, "utf8");

  const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
  console.log(`\n=== Done in ${elapsed} min ===`);
  if (recommended !== null) {
    console.log(`RECOMMENDED (healthy): ${fmtConfig(recommended)}`);
  } else {
    console.log("NO HEALTHY CONFIG in the focused grid at 600 games. See report nearest-misses + per-count seatBias.");
  }
  console.log(`Report written to ${OUT_PATH}`);
}

main();
