// ABOUTME: Runnable balance-sweep entrypoint — searches a pruned geometry grid for a healthy config, runs the
// ABOUTME: design-critique OFAT/comparison axes, and writes the markdown balance report to docs/sweeps/.

// Node builtins for filesystem + script argv. The engine/agent/driver layers are deliberately
// Node-free, so the project carries no `@types/node`; the exact ambient surface this script uses
// is declared in `node-shims.d.ts` (declaring types — not relaxing tsconfig or adding a runtime dep).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { initGame } from "../engine/init";
import { defaultConfig } from "../engine/config";
import type { RuleConfig, KillBounty } from "../engine/config";
import { runConfig, proportionCI } from "./run";
import type { RunConfigOpts } from "./run";
import { findBalancedConfig, balanceSweep } from "./orchestrate";
import { report } from "./report";
import type { SweepMetrics } from "./metrics";

// ---------------------------------------------------------------------------
// Configuration of the run
// ---------------------------------------------------------------------------

/** One fixed CRN base seed reused across the entire run, so all configs play the same per-game seed sequence. */
const BASE_SEED = 1n;

/** Turn cap for every game — generous enough that a cap-hit signals a genuinely non-terminating config. */
const TURN_CAP = 60;

/** Games-per-config for the wide grid SEARCH (gates health + ranks; smaller for compute). */
const GRID_GAMES = 80;

/** Games-per-config for the HIGH-resolution re-run of top candidates + the balance axes (tight CIs). */
const HIRES_GAMES = 360;

/** How many top grid candidates (passers, or nearest-misses when none pass) to re-run at high resolution. */
const TOP_CANDIDATES = 3;

/** Base axes for the geometry grid (raw Cartesian product before pruning). */
const GRID_AXES = {
  boardSize: [96, 150, 220, 300],
  radius: [2, 3, 4, 5],
  ironCount: [10, 12, 14, 16],
  victoryThreshold: [8, 10, 12],
} as const;

/** Discrete (non-numeric) balance axes that cannot route through `balanceSweep`. */
const AUTO_WIN_VALUES: boolean[] = [false, true];
const KILL_BOUNTY_VALUES: KillBounty[] = ["none", "half", "full"];

/** Numeric balance axes that DO route through `balanceSweep`, with the values swept per axis. */
const NUMERIC_BALANCE_VALUES = {
  victoryThreshold: [8, 10, 12],
  attackRange: [4, 6, 8],
} as const;

// ---------------------------------------------------------------------------
// Pruning
// ---------------------------------------------------------------------------

/** One pruned combo + why it was dropped (for honest coverage reporting). */
interface PrunedCombo {
  config: { boardSize: number; radius: number; ironCount: number; victoryThreshold: number };
  reason: string;
}

/**
 * Probe whether a config's board can actually be generated and set up. `placeIron`
 * throws when the board is too dense for the requested iron count (the S4 discovery:
 * small boards at high ironCount are infeasible). We probe with `initGame` (which runs
 * `generateBoard` → `placeIron` → setup) at a representative player count; a throw means
 * the combo is infeasible and is pruned.
 */
