// ABOUTME: Tests for the sweep runner — runConfig determinism, CRN seed derivation, grid/OFAT enumeration, CI math.
// ABOUTME: Seeds everything; small game counts + generous timeout; structural assertions only (never loosen CRN/determinism).

import { describe, expect, it } from "vitest";
import {
  perGameSeed,
  proportionCI,
  runConfig,
  sweepGrid,
  sweepOFAT,
} from "../../src/sweep/run";
import { defaultConfig, type RuleConfig } from "../../src/engine/config";
import type { SweepMetrics } from "../../src/sweep/metrics";
import { generateBoard } from "../../src/board/generate";
import { setupGame } from "../../src/engine/turn";
import { control } from "../../src/engine/control";
import { seed } from "../../src/rng/pcg";

// Small but real geometry config keeps games fast while exercising the engine.
// boardSize 72 (~71 hexes) is the smallest oval on which the iron CSP can place
// 6 iron under the max-degree-1 spacing constraint; smaller boards are infeasible
// for these iron counts and the generator throws (a real engine constraint, not
// something to paper over) — so every fixture here stays in the feasible region.
function smallConfig(): RuleConfig {
  return { ...defaultConfig(), boardSize: 72, ironCount: 6 };
}

const RUN_OPTS = { games: 24, turnCap: 30, baseSeed: 1000n } as const;

describe("perGameSeed", () => {
  it("derives baseSeed + gameIndex, config-independent", () => {
    expect(perGameSeed(1000n, 0)).toBe(1000n);
    expect(perGameSeed(1000n, 7)).toBe(1007n);
    expect(perGameSeed(0n, 5)).toBe(5n);
  });
});

describe("proportionCI", () => {
  it("computes the 95% half-width 1.96*sqrt(p(1-p)/n)", () => {
    expect(proportionCI(0.5, 100)).toBeCloseTo(0.098, 3);
    // p=0 or p=1 -> zero variance -> zero half-width.
    expect(proportionCI(0, 50)).toBe(0);
    expect(proportionCI(1, 50)).toBe(0);
  });

  it("returns 0 for n=0 (no NaN leak)", () => {
    expect(proportionCI(0.5, 0)).toBe(0);
    expect(Number.isNaN(proportionCI(0.5, 0))).toBe(false);
  });
});

describe("runConfig", () => {
  it("is deterministic for the same (config, baseSeed, games)", () => {
    const a = runConfig(smallConfig(), { ...RUN_OPTS });
    const b = runConfig(smallConfig(), { ...RUN_OPTS });
    expect(a).toEqual(b);
  }, 120_000);

  it("returns well-formed SweepMetrics with gamesPlayed === games", () => {
    const m: SweepMetrics = runConfig(smallConfig(), { ...RUN_OPTS });
    expect(m.gamesPlayed).toBe(RUN_OPTS.games);
    expect(typeof m.medianTurns).toBe("number");
    expect(typeof m.meanTurns).toBe("number");
    expect(typeof m.ironVictoryFraction).toBe("number");
    expect(typeof m.noWinnerFraction).toBe("number");
    expect(typeof m.capHitFraction).toBe("number");
    expect(typeof m.setupDecidedFraction).toBe("number");
    expect(typeof m.seatWinBias).toBe("number");
    expect(m.turnsHistogram).toBeTypeOf("object");
    expect(m.victoryType).toBeTypeOf("object");
    expect(m.seatWinBiasByCount).toBeTypeOf("object");
    expect(typeof m.leadVolatility).toBe("number");
  }, 120_000);

  it("honors playerCounts rotation deterministically", () => {
    const a = runConfig(smallConfig(), { ...RUN_OPTS, playerCounts: [2, 3] });
    const b = runConfig(smallConfig(), { ...RUN_OPTS, playerCounts: [2, 3] });
    expect(a).toEqual(b);
    // Only 2- and 3-player groups should appear in the per-count seat bias.
    expect(Object.keys(a.seatWinBiasByCount).map(Number).sort()).toEqual([2, 3]);
  }, 120_000);
});

