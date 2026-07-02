// ABOUTME: The Industrial Juggernaut wire protocol — client commands, server messages, error codes.
// ABOUTME: Pure types shared by the DO host (src/host) and the SPA client; no value imports (spec §3).

import type { Hex, PlayerId, AttackDecl, GameEvent, GameState } from "../engine/types";
import type { EncodedRng } from "../rng/codec";
import type { Piece, SeatConfig, EncodedLogEntry } from "../session/types";

/** Bumped when the wire contract changes incompatibly (cached SPA vs redeployed DO). */
export const PROTOCOL_VERSION = 1;

/** Host-layer per-room options (NOT RuleConfig, NOT in SessionRecord). Spec §3 + Sam 2026-06-29. */
export type RoomOptions = {
  /** Defender-timeout liveness. OFF by default — see plan "Architectural decisions" #4. */
  defenderTimeout: { enabled: boolean; seconds: number };
};

export const DEFAULT_ROOM_OPTIONS: RoomOptions = {
  defenderTimeout: { enabled: false, seconds: 120 },
};

/** Client → server. Every *mutating* game command carries `expectedLogIndex`. */
export type ClientCommand =
  | { type: "hello"; protocolVersion: number; replayVersion: string }
  | { type: "claimSeat"; requestId: string; seat: number }  // roster ack; the socket already authenticated at the WS upgrade (no raw token here)
  | { type: "placeFirstBase"; expectedLogIndex: number; hex: Hex }
  | { type: "build"; expectedLogIndex: number; pieces: Piece[] }
  | { type: "attack"; expectedLogIndex: number; decl: AttackDecl }
  | { type: "endRound"; expectedLogIndex: number }
  | { type: "pass"; expectedLogIndex: number }
  | { type: "resolveDecision"; expectedLogIndex: number; decisionId: string; defender: Hex }
  | { type: "extendDecision"; decisionId: string }
  | { type: "resync" };

/** The JSON-safe materialized snapshot of engine state (rngState bigints → decimal strings). */
export type EncodedState = {
  game: Omit<GameState, "rngState">;  // everything but rngState is already JSON-safe (numbers/strings/arrays)
  rngState: EncodedRng;               // rngState bigints carried separately, encoded
};

/** The wire form of a pending defender decision (for prompt + resync). */
export type EncodedPending = {
  decisionId: string;
  kind: "defenderChoice";
  round: number;
  declaringPlayer: PlayerId;
  promptedSeat: number;
  target: Hex;                         // the base under attack (from the proposed decl)
  eligibleDefenders: Hex[];            // fresh, in-range, owned-by-prompted-seat (client renders choices)
  deadlineEpochMs: number | null;      // null when the room's defender timeout is OFF
};

export type SeatRosterEntry = { seat: number; claimed: boolean; kind: SeatConfig["kind"] };

/** Server → client. */
export type ServerMessage =
  | { type: "applied"; entry: EncodedLogEntry; events: GameEvent[]; logIndex: number }
  | { type: "turnRollover"; order: PlayerId[]; ironWeights: number[] | null }
  | { type: "gameOver"; winners: PlayerId[]; cause: string }  // winners: [] = no-winner termination
  | { type: "prompt"; pending: EncodedPending }
  | {
      type: "resync";
      snapshot: EncodedState;
      logLength: number;
      pending: EncodedPending | null;
      seats: SeatRosterEntry[];
      protocolVersion: number;
      replayVersion: string;
      reason: string | null;           // e.g. "STALE_INDEX" when a command was rejected
    }
  | { type: "seatClaimed"; seat: number; requestId: string }  // confirmation; the client already holds its token (POST /api/games)
  | { type: "error"; code: WireErrorCode; message: string; currentLogIndex: number | null }
  | { type: "reload" };                // version mismatch → client hard-reloads

export const WIRE_ERROR_CODES = [
  // envelope / transport
  "STALE_INDEX", "DECISION_PENDING", "ALREADY_RESOLVED", "NOT_YOUR_TURN",
  "SEAT_TAKEN", "BAD_SEAT_TOKEN", "MALFORMED", "UNKNOWN_TYPE", "OVERSIZED",
  "VERSION_MISMATCH", "ROOM_NOT_INITIALIZED", "GAME_OVER", "FROZEN",
  // setup placement (distinct codes feed the teaching surface — do NOT collapse to MALFORMED)
  "NOT_IN_SETUP", "HEX_OFF_BOARD", "HEX_NOT_OUTER", "HEX_OCCUPIED", "INVALID_ATTACKERS",
  // session validation (re-exported so the client maps codes → rule explanations)
  "PASS_NOT_FORCED", "ATTACK_NOT_SINGLE_DECL", "DUP_ATTACKERS",
  "DEFENDER_IS_TARGET", "DEFENDER_INELIGIBLE", "NO_ELIGIBLE_DEFENDER",
  "MIXED_PIECE_TYPES", "DUP_PIECES",
] as const;
export type WireErrorCode = (typeof WIRE_ERROR_CODES)[number];
