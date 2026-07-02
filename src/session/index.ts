// ABOUTME: Public session barrel — record/replay/codec/hash/validation surface for the DO host + all-agent viewer.
// ABOUTME: Distinct from the engine barrel src/index.ts (which stays agent-free); recordGame pulls in src/agent.
export { recordGame } from "./record";
export { replayLog } from "./replay";
export { applyEntry } from "./round";
export { stateHash } from "./hash";
export { encodeRecord, decodeRecord, encodeEntry, decodeEntry } from "./codec";
export { validatePass, validateTargetAttackable, validateAttackDecl, validateBuildPieces } from "./validation";
export type { SessionError } from "./validation";
export type { SessionRecord, EncodedLogEntry, LogEntry, SessionHeader, SeatConfig, Piece, LogEntryKind } from "./types";
export type { RecordResult } from "./record";
export type { ApplyEntryResult } from "./round";
export { openSession } from "./session";
export { applyCommand, resyncPayload } from "./session";
export { resolveDefender } from "./pending";
export { needsDrive, driveOneStep } from "./agent-drive";
export { agentForSeat } from "./agent-binding";
export { claimSeat, seatRoster } from "./seats";
export { malformedError, unknownTypeError, oversizedError } from "./errors";
export * from "./keys";
export type { SessionState, Pending, SeatRuntime, Effects, PersistOp, AlarmIntent, CommandCtx, Snapshot } from "./session-types";
export { PENDING_TOMBSTONE } from "./session-types";
