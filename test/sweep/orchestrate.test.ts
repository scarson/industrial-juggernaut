// ABOUTME: Tests for findBalancedConfig and balanceSweep — the sweep orchestrator and OFAT balance sweep.
// ABOUTME: Structural selection tests use hand-built fixtures; smoke tests run small real grids deterministically.

import { describe, expect, it } from "vitest";
import {
  findBalancedConfig,
  balanceSweep,
  NEAREST_MISSES_COUNT,
} from "../../src/sweep/orchestrate";
import type { GridEntry, FindResult, BalanceResult } from "../../src/sweep/orchestrate";
import { report } from "../../src/sweep/report";
import { sweepGrid } from "../../src/sweep/run";
import { defaultHealthThresholds } from "../../src/sweep/health";
import type { SweepMetrics } from "../../src/sweep/metrics";
import type { RuleConfig } from "../../src/index";
import { defaultConfig } from "../../src/index";

// ---------------------------------------------------------------------------
// Fixture helpers — reuse the style from health.test.ts
// ---------------------------------------------------------------------------

/** Build a SweepMetrics fixture with all required fields, allowing selective overrides. */
function makeMetrics(overrides: Partial<SweepMetrics>): SweepMetrics {
  return {
    gamesPlayed: 200,
    turnsHistogram: { 10: 200 },
    medianTurns: 10,
    meanTurns: 10,
    victoryType: { iron: 200 },
    ironVictoryFraction: 0.8,
    noWinnerFraction: 0.0,
    capHitFraction: 0.0,
    setupDecidedFraction: 0.0,
    seatWinBias: { maxBiasAcrossGroups: 0.05, byNPlayers: { 4: 0.05 } },
    leadVolatility: 0.5,
    ...overrides,
  };
}

/** A SweepMetrics that passes ALL default health thresholds. */
const HEALTHY_METRICS: SweepMetrics = makeMetrics({
  medianTurns: 14,
  setupDecidedFraction: 0.02,
  ironVictoryFraction: 0.7,
  capHitFraction: 0.01,
  seatWinBias: { maxBiasAcrossGroups: 0.10, byNPlayers: { 4: 0.10 } },
  leadVolatility: 0.4,
});

/** A slightly better HEALTHY_METRICS — higher leadVolatility → higher composite score. */
const HEALTHY_METRICS_BETTER: SweepMetrics = makeMetrics({
  medianTurns: 14,
  setupDecidedFraction: 0.01,
  ironVictoryFraction: 0.85,
  capHitFraction: 0.005,
  seatWinBias: { maxBiasAcrossGroups: 0.05, byNPlayers: { 4: 0.05 } },
  leadVolatility: 0.7,
});

/** Fails ALL health criteria: setup-decided high, iron-victory low, etc. */
const FAILING_METRICS_MANY: SweepMetrics = makeMetrics({
  medianTurns: 3,
  setupDecidedFraction: 0.42,
  ironVictoryFraction: 0.12,
  capHitFraction: 0.30,
  seatWinBias: { maxBiasAcrossGroups: 0.35, byNPlayers: { 4: 0.35 } },
  leadVolatility: 0.1,
});

/** Fails exactly ONE health criterion: ironVictoryFraction too low. */
const FAILING_METRICS_ONE: SweepMetrics = makeMetrics({
  medianTurns: 14,
  setupDecidedFraction: 0.02,
  ironVictoryFraction: 0.30,    // < minIronVictory 0.5 → FAIL
  capHitFraction: 0.01,
  seatWinBias: { maxBiasAcrossGroups: 0.10, byNPlayers: {} },
  leadVolatility: 0.4,
});

/** Fails exactly TWO health criteria. */
const FAILING_METRICS_TWO: SweepMetrics = makeMetrics({
  medianTurns: 14,
  setupDecidedFraction: 0.08,   // > maxSetupDecided 0.05 → FAIL
  ironVictoryFraction: 0.30,    // < minIronVictory 0.5 → FAIL
  capHitFraction: 0.01,
  seatWinBias: { maxBiasAcrossGroups: 0.10, byNPlayers: {} },
  leadVolatility: 0.4,
});

