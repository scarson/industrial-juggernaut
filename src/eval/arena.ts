// ABOUTME: roundRobin — plays seeded games between named agents and reports win-rates, games-played, and Elo.
// ABOUTME: Pure/deterministic given seed (randomness via the seeded games only); the arena that proves gate (2).

import { runGame } from "../driver/run";
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
}

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
export function roundRobin(agents: NamedAgent[], opts: RoundRobinOpts): RoundRobinResult {
  const config = opts.config ?? defaultConfig();

  const wins: Record<string, number> = {};
  const gamesPlayed: Record<string, number> = {};
  const elo: Record<string, number> = {};
  const headToHead: Record<string, Record<string, number>> = {};
  for (const a of agents) {
    wins[a.name] = 0;
    gamesPlayed[a.name] = 0;
    elo[a.name] = ELO_START;
    headToHead[a.name] = {};
    for (const b of agents) {
      if (a.name !== b.name) headToHead[a.name]![b.name] = 0;
    }
  }

  // Each matchup consumes a disjoint, deterministic block of seeds so matchups
  // can't collide on the game stream.
  let seedOffset = 0n;

  for (const n of opts.playerCounts) {
    if (agents.length !== n) {
      throw new Error(
        `roundRobin: playerCount ${n} requires exactly ${n} agents (got ${agents.length}); ` +
          `assign one named agent per seat.`,
      );
    }

    for (let g = 0; g < opts.gamesPerMatchup; g++) {
      // seat s -> agent index (s + g) mod n; agentAtSeat[s] is the NamedAgent in seat s.
      const agentAtSeat: NamedAgent[] = Array.from(
        { length: n },
        (_unused, s) => agents[(s + g) % n]!,
      );

      const res = runGame({
        seed: opts.seed + seedOffset + BigInt(g),
        boardSource: { kind: "generate", size: config.boardSize, ironCount: config.ironCount },
        nPlayers: n,
        // Unused under agentFor, but RunOptions requires a length-n array.
        archetypes: Array.from({ length: n }, () => "economic" as const),
        config,
        turnCap: opts.turnCap,
        agentFor: (player: PlayerId) => agentAtSeat[player]!.agent,
      });

      const winnerSeats = new Set(res.winnerOrCoalition);

      // Tally wins/games per agent for this game.
      for (let s = 0; s < n; s++) {
        const name = agentAtSeat[s]!.name;
        gamesPlayed[name]! += 1;
        if (winnerSeats.has(s)) wins[name]! += 1;
      }

      // Pairwise Elo update + head-to-head over every unordered seat pair.
      for (let s = 0; s < n; s++) {
        for (let t = s + 1; t < n; t++) {
          const a = agentAtSeat[s]!.name;
          const b = agentAtSeat[t]!.name;
          // Same agent in both seats (possible only if names collide) — skip.
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
            // Both lost, both in a shared coalition, or no winner: a draw.
            scoreA = 0.5;
          }
          const expA = expectedScore(elo[a]!, elo[b]!);
          elo[a]! += ELO_K * (scoreA - expA);
          elo[b]! += ELO_K * (1 - scoreA - (1 - expA));
        }
      }
    }

    seedOffset += BigInt(opts.gamesPerMatchup);
  }

  const winRates: Record<string, number> = {};
  for (const a of agents) {
    const gp = gamesPlayed[a.name]!;
    winRates[a.name] = gp === 0 ? 0 : wins[a.name]! / gp;
  }

  return { winRates, gamesPlayed, elo, headToHead };
}
