// ABOUTME: Tests for isHealthy, scoreMetrics, and rankHealthy — the config-health gate, composite scorer, and ranker.
// ABOUTME: All fixtures are hand-built SweepMetrics; no actual games are run here.

import { describe, expect, it } from "vitest";
import {
  isHealthy,
  rankHealthy,
  scoreMetrics,
  defaultHealthThresholds,
} from "../../src/sweep/health";
import type { HealthThresholds } from "../../src/sweep/health";
import type { SweepMetrics } from "../../src/sweep/metrics";
import type { RuleConfig } from "../../src/index";
import { defaultConfig } from "../../src/index";

// ---------------------------------------------------------------------------
// Fixture helpers
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
  medianTurns: 14,                 // inside [3, 25], near center 14
  setupDecidedFraction: 0.02,      // < maxSetupDecided 0.05
  ironVictoryFraction: 0.7,        // > minIronVictory 0.5
  capHitFraction: 0.01,            // < maxCapHit 0.02
  seatWinBias: { maxBiasAcrossGroups: 0.10, byNPlayers: { 4: 0.10 } }, // < maxSeatBias 0.20
  leadVolatility: 0.4,             // > minLeadVolatility 0.2
});

/**
 * A degenerate SweepMetrics mimicking a setup-decided-heavy default config.
 * Fails ALL FIVE non-medianTurns criteria: setupDecidedFraction (too high),
 * ironVictoryFraction (too low), capHitFraction (too high), seatWinBias (too
 * high), and leadVolatility (too low). See the inline `→ FAIL` comments.
 */
const DEGENERATE_METRICS: SweepMetrics = makeMetrics({
  medianTurns: 3,                  // at the minimum — borderline
  setupDecidedFraction: 0.42,      // >> maxSetupDecided 0.05 → FAIL
  ironVictoryFraction: 0.12,       // << minIronVictory 0.5 → FAIL
  capHitFraction: 0.30,            // >> maxCapHit 0.02 → FAIL
  seatWinBias: { maxBiasAcrossGroups: 0.35, byNPlayers: { 4: 0.35 } }, // >> maxSeatBias 0.20 → FAIL
  leadVolatility: 0.1,             // < minLeadVolatility 0.2 → FAIL
});

// ---------------------------------------------------------------------------
// defaultHealthThresholds
// ---------------------------------------------------------------------------

describe("defaultHealthThresholds", () => {
  it("returns the documented starting values", () => {
    const t = defaultHealthThresholds();
    expect(t.minMedianTurns).toBe(3);
    expect(t.maxMedianTurns).toBe(25);
    expect(t.maxSetupDecided).toBeCloseTo(0.05);
    expect(t.minIronVictory).toBeCloseTo(0.5);
    expect(t.maxCapHit).toBeCloseTo(0.02);
    expect(t.maxSeatBias).toBeCloseTo(0.20);
    expect(t.minLeadVolatility).toBeCloseTo(0.2);
  });
});

// ---------------------------------------------------------------------------
// isHealthy — happy path
// ---------------------------------------------------------------------------

