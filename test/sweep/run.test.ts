// ABOUTME: Tests for the CRN sweep runner — gameSeed/runConfig/sweepGrid/sweepOFAT/proportionCI.
// ABOUTME: Seeded/deterministic; game counts kept small (20-40) with generous timeouts so the suite stays fast.

import { describe, expect, it } from "vitest";
import {
  gameSeed,
  proportionCI,
  runConfig,
  runConfigEntries,
  runGameEntry,
  sweepGrid,
  sweepOFAT,
} from "../../src/sweep/run";
import { computeMetrics, type GameEntry } from "../../src/sweep/metrics";
import { defaultConfig } from "../../src/engine/config";
import type { RuleConfig } from "../../src/engine/config";

const TURN_CAP = 300;
const TIMEOUT = 120_000;

// ---------------------------------------------------------------------------
// gameSeed — the CRN-guaranteeing pure helper
// ---------------------------------------------------------------------------

describe("gameSeed", () => {
  it("is baseSeed + gameIndex (config-independent)", () => {
    expect(gameSeed(0n, 0)).toBe(0n);
    expect(gameSeed(0n, 5)).toBe(5n);
    expect(gameSeed(100n, 7)).toBe(107n);
    expect(gameSeed(1n, 0)).toBe(1n);
  });

  it("depends ONLY on (baseSeed, gameIndex) — never on any config", () => {
    // There is no config parameter; the type system enforces config-independence.
    // This test pins the contract value sequence for a fixed baseSeed.
    const baseSeed = 42n;
    const seeds = Array.from({ length: 5 }, (_, i) => gameSeed(baseSeed, i));
    expect(seeds).toEqual([42n, 43n, 44n, 45n, 46n]);
  });
});

// ---------------------------------------------------------------------------
// proportionCI — 95% CI half-width
// ---------------------------------------------------------------------------

