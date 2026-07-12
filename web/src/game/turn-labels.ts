// ABOUTME: turnLabel/seedLabel — pure derivations feeding the top-bar turn chip, the seed readout,
// ABOUTME: and the play screen's turn banner. Player names follow the 1-based on-screen convention.
import { currentPlayer } from "../engine-client/barrel";
import type { GameState, PlayerId, SessionHeader } from "../engine-client/barrel";

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
 * The game-over replacement for the whose-turn labels (the turn banner and the top-bar chip):
 * the terminal state has no acting player, so the labels tell the outcome instead. Winner names
 * are 1-based; a coalition compresses to "Players 1 and 3" (the top bar is a slim chip) with the
 * same " and " join as the Victory set piece's summary. An empty winner list is a no-winner
 * termination: "Game over", plain.
 */
export function gameOverLabel(winners: readonly PlayerId[]): string {
  if (winners.length === 0) return "Game over";
  if (winners.length === 1) return `Victory — Player ${winners[0]! + 1}`;
  return `Victory — Players ${winners.map((id) => `${id + 1}`).join(" and ")}`;
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