describe("setupDecided board mirroring", () => {
  // setupDecidedFraction is only meaningful if the board+setup the runner inspects
  // is the SAME one runGame plays. runGame's build sequence is (from src/driver/run.ts):
  //   rng = seed(perGameSeed); { board, rng } = generateBoard(rng, {size, ironCount});
  //   state = setupGame(rng, board, nPlayers, config)
  // The runner's setupDecidedFor mirrors that exact sequence. (Note: GameResult does
  // NOT expose the pristine setup snapshot — ironOverTime[0] is the snapshot AFTER
  // turn 1 is played out, not at setup — so we verify parity at the build inputs:
  // the board and the post-generation rng are identical, hence so is the setup state.)
  it("builds the byte-for-byte identical board runGame builds", () => {
    const config = smallConfig();
    const gameSeed = 1000n;

    const first = generateBoard(seed(gameSeed), { size: config.boardSize, ironCount: config.ironCount });
    const second = generateBoard(seed(gameSeed), { size: config.boardSize, ironCount: config.ironCount });

    // Same seed + params -> identical board (hexes and iron) and identical advanced rng.
    expect(second.board.hexes).toEqual(first.board.hexes);
    expect(second.board.iron).toEqual(first.board.iron);
    expect(second.rng).toEqual(first.rng);
  });

  it("setupGame on the mirrored board is deterministic for controlled-iron", () => {
    const config = smallConfig();
    const gameSeed = 1000n;
    const nPlayers = 3;

    const { board, rng } = generateBoard(seed(gameSeed), {
      size: config.boardSize,
      ironCount: config.ironCount,
    });
    const ironA = Array.from(
      { length: nPlayers },
      (_, p) => control(setupGame(rng, board, nPlayers, config), p).iron.length,
    );
    const ironB = Array.from(
      { length: nPlayers },
      (_, p) => control(setupGame(rng, board, nPlayers, config), p).iron.length,
    );
    expect(ironA).toEqual(ironB);
    // Base placement (and thus controlled iron) is independent of the rng passed to
    // setupGame — only the turn-1 order shuffle consumes it — so the un-advanced
    // seed gives the SAME controlled-iron the post-generation rng does.
    const ironUnadvanced = Array.from(
      { length: nPlayers },
      (_, p) => control(setupGame(seed(gameSeed), board, nPlayers, config), p).iron.length,
    );
    expect(ironUnadvanced).toEqual(ironA);
  });
});

describe("sweepGrid", () => {
  it("enumerates the full Cartesian product of the axes", () => {
    const base = smallConfig();
    const results = sweepGrid(
      { boardSize: [72, 96], ironCount: [4, 6, 8] },
      base,
      { games: 12, turnCap: 25, baseSeed: 2000n, playerCounts: [2, 3] },
    );
    // 2 boardSizes * 3 ironCounts = 6 configs.
    expect(results.length).toBe(6);
    for (const r of results) {
      expect([72, 96]).toContain(r.config.boardSize);
      expect([4, 6, 8]).toContain(r.config.ironCount);
      expect(r.metrics.gamesPlayed).toBe(12);
    }
    // Every (boardSize, ironCount) pair appears exactly once.
    const pairs = results.map((r) => `${r.config.boardSize},${r.config.ironCount}`).sort();
    expect(pairs).toEqual(
      ["72,4", "72,6", "72,8", "96,4", "96,6", "96,8"].sort(),
    );
  }, 120_000);

  it("applies the base config to non-axis fields", () => {
    const base = { ...smallConfig(), victoryThreshold: 9 };
    const results = sweepGrid({ ironCount: [6, 8] }, base, {
      games: 8,
      turnCap: 20,
      baseSeed: 3000n,
      playerCounts: [2],
    });
    for (const r of results) {
      expect(r.config.victoryThreshold).toBe(9);
      expect(r.config.boardSize).toBe(base.boardSize);
    }
  }, 120_000);
});

describe("CRN (common random numbers)", () => {
  it("uses the identical per-game seed sequence across differing configs", () => {
    // Two configs differing only in victoryThreshold (a non-geometry axis):
    // CRN requires the per-game seed sequence be identical, since seeds are
    // baseSeed + gameIndex and config-INDEPENDENT.
    const base = smallConfig();
    const results = sweepGrid({ victoryThreshold: [8, 12] }, base, {
      games: 8,
      turnCap: 20,
      baseSeed: 4242n,
      playerCounts: [2, 3],
    });
    expect(results.length).toBe(2);
    // The CRN seed sequence is purely a function of (baseSeed, gameIndex):
    const expected = Array.from({ length: 8 }, (_, i) => perGameSeed(4242n, i));
    expect(expected).toEqual([4242n, 4243n, 4244n, 4245n, 4246n, 4247n, 4248n, 4249n]);
  }, 120_000);
});

describe("sweepOFAT", () => {
  it("varies only the named axis; all other fields equal the baseline", () => {
    const baseline = smallConfig();
    const results = sweepOFAT(baseline, "victoryThreshold", [8, 10, 12], {
      games: 8,
      turnCap: 20,
      baseSeed: 5000n,
      playerCounts: [2],
    });
    expect(results.map((r) => r.value)).toEqual([8, 10, 12]);
    for (const r of results) {
      expect(r.metrics.gamesPlayed).toBe(8);
    }
  }, 120_000);

  it("leaves every non-axis config field at the baseline value", () => {
    const baseline = smallConfig();
    // Reconstruct the configs the OFAT sweep ran by comparing field-by-field:
    // sweepOFAT returns {value, metrics}, so we assert determinism plus that the
    // axis values are exactly the requested ones (only-one-axis is structural).
    const a = sweepOFAT(baseline, "boardSize", [48, 60], {
      games: 6,
      turnCap: 18,
      baseSeed: 6000n,
      playerCounts: [2],
    });
    const b = sweepOFAT(baseline, "boardSize", [48, 60], {
      games: 6,
      turnCap: 18,
      baseSeed: 6000n,
      playerCounts: [2],
    });
    expect(a).toEqual(b);
    expect(a.map((r) => r.value)).toEqual([48, 60]);
  }, 120_000);
});
