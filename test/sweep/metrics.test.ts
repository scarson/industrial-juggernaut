// ABOUTME: Tests for computeMetrics — the pure metrics aggregation layer for the balance-sweep harness.
// ABOUTME: All fixtures are hand-built GameResult arrays; no actual games are run here.

import { describe, expect, it } from "vitest";
import { computeMetrics } from "../../src/sweep/metrics";
import type { SweepMetrics } from "../../src/sweep/metrics";
import type { GameResult } from "../../src/driver/record";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Minimal valid GameResult with explicit ironOverTime. */
function makeResult(
  overrides: Partial<GameResult> & { ironOverTime: number[][] },
): GameResult {
  return {
    winnerOrCoalition: [0],
    turns: 5,
    victoryType: "iron",
    hitTurnCap: false,
    ...overrides,
  };
}

/** 2-player iron-victory result for player `winner` ending at turn `turns`. */
function iron2p(winner: 0 | 1, turns: number, ironOverTime: number[][]): GameResult {
  return makeResult({ winnerOrCoalition: [winner], turns, victoryType: "iron", hitTurnCap: false, ironOverTime });
}

/** 2-player turn-cap result. */
function cap2p(turns: number, ironOverTime: number[][]): GameResult {
  return makeResult({ winnerOrCoalition: [], turns, victoryType: "none", hitTurnCap: true, ironOverTime });
}

/** Dummy 2-player ironOverTime: player 0 always leads. */
function iot2p(nTurns: number): number[][] {
  return Array.from({ length: nTurns }, () => [5, 2]);
}

/** Dummy 2-player ironOverTime: player 1 always leads. */
function iot2pP1Lead(nTurns: number): number[][] {
  return Array.from({ length: nTurns }, () => [2, 5]);
}

// ---------------------------------------------------------------------------
// gamesPlayed
// ---------------------------------------------------------------------------

