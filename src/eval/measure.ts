// ABOUTME: measureDistribution — runs N seeded games under an injected agent and aggregates the outcome shape.
// ABOUTME: Pure/deterministic given baseSeed; used to characterize game-length and victory distributions for balance work.

import { runGame } from "../driver/run";
import type { Agent } from "../agent/agent";
import type { RuleConfig } from "../engine/config";
import { defaultConfig } from "../engine/config";
import type { PlayerId } from "../engine/types";

/** Aggregated outcome distribution over a batch of driven games. */
export interface DistributionResult {
  /** Count of games per `victoryType` ("iron" | "last-standing" | "none"). */
  byVictoryType: Record<string, number>;
  /** Games that ended with no winner (`winnerOrCoalition` empty — turn cap). */
  emptyWinner: number;
  /** Games that ended with a real winning player/coalition. */
  realWinner: number;
  /** `turnsHistogram[t]` = number of games that terminated at `phase.turn` t. */
  turnsHistogram: Record<number, number>;
  /** Games stopped by the turn cap rather than a victory. */
  capHits: number;
  /** Games won via iron-threshold victory (a real iron contest reached a decision). */
  ironVictories: number;
}

/** Inputs for `measureDistribution`. Deterministic for a given `baseSeed`. */
export interface DistributionOpts {
  /** Number of seeded games to run. */
  games: number;
  /** Turn cap passed to each game. */
  turnCap: number;
  /** Agent factory used for EVERY player (via the driver's `agentFor` seam). */
  agentFor: (player: PlayerId) => Agent;
  /** Rule config; defaults to `defaultConfig()`. */
  config?: RuleConfig;
  /** Seed of game 0; game i uses `baseSeed + i`. Defaults to 0n. */
  baseSeed?: bigint;
}

/**
 * Run `opts.games` seeded games and aggregate their outcomes. Game i uses
 * `seed = baseSeed + i` and `nPlayers = 2 + (i % 5)` so the batch spans 2–6
 * players, mirroring the 1000-game acceptance harness. Every player's move comes
 * from `opts.agentFor` via the driver's `agentFor` seam. Deterministic for a
 * fixed `baseSeed` (and agent). `archetypes` is still required by `RunOptions`
 * but unused under `agentFor`; we pass a benign placeholder array of the right
 * length.
 */
export function measureDistribution(opts: DistributionOpts): DistributionResult {
  const baseSeed = opts.baseSeed ?? 0n;
  const config = opts.config ?? defaultConfig();

  const byVictoryType: Record<string, number> = {};
  const turnsHistogram: Record<number, number> = {};
  let emptyWinner = 0;
  let realWinner = 0;
  let capHits = 0;
  let ironVictories = 0;

  for (let i = 0; i < opts.games; i++) {
    const nPlayers = 2 + (i % 5);
    const res = runGame({
      seed: baseSeed + BigInt(i),
      boardSource: { kind: "generate", size: config.boardSize, ironCount: config.ironCount },
      nPlayers,
      // Unused when agentFor is set, but RunOptions requires a length-nPlayers array.
      archetypes: Array.from({ length: nPlayers }, () => "economic" as const),
      config,
      turnCap: opts.turnCap,
      agentFor: opts.agentFor,
    });

    byVictoryType[res.victoryType] = (byVictoryType[res.victoryType] ?? 0) + 1;
    turnsHistogram[res.turns] = (turnsHistogram[res.turns] ?? 0) + 1;
    if (res.winnerOrCoalition.length === 0) emptyWinner++;
    else realWinner++;
    if (res.hitTurnCap) capHits++;
    if (res.victoryType === "iron") ironVictories++;
  }

  return { byVictoryType, emptyWinner, realWinner, turnsHistogram, capHits, ironVictories };
}
