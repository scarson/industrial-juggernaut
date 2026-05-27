// ABOUTME: Tests for computeMetrics + turn1LeadersOf — pure metric aggregation over hand-built GameRecord[].
// ABOUTME: No engine/randomness; crafted fixtures verify per-count seatWinBias, leadVolatility, and fraction metrics.

import { describe, expect, it } from "vitest";
import { computeMetrics, turn1LeadersOf, type GameRecord } from "../../src/sweep/metrics";
import type { GameResult } from "../../src/driver/record";

/**
 * Build a minimal GameResult. `iron0` is the turn-0 row of ironOverTime (used by
 * turn1LeadersOf); when omitted, ironOverTime is empty.
 */
function mkResult(
  partial: Partial<GameResult> & { winnerOrCoalition: GameResult["winnerOrCoalition"] },
  iron0?: number[],
): GameResult {
  return {
    winnerOrCoalition: partial.winnerOrCoalition,
    turns: partial.turns ?? 1,
    victoryType: partial.victoryType ?? "iron",
    ironOverTime: iron0 ? [iron0] : (partial.ironOverTime ?? []),
    hitTurnCap: partial.hitTurnCap ?? false,
  };
}

/** Build a GameRecord with sensible defaults; turn1Leaders defaults to argmax of iron0. */
function mkRecord(
  result: GameResult,
  nPlayers: number,
  setupDecided: boolean,
  turn1Leaders?: number[],
): GameRecord {
  return {
    result,
    nPlayers,
    setupDecided,
    turn1Leaders: turn1Leaders ?? turn1LeadersOf(result),
  };
}

describe("turn1LeadersOf", () => {
  it("returns the single argmax of ironOverTime[0]", () => {
    const r = mkResult({ winnerOrCoalition: [0] }, [3, 7, 1, 2]);
    expect(turn1LeadersOf(r)).toEqual([1]);
  });

  it("returns all tied leaders", () => {
    const r = mkResult({ winnerOrCoalition: [0] }, [5, 5, 2, 5]);
    expect(turn1LeadersOf(r)).toEqual([0, 1, 3]);
  });

  it("returns empty when there is no turn-0 row", () => {
    const r = mkResult({ winnerOrCoalition: [0] });
    expect(turn1LeadersOf(r)).toEqual([]);
  });

  it("treats all-zero iron as a full tie", () => {
    const r = mkResult({ winnerOrCoalition: [0] }, [0, 0, 0]);
    expect(turn1LeadersOf(r)).toEqual([0, 1, 2]);
  });
});

describe("computeMetrics — basic counts and fractions", () => {
  it("counts gamesPlayed", () => {
    const games = [
      mkRecord(mkResult({ winnerOrCoalition: [0] }), 2, false),
      mkRecord(mkResult({ winnerOrCoalition: [1] }), 2, false),
    ];
    expect(computeMetrics(games).gamesPlayed).toBe(2);
  });

  it("computes setupDecidedFraction = 1.0 when all decided", () => {
    const games = [
      mkRecord(mkResult({ winnerOrCoalition: [0] }), 2, true),
      mkRecord(mkResult({ winnerOrCoalition: [1] }), 2, true),
    ];
    expect(computeMetrics(games).setupDecidedFraction).toBe(1.0);
  });

  it("computes setupDecidedFraction = 0 when none decided", () => {
    const games = [
      mkRecord(mkResult({ winnerOrCoalition: [0] }), 2, false),
      mkRecord(mkResult({ winnerOrCoalition: [1] }), 2, false),
    ];
    expect(computeMetrics(games).setupDecidedFraction).toBe(0);
  });

  it("computes setupDecidedFraction as the mean for a mixed set", () => {
    const games = [
      mkRecord(mkResult({ winnerOrCoalition: [0] }), 2, true),
      mkRecord(mkResult({ winnerOrCoalition: [1] }), 2, false),
      mkRecord(mkResult({ winnerOrCoalition: [0] }), 2, true),
      mkRecord(mkResult({ winnerOrCoalition: [1] }), 2, false),
    ];
    expect(computeMetrics(games).setupDecidedFraction).toBe(0.5);
  });

  it("computes ironVictoryFraction / noWinnerFraction / capHitFraction on a mixed set", () => {
    const games = [
      mkRecord(mkResult({ winnerOrCoalition: [0], victoryType: "iron" }), 2, false),
      mkRecord(mkResult({ winnerOrCoalition: [1], victoryType: "iron" }), 2, false),
      mkRecord(
        mkResult({ winnerOrCoalition: [0], victoryType: "last-standing" }),
        2,
        false,
      ),
      mkRecord(
        mkResult({ winnerOrCoalition: [], victoryType: "none", hitTurnCap: true }),
        2,
        false,
      ),
    ];
    const m = computeMetrics(games);
    expect(m.ironVictoryFraction).toBe(0.5); // 2/4
    expect(m.noWinnerFraction).toBe(0.25); // 1/4 (empty coalition)
    expect(m.capHitFraction).toBe(0.25); // 1/4 (hitTurnCap)
  });

  it("counts victoryType mix", () => {
    const games = [
      mkRecord(mkResult({ winnerOrCoalition: [0], victoryType: "iron" }), 2, false),
      mkRecord(mkResult({ winnerOrCoalition: [1], victoryType: "iron" }), 2, false),
      mkRecord(
        mkResult({ winnerOrCoalition: [0], victoryType: "last-standing" }),
        2,
        false,
      ),
      mkRecord(
        mkResult({ winnerOrCoalition: [], victoryType: "none", hitTurnCap: true }),
        2,
        false,
      ),
    ];
    expect(computeMetrics(games).victoryType).toEqual({
      iron: 2,
      "last-standing": 1,
      none: 1,
    });
  });
});

