// ABOUTME: lookahead2Agent — deterministic 2-ply minimax search with heuristic-evaluate at leaves.
// ABOUTME: Found by the Opus playtest to beat the heuristic ~40-80% on variant (c) by exploiting its 1-step argmax.

import { evaluate } from "./heuristic";
import { heuristicAgent } from "./heuristic-agent";
import { legalActions } from "../engine/legal";
import { stepRound } from "../engine/round";
import { status } from "../engine/status";
import { advanceRound, currentPlayer } from "../engine/turn";
import type { Agent } from "./agent";
import type { Action, GameState, PlayerId } from "../engine/types";

/**
 * Choose an action via 2-ply minimax with a heuristic leaf evaluator.
 *
 * For each of MY legal actions A at the root:
 *   1. Apply A (`stepRound`), advance the round, simulate opponents' turns via the
 *      perimeter-aware heuristic until it is MY turn again OR game ends.
 *   2. If the game ended in MY victory, score = +Infinity (immediate win).
 *      If the game ended in an opponent victory, score = -Infinity (immediate loss).
 *   3. Otherwise, search over my T2 candidate set:
 *        for each of my legal T2 actions B: apply B, evaluate(after_B)[me].
 *      Take the max as A's T2 value.
 * The chosen action is the A that maximizes this T2 value.
 *
 * Caveats:
 * - The "T2" continuation here means "my next round of play after the opponents
 *   have had their rounds." For the variant-(c) 2P matchup the Opus playtest
 *   characterized, that IS the decisive T2 round; for longer-game variants this
 *   is just a 2-ply heuristic and the leaf eval becomes load-bearing.
 * - Opponent moves are simulated via the perimeter-aware heuristic at temp→0.
 *   We do NOT search over opponent responses — they're fixed by the heuristic
 *   deterministically. (For a true minimax we'd minimize over opponent moves;
 *   that's a follow-up — see `lookahead2-opponent-aware` notes.)
 * - Action draws (attack, break-alliance) DO advance the game rng, so different
 *   T1 choices can lead to different rng states for T2. This naturally captures
 *   the iron-weighted PRNG-flip exploit the Opus agents found.
 *
 * `state.rngState` is returned UNCHANGED — the search runs entirely on copies
 * forked from the input. Matches the heuristic agent's no-rng-consumption contract.
 */
export function chooseActionLookahead2(
  state: GameState,
  player: PlayerId,
): { action: Action; state: GameState } {
  const myActions = legalActions(state);
  if (myActions.length === 0) {
    throw new Error(
      `lookahead2 agent: no legal action available for player ${player} at turn ${state.phase.turn}`,
    );
  }

  const opp = heuristicAgent();

  let bestAction: Action = myActions[0]!;
  let bestValue = -Infinity;

  for (const cand of myActions) {
    const value = scoreCandidate(state, player, cand, opp);
    if (value > bestValue) {
      bestValue = value;
      bestAction = cand;
    }
  }

  return { action: bestAction, state };
}

/**
 * Score one root-candidate action by simulating the round to the player's next
 * turn (or terminal), then taking the best 1-step `evaluate` over the player's
 * T2 legal actions.
 */
function scoreCandidate(
  state: GameState,
  player: PlayerId,
  myAction: Action,
  opp: Agent,
): number {
  let cur: GameState;
  try {
    cur = stepRound(state, myAction).state;
  } catch {
    return -Infinity;
  }
  // Status check before advancing — applyAction may have triggered a victory.
  {
    const st = status(cur);
    if (st.kind === "victory") {
      return st.players.includes(player) ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    }
  }
  cur = advanceRound(cur);

  // Simulate opponent rounds until it's my turn again, or terminal.
  const TURN_CAP = 60;
  for (let safety = 0; safety < 64; safety++) {
    const st = status(cur);
    if (st.kind === "victory") {
      return st.players.includes(player) ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    }
    if (cur.phase.turn > TURN_CAP) {
      // Reached the cap with no victory — score the position from my perspective.
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
      // Opponent agent produced an illegal action (shouldn't happen with the
      // perimeter-aware heuristic but guard so the search doesn't crash). Score
      // this branch as catastrophic for me; the planner will avoid it.
      return Number.NEGATIVE_INFINITY;
    }
    const stMid = status(cur);
    if (stMid.kind === "victory") {
      return stMid.players.includes(player) ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    }
    cur = advanceRound(cur);
  }

  // Now it's my T2. Search the best 1-step evaluate over my legal actions.
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
      // Opponent victory immediately on my move — implausible but score it -Inf.
      continue;
    }
    const v = evaluate(after)[player] ?? Number.NEGATIVE_INFINITY;
    if (v > best) best = v;
  }
  return best;
}

/** Closure binding: return the lookahead2 Agent. */
export function lookahead2Agent(): Agent {
  return (state, player) => chooseActionLookahead2(state, player);
}
