// ABOUTME: Tests for the sweep orchestrator + report — selection logic (structural), real-grid smoke, infeasibility guard, markdown report.
// ABOUTME: Seeds everything; small game counts + generous timeout; selection is hard-tested with injected metrics (no games run).

import { describe, expect, it } from "vitest";
import {
  findBalancedConfig,
  balanceSweep,
  selectBalanced,
  type GridEntry,
} from "../../src/sweep/orchestrate";
import { report } from "../../src/sweep/report";
import { defaultConfig, type RuleConfig } from "../../src/engine/config";
import { defaultHealthThresholds, isHealthy, type HealthThresholds } from "../../src/sweep/health";
import type { SweepMetrics } from "../../src/sweep/metrics";

// A SweepMetrics with all the gate-relevant fields set; everything else filled
// with inert defaults. `over` lets a test dial a single criterion.
function metrics(over: Partial<SweepMetrics> = {}): SweepMetrics {
  return {
    gamesPlayed: 100,
    turnsHistogram: {},
    medianTurns: 10,
    meanTurns: 10,
    victoryType: {},
    ironVictoryFraction: 0.8,
    noWinnerFraction: 0,
    capHitFraction: 0,
    setupDecidedFraction: 0,
    seatWinBias: 0.05,
    seatWinBiasByCount: {},
    leadVolatility: 0.5,
    ...over,
  };
}

function gridEntry(config: RuleConfig, m: SweepMetrics, t?: HealthThresholds): GridEntry {
  return { config, metrics: m, health: isHealthy(m, t) };
}

describe("selectBalanced (structural — no games run)", () => {
  it("recommends the top-composite passer; ranked excludes failers", () => {
    const t = defaultHealthThresholds();
    // Passer A: high leadVolatility -> higher composite.
    const passA = gridEntry({ ...defaultConfig(), boardSize: 96 }, metrics({ leadVolatility: 0.9 }), t);
    // Passer B: lower leadVolatility -> lower composite.
    const passB = gridEntry({ ...defaultConfig(), boardSize: 150 }, metrics({ leadVolatility: 0.4 }), t);
    // Failer: ironVictoryFraction below the minimum.
    const fail = gridEntry(
      { ...defaultConfig(), boardSize: 220 },
      metrics({ ironVictoryFraction: 0.1 }),
      t,
    );

    const { recommended, ranked } = selectBalanced([passB, fail, passA], t);

    expect(recommended).toEqual(passA.config);
    expect(ranked.map((r) => r.config)).toEqual([passA.config, passB.config]);
    // The failer is excluded entirely.
    expect(ranked.some((r) => r.config === fail.config)).toBe(false);
    // Composite is descending.
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
  });

  it("returns null recommended when NO entry passes", () => {
    const t = defaultHealthThresholds();
    const fail1 = gridEntry(defaultConfig(), metrics({ ironVictoryFraction: 0.1 }), t);
    const fail2 = gridEntry({ ...defaultConfig(), boardSize: 150 }, metrics({ setupDecidedFraction: 0.9 }), t);

    const { recommended, ranked } = selectBalanced([fail1, fail2], t);

    expect(recommended).toBeNull();
    expect(ranked).toEqual([]);
  });

  it("excludes a high-composite FAILER in favor of a lower-composite passer", () => {
    const t = defaultHealthThresholds();
    // This entry has the BEST composite inputs (huge leadVolatility, zero seat
    // bias, max iron) — but it FAILS the gate (capHitFraction over the cap), so
    // it must not be recommended.
    const highCompositeButFails = gridEntry(
      { ...defaultConfig(), boardSize: 300 },
      metrics({ leadVolatility: 1.0, seatWinBias: 0, ironVictoryFraction: 1.0, capHitFraction: 0.5 }),
      t,
    );
    // A genuine passer with a modest composite.
    const modestPasser = gridEntry(
      { ...defaultConfig(), boardSize: 96 },
      metrics({ leadVolatility: 0.3 }),
      t,
    );

    // Sanity: confirm the failer would outrank the passer on raw composite if it
    // weren't gated out (its inputs are strictly better).
    expect(highCompositeButFails.health.pass).toBe(false);
    expect(modestPasser.health.pass).toBe(true);

    const { recommended, ranked } = selectBalanced([highCompositeButFails, modestPasser], t);

    expect(recommended).toEqual(modestPasser.config);
    expect(ranked.map((r) => r.config)).toEqual([modestPasser.config]);
  });

  it("skips infeasible entries (metrics: null) without throwing", () => {
    const t = defaultHealthThresholds();
    const passer = gridEntry(defaultConfig(), metrics(), t);
    const infeasible: GridEntry = {
      config: { ...defaultConfig(), boardSize: 48, ironCount: 16 },
      metrics: null,
      health: { pass: false, reasons: ["infeasible: placeIron failed"] },
    };

    const { recommended, ranked } = selectBalanced([infeasible, passer], t);
    expect(recommended).toEqual(passer.config);
    expect(ranked.map((r) => r.config)).toEqual([passer.config]);
  });
});

