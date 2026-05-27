// ABOUTME: Game-driver result records — GameResult, BoardSource, RunOptions (Task 7.1).
// ABOUTME: Pure data types only; consumed by runGame and the acceptance/sweep harnesses.

import type { Archetype } from "../agent/archetypes";
import type { RuleConfig } from "../engine/config";
import type { BoardDefinition, PlayerId } from "../engine/types";

/** Why a game ended; "none" iff the turn cap was hit without any victory. */
export type VictoryType = "iron" | "last-standing" | "none";

/** The outcome of a single driven game. */
export interface GameResult {
  /** Winning player(s)/coalition. `[]` iff `hitTurnCap` (no winner). */
  winnerOrCoalition: PlayerId[];
  /** `phase.turn` reached at termination (>= 1). */
  turns: number;
  /** Victory reason; "none" iff `hitTurnCap`. */
  victoryType: VictoryType;
  /** `ironOverTime[t][p]` = player p's controlled-iron count at turn boundary t. */
  ironOverTime: number[][];
  /** True iff the game was stopped by the turn cap rather than a victory. */
  hitTurnCap: boolean;
}

/** Where the game's board comes from: procedurally generated, or a fixed definition. */
export type BoardSource =
  | { kind: "generate"; size: number; ironCount: number }
  | { kind: "fixed"; def: BoardDefinition };

/** Everything `runGame` needs; pure w.r.t. these inputs and deterministic for a given `seed`. */
export interface RunOptions {
  seed: bigint;
  boardSource: BoardSource;
  nPlayers: number;
  /** length nPlayers; `archetypes[p]` is the archetype for player p. */
  archetypes: Archetype[];
  config: RuleConfig;
  turnCap: number;
}
