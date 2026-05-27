// ABOUTME: roundRobin — plays seeded games between named agents and reports win-rates, games-played, and Elo.
// ABOUTME: Pure/deterministic given seed (randomness via the seeded games only); the arena that proves gate (2).

import { runGame } from "../driver/run";
import type { GameResult } from "../driver/record";
import type { Agent } from "../agent/agent";
import type { RuleConfig } from "../engine/config";
import { defaultConfig } from "../engine/config";
import type { PlayerId } from "../engine/types";

/** A named agent for the arena — `name` keys the result maps, `agent` plays. */
export interface NamedAgent {
  name: string;
  agent: Agent;
}

/** Inputs for `roundRobin`. Deterministic for a fixed `seed`. */
export interface RoundRobinOpts {
  /** Player counts to play; for each `n` here a matchup of `n` agents is run. */
  playerCounts: number[];
  /** Seeded games per (playerCount) matchup. */
  gamesPerMatchup: number;
  /** Base seed; deterministic given this value. */
  seed: bigint;
  /** Rule config; defaults to `defaultConfig()`. */
  config?: RuleConfig;
  /** Turn cap passed to each game. */
  turnCap: number;
  /** Optional per-GAME progress callback (default: none) — fires after each game so a slow arena run streams. See {@link ArenaGameProgress}. */
  onGame?: ArenaGameProgress;
}

/**
 * Per-game arena progress callback. Fired by {@link roundRobin} once per game as
 * it finishes; `done`/`total` are a flat counter across all matchups so a slow
 * arena run streams progress instead of going silent until the end.
 */
export type ArenaGameProgress = (done: number, total: number, playerCount: number, result: GameResult) => void;

/** Aggregated arena outcome keyed by agent name. */
export interface RoundRobinResult {
  /** wins / gamesPlayed per agent, in [0,1]. A game is a win for an agent if any of its seats is in the winner coalition. */
  winRates: Record<string, number>;
  /** Total games each agent played across all matchups. */
  gamesPlayed: Record<string, number>;
  /** Relative Elo rating per agent (one-pass logistic update over recorded game outcomes). */
  elo: Record<string, number>;
  /** headToHead[a][b] = wins of agent a against agent b (decisive games only). */
  headToHead: Record<string, Record<string, number>>;
}

/** Elo starting rating and update constant — fixed so the ranking is deterministic and reproducible. */
const ELO_START = 1500;
const ELO_K = 32;

/**
 * Per-game outcome between two agents from agent A's perspective: 1 = A wins,
 * 0 = A loses, 0.5 = draw (no winner / turn cap, or both share a coalition).
 */
type Score = 0 | 0.5 | 1;

/** Logistic expected score of A vs B given their current ratings. */
function expectedScore(ra: number, rb: number): number {
  return 1 / (1 + 10 ** ((rb - ra) / 400));
}

/**
 * Play seeded round-robin games between the named agents.
 *
 * Seat-assignment scheme: each matchup for player count `n` REQUIRES
 * `agents.length === n` (one named agent per seat). To average out seat bias,
 * game `g` rotates the agent list across seats: seat `s` is played by agent
 * `(s + g) mod n`. Over a full rotation each agent occupies every seat equally;
 * for the common 2-agent case this alternates which agent is seat 0 each game.
 *
 * Win accounting: a game is a WIN for every agent that occupies a seat in
 * `winnerOrCoalition`; an empty coalition (turn-cap / no winner) is a draw for
 * all. winRates = wins/gamesPlayed.
 *
 * Elo: a single deterministic pass over the recorded games. Games are processed
 * in fixed (playerCount-major, game-index) order; within each game every unordered
 * pair of seats yields a pairwise result (1/0/0.5 from the perspective of the
 * lower-named agent), updating both ratings by `K·(actual − expected)`. The
 * absolute values are not calibrated — only the RELATIVE ranking is meaningful.
 *
 * Deterministic for a fixed `seed`: game `i` of matchup for player count `n` uses
 * `seed + offset + i` (offset advances per matchup), so the full game stream and
 * thus every output is reproducible. No `Math.random`.
 */
/** One scheduled arena game: its player count, seed, and the agent-index playing each seat. */
export interface ScheduledGame {
  n: number;
  seed: bigint;
  /** seatAgentIdx[s] = index (into the agent list) of the agent in seat s. */
  seatAgentIdx: number[];
}

/**
 * Build the deterministic game schedule for `agentCount` agents under `opts`.
 * For each player count `n` (which must equal `agentCount`), game `g` rotates
 * the agents across seats (seat `s` ← agent `(s+g) mod n`) and gets seed
 * `opts.seed + seedOffset + g`, where seedOffset advances per matchup so matchups
 * never collide on the game stream. Identical for serial and parallel runs — the
 * basis of their bit-for-bit equivalence.
 */
