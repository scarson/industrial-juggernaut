// ABOUTME: CRN sweep runner — runConfig/sweepGrid/sweepOFAT drive seeded game batches into SweepMetrics, plus proportionCI.
// ABOUTME: Common random numbers: per-game seed is gameSeed(baseSeed, gameIndex), config-INDEPENDENT, so config diffs are signal not seed noise.

import { runGame } from "../driver/run";
import { initGame } from "../engine/init";
import { placeFirstBase, representativeFirstBase } from "../engine/turn";
import { control } from "../engine/control";
import type { Agent } from "../agent/agent";
import { heuristicAgent } from "../agent/heuristic-agent";
import type { RuleConfig } from "../engine/config";
import { defaultConfig } from "../engine/config";
import type { BoardSource, GameState, PlayerId } from "../engine/types";
import type { GameResult } from "../driver/record";
import { computeMetrics, type GameEntry, type SweepMetrics } from "./metrics";

/** Default player-count rotation: game i plays with `playerCounts[i % len]`. */
const DEFAULT_PLAYER_COUNTS = [2, 3, 4, 5, 6];

/** z-score for a 95% confidence interval (normal approximation). */
const Z_95 = 1.96;

/**
 * The numeric-valued fields of `RuleConfig` — the only fields a sweep may vary,
 * since axes carry `number[]`. Sweeping a boolean/object field (`allowPass`,
 * `autoWinAt6`, `killBounty`, `combatTable`) with numbers would silently
 * overwrite it with the wrong type and produce a malformed config; excluding
 * those at the type level closes that misuse class at compile time.
 */
export type NumericRuleConfigKey = {
  [K in keyof RuleConfig]: RuleConfig[K] extends number ? K : never;
}[keyof RuleConfig];

/**
 * The seed for game `gameIndex` of a batch rooted at `baseSeed`: simply
 * `baseSeed + gameIndex`.
 *
 * THE CRN GUARANTEE. This function takes NO config — the per-game seed depends
 * only on `(baseSeed, gameIndex)`, never on the rule config under test. Every
 * config swept at the same `baseSeed` therefore plays the identical sequence of
 * seeds, so observed metric differences between configs are signal (the config
 * change) and not seed noise. All seeding in this module routes through here.
 */
export function gameSeed(baseSeed: bigint, gameIndex: number): bigint {
  return baseSeed + BigInt(gameIndex);
}

/** Options shared by `runConfig` and (forwarded) the sweep helpers. */
export interface RunConfigOpts {
  /** Number of seeded games to run. */
  games: number;
  /** Turn cap passed to every game. */
  turnCap: number;
  /** Seed of game 0; game i uses `gameSeed(baseSeed, i)`. */
  baseSeed: bigint;
  /** Player-count rotation; defaults to `[2,3,4,5,6]`. Game i uses index `i % len`. */
  playerCounts?: number[];
  /** Agent factory bound per player; defaults to `() => heuristicAgent()`. */
  agentFactory?: (player: PlayerId) => Agent;
  /**
   * Observation hook: invoked once per game BEFORE the game runs, with the
   * game index, its CRN seed, and the config under test. Used to assert the
   * CRN seed sequence in tests; has no effect on the run.
   */
  onGameSeed?: (gameIndex: number, seed: bigint, config: RuleConfig) => void;
  /**
   * Observation hook: invoked once per game BEFORE the game runs, with the game
   * index and the player-count the game will be run with. Used to assert
   * player-count rotation in tests; has no effect on the run.
   */
  onGamePlayed?: (gameIndex: number, nPlayers: number) => void;
}

/** The board source a config generates: size + iron come from the config under test. */
function boardSourceFor(config: RuleConfig): BoardSource {
  return { kind: "generate", size: config.boardSize, ironCount: config.ironCount };
}

