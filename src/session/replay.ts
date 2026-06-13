// ABOUTME: replayLog — reconstructs a recorded game purely from header + log via applyEntry (spec §3/§7).
// ABOUTME: Installs each entry's rngBeforeApply; collects a boundary stateHash whenever an entry closes a round.

import { initGame } from "../engine/init";
import { applyEntry } from "./round";
import { stateHash } from "./hash";
import type { GameState } from "../engine/types";
import type { LogEntry, SessionHeader } from "./types";

export function replayLog(header: SessionHeader, log: LogEntry[]): { state: GameState; boundaryHashes: string[] } {
  let state = initGame({ seed: header.seed, boardSource: header.boardSource, nPlayers: header.seats.length, config: header.config });
  const boundaryHashes: string[] = [];
  for (const entry of log) {
    const out = applyEntry(state, entry);
    state = out.state;
    if (out.advanced) boundaryHashes.push(stateHash(state));
  }
  return { state, boundaryHashes };
}
