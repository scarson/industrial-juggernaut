// ABOUTME: compare-variants — runs the 3 rules variants (a/b/c) + baseline through one common grid under greedy, then MCTS-revalidates each variant's best cell.
// ABOUTME: Writes a comparison report at docs/2026-05-28-rules-variants-comparison.md. Methodology: docs/plans/2026-05-28-rules-variants-experiment-methodology.md.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { GamePool } from "./pool";
import { runConfigParallel, findBalancedConfigParallel, type NamedAgentSpec } from "./run-parallel";
import { roundRobinParallel } from "./run-parallel";
import { defaultConfig, type RuleConfig } from "../engine/config";
import { defaultHealthThresholds, isHealthy } from "./health";
import { elapsedS, fmtMetrics } from "./format";
import { appendResultAndCommit, commitFileAndPush } from "./incremental-results";
import { workerCount } from "./worker-count";
import type { SweepMetrics } from "./metrics";

const INCREMENTAL_PATH = resolve(process.cwd(), "docs/sweeps/data/2026-05-28-compare-variants.jsonl");

/** Variants under test — each is `defaultConfig() + boardSize:96 + the variant's flag overrides`. */
interface Variant {
  /** Short label used in the report headers and console logs. */
  label: string;
  /** One- or two-line description for the report's per-variant section. */
  description: string;
  /** Flag overrides on top of the base config — empty for the baseline. */
  flags: Partial<RuleConfig>;
}

const VARIANTS: Variant[] = [
  { label: "baseline", description: "Current default rules (all variant flags off). The control — what the calibration validated under greedy and the revalidation overturned under MCTS.", flags: {} },
  {
    label: "(a) P3",
    description: "Variant (a): perimeter-gate victory-iron + perimeter-gate noIron elimination together. Iron only counts toward victory once committed in a perimeter; radiating players with 0 iron aren't eliminated.",
    flags: { victoryIronRequiresPerimeter: true, noIronRequiresPerimeter: true },
  },
  {
    label: "(b) P2 hold=2",
    description: "Variant (b): iron victory requires holding the threshold across 2 consecutive end-of-turn checks (one rollover of denial pressure before victory fires).",
    flags: { victoryIronHoldRounds: 2 },
  },
  {
    label: "(b) P2 hold=3",
    description: "Variant (b) with a longer hold: 3 consecutive end-of-turn checks. Probes whether the hold *length* matters.",
    flags: { victoryIronHoldRounds: 3 },
  },
  {
    label: "(c) noIron-perimeter",
    description: "Variant (c): perimeter-gate noIron alone, without changing the victory model. Iron-denial elimination still wins games, but only after the player has committed a perimeter — preventing turn-1 collapse.",
    flags: { noIronRequiresPerimeter: true },
  },
];

const BASE_CONFIG_OVERRIDES: Partial<RuleConfig> = { boardSize: 96 };

/** Focused grid identical across variants — only the flag changes between runs, so differences are attributable to the flag. */
const GRID: Partial<Record<keyof RuleConfig, (number | boolean | string)[]>> = {
  radius: [2, 3],
  ironCount: [12, 14],
  victoryThreshold: [10, 12],
};

const GAMES_PER_CONFIG = 150;
const GREEDY_TURN_CAP = 100;
const MCTS_TURN_CAP = 60;
const MCTS_ITERS = 100;
const MCTS_HEALTH_GAMES = 12;
const MCTS_HEALTH_COUNTS = [2, 3];
const H2H_GAMES = 16;
const BASE_SEED = 5_000n;
const WORKERS = workerCount();
const OUT_PATH = resolve(process.cwd(), "docs/2026-05-28-rules-variants-comparison.md");

