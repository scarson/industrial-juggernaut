// ABOUTME: computeMetrics — pure aggregation of per-game records into SweepMetrics for the balance sweep.
// ABOUTME: Deterministic, no engine/randomness; the S3 runner collects GameRecords and feeds them here.

import type { GameResult } from "../driver/record";
import type { PlayerId } from "../engine/types";

/**
 * One driven game's data, as collected by the S3 runner. `setupDecided` = some
 * player already controlled >= victoryThreshold iron at SETUP (the runner
 * computes this). `turn1Leaders` = argmax of `result.ironOverTime[0]` (ties ->
 * all), also supplied by the runner via {@link turn1LeadersOf}.
 */
export interface GameRecord {
  result: GameResult;
  nPlayers: number;
  setupDecided: boolean;
  turn1Leaders: PlayerId[];
}

/** Aggregated balance metrics over a batch of games for one config. */
export interface SweepMetrics {
  gamesPlayed: number;
  /** `turnsHistogram[t]` = number of games that terminated at turn t. */
  turnsHistogram: Record<number, number>;
  medianTurns: number;
  meanTurns: number;
  /** Counts by `result.victoryType`. */
  victoryType: Record<string, number>;
  /** Fraction of games won via iron-threshold victory. */
  ironVictoryFraction: number;
  /** Fraction of games ending with an empty `winnerOrCoalition`. */
  noWinnerFraction: number;
  /** Fraction of games stopped by the turn cap. */
  capHitFraction: number;
  /** Mean of the per-game `setupDecided` flags. */
  setupDecidedFraction: number;
  /** Max per-player-count seat bias (see {@link seatWinBiasByCount}). */
  seatWinBias: number;
  /**
   * Per player-count seat bias: for each distinct nPlayers, the max over seats
   * of `|seatWinRate - 1/nPlayers|`. Computed within each group because mixing
   * player counts would be meaningless (uniform target differs by count).
   */
  seatWinBiasByCount: Record<number, number>;
  /**
   * Among DECIDED games (non-empty winner), the fraction where the winner was
   * NOT among the turn-1 iron leaders. Empty-winner games are EXCLUDED from the
   * denominator: leadVolatility measures "among decided games, how often the
   * early leader didn't win", so a game with no winner has no early-leader
   * outcome to score. When there are no decided games, leadVolatility = 0.
   */
  leadVolatility: number;
}

/**
 * Turn-1 iron leaders: the argmax seats of `result.ironOverTime[0]`, with ties
 * returning every tied seat. Returns `[]` when there is no turn-0 row.
 */
export function turn1LeadersOf(result: GameResult): PlayerId[] {
  const row = result.ironOverTime[0];
  if (row === undefined || row.length === 0) return [];
  let max = row[0]!;
  for (const v of row) if (v > max) max = v;
  const leaders: PlayerId[] = [];
  for (let seat = 0; seat < row.length; seat++) {
    if (row[seat] === max) leaders.push(seat);
  }
  return leaders;
}

/** Median of a numeric array; 0 for empty. Does not mutate the input. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Aggregate per-game records into balance metrics. Pure and deterministic: the
 * output depends only on `games` (no clock, no randomness).
 */
export function computeMetrics(games: GameRecord[]): SweepMetrics {
  const gamesPlayed = games.length;

  const turnsHistogram: Record<number, number> = {};
  const victoryType: Record<string, number> = {};
  const turnsList: number[] = [];
  let turnsSum = 0;
  let ironVictories = 0;
  let noWinner = 0;
  let capHits = 0;
  let setupDecidedCount = 0;

  // Per player-count tallies for seat bias: wins[n][seat] over games[n] count.
  const groupGameCount: Record<number, number> = {};
  const groupSeatWins: Record<number, number[]> = {};

  // leadVolatility tallies (decided games only).
  let decidedGames = 0;
  let winnerNotLeader = 0;

  for (const game of games) {
    const { result, nPlayers, setupDecided, turn1Leaders } = game;

    turnsList.push(result.turns);
    turnsSum += result.turns;
    turnsHistogram[result.turns] = (turnsHistogram[result.turns] ?? 0) + 1;
    victoryType[result.victoryType] = (victoryType[result.victoryType] ?? 0) + 1;

    if (result.victoryType === "iron") ironVictories++;
    if (result.winnerOrCoalition.length === 0) noWinner++;
    if (result.hitTurnCap) capHits++;
    if (setupDecided) setupDecidedCount++;

    // Seat-bias tallies (per player-count group).
    if (groupSeatWins[nPlayers] === undefined) {
      groupSeatWins[nPlayers] = Array.from({ length: nPlayers }, () => 0);
      groupGameCount[nPlayers] = 0;
    }
    groupGameCount[nPlayers]!++;
    for (const seat of result.winnerOrCoalition) {
      if (seat >= 0 && seat < nPlayers) groupSeatWins[nPlayers]![seat]!++;
    }

    // leadVolatility: only decided games (non-empty winner) count.
    if (result.winnerOrCoalition.length > 0) {
      decidedGames++;
      const leaderSet = new Set(turn1Leaders);
      const winnerWasLeader = result.winnerOrCoalition.some((seat) => leaderSet.has(seat));
      if (!winnerWasLeader) winnerNotLeader++;
    }
  }

  const seatWinBiasByCount: Record<number, number> = {};
  let seatWinBias = 0;
  for (const key of Object.keys(groupSeatWins)) {
    const n = Number(key);
    const wins = groupSeatWins[n]!;
    const total = groupGameCount[n]!;
    const uniform = 1 / n;
    let bias = 0;
    for (const seatWins of wins) {
      const rate = total > 0 ? seatWins / total : 0;
      bias = Math.max(bias, Math.abs(rate - uniform));
    }
    seatWinBiasByCount[n] = bias;
    seatWinBias = Math.max(seatWinBias, bias);
  }

  return {
    gamesPlayed,
    turnsHistogram,
    medianTurns: median(turnsList),
    meanTurns: gamesPlayed > 0 ? turnsSum / gamesPlayed : 0,
    victoryType,
    ironVictoryFraction: gamesPlayed > 0 ? ironVictories / gamesPlayed : 0,
    noWinnerFraction: gamesPlayed > 0 ? noWinner / gamesPlayed : 0,
    capHitFraction: gamesPlayed > 0 ? capHits / gamesPlayed : 0,
    setupDecidedFraction: gamesPlayed > 0 ? setupDecidedCount / gamesPlayed : 0,
    seatWinBias,
    seatWinBiasByCount,
    leadVolatility: decidedGames > 0 ? winnerNotLeader / decidedGames : 0,
  };
}