// Small but real feasible geometry grid. boardSize 96 (~93 hexes) comfortably
// holds these iron counts under the iron-CSP spacing constraint.
const SMOKE_OPTS = { games: 24, turnCap: 30, baseSeed: 7000n, playerCounts: [2, 3] };
const SMOKE_AXES: Partial<Record<keyof RuleConfig, (number | boolean | string)[]>> = {
  boardSize: [96],
  radius: [2, 3],
  ironCount: [8, 10],
  victoryThreshold: [8, 10],
};

describe("findBalancedConfig — real-grid smoke (deterministic, no existence assertion)", () => {
  it("runs deterministically over a small feasible grid and returns a well-formed result", () => {
    const base = defaultConfig();
    const a = findBalancedConfig(SMOKE_AXES, base, { ...SMOKE_OPTS });
    const b = findBalancedConfig(SMOKE_AXES, base, { ...SMOKE_OPTS });

    // 1 * 2 * 2 * 2 = 8 configs in the grid.
    expect(a.grid.length).toBe(8);

    // Determinism: same inputs -> same recommended + grid + ranked.
    expect(a.recommended).toEqual(b.recommended);
    expect(a.grid).toEqual(b.grid);
    expect(a.ranked).toEqual(b.ranked);

    // ranked is exactly the set of PASSING grid entries (a subset).
    const passingConfigs = a.grid.filter((g) => g.health.pass).map((g) => g.config);
    expect(a.ranked.map((r) => r.config)).toEqual(
      expect.arrayContaining(passingConfigs),
    );
    expect(a.ranked.length).toBe(passingConfigs.length);

    // recommended is the top ranked passer, or null if none pass.
    if (a.ranked.length === 0) {
      expect(a.recommended).toBeNull();
    } else {
      expect(a.recommended).toEqual(a.ranked[0]!.config);
    }

    // Empirical signal for S5 (NOT an assertion): did the small grid contain a
    // healthy config?
    // eslint-disable-next-line no-console
    console.log(
      `[smoke] healthy config found in small grid? ${a.recommended !== null} ` +
        `(${a.ranked.length}/${a.grid.length} passed)`,
    );
    if (a.recommended !== null) {
      // eslint-disable-next-line no-console
      console.log("[smoke] recommended:", JSON.stringify(a.recommended), JSON.stringify(a.ranked[0]!.metrics));
    }
  }, 600_000);
});

describe("findBalancedConfig — infeasibility guard", () => {
  it("skips infeasible combos with metrics:null + an infeasible reason; feasible entries still process", () => {
    const base = defaultConfig();
    // boardSize 48 (~47 hexes) cannot hold 12 iron -> placeIron throws.
    // boardSize 96 with 8 iron is feasible.
    const result = findBalancedConfig(
      { boardSize: [48, 96], ironCount: [8, 12] },
      base,
      { games: 8, turnCap: 20, baseSeed: 8000n, playerCounts: [2] },
    );

    expect(result.grid.length).toBe(4);

    const infeasible = result.grid.filter((g) => g.metrics === null);
    const feasible = result.grid.filter((g) => g.metrics !== null);

    // At least the 48/12 combo is infeasible.
    expect(infeasible.length).toBeGreaterThanOrEqual(1);
    for (const e of infeasible) {
      expect(e.health.pass).toBe(false);
      expect(e.health.reasons.some((r) => r.startsWith("infeasible:"))).toBe(true);
    }

    // The 96/8 feasible combo still produced metrics.
    const ninetySixEight = result.grid.find(
      (g) => g.config.boardSize === 96 && g.config.ironCount === 8,
    );
    expect(ninetySixEight).toBeDefined();
    expect(ninetySixEight!.metrics).not.toBeNull();
    expect(ninetySixEight!.metrics!.gamesPlayed).toBe(8);

    // Infeasible entries are never recommended / ranked.
    for (const e of infeasible) {
      expect(result.ranked.some((r) => r.config === e.config)).toBe(false);
    }
  }, 120_000);

  it("invokes onProgress per cell, including infeasible cells (metrics null)", () => {
    const base = defaultConfig();
    const events: { done: number; total: number; isNull: boolean }[] = [];
    // 48/12 is infeasible (iron CSP) -> metrics null; the other three are feasible.
    const result = findBalancedConfig({ boardSize: [48, 96], ironCount: [8, 12] }, base, {
      games: 8,
      turnCap: 20,
      baseSeed: 8000n,
      playerCounts: [2],
      onProgress: (done, total, _config, metrics) => {
        events.push({ done, total, isNull: metrics === null });
      },
    });
    // One event per grid cell, done 1..N, total fixed at N.
    expect(events.length).toBe(result.grid.length);
    expect(events.map((e) => e.done)).toEqual(
      Array.from({ length: result.grid.length }, (_, i) => i + 1),
    );
    expect(events.every((e) => e.total === result.grid.length)).toBe(true);
    // The infeasible cell reported a null-metrics progress event (not skipped).
    expect(events.some((e) => e.isNull)).toBe(true);
  }, 120_000);
});

