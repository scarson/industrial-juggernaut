// ABOUTME: lookaheadNAgent — generalized N-ply lookahead with heuristic leaf eval. lookahead2 is the N=2 special case.
// ABOUTME: Cost is exponential in N; N=3 takes ~10x N=2 per move. Used to test whether deeper search finds more.

import { evaluate } from "./heuristic";
import { heuristicAgent } from "./heuristic-agent";
import { legalActions } from "../engine/legal";
import { stepRound } from "../engine/round";
import { status } from "../engine/status";
import { advanceRound, currentPlayer } from "../engine/turn";
import type { Agent } from "./agent";
import type { Action, GameState, PlayerId } from "../engine/types";

const TURN_CAP_INTERNAL = 60;

/**
 * Generalized N-ply lookahead. For depth=2 this is identical to `lookahead2Agent`.
 * For depth≥3, after the first "my turn → opponents → my turn" cycle, the search
 * recurses on the resulting state with depth-1 remaining "my turns" to evaluate.
 *
 * Cost scales roughly as `|actions|^depth` × game state. Heuristic-leaf eval
 * applies after the deepest "my turn" expansion.
 */
export function lookaheadNAgent(depth: number): Agent {
  if (!Number.isInteger(depth) || depth < 1) {
    throw new Error(`lookaheadN: depth must be a positive integer (got ${depth})`);
  }
  return (state, player) => choose(state, player, depth);
}

function choose(state: GameState, player: PlayerId, depth: number): { action: Action; state: GameState } {
  const myActions = legalActions(state);
  if (myActions.length === 0) {
    throw new Error(`lookaheadN agent: no legal action available for player ${player} at turn ${state.phase.turn}`);
  }
  const opp = heuristicAgent();
  let bestAction = myActions[0]!;
  let bestValue = Number.NEGATIVE_INFINITY;
  for (const a of myActions) {
    const v = score(state, player, a, depth, opp);
    if (v > bestValue) { bestValue = v; bestAction = a; }
  }
  return { action: bestAction, state };
}

function score(state: GameState, player: PlayerId, myAction: Action, depthRemaining: number, opp: Agent): number {
  let cur: GameState;
  try { cur = stepRound(state, myAction).state; } catch { return Number.NEGATIVE_INFINITY; }
  {
    const st = status(cur);
    if (st.kind === "victory") {
      return st.players.includes(player) ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    }
  }
  cur = advanceRound(cur);

  // Loop opponents until it's my turn or terminal.
  const safetyCap = 4 * state.players.length + 4;
  for (let safety = 0; safety < safetyCap; safety++) {
    const st = status(cur);
    if (st.kind === "victory") {
      return st.players.includes(player) ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    }
    if (cur.phase.turn > TURN_CAP_INTERNAL) return evaluate(cur)[player] ?? Number.NEGATIVE_INFINITY;
    const acting = currentPlayer(cur);
    if (acting === player && !cur.players[player]!.eliminated) break;
    if (cur.players[acting]!.eliminated) { cur = advanceRound(cur); continue; }
    const oppChoice = opp(cur, acting);
    cur = oppChoice.state;
    try { cur = stepRound(cur, oppChoice.action).state; } catch { return Number.NEGATIVE_INFINITY; }
    const stMid = status(cur);
    if (stMid.kind === "victory") {
      return stMid.players.includes(player) ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    }
    cur = advanceRound(cur);
  }

  // Now it's my turn again. If depthRemaining > 1, recurse over my actions.
  if (depthRemaining > 1) {
    const myActs = legalActions(cur);
    if (myActs.length === 0) return evaluate(cur)[player] ?? Number.NEGATIVE_INFINITY;
    let best = Number.NEGATIVE_INFINITY;
    for (const next of myActs) {
      const v = score(cur, player, next, depthRemaining - 1, opp);
      if (v > best) best = v;
    }
    return best;
  }

  // Leaf — pick my best 1-step evaluate over T2/Tn legal actions.
  const finalActs = legalActions(cur);
  if (finalActs.length === 0) return evaluate(cur)[player] ?? Number.NEGATIVE_INFINITY;
  let best = Number.NEGATIVE_INFINITY;
  for (const fa of finalActs) {
    let after: GameState;
    try { after = stepRound(cur, fa).state; } catch { continue; }
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