/**
 * Two metrics that BOTH fail exactly ONE criterion (ironVictoryFraction too
 * low), so they tie on reasons.length — but differ in composite score so the
 * nearest-miss tie-break can be asserted. HIGH has higher leadVolatility and
 * lower seatBias → higher `scoreMetrics`.
 */
const FAILING_ONE_HIGH_SCORE: SweepMetrics = makeMetrics({
  medianTurns: 14,                                                  // band center → max turnProximity
  setupDecidedFraction: 0.02,
  ironVictoryFraction: 0.30,    // < minIronVictory 0.5 → the SINGLE failing criterion
  capHitFraction: 0.01,
  seatWinBias: { maxBiasAcrossGroups: 0.01, byNPlayers: {} },       // low bias → higher score
  leadVolatility: 0.9,                                             // high → higher score
});

const FAILING_ONE_LOW_SCORE: SweepMetrics = makeMetrics({
  medianTurns: 14,                                                  // same turnProximity
  setupDecidedFraction: 0.02,
  ironVictoryFraction: 0.30,    // < minIronVictory 0.5 → the SAME single failing criterion
  capHitFraction: 0.01,
  seatWinBias: { maxBiasAcrossGroups: 0.18, byNPlayers: {} },       // higher bias → lower score
  leadVolatility: 0.25,                                            // lower → lower score
});

const CONFIG_A: RuleConfig = defaultConfig();
const CONFIG_B: RuleConfig = { ...defaultConfig(), radius: 4 };
const CONFIG_C: RuleConfig = { ...defaultConfig(), radius: 3 };
const CONFIG_D: RuleConfig = { ...defaultConfig(), radius: 2 };
const CONFIG_E: RuleConfig = { ...defaultConfig(), radius: 1 };
const CONFIG_F: RuleConfig = { ...defaultConfig(), attackRange: 7 };
const CONFIG_G: RuleConfig = { ...defaultConfig(), attackRange: 8 };
const CONFIG_H: RuleConfig = { ...defaultConfig(), attackRange: 9 };

// ---------------------------------------------------------------------------
// findBalancedConfig — structural selection tests (no real games)
// ---------------------------------------------------------------------------

