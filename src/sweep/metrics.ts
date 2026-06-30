// ABOUTME: SweepMetrics type and computeMetrics — pure aggregation of game-result batches for the balance-sweep harness.
// ABOUTME: Consumed by the health gate (S2), the CRN runner (S3), and the report (S4); this module has no runtime deps.

import type { GameResult } from "../driver/record";
import type { PlayerId } from "../engine/types";

// ---------------------------------------------------------------------------
// Public contract types
// ---------------------------------------------------------------------------

/**
 * Per-player-count seat-win-bias summary.
 *
 * Bias is computed WITHIN each nPlayers group (seat indices mean different
 * things in a 2P vs. 6P game) and expressed as the maximum over seats of
 * |seatWinRate − 1/nPlayers|. A bias of 0 means every seat wins at the
 * expected uniform rate; higher values signal first-player or positional
 * advantage.
 */
export interface SeatWinBiasResult {
  /** Max over all nPlayers groups of the per-group bias value. */
  maxBiasAcrossGroups: number;
  /** Per-group bias: `byNPlayers[n]` is the max-seat-bias for the n-player group. */
  byNPlayers: Record<number, number>;
}

/** Aggregated metrics returned by `computeMetrics`. Pure; no side effects. */
export interface SweepMetrics {
  /** Total number of input games. */
  gamesPlayed: number;

  /** `turnsHistogram[t]` = count of games ending at `phase.turn === t`. */
  turnsHistogram: Record<number, number>;
  /** Median number of turns across all games (0 if no games). */
  medianTurns: number;
  /** Mean number of turns across all games (0 if no games). */
  meanTurns: number;

  /** Count of games by victoryType key (`"iron"`, `"last-standing"`, `"none"`). */
  victoryType: Record<string, number>;

  /** Fraction of games with `victoryType === "iron"`. */
  ironVictoryFraction: number;
  /** Fraction of games where `winnerOrCoalition` is empty (no winner). */
  noWinnerFraction: number;
  /** Fraction of games where `hitTurnCap === true`. */
  capHitFraction: number;

  /**
   * Mean of the `setupDecided` boolean flags supplied by the runner.
   * 1.0 = every game was decided at setup; 0.0 = none were.
   */
  setupDecidedFraction: number;

  /** Seat-win-rate bias, computed within each player-count group. */
  seatWinBias: SeatWinBiasResult;

  /**
   * Fraction of games where the eventual winner was NOT in `turn1Leaders`.
   * Games with no winner (cap hit, empty coalition) count as volatile
   * because no winner is in the leader set.
   */
  leadVolatility: number;
}

// ---------------------------------------------------------------------------
// Input type for a single game entry
// ---------------------------------------------------------------------------