interface VariantResult {
  variant: Variant;
  baseConfig: RuleConfig;
  /** Healthy-under-greedy if found; else best-ranked nearest-miss; else null if grid was empty. */
  bestCell: RuleConfig | null;
  bestCellWasHealthy: boolean;
  bestCellGreedyMetrics: SweepMetrics | null;
  /** MCTS-revalidation metrics for the best cell. null if no best cell. */
  mctsMetrics: SweepMetrics | null;
  mctsWasHealthy: boolean | null;
  /** MCTS-vs-heuristic 2P head-to-head on the best cell — mctsWinRate, heuristicWinRate, decisive count. */
  h2h: { mctsWinRate: number; heuristicWinRate: number; decisive: number } | null;
  elapsedSec: number;
}

async function runVariant(variant: Variant, pool: GamePool, t0: number): Promise<VariantResult> {
  const tStart = Date.now();
  const baseConfig: RuleConfig = { ...defaultConfig(), ...BASE_CONFIG_OVERRIDES, ...variant.flags };
  const thresholds = defaultHealthThresholds();

  console.log(`\n=== Variant: ${variant.label} ===`);
  console.log(`flags: ${JSON.stringify(variant.flags)}`);

  // --- Greedy grid search ---
  console.log(`-- greedy grid (${GAMES_PER_CONFIG} games/config, turnCap ${GREEDY_TURN_CAP}) --`);
  const gridResult = await findBalancedConfigParallel(
    GRID,
    baseConfig,
    {
      games: GAMES_PER_CONFIG,
      turnCap: GREEDY_TURN_CAP,
      baseSeed: BASE_SEED,
      agentSpec: { kind: "heuristic" },
      thresholds,
      onConfig: (done, total, config, metrics) => {
        const m = metrics === null ? "INFEASIBLE" : fmtMetrics(metrics);
        console.log(`  [${variant.label} ${done}/${total}] r=${config.radius} iron=${config.ironCount} vt=${config.victoryThreshold} -> ${m} (${elapsedS(t0)})`);
      },
    },
    pool,
  );

  // Pick the best cell. Priority: (1) a config that passes all 7 health gates (gridResult.recommended);
  // (2) the ranked nearest-miss list (populated only with healthy configs by selectBalanced — so usually
  // (1) is the only path here); (3) FALLBACK: the grid entry that fails the FEWEST gates, tie-broken by
  // highest ironVictoryFraction. The fallback is important — variants like (a)/P3 may have NO cell
  // passing the (greedy-tuned) gate yet still be the variant most worth MCTS-revalidating.
  let bestCell: RuleConfig | null = null;
  let bestCellWasHealthy = false;
  let bestCellGreedyMetrics: SweepMetrics | null = null;
  if (gridResult.recommended !== null) {
    bestCell = gridResult.recommended;
    bestCellWasHealthy = true;
    const entry = gridResult.grid.find((g) => JSON.stringify(g.config) === JSON.stringify(bestCell));
    bestCellGreedyMetrics = entry?.metrics ?? null;
  } else if (gridResult.ranked.length > 0) {
    const top = gridResult.ranked[0]!;
    bestCell = top.config;
    bestCellGreedyMetrics = top.metrics;
  } else {
    // No healthy or ranked cell — fall back to the grid's least-failing feasible cell.
    type Entry = { config: RuleConfig; metrics: SweepMetrics; failCount: number };
    const candidates: Entry[] = [];
    for (const g of gridResult.grid) {
      if (g.metrics === null) continue;
      candidates.push({ config: g.config, metrics: g.metrics, failCount: g.health.reasons.length });
    }
    if (candidates.length > 0) {
      candidates.sort((a, b) => a.failCount - b.failCount || b.metrics.ironVictoryFraction - a.metrics.ironVictoryFraction);
      const top = candidates[0]!;
      bestCell = top.config;
      bestCellGreedyMetrics = top.metrics;
      console.log(`  fallback: no greedy-healthy cell; picked nearest-miss (fails ${top.failCount} gate(s), ironVic=${top.metrics.ironVictoryFraction.toFixed(2)})`);
    }
  }
  if (bestCell === null) {
    console.log(`  no feasible cell — skipping MCTS revalidation.`);
    return {
      variant,
      baseConfig,
      bestCell: null,
      bestCellWasHealthy: false,
      bestCellGreedyMetrics: null,
      mctsMetrics: null,
      mctsWasHealthy: null,
      h2h: null,
      elapsedSec: (Date.now() - tStart) / 1000,
    };
  }
  console.log(`  best cell: r=${bestCell.radius} iron=${bestCell.ironCount} vt=${bestCell.victoryThreshold} ${bestCellWasHealthy ? "(HEALTHY under greedy)" : "(nearest miss)"}`);

  // --- MCTS revalidation of the best cell — guarded so a per-game crash doesn't abort the whole run ---
  console.log(`-- MCTS revalidation: ${MCTS_HEALTH_GAMES} games, counts ${MCTS_HEALTH_COUNTS.join(",")}, turnCap ${MCTS_TURN_CAP}, ${MCTS_ITERS}-iter --`);
  let mctsMetrics: SweepMetrics | null = null;
  let mctsWasHealthy: boolean | null = null;
  try {
    mctsMetrics = await runConfigParallel(
      bestCell,
      {
        games: MCTS_HEALTH_GAMES,
        turnCap: MCTS_TURN_CAP,
        baseSeed: BASE_SEED,
        playerCounts: MCTS_HEALTH_COUNTS,
        agentSpec: { kind: "mcts", iterations: MCTS_ITERS },
        onGame: (done, total, nPlayers, result) => {
          const w = result.winnerOrCoalition.length === 0 ? "none" : result.winnerOrCoalition.join("+");
          const summary = `${variant.label} mcts ${nPlayers}P t=${result.turns} ${result.victoryType} w=${w}`;
          console.log(`    [${variant.label} mcts ${done}/${total}] ${summary} (${elapsedS(t0)})`);
          appendResultAndCommit(INCREMENTAL_PATH, {
            data: { phase: "mcts-health", variant: variant.label, done, total, nPlayers, turns: result.turns, victoryType: result.victoryType, winner: result.winnerOrCoalition, hitTurnCap: result.hitTurnCap, elapsedSec: (Date.now() - t0) / 1000 },
            meta: { label: "compare-variants", done, total, summary },
          });
        },
      },
      pool,
    );
    mctsWasHealthy = isHealthy(mctsMetrics, thresholds).pass;
  } catch (err) {
    console.error(`  [${variant.label}] MCTS revalidation FAILED: ${err instanceof Error ? err.message : String(err)} — recording partial data and continuing.`);
  }

  // --- 2P MCTS-vs-heuristic head-to-head on the best cell — also guarded ---
  console.log(`-- gate-2 head-to-head: ${H2H_GAMES} 2P games, MCTS vs heuristic --`);
  const agents: NamedAgentSpec[] = [
    { name: "mcts", spec: { kind: "mcts", iterations: MCTS_ITERS } },
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
        config: bestCell,
        turnCap: MCTS_TURN_CAP,
        onGame: (done, total, _pc, result) => {
          const w = result.winnerOrCoalition.length === 0 ? "none" : result.winnerOrCoalition.join("+");
          const summary = `${variant.label} h2h t=${result.turns} ${result.victoryType} w=${w}`;
          console.log(`    [${variant.label} h2h ${done}/${total}] ${summary} (${elapsedS(t0)})`);
          appendResultAndCommit(INCREMENTAL_PATH, {
            data: { phase: "h2h", variant: variant.label, done, total, nPlayers: 2, turns: result.turns, victoryType: result.victoryType, winner: result.winnerOrCoalition, hitTurnCap: result.hitTurnCap, elapsedSec: (Date.now() - t0) / 1000 },
            meta: { label: "compare-variants", done, total, summary },
          });
        },
      },
      pool,
    );
    h2h = {
      mctsWinRate: rr.winRates["mcts"] ?? 0,
      heuristicWinRate: rr.winRates["heuristic"] ?? 0,
      decisive: (rr.headToHead["mcts"]?.["heuristic"] ?? 0) + (rr.headToHead["heuristic"]?.["mcts"] ?? 0),
    };
  } catch (err) {
    console.error(`  [${variant.label}] head-to-head FAILED: ${err instanceof Error ? err.message : String(err)} — recording partial data and continuing.`);
  }

  return {
    variant,
    baseConfig,
    bestCell,
    bestCellWasHealthy,
    bestCellGreedyMetrics,
    mctsMetrics,
    mctsWasHealthy,
    h2h,
    elapsedSec: (Date.now() - tStart) / 1000,
  };
}

