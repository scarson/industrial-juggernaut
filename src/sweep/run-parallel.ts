// ABOUTME: Parallel entry points — runConfigParallel and roundRobinParallel shard independent games across a GamePool.
// ABOUTME: Deterministic: same seed-indexed games as the serial paths, results merged in fixed order, so output equals serial.

import { computeMetrics, type SweepMetrics } from "./metrics";
import { perGameSeed, DEFAULT_PLAYER_COUNTS, type GameProgress } from "./run";
import { GamePool, type SimJob } from "./pool";
import type { AgentSpec } from "./agent-spec";
import {
  buildArenaSchedule,
  aggregateArena,
  type RoundRobinOpts,
  type RoundRobinResult,
} from "../eval/arena";
import { defaultConfig, type RuleConfig } from "../engine/config";

/** Options for {@link runConfigParallel}. Like RunConfigOptions but the agent is a serializable {@link AgentSpec} (all seats use it). */
export interface ParallelRunOptions {
  games: number;
  turnCap: number;
  baseSeed: bigint;
  playerCounts?: number[];
  /** Agent for every seat (default heuristic). Serializable so workers can rebuild it. */
  agentSpec?: AgentSpec;
  /** Optional per-game progress, fired (in completion order) as each game finishes. */
  onGame?: GameProgress;
}

/**
 * Parallel `runConfig`: plays the same seed-indexed games (CRN, player-count
 * rotation) as the serial path, but across the `pool`'s workers. Records merge in
 * submission order and `computeMetrics` is order-independent, so the result equals
 * the serial `runConfig` byte-for-byte. Caller owns the pool's lifecycle.
 */
export async function runConfigParallel(
  config: RuleConfig,
  opts: ParallelRunOptions,
  pool: GamePool,
): Promise<SweepMetrics> {
  const playerCounts = opts.playerCounts ?? DEFAULT_PLAYER_COUNTS;
  const agentSpec: AgentSpec = opts.agentSpec ?? { kind: "heuristic" };

  const jobs: SimJob[] = [];
  for (let i = 0; i < opts.games; i++) {
    const nPlayers = playerCounts[i % playerCounts.length]!;
    jobs.push({
      seed: perGameSeed(opts.baseSeed, i).toString(),
      config,
      turnCap: opts.turnCap,
      nPlayers,
      seatAgents: Array.from({ length: nPlayers }, () => agentSpec),
    });
  }

  let done = 0;
  const records = await Promise.all(
    jobs.map((job) =>
      pool.runGame(job).then((rec) => {
        done += 1;
        opts.onGame?.(done, jobs.length, job.nPlayers, rec.result);
        return rec;
      }),
    ),
  );
  return computeMetrics(records);
}

/** A serializable named agent for the parallel arena (the parallel analogue of NamedAgent). */
export interface NamedAgentSpec {
  name: string;
  spec: AgentSpec;
}

/**
 * Parallel `roundRobin`: builds the identical deterministic schedule, simulates
 * its games across the `pool`, then runs the SAME `aggregateArena` over the
 * fixed-order outcomes — so winRates/Elo/headToHead equal the serial result.
 * Caller owns the pool's lifecycle.
 */
export async function roundRobinParallel(
  agents: NamedAgentSpec[],
  opts: RoundRobinOpts,
  pool: GamePool,
): Promise<RoundRobinResult> {
  const config = opts.config ?? defaultConfig();
  const schedule = buildArenaSchedule(agents.length, opts);

  const jobs: SimJob[] = schedule.map((e) => ({
    seed: e.seed.toString(),
    config,
    turnCap: opts.turnCap,
    nPlayers: e.n,
    seatAgents: e.seatAgentIdx.map((idx) => agents[idx]!.spec),
  }));

  let done = 0;
  const records = await Promise.all(
    jobs.map((job, i) =>
      pool.runGame(job).then((rec) => {
        done += 1;
        opts.onGame?.(done, jobs.length, schedule[i]!.n, rec.result);
        return rec;
      }),
    ),
  );

  const winnerSeatsPerGame = records.map((rec) => rec.result.winnerOrCoalition);
  return aggregateArena(
    agents.map((a) => a.name),
    schedule,
    winnerSeatsPerGame,
  );
}
