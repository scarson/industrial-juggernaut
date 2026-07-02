// ABOUTME: Canonical transport-layer error constructors (MALFORMED / UNKNOWN_TYPE / OVERSIZED) for the DO host.
// ABOUTME: Shapes only — enforcement (count-limit-before-close, the size cap) is the host's job (spec §3 / B6).
import type { ServerMessage } from "../wire/protocol";

export function malformedError(detail: string, currentLogIndex: number | null = null): ServerMessage {
  return { type: "error", code: "MALFORMED", message: `Malformed message: ${detail}`, currentLogIndex };
}

export function unknownTypeError(type: string, currentLogIndex: number | null = null): ServerMessage {
  return { type: "error", code: "UNKNOWN_TYPE", message: `Unknown command type: ${type}`, currentLogIndex };
}

export function oversizedError(byteLength: number, maxBytes: number, currentLogIndex: number | null = null): ServerMessage {
  return {
    type: "error",
    code: "OVERSIZED",
    message: `Message of ${byteLength} bytes exceeds the ${maxBytes}-byte limit.`,
    currentLogIndex,
  };
}