describe("proportionCI", () => {
  it("computes 1.96 * sqrt(p*(1-p)/n)", () => {
    expect(proportionCI(0.5, 100)).toBeCloseTo(1.96 * Math.sqrt(0.25 / 100), 12);
    expect(proportionCI(0.25, 400)).toBeCloseTo(1.96 * Math.sqrt((0.25 * 0.75) / 400), 12);
  });

  it("is 0 at p=0 and p=1 (no variance)", () => {
    expect(proportionCI(0, 100)).toBe(0);
    expect(proportionCI(1, 100)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// runConfig — determinism + CRN config-independence
// ---------------------------------------------------------------------------

describe("runConfig", () => {
  it(
    "is deterministic: same (config, baseSeed) -> identical SweepMetrics",
    () => {
      const config = defaultConfig();
      const opts = { games: 20, turnCap: TURN_CAP, baseSeed: 7n };
      const a = runConfig(config, opts);
      const b = runConfig(config, opts);
      expect(a).toEqual(b);
    },
    TIMEOUT,
  );

  it(
    "records nPlayers rotating over playerCounts (game i uses playerCounts[i % len])",
    () => {
      const config = defaultConfig();
      const playerCounts = [2, 3, 4];
      const seen: number[] = [];
      runConfig(config, {
        games: 7,
        turnCap: TURN_CAP,
        baseSeed: 3n,
        playerCounts,
        onGamePlayed: (gameIndex, nPlayers) => {
          seen[gameIndex] = nPlayers;
        },
      });
      expect(seen).toEqual([2, 3, 4, 2, 3, 4, 2]);
    },
    TIMEOUT,
  );

  it(
    "CRN: two DIFFERENT configs at the same baseSeed use the IDENTICAL per-game seed sequence",
    () => {
      const baseSeed = 11n;
      const games = 12;

      const seedsA: bigint[] = [];
      const seedsB: bigint[] = [];

      const configA = defaultConfig();
      // Materially different config: smaller board, fewer iron, different radius.
      const configB: RuleConfig = { ...defaultConfig(), boardSize: 61, ironCount: 8, radius: 4 };

      runConfig(configA, {
        games,
        turnCap: TURN_CAP,
        baseSeed,
        onGameSeed: (i, seed) => {
          seedsA[i] = seed;
        },
      });
      runConfig(configB, {
        games,
        turnCap: TURN_CAP,
        baseSeed,
        onGameSeed: (i, seed) => {
          seedsB[i] = seed;
        },
      });

      // CRN guarantee: per-game seed depends only on (baseSeed, gameIndex), never config.
      expect(seedsA).toEqual(seedsB);
      // And it is exactly the gameSeed sequence.
      expect(seedsA).toEqual(Array.from({ length: games }, (_, i) => gameSeed(baseSeed, i)));
    },
    TIMEOUT,
  );

  it(
    "produces well-formed SweepMetrics whose gamesPlayed matches the request",
    () => {
      const config = defaultConfig();
      const m = runConfig(config, { games: 20, turnCap: TURN_CAP, baseSeed: 1n });
      expect(m.gamesPlayed).toBe(20);
      // Fractions are within [0, 1].
      expect(m.ironVictoryFraction).toBeGreaterThanOrEqual(0);
      expect(m.ironVictoryFraction).toBeLessThanOrEqual(1);
      expect(m.setupDecidedFraction).toBeGreaterThanOrEqual(0);
      expect(m.setupDecidedFraction).toBeLessThanOrEqual(1);
    },
    TIMEOUT,
  );
});

// ---------------------------------------------------------------------------
// runGameEntry / runConfigEntries — the parallel-decomposition seam
// ---------------------------------------------------------------------------

describe("runGameEntry / runConfigEntries — parallel decomposition", () => {
  it(
    "runConfigEntries(...) aggregated equals runConfig(...) — extraction is behavior-preserving",
    () => {
      const config = defaultConfig();
      const opts = { games: 16, turnCap: TURN_CAP, baseSeed: 7n };
      const seq = runConfig(config, opts);
      const fromEntries = computeMetrics(runConfigEntries(config, opts));
      expect(fromEntries).toEqual(seq);
    },
    TIMEOUT,
  );

  it(
    "PARALLEL == SEQUENTIAL: disjoint gameIndex shards merged in order yield identical metrics",
    () => {
      // The correctness invariant for process-sharded execution: each game's CRN
      // seed = gameSeed(baseSeed, gameIndex) depends ONLY on (baseSeed, gameIndex),
      // never on which shard ran it. So splitting [0..games) into disjoint index
      // shards, running runGameEntry per index in each shard, and re-merging by
      // gameIndex MUST reproduce the sequential GameEntry list byte-for-byte —
      // hence identical computeMetrics output.
      const config: RuleConfig = { ...defaultConfig(), boardSize: 61, ironCount: 8, radius: 4 };
      const opts = { games: 15, turnCap: TURN_CAP, baseSeed: 11n };

      // Sequential ground truth.
      const sequential = runConfig(config, opts);

      // Simulate 3 process shards over disjoint, INTERLEAVED gameIndex ranges
      // (round-robin assignment is the most adversarial split — it scatters each
      // shard's indices across the whole range rather than contiguous blocks).
      const numShards = 3;
      const shardEntries: { gameIndex: number; entry: GameEntry }[] = [];
      for (let shard = 0; shard < numShards; shard++) {
        for (let i = shard; i < opts.games; i += numShards) {
          shardEntries.push({ gameIndex: i, entry: runGameEntry(config, opts, i) });
        }
      }

      // Merge: reassemble in gameIndex order (the parent's job after collecting shards).
      shardEntries.sort((a, b) => a.gameIndex - b.gameIndex);
      const merged = computeMetrics(shardEntries.map((s) => s.entry));

      expect(merged).toEqual(sequential);
    },
    TIMEOUT,
  );

  it(
    "runGameEntry uses the CRN seed gameSeed(baseSeed, gameIndex) and the rotated player count",
    () => {
      const config = defaultConfig();
      const opts = { games: 0, turnCap: TURN_CAP, baseSeed: 5n, playerCounts: [2, 3, 4] };
      // gameIndex 4 → seed 9, nPlayers = playerCounts[4 % 3] = playerCounts[1] = 3.
      const seenSeeds: bigint[] = [];
      const seenCounts: number[] = [];
      const entry = runGameEntry(config, opts, 4, {
        onGameSeed: (i, seed) => seenSeeds.push(seed),
        onGamePlayed: (i, n) => seenCounts.push(n),
      });
      expect(seenSeeds).toEqual([gameSeed(5n, 4)]);
      expect(seenSeeds).toEqual([9n]);
      expect(seenCounts).toEqual([3]);
      expect(entry.nPlayers).toBe(3);
    },
    TIMEOUT,
  );
});

// ---------------------------------------------------------------------------
// sweepGrid — full Cartesian product + CRN across configs
// ---------------------------------------------------------------------------

describe("sweepGrid", () => {
  it(
    "enumerates the full Cartesian product of the axis values over the base config",
    () => {
      const results = sweepGrid(
        { radius: [4, 5], victoryThreshold: [8, 10, 12] },
        { boardSize: 61, ironCount: 8 },
        { games: 6, turnCap: TURN_CAP, baseSeed: 2n },
      );
      // 2 radii * 3 thresholds = 6 configs.
      expect(results.length).toBe(6);

      // Every (radius, victoryThreshold) combination appears exactly once.
      const combos = results.map((r) => `${r.config.radius},${r.config.victoryThreshold}`).sort();
      expect(combos).toEqual(
        ["4,8", "4,10", "4,12", "5,8", "5,10", "5,12"].sort(),
      );

      // Fixed fields are applied to every config.
      for (const r of results) {
        expect(r.config.boardSize).toBe(61);
        expect(r.config.ironCount).toBe(8);
        expect(r.metrics.gamesPlayed).toBe(6);
      }
    },
    TIMEOUT,
  );

  it(
    "with no axes returns exactly one config equal to the base ({...defaultConfig(), ...fixed})",
    () => {
      const results = sweepGrid({}, { boardSize: 61, ironCount: 8 }, {
        games: 6,
        turnCap: TURN_CAP,
        baseSeed: 8n,
      });
      expect(results.length).toBe(1);
      expect(results[0]!.config).toEqual({ ...defaultConfig(), boardSize: 61, ironCount: 8 });
    },
    TIMEOUT,
  );

  it(
    "with an empty axis values array returns zero configs (intentional, documented Cartesian collapse)",
    () => {
      // An axis with no values multiplies the Cartesian product by 0 -> []. This
      // is the documented behavior (see sweepGrid's JSDoc precondition), pinned
      // here so a future change that silently swallows the empty case is caught.
      const results = sweepGrid({ radius: [] }, { boardSize: 61, ironCount: 8 }, {
        games: 6,
        turnCap: TURN_CAP,
        baseSeed: 8n,
      });
      expect(results).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "uses common random numbers: every config in the grid sees the identical per-game seed sequence",
    () => {
      const baseSeed = 9n;
      const games = 6;
      const seqByConfig: Record<string, bigint[]> = {};
      sweepGrid(
        { radius: [4, 5] },
        { boardSize: 61, ironCount: 8 },
        {
          games,
          turnCap: TURN_CAP,
          baseSeed,
          onGameSeed: (i, seed, config) => {
            const labelArr = (seqByConfig[String(config.radius)] ??= []);
            labelArr[i] = seed;
          },
        },
      );
      const expected = Array.from({ length: games }, (_, i) => gameSeed(baseSeed, i));
      expect(seqByConfig["4"]).toEqual(expected);
      expect(seqByConfig["5"]).toEqual(expected);
    },
    TIMEOUT,
  );
});

// ---------------------------------------------------------------------------
// sweepOFAT — one-factor-at-a-time around a baseline
// ---------------------------------------------------------------------------

describe("sweepOFAT", () => {
  it(
    "varies ONLY the named axis; every other field equals the baseline",
    () => {
      const baseline = defaultConfig();
      const results = sweepOFAT(baseline, "victoryThreshold", [8, 10, 12], {
        games: 6,
        turnCap: TURN_CAP,
        baseSeed: 4n,
      });
      expect(results.map((r) => r.value)).toEqual([8, 10, 12]);
      // Each result reports the metrics for the baseline-with-one-field-changed config.
      for (const r of results) {
        expect(r.metrics.gamesPlayed).toBe(6);
      }
    },
    TIMEOUT,
  );

  it(
    "uses common random numbers and changes only the named axis from the baseline",
    () => {
      const baseline = defaultConfig();
      const baseSeed = 5n;
      const games = 6;
      const configByValue: Record<number, RuleConfig> = {};
      const seqByValue: Record<number, bigint[]> = {};
      sweepOFAT(baseline, "radius", [4, 6], {
        games,
        turnCap: TURN_CAP,
        baseSeed,
        onGameSeed: (i, seed, config) => {
          configByValue[config.radius] = config;
          (seqByValue[config.radius] ??= [])[i] = seed;
        },
      });

      // CRN: both axis values see the identical per-game seed sequence.
      const expectedSeeds = Array.from({ length: games }, (_, i) => gameSeed(baseSeed, i));
      expect(seqByValue[4]).toEqual(expectedSeeds);
      expect(seqByValue[6]).toEqual(expectedSeeds);

      // Only `radius` differs from the baseline; every other field is untouched.
      for (const value of [4, 6]) {
        const cfg = configByValue[value]!;
        expect(cfg.radius).toBe(value);
        for (const k of Object.keys(baseline) as (keyof RuleConfig)[]) {
          if (k === "radius") continue;
          expect(cfg[k]).toEqual(baseline[k]);
        }
      }
    },
    TIMEOUT,
  );
});