function isFeasible(config: RuleConfig): { ok: true } | { ok: false; error: string } {
  try {
    // 6 players is the densest setup (most first bases placed); if it survives, smaller counts will too.
    initGame({
      seed: BASE_SEED,
      boardSource: { kind: "generate", size: config.boardSize, ironCount: config.ironCount },
      nPlayers: 6,
      config,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/**
 * Build the feasible grid configs from the raw axes, dropping degenerate combos:
 *   (a) victoryThreshold > ironCount — unwinnable by iron (you can't control more iron than exists).
 *   (b) board too dense to place iron — feasibility probe via `initGame` (catches `placeIron` throws).
 * Every pruned combo is recorded in `pruned` with its reason; nothing is silently truncated.
 */
function buildFeasibleConfigs(): { configs: RuleConfig[]; pruned: PrunedCombo[] } {
  const base = defaultConfig();
  const configs: RuleConfig[] = [];
  const pruned: PrunedCombo[] = [];

  for (const boardSize of GRID_AXES.boardSize) {
    for (const radius of GRID_AXES.radius) {
      for (const ironCount of GRID_AXES.ironCount) {
        for (const victoryThreshold of GRID_AXES.victoryThreshold) {
          const combo = { boardSize, radius, ironCount, victoryThreshold };

          if (victoryThreshold > ironCount) {
            pruned.push({ config: combo, reason: `victoryThreshold ${victoryThreshold} > ironCount ${ironCount} (unwinnable by iron)` });
            continue;
          }

          const config: RuleConfig = { ...base, boardSize, radius, ironCount, victoryThreshold };
          const feasible = isFeasible(config);
          if (!feasible.ok) {
            pruned.push({ config: combo, reason: `board infeasible (placeIron failed): ${feasible.error}` });
            continue;
          }

          configs.push(config);
        }
      }
    }
  }

  return { configs, pruned };
}

// ---------------------------------------------------------------------------
// Discrete-axis comparison (autoWinAt6, killBounty) — these are NOT numeric keys,
// so they cannot route through balanceSweep; we run runConfig per value ourselves.
// ---------------------------------------------------------------------------

/** One row of a discrete-axis comparison: the axis value and the metrics it produced. */
interface DiscreteRow<V> {
  value: V;
  metrics: SweepMetrics;
}

/** Run `runConfig` once per discrete value of a boolean/enum field, holding everything else at `baseline`. */
function discreteComparison<K extends keyof RuleConfig>(
  baseline: RuleConfig,
  key: K,
  values: RuleConfig[K][],
  opts: RunConfigOpts,
): DiscreteRow<RuleConfig[K]>[] {
  return values.map((value) => ({
    value,
    metrics: runConfig({ ...baseline, [key]: value }, opts),
  }));
}

// ---------------------------------------------------------------------------
// Markdown helpers for the appended discrete-axis section
// ---------------------------------------------------------------------------

function frac(n: number): string {
  return n.toFixed(3);
}

function fracCI(p: number, n: number): string {
  return `${frac(p)} ± ${frac(proportionCI(p, n))}`;
}

/** Render a discrete-axis comparison table (value → key metrics with CIs). */
function discreteTable<V>(title: string, label: string, rows: DiscreteRow<V>[]): string {
  const lines: string[] = [
    `### ${title}`,
    "",
    `| ${label} | medianTurns | ironVictory (95% CI) | setupDecided (95% CI) | capHit (95% CI) | leadVolatility (95% CI) | seatBias |`,
    "|---|---|---|---|---|---|---|",
  ];
  for (const { value, metrics: m } of rows) {
    const n = m.gamesPlayed;
    lines.push(
      `| ${String(value)} | ${m.medianTurns.toFixed(1)} | ${fracCI(m.ironVictoryFraction, n)} | ${fracCI(m.setupDecidedFraction, n)} | ${fracCI(m.capHitFraction, n)} | ${fracCI(m.leadVolatility, n)} | ${frac(m.seatWinBias.maxBiasAcrossGroups)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

/** Compact one-line config summary for the report metadata. */
function configLine(c: RuleConfig): string {
  return [
    `boardSize=${c.boardSize}`,
    `radius=${c.radius}`,
    `ironCount=${c.ironCount}`,
    `victoryThreshold=${c.victoryThreshold}`,
    `attackRange=${c.attackRange}`,
    `autoWinAt6=${c.autoWinAt6}`,
    `killBounty=${c.killBounty}`,
  ].join(", ");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const startedAt = Date.now();

  // Allow a tiny SMOKE run via `--smoke`: 2 configs × 20 games, end-to-end, to confirm
  // the script + type-conflict resolution + report write all work before the long run.
  const smoke = process.argv.includes("--smoke");

  const gridGames = smoke ? 20 : GRID_GAMES;
  const hiresGames = smoke ? 20 : HIRES_GAMES;

  const gridOpts: RunConfigOpts = { games: gridGames, turnCap: TURN_CAP, baseSeed: BASE_SEED };
  const hiresOpts: RunConfigOpts = { games: hiresGames, turnCap: TURN_CAP, baseSeed: BASE_SEED };

  // --- Stage 1: build the pruned feasible grid ---
  console.log("=== Stage 1: build + prune the geometry grid ===");
  const { configs: allFeasible, pruned } = buildFeasibleConfigs();
  const rawCount =
    GRID_AXES.boardSize.length * GRID_AXES.radius.length * GRID_AXES.ironCount.length * GRID_AXES.victoryThreshold.length;

  // In smoke mode use only the first 2 feasible configs to keep the run tiny.
  const gridConfigs = smoke ? allFeasible.slice(0, 2) : allFeasible;

  console.log(`Raw combos: ${rawCount}`);
  console.log(`Pruned: ${pruned.length}`);
  for (const p of pruned) {
    console.log(
      `  PRUNE boardSize=${p.config.boardSize} radius=${p.config.radius} ironCount=${p.config.ironCount} victoryThreshold=${p.config.victoryThreshold}: ${p.reason}`,
    );
  }
  console.log(`Feasible grid configs to run: ${gridConfigs.length}${smoke ? " (smoke-limited to 2)" : ""}`);

  // --- Stage 1 search: run every feasible config at GRID_GAMES, then select ---
  console.log(`\n=== Stage 1 search: ${gridGames} games/config across ${gridConfigs.length} configs ===`);
  const grid = gridConfigs.map((config, i) => {
    if (i % 10 === 0 || i === gridConfigs.length - 1) {
      console.log(`  [${i + 1}/${gridConfigs.length}] ${configLine(config)}`);
    }
    return { config, metrics: runConfig(config, gridOpts) };
  });

  const found = findBalancedConfig(grid);
  console.log(
    found.recommended !== null
      ? `\nGrid search: PASSED — ${found.ranked.length} healthy config(s); top score ${found.recommended.score.toFixed(4)}`
      : `\nGrid search: NO healthy config; ${found.nearestMisses?.length ?? 0} nearest-miss(es) recorded`,
  );

  // --- Choose the baseline for the balance analysis ---
  // Recommended config if one passed; otherwise defaultConfig() (per the plan).
  const baseline: RuleConfig = found.recommended?.config ?? defaultConfig();
  console.log(`\nBalance baseline: ${found.recommended !== null ? "recommended config" : "defaultConfig()"} — ${configLine(baseline)}`);

  // --- Stage 2: high-resolution re-run of the top candidates (for tight CIs in the report) ---
  // The candidate pool is the passers (ranked) when any passed, else the nearest-misses.
  console.log(`\n=== Stage 2: high-resolution re-run of top ${TOP_CANDIDATES} candidate(s) at ${hiresGames} games/config ===`);
  const candidateConfigs: RuleConfig[] =
    found.recommended !== null
      ? found.ranked.slice(0, TOP_CANDIDATES).map((s) => s.config)
      : (found.nearestMisses ?? []).slice(0, TOP_CANDIDATES).map((m) => m.config);

  const hiresGrid = candidateConfigs.map((config, i) => {
    console.log(`  [${i + 1}/${candidateConfigs.length}] ${configLine(config)}`);
    return { config, metrics: runConfig(config, hiresOpts) };
  });
  // Re-select over the high-resolution candidate metrics so the report's headline
  // (recommended / nearest-misses) reflects the tight-CI numbers, not the grid-stage ones.
  const hiresResult = findBalancedConfig(hiresGrid);

  // --- Stage 2 balance: numeric OFAT axes around the baseline at high resolution ---
  console.log(`\n=== Stage 2 balance: numeric OFAT (victoryThreshold, attackRange) at ${hiresGames} games/config ===`);
  const balance = balanceSweep(
    baseline,
    ["victoryThreshold", "attackRange"],
    {
      victoryThreshold: [...NUMERIC_BALANCE_VALUES.victoryThreshold],
      attackRange: [...NUMERIC_BALANCE_VALUES.attackRange],
    },
    hiresOpts,
  );

  // --- Stage 2 balance: discrete axes (autoWinAt6 bool, killBounty enum) at high resolution ---
  console.log(`=== Stage 2 balance: discrete (autoWinAt6, killBounty) at ${hiresGames} games/config ===`);
  const autoWinRows = discreteComparison(baseline, "autoWinAt6", AUTO_WIN_VALUES, hiresOpts);
  const killBountyRows = discreteComparison(baseline, "killBounty", KILL_BOUNTY_VALUES, hiresOpts);

  // --- Build the report ---
  // The core report renders the grid-stage FindResult (full grid table) plus the numeric OFAT
  // balance tables. We use the GRID-stage `found` for the grid table (it has every swept config),
  // but surface the HIGH-RESOLUTION recommendation/nearest-misses in the appended preamble so the
  // headline numbers carry tight CIs. The discrete axes are appended (BalanceResult can only key
  // numeric axes, so autoWinAt6/killBounty cannot fold into `balance`).
  const core = report({ result: { ...found, gridTable: found.gridTable }, balance });

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);

  const preamble: string[] = [
    "# Balance Sweep Report",
    "",
    `_Generated by \`src/sweep/main.ts\` on ${new Date().toISOString().slice(0, 10)}. Deterministic: single CRN baseSeed=${BASE_SEED}, turnCap=${TURN_CAP}._`,
    "",
    "## Run Parameters & Methodology",
    "",
    `- **Agent:** \`heuristicAgent\` for every player. **WEAK-AGENT CAVEAT:** all metrics below are under a weak heuristic agent, NOT a strong (MCTS/learned) agent. A config that looks balanced under weak play may not be under strong play, and vice versa. Treat every finding as provisional pending a stronger-agent re-run.`,
    `- **Common random numbers:** every config runs at the same \`baseSeed=${BASE_SEED}\`, so all configs play the identical per-game seed sequence — observed metric differences are config signal, not seed noise.`,
    `- **Player counts:** rotated \`[2,3,4,5,6]\` (game i uses index \`i % 5\`).`,
    `- **Turn cap:** ${TURN_CAP}.`,
    "",
    "### Two-stage compute budget",
    "",
    `- **Stage 1 (grid SEARCH):** ${gridGames} games/config across the pruned grid — enough to gate health and rank.`,
    `- **Stage 2 (high-resolution re-run):** ${hiresGames} games/config for the top ${TOP_CANDIDATES} candidate(s) and ALL balance axes (numeric OFAT + discrete comparisons) — tight CIs.`,
    "",
    "### Grid coverage (honest accounting)",
    "",
    `- Base axes: boardSize ∈ {${GRID_AXES.boardSize.join(", ")}} × radius ∈ {${GRID_AXES.radius.join(", ")}} × ironCount ∈ {${GRID_AXES.ironCount.join(", ")}} × victoryThreshold ∈ {${GRID_AXES.victoryThreshold.join(", ")}} = **${rawCount} raw combos**.`,
    `- **${pruned.length} pruned**, **${allFeasible.length} feasible** (the ${grid.length} actually run${smoke ? "; smoke-limited" : ""}).`,
    "",
    "Pruned combos and why:",
    "",
    "| boardSize | radius | ironCount | victoryThreshold | reason |",
    "|---|---|---|---|---|",
    ...pruned.map(
      (p) => `| ${p.config.boardSize} | ${p.config.radius} | ${p.config.ironCount} | ${p.config.victoryThreshold} | ${p.reason} |`,
    ),
    "",
  ];

  // High-resolution headline (recommended config or nearest-misses re-confirmed at tight CIs).
  const hires: string[] = [
    "## High-Resolution Headline",
    "",
    `Re-ran the top ${TOP_CANDIDATES} grid candidate(s) at ${hiresGames} games/config. The grid-search numbers (in the sections below) gate at ${gridGames} games/config; these tight-CI numbers are the ones to trust for the headline.`,
    "",
  ];
  if (hiresResult.recommended !== null) {
    const { config, metrics: m, score } = hiresResult.recommended;
    const n = m.gamesPlayed;
    hires.push(
      `**A healthy config WAS found** (composite score ${score.toFixed(4)}). Recommended for a SEPARATE human-gated adoption step — \`defaultConfig\` is NOT changed by this run.`,
      "",
      `\`${configLine(config)}\``,
      "",
      `- Games: ${n}`,
      `- Median turns: ${m.medianTurns.toFixed(1)} (mean ${m.meanTurns.toFixed(1)})`,
      `- Iron victory: ${fracCI(m.ironVictoryFraction, n)}`,
      `- Setup-decided: ${fracCI(m.setupDecidedFraction, n)}`,
      `- Cap-hit: ${fracCI(m.capHitFraction, n)}`,
      `- Lead volatility: ${fracCI(m.leadVolatility, n)}`,
      `- Seat bias (max across groups): ${frac(m.seatWinBias.maxBiasAcrossGroups)}`,
      "",
    );
  } else {
    hires.push(
      "**No healthy config was found** — neither at grid resolution nor in the high-resolution re-run of the closest candidates. This is the central finding: under the weak heuristic agent, no point in this grid satisfies the health gate. The nearest-misses (closest configs + which criteria they fail, at tight CIs) follow.",
      "",
    );
    for (let i = 0; i < (hiresResult.nearestMisses ?? []).length; i++) {
      const miss = hiresResult.nearestMisses![i]!;
      const m = miss.metrics;
      const n = m.gamesPlayed;
      hires.push(
        `#### Nearest miss #${i + 1} (high-resolution)`,
        "",
        `\`${configLine(miss.config)}\``,
        "",
        `- Median turns: ${m.medianTurns.toFixed(1)} (mean ${m.meanTurns.toFixed(1)})`,
        `- Iron victory: ${fracCI(m.ironVictoryFraction, n)}`,
        `- Setup-decided: ${fracCI(m.setupDecidedFraction, n)}`,
        `- Cap-hit: ${fracCI(m.capHitFraction, n)}`,
        `- Lead volatility: ${fracCI(m.leadVolatility, n)}`,
        `- Seat bias (max across groups): ${frac(m.seatWinBias.maxBiasAcrossGroups)}`,
        `- **Failing criteria (${miss.health.reasons.length}):** ${miss.health.reasons.join("; ")}`,
        "",
      );
    }
  }

  // Discrete-axis balance section (appended — BalanceResult cannot key non-numeric axes).
  const discrete: string[] = [
    "## Discrete-Axis Balance (autoWinAt6, killBounty)",
    "",
    `These two design-critique variables are NOT numeric \`RuleConfig\` keys (\`autoWinAt6\` is boolean; \`killBounty\` is the \`"none"|"half"|"full"\` enum), so they cannot route through the numeric \`balanceSweep\`. Each was compared by running \`runConfig\` per value around the same baseline at ${hiresGames} games/config. All CIs are 95% (normal approximation).`,
    "",
    discreteTable("autoWinAt6 (false vs true)", "autoWinAt6", autoWinRows),
    discreteTable("killBounty (none / half / full)", "killBounty", killBountyRows),
    "### Critique questions",
    "",
    "- **Does `autoWinAt6` dominate?** Compare the two `autoWinAt6` rows above: a large swing in `medianTurns` / `ironVictory` / `setupDecided` between false and true indicates the auto-win shortcut is shaping outcomes. (Weak-agent caveat applies.)",
    "- **Does `killBounty=full` snowball?** Compare the `full` row against `half`/`none`: if `full` shortens games (lower `medianTurns`) and reduces `leadVolatility` (turn-1 leader wins more often), that is the snowball signature. (Weak-agent caveat applies.)",
    "",
  ];

  // Assemble: preamble + high-res headline + discrete section + the core report.
  // (The core report carries its own "# Balance Sweep Report" H1; we strip that duplicate.)
  const coreBody = core.replace(/^# Balance Sweep Report\n/, "");
  const markdown = [...preamble, ...hires, ...discrete, "---", "", coreBody, "", `---`, "", `_Total run wall-clock: ${elapsedSec}s._`, ""].join("\n");

  // --- Write the report ---
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "..", "..");
  const outPath = resolve(repoRoot, "docs", "sweeps", "2026-05-27-balance-report.md");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, markdown, "utf8");

  console.log(`\nReport written: ${outPath}`);
  console.log(`Total wall-clock: ${elapsedSec}s`);
}

main();
