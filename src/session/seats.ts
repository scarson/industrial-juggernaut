// ABOUTME: claimSeat — the seat-claim roster ack (spec §3, plan Phase A5). Pure; no token/digest handling.
// ABOUTME: The socket authenticates at the WS upgrade (Part B); claimSeat only records the roster ack. seatRoster projects SessionState.seats to the wire roster shape.
import { NO_EFFECTS, type CommandCtx, type Effects, type SessionState } from "./session-types";
import type { ServerMessage, SeatRosterEntry, WireErrorCode } from "../wire/protocol";

/** Builds the identical `{ type: "error", ... }` reply shape session.ts's errorEffects constructs — duplicated
 *  locally rather than imported to avoid a session.ts <-> seats.ts import cycle (session.ts imports seats.ts to
 *  wire the claimSeat case into its switch). */
function errorReply(s: SessionState, code: WireErrorCode, message: string): ServerMessage {
  return { type: "error", code, message, currentLogIndex: s.logLength };
}

/**
 * `claimSeat` — a lightweight roster ack, NOT an authentication step (spec §3, plan Phase A5 "Auth model").
 * By the time this command reaches the reducer, `ctx.actingSeat` is already the authenticated seat (bound at
 * the WS upgrade, Part B); the reducer never sees a token or digest. Non-mutating: no log entry, no
 * `expectedLogIndex`, exempt from the A3.1 envelope guards — legal even while a decision is pending.
 *
 * Order: the bounds check runs BEFORE the own-seat check. `seat` arrives off the wire as a bare number with no
 * prior validation; dereferencing `s.seats[seat]` before confirming it exists would crash on malformed input
 * (e.g. `seat: 99` on a 2-seat room). Checking bounds first keeps the own-seat comparison's `s.seats[seat]`
 * access below always safe, and produces a clear MALFORMED reply instead of an uncaught TypeError.
 *
 * `effects.persist` is ALWAYS null: `claimed`/`lastRequestId` are ephemeral roster state (session-types.ts
 * SeatRuntime), not persisted — the durable auth fact is `authorizedDigest` in the header bundle (Part B).
 *
 * On the `claimed` false→true TRANSITION the `seatClaimed` message is ALSO broadcast: the protocol has no
 * periodic refresh cycle (resyncs fire only on connect, STALE_INDEX, or an explicit request), so without the
 * broadcast an idle lobby client would never see a seat fill. Re-acks (same requestId) and multi-tab acks on
 * an already-claimed seat do NOT re-broadcast — the broadcast is gated on the transition, not on success.
 * The reply carries the same message either way. No toSeat, no alarm.
 */
export function claimSeat(
  s: SessionState,
  c: { seat: number; requestId: string },
  ctx: CommandCtx,
): { next: SessionState; effects: Effects } {
  const seatRuntime = s.seats[c.seat];
  if (seatRuntime === undefined) {
    return { next: s, effects: { ...NO_EFFECTS, reply: [errorReply(s, "MALFORMED", `No seat ${c.seat} in this room.`)] } };
  }
  if (ctx.actingSeat !== c.seat) {
    return { next: s, effects: { ...NO_EFFECTS, reply: [errorReply(s, "NOT_YOUR_TURN", "A socket may only claim the seat it authenticated as.")] } };
  }
  const reply: ServerMessage = { type: "seatClaimed", seat: c.seat, requestId: c.requestId };
  if (seatRuntime.lastRequestId === c.requestId) {
    return { next: s, effects: { ...NO_EFFECTS, reply: [reply] } }; // idempotent re-ack — no state change
  }
  const seats = s.seats.map((sr, i) => (i === c.seat ? { ...sr, claimed: true, lastRequestId: c.requestId } : sr));
  const next: SessionState = { ...s, seats };
  // Broadcast ONLY on the claim transition (false→true): an already-claimed seat re-acking (multi-tab) is
  // roster-invisible to other clients, so re-broadcasting would be noise.
  const broadcast = seatRuntime.claimed ? [] : [reply];
  return { next, effects: { ...NO_EFFECTS, reply: [reply], broadcast } };
}

/** Projects `SessionState.seats` (the runtime roster, including auth internals like `authorizedDigest`) to the
 *  wire's `SeatRosterEntry[]` — seat index, claimed flag, and seat kind only. Used by `resyncPayload` (session.ts)
 *  and any future roster-bearing message; kept here as the single source of truth for the projection. */
export function seatRoster(s: SessionState): SeatRosterEntry[] {
  return s.seats.map((seatRuntime) => ({ seat: seatRuntime.seat, claimed: seatRuntime.claimed, kind: seatRuntime.config.kind }));
}