export function buildArenaSchedule(agentCount: number, opts: RoundRobinOpts): ScheduledGame[] {
  const schedule: ScheduledGame[] = [];
  let seedOffset = 0n;
  for (const n of opts.playerCounts) {
    if (agentCount !== n) {
      throw new Error(
        `roundRobin: playerCount ${n} requires exactly ${n} agents (got ${agentCount}); ` +
          `assign one named agent per seat.`,
      );
    }
    for (let g = 0; g < opts.gamesPerMatchup; g++) {
      const seatAgentIdx = Array.from({ length: n }, (_unused, s) => (s + g) % n);
      schedule.push({ n, seed: opts.seed + seedOffset + BigInt(g), seatAgentIdx });
    }
    seedOffset += BigInt(opts.gamesPerMatchup);
  }
  return schedule;
}

/**
 * Aggregate arena outcomes into a {@link RoundRobinResult}. PURE and
 * order-sensitive: `winnerSeatsPerGame[i]` is the winner coalition of
 * `schedule[i]`, and the Elo pass walks them in that fixed order, so the result
 * is identical however the games were simulated (serially or across workers).
 * `agentNames[k]` is the name of agent index `k` (the indices `seatAgentIdx` use).
 */
export function aggregateArena(
  agentNames: string[],
  schedule: ScheduledGame[],
  winnerSeatsPerGame: number[][],
): RoundRobinResult {
  const wins: Record<string, number> = {};
  const gamesPlayed: Record<string, number> = {};
  const elo: Record<string, number> = {};
  const headToHead: Record<string, Record<string, number>> = {};
  const uniqueNames = [...new Set(agentNames)];
  for (const a of uniqueNames) {
    wins[a] = 0;
    gamesPlayed[a] = 0;
    elo[a] = ELO_START;
    headToHead[a] = {};
    for (const b of uniqueNames) {
      if (a !== b) headToHead[a]![b] = 0;
    }
  }

  for (let i = 0; i < schedule.length; i++) {
    const { n, seatAgentIdx } = schedule[i]!;
    const winnerSeats = new Set(winnerSeatsPerGame[i]!);

    for (let s = 0; s < n; s++) {
      const name = agentNames[seatAgentIdx[s]!]!;
      gamesPlayed[name]! += 1;
      if (winnerSeats.has(s)) wins[name]! += 1;
    }

    for (let s = 0; s < n; s++) {
      for (let t = s + 1; t < n; t++) {
        const a = agentNames[seatAgentIdx[s]!]!;
        const b = agentNames[seatAgentIdx[t]!]!;
        if (a === b) continue;
        const aWon = winnerSeats.has(s);
        const bWon = winnerSeats.has(t);
        let scoreA: Score;
        if (aWon && !bWon) {
          scoreA = 1;
          headToHead[a]![b]! += 1;
        } else if (bWon && !aWon) {
          scoreA = 0;
          headToHead[b]![a]! += 1;
        } else {
          scoreA = 0.5;
        }
        const expA = expectedScore(elo[a]!, elo[b]!);
        elo[a]! += ELO_K * (scoreA - expA);
        elo[b]! += ELO_K * (1 - scoreA - (1 - expA));
      }
    }
  }

  const winRates: Record<string, number> = {};
  for (const a of uniqueNames) {
    const gp = gamesPlayed[a]!;
    winRates[a] = gp === 0 ? 0 : wins[a]! / gp;
  }

  return { winRates, gamesPlayed, elo, headToHead };
}

export function roundRobin(agents: NamedAgent[], opts: RoundRobinOpts): RoundRobinResult {
  const config = opts.config ?? defaultConfig();
  const schedule = buildArenaSchedule(agents.length, opts);
  const agentNames = agents.map((a) => a.name);

  const winnerSeatsPerGame: number[][] = [];
  let done = 0;
  for (const e of schedule) {
    const res = runGame({
      seed: e.seed,
      boardSource: { kind: "generate", size: config.boardSize, ironCount: config.ironCount },
      nPlayers: e.n,
      // Unused under agentFor, but RunOptions requires a length-n array.
      archetypes: Array.from({ length: e.n }, () => "economic" as const),
      config,
      turnCap: opts.turnCap,
      agentFor: (player: PlayerId) => agents[e.seatAgentIdx[player]!]!.agent,
    });
    done += 1;
    opts.onGame?.(done, schedule.length, e.n, res);
    winnerSeatsPerGame.push(res.winnerOrCoalition);
  }

  return aggregateArena(agentNames, schedule, winnerSeatsPerGame);
}
