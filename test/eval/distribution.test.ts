// ABOUTME: Tests for heuristicAgent (legal + deterministic) and the instrumented measureDistribution run.
// ABOUTME: Seeded/deterministic; the measurement test asserts structural shape and console.logs the distribution.

import { describe, expect, it } from "vitest";
import { mkState } from "../helpers/state";
import { hex } from "../../src/geometry/cube";
import { applyAction } from "../../src/engine/apply";
import { defaultConfig } from "../../src/engine/config";
import { heuristicAgent } from "../../src/agent/heuristic-agent";
import { measureDistribution } from "../../src/eval/measure";

/** A 3-base radiating P0 controlling iron with room to expand. */
function fixture() {
  const cfg = { ...defaultConfig(), placeRange: 2, radius: 2 };
  return mkState({
    board: 96,
    basesP0: [hex(-1, 1, 0), hex(0, 0, 0), hex(1, -1, 0)],
    basesP1: [hex(-9, 9, 0)],
    iron: [hex(0, 0, 0)],
    config: cfg,
  });
}

describe("heuristicAgent", () => {
  it("returns an applyAction-acceptable action", () => {
    const state = fixture();
    const { action } = heuristicAgent()(state, 0);
    // applyAction throws on an illegal action; reaching the assertion means it accepted.
    expect(() => applyAction(state, action)).not.toThrow();
  });

  it("is deterministic given the state's rng", () => {
    const state = fixture();
    const a = heuristicAgent()(state, 0);
    const b = heuristicAgent()(state, 0);
    expect(JSON.stringify(a.action)).toBe(JSON.stringify(b.action));
    // The threaded rng must also be identical.
    expect(a.state.rngState).toEqual(b.state.rngState);
  });
});

describe("measureDistribution — heuristic-greedy across 2-6P", () => {
  it("produces a well-formed distribution and logs it", () => {
    const games = 200;
    const dist = measureDistribution({
      games,
      turnCap: 300,
      agentFor: () => heuristicAgent(),
      baseSeed: 1n,
    });

    // Structural shape: all fields present.
    expect(dist.byVictoryType).toBeDefined();
    expect(typeof dist.emptyWinner).toBe("number");
    expect(typeof dist.realWinner).toBe("number");
    expect(dist.turnsHistogram).toBeDefined();
    expect(typeof dist.capHits).toBe("number");
    expect(typeof dist.ironVictories).toBe("number");

    // Victory types are a subset of the known kinds.
    const allowed = new Set(["iron", "last-standing", "none"]);
    for (const k of Object.keys(dist.byVictoryType)) {
      expect(allowed.has(k)).toBe(true);
    }

    // Every game terminated at a turn >= 1.
    for (const t of Object.keys(dist.turnsHistogram)) {
      expect(Number(t)).toBeGreaterThanOrEqual(1);
    }

    // Every game is accounted for exactly once across the winner partition.
    expect(dist.emptyWinner + dist.realWinner).toBe(games);

    // Investigation output (the key deliverable): the full distribution + turns histogram.
    // eslint-disable-next-line no-console
    console.log(
      "[distribution] games:",
      games,
      "byVictoryType:",
      dist.byVictoryType,
      "emptyWinner:",
      dist.emptyWinner,
      "realWinner:",
      dist.realWinner,
      "ironVictories:",
      dist.ironVictories,
      "capHits:",
      dist.capHits,
    );
    // eslint-disable-next-line no-console
    console.log("[distribution] turnsHistogram:", dist.turnsHistogram);
  }, 120_000);
});