describe("computeMetrics — turn-length stats", () => {
  it("computes turnsHistogram, medianTurns (odd count), meanTurns", () => {
    const games = [
      mkRecord(mkResult({ winnerOrCoalition: [0], turns: 3 }), 2, false),
      mkRecord(mkResult({ winnerOrCoalition: [1], turns: 5 }), 2, false),
      mkRecord(mkResult({ winnerOrCoalition: [0], turns: 10 }), 2, false),
    ];
    const m = computeMetrics(games);
    expect(m.turnsHistogram).toEqual({ 3: 1, 5: 1, 10: 1 });
    expect(m.medianTurns).toBe(5); // middle of [3,5,10]
    expect(m.meanTurns).toBe(6); // (3+5+10)/3
  });

  it("computes medianTurns as the average of the two middles (even count)", () => {
    const games = [
      mkRecord(mkResult({ winnerOrCoalition: [0], turns: 2 }), 2, false),
      mkRecord(mkResult({ winnerOrCoalition: [1], turns: 4 }), 2, false),
      mkRecord(mkResult({ winnerOrCoalition: [0], turns: 6 }), 2, false),
      mkRecord(mkResult({ winnerOrCoalition: [1], turns: 8 }), 2, false),
    ];
    const m = computeMetrics(games);
    expect(m.medianTurns).toBe(5); // (4+6)/2
    expect(m.meanTurns).toBe(5); // (2+4+6+8)/4
    expect(m.turnsHistogram).toEqual({ 2: 1, 4: 1, 6: 1, 8: 1 });
  });

  it("aggregates repeated turn lengths in the histogram", () => {
    const games = [
      mkRecord(mkResult({ winnerOrCoalition: [0], turns: 4 }), 2, false),
      mkRecord(mkResult({ winnerOrCoalition: [1], turns: 4 }), 2, false),
      mkRecord(mkResult({ winnerOrCoalition: [0], turns: 7 }), 2, false),
    ];
    expect(computeMetrics(games).turnsHistogram).toEqual({ 4: 2, 7: 1 });
  });
});

describe("computeMetrics — seatWinBias (per player-count group)", () => {
  it("computes per-count bias and reports the max across groups", () => {
    const games: GameRecord[] = [];

    // 2P group: 10 games, seat 0 wins 8 (80%), seat 1 wins 2 (20%).
    // Per-seat |winRate - 1/2|: seat0 |0.8-0.5|=0.3, seat1 |0.2-0.5|=0.3 -> bias 0.30.
    for (let i = 0; i < 8; i++) {
      games.push(mkRecord(mkResult({ winnerOrCoalition: [0] }), 2, false, [0]));
    }
    for (let i = 0; i < 2; i++) {
      games.push(mkRecord(mkResult({ winnerOrCoalition: [1] }), 2, false, [1]));
    }

    // 4P group: 8 games, each seat wins exactly 2 (25% each) -> symmetric, bias 0.
    for (let seat = 0; seat < 4; seat++) {
      for (let k = 0; k < 2; k++) {
        games.push(mkRecord(mkResult({ winnerOrCoalition: [seat] }), 4, false, [seat]));
      }
    }

    const m = computeMetrics(games);
    expect(m.seatWinBiasByCount[2]).toBeCloseTo(0.3, 10);
    expect(m.seatWinBiasByCount[4]).toBeCloseTo(0, 10);
    expect(m.seatWinBias).toBeCloseTo(0.3, 10); // max over groups
  });

  it("counts every coalition member toward each seat's win-rate", () => {
    // 2P group, 4 games: a 2-seat coalition wins twice, seat 0 alone wins twice.
    // seat0 wins 4/4 = 1.0 -> |1.0-0.5| = 0.5 ; seat1 wins 2/4 = 0.5 -> |0.5-0.5| = 0.
    const games: GameRecord[] = [
      mkRecord(mkResult({ winnerOrCoalition: [0, 1] }), 2, false, [0]),
      mkRecord(mkResult({ winnerOrCoalition: [0, 1] }), 2, false, [0]),
      mkRecord(mkResult({ winnerOrCoalition: [0] }), 2, false, [0]),
      mkRecord(mkResult({ winnerOrCoalition: [0] }), 2, false, [0]),
    ];
    const m = computeMetrics(games);
    expect(m.seatWinBiasByCount[2]).toBeCloseTo(0.5, 10);
    expect(m.seatWinBias).toBeCloseTo(0.5, 10);
  });
});

