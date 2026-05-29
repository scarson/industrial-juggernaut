// ABOUTME: lookahead2MultiAgent — N-player generalization of lookahead2. For each of MY legal T1 actions,
// ABOUTME: simulate all opponents' heuristic responses to the end of the round, then pick the best T2 response.

import { evaluate } from "./heuristic";
import { heuristicAgent } from "./heuristic-agent";
import { legalActions } from "../engine/legal";
import { stepRound } from "../engine/round";
import { status } from "../engine/status";
import { advanceRound, currentPlayer } from "../engine/turn";
import type { Agent } from "./agent";
import type { Action, GameState, PlayerId } from "../engine/types";

/**
 * 2-ply minimax search generalized to N-player games (3P, 4P, ...).
 *
 * The original `lookahead2Agent` was designed for 2-player matches. In a 2P game,
 * "simulate to my next turn" means "let the opponent play once." For 3P/4P/etc.,
 * it means "let EVERY other player play once" — and each opponent's choice may
 * depend on what every prior opponent did, so we must simulate them in the actual
 * turn order. This agent does exactly that.
 *
 * Algorithm (for the acting player P):
 *   For each of my T1 legal actions A:
 *     1. Apply A, advance round.
 *     2. While `currentPlayer != P` and game ongoing: simulate that player's
 *        heuristic move, apply, advance round.
 *     3. If game ended in my victory: score = +Inf; in any-other-coalition's
 *        victory: -Inf. Otherwise:
 *     4. Search my T2 legal actions for the one maximizing `evaluate(after_T2)[me]`.
 *   Pick T1 A maximizing T2 value.
 *
 * Opponent moves are modeled by the perimeter-aware heuristic at temp→0 (their
 * argmax). This is approximate — a true max^n search would minimize over each
 * opponent's choices — but it matches the actual opponent in practice when the
 * opponent IS the heuristic (most of our sims), and is a sound heuristic anchor
 * otherwise. The deterministic-PRNG simulation captures the iron-weighted
 * turn-order draw, same as lookahead2.
 *
 * `state.rngState` returned unchanged (search runs on copies).
 */
export function chooseActionLookahead2Multi(
  state: GameState,
  player: PlayerId,
): { action: Action; state: GameState } {
  const myActions = legalActions(state);
  if (myActions.length === 0) {
    throw new Error(
      `lookahead2-multi agent: no legal action available for player ${player} at turn ${state.phase.turn}`,
    );
  }
  const opp = heuristicAgent();
  let bestAction: Action = myActions[0]!;
  let bestValue = Number.NEGATIVE_INFINITY;
  for (const cand of myActions) {
    const value = scoreCandidate(state, player, cand, opp);
    if (value > bestValue) {
      bestValue = value;
      bestAction = cand;
    }
  }
  return { action: bestAction, state };
}

const TURN_CAP = 60;

function scoreCandidate(state: GameState, player: PlayerId, myAction: Action, opp: Agent): number {
  let cur: GameState;
  try {
    cur = stepRound(state, myAction).state;
  } catch {
    return Number.NEGATIVE_INFINITY;
  }
  {
    const st = status(cur);
    if (st.kind === "victory") {
      return st.players.includes(player) ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    }
  }
  cur = advanceRound(cur);

  // Simulate opponent rounds (potentially MANY in 3P/4P games) until it's my turn again.
  // The safety cap of 4 × player_count covers a full turn even with eliminations + rollover.
  const safetyCap = 4 * state.players.length + 4;
  for (let safety = 0; safety < safetyCap; safety++) {
    const st = status(cur);
    if (st.kind === "victory") {
      return st.players.includes(player) ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    }
    if (cur.phase.turn > TURN_CAP) {
      return evaluate(cur)[player] ?? Number.NEGATIVE_INFINITY;
    }
    const acting = currentPlayer(cur);
    if (acting === player && !cur.players[player]!.eliminated) {
      break; // ready for my T2 search
    }
    if (cur.players[acting]!.eliminated) {
      cur = advanceRound(cur);
      continue;
    }
    const oppChoice = opp(cur, acting);
    cur = oppChoice.state;
    try {
      cur = stepRound(cur, oppChoice.action).state;
    } catch {
      return Number.NEGATIVE_INFINITY;
    }
    const stMid = status(cur);
    if (stMid.kind === "victory") {
      return stMid.players.includes(player) ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    }
    cur = advanceRound(cur);
  }

  // T2: search my legal actions for the best 1-step evaluate.
  if (status(cur).kind === "victory") {
    const st = status(cur);
    if (st.kind === "victory") {
      return st.players.includes(player) ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    }
  }
  const t2Actions = legalActions(cur);
  if (t2Actions.length === 0) {
    return evaluate(cur)[player] ?? Number.NEGATIVE_INFINITY;
  }
  let best = Number.NEGATIVE_INFINITY;
  for (const t2 of t2Actions) {
    let after: GameState;
    try {
      after = stepRound(cur, t2).state;
    } catch {
      continue;
    }
    const st2 = status(after);
    if (st2.kind === "victory") {
      if (st2.players.includes(player)) return Number.POSITIVE_INFINITY;
      continue;
    }
    const v = evaluate(after)[player] ?? Number.NEGATIVE_INFINITY;
    if (v > best) best = v;
  }
  return best;
}

export function lookahead2MultiAgent(): Agent {
  return (state, player) => chooseActionLookahead2Multi(state, player);
}
