// ABOUTME: Truly-random agent — picks uniformly from legalActions, no scoring. The skill floor.
// ABOUTME: Used as a sanity reference: if heuristic beats random by Δ ≈ baseline, the heuristic provides real skill.

import { legalActions } from "../engine/legal";
import { nextInt } from "../rng/pcg";
import type { Agent } from "./agent";
import type { Action, GameState, PlayerId } from "../engine/types";

/**
 * Choose an action uniformly at random from the legal set. Consumes ONE rng draw,
 * advancing `state.rngState` deterministically.
 */
export function chooseActionRandom(state: GameState, _player: PlayerId): { action: Action; state: GameState } {
  void _player;
  const acts = legalActions(state);
  if (acts.length === 0) {
    throw new Error(
      `random agent: no legal action available for player ${_player} at turn ${state.phase.turn}`,
    );
  }
  const { value: idx, state: rngState } = nextInt(state.rngState, acts.length);
  return { action: acts[idx]!, state: { ...state, rngState } };
}

export function randomAgent(): Agent {
  return (state, player) => chooseActionRandom(state, player);
}
