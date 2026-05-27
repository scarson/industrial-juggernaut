// ABOUTME: runGame — drives a full game to termination (victory or turn cap) and returns a GameResult.
// ABOUTME: PURE w.r.t. its inputs and deterministic for a given seed (no global state, no Math.random; all
// ABOUTME: randomness threads through the seeded PRNG carried in GameState). See Task 7.1.

import { chooseAction } from "../agent/greedy";
import { generateBoard } from "../board/generate";
import { loadBoard } from "../board/load";
import { control } from "../engine/control";
import { stepRound } from "../engine/round";
import { status } from "../engine/status";
import { advanceRound, currentPlayer, setupGame } from "../engine/turn";
import { seed } from "../rng/pcg";
import type { Board, GameState, PlayerId } from "../engine/types";
import type { GameResult, RunOptions } from "./record";

/**
 * Controlled-iron count per player at the current state. Length === nPlayers;
 * eliminated players have no bases and so naturally yield 0.
 */
function snapshot(state: GameState): number[] {
  return state.players.map((p) => control(state, p.id).iron.length);
}

/**
 * Run a single game to completion.
 *
 * Snapshot timing: `ironOverTime` records one row at each TURN boundary that the
 * driver crosses (i.e. when `advanceRound` rolls over and increments
 * `phase.turn`), capturing the controlled-iron counts at the START of the new
 * turn. The final turn that ends in victory mid-turn is captured too (a snapshot
 * is pushed on the victory path), so there is always >= 1 row.
 *
 * Termination: a victory found by `status` after any round ends the game with
 * that coalition/reason; otherwise the game stops once `phase.turn` would exceed
 * `turnCap`, recorded as `hitTurnCap`.
 */
export function runGame(opts: RunOptions): GameResult {
  // 1. Seed the PRNG and build the board, threading rng forward (GEO-3).
  let rng = seed(opts.seed);
  let board: Board;
  if (opts.boardSource.kind === "generate") {
    const g = generateBoard(rng, {
      size: opts.boardSource.size,
      ironCount: opts.boardSource.ironCount,
    });
    board = g.board;
    rng = g.rng;
  } else {
    board = loadBoard(opts.boardSource.def);
  }

  // 2. Initial state.
  let state = setupGame(rng, board, opts.nPlayers, opts.config);

  const ironOverTime: number[][] = [];

  // Helper: package a finished result, recording a final snapshot.
  const finish = (winner: PlayerId[], victoryType: GameResult["victoryType"]): GameResult => {
    ironOverTime.push(snapshot(state));
    return {
      winnerOrCoalition: winner,
      turns: state.phase.turn,
      victoryType,
      ironOverTime,
      hitTurnCap: false,
    };
  };

  // Already-terminal at setup (degenerate edge cases): return immediately.
  {
    const st0 = status(state);
    if (st0.kind === "victory") {
      return finish(st0.players, st0.reason);
    }
  }

  // 4. Main loop, bounded by turnCap.
  for (;;) {
    const player = currentPlayer(state);

    if (!state.players[player]!.eliminated) {
      // Agent chooses an action and advances the rng in the returned state. When an
      // explicit `agentFor` is supplied, the move comes from that agent; otherwise the
      // archetype->greedy path is used unchanged. Both return the same {action, state}.
      const choice = opts.agentFor
        ? opts.agentFor(player)(state, player)
        : chooseAction(state, player, opts.archetypes[player]!);
      state = choice.state;

      // Apply the action and run the post-action board reassessment (eliminations
      // for the acting player, then encircled-stranded removal) via the shared
      // stepRound helper — the SAME per-round body the MCTS simulation uses, so the
      // search advances a round exactly as the live game does. applyAction throwing
      // here is a fatal agent bug; surface it with full diagnostics including the
      // seed for reproduction.
      try {
        state = stepRound(state, choice.action).state;
      } catch (e) {
        throw new Error(
          `Illegal action from agent (seed=${opts.seed}, turn=${state.phase.turn}, player=${player}, action=${JSON.stringify(choice.action)}): ${String(e)}`,
        );
      }
    }

    // End-of-round victory check.
    const st = status(state);
    if (st.kind === "victory") {
      return finish(st.players, st.reason);
    }

    // Advance to the next round; record a snapshot on each TURN boundary.
    const before = state.phase.turn;
    state = advanceRound(state);
    if (state.phase.turn !== before) {
      ironOverTime.push(snapshot(state));
      if (state.phase.turn > opts.turnCap) {
        // 5. Turn cap hit — non-terminating game recorded rather than hung.
        return {
          winnerOrCoalition: [],
          turns: state.phase.turn,
          victoryType: "none",
          ironOverTime,
          hitTurnCap: true,
        };
      }
    }
  }
}
