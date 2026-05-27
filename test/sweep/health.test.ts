// ABOUTME: Tests for the config-health gate (isHealthy) + composite rank (rankHealthy) over hand-built SweepMetrics.
// ABOUTME: Pure/deterministic; crafted metrics verify per-criterion gating, reason strings, and passer-only ranking.

import { describe, expect, it } from "vitest";
import {
  defaultHealthThresholds,
  isHealthy,
  rankHealthy,
  type HealthThresholds,
} from "../../src/sweep/health";
import type { SweepMetrics } from "../../src/sweep/metrics";
import { defaultConfig, type RuleConfig } from "../../src/engine/config";

/**
 * Build a SweepMetrics with all-healthy defaults; override only the fields a
 * test cares about. The six gated fields (medianTurns, setupDecidedFraction,
 * ironVictoryFraction, capHitFraction, seatWinBias, leadVolatility) default to
 * values comfortably inside the default thresholds.
 */
function mkMetrics(overrides: Partial<SweepMetrics> = {}): SweepMetrics {
  return {
    gamesPlayed: 100,
    turnsHistogram: {},
    medianTurns: 8,
    meanTurns: 8,
    victoryType: {},
    ironVictoryFraction: 0.7,
    noWinnerFraction: 0,
    capHitFraction: 0,
    setupDecidedFraction: 0,
    seatWinBias: 0.1,
    seatWinBiasByCount: {},
    leadVolatility: 0.4,
    ...overrides,
  };
}

describe("defaultHealthThresholds", () => {
  it("returns the documented provisional starting values", () => {
    expect(defaultHealthThresholds()).toEqual({
      minMedianTurns: 3,
      maxMedianTurns: 25,
      maxSetupDecided: 0.05,
      minIronVictory: 0.5,
      maxCapHit: 0.02,
      maxSeatBias: 0.2,
      minLeadVolatility: 0.2,
    });
  });
});

describe("isHealthy", () => {
  it("FAILS the current degenerate default with median/setupDecided/leadVolatility reasons", () => {
    // The current broken default: decided at setup/turn-1 — short games, all
    // iron wins, but no depth and no swing.
    const degenerate = mkMetrics({
      medianTurns: 1,
      setupDecidedFraction: 0.24,
      ironVictoryFraction: 1.0,
      capHitFraction: 0,
      seatWinBias: 0.1,
      leadVolatility: 0.0,
    });
    const { pass, reasons } = isHealthy(degenerate);
    expect(pass).toBe(false);
    expect(reasons.some((r) => /median/i.test(r))).toBe(true);
    expect(reasons.some((r) => /setup/i.test(r))).toBe(true);
    expect(reasons.some((r) => /lead.?volatility|volatility/i.test(r))).toBe(true);
    // ironVictory is fine here (1.0 ≥ 0.5), so it must NOT appear.
    expect(reasons.some((r) => /iron/i.test(r))).toBe(false);
  });

  it("PASSES a hand-built healthy config with empty reasons", () => {
    const healthy = mkMetrics({
      medianTurns: 8,
      setupDecidedFraction: 0.0,
      ironVictoryFraction: 0.7,
      capHitFraction: 0,
      seatWinBias: 0.1,
      leadVolatility: 0.4,
    });
    const { pass, reasons } = isHealthy(healthy);
    expect(pass).toBe(true);
    expect(reasons).toEqual([]);
  });

  describe("each criterion independently gates", () => {
    it("median turns below the band fails with only the median reason", () => {
      const { pass, reasons } = isHealthy(mkMetrics({ medianTurns: 2 }));
      expect(pass).toBe(false);
      expect(reasons).toHaveLength(1);
      expect(reasons[0]).toMatch(/median/i);
    });

    it("median turns above the band fails with only the median reason", () => {
      const { pass, reasons } = isHealthy(mkMetrics({ medianTurns: 30 }));
      expect(pass).toBe(false);
      expect(reasons).toHaveLength(1);
      expect(reasons[0]).toMatch(/median/i);
    });

    it("setupDecided over the max fails with only the setup reason", () => {
      const { pass, reasons } = isHealthy(mkMetrics({ setupDecidedFraction: 0.1 }));
      expect(pass).toBe(false);
      expect(reasons).toHaveLength(1);
      expect(reasons[0]).toMatch(/setup/i);
    });

    it("ironVictory under the min fails with only the iron reason", () => {
      const { pass, reasons } = isHealthy(mkMetrics({ ironVictoryFraction: 0.3 }));
      expect(pass).toBe(false);
      expect(reasons).toHaveLength(1);
      expect(reasons[0]).toMatch(/iron/i);
    });

    it("capHit over the max fails with only the cap reason", () => {
      const { pass, reasons } = isHealthy(mkMetrics({ capHitFraction: 0.1 }));
      expect(pass).toBe(false);
      expect(reasons).toHaveLength(1);
      expect(reasons[0]).toMatch(/cap/i);
    });

    it("seatBias over the max fails with only the seat reason", () => {
      const { pass, reasons } = isHealthy(mkMetrics({ seatWinBias: 0.3 }));
      expect(pass).toBe(false);
      expect(reasons).toHaveLength(1);
      expect(reasons[0]).toMatch(/seat|bias/i);
    });

    it("leadVolatility under the min fails with only the volatility reason", () => {
      const { pass, reasons } = isHealthy(mkMetrics({ leadVolatility: 0.1 }));
      expect(pass).toBe(false);
      expect(reasons).toHaveLength(1);
      expect(reasons[0]).toMatch(/volatility/i);
    });
  });

  it("treats band edges as inclusive", () => {
    // min/max medianTurns, exact thresholds — all inclusive boundaries pass.
    const onEdges = mkMetrics({
      medianTurns: 3, // == minMedianTurns
      setupDecidedFraction: 0.05, // == maxSetupDecided
      ironVictoryFraction: 0.5, // == minIronVictory
      capHitFraction: 0.02, // == maxCapHit
      seatWinBias: 0.2, // == maxSeatBias
      leadVolatility: 0.2, // == minLeadVolatility
    });
    expect(isHealthy(onEdges).pass).toBe(true);
    expect(isHealthy(mkMetrics({ medianTurns: 25 })).pass).toBe(true); // == maxMedianTurns
  });

  it("honors custom thresholds when provided", () => {
    const strict: HealthThresholds = {
      ...defaultHealthThresholds(),
      minLeadVolatility: 0.5,
    };
    // leadVolatility 0.4 passes the default (0.2) but fails the strict (0.5).
    expect(isHealthy(mkMetrics({ leadVolatility: 0.4 })).pass).toBe(true);
    const { pass, reasons } = isHealthy(mkMetrics({ leadVolatility: 0.4 }), strict);
    expect(pass).toBe(false);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/volatility/i);
  });
});