/**
 * Reproduce the EXACT setup-phase state `runGame` plays for `(seed, config,
 * nPlayers)`, then report whether any player already controls
 * `>= config.victoryThreshold` iron at setup (a setup-decided game).
 *
 * Consistency with the actual game is structural: `runGame` builds its state via
 * `initGame({seed, boardSource, nPlayers, config})` and then auto-places each
 * player's first base with `placeFirstBase(state, p, representativeFirstBase(state, p))`.
 * This probe runs the identical sequence with the identical inputs, so the board
 * and bases it measures are byte-for-byte the ones `runGame` will play.
 */
function setupDecidedFor(
  seed: bigint,
  config: RuleConfig,
  nPlayers: number,
): boolean {
  let state: GameState = initGame({ seed, boardSource: boardSourceFor(config), nPlayers, config });
  for (let i = 0; i < nPlayers; i++) {
    const p = state.phase.order[state.phase.indexInOrder]!;
    state = placeFirstBase(state, p, representativeFirstBase(state, p));
  }
  for (let p = 0; p < nPlayers; p++) {
    if (control(state, p).iron.length >= config.victoryThreshold) return true;
  }
  return false;
}

/** Player(s) holding the max iron at the first turn boundary; ties → all. */
function turn1LeadersOf(result: GameResult): PlayerId[] {
  const firstRow = result.ironOverTime[0];
  if (firstRow === undefined || firstRow.length === 0) return [];
  let max = -Infinity;
  for (const v of firstRow) if (v > max) max = v;
  const leaders: PlayerId[] = [];
  for (let p = 0; p < firstRow.length; p++) {
    if (firstRow[p] === max) leaders.push(p);
  }
  return leaders;
}

/**
 * Run `opts.games` seeded games under one rule config and aggregate them into
 * `SweepMetrics`. Deterministic for a fixed `(config, baseSeed)`. This is exactly
 * `computeMetrics(runConfigEntries(config, opts))`; the per-game contract (CRN
 * seed, player-count rotation, setup-decided probe, turn-1 leaders) lives on
 * `runGameEntry`, the shared seam both this and any sharded runner build through.
 */
export function runConfig(config: RuleConfig, opts: RunConfigOpts): SweepMetrics {
  return computeMetrics(runConfigEntries(config, opts));
}

/**
 * Run the single game with index `gameIndex` of a batch under `config`/`opts`,
 * and return its `GameEntry`. PURE and deterministic for a fixed
 * `(config, opts.baseSeed, gameIndex)` — depends on no shared mutable state.
 *
 * THE PARALLEL-DECOMPOSITION SEAM. Both the sequential `runConfigEntries` loop
 * and any process/worker-sharded runner build their per-game entries through
 * this one function. Because the per-game CRN seed is `gameSeed(opts.baseSeed,
 * gameIndex)` — config-INDEPENDENT and shard-INDEPENDENT (see `gameSeed`) — the
 * `GameEntry` for a given `gameIndex` is identical no matter which shard (or the
 * sequential loop) produces it. Merging disjoint-index shards back in any order
 * and aggregating with `computeMetrics` therefore reproduces the sequential
 * metrics byte-for-byte; that invariant is the basis of behavior-preserving
 * parallelism and is pinned by the run-test suite.
 *
 * The `obs` hooks (`onGameSeed`, `onGamePlayed`) are forwarded from the same
 * fields on `RunConfigOpts` by `runConfigEntries`; a sharded runner that does
 * not need them passes nothing.
 */
export function runGameEntry(
  config: RuleConfig,
  opts: RunConfigOpts,
  gameIndex: number,
  obs?: Pick<RunConfigOpts, "onGameSeed" | "onGamePlayed">,
): GameEntry {
  const playerCounts = opts.playerCounts ?? DEFAULT_PLAYER_COUNTS;
  const agentFactory = opts.agentFactory ?? (() => heuristicAgent());
  const boardSource = boardSourceFor(config);

  const seed = gameSeed(opts.baseSeed, gameIndex);
  const nPlayers = playerCounts[gameIndex % playerCounts.length]!;
  obs?.onGameSeed?.(gameIndex, seed, config);
  obs?.onGamePlayed?.(gameIndex, nPlayers);

  const setupDecided = setupDecidedFor(seed, config, nPlayers);

  const result = runGame({
    seed,
    boardSource,
    nPlayers,
    // Unused under `agentFor`, but RunOptions requires a length-nPlayers array.
    archetypes: Array.from({ length: nPlayers }, () => "economic" as const),
    config,
    turnCap: opts.turnCap,
    agentFor: (p) => agentFactory(p),
  });

  return {
    result,
    nPlayers,
    setupDecided,
    turn1Leaders: turn1LeadersOf(result),
  };
}

