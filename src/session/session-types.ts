// ABOUTME: Shared types for the interactive GameSession reducer (state, pending, seats, effects).
// ABOUTME: Types only — the single import home that keeps the reducer modules free of import cycles.
import type { GameState, PlayerId, AttackDecl, RngState } from "../engine/types";
import type { SessionHeader, SeatConfig } from "./types";
import type { RoomOptions, ServerMessage } from "../wire/protocol";

/** A durable pending defender decision (spec §3 "Pending decisions"). Storage-only fields never hit the wire. */
export type Pending = {
  decisionId: string;
  kind: "defenderChoice";
  round: number;                 // state.game.phase.turn at open
  declaringPlayer: PlayerId;     // the attacker
  promptedSeat: number;          // the defending seat (== defender-owner PlayerId)
  proposed: AttackDecl;          // target + proposed attackers; the defender field is replaced on resolution
  preDecisionLogLength: number;  // log length when the decision opened (crash-recovery contract)
  rngBeforeApply: RngState;      // RNG to install when the resolved attack entry is applied
  deadlineEpochMs: number | null;// null when the room's defender timeout is OFF
};

/** Per-seat runtime auth state. In Phase 1 each seat's token is minted at room creation and its digest bound
 *  here; a seat token admits many concurrent sockets (multi-tab). Cross-device claiming of UNBOUND seats and the
 *  one-winner CAS are Phase 2 (the `SEAT_TAKEN` path). */
export type SeatRuntime = {
  seat: number;
  config: SeatConfig;
  authorizedDigest: string | null;  // SHA-256 digest of the seat's minted token (set at room init); null pre-init
  claimed: boolean;                 // a socket has presented the matching token (Phase 1 = authenticate, not own)
  lastRequestId: string | null;     // idempotency: a re-claim with the same requestId returns the same result
};

export type SessionState = {
  header: SessionHeader;
  roomOptions: RoomOptions;
  game: GameState;
  logLength: number;
  pending: Pending | null;
  seats: SeatRuntime[];
  // Set to the attacker when a human attack leaves the round OPEN (chain continues); cleared on any round
  // close. `endRound` is legal ONLY for `chainAttacker === actingSeat` — guards against a human sending
  // `endRound` at round start to illegally skip their turn (voluntary pass is illegal, DER #5). Maintained in A4.
  chainAttacker: PlayerId | null;
};

/** Injected per-command context — all reducer non-determinism (time, ids) comes through here, so the reducer
 *  stays pure/deterministic. The HOST populates every field on every call (handlers read only what they need).
 *  NO token/digest here: socket→seat authentication happens at the WS UPGRADE (B2.2/B6.2), not via a command. */
export type CommandCtx = {
  actingSeat: number;   // the authenticated seat the socket is bound to (from serializeAttachment)
  nowEpochMs: number;   // injected current time (reducer is pure — no Date.now()); used for pending deadlines
  decisionId: string;   // host-pre-generated (crypto.getRandomValues) id for any pending this command opens
};

// One atomic multi-key storage.put. Clear a pending decision by writing PENDING_KEY = PENDING_TOMBSTONE
// in this SAME put (no separate delete) — atomic by construction, matches spec §3's "single multi-key put".
export type PersistOp = { put: Record<string, unknown> };
/** Tombstone written to PENDING_KEY to clear a decision atomically with the resolving entry. */
export const PENDING_TOMBSTONE = { cleared: true } as const;
export type AlarmIntent = { action: "set"; atEpochMs: number } | { action: "clear" };
export type Effects = {
  persist: PersistOp | null;
  broadcast: ServerMessage[];
  reply: ServerMessage[];
  toSeat: { seat: number; message: ServerMessage }[];
  alarm: AlarmIntent | null;
};
export const NO_EFFECTS: Effects = { persist: null, broadcast: [], reply: [], toSeat: [], alarm: null };
