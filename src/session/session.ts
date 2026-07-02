// ABOUTME: The interactive GameSession reducer core — openSession, applyCommand (A3), resyncPayload (A6).
// ABOUTME: Pure: every state-changing call returns { next, effects }; the host performs the effects.
import { initGame } from "../engine/init";
import { currentActor } from "./agent-drive";
import { status } from "../engine/status";
import { encodeState } from "../wire/codec";
import type { SessionHeader } from "./types";
import { PROTOCOL_VERSION, type ClientCommand, type RoomOptions, type ServerMessage, type WireErrorCode } from "../wire/protocol";
import { NO_EFFECTS, type CommandCtx, type Effects, type SessionState } from "./session-types";

export function openSession(header: SessionHeader, roomOptions: RoomOptions): SessionState {
  const game = initGame({
    seed: header.seed, boardSource: header.boardSource,
    nPlayers: header.seats.length, config: header.config,
  });
  return {
    header, roomOptions, game, logLength: 0, pending: null, chainAttacker: null,
    seats: header.seats.map((config, seat) => ({ seat, config, authorizedDigest: null, claimed: false, lastRequestId: null })),
  };
}

// Mutating = appends a log entry / changes authoritative state. resolveDecision is mutating (it applies the
// attack); extendDecision is NOT (it only re-arms the alarm), so it is exempt from the envelope guards and the
// write-lock. hello/claimSeat/resync are also non-mutating.
const MUTATING_TYPES: ReadonlySet<ClientCommand["type"]> = new Set(["placeFirstBase","build","attack","endRound","pass","resolveDecision"]);
function isMutating(c: ClientCommand): boolean { return MUTATING_TYPES.has(c.type); }
function errorMessage(code: WireErrorCode, message: string, currentLogIndex: number | null = null): ServerMessage {
  return { type: "error", code, message, currentLogIndex };
}
function errorEffects(s: SessionState, code: WireErrorCode, message: string): Effects {
  return { ...NO_EFFECTS, reply: [errorMessage(code, message, s.logLength)] };
}
function resyncEffects(s: SessionState, requestingSeat: number, reason: string): Effects {
  return { ...NO_EFFECTS, reply: [resyncPayload(s, requestingSeat, reason)] };
}

export function applyCommand(s: SessionState, c: ClientCommand, ctx: CommandCtx): { next: SessionState; effects: Effects } {
  const keep = (effects: Effects) => ({ next: s, effects });   // rejected/no-op commands leave state unchanged
  if (isMutating(c)) {
    if (status(s.game).kind === "victory") return keep(errorEffects(s, "GAME_OVER", "The game is over."));
    if (s.pending !== null /* && not the matching answer — carve-out added in A4.3 */) return keep(errorEffects(s, "DECISION_PENDING", "A decision is pending."));
    if ("expectedLogIndex" in c && c.expectedLogIndex !== s.logLength) return keep(resyncEffects(s, ctx.actingSeat, "STALE_INDEX"));
    if (ctx.actingSeat !== currentActor(s)) return keep(errorEffects(s, "NOT_YOUR_TURN", "It is not your turn."));
  }
  switch (c.type) { /* placeFirstBase / build / pass — Tasks A3.2-A3.3; attack/resolve/extend — A4 */ default: return keep(errorEffects(s, "UNKNOWN_TYPE", `Unknown command ${(c as { type?: string }).type}`)); }
}

/** Full-state resync payload (spec §3). A3 introduces the LOCKED SIGNATURE; A6 fills the seat-filtered pending
 *  projection. The roster is built inline here — Phase A5 owns any exported seatRoster helper. */
export function resyncPayload(s: SessionState, requestingSeat: number, reason: string | null): ServerMessage {
  return {
    type: "resync",
    snapshot: encodeState(s.game),
    logLength: s.logLength,
    pending: null, // A3 creates no pending; A6 adds the seat-filtered projection
    seats: s.seats.map((seatRuntime) => ({ seat: seatRuntime.seat, claimed: seatRuntime.claimed, kind: seatRuntime.config.kind })),
    protocolVersion: PROTOCOL_VERSION,
    replayVersion: s.header.replayVersion,
    reason,
  };
}