describe("computeMetrics — gamesPlayed", () => {
  it("counts the number of input games", () => {
    const games = [
      { result: iron2p(0, 5, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: iron2p(1, 3, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: cap2p(10, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
    ];
    const m = computeMetrics(games);
    expect(m.gamesPlayed).toBe(3);
  });

  it("returns 0 gamesPlayed for an empty input", () => {
    const m = computeMetrics([]);
    expect(m.gamesPlayed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// turnsHistogram, medianTurns, meanTurns
// ---------------------------------------------------------------------------

describe("computeMetrics — turns distribution", () => {
  it("builds turnsHistogram with correct counts", () => {
    const games = [
      { result: iron2p(0, 3, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: iron2p(1, 3, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: iron2p(0, 7, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
    ];
    const m = computeMetrics(games);
    expect(m.turnsHistogram[3]).toBe(2);
    expect(m.turnsHistogram[7]).toBe(1);
    expect(Object.keys(m.turnsHistogram)).toHaveLength(2);
  });

  it("computes medianTurns on odd count", () => {
    // turns: 3, 5, 9 → sorted median = 5
    const games = [
      { result: iron2p(0, 9, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: iron2p(0, 3, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: iron2p(0, 5, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
    ];
    const m = computeMetrics(games);
    expect(m.medianTurns).toBe(5);
  });

  it("computes medianTurns on even count (average of two middle values)", () => {
    // turns: 2, 4, 6, 8 → median = 5
    const games = [
      { result: iron2p(0, 2, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: iron2p(0, 8, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: iron2p(0, 4, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: iron2p(0, 6, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
    ];
    const m = computeMetrics(games);
    expect(m.medianTurns).toBe(5);
  });

  it("computes meanTurns correctly", () => {
    // turns: 2, 4, 6 → mean = 4
    const games = [
      { result: iron2p(0, 2, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: iron2p(0, 4, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: iron2p(0, 6, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
    ];
    const m = computeMetrics(games);
    expect(m.meanTurns).toBeCloseTo(4.0, 6);
  });

  it("returns 0 for median and mean when no games", () => {
    const m = computeMetrics([]);
    expect(m.medianTurns).toBe(0);
    expect(m.meanTurns).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// victoryType mix
// ---------------------------------------------------------------------------

describe("computeMetrics — victoryType", () => {
  it("counts each victory type accurately", () => {
    const games = [
      { result: iron2p(0, 5, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: makeResult({ winnerOrCoalition: [0], turns: 6, victoryType: "last-standing", hitTurnCap: false, ironOverTime: iot2p(1) }), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: cap2p(10, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: cap2p(10, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
    ];
    const m = computeMetrics(games);
    expect(m.victoryType["iron"]).toBe(1);
    expect(m.victoryType["last-standing"]).toBe(1);
    expect(m.victoryType["none"]).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// ironVictoryFraction, noWinnerFraction, capHitFraction
// ---------------------------------------------------------------------------

describe("computeMetrics — fractions", () => {
  it("computes ironVictoryFraction as proportion of iron-type wins", () => {
    // 2 iron, 1 last-standing, 1 none → 0.5
    const games = [
      { result: iron2p(0, 5, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: iron2p(1, 5, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: makeResult({ winnerOrCoalition: [0], turns: 6, victoryType: "last-standing", hitTurnCap: false, ironOverTime: iot2p(1) }), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: cap2p(10, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
    ];
    const m = computeMetrics(games);
    expect(m.ironVictoryFraction).toBeCloseTo(0.5, 6);
  });

  it("computes noWinnerFraction as proportion of empty-coalition results", () => {
    // 2 empty-coalition games (no-winner makeResult + cap), 2 real winners → 0.5
    const games = [
      { result: iron2p(0, 5, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: iron2p(1, 5, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: makeResult({ winnerOrCoalition: [], turns: 6, victoryType: "last-standing", hitTurnCap: false, ironOverTime: iot2p(1) }), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: cap2p(10, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
    ];
    const m = computeMetrics(games);
    expect(m.noWinnerFraction).toBeCloseTo(0.5, 6);
  });

  it("computes capHitFraction as proportion of hitTurnCap games", () => {
    // 1 capped, 3 normal → 0.25
    const games = [
      { result: iron2p(0, 5, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: iron2p(1, 5, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: iron2p(0, 7, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: cap2p(10, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
    ];
    const m = computeMetrics(games);
    expect(m.capHitFraction).toBeCloseTo(0.25, 6);
  });

  it("returns 0 for all fractions on empty input", () => {
    const m = computeMetrics([]);
    expect(m.ironVictoryFraction).toBe(0);
    expect(m.noWinnerFraction).toBe(0);
    expect(m.capHitFraction).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// setupDecidedFraction
// ---------------------------------------------------------------------------

describe("computeMetrics — setupDecidedFraction", () => {
  it("returns 1.0 when ALL games are setup-decided", () => {
    const games = [
      { result: iron2p(0, 1, iot2p(1)), nPlayers: 2, setupDecided: true, turn1Leaders: [0] },
      { result: iron2p(0, 2, iot2p(1)), nPlayers: 2, setupDecided: true, turn1Leaders: [0] },
      { result: iron2p(0, 3, iot2p(1)), nPlayers: 2, setupDecided: true, turn1Leaders: [0] },
    ];
    const m = computeMetrics(games);
    expect(m.setupDecidedFraction).toBeCloseTo(1.0, 6);
  });

  it("returns 0.0 when NO games are setup-decided", () => {
    const games = [
      { result: iron2p(0, 5, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: iron2p(1, 7, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
    ];
    const m = computeMetrics(games);
    expect(m.setupDecidedFraction).toBeCloseTo(0.0, 6);
  });

  it("returns the mean of the boolean flags for mixed input", () => {
    // 2 true, 2 false → 0.5
    const games = [
      { result: iron2p(0, 5, iot2p(1)), nPlayers: 2, setupDecided: true, turn1Leaders: [0] },
      { result: iron2p(1, 5, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: iron2p(0, 5, iot2p(1)), nPlayers: 2, setupDecided: true, turn1Leaders: [0] },
      { result: iron2p(1, 5, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
    ];
    const m = computeMetrics(games);
    expect(m.setupDecidedFraction).toBeCloseTo(0.5, 6);
  });

  it("returns 0 for empty input", () => {
    const m = computeMetrics([]);
    expect(m.setupDecidedFraction).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// seatWinBias — within-group, per-nPlayers
// ---------------------------------------------------------------------------

describe("computeMetrics — seatWinBias", () => {
  it("returns ~0 bias for symmetric results (each seat wins equally)", () => {
    // 4 games, 2P: seat 0 wins 2, seat 1 wins 2 → expected win rate 0.5 each → bias ~0
    const games = [
      { result: iron2p(0, 5, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: iron2p(0, 5, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: iron2p(1, 5, iot2pP1Lead(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [1] },
      { result: iron2p(1, 5, iot2pP1Lead(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [1] },
    ];
    const m = computeMetrics(games);
    expect(m.seatWinBias.maxBiasAcrossGroups).toBeCloseTo(0, 6);
    expect(m.seatWinBias.byNPlayers[2]).toBeCloseTo(0, 6);
  });

  it("returns correct bias when one seat always wins in a 2P group", () => {
    // All 4 games: player 0 wins → seat 0 win rate = 1.0, expected = 0.5, bias = 0.5
    const games = [
      { result: iron2p(0, 5, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: iron2p(0, 5, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: iron2p(0, 5, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: iron2p(0, 5, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
    ];
    const m = computeMetrics(games);
    expect(m.seatWinBias.maxBiasAcrossGroups).toBeCloseTo(0.5, 6);
    expect(m.seatWinBias.byNPlayers[2]).toBeCloseTo(0.5, 6);
  });

  it("computes bias WITHIN each player-count group separately", () => {
    // 2P group: player 0 always wins → bias 0.5
    // 3P group: all even → bias 0
    const iron3p = (winner: number): GameResult =>
      makeResult({
        winnerOrCoalition: [winner],
        turns: 5,
        victoryType: "iron",
        hitTurnCap: false,
        ironOverTime: [[3, 2, 1]],
      });
    const games = [
      // 2P group — player 0 always wins
      { result: iron2p(0, 5, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: iron2p(0, 5, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: iron2p(0, 5, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      // 3P group — each player wins once → symmetric
      { result: iron3p(0), nPlayers: 3, setupDecided: false, turn1Leaders: [0] },
      { result: iron3p(1), nPlayers: 3, setupDecided: false, turn1Leaders: [1] },
      { result: iron3p(2), nPlayers: 3, setupDecided: false, turn1Leaders: [2] },
    ];
    const m = computeMetrics(games);
    // 2P bias: seat 0 rate = 1.0, expected = 0.5 → 0.5
    expect(m.seatWinBias.byNPlayers[2]).toBeCloseTo(0.5, 6);
    // 3P bias: each seat wins 1/3 → expected 1/3 → bias ~0
    expect(m.seatWinBias.byNPlayers[3]).toBeCloseTo(0, 6);
    // max bias = max(0.5, 0) = 0.5
    expect(m.seatWinBias.maxBiasAcrossGroups).toBeCloseTo(0.5, 6);
  });

  it("excludes no-winner games (empty coalition) from the seat-win count", () => {
    // 2P: 2 wins for player 0, 2 no-winners.
    // seat 0: 2 wins / 4 games = 0.5; seat 1: 0 wins / 4 games = 0.0; max bias = |0.5 - 0.5| vs |0 - 0.5| = 0.5
    // No-winner games don't count toward any seat's wins but DO count in games-per-group
    const games = [
      { result: iron2p(0, 5, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: iron2p(0, 5, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: cap2p(10, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: cap2p(10, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
    ];
    const m = computeMetrics(games);
    // seat 0: 2 wins out of 4 games = 0.5, seat 1: 0/4 = 0
    // max bias = |0.5 - 0.5| vs |0 - 0.5| = 0.5
    expect(m.seatWinBias.byNPlayers[2]).toBeCloseTo(0.5, 6);
  });

  it("credits each member of a winning coalition with a seat win", () => {
    // 3P, single game won by coalition [0, 1]: seats 0 and 1 each get one win, seat 2 none.
    // seat rates: 0 → 1/1 = 1.0, 1 → 1/1 = 1.0, 2 → 0/1 = 0.0; expected = 1/3.
    // bias = max(|1 - 1/3|, |1 - 1/3|, |0 - 1/3|) = 2/3.
    const coalitionWin: GameResult = makeResult({
      winnerOrCoalition: [0, 1],
      turns: 5,
      victoryType: "iron",
      hitTurnCap: false,
      ironOverTime: [[3, 3, 1]],
    });
    const games = [
      { result: coalitionWin, nPlayers: 3, setupDecided: false, turn1Leaders: [0, 1] },
    ];
    const m = computeMetrics(games);
    expect(m.seatWinBias.byNPlayers[3]).toBeCloseTo(2 / 3, 6);
    expect(m.seatWinBias.maxBiasAcrossGroups).toBeCloseTo(2 / 3, 6);
  });
});

// ---------------------------------------------------------------------------
// leadVolatility
// ---------------------------------------------------------------------------

describe("computeMetrics — leadVolatility", () => {
  it("returns 0 when winner is always in turn1Leaders", () => {
    // All games: player 0 leads at turn 1 AND wins
    const games = [
      { result: iron2p(0, 5, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: iron2p(0, 5, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: iron2p(0, 5, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
    ];
    const m = computeMetrics(games);
    expect(m.leadVolatility).toBeCloseTo(0, 6);
  });

  it("returns 1 when winner is never in turn1Leaders", () => {
    // All games: player 0 leads at turn 1 but player 1 wins
    const games = [
      { result: iron2p(1, 5, iot2pP1Lead(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: iron2p(1, 5, iot2pP1Lead(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: iron2p(1, 5, iot2pP1Lead(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
    ];
    const m = computeMetrics(games);
    expect(m.leadVolatility).toBeCloseTo(1.0, 6);
  });

  it("handles a mixed case: half the games have the leader flip", () => {
    // Games 0 and 1: leader wins. Games 2 and 3: leader doesn't win.
    const games = [
      { result: iron2p(0, 5, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: iron2p(0, 5, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: iron2p(1, 5, iot2pP1Lead(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: iron2p(1, 5, iot2pP1Lead(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
    ];
    const m = computeMetrics(games);
    expect(m.leadVolatility).toBeCloseTo(0.5, 6);
  });

  it("counts no-winner games as NOT having winner in turn1Leaders (winner is volatile)", () => {
    // cap game: winnerOrCoalition = [] which is not in turn1Leaders ([0])
    const games = [
      { result: cap2p(10, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
      { result: cap2p(10, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
    ];
    const m = computeMetrics(games);
    // No winner at all → no winner is in turn1Leaders → volatile
    expect(m.leadVolatility).toBeCloseTo(1.0, 6);
  });

  it("returns 0 for empty input", () => {
    const m = computeMetrics([]);
    expect(m.leadVolatility).toBe(0);
  });

  it("handles ties in turn1Leaders: winner in turn1Leaders counts as non-volatile", () => {
    // Both players tie for lead at turn 1 (turn1Leaders = [0, 1]); player 1 wins → still in leaders
    const games = [
      { result: iron2p(1, 5, [[3, 3]]), nPlayers: 2, setupDecided: false, turn1Leaders: [0, 1] },
      { result: iron2p(1, 5, [[3, 3]]), nPlayers: 2, setupDecided: false, turn1Leaders: [0, 1] },
    ];
    const m = computeMetrics(games);
    expect(m.leadVolatility).toBeCloseTo(0, 6);
  });
});

// ---------------------------------------------------------------------------
// SweepMetrics structural contract
// ---------------------------------------------------------------------------

describe("computeMetrics — SweepMetrics contract", () => {
  it("returns all required fields", () => {
    const games = [
      { result: iron2p(0, 5, iot2p(1)), nPlayers: 2, setupDecided: false, turn1Leaders: [0] },
    ];
    const m: SweepMetrics = computeMetrics(games);
    expect(typeof m.gamesPlayed).toBe("number");
    expect(typeof m.medianTurns).toBe("number");
    expect(typeof m.meanTurns).toBe("number");
    expect(typeof m.ironVictoryFraction).toBe("number");
    expect(typeof m.noWinnerFraction).toBe("number");
    expect(typeof m.capHitFraction).toBe("number");
    expect(typeof m.setupDecidedFraction).toBe("number");
    expect(typeof m.leadVolatility).toBe("number");
    expect(typeof m.seatWinBias.maxBiasAcrossGroups).toBe("number");
    expect(typeof m.seatWinBias.byNPlayers).toBe("object");
    expect(typeof m.victoryType).toBe("object");
    expect(typeof m.turnsHistogram).toBe("object");
  });
});
