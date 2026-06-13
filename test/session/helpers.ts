// ABOUTME: Shared session-test fixtures — an all-agent (greedy) header builder over the seed-1n board.
// ABOUTME: Reused by codec/record/replay/validation tests so the header is spelled once.
import type { SeatConfig, SessionHeader } from "../../src/session/types";
import { defaultConfig } from "../../src/engine/config";

function headerWith(seats: SeatConfig[], seed: bigint): SessionHeader {
  return {
    formatVersion: 1,
    replayVersion: "test",
    seed,
    config: defaultConfig(),
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    seats,
  };
}

/** An N-seat all-greedy header on the deterministic seed-1n generated board. */
export function greedyHeader(nPlayers: number, opts?: { seed?: bigint }): SessionHeader {
  return headerWith(
    Array.from({ length: nPlayers }, () => ({ kind: "agent" as const, agent: "greedy" as const, archetype: "economic" as const })),
    opts?.seed ?? 1n,
  );
}

/** An N-seat all-HEURISTIC header — exercises the variable-draw policy RNG path. */
export function heuristicHeader(nPlayers: number, opts?: { seed?: bigint }): SessionHeader {
  return headerWith(
    Array.from({ length: nPlayers }, () => ({ kind: "agent" as const, agent: "heuristic" as const })),
    opts?.seed ?? 1n,
  );
}
