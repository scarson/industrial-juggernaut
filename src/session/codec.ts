// ABOUTME: SessionRecord/LogEntry codec — bigint seed + per-entry rngBeforeApply <-> JSON decimal strings.
// ABOUTME: All bigint conversion delegates to src/rng/codec (BigInt(), never Number()); spec §3.

import { encodeRng, decodeRng } from "../rng/codec";
import type { EncodedLogEntry, LogEntry, SessionHeader, SessionRecord } from "./types";

export function encodeEntry(e: LogEntry): EncodedLogEntry {
  const r = encodeRng(e.rngBeforeApply);
  switch (e.kind) {
    case "placeFirstBase": return { player: e.player, kind: e.kind, hex: e.hex, rngBeforeApply: r };
    case "build":          return { player: e.player, kind: e.kind, pieces: e.pieces, rngBeforeApply: r };
    case "attack":         return { player: e.player, kind: e.kind, decl: e.decl, rngBeforeApply: r };
    case "endRound":       return { player: e.player, kind: e.kind, rngBeforeApply: r };
    case "pass":           return { player: e.player, kind: e.kind, rngBeforeApply: r };
    case "roundSkipped":   return { player: e.player, kind: e.kind, rngBeforeApply: r };
  }
}

export function decodeEntry(e: EncodedLogEntry): LogEntry {
  const r = decodeRng(e.rngBeforeApply);
  switch (e.kind) {
    case "placeFirstBase": return { player: e.player, kind: e.kind, hex: e.hex, rngBeforeApply: r };
    case "build":          return { player: e.player, kind: e.kind, pieces: e.pieces, rngBeforeApply: r };
    case "attack":         return { player: e.player, kind: e.kind, decl: e.decl, rngBeforeApply: r };
    case "endRound":       return { player: e.player, kind: e.kind, rngBeforeApply: r };
    case "pass":           return { player: e.player, kind: e.kind, rngBeforeApply: r };
    case "roundSkipped":   return { player: e.player, kind: e.kind, rngBeforeApply: r };
  }
}

export function encodeRecord(header: SessionHeader, log: LogEntry[]): SessionRecord {
  return {
    formatVersion: header.formatVersion,
    replayVersion: header.replayVersion,
    seed: header.seed.toString(),
    config: header.config,
    boardSource: header.boardSource,
    seats: header.seats,
    log: log.map(encodeEntry),
  };
}

export function decodeRecord(rec: SessionRecord): { header: SessionHeader; log: LogEntry[] } {
  return {
    header: {
      formatVersion: rec.formatVersion,
      replayVersion: rec.replayVersion,
      seed: BigInt(rec.seed),
      config: rec.config,
      boardSource: rec.boardSource,
      seats: rec.seats,
    },
    log: rec.log.map(decodeEntry),
  };
}