describe("findBalancedConfig — structural selection (hand-built fixtures)", () => {
  it("returns recommended = the top-ranked passer when passers exist", () => {
    const grid = [
      { config: CONFIG_A, metrics: HEALTHY_METRICS },
      { config: CONFIG_B, metrics: FAILING_METRICS_MANY },
    ];
    const result = findBalancedConfig(grid);
    expect(result.recommended).not.toBeNull();
    expect(result.recommended?.config).toBe(CONFIG_A);
  });

  it("returns recommended = highest-scored passer when multiple passers", () => {
    // CONFIG_B has BETTER metrics → higher score → should be recommended
    const grid = [
      { config: CONFIG_A, metrics: HEALTHY_METRICS },          // passes but lower score
      { config: CONFIG_B, metrics: HEALTHY_METRICS_BETTER },   // passes with higher score
      { config: CONFIG_C, metrics: FAILING_METRICS_MANY },     // fails
    ];
    const result = findBalancedConfig(grid);
    expect(result.recommended).not.toBeNull();
    expect(result.recommended?.config).toBe(CONFIG_B);
  });

  it("returns recommended = null when no configs pass health gate", () => {
    const grid = [
      { config: CONFIG_A, metrics: FAILING_METRICS_MANY },
      { config: CONFIG_B, metrics: FAILING_METRICS_ONE },
    ];
    const result = findBalancedConfig(grid);
    expect(result.recommended).toBeNull();
  });

  it("ranked excludes all failers — contains only passers", () => {
    const grid = [
      { config: CONFIG_A, metrics: HEALTHY_METRICS },
      { config: CONFIG_B, metrics: FAILING_METRICS_MANY },
      { config: CONFIG_C, metrics: HEALTHY_METRICS_BETTER },
      { config: CONFIG_D, metrics: FAILING_METRICS_ONE },
    ];
    const result = findBalancedConfig(grid);
    expect(result.ranked).toHaveLength(2);
    const configs = result.ranked.map((r) => r.config);
    expect(configs).toContain(CONFIG_A);
    expect(configs).toContain(CONFIG_C);
    expect(configs).not.toContain(CONFIG_B);
    expect(configs).not.toContain(CONFIG_D);
  });

  it("ranked is empty when no configs pass", () => {
    const grid = [
      { config: CONFIG_A, metrics: FAILING_METRICS_MANY },
      { config: CONFIG_B, metrics: FAILING_METRICS_ONE },
    ];
    const result = findBalancedConfig(grid);
    expect(result.ranked).toHaveLength(0);
  });

  it("gridTable includes ALL configs — both passers and failers", () => {
    const grid = [
      { config: CONFIG_A, metrics: HEALTHY_METRICS },
      { config: CONFIG_B, metrics: FAILING_METRICS_MANY },
    ];
    const result = findBalancedConfig(grid);
    expect(result.gridTable).toHaveLength(2);
  });

  it("gridTable entries for passers have health.pass = true", () => {
    const grid = [
      { config: CONFIG_A, metrics: HEALTHY_METRICS },
      { config: CONFIG_B, metrics: FAILING_METRICS_MANY },
    ];
    const result = findBalancedConfig(grid);
    const passerEntry = result.gridTable.find((e) => e.config === CONFIG_A);
    expect(passerEntry).toBeDefined();
    expect(passerEntry!.health.pass).toBe(true);
    expect(passerEntry!.health.reasons).toHaveLength(0);
  });

  it("gridTable entries for failers have health.pass = false with reasons", () => {
    const grid = [
      { config: CONFIG_A, metrics: HEALTHY_METRICS },
      { config: CONFIG_B, metrics: FAILING_METRICS_MANY },
    ];
    const result = findBalancedConfig(grid);
    const failerEntry = result.gridTable.find((e) => e.config === CONFIG_B);
    expect(failerEntry).toBeDefined();
    expect(failerEntry!.health.pass).toBe(false);
    expect(failerEntry!.health.reasons.length).toBeGreaterThan(0);
  });

  it("gridTable entries carry the original metrics", () => {
    const grid = [
      { config: CONFIG_A, metrics: HEALTHY_METRICS },
    ];
    const result = findBalancedConfig(grid);
    expect(result.gridTable[0]!.metrics).toBe(HEALTHY_METRICS);
  });

  it("respects custom thresholds", () => {
    // HEALTHY_METRICS passes defaults. With a stricter threshold it should fail.
    const strictThresholds = {
      ...defaultHealthThresholds(),
      minIronVictory: 0.9, // 0.7 won't pass this
    };
    const grid = [{ config: CONFIG_A, metrics: HEALTHY_METRICS }];
    const result = findBalancedConfig(grid, { thresholds: strictThresholds });
    expect(result.recommended).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findBalancedConfig — nearest-misses ordering
// ---------------------------------------------------------------------------

describe("findBalancedConfig — nearest-misses (no passers)", () => {
  it("nearest-misses are ordered ascending by failing-reason count", () => {
    // FAILING_METRICS_ONE: 1 failing reason
    // FAILING_METRICS_TWO: 2 failing reasons
    // FAILING_METRICS_MANY: 5+ failing reasons
    const grid = [
      { config: CONFIG_A, metrics: FAILING_METRICS_MANY },   // most failures
      { config: CONFIG_B, metrics: FAILING_METRICS_ONE },    // fewest failures (1)
      { config: CONFIG_C, metrics: FAILING_METRICS_TWO },    // 2 failures
    ];
    const result = findBalancedConfig(grid);
    expect(result.recommended).toBeNull();
    expect(result.nearestMisses).toBeDefined();
    expect(result.nearestMisses!.length).toBeGreaterThanOrEqual(2);
    // First nearest miss should have the fewest failing reasons
    expect(result.nearestMisses![0]!.health.reasons.length).toBeLessThanOrEqual(
      result.nearestMisses![1]!.health.reasons.length,
    );
  });

  it("nearestMisses is undefined when there ARE passers", () => {
    const grid = [
      { config: CONFIG_A, metrics: HEALTHY_METRICS },
      { config: CONFIG_B, metrics: FAILING_METRICS_ONE },
    ];
    const result = findBalancedConfig(grid);
    expect(result.nearestMisses).toBeUndefined();
  });

  it("nearestMisses lists top-N failers by ascending reason count", () => {
    const grid = [
      { config: CONFIG_A, metrics: FAILING_METRICS_MANY },
      { config: CONFIG_B, metrics: FAILING_METRICS_ONE },
      { config: CONFIG_C, metrics: FAILING_METRICS_TWO },
      { config: CONFIG_D, metrics: FAILING_METRICS_MANY },
      { config: CONFIG_E, metrics: FAILING_METRICS_TWO },
    ];
    const result = findBalancedConfig(grid);
    // Nearest misses should have fewer failing reasons first
    const reasonCounts = result.nearestMisses!.map((nm) => nm.health.reasons.length);
    for (let i = 1; i < reasonCounts.length; i++) {
      expect(reasonCounts[i]!).toBeGreaterThanOrEqual(reasonCounts[i - 1]!);
    }
  });

  it("truncates nearestMisses to at most NEAREST_MISSES_COUNT (7+ failers)", () => {
    // 8 failers — more than the cap — none passing.
    const grid = [
      { config: CONFIG_A, metrics: FAILING_METRICS_ONE },
      { config: CONFIG_B, metrics: FAILING_METRICS_ONE },
      { config: CONFIG_C, metrics: FAILING_METRICS_TWO },
      { config: CONFIG_D, metrics: FAILING_METRICS_TWO },
      { config: CONFIG_E, metrics: FAILING_METRICS_MANY },
      { config: CONFIG_F, metrics: FAILING_METRICS_MANY },
      { config: CONFIG_G, metrics: FAILING_METRICS_ONE },
      { config: CONFIG_H, metrics: FAILING_METRICS_TWO },
    ];
    const result = findBalancedConfig(grid);
    expect(result.recommended).toBeNull();
    expect(result.nearestMisses).toBeDefined();
    expect(result.nearestMisses!.length).toBeLessThanOrEqual(NEAREST_MISSES_COUNT);
    // gridTable still holds ALL failers (the cap applies only to nearestMisses)
    expect(result.gridTable).toHaveLength(8);
  });

  it("tie-breaks equal-reason failers by descending composite score", () => {
    // Both metrics fail exactly ONE criterion (ironVictoryFraction), so they
    // tie on reasons.length; HIGH has the higher composite score and must
    // appear first.
    const grid = [
      { config: CONFIG_A, metrics: FAILING_ONE_LOW_SCORE },   // supplied first, lower score
      { config: CONFIG_B, metrics: FAILING_ONE_HIGH_SCORE },  // supplied second, higher score
    ];
    const result = findBalancedConfig(grid);
    expect(result.recommended).toBeNull();
    expect(result.nearestMisses).toBeDefined();
    // Both fail exactly one criterion
    expect(result.nearestMisses![0]!.health.reasons.length).toBe(1);
    expect(result.nearestMisses![1]!.health.reasons.length).toBe(1);
    // Higher composite score (CONFIG_B) ranks first despite being supplied second
    expect(result.nearestMisses![0]!.config).toBe(CONFIG_B);
    expect(result.nearestMisses![1]!.config).toBe(CONFIG_A);
  });

  it("nearestMisses is undefined when grid is empty", () => {
    const result = findBalancedConfig([]);
    expect(result.recommended).toBeNull();
    expect(result.ranked).toHaveLength(0);
    expect(result.gridTable).toHaveLength(0);
    expect(result.nearestMisses).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// balanceSweep — structural tests
// ---------------------------------------------------------------------------

describe("balanceSweep — structural tests (hand-built, no real games)", () => {
  /**
   * A minimal opts that doesn't run real games but instead returns
   * a deterministic SweepMetrics. We test the structural wiring.
   *
   * We can test balanceSweep's wiring by using a very small game count
   * and a known baseline config, asserting structural shape not specific values.
   */
  const SMALL_OPTS = {
    games: 2,
    turnCap: 5,
    baseSeed: 1n,
    playerCounts: [2],
  };

  it("returns an entry for each axis", () => {
    const baseline = defaultConfig();
    const result = balanceSweep(baseline, ["radius"], { radius: [4, 5] }, SMALL_OPTS);
    expect("radius" in result).toBe(true);
  });

  it("returns one entry per value for a single axis", () => {
    const baseline = defaultConfig();
    const result = balanceSweep(baseline, ["radius"], { radius: [4, 5, 6] }, SMALL_OPTS);
    expect(result.radius).toHaveLength(3);
  });

  it("each entry has the correct value and a metrics object", () => {
    const baseline = defaultConfig();
    const result = balanceSweep(baseline, ["radius"], { radius: [4, 5] }, SMALL_OPTS);
    expect(result.radius![0]!.value).toBe(4);
    expect(result.radius![1]!.value).toBe(5);
    expect(typeof result.radius![0]!.metrics.gamesPlayed).toBe("number");
  });

  it("skips an axis with no values entry", () => {
    const baseline = defaultConfig();
    // radius axis is requested but has no values in valuesPerAxis
    const result = balanceSweep(
      baseline,
      ["radius"],
      {},  // no values for radius
      SMALL_OPTS,
    );
    expect(result.radius).toBeUndefined();
  });

  it("skips an axis with an empty values array", () => {
    const baseline = defaultConfig();
    const result = balanceSweep(
      baseline,
      ["radius"],
      { radius: [] },
      SMALL_OPTS,
    );
    // sweepOFAT with empty values returns [] — axis should be absent or empty
    // Per S3 docs: empty values → empty result; we expose absence or empty array
    expect(result.radius === undefined || result.radius!.length === 0).toBe(true);
  });

  it("returns multiple axes independently", () => {
    const baseline = defaultConfig();
    const result = balanceSweep(
      baseline,
      ["radius", "victoryThreshold"],
      { radius: [4, 5], victoryThreshold: [8, 10, 12] },
      SMALL_OPTS,
    );
    expect(result.radius).toHaveLength(2);
    expect(result.victoryThreshold).toHaveLength(3);
  });

  it("is deterministic — same args produce same result", () => {
    const baseline = defaultConfig();
    const opts = { games: 3, turnCap: 8, baseSeed: 42n, playerCounts: [2] };
    const r1 = balanceSweep(baseline, ["radius"], { radius: [4, 5] }, opts);
    const r2 = balanceSweep(baseline, ["radius"], { radius: [4, 5] }, opts);
    expect(r1.radius![0]!.metrics.gamesPlayed).toBe(r2.radius![0]!.metrics.gamesPlayed);
    expect(r1.radius![0]!.metrics.medianTurns).toBe(r2.radius![0]!.metrics.medianTurns);
    expect(r1.radius![1]!.metrics.gamesPlayed).toBe(r2.radius![1]!.metrics.gamesPlayed);
  });
});

// ---------------------------------------------------------------------------
// report — pure markdown string builder tests
// ---------------------------------------------------------------------------

describe("report — markdown generation (hand-built fixtures)", () => {
  const HAND_GRIDTABLE: GridEntry[] = [
    {
      config: CONFIG_A,
      metrics: HEALTHY_METRICS,
      health: { pass: true, reasons: [] },
    },
    {
      config: CONFIG_B,
      metrics: FAILING_METRICS_ONE,
      health: { pass: false, reasons: ["ironVictoryFraction 0.3 < minIronVictory 0.5"] },
    },
  ];

  const HAND_RANKED = [
    {
      config: CONFIG_A,
      metrics: HEALTHY_METRICS,
      score: 0.72,
    },
  ];

  const HAND_BALANCE: BalanceResult = {
    radius: [
      { value: 4, metrics: makeMetrics({ medianTurns: 12 }) },
      { value: 5, metrics: makeMetrics({ medianTurns: 14 }) },
    ],
  };

  it("returns a non-empty string", () => {
    const result: FindResult = {
      recommended: HAND_RANKED[0]!,
      ranked: HAND_RANKED,
      gridTable: HAND_GRIDTABLE,
    };
    const md = report({ result, balance: HAND_BALANCE });
    expect(typeof md).toBe("string");
    expect(md.length).toBeGreaterThan(0);
  });

  it("includes a section for the recommended config when present", () => {
    const result: FindResult = {
      recommended: HAND_RANKED[0]!,
      ranked: HAND_RANKED,
      gridTable: HAND_GRIDTABLE,
    };
    const md = report({ result, balance: HAND_BALANCE });
    expect(md).toMatch(/recommended/i);
  });

  it("includes the grid health table section", () => {
    const result: FindResult = {
      recommended: HAND_RANKED[0]!,
      ranked: HAND_RANKED,
      gridTable: HAND_GRIDTABLE,
    };
    const md = report({ result, balance: HAND_BALANCE });
    expect(md).toMatch(/grid/i);
    // Should contain both pass and fail indicators
    expect(md).toMatch(/pass|PASS|✓|Yes/i);
  });

  it("includes balance-effect tables with axis names", () => {
    const result: FindResult = {
      recommended: HAND_RANKED[0]!,
      ranked: HAND_RANKED,
      gridTable: HAND_GRIDTABLE,
    };
    const md = report({ result, balance: HAND_BALANCE });
    expect(md).toMatch(/radius/i);
  });

  it("shows 'No healthy config found' when recommended is null", () => {
    const noPasserGrid: GridEntry[] = [
      {
        config: CONFIG_A,
        metrics: FAILING_METRICS_ONE,
        health: { pass: false, reasons: ["ironVictoryFraction 0.3 < minIronVictory 0.5"] },
      },
      {
        config: CONFIG_B,
        metrics: FAILING_METRICS_MANY,
        health: {
          pass: false,
          reasons: [
            "setupDecidedFraction 0.42 > maxSetupDecided 0.05",
            "ironVictoryFraction 0.12 < minIronVictory 0.5",
          ],
        },
      },
    ];

    const noPasserResult: FindResult = {
      recommended: null,
      ranked: [],
      gridTable: noPasserGrid,
      nearestMisses: [
        {
          config: CONFIG_A,
          metrics: FAILING_METRICS_ONE,
          health: { pass: false, reasons: ["ironVictoryFraction 0.3 < minIronVictory 0.5"] },
        },
      ],
    };
    const md = report({ result: noPasserResult, balance: HAND_BALANCE });
    expect(md).toMatch(/no healthy config found/i);
  });

  it("includes nearest-misses section when recommended is null", () => {
    const noPasserResult: FindResult = {
      recommended: null,
      ranked: [],
      gridTable: [
        {
          config: CONFIG_A,
          metrics: FAILING_METRICS_ONE,
          health: { pass: false, reasons: ["ironVictoryFraction 0.3 < minIronVictory 0.5"] },
        },
      ],
      nearestMisses: [
        {
          config: CONFIG_A,
          metrics: FAILING_METRICS_ONE,
          health: { pass: false, reasons: ["ironVictoryFraction 0.3 < minIronVictory 0.5"] },
        },
      ],
    };
    const md = report({ result: noPasserResult, balance: HAND_BALANCE });
    expect(md).toMatch(/nearest.miss/i);
  });

  it("is a pure function — same input produces identical output", () => {
    const result: FindResult = {
      recommended: HAND_RANKED[0]!,
      ranked: HAND_RANKED,
      gridTable: HAND_GRIDTABLE,
    };
    const md1 = report({ result, balance: HAND_BALANCE });
    const md2 = report({ result, balance: HAND_BALANCE });
    expect(md1).toBe(md2);
  });

  it("renders proportion metrics in the recommended section", () => {
    const result: FindResult = {
      recommended: HAND_RANKED[0]!,
      ranked: HAND_RANKED,
      gridTable: HAND_GRIDTABLE,
    };
    const md = report({ result, balance: HAND_BALANCE });
    // Should mention ironVictoryFraction or some proportion metric
    expect(md).toMatch(/iron|victory|fraction|median|turns/i);
  });

  it("renders both axis values in balance tables", () => {
    const result: FindResult = {
      recommended: HAND_RANKED[0]!,
      ranked: HAND_RANKED,
      gridTable: HAND_GRIDTABLE,
    };
    const md = report({ result, balance: HAND_BALANCE });
    // radius values 4 and 5 should appear
    expect(md).toMatch(/\b4\b/);
    expect(md).toMatch(/\b5\b/);
  });
});

// ---------------------------------------------------------------------------
// Real-grid smoke test
// ---------------------------------------------------------------------------

describe("findBalancedConfig — real-grid smoke (small, deterministic)", () => {
  it(
    "runs a small real grid deterministically and returns well-formed result",
    { timeout: 120_000 },
    () => {
      // Small grid: 2 victoryThreshold values × 2 boardSize values = 4 configs
      // Small game count and generous turn cap for speed
      const opts = {
        games: 20,
        turnCap: 30,
        baseSeed: 1n,
        playerCounts: [2, 3],
      };

      const grid = sweepGrid(
        {
          victoryThreshold: [8, 12],
          boardSize: [96, 126],
        },
        {},
        opts,
      );

      const result1 = findBalancedConfig(grid);
      const result2 = findBalancedConfig(grid);

      // Well-formed: ranked only contains passers
      for (const entry of result1.ranked) {
        expect(entry.score).toBeGreaterThanOrEqual(0);
        expect(entry.config).toBeDefined();
        expect(entry.metrics).toBeDefined();
      }

      // Well-formed: gridTable has all configs
      expect(result1.gridTable).toHaveLength(grid.length);

      // All gridTable entries have health.pass as a boolean
      for (const entry of result1.gridTable) {
        expect(typeof entry.health.pass).toBe("boolean");
        expect(Array.isArray(entry.health.reasons)).toBe(true);
      }

      // Deterministic: two calls with same grid produce same result
      expect(result1.recommended?.config).toEqual(result2.recommended?.config);
      expect(result1.ranked.length).toBe(result2.ranked.length);
      expect(result1.gridTable.length).toBe(result2.gridTable.length);

      // Log the smoke result (NOT a hard assertion on recommended !== null)
      const found = result1.recommended !== null;
      console.log(
        `[smoke] healthy config found: ${found}`,
        found
          ? `medianTurns=${result1.recommended!.metrics.medianTurns} score=${result1.recommended!.score.toFixed(3)}`
          : `nearest misses: ${result1.nearestMisses?.length ?? 0}, top reasons: ${result1.nearestMisses?.[0]?.health.reasons.slice(0, 2).join("; ") ?? "none"}`,
      );
    },
  );
});
