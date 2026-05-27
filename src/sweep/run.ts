// ABOUTME: Sweep runner — runConfig/sweepGrid/sweepOFAT drive seeded games per RuleConfig into SweepMetrics.
// ABOUTME: Common random numbers (per-game seed = baseSeed + gameIndex, config-independent) + a proportion-CI helper.

import { generateBoard } from "../board/generate";
import { control } from "../engine/control";
import { setupGame } from "../engine/turn";
import { heuristicAgent } from "../agent/heuristic-agent";
import { runGame } from "../driver/run";
import { seed } from "../rng/pcg";
import { computeMetrics, turn1LeadersOf, type GameRecord, type SweepMetrics } from "./metrics";
import type { GameResult } from "../driver/record";
import type { Agent } from "../agent/agent";
import type { Archetype } from "../agent/archetypes";
import type { RuleConfig } from "../engine/config";
import type { PlayerId } from "../engine/types";

/**
 * Per-config progress callback. Fired by the multi-config entry points
 * ({@link sweepGrid}, `findBalancedConfig`, `balanceSweep`) once per config as it
 * completes, so a long sweep is observable live instead of silent-until-done.
 * `metrics` is `null` for a config whose geometry was infeasible (the grid search
 * catches the throw and reports a null-metrics cell).
 */
export type SweepProgress = (
  done: number,
  total: number,
  config: RuleConfig,
  metrics: SweepMetrics | null,
) => void;

/** What every runner entry point needs: game count, turn cap, CRN base seed, and optional rotation/agent. */
export interface RunConfigOptions {
  games: number;
  turnCap: number;
  baseSeed: bigint;
  /** Player counts cycled per game (default [2,3,4,5,6]). */
  playerCounts?: number[];
  /** Override the agent used for every seat (default heuristicAgent). */
  agentFactory?: (player: PlayerId) => Agent;
  /** Optional per-config progress callback (default: none). See {@link SweepProgress}. */
  onProgress?: SweepProgress;
  /** Optional per-GAME progress callback (default: none) — fires after each game so a slow single-config run streams. See {@link GameProgress}. */
  onGame?: GameProgress;
}

/**
 * Per-game progress callback. Fired by {@link runConfig} once per game as it
 * finishes, so a slow single-config run (e.g. all-MCTS) streams progress instead
 * of going silent until the whole config is done.
 */
export type GameProgress = (done: number, total: number, nPlayers: number, result: GameResult) => void;

const DEFAULT_PLAYER_COUNTS = [2, 3, 4, 5, 6];

/**
 * The CRN seed for a game: `baseSeed + gameIndex`, independent of the config.
 * This is the common-random-numbers guarantee — every config in a grid/OFAT
 * sweep replays the SAME seed sequence, so config-to-config metric differences
 * reflect the config, not seed noise.
 */
export function perGameSeed(baseSeed: bigint, gameIndex: number): bigint {
  return baseSeed + BigInt(gameIndex);
}

/**
 * Whether some player already controls >= victoryThreshold iron at SETUP.
 *
 * Board/setup mirroring (load-bearing — `setupDecidedFraction` is meaningless if
 * this setup state differs from the one `runGame` actually plays). `runGame` with
 * `boardSource:{kind:"generate",size,ironCount}` does, in order:
 *   rng = seed(perGameSeed)
 *   { board, rng } = generateBoard(rng, { size, ironCount })   // rng advanced
 *   state = setupGame(rng, board, nPlayers, config)            // post-gen rng
 * We replicate that exact sequence here — same seed, same params, and crucially
 * the SAME post-generation rng threaded into `setupGame` — so `setupState` is
 * structurally identical to the state `runGame` begins from. (Base PLACEMENT in
 * `setupGame` is deterministic from board geometry; the rng only feeds the turn-1
 * order shuffle, which this flag never reads — but we mirror the threading anyway
 * so the parity is literal, not argued.)
 */
function setupDecidedFor(config: RuleConfig, perSeed: bigint, nPlayers: number): boolean {
  const { board, rng } = generateBoard(seed(perSeed), {
    size: config.boardSize,
    ironCount: config.ironCount,
  });
  const setupState = setupGame(rng, board, nPlayers, config);
  for (let p = 0; p < nPlayers; p++) {
    if (control(setupState, p).iron.length >= config.victoryThreshold) return true;
  }
  return false;
}

