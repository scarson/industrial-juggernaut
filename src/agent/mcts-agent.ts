// ABOUTME: The MCTS agent — chooseActionMCTS runs runMcts on a derived internal search rng and returns the most-visited root action.
// ABOUTME: Same {action, state} shape as the greedy agent; the game rng advances by EXACTLY one step so driver replay stays cheap and deterministic.

import {
  runMcts,
  actionKey,
  defaultMctsCoreParams,
  type MctsCoreParams,
  type RootStat,
} from "./mcts";
import type { Agent } from "./agent";
import { nextUint32, seed } from "../rng/pcg";
import { legalActions } from "../engine/legal";
import type { Action, GameState, PlayerId } from "../engine/types";

/**
 * Agent-level MCTS parameters. `MctsCoreParams` already carries every knob the
 * search needs — `iterations`, `maxDepth`, `cPuct`, `heuristicWeights`,
 * `candidateMode`, and the progressive-widening `C`/`alpha`/`temperature` — so
 * the agent-level type is an alias today. It stays a named `interface extends`
 * (rather than a bare `type =`) so a future agent-only knob (e.g. a per-move
 * time budget) has an obvious home without churning every call site.
 */
export interface MctsParams extends MctsCoreParams {}

/**
 * A fixed, documented salt mixed into the internal search-rng derivation so the
 * search stream is decoupled from the game's main PRNG stream even though both
 * are derived from the same incoming `state.rngState`. The value is arbitrary
 * (a stable nothing-up-my-sleeve constant); what matters is that it is FIXED so
 * the derivation is deterministic and auditable, and NON-ZERO so the derived
 * search seed differs from the bare draw value.
 */
export const MCTS_SEARCH_RNG_SALT = 0x9e3779b97f4a7c15n;

/**
 * Default agent params: the core MCTS defaults but with a MODEST iteration
 * budget (100) suitable for arena/sweep throughput. The core default (1000) is
 * tuned for single-move strength; sweeps play thousands of games, so a smaller
 * per-move budget trades a little move quality for far more games-per-hour.
 *
 * 2026-05-28 update: dropped from 300 to 100 after the MCTS@300 stress test on
 * variant (c) showed @300 produces IDENTICAL h2h-vs-heuristic results to @100
 * (`docs/2026-05-28-mcts-300-on-c.md`: 6.3% vs 93.8%, Δ -0.0pp). The perimeter-
 * aware heuristic is near-optimal on the (c) regime; paying for 3× search depth
 * adds no discernible benefit. A pending follow-up explores whether even @25/@50
 * is indistinguishable from @100 (`src/sweep/compare-mcts-budgets.ts`).
 */
export function defaultMctsParams(): MctsParams {
  return { ...defaultMctsCoreParams(), iterations: 100 };
}

/**
 * Pick the most-visited root action, breaking ties deterministically by the
 * canonical `actionKey` (lexicographically smallest wins). Most-visited is the
 * robust MCTS choice (spec §4.2) — it is insensitive to value noise that the
 * raw value estimate would expose.
 */
function mostVisited(rootStats: RootStat[]): Action {
  let best = rootStats[0]!;
  for (let i = 1; i < rootStats.length; i++) {
    const cand = rootStats[i]!;
    if (
      cand.visits > best.visits ||
      (cand.visits === best.visits && actionKey(cand.action) < actionKey(best.action))
    ) {
      best = cand;
    }
  }
  return best.action;
}

/**
 * Choose an action for `player` via MCTS. PURE and deterministic given the
 * incoming `state.rngState`. Same `{action, state}` shape as greedy's
 * `chooseAction`, so the driver/sweep use it interchangeably.
 *
 * RNG handling (spec §4.3, plan A4.1): the search runs on an INTERNAL search rng
 * derived from the incoming game rng — `seed(BigInt(nextUint32(rng).value) ^ SALT)`
 * — so the thousands of search draws never touch the game's main PRNG stream.
 * The returned game `rngState` is advanced by EXACTLY ONE step
 * (`nextUint32(state.rngState).state`), keeping driver replay cheap while staying
 * fully deterministic given the incoming state.
 */
export function chooseActionMCTS(
  state: GameState,
  player: PlayerId,
  params: MctsParams = defaultMctsParams(),
): { action: Action; state: GameState } {
  const draw = nextUint32(state.rngState);
  const searchRng = seed(BigInt(draw.value) ^ MCTS_SEARCH_RNG_SALT);

  const { rootStats } = runMcts(state, player, params, searchRng);
  // Defensive fallback (see test "robustness to no-candidate states"): if the search
  // surfaced ZERO candidates at the root — possible in late maxed-out states or for
  // stranded radiating players under `noIronRequiresPerimeter` — `mostVisited` would
  // dereference `rootStats[0]` (undefined) and crash with the obscure
  // "Cannot read properties of undefined (reading 'action')". Instead, fall back to
  // `legalActions(state)[0]` (degraded but functional) — and only if that is ALSO
  // empty do we throw, with a clear diagnostic the caller can record.
  let action: Action;
  if (rootStats.length > 0) {
    action = mostVisited(rootStats);
  } else {
    const legal = legalActions(state);
    if (legal.length === 0) {
      throw new Error(
        `MCTS agent: no legal action available for player ${player} at turn ${state.phase.turn} ` +
          `(MCTS surfaced 0 candidates AND legalActions returned empty — likely a stranded radiating ` +
          `player under noIronRequiresPerimeter, or a maxed-out late-game state with allowPass=false).`,
      );
    }
    action = legal[0]!;
  }

  return { action, state: { ...state, rngState: draw.state } };
}

/** Bind MCTS params and return the shared `Agent` closure. */
export function mctsAgent(params?: MctsParams): Agent {
  return (state, player) => chooseActionMCTS(state, player, params);
}