describe("balanceSweep", () => {
  it("runs OFAT for each axis keyed by axis name, deterministically", () => {
    const baseline = { ...defaultConfig(), boardSize: 96, ironCount: 8 };
    const opts = { games: 6, turnCap: 20, baseSeed: 9000n, playerCounts: [2] };
    const axes: (keyof RuleConfig)[] = ["victoryThreshold", "autoWinAt6"];
    const valuesPerAxis = {
      victoryThreshold: [8, 10],
      autoWinAt6: [true, false],
    };

    const a = balanceSweep(baseline, axes, valuesPerAxis, opts);
    const b = balanceSweep(baseline, axes, valuesPerAxis, opts);

    expect(Object.keys(a).sort()).toEqual(["autoWinAt6", "victoryThreshold"]);
    expect(a.victoryThreshold!.map((r) => r.value)).toEqual([8, 10]);
    expect(a.autoWinAt6!.map((r) => r.value)).toEqual([true, false]);
    for (const r of a.victoryThreshold!) {
      // These configs are feasible, so metrics is always non-null here.
      expect(r.metrics).not.toBeNull();
      expect(r.metrics!.gamesPlayed).toBe(6);
    }
    expect(a).toEqual(b);
  }, 120_000);

  it("invokes onProgress across all axis values with a flat running counter", () => {
    const baseline = { ...defaultConfig(), boardSize: 96, ironCount: 8 };
    const axes: (keyof RuleConfig)[] = ["victoryThreshold", "autoWinAt6"];
    const valuesPerAxis = { victoryThreshold: [8, 10], autoWinAt6: [true, false] };
    const dones: number[] = [];
    let seenTotal = -1;
    balanceSweep(baseline, axes, valuesPerAxis, {
      games: 6,
      turnCap: 20,
      baseSeed: 9000n,
      playerCounts: [2],
      onProgress: (done, total) => {
        dones.push(done);
        seenTotal = total;
      },
    });
    // 2 + 2 = 4 values total; the counter is flat across axes (1..4).
    expect(dones).toEqual([1, 2, 3, 4]);
    expect(seenTotal).toBe(4);
  }, 120_000);
});

describe("report", () => {
  const t = defaultHealthThresholds();

  function builtGrid(): GridEntry[] {
    const passer = gridEntry({ ...defaultConfig(), boardSize: 96 }, metrics({ leadVolatility: 0.9 }), t);
    const failer = gridEntry(
      { ...defaultConfig(), boardSize: 220 },
      metrics({ ironVictoryFraction: 0.1, leadVolatility: 0.1 }),
      t,
    );
    return [passer, failer];
  }

  it("renders a recommended-found report with config, grid table, and balance table", () => {
    const grid = builtGrid();
    const { recommended, ranked } = selectBalanced(grid, t);
    expect(recommended).not.toBeNull();

    const balance = {
      victoryThreshold: [
        { value: 8 as number | boolean | string, metrics: metrics({ ironVictoryFraction: 0.6 }) },
        { value: 10 as number | boolean | string, metrics: metrics({ ironVictoryFraction: 0.8 }) },
      ],
    };

    const md = report({
      recommended,
      ranked,
      grid,
      balance,
      gamesPerConfig: 100,
      thresholds: t,
    });

    expect(md.length).toBeGreaterThan(0);
    expect(md).toContain("Recommended");
    // The recommended config's key fields appear.
    expect(md).toContain("boardSize");
    expect(md).toContain("victoryThreshold");
    // Grid health table headers.
    expect(md).toContain("medianTurns");
    expect(md).toContain("PASS");
    expect(md).toContain("FAIL");
    // Balance section + axis name.
    expect(md.toLowerCase()).toContain("balance");
    expect(md).toContain("ironVictoryFraction");
  });

  it("renders a none-found report with nearest misses + their failing reasons", () => {
    const t2 = defaultHealthThresholds();
    const failer1 = gridEntry(
      defaultConfig(),
      metrics({ ironVictoryFraction: 0.1 }),
      t2,
    );
    const failer2 = gridEntry(
      { ...defaultConfig(), boardSize: 150 },
      metrics({ setupDecidedFraction: 0.9 }),
      t2,
    );
    const grid = [failer1, failer2];
    const { recommended, ranked } = selectBalanced(grid, t2);
    expect(recommended).toBeNull();
    expect(ranked).toEqual([]);

    const md = report({ recommended, ranked, grid, gamesPerConfig: 100, thresholds: t2 });

    expect(md.length).toBeGreaterThan(0);
    expect(md).toContain("No healthy config found");
    // A failing reason substring appears (the gate emits these).
    expect(md).toContain("ironVictoryFraction");
    expect(md).toContain("setupDecidedFraction");
  });
});