function writeReport(results: VariantResult[]): void {
  const lines: string[] = [];
  lines.push("# Rules-Variants Comparative Experiment — Results");
  lines.push("");
  lines.push(`**Date:** 2026-05-28 (overnight)`);
  lines.push(`**Methodology:** \`docs/plans/2026-05-28-rules-variants-experiment-methodology.md\``);
  lines.push(`**Driving question:** which of the four §0.1 options — (a) P3 perimeter-gate, (b) P2 hold-iron, (c) lengthen elimination, (d) accept-and-stop-tuning — produces a config that is *balanced under MCTS*, not just under greedy?`);
  lines.push(`**Variants tested:** baseline + (a) + (b)×2 hold values + (c). Common grid: radius {2,3} × ironCount {12,14} × victoryThreshold {10,12} on boardSize 96, ${GAMES_PER_CONFIG} games/config under heuristic, baseSeed ${BASE_SEED}. MCTS revalidation: ${MCTS_HEALTH_GAMES} games on counts ${MCTS_HEALTH_COUNTS.join(",")}, turnCap ${MCTS_TURN_CAP}, ${MCTS_ITERS}-iter, plus ${H2H_GAMES}-game 2P MCTS-vs-heuristic head-to-head.`);
  lines.push("");
  lines.push("## Verdict matrix");
  lines.push("");
  lines.push("| Variant | Best cell | Greedy-healthy? | MCTS-healthy? | MCTS iron-vic | MCTS median turns | MCTS vs heuristic |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const r of results) {
    const cell = r.bestCell ? `r=${r.bestCell.radius} iron=${r.bestCell.ironCount} vt=${r.bestCell.victoryThreshold}` : "—";
    const greedy = r.bestCell === null ? "no feasible" : r.bestCellWasHealthy ? "YES" : "no (nearest miss)";
    const mctsHealthy = r.mctsWasHealthy === null ? "—" : r.mctsWasHealthy ? "YES" : "no";
    const mctsIron = r.mctsMetrics === null ? "—" : r.mctsMetrics.ironVictoryFraction.toFixed(2);
    const mctsMed = r.mctsMetrics === null ? "—" : r.mctsMetrics.medianTurns.toString();
    const h2h = r.h2h === null ? "—" : `${(r.h2h.mctsWinRate * 100).toFixed(0)}% vs ${(r.h2h.heuristicWinRate * 100).toFixed(0)}% (decisive ${r.h2h.decisive})`;
    lines.push(`| ${r.variant.label} | ${cell} | ${greedy} | ${mctsHealthy} | ${mctsIron} | ${mctsMed} | ${h2h} |`);
  }
  lines.push("");
  lines.push("## Per-variant detail");
  for (const r of results) {
    lines.push("");
    lines.push(`### ${r.variant.label}`);
    lines.push("");
    lines.push(r.variant.description);
    lines.push("");
    lines.push(`**Flags:** \`${JSON.stringify(r.variant.flags)}\``);
    lines.push(`**Elapsed:** ${r.elapsedSec.toFixed(1)}s`);
    if (r.bestCell === null) {
      lines.push(`**Result:** no feasible cell in the grid.`);
      continue;
    }
    lines.push(`**Best cell:** r=${r.bestCell.radius}, ironCount=${r.bestCell.ironCount}, victoryThreshold=${r.bestCell.victoryThreshold} — ${r.bestCellWasHealthy ? "PASSED all 7 health gates under greedy" : "did NOT pass all 7 under greedy (best ranked nearest-miss)"}.`);
    if (r.bestCellGreedyMetrics !== null) lines.push(`- **Greedy metrics:** ${fmtMetrics(r.bestCellGreedyMetrics)}`);
    if (r.mctsMetrics !== null) {
      lines.push(`- **MCTS metrics:** ${fmtMetrics(r.mctsMetrics)} ${r.mctsWasHealthy ? "PASS" : "FAIL"}`);
      const types = r.mctsMetrics.victoryType;
      lines.push(`- **MCTS victory type mix:** iron=${(types.iron ?? 0)}, last-standing=${(types["last-standing"] ?? 0)}, none(cap)=${(types.none ?? 0)} of ${r.mctsMetrics.gamesPlayed}.`);
    }
    if (r.h2h !== null) {
      lines.push(`- **2P MCTS-vs-heuristic head-to-head:** mctsWinRate=${(r.h2h.mctsWinRate * 100).toFixed(1)}% vs heuristicWinRate=${(r.h2h.heuristicWinRate * 100).toFixed(1)}% over ${H2H_GAMES} games (decisive ${r.h2h.decisive}).`);
    }
  }
  lines.push("");
  lines.push("## Interpretation notes (auto-flagged, not Sam's verdict)");
  const survivors = results.filter((r) => r.mctsWasHealthy === true);
  const greedyOnly = results.filter((r) => r.bestCellWasHealthy && r.mctsWasHealthy === false);
  if (survivors.length === 0) {
    lines.push(`- **No variant tested produced a config that is healthy under MCTS** in this grid. The agent-relative balance problem is not fixed by these specific flag values; consider expanding the grid, tuning the flag values (e.g. holdRounds 4-5), combining variants, or option (d).`);
  } else {
    lines.push(`- **Survivors under MCTS (variants that produced an MCTS-healthy config in this grid):** ${survivors.map((r) => r.variant.label).join(", ")}. These are candidates for the next step — deeper validation, exploiter probe, then Sam's adoption decision.`);
  }
  if (greedyOnly.length > 0) {
    lines.push(`- **Greedy-healthy but MCTS-unhealthy (the BAL-1 trap, again):** ${greedyOnly.map((r) => r.variant.label).join(", ")}. These reproduce the same artifact as the baseline calibration — the gate certifies agent myopia.`);
  }
  lines.push(`- The grid is intentionally small (4 cells per variant before infeasibility prune); a variant being "MCTS-unhealthy in this grid" doesn't mean no MCTS-healthy config exists for it elsewhere in geometry space. Treat as a SIGNAL, not a verdict.`);
  lines.push("");
  lines.push(`---`);
  lines.push(`*Generated by \`src/sweep/compare-variants.ts\`.*`);
  const md = lines.join("\n") + "\n";
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, md, "utf8");
  commitFileAndPush(OUT_PATH, `report: ${OUT_PATH.split("/").pop()}`);
  console.log(`\nReport written to ${OUT_PATH}`);
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const pool = new GamePool(WORKERS);
  console.log(`=== Rules-variants comparative experiment (workers=${WORKERS}, baseSeed=${BASE_SEED}) ===`);
  console.log(`Variants: ${VARIANTS.map((v) => v.label).join(" | ")}`);

  try {
    const results: VariantResult[] = [];
    for (const variant of VARIANTS) {
      try {
        const r = await runVariant(variant, pool, t0);
        results.push(r);
      } catch (err) {
        console.error(`\n!!! Variant ${variant.label} crashed entirely: ${err instanceof Error ? err.message : String(err)} — recording placeholder and continuing.`);
        results.push({
          variant,
          baseConfig: { ...defaultConfig(), ...BASE_CONFIG_OVERRIDES, ...variant.flags },
          bestCell: null,
          bestCellWasHealthy: false,
          bestCellGreedyMetrics: null,
          mctsMetrics: null,
          mctsWasHealthy: null,
          h2h: null,
          elapsedSec: 0,
        });
      }
    }
    console.log(`\nAll variants done in ${elapsedS(t0)}. Writing report.`);
    writeReport(results);
  } finally {
    pool.close();
  }
}

void main().catch((err: unknown) => {
  console.error(`compare-variants aborted: ${err instanceof Error ? err.message : String(err)}`);
});