describe("rankHealthy", () => {
  function cfg(overrides: Partial<RuleConfig> = {}): RuleConfig {
    return { ...defaultConfig(), ...overrides };
  }

  it("filters out failers and orders passers by the composite (best first)", () => {
    // Two passers: passerStrong has higher leadVolatility + lower seatBias, so
    // it ranks ahead of passerWeak. One failer that would score high on the
    // composite (huge leadVolatility) but FAILS the gate (setupDecided too high)
    // — it must never appear.
    const passerStrong = cfg({ radius: 3 });
    const passerWeak = cfg({ radius: 4 });
    const failer = cfg({ radius: 2 });

    const scored = [
      {
        config: passerWeak,
        metrics: mkMetrics({ leadVolatility: 0.3, seatWinBias: 0.18, ironVictoryFraction: 0.6 }),
      },
      {
        config: failer,
        metrics: mkMetrics({
          leadVolatility: 0.99,
          seatWinBias: 0.0,
          ironVictoryFraction: 0.99,
          setupDecidedFraction: 0.5, // fails the gate
        }),
      },
      {
        config: passerStrong,
        metrics: mkMetrics({ leadVolatility: 0.5, seatWinBias: 0.05, ironVictoryFraction: 0.8 }),
      },
    ];

    const ranked = rankHealthy(scored);
    expect(ranked.map((r) => r.config)).toEqual([passerStrong, passerWeak]);
    // The failer is excluded even though its composite would top the list.
    expect(ranked.some((r) => r.config === failer)).toBe(false);
    // Scores are descending and a number is attached.
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
  });

  it("returns an empty array when no config passes the gate", () => {
    const scored = [
      { config: cfg(), metrics: mkMetrics({ medianTurns: 1, leadVolatility: 0 }) },
      { config: cfg({ radius: 3 }), metrics: mkMetrics({ setupDecidedFraction: 0.9 }) },
    ];
    expect(rankHealthy(scored)).toEqual([]);
  });

  it("honors custom thresholds when ranking", () => {
    const strict: HealthThresholds = { ...defaultHealthThresholds(), minIronVictory: 0.75 };
    const a = cfg({ radius: 3 });
    const b = cfg({ radius: 4 });
    const scored = [
      { config: a, metrics: mkMetrics({ ironVictoryFraction: 0.6 }) }, // fails strict
      { config: b, metrics: mkMetrics({ ironVictoryFraction: 0.8 }) }, // passes strict
    ];
    const ranked = rankHealthy(scored, strict);
    expect(ranked.map((r) => r.config)).toEqual([b]);
  });
});