/**
 * Run `games` seeded games for one config and aggregate into SweepMetrics.
 *
 * Per game `i`: nPlayers cycles through `playerCounts`; seed is `perGameSeed`
 * (CRN). We compute `setupDecided` (see {@link setupDecidedFor}), run `runGame`
 * via the `agentFor` seam (heuristicAgent by default), then aggregate every
 * GameRecord with `computeMetrics`. Deterministic given (config, baseSeed, games).
 */
export function runConfig(config: RuleConfig, opts: RunConfigOptions): SweepMetrics {
  const playerCounts = opts.playerCounts ?? DEFAULT_PLAYER_COUNTS;
  const agentFor: (player: PlayerId) => Agent =
    opts.agentFactory ?? (() => heuristicAgent());

  const records: GameRecord[] = [];
  for (let gameIndex = 0; gameIndex < opts.games; gameIndex++) {
    const nPlayers = playerCounts[gameIndex % playerCounts.length]!;
    const gameSeed = perGameSeed(opts.baseSeed, gameIndex);

    const setupDecided = setupDecidedFor(config, gameSeed, nPlayers);

    // archetypes is a length-nPlayers placeholder: the `agentFor` seam supplies
    // the actual move, so the archetype path is never taken — fill with a valid
    // archetype to satisfy the length-nPlayers contract.
    const archetypes: Archetype[] = Array.from({ length: nPlayers }, () => "economic");

    const result = runGame({
      seed: gameSeed,
      boardSource: { kind: "generate", size: config.boardSize, ironCount: config.ironCount },
      nPlayers,
      archetypes,
      config,
      turnCap: opts.turnCap,
      agentFor,
    });

    records.push({
      result,
      nPlayers,
      setupDecided,
      turn1Leaders: turn1LeadersOf(result),
    });

    opts.onGame?.(gameIndex + 1, opts.games, nPlayers, result);
  }

  return computeMetrics(records);
}

/** Cartesian product of `axes` value-lists; each element is a chosen value per axis key. */
function cartesian(axes: Partial<Record<keyof RuleConfig, (number | boolean | string)[]>>): Partial<RuleConfig>[] {
  const keys = Object.keys(axes) as (keyof RuleConfig)[];
  let combos: Partial<RuleConfig>[] = [{}];
  for (const k of keys) {
    const values = axes[k] ?? [];
    const next: Partial<RuleConfig>[] = [];
    for (const combo of combos) {
      for (const v of values) {
        next.push({ ...combo, [k]: v });
      }
    }
    combos = next;
  }
  return combos;
}

/**
 * Run the full Cartesian product of `axes` applied over `base`, one `runConfig`
 * per config. CRN: every config uses the SAME `opts.baseSeed`, so the per-game
 * seed sequences match across configs and metric differences are config-driven.
 */
export function sweepGrid(
  axes: Partial<Record<keyof RuleConfig, (number | boolean | string)[]>>,
  base: RuleConfig,
  opts: RunConfigOptions,
): { config: RuleConfig; metrics: SweepMetrics }[] {
  const combos = cartesian(axes);
  const total = combos.length;
  return combos.map((overrides, idx) => {
    const config: RuleConfig = { ...base, ...overrides };
    const metrics = runConfig(config, opts);
    opts.onProgress?.(idx + 1, total, config, metrics);
    return { config, metrics };
  });
}

/**
 * Vary a single `axis` around `baseline` over `values`, one `runConfig` per value.
 * CRN: all runs share `opts.baseSeed`. Only `axis` changes; every other field
 * stays at the baseline.
 */
export function sweepOFAT(
  baseline: RuleConfig,
  axis: keyof RuleConfig,
  values: (number | boolean | string)[],
  opts: RunConfigOptions,
): { value: number | boolean | string; metrics: SweepMetrics }[] {
  return values.map((value) => {
    const config: RuleConfig = { ...baseline, [axis]: value };
    return { value, metrics: runConfig(config, opts) };
  });
}

/**
 * 95% confidence-interval half-width for a proportion `p` over `n` samples:
 * `1.96 * sqrt(p(1-p)/n)`. Returns 0 when `n <= 0` (no samples -> no interval),
 * guarding against a NaN leak.
 */
export function proportionCI(p: number, n: number): number {
  if (n <= 0) return 0;
  return 1.96 * Math.sqrt((p * (1 - p)) / n);
}
