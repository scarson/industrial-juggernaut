// ABOUTME: The GameDriver contract — client-owned command/event/pending types plus the driver
// ABOUTME: interface every UI component talks to, shaped against the wire protocol's semantics.
import type { Hex, PlayerId, AttackDecl, GameEvent, GameState } from "../engine-client/barrel";
import type { LogEntry, Piece, SeatConfig } from "../engine-client/barrel";

/** What the player asks the authoritative game to do. Transport fields
 *  (expectedLogIndex, seat tokens, hello/claimSeat/resync) are NOT here —
 *  the SocketDriver adds them when mapping to the wire ClientCommand. */
export type DriverCommand =
  | { type: "placeFirstBase"; hex: Hex }
  | { type: "build"; pieces: Piece[] }
  | { type: "attack"; decl: AttackDecl }
  | { type: "endRound" }
  | { type: "pass" }
  | { type: "resolveDecision"; decisionId: string; defender: Hex }
  | { type: "extendDecision"; decisionId: string };

/** The wire form of a pending defender decision, domain-shaped. */
export type DriverPending = {
  decisionId: string;
  round: number;
  declaringPlayer: PlayerId;
  promptedSeat: number;
  target: Hex;
  eligibleDefenders: Hex[];     // reducer/server-computed — the client renders, never derives
  deadlineEpochMs: number | null; // null when the room's defender timeout is OFF
};

export type SeatRosterEntry = { seat: number; claimed: boolean; kind: SeatConfig["kind"] };

/** Every code a rejected command can carry, one-to-one with the wire protocol's `WireErrorCode`
 *  catalog. Spelled out here (not aliased from the wire type) so the client owns its own vocabulary;
 *  the authoritative `WireErrorCode → DriverErrorCode` map in `wire-map.ts` is keyed over the wire
 *  union, so a new wire code fails typecheck there until it is added here. */
export type DriverErrorCode =
  // envelope/transport (socket only)
  | "STALE_INDEX" | "NOT_YOUR_TURN" | "DECISION_PENDING" | "ALREADY_RESOLVED"
  | "SEAT_TAKEN" | "BAD_SEAT_TOKEN" | "GAME_OVER" | "FROZEN"
  | "MALFORMED" | "UNKNOWN_TYPE" | "OVERSIZED" | "VERSION_MISMATCH" | "ROOM_NOT_INITIALIZED"
  // setup placement
  | "NOT_IN_SETUP" | "HEX_OFF_BOARD" | "HEX_NOT_OUTER" | "HEX_OCCUPIED" | "INVALID_ATTACKERS"
  | "SETUP_PLACEMENT_REQUIRED"
  // session validation (→ rule explanations)
  | "PASS_NOT_FORCED" | "ATTACK_NOT_SINGLE_DECL" | "DUP_ATTACKERS"
  | "DEFENDER_IS_TARGET" | "DEFENDER_INELIGIBLE" | "NO_ELIGIBLE_DEFENDER"
  | "MIXED_PIECE_TYPES" | "DUP_PIECES"
  // build rules (engine-enforced at apply time → rule explanations)
  | "BUILD_EMPTY" | "BUILD_BOOTSTRAP_FACTORY_ONLY" | "BUILD_OVER_BUDGET"
  | "BUILD_ILLEGAL_FACTORY" | "BUILD_NO_BASES_IN_HAND" | "BUILD_ILLEGAL_BASE";

/** The authoritative event stream. The driver emits `sync` first, then
 *  `applied`/`turnRollover`/`prompt`/`gameOver`/`rejected`/`connection`. */
export type DriverEvent =
  | { type: "sync"; snapshot: GameState; logLength: number; pending: DriverPending | null; seats: SeatRosterEntry[] }
  | { type: "applied"; entry: LogEntry; events: GameEvent[]; logIndex: number }
  | { type: "turnRollover"; order: PlayerId[]; ironWeights: number[] | null }
  | { type: "prompt"; pending: DriverPending }
  | { type: "gameOver"; winners: PlayerId[]; cause: string }   // winners:[] = no-winner termination
  | { type: "rejected"; code: DriverErrorCode; message: string; currentLogIndex: number | null }
  | { type: "connection"; status: ConnectionStatus };

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "closed" | "reload-required";

export interface GameDriver {
  /** Subscribe to the authoritative stream. The driver pushes a `sync` event
   *  to a new subscriber (or on requestSync). Returns an unsubscribe fn. */
  subscribe(handler: (e: DriverEvent) => void): () => void;
  /** Submit a command. Resolves when the driver has ACCEPTED it for processing
   *  (queued/sent) — NOT when applied. The authoritative result arrives as an
   *  `applied` or `rejected` event. The UI MUST NOT treat resolution as apply. */
  submit(cmd: DriverCommand): Promise<void>;
  /** Force a fresh `sync` (on mount, manual resync, post-reconnect). */
  requestSync(): void;
  /** Seats this client may act for. Local drivers: all human seats (hotseat
   *  shares the screen). SocketDriver: the claimed seat(s). The UI gates
   *  composers on `currentPlayer(state) ∈ controllableSeats()`. */
  controllableSeats(): number[];
  /** Tear down (close sockets / dispose reducer + worker). */
  dispose(): void;
}
