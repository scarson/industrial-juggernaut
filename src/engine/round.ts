// ABOUTME: stepRound — the shared per-round body composing apply -> post-action eliminations -> stranded-base removal.
// ABOUTME: Pure composition of existing engine fns; the driver AND the MCTS simulation call it so both advance a round identically.

import { applyAction } from "./apply";
import { applyEliminations } from "./status";
import { removeEncircledStrandedBases } from "./stranded";
import { currentPlayer } from "./turn";
import type { Action, GameEvent, GameState } from "./types";

/**
 * Advance one player's round: apply `action`, run post-action eliminations with
 * the ACTING player (the `currentPlayer(state)` BEFORE the action) as `byPlayer`,
 * then remove any newly-encircled stranded bases — concatenating the events from
 * each step in order. Pure: every step returns a new state and the input is never
 * mutated.
 *
 * The end-of-round victory check (`status`) and the turn/round advance
 * (`advanceRound`) stay with the CALLER — this helper is only the intra-round
 * board reassessment. Both the live driver (`runGame`) and the MCTS simulation
 * call this so the search advances a round EXACTLY as the real game does (a
 * divergence here would bias MCTS value estimates against the game it plays).
 */
export function stepRound(state: GameState, action: Action): { state: GameState; events: GameEvent[] } {
  const actingPlayer = currentPlayer(state);

  const applied = applyAction(state, action);
  const eliminated = applyEliminations(applied.state, actingPlayer);
  const stranded = removeEncircledStrandedBases(eliminated.state);

  return {
    state: stranded.state,
    events: [...applied.events, ...eliminated.events, ...stranded.events],
  };
}
