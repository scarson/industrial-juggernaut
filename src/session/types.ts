// ABOUTME: Wire-format types for the session log — SessionRecord, the closed LogEntry union, SeatConfig (spec §3).
// ABOUTME: SessionRecord is the JSON interchange shape (seed + rngBeforeApply are decimal strings in the encoded form).

import type { Archetype } from "../agent/archetypes";
import type { RuleConfig } from "../engine/config"; // RuleConfig lives in config, NOT re-exported by engine/types
import type {
  AttackDecl, BoardSource, Hex, PieceKind, PlayerId, RngState,
} from "../engine/types";

/** A single build piece (mirrors the engine's build-action piece shape). */
export type Piece = { type: PieceKind; hex: Hex };

/** How a seat is driven. Humans submit commands; agents auto-play. */
export type SeatConfig =
  | { kind: "human" }
  | { kind: "agent"; agent: "greedy"; archetype: Archetype }
  | { kind: "agent"; agent: "heuristic" };

/**
 * The closed v1 log union. `rngBeforeApply` is the RngState to install BEFORE
 * applying this entry's rules (post-agent-selection / naturally-threaded for
 * humans). `allianceOp` is intentionally absent — it lands with the Phase 3
 * alliance design as a formatVersion bump (spec §3, the union is closed per
 * version).
 */
export type LogEntry =
  | { player: PlayerId; kind: "placeFirstBase"; hex: Hex; rngBeforeApply: RngState }
  | { player: PlayerId; kind: "build"; pieces: Piece[]; rngBeforeApply: RngState }
  | { player: PlayerId; kind: "attack"; decl: AttackDecl; rngBeforeApply: RngState }
  | { player: PlayerId; kind: "endRound"; rngBeforeApply: RngState }
  | { player: PlayerId; kind: "pass"; rngBeforeApply: RngState }
  | { player: PlayerId; kind: "roundSkipped"; rngBeforeApply: RngState };

export type LogEntryKind = LogEntry["kind"];

/**
 * The save-export / replay-download / wire-snapshot shape (spec §3). The
 * canonical pre-authorized artifact named in §6 — this exact field list. `seed`
 * and each entry's `rngBeforeApply` are decimal strings in the ENCODED form (see
 * `codec.ts`); this in-memory shape keeps `seed` as a decimal string too, so the
 * record round-trips through JSON without a separate encoded type for the header.
 */
export type SessionRecord = {
  formatVersion: number;
  replayVersion: string;
  seed: string; // bigint → decimal string (codec)
  config: RuleConfig;
  boardSource: BoardSource;
  seats: SeatConfig[];
  log: EncodedLogEntry[];
};

/** A LogEntry with its bigint rngBeforeApply encoded to decimal strings (JSON-safe). */
export type EncodedLogEntry =
  | { player: PlayerId; kind: "placeFirstBase"; hex: Hex; rngBeforeApply: import("../rng/codec").EncodedRng }
  | { player: PlayerId; kind: "build"; pieces: Piece[]; rngBeforeApply: import("../rng/codec").EncodedRng }
  | { player: PlayerId; kind: "attack"; decl: AttackDecl; rngBeforeApply: import("../rng/codec").EncodedRng }
  | { player: PlayerId; kind: "endRound"; rngBeforeApply: import("../rng/codec").EncodedRng }
  | { player: PlayerId; kind: "pass"; rngBeforeApply: import("../rng/codec").EncodedRng }
  | { player: PlayerId; kind: "roundSkipped"; rngBeforeApply: import("../rng/codec").EncodedRng };

/** The decoded header (everything in a SessionRecord except the log), with seed as bigint. */
export type SessionHeader = {
  formatVersion: number;
  replayVersion: string;
  seed: bigint;
  config: RuleConfig;
  boardSource: BoardSource;
  seats: SeatConfig[];
};
