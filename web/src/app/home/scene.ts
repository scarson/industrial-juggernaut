// ABOUTME: The landing hero's curated board scene — a deterministic engine-driven mid-game
// ABOUTME: position (all six players visible). Lazy-chunk only: value-imports engine code.
import {
  initGame,
  placeFirstBase,
  legalFirstBaseHexes,
  legalActions,
  applyAction,
  advanceRound,
  defaultConfig,
} from "../../engine-client/barrel";
import type { GameState, Action } from "../../engine-client/barrel";

// Prefers builds so the scene accrues factories and bases — a settled, prosperous table
// rather than a mid-combat one. Falls back to the first legal action.
function pickAction(actions: Action[]): Action | undefined {
  const build = actions.find((a) => a.kind === "build");
  return build ?? actions[0];
}

/**
 * The map lying open on the table: a six-player mid-game position, fully engine-driven and
 * deterministic (fixed seed, fixed placement stride, build-preferring turns) — the same map
 * greets every visit, like the family table's game in progress. Six players so the full
 * identity set (every shape + pattern) is on display.
 */
export function landingScene(): GameState {
  let state = initGame({
    seed: 7n,
    boardSource: { kind: "generate", size: 150, ironCount: 14 },
    nPlayers: 6,
    config: defaultConfig(),
  });

  while (state.phase.turn === 0) {
    const player = state.phase.order[state.phase.indexInOrder]!;
    const legal = legalFirstBaseHexes(state);
    const idx = (player * 5) % legal.length;
    state = placeFirstBase(state, player, legal[idx]!);
  }

  for (let i = 0; i < 28; i++) {
    const action = pickAction(legalActions(state));
    if (action !== undefined) state = applyAction(state, action).state;
    state = advanceRound(state);
  }

  return state;
}