describe("isHealthy — passing config", () => {
  it("returns pass:true and empty reasons for a healthy metrics set", () => {
    const result = isHealthy(HEALTHY_METRICS);
    expect(result.pass).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("uses default thresholds when none are supplied", () => {
    const explicit = isHealthy(HEALTHY_METRICS, defaultHealthThresholds());
    const implicit = isHealthy(HEALTHY_METRICS);
    expect(explicit).toEqual(implicit);
  });
});

// ---------------------------------------------------------------------------
// isHealthy — degenerate / failing metrics
// ---------------------------------------------------------------------------

describe("isHealthy — degenerate metrics", () => {
  it("returns pass:false for metrics with multiple failing criteria", () => {
    const result = isHealthy(DEGENERATE_METRICS);
    expect(result.pass).toBe(false);
  });

  it("reports a reason for setupDecidedFraction exceeding maxSetupDecided", () => {
    const result = isHealthy(DEGENERATE_METRICS);
    const reason = result.reasons.find((r) => r.includes("setupDecidedFraction"));
    expect(reason).toBeDefined();
    expect(reason).toMatch(/0\.42/);
    expect(reason).toMatch(/maxSetupDecided/);
    expect(reason).toMatch(/0\.05/);
  });

  it("reports a reason for ironVictoryFraction below minIronVictory", () => {
    const result = isHealthy(DEGENERATE_METRICS);
    const reason = result.reasons.find((r) => r.includes("ironVictoryFraction"));
    expect(reason).toBeDefined();
    expect(reason).toMatch(/0\.12/);
    expect(reason).toMatch(/minIronVictory/);
    expect(reason).toMatch(/0\.5/);
  });

  it("reports a reason for capHitFraction exceeding maxCapHit", () => {
    const result = isHealthy(DEGENERATE_METRICS);
    const reason = result.reasons.find((r) => r.includes("capHitFraction"));
    expect(reason).toBeDefined();
    expect(reason).toMatch(/maxCapHit/);
  });

  it("reports a reason for seatWinBias.maxBiasAcrossGroups exceeding maxSeatBias", () => {
    const result = isHealthy(DEGENERATE_METRICS);
    const reason = result.reasons.find((r) => r.includes("seatWinBias"));
    expect(reason).toBeDefined();
    expect(reason).toMatch(/maxSeatBias/);
  });

  it("reports a reason for leadVolatility below minLeadVolatility", () => {
    const result = isHealthy(DEGENERATE_METRICS);
    const reason = result.reasons.find((r) => r.includes("leadVolatility"));
    expect(reason).toBeDefined();
    expect(reason).toMatch(/minLeadVolatility/);
  });

  it("lists all failed criteria (not just the first)", () => {
    const result = isHealthy(DEGENERATE_METRICS);
    // We know degenerate fails on at least: setupDecided, ironVictory, capHit, seatBias, leadVolatility
    expect(result.reasons.length).toBeGreaterThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// isHealthy — individual threshold boundary tests
// ---------------------------------------------------------------------------

describe("isHealthy — medianTurns boundaries", () => {
  it("fails when medianTurns is below minMedianTurns", () => {
    const m = makeMetrics({ medianTurns: 2 });
    const result = isHealthy(m);
    expect(result.pass).toBe(false);
    const reason = result.reasons.find((r) => r.includes("medianTurns"));
    expect(reason).toBeDefined();
    expect(reason).toMatch(/minMedianTurns/);
  });

  it("fails when medianTurns is above maxMedianTurns", () => {
    const m = makeMetrics({ medianTurns: 26 });
    const result = isHealthy(m);
    expect(result.pass).toBe(false);
    const reason = result.reasons.find((r) => r.includes("medianTurns"));
    expect(reason).toBeDefined();
    expect(reason).toMatch(/maxMedianTurns/);
  });

  it("passes when medianTurns equals minMedianTurns (inclusive lower bound)", () => {
    const m = makeMetrics({ medianTurns: 3 });
    const result = isHealthy(m);
    // makeMetrics defaults pass all other criteria; only medianTurns is at the boundary
    expect(result.reasons.some((r) => r.includes("medianTurns"))).toBe(false);
  });

  it("passes when medianTurns equals maxMedianTurns (inclusive upper bound)", () => {
    const m = makeMetrics({ medianTurns: 25 });
    const result = isHealthy(m);
    expect(result.reasons.some((r) => r.includes("medianTurns"))).toBe(false);
  });
});

describe("isHealthy — seatWinBias uses maxBiasAcrossGroups, not the object", () => {
  it("fails when maxBiasAcrossGroups exceeds maxSeatBias", () => {
    const m = makeMetrics({
      seatWinBias: { maxBiasAcrossGroups: 0.25, byNPlayers: { 4: 0.25 } },
    });
    const result = isHealthy(m);
    expect(result.pass).toBe(false);
    const reason = result.reasons.find((r) => r.includes("seatWinBias"));
    expect(reason).toBeDefined();
  });

  it("passes when maxBiasAcrossGroups is at or below maxSeatBias", () => {
    const m = makeMetrics({
      seatWinBias: { maxBiasAcrossGroups: 0.20, byNPlayers: { 4: 0.20 } },
    });
    const result = isHealthy(m);
    expect(result.reasons.some((r) => r.includes("seatWinBias"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isHealthy — custom thresholds
// ---------------------------------------------------------------------------

describe("isHealthy — custom thresholds", () => {
  it("respects custom thresholds that differ from defaults", () => {
    const strictThresholds: HealthThresholds = {
      ...defaultHealthThresholds(),
      maxSetupDecided: 0.01, // stricter than 0.05
    };
    // HEALTHY_METRICS has setupDecidedFraction: 0.02, which passes 0.05 but fails 0.01
    const result = isHealthy(HEALTHY_METRICS, strictThresholds);
    expect(result.pass).toBe(false);
    expect(result.reasons.some((r) => r.includes("setupDecidedFraction"))).toBe(true);
  });

  it("passes with relaxed thresholds that cover borderline metrics", () => {
    const relaxed: HealthThresholds = {
      ...defaultHealthThresholds(),
      maxSetupDecided: 0.50,
      minIronVictory: 0.10,
      maxCapHit: 0.35,
      maxSeatBias: 0.40,
      minLeadVolatility: 0.05,
    };
    const result = isHealthy(DEGENERATE_METRICS, relaxed);
    expect(result.pass).toBe(true);
    expect(result.reasons).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// rankHealthy
// ---------------------------------------------------------------------------

/** A minimal RuleConfig stand-in — rankHealthy carries it through opaquely. */
const CONFIG_A: RuleConfig = defaultConfig();
const CONFIG_B: RuleConfig = { ...defaultConfig(), radius: 4 };
const CONFIG_C: RuleConfig = { ...defaultConfig(), radius: 3 };
const CONFIG_D: RuleConfig = { ...defaultConfig(), radius: 2 }; // will be made failing

describe("rankHealthy — filters failers", () => {
  it("excludes configs whose metrics fail the health gate", () => {
    const input = [
      { config: CONFIG_A, metrics: HEALTHY_METRICS },
      { config: CONFIG_D, metrics: DEGENERATE_METRICS },
    ];
    const output = rankHealthy(input);
    expect(output).toHaveLength(1);
    expect(output[0]!.config).toBe(CONFIG_A);
  });

  it("returns empty array when all configs are unhealthy", () => {
    const input = [
      { config: CONFIG_A, metrics: DEGENERATE_METRICS },
      { config: CONFIG_B, metrics: DEGENERATE_METRICS },
    ];
    expect(rankHealthy(input)).toHaveLength(0);
  });

  it("returns all configs when all are healthy", () => {
    const input = [
      { config: CONFIG_A, metrics: HEALTHY_METRICS },
      { config: CONFIG_B, metrics: HEALTHY_METRICS },
    ];
    expect(rankHealthy(input)).toHaveLength(2);
  });
});

describe("rankHealthy — composite ordering", () => {
  /**
   * Craft three configs with distinct score drivers so we can assert order:
   *   BEST:   high leadVolatility, low seatBias, high ironVictory, medianTurns near center
   *   MIDDLE: moderate on all dimensions
   *   WORST:  low leadVolatility, higher seatBias, lower ironVictory, medianTurns at edge
   * Band center = (3 + 25) / 2 = 14.
   */
  const METRICS_BEST: SweepMetrics = makeMetrics({
    medianTurns: 14,               // exactly at band center → max proximity score
    leadVolatility: 0.9,           // maximum
    seatWinBias: { maxBiasAcrossGroups: 0.01, byNPlayers: {} }, // minimum bias
    ironVictoryFraction: 0.95,     // near max
    setupDecidedFraction: 0.01,
    capHitFraction: 0.005,
  });

  const METRICS_MIDDLE: SweepMetrics = makeMetrics({
    medianTurns: 10,               // off-center
    leadVolatility: 0.5,
    seatWinBias: { maxBiasAcrossGroups: 0.10, byNPlayers: {} },
    ironVictoryFraction: 0.7,
    setupDecidedFraction: 0.02,
    capHitFraction: 0.01,
  });

  const METRICS_WORST: SweepMetrics = makeMetrics({
    medianTurns: 4,                // near the low end of the band
    leadVolatility: 0.25,          // barely above threshold
    seatWinBias: { maxBiasAcrossGroups: 0.18, byNPlayers: {} }, // near limit
    ironVictoryFraction: 0.55,     // barely above threshold
    setupDecidedFraction: 0.04,
    capHitFraction: 0.015,
  });

  it("ranks 3 passing configs best-first by composite score", () => {
    // Shuffle the input order to prove ranking, not insertion order
    const input = [
      { config: CONFIG_C, metrics: METRICS_WORST },
      { config: CONFIG_A, metrics: METRICS_BEST },
      { config: CONFIG_B, metrics: METRICS_MIDDLE },
    ];
    const output = rankHealthy(input);
    expect(output).toHaveLength(3);
    expect(output[0]!.config).toBe(CONFIG_A); // BEST
    expect(output[1]!.config).toBe(CONFIG_B); // MIDDLE
    expect(output[2]!.config).toBe(CONFIG_C); // WORST
  });

  it("includes a numeric score in each output element", () => {
    const input = [{ config: CONFIG_A, metrics: METRICS_BEST }];
    const output = rankHealthy(input);
    expect(typeof output[0]!.score).toBe("number");
    expect(Number.isFinite(output[0]!.score)).toBe(true);
  });

  it("produces strictly decreasing scores (best > middle > worst)", () => {
    const input = [
      { config: CONFIG_A, metrics: METRICS_BEST },
      { config: CONFIG_B, metrics: METRICS_MIDDLE },
      { config: CONFIG_C, metrics: METRICS_WORST },
    ];
    const output = rankHealthy(input);
    expect(output[0]!.score).toBeGreaterThan(output[1]!.score);
    expect(output[1]!.score).toBeGreaterThan(output[2]!.score);
  });

  it("a failing config NEVER outranks a passing one (failers excluded entirely)", () => {
    const input = [
      // DEGENERATE has many good-looking raw numbers but fails gates
      { config: CONFIG_D, metrics: DEGENERATE_METRICS },
      { config: CONFIG_A, metrics: METRICS_WORST }, // barely passing
    ];
    const output = rankHealthy(input);
    // Only the passing config should appear
    expect(output).toHaveLength(1);
    expect(output[0]!.config).toBe(CONFIG_A);
  });
});

describe("rankHealthy — tie stability", () => {
  it("preserves input order for configs with equal composite scores", () => {
    // Two passing entries with IDENTICAL metrics → identical composite scores,
    // but distinguishable config identity, supplied in a known input order.
    // A stable sort must leave their relative order untouched; this guards
    // against a future unstable sort or an order-perturbing tiebreaker.
    const input = [
      { config: CONFIG_A, metrics: HEALTHY_METRICS },
      { config: CONFIG_B, metrics: HEALTHY_METRICS },
    ];
    const output = rankHealthy(input);
    expect(output).toHaveLength(2);
    // (a) scores are in fact tied
    expect(output[0]!.score).toBe(output[1]!.score);
    // (b) input order is preserved among the tied entries
    expect(output[0]!.config).toBe(CONFIG_A);
    expect(output[1]!.config).toBe(CONFIG_B);
  });
});

// ---------------------------------------------------------------------------
// scoreMetrics — the canonical composite formula (single source of truth)
// ---------------------------------------------------------------------------

describe("scoreMetrics — exact formula", () => {
  it("computes the documented hand-checked composite for a crafted metrics", () => {
    // Defaults: minMedianTurns=3, maxMedianTurns=25 → bandCenter=14, halfWidth=11.
    // medianTurns=14 → turnProximity = 1 (exactly at band center).
    //   0.25 * leadVolatility(0.4)          = 0.100
    //   0.25 * (1 − seatBias(0.10))         = 0.225
    //   0.25 * ironVictoryFraction(0.8)     = 0.200
    //   0.25 * turnProximity(1)             = 0.250
    //                                  total = 0.775
    const m = makeMetrics({
      medianTurns: 14,
      leadVolatility: 0.4,
      seatWinBias: { maxBiasAcrossGroups: 0.10, byNPlayers: {} },
      ironVictoryFraction: 0.8,
    });
    expect(scoreMetrics(m, defaultHealthThresholds())).toBeCloseTo(0.775, 10);
  });

  it("yields full turnProximity (1) at the band center", () => {
    // At bandCenter the only varying term is turnProximity=1; everything else 0.
    const m = makeMetrics({
      medianTurns: 14,
      leadVolatility: 0,
      seatWinBias: { maxBiasAcrossGroups: 1, byNPlayers: {} }, // (1 − 1) = 0
      ironVictoryFraction: 0,
    });
    expect(scoreMetrics(m, defaultHealthThresholds())).toBeCloseTo(0.25, 10);
  });

  it("yields zero turnProximity at the band edge", () => {
    // medianTurns = maxMedianTurns(25) → |25 − 14| / 11 = 1 → turnProximity = 0.
    const m = makeMetrics({
      medianTurns: 25,
      leadVolatility: 0,
      seatWinBias: { maxBiasAcrossGroups: 1, byNPlayers: {} },
      ironVictoryFraction: 0,
    });
    expect(scoreMetrics(m, defaultHealthThresholds())).toBeCloseTo(0, 10);
  });

  it("rises with higher leadVolatility (other terms held)", () => {
    const base = makeMetrics({ medianTurns: 14, leadVolatility: 0.3 });
    const higher = makeMetrics({ medianTurns: 14, leadVolatility: 0.8 });
    const t = defaultHealthThresholds();
    expect(scoreMetrics(higher, t)).toBeGreaterThan(scoreMetrics(base, t));
  });

  it("rises with higher ironVictoryFraction (other terms held)", () => {
    const base = makeMetrics({ medianTurns: 14, ironVictoryFraction: 0.4 });
    const higher = makeMetrics({ medianTurns: 14, ironVictoryFraction: 0.9 });
    const t = defaultHealthThresholds();
    expect(scoreMetrics(higher, t)).toBeGreaterThan(scoreMetrics(base, t));
  });

  it("rises with lower seatWinBias (other terms held)", () => {
    const lowerBias = makeMetrics({
      medianTurns: 14,
      seatWinBias: { maxBiasAcrossGroups: 0.05, byNPlayers: {} },
    });
    const higherBias = makeMetrics({
      medianTurns: 14,
      seatWinBias: { maxBiasAcrossGroups: 0.30, byNPlayers: {} },
    });
    const t = defaultHealthThresholds();
    expect(scoreMetrics(lowerBias, t)).toBeGreaterThan(scoreMetrics(higherBias, t));
  });

  it("rises with medianTurns nearer the band center (other terms held)", () => {
    const nearCenter = makeMetrics({ medianTurns: 14 }); // proximity 1
    const nearEdge = makeMetrics({ medianTurns: 24 });   // proximity ~0.09
    const t = defaultHealthThresholds();
    expect(scoreMetrics(nearCenter, t)).toBeGreaterThan(scoreMetrics(nearEdge, t));
  });

  it("returns full turnProximity for a degenerate band (min === max)", () => {
    // halfWidth = 0 → turnProximity = 1 regardless of medianTurns.
    const degenerateBand: HealthThresholds = {
      ...defaultHealthThresholds(),
      minMedianTurns: 10,
      maxMedianTurns: 10,
    };
    const m = makeMetrics({
      medianTurns: 999,                                  // far from "center" but band has no width
      leadVolatility: 0,
      seatWinBias: { maxBiasAcrossGroups: 1, byNPlayers: {} },
      ironVictoryFraction: 0,
    });
    // Only turnProximity contributes: 0.25 * 1 = 0.25.
    expect(scoreMetrics(m, degenerateBand)).toBeCloseTo(0.25, 10);
  });

  it("rankHealthy ranks passers identically to direct scoreMetrics ordering", () => {
    // Regression anchor: the ranker's score MUST equal scoreMetrics for each entry,
    // proving the extraction did not change rankHealthy's behavior.
    const t = defaultHealthThresholds();
    const input = [
      { config: CONFIG_A, metrics: HEALTHY_METRICS },
    ];
    const ranked = rankHealthy(input, t);
    expect(ranked[0]!.score).toBe(scoreMetrics(HEALTHY_METRICS, t));
  });
});
