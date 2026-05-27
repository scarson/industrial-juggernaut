// ABOUTME: heuristicAgent — the improved-heuristic agent as a shared Agent closure, greedy at temperature->0.
// ABOUTME: Wraps samplePolicy, drawing on and threading the state's PRNG; reused by the eval harness.

import { samplePolicy, type HeuristicWeights } from "./heuristic";
import type { Agent } from "./agent";

/**
 * Default temperature for `heuristicAgent`. ~1e-6 drives every softmax in
 * `samplePolicy` to its argmax, so the agent plays the deterministic improved-
 * heuristic GREEDY move while staying on the same sampling code path.
 */
const GREEDY_TEMPERATURE = 1e-6;

/** Configuration for `heuristicAgent`: position weights and sampling temperature. */
export interface HeuristicAgentParams {
  weights?: HeuristicWeights;
  temperature?: number;
}

/**
 * Bind heuristic parameters and return the shared `Agent` closure. At the default
 * temperature (~1e-6) this is the improved-heuristic greedy agent: `samplePolicy`
 * collapses to argmax. The state's `rngState` is advanced by the policy's draws
 * and threaded into the returned state (same in-`state` rng pattern as applyAction).
 */
export function heuristicAgent(params?: HeuristicAgentParams): Agent {
  return (state, player) => {
    const { action, rng } = samplePolicy(
      state,
      player,
      state.rngState,
      params?.temperature ?? GREEDY_TEMPERATURE,
    );
    return { action, state: { ...state, rngState: rng } };
  };
}
