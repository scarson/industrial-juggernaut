// ABOUTME: The single shared Agent closure type plus the greedy-archetype adapter that every later task imports.
// ABOUTME: An Agent maps (state, player) -> {action, state}; factories bind config and return an Agent.

import { chooseAction } from "./greedy";
import type { Archetype } from "./archetypes";
import type { Action, GameState, PlayerId } from "../engine/types";

/**
 * The normalized agent shape. Every agent family (greedy, heuristic, MCTS,
 * scripted exploiters) exposes a factory that binds its config and returns this
 * closure, so the driver and eval harnesses consume agents uniformly without
 * branching on kind. The returned `state` carries the PRNG advanced by whatever
 * draws the agent made (same in-`state` rng pattern as `applyAction`).
 */
export type Agent = (state: GameState, player: PlayerId) => { action: Action; state: GameState };

/** Bind a greedy archetype and return the shared `Agent` closure. */
export function greedyAgent(archetype: Archetype): Agent {
  return (state, player) => chooseAction(state, player, archetype);
}
