// ABOUTME: selectComposer — the pure phase→composer decision the GameScreen switches on. Maps the
// ABOUTME: authoritative state + pending + controllable seats to exactly one contextual composer kind.
import { currentPlayer, legalActions } from "../engine-client/barrel";
import type { GameState } from "../engine-client/barrel";
import type { DriverPending } from "../game/driver";

/**
 * The contextual composer the board's active turn resolves to. This is the AUTHORITATIVE-state-derived
 * choice only — `chainContinue` (the "attack again / done" beat that follows a landed attack) is NOT
 * here: it is a transient UI mode GameScreen tracks locally after an attack submit, layered on top of
 * `play`, since no `GameState` field distinguishes "mid-attack-chain" from "start of my turn".
 *
 * - `defender` — a pending defender decision this client controls is outstanding (blocks everything).
 * - `setup`    — the setup phase (`phase.turn === 0`): first-base placement.
 * - `waiting`  — a play-phase turn belonging to a seat this client does NOT control (an agent, or a
 *                remote human under a future SocketDriver). The screen shows a waiting state, no composer.
 * - `forcedPass` — the current (controllable) player's only legal action is pass (`allowPass` off and
 *                stuck): a notice, not an actionable composer.
 * - `play`     — the current player is controllable and has real build/attack choices: Build + Attack.
 */
export type ComposerKind = "defender" | "setup" | "waiting" | "forcedPass" | "play";

/**
 * The single composer `state`/`pending`/`controllableSeats` resolve to. Decision order is a strict
 * priority cascade: a pending defender decision outranks the phase; setup outranks the play-phase
 * turn split; within play, control gates the actionable composers.
 *
 * `pending` is the store's `authoritative.pending` — the store only ever sets it for a `promptedSeat`
 * this client controls (game/store.ts's `prompt` handler), so a non-null `pending` here is ALWAYS a
 * decision this client must answer. A pending for another seat leaves `pending` null and the screen
 * falls through to the waiting/turn logic below.
 */
export function selectComposer(
  state: GameState,
  pending: DriverPending | null,
  controllableSeats: readonly number[],
): ComposerKind {
  if (pending !== null) return "defender";
  if (state.phase.turn === 0) return "setup";

  const acting = currentPlayer(state);
  if (!controllableSeats.includes(acting)) return "waiting";

  const actions = legalActions(state);
  if (actions.length === 1 && actions[0]!.kind === "pass") return "forcedPass";
  return "play";
}
