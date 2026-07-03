// ABOUTME: The single client import point for engine/session symbols — re-exports the
// ABOUTME: agent-free engine barrel plus agent-free session pieces from their deep modules.
//
// MUST NEVER import "../../../src/session/index" — it re-exports recordGame, which
// value-imports src/agent. A client bundle importing src/agent is a bundle-purity
// regression caught by the build-time guard (web/scripts/check-bundle.ts).

export {
  initGame,
  setupGame,
  placeFirstBase,
  legalFirstBaseHexes,
  applyAction,
  stepRound,
  legalActions,
  representativeDefender,
  representativeFirstBase,
  currentPlayer,
  advanceRound,
  buildBudget,
  status,
  applyEliminations,
  removeEncircledStrandedBases,
  control,
  generateBoard,
  loadBoard,
  seed,
  nextUint32,
  nextFloat,
  encodeRng,
  decodeRng,
  defaultConfig,
} from "../../../src/index";
export type {
  RuleConfig,
  KillBounty,
  Hex,
  PlayerId,
  PieceKind,
  BaseState,
  Base,
  Factory,
  Board,
  BoardDefinition,
  BoardSource,
  Player,
  Phase,
  GameState,
  Action,
  AttackDecl,
  GameEvent,
  EliminationCause,
  RngState,
  EncodedRng,
} from "../../../src/index";

export { applyEntry } from "../../../src/session/round";
export { replayLog } from "../../../src/session/replay";
export { stateHash } from "../../../src/session/hash";
export { encodeEntry, decodeEntry, encodeRecord, decodeRecord } from "../../../src/session/codec";
export { validatePass, validateTargetAttackable, validateAttackDecl, validateBuildPieces } from "../../../src/session/validation";
export type { SessionError } from "../../../src/session/validation";
export type {
  SessionRecord,
  EncodedLogEntry,
  LogEntry,
  LogEntryKind,
  SessionHeader,
  SeatConfig,
  Piece,
} from "../../../src/session/types";
export type { ApplyEntryResult } from "../../../src/session/round";
