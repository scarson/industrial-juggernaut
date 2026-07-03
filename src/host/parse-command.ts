// ABOUTME: Full SHAPE validation of an untrusted wire message into a ClientCommand — every variant's required
// ABOUTME: fields present and correctly typed. NOT game-legality (that is applyCommand's job); this stops DoS-by-shape.

import type { Hex, PieceKind } from "../engine/types";
import type { Piece } from "../session/types";
import type { ClientCommand } from "../wire/protocol";

/** Every valid ClientCommand `type`. A parsed message whose `type` is outside this set is UNKNOWN_TYPE; a message
 *  with a known type but a broken field shape is MALFORMED. Exhaustive against the wire `ClientCommand` union. */
const KNOWN_COMMANDS: ReadonlySet<ClientCommand["type"]> = new Set([
  "hello",
  "claimSeat",
  "placeFirstBase",
  "build",
  "attack",
  "endRound",
  "pass",
  "resolveDecision",
  "extendDecision",
  "resync",
]);

/** True when `type` names a real ClientCommand kind — lets the host tell UNKNOWN_TYPE apart from a shape-MALFORMED
 *  known command (`parseClientCommand` returns null for both, so the caller checks this to pick the error code). */
export function isKnownCommandType(type: unknown): type is ClientCommand["type"] {
  return KNOWN_COMMANDS.has(type as ClientCommand["type"]);
}

/**
 * Parse an untrusted, already-JSON-decoded value into a ClientCommand, or null if its SHAPE is invalid. This is the
 * primary defense (Layer 1) for the socket-auth boundary: a valid-seat client can send any JSON, and the reducer
 * (`applyCommand`) dereferences fields like `decl.target.x` / `pieces.map(...)` without null/array guards — a
 * well-typed-`type` but shape-malformed payload (`{type:"attack",decl:null}`, `{type:"build",pieces:"x"}`, ...) would
 * throw uncaught out of the reducer, crashing the room AND bypassing the malformed-abuse budget. Rejecting shape here
 * routes those to the same MALFORMED + count-limit path as invalid JSON. This checks SHAPE ONLY — whether a hex is on
 * the board, whether attackers are fresh, etc. remain the reducer's to reject with teachable codes.
 */
export function parseClientCommand(value: unknown): ClientCommand | null {
  if (!isObject(value)) return null;
  const type = (value as { type?: unknown }).type;
  switch (type) {
    case "hello":
      return isNumber(value.protocolVersion) && isString(value.replayVersion) ? (value as ClientCommand) : null;
    case "claimSeat":
      return isString(value.requestId) && isNumber(value.seat) ? (value as ClientCommand) : null;
    case "placeFirstBase":
      return isNumber(value.expectedLogIndex) && isHex(value.hex) ? (value as ClientCommand) : null;
    case "build":
      return isNumber(value.expectedLogIndex) && isPieceArray(value.pieces) ? (value as ClientCommand) : null;
    case "attack":
      return isNumber(value.expectedLogIndex) && isAttackDecl(value.decl) ? (value as ClientCommand) : null;
    case "endRound":
      return isNumber(value.expectedLogIndex) ? (value as ClientCommand) : null;
    case "pass":
      return isNumber(value.expectedLogIndex) ? (value as ClientCommand) : null;
    case "resolveDecision":
      return isNumber(value.expectedLogIndex) && isString(value.decisionId) && isHex(value.defender)
        ? (value as ClientCommand)
        : null;
    case "extendDecision":
      return isString(value.decisionId) ? (value as ClientCommand) : null;
    case "resync":
      return value as ClientCommand; // no fields beyond `type`
    default:
      return null; // unknown / missing type
  }
}

/** A non-null object (arrays included — callers that need a plain object check fields explicitly). */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

/** A Hex is a non-null object whose x/y/z are all finite numbers (the reducer keys/derefs these). */
function isHex(v: unknown): v is Hex {
  return isObject(v) && isNumber(v.x) && isNumber(v.y) && isNumber(v.z);
}

const PIECE_KINDS: ReadonlySet<PieceKind> = new Set<PieceKind>(["factory", "base"]);

/** A Piece is { type: a valid PieceKind, hex: a valid Hex }. */
function isPiece(v: unknown): v is Piece {
  return isObject(v) && PIECE_KINDS.has(v.type as PieceKind) && isHex(v.hex);
}

/** An array (possibly empty — BUILD_EMPTY is the reducer's to reject) of valid Pieces. */
function isPieceArray(v: unknown): v is Piece[] {
  return Array.isArray(v) && v.every(isPiece);
}

/** An AttackDecl is { target: Hex, attackers: Hex[], defender: Hex }. Attacker COUNT is the reducer's rule. */
function isAttackDecl(v: unknown): boolean {
  return (
    isObject(v) &&
    isHex(v.target) &&
    Array.isArray(v.attackers) &&
    v.attackers.every(isHex) &&
    isHex(v.defender)
  );
}