describe("computeMetrics — leadVolatility", () => {
  it("is 0 when every winner was a turn-1 leader", () => {
    const games = [
      mkRecord(mkResult({ winnerOrCoalition: [1] }), 2, false, [1]), // leader 1, winner 1
      mkRecord(mkResult({ winnerOrCoalition: [0] }), 2, false, [0]), // leader 0, winner 0
    ];
    expect(computeMetrics(games).leadVolatility).toBe(0);
  });

  it("is 1 when no winner was a turn-1 leader (among decided games)", () => {
    const games = [
      mkRecord(mkResult({ winnerOrCoalition: [0] }), 2, false, [1]), // leader 1, winner 0
      mkRecord(mkResult({ winnerOrCoalition: [1] }), 2, false, [0]), // leader 0, winner 1
    ];
    expect(computeMetrics(games).leadVolatility).toBe(1);
  });

  it("computes the fraction on a mixed set", () => {
    const games = [
      mkRecord(mkResult({ winnerOrCoalition: [1] }), 2, false, [1]), // leader 1, winner 1 -> not volatile
      mkRecord(mkResult({ winnerOrCoalition: [0] }), 2, false, [1]), // leader 1, winner 0 -> volatile
      mkRecord(mkResult({ winnerOrCoalition: [0] }), 2, false, [0]), // leader 0, winner 0 -> not volatile
      mkRecord(mkResult({ winnerOrCoalition: [1] }), 2, false, [0]), // leader 0, winner 1 -> volatile
    ];
    expect(computeMetrics(games).leadVolatility).toBe(0.5); // 2/4
  });

  it("counts a winner as non-volatile if it is ANY of the tied turn-1 leaders", () => {
    const games = [
      mkRecord(mkResult({ winnerOrCoalition: [2] }), 3, false, [0, 1, 2]), // all tied; winner 2 is a leader
    ];
    expect(computeMetrics(games).leadVolatility).toBe(0);
  });

  it("counts a coalition win as non-volatile if any member was a turn-1 leader", () => {
    const games = [
      mkRecord(mkResult({ winnerOrCoalition: [0, 2] }), 3, false, [0]), // leader 0, in coalition
    ];
    expect(computeMetrics(games).leadVolatility).toBe(0);
  });

  it("EXCLUDES empty-winner games from the denominator", () => {
    // 1 decided volatile game + 2 empty-winner games. Documented choice: empty
    // winners are excluded, so volatility = 1/1 = 1, not 1/3.
    const games = [
      mkRecord(mkResult({ winnerOrCoalition: [0] }), 2, false, [1]), // volatile
      mkRecord(
        mkResult({ winnerOrCoalition: [], victoryType: "none", hitTurnCap: true }),
        2,
        false,
        [0],
      ),
      mkRecord(
        mkResult({ winnerOrCoalition: [], victoryType: "none", hitTurnCap: true }),
        2,
        false,
        [1],
      ),
    ];
    expect(computeMetrics(games).leadVolatility).toBe(1);
  });

  it("is 0 when all games are empty-winner (no decided games)", () => {
    const games = [
      mkRecord(
        mkResult({ winnerOrCoalition: [], victoryType: "none", hitTurnCap: true }),
        2,
        false,
        [0],
      ),
    ];
    expect(computeMetrics(games).leadVolatility).toBe(0);
  });
});

describe("computeMetrics — empty input", () => {
  it("returns zeroed metrics for no games", () => {
    const m = computeMetrics([]);
    expect(m.gamesPlayed).toBe(0);
    expect(m.medianTurns).toBe(0);
    expect(m.meanTurns).toBe(0);
    expect(m.turnsHistogram).toEqual({});
    expect(m.victoryType).toEqual({});
    expect(m.ironVictoryFraction).toBe(0);
    expect(m.noWinnerFraction).toBe(0);
    expect(m.capHitFraction).toBe(0);
    expect(m.setupDecidedFraction).toBe(0);
    expect(m.seatWinBias).toBe(0);
    expect(m.seatWinBiasByCount).toEqual({});
    expect(m.leadVolatility).toBe(0);
  });
});
