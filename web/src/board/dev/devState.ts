// ABOUTME: DEV-ONLY. Drives the pure agent-free engine to a real mid-game 6-player state for the
// ABOUTME: /dev board smoke page. Not shipped in any product route; replaced by P2's real viewer.
import {
  initGame,
  placeFirstBase,
  legalFirstBaseHexes,
  legalActions,
  applyAction,
  advanceRound,
  defaultConfig,
} from "../../engine-client/barrel";
import { hexKey } from "../projection";
import type { GameState, Action } from "../../engine-client/barrel";

// Prefers a "build" action so the mid-game state accrues factories and bases (skips attacks/pass
// for a calmer, denser eyeball state). Falls back to the first legal action otherwise.
function pickAction(actions: Action[]): Action | undefined {
  const build = actions.find((a) => a.kind === "build");
  return build ?? actions[0];
}

/**
 * A real mid-game 6-player state: full setup, then a fixed number of build rounds driven by the
 * engine's own `legalActions` with a fixed seed. Deterministic — same seed, same board, same
 * moves — so the smoke page renders the same scene every load.
 */
export function devMidGameState(rounds = 40): GameState {
  let state = initGame({
    seed: 7n,
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    nPlayers: 6,
    config: defaultConfig(),
  });

  while (state.phase.turn === 0) {
    const player = state.phase.order[state.phase.indexInOrder]!;
    const legal = legalFirstBaseHexes(state);
    // Spread the seats around the outer ring by striding the legal list.
    const idx = (player * 5) % legal.length;
    state = placeFirstBase(state, player, legal[idx]!);
  }

  // Each iteration is one player's turn: apply a build (or fallback) action, then advance the
  // round so the NEXT player acts — otherwise every action lands on the same seat and one player
  // hoards the board. `rounds` counts individual turns, so ~6 per full cycle.
  for (let i = 0; i < rounds; i++) {
    const action = pickAction(legalActions(state));
    if (action !== undefined) state = applyAction(state, action).state;
    state = advanceRound(state);
  }

  return state;
}

/** The canonical hexKeys of the first `n` bases — a synthetic stranded set for the eyeball. */
export function firstNBaseKeys(state: GameState, n: number): Set<string> {
  return new Set(state.bases.slice(0, n).map((b) => hexKey(b.hex)));
}

/** Force the base at `idx` to fatigued (immutable clone) so the smoke page shows the variant. */
export function withFatiguedBase(state: GameState, idx: number): GameState {
  return {
    ...state,
    bases: state.bases.map((b, i) => (i === idx ? { ...b, state: "fatigued" as const } : b)),
  };
}
