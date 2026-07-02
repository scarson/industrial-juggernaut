// ABOUTME: Agent-drive loop — advances agent/eliminated rounds (logging each) until a human seat / pending / end.
// ABOUTME: Pure; takes agentForSeat injected. Attack rounds land in A4. Mirrors recordGame's composition.
import { applyEntry } from "./round";
import { stateHash } from "./hash";
import { encodeEntry } from "./codec";
import { status } from "../engine/status";
import { currentPlayer, representativeFirstBase } from "../engine/turn";
import type { Agent } from "../agent/agent";   // import type only — no value import of src/agent here
import type { PlayerId } from "../engine/types";
import type { LogEntry, SeatConfig } from "./types";
import type { ServerMessage } from "../wire/protocol";
import { logKey, SNAPSHOT_KEY } from "./keys";
import { NO_EFFECTS, type Effects, type SessionState } from "./session-types";

/** The seat whose turn/placement it currently is (setup: the placer; play: the current player). Exported — A3 imports it. */
export function currentActor(s: SessionState): PlayerId {
  return s.game.phase.turn === 0 ? s.game.phase.order[s.game.phase.indexInOrder]! : currentPlayer(s.game);
}

/** True when the host should call driveOneStep (agent/eliminated actor, no pending, game live). */
export function needsDrive(s: SessionState): boolean {
  if (s.pending !== null) return false;
  if (status(s.game).kind === "victory") return false;
  const p = currentActor(s);
  if (s.game.phase.turn !== 0 && s.game.players[p]!.eliminated) return true;
  return s.header.seats[p]!.kind === "agent";
}

export type DriveResult = { next: SessionState; effects: Effects; advanced: boolean; terminal: ReturnType<typeof status> | null };
// terminal (when non-null) is a status() victory: { kind:"victory"; players: PlayerId[]; reason:"iron"|"last-standing" }.
// The gameOver message maps winners = terminal.players, cause = terminal.reason (no helper needed).

/** Advance exactly one agent/eliminated/setup round; return the entry(ies) to persist + broadcast. */
export function driveOneStep(s: SessionState, agentForSeat: (seat: SeatConfig) => Agent): DriveResult {
  const p = currentActor(s);
  // SETUP: agent auto-places via representativeFirstBase (NOT via the injected agent).
  if (s.game.phase.turn === 0) {
    const entry: LogEntry = { player: p, kind: "placeFirstBase", hex: representativeFirstBase(s.game, p), rngBeforeApply: s.game.rngState };
    return commitEntries(s, [entry]); // placeFirstBase never closes a round → no snapshot
  }
  // PLAY, eliminated seat: roundSkipped.
  if (s.game.players[p]!.eliminated) {
    return commitEntries(s, [{ player: p, kind: "roundSkipped", rngBeforeApply: s.game.rngState }]);
  }
  // PLAY, agent seat: select + map to entries.
  const choice = agentForSeat(s.header.seats[p]!)(s.game, p);
  const rng = choice.state.rngState; // post-selection, pre-apply
  const a = choice.action;
  if (a.kind === "build") return commitEntries(s, [{ player: p, kind: "build", pieces: a.pieces.map((x) => ({ type: x.type, hex: x.hex })), rngBeforeApply: rng }]);
  if (a.kind === "pass") return commitEntries(s, [{ player: p, kind: "pass", rngBeforeApply: rng }]);
  // a.kind === "attack": deferred to A4 (agent-attacks-human opens a pending; else attack+endRound).
  throw new Error("driveOneStep: agent attack rounds are implemented in Phase A4");
}

/** Apply a round's entries through applyEntry, threading state; build the atomic PersistOp + broadcasts.
 *  EXPORTED — the SHARED builder reused by A3 (human build/pass/endRound) and A4 (attack), so the
 *  applyEntry→{persist,broadcast,snapshot} logic exists in exactly one place (DRY). */
export function commitEntries(s: SessionState, entries: LogEntry[]): DriveResult {
  let game = s.game;
  let logLength = s.logLength;
  let advanced = false;
  let terminal: ReturnType<typeof status> | null = null;
  const put: Record<string, unknown> = {};
  const broadcast: ServerMessage[] = [];
  for (const entry of entries) {
    const out = applyEntry(game, entry);
    put[logKey(logLength)] = entry;                 // RAW entry (bigints store natively in DO storage)
    broadcast.push({ type: "applied", entry: encodeEntry(entry), events: out.events, logIndex: logLength });
    game = out.state;
    logLength += 1;
    if (out.advanced) advanced = true;
    if (out.terminal) terminal = out.terminal;       // a victory-closing round: applyEntry did NOT advanceRound
  }
  if (advanced) {
    // Snapshot holds post-composition state (post-advanceRound for a normal close; the victory state for a
    // terminal close, where applyEntry deliberately skips advanceRound — round.ts).
    put[SNAPSHOT_KEY] = { state: game, logIndex: logLength - 1, stateHash: stateHash(game), replayVersion: s.header.replayVersion };
    if (terminal !== null && terminal.kind === "victory") {
      // Game over: there is NO next turn — do NOT broadcast turnRollover (game.phase.order is the final round's order).
      // status() victory shape (src/engine/status.ts): { kind:"victory"; players: PlayerId[]; reason:"iron"|"last-standing" }.
      // `players` is the winning coalition (EMPTY [] for an all-eliminated/no-winner board, DER-N7 / status.ts:116).
      broadcast.push({ type: "gameOver", winners: terminal.players, cause: terminal.reason });
    } else {
      broadcast.push({ type: "turnRollover", order: game.phase.order, ironWeights: null }); // ironWeights filled in A6
    }
  }
  const next: SessionState = { ...s, game, logLength };
  const effects: Effects = { ...NO_EFFECTS, persist: { put }, broadcast };
  return { next, effects, advanced, terminal };
}
