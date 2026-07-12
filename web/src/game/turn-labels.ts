// ABOUTME: turnLabel/seedLabel — pure derivations feeding the top-bar turn chip, the seed readout,
// ABOUTME: and the play screen's turn banner. Player names follow the 1-based on-screen convention.
import { currentPlayer } from "../engine-client/barrel";
import type { GameState, SessionHeader } from "../engine-client/barrel";

/**
 * The whose-turn summary: `"Setup — Player N places"` during setup (`phase.turn === 0`),
 * `"Turn T — Player N's round"` in play. "Turn"/"round" follow the rules vocabulary: a turn
 * contains each surviving player's one round (build or attack). Labels are 1-based on screen
 * (the event-copy convention); the 0-based PlayerId never leaks.
 */
export function turnLabel(state: GameState): string {
  const name = `Player ${currentPlayer(state) + 1}`;
  if (state.phase.turn === 0) return `Setup — ${name} places`;
  return `Turn ${state.phase.turn} — ${name}’s round`;
}

/**
 * The seed/config readout for the top bar's mono telemetry: the decimal seed plus the board's
 * provenance (`"96 hexes"` for a generated board, `"fixed board"` for a pasted definition —
 * a fixed def's hex count is the def's business, not this label's).
 */
export function seedLabel(header: SessionHeader): string {
  const board =
    header.boardSource.kind === "generate" ? `${header.boardSource.size} hexes` : "fixed board";
  return `seed ${header.seed.toString()} · ${board}`;
}
