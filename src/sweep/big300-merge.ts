// ABOUTME: Shared serialization seam for the process-sharded big300 runner — the compact per-game line a shard emits,
// ABOUTME: and the pure reconstruction of an ordered GameEntry[] the parent feeds to computeMetrics. Behavior-preserving.

import type { GameEntry } from "./metrics";
import type { GameResult, VictoryType } from "../driver/record";

/**
 * One serialized JSONL line a shard emits per finished game. Carries exactly the
 * fields `computeMetrics` consumes (plus `gameIndex` for ordering and `elapsedMs`
 * for diagnostics). `ironOverTime` is intentionally OMITTED: `computeMetrics`
 * never reads it, so dropping it keeps capped-game lines small without changing
 * any metric — `toEntries` reconstructs it as `[]`.
 */
export interface ShardLine {
  gameIndex: number;
  nPlayers: number;
  setupDecided: boolean;
  turn1Leaders: number[];
  result: {
    winnerOrCoalition: number[];
    turns: number;
    victoryType: VictoryType;
    hitTurnCap: boolean;
  };
  elapsedMs: number;
}

/** Serialize a `GameEntry` (+ index/timing) to the compact shard line. */
export function toShardLine(gameIndex: number, entry: GameEntry, elapsedMs: number): ShardLine {
  return {
    gameIndex,
    nPlayers: entry.nPlayers,
    setupDecided: entry.setupDecided,
    turn1Leaders: entry.turn1Leaders,
    result: {
      winnerOrCoalition: entry.result.winnerOrCoalition,
      turns: entry.result.turns,
      victoryType: entry.result.victoryType,
      hitTurnCap: entry.result.hitTurnCap,
    },
    elapsedMs,
  };
}

/**
 * Reconstruct the ordered `GameEntry[]` from collected shard lines, sorted by
 * `gameIndex`. `result.ironOverTime` is `[]` (unused by `computeMetrics`), so the
 * aggregated metrics are byte-identical to a sequential `runConfig` over the same
 * games — the correctness invariant the run-test suite pins for the in-process
 * shard-merge and that the parallel-verification script confirms end-to-end
 * through the real subprocess serialization path.
 */
export function toEntries(lines: ShardLine[]): GameEntry[] {
  const byIndex = [...lines].sort((a, b) => a.gameIndex - b.gameIndex);
  return byIndex.map((l): GameEntry => {
    const result: GameResult = {
      winnerOrCoalition: l.result.winnerOrCoalition,
      turns: l.result.turns,
      victoryType: l.result.victoryType,
      ironOverTime: [],
      hitTurnCap: l.result.hitTurnCap,
    };
    return {
      result,
      nPlayers: l.nPlayers,
      setupDecided: l.setupDecided,
      turn1Leaders: l.turn1Leaders,
    };
  });
}
