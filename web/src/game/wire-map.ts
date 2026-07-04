// ABOUTME: The typed seam between the client's driver domain (DriverCommand/DriverEvent/DriverPending)
// ABOUTME: and the wire protocol — including the authoritative total WireErrorCode → DriverErrorCode map.
//
// DYNAMIC-IMPORT CONTRACT. This module value-imports the wire codecs (src/wire/codec) and the session
// entry decoder (src/session/codec via the client barrel). Those pull real src/ value modules into the
// bundle, so wire-map MUST be reached ONLY via dynamic import — from the lazy LocalReducerDriver and the
// SocketDriver, and from tests — NEVER from an eagerly-loaded module. The build-time guard
// (web/scripts/check-bundle.ts) fails the build if any src/wire module lands in an eager chunk.
import { decodeState } from "../../../src/wire/codec";
import { decodeEntry } from "../engine-client/barrel";
import type { ClientCommand, EncodedPending, ServerMessage, WireErrorCode } from "../../../src/wire/protocol";
import type { DriverCommand, DriverErrorCode, DriverEvent, DriverPending } from "./driver";

/**
 * The authoritative total `WireErrorCode → DriverErrorCode` map. Every wire code maps to its
 * same-named client code — the client owns a vocabulary one-to-one with the wire catalog. Keyed as an
 * exhaustive `Record` over the wire union so a new wire code fails typecheck HERE until it is added to
 * `DriverErrorCode` (web/src/game/driver.ts). `rejected` carries both `code` (for programmatic
 * branching + explainError's one-liner) and the reducer's OWN `message` verbatim, so the honest rule
 * text always reaches the UI regardless of the code.
 */
export const WIRE_TO_DRIVER_ERROR: Record<WireErrorCode, DriverErrorCode> = {
  STALE_INDEX: "STALE_INDEX",
  DECISION_PENDING: "DECISION_PENDING",
  ALREADY_RESOLVED: "ALREADY_RESOLVED",
  NOT_YOUR_TURN: "NOT_YOUR_TURN",
  SEAT_TAKEN: "SEAT_TAKEN",
  BAD_SEAT_TOKEN: "BAD_SEAT_TOKEN",
  MALFORMED: "MALFORMED",
  UNKNOWN_TYPE: "UNKNOWN_TYPE",
  OVERSIZED: "OVERSIZED",
  VERSION_MISMATCH: "VERSION_MISMATCH",
  ROOM_NOT_INITIALIZED: "ROOM_NOT_INITIALIZED",
  GAME_OVER: "GAME_OVER",
  FROZEN: "FROZEN",
  NOT_IN_SETUP: "NOT_IN_SETUP",
  HEX_OFF_BOARD: "HEX_OFF_BOARD",
  HEX_NOT_OUTER: "HEX_NOT_OUTER",
  HEX_OCCUPIED: "HEX_OCCUPIED",
  INVALID_ATTACKERS: "INVALID_ATTACKERS",
  SETUP_PLACEMENT_REQUIRED: "SETUP_PLACEMENT_REQUIRED",
  PASS_NOT_FORCED: "PASS_NOT_FORCED",
  ATTACK_NOT_SINGLE_DECL: "ATTACK_NOT_SINGLE_DECL",
  DUP_ATTACKERS: "DUP_ATTACKERS",
  DEFENDER_IS_TARGET: "DEFENDER_IS_TARGET",
  DEFENDER_INELIGIBLE: "DEFENDER_INELIGIBLE",
  NO_ELIGIBLE_DEFENDER: "NO_ELIGIBLE_DEFENDER",
  MIXED_PIECE_TYPES: "MIXED_PIECE_TYPES",
  DUP_PIECES: "DUP_PIECES",
  BUILD_EMPTY: "BUILD_EMPTY",
  BUILD_BOOTSTRAP_FACTORY_ONLY: "BUILD_BOOTSTRAP_FACTORY_ONLY",
  BUILD_OVER_BUDGET: "BUILD_OVER_BUDGET",
  BUILD_ILLEGAL_FACTORY: "BUILD_ILLEGAL_FACTORY",
  BUILD_NO_BASES_IN_HAND: "BUILD_NO_BASES_IN_HAND",
  BUILD_ILLEGAL_BASE: "BUILD_ILLEGAL_BASE",
};

/** Project the wire `EncodedPending` to the domain-shaped `DriverPending` (drops `kind`; fields otherwise align). */
export function toDriverPending(p: EncodedPending): DriverPending {
  return {
    decisionId: p.decisionId,
    round: p.round,
    declaringPlayer: p.declaringPlayer,
    promptedSeat: p.promptedSeat,
    target: p.target,
    eligibleDefenders: p.eligibleDefenders,
    deadlineEpochMs: p.deadlineEpochMs,
  };
}

/**
 * Map a `DriverCommand` to the wire `ClientCommand`, stamping `expectedLogIndex = logLength` on the six
 * mutating commands and carrying `decisionId` on resolve/extend. `extendDecision` intentionally carries
 * NO `expectedLogIndex` (the wire contract omits it — an extend is a keep-alive, not a log mutation).
 * The transport-only commands (hello/claimSeat/resync) are NOT DriverCommands — a driver constructs
 * those itself, so this never invents transport fields.
 */
export function toClientCommand(cmd: DriverCommand, logLength: number): ClientCommand {
  switch (cmd.type) {
    case "placeFirstBase":
      return { type: "placeFirstBase", expectedLogIndex: logLength, hex: cmd.hex };
    case "build":
      return { type: "build", expectedLogIndex: logLength, pieces: cmd.pieces };
    case "attack":
      return { type: "attack", expectedLogIndex: logLength, decl: cmd.decl };
    case "endRound":
      return { type: "endRound", expectedLogIndex: logLength };
    case "pass":
      return { type: "pass", expectedLogIndex: logLength };
    case "resolveDecision":
      return { type: "resolveDecision", expectedLogIndex: logLength, decisionId: cmd.decisionId, defender: cmd.defender };
    case "extendDecision":
      return { type: "extendDecision", decisionId: cmd.decisionId };
  }
}

/**
 * Map one `ServerMessage` to a `DriverEvent`, or `null` to drop it (only `seatClaimed`, which has no
 * driver counterpart — the client already holds its seat token; the confirmation is inert to the UI).
 * `resync` becomes a `sync`: the snapshot is decoded (rngState bigints restored), the pending projected,
 * and `logLength` + `seats` carried; `reason` (diagnostic) and `protocolVersion`/`replayVersion` (a
 * driver's own build constants) are intentionally dropped.
 */
export function toDriverEvent(msg: ServerMessage): DriverEvent | null {
  switch (msg.type) {
    case "applied":
      return { type: "applied", entry: decodeEntry(msg.entry), events: msg.events, logIndex: msg.logIndex };
    case "turnRollover":
      return { type: "turnRollover", order: msg.order, ironWeights: msg.ironWeights };
    case "gameOver":
      return { type: "gameOver", winners: msg.winners, cause: msg.cause };
    case "prompt":
      return { type: "prompt", pending: toDriverPending(msg.pending) };
    case "error":
      return { type: "rejected", code: WIRE_TO_DRIVER_ERROR[msg.code], message: msg.message, currentLogIndex: msg.currentLogIndex };
    case "resync":
      return {
        type: "sync",
        snapshot: decodeState(msg.snapshot),
        logLength: msg.logLength,
        pending: msg.pending === null ? null : toDriverPending(msg.pending),
        seats: msg.seats,
      };
    case "reload":
      return { type: "connection", status: "reload-required" };
    case "seatClaimed":
      return null;
  }
}