/**
 * Run `opts.games` seeded games under one rule config and return the ordered
 * per-game `GameEntry[]` (game `i` at index `i`). Deterministic for a fixed
 * `(config, baseSeed)`. `runConfig` is exactly `computeMetrics` of this list;
 * exposing the entries lets a sharded runner aggregate a subset and the run-test
 * suite assert parallel == sequential. The per-game contract (CRN seed,
 * player-count rotation, setup-decided probe, turn-1 leaders) is documented on
 * `runGameEntry`.
 */
export function runConfigEntries(config: RuleConfig, opts: RunConfigOpts): GameEntry[] {
  const entries: GameEntry[] = [];
  for (let i = 0; i < opts.games; i++) {
    entries.push(runGameEntry(config, opts, i, opts));
  }
  return entries;
}

/**
 * Sweep the full Cartesian product of `axes` over a base config (`defaultConfig`
 * with `fixed` applied), running each resulting config through `runConfig`.
 *
 * COMMON RANDOM NUMBERS: every config in the grid is run at the SAME `baseSeed`,
 * so all configs play the identical per-game seed sequence (`gameSeed(baseSeed,
 * i)`). Differences in the returned metrics are attributable to the config
 * difference, not to seed variation.
 *
 * Precondition: each axis SHOULD have >= 1 value. `axes = {}` yields exactly one
 * config (the base) — useful for a single-config run. But an axis with an EMPTY
 * values array collapses the Cartesian product to zero configs (the fold
 * multiplies by 0), so the result is `[]`.
 */
export function sweepGrid(
  axes: Partial<Record<NumericRuleConfigKey, number[]>>,
  fixed: Partial<RuleConfig>,
  opts: RunConfigOpts,
): { config: RuleConfig; metrics: SweepMetrics }[] {
  const base: RuleConfig = { ...defaultConfig(), ...fixed };
  const axisKeys = Object.keys(axes) as NumericRuleConfigKey[];

  // Build the Cartesian product of axis values as a list of configs.
  let configs: RuleConfig[] = [base];
  for (const axis of axisKeys) {
    const values = axes[axis] ?? [];
    const next: RuleConfig[] = [];
    for (const cfg of configs) {
      for (const value of values) {
        next.push({ ...cfg, [axis]: value });
      }
    }
    configs = next;
  }

  return configs.map((config) => ({ config, metrics: runConfig(config, opts) }));
}

/**
 * One-factor-at-a-time sweep: vary a single `axis` over `values` around
 * `baseline`, leaving every other field at its baseline value, and run each
 * resulting config through `runConfig`.
 *
 * COMMON RANDOM NUMBERS: every value is run at the SAME `baseSeed`, so the only
 * thing that changes across the returned entries is the one axis.
 */
export function sweepOFAT(
  baseline: RuleConfig,
  axis: NumericRuleConfigKey,
  values: number[],
  opts: RunConfigOpts,
): { value: number; metrics: SweepMetrics }[] {
  return values.map((value) => {
    const config: RuleConfig = { ...baseline, [axis]: value };
    return { value, metrics: runConfig(config, opts) };
  });
}

/**
 * ±95% confidence-interval half-width for a sample proportion `p` over `n`
 * observations (normal approximation): `Z_95 * sqrt(p*(1-p)/n)`.
 */
export function proportionCI(p: number, n: number): number {
  return Z_95 * Math.sqrt((p * (1 - p)) / n);
}
