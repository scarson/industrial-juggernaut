// ABOUTME: JSON serializer/deserializer for GameState — handles bigint RngState (PCG-XSH-RR state) via a typed marker object.
// ABOUTME: Pure, deterministic, round-trips state losslessly. Used by the CLI for file-based state persistence.

import type { GameState } from "../engine/types";

/** Replace bigints with `{ __bigint: "<digits>" }` markers so JSON.stringify accepts them. */
export function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? { __bigint: (value as bigint).toString() } : value;
}

/** Reviver that turns the `{ __bigint }` markers back into bigints. Called bottom-up by JSON.parse. */
export function bigintReviver(_key: string, value: unknown): unknown {
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "__bigint" in value &&
    typeof (value as { __bigint: unknown }).__bigint === "string"
  ) {
    return BigInt((value as { __bigint: string }).__bigint);
  }
  return value;
}

/** Serialize a GameState to a JSON string (deterministic, indented for readability). */
export function serializeState(state: GameState): string {
  return JSON.stringify(state, bigintReplacer, 2);
}

/** Deserialize a JSON string back into a GameState. Throws on malformed input. */
export function deserializeState(json: string): GameState {
  return JSON.parse(json, bigintReviver) as GameState;
}