export interface GameEntry {
  /** The driver's result for this game. */
  result: GameResult;
  /** Number of players in this game. */
  nPlayers: number;
  /**
   * Whether this game was decided at setup: true iff any player controlled
   * >= victoryThreshold iron at setup time (computed by the runner via
   * `setupGame`). Pure flag — `computeMetrics` does not recompute it.
   */
  setupDecided: boolean;
  /**
   * Player(s) with the maximum iron count at the first turn boundary
   * (`result.ironOverTime[0]`). Ties → all tying players. Computed by the
   * runner as argmax of `ironOverTime[0]`.
   */
  turn1Leaders: PlayerId[];
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/** Compute a sorted median of a numeric array. Returns 0 for empty input. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Compute the seat-win-rate bias within each player-count group.
 *
 * For each distinct nPlayers value present in the input:
 *   - Count wins per seat index across all games in the group.
 *   - No-winner games (empty coalition) contribute 0 wins to all seats but
 *     still count toward `gamesInGroup`, diluting all seat win rates and
 *     inflating apparent bias when cap-hit frequency is high.
 *   - Coalition games (len > 1) credit each member's seat index with one win
 *     (the runner typically produces single-player winners, but coalitions
 *     are permitted by the engine).
 *   - Bias = max over seats of |seatWinRate − 1/nPlayers|.
 *
 * Returns the per-group map and the max bias across all groups.
 */
function computeSeatWinBias(entries: GameEntry[]): SeatWinBiasResult {
  // Group entries by nPlayers.
  const groups = new Map<number, GameEntry[]>();
  for (const e of entries) {
    let g = groups.get(e.nPlayers);
    if (g === undefined) {
      g = [];
      groups.set(e.nPlayers, g);
    }
    g.push(e);
  }

  const byNPlayers: Record<number, number> = {};
  let maxBias = 0;

  for (const [n, group] of groups) {
    const seatWins = new Array<number>(n).fill(0);
    const gamesInGroup = group.length;

    for (const { result } of group) {
      for (const winner of result.winnerOrCoalition) {
        // winner is a PlayerId (0..5); treat as seat index within this group.
        if (winner >= 0 && winner < n) {
          seatWins[winner]!++;
        }
      }
    }

    const expected = 1 / n;
    let groupBias = 0;
    for (let seat = 0; seat < n; seat++) {
      const rate = seatWins[seat]! / gamesInGroup;
      groupBias = Math.max(groupBias, Math.abs(rate - expected));
    }

    byNPlayers[n] = groupBias;
    maxBias = Math.max(maxBias, groupBias);
  }

  return { maxBiasAcrossGroups: maxBias, byNPlayers };
}

/**
 * Aggregate a batch of game entries into `SweepMetrics`. Pure and deterministic.
 *
 * The caller (the S3 CRN runner) supplies each entry's `setupDecided` flag and
 * `turn1Leaders` list — this function does not access game state or config.
 */
export function computeMetrics(entries: GameEntry[]): SweepMetrics {
  const n = entries.length;

  if (n === 0) {
    return {
      gamesPlayed: 0,
      turnsHistogram: {},
      medianTurns: 0,
      meanTurns: 0,
      victoryType: {},
      ironVictoryFraction: 0,
      noWinnerFraction: 0,
      capHitFraction: 0,
      setupDecidedFraction: 0,
      seatWinBias: { maxBiasAcrossGroups: 0, byNPlayers: {} },
      leadVolatility: 0,
    };
  }

  // --- Turns ---
  const turnsHistogram: Record<number, number> = {};
  const allTurns: number[] = [];
  let turnsSum = 0;

  // --- Victory types ---
  const victoryType: Record<string, number> = {};
  let ironCount = 0;
  let noWinnerCount = 0;
  let capHitCount = 0;

  // --- Setup decided ---
  let setupDecidedSum = 0;

  // --- Lead volatility ---
  let volatileCount = 0;

  for (const { result, setupDecided, turn1Leaders } of entries) {
    // Turns
    turnsHistogram[result.turns] = (turnsHistogram[result.turns] ?? 0) + 1;
    allTurns.push(result.turns);
    turnsSum += result.turns;

    // Victory types
    victoryType[result.victoryType] = (victoryType[result.victoryType] ?? 0) + 1;
    if (result.victoryType === "iron") ironCount++;
    if (result.winnerOrCoalition.length === 0) noWinnerCount++;
    if (result.hitTurnCap) capHitCount++;

    // Setup decided
    if (setupDecided) setupDecidedSum++;

    // Lead volatility: volatile if no winner is in turn1Leaders
    const leadersSet = new Set(turn1Leaders);
    const winnerInLeaders = result.winnerOrCoalition.some((w) => leadersSet.has(w));
    if (!winnerInLeaders) volatileCount++;
  }

  return {
    gamesPlayed: n,
    turnsHistogram,
    medianTurns: median(allTurns),
    meanTurns: turnsSum / n,
    victoryType,
    ironVictoryFraction: ironCount / n,
    noWinnerFraction: noWinnerCount / n,
    capHitFraction: capHitCount / n,
    setupDecidedFraction: setupDecidedSum / n,
    seatWinBias: computeSeatWinBias(entries),
    leadVolatility: volatileCount / n,
  };
}
