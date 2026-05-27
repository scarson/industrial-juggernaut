// ABOUTME: Tests that the parallel entry points equal their serial counterparts — the load-bearing determinism invariant.
// ABOUTME: runConfigParallel == runConfig and roundRobinParallel == roundRobin, bit-for-bit, across worker counts.

import { describe, expect, it } from "vitest";
import { runConfigParallel, roundRobinParallel, type NamedAgentSpec } from "../../src/sweep/run-parallel";
import { runConfig } from "../../src/sweep/run";
import { roundRobin, type NamedAgent } from "../../src/eval/arena";
import { GamePool } from "../../src/sweep/pool";
import { heuristicAgent } from "../../src/agent/heuristic-agent";
import { greedyAgent } from "../../src/agent/agent";
import { defaultConfig } from "../../src/engine/config";

const config = { ...defaultConfig(), boardSize: 72, ironCount: 6 };

describe("runConfigParallel == runConfig", () => {
  it("produces identical SweepMetrics to the serial path (heuristic, 2-3P)", async () => {
    const base = { games: 12, turnCap: 25, baseSeed: 1000n, playerCounts: [2, 3] };
    const serial = runConfig(config, { ...base, agentFactory: () => heuristicAgent() });
    const pool = new GamePool(3);
    let parallel;
    try {
      parallel = await runConfigParallel(config, { ...base, agentSpec: { kind: "heuristic" } }, pool);
    } finally {
      pool.close();
    }
    expect(parallel).toEqual(serial);
  }, 60_000);
});

describe("roundRobinParallel == roundRobin", () => {
  it("produces identical winRates/elo/gamesPlayed/headToHead to the serial arena", async () => {
    const opts = { playerCounts: [2], gamesPerMatchup: 10, seed: 5n, config, turnCap: 100 };
    const named: NamedAgent[] = [
      { name: "a", agent: greedyAgent("aggressive") },
      { name: "b", agent: greedyAgent("economic") },
    ];
    const serial = roundRobin(named, opts);

    const specs: NamedAgentSpec[] = [
      { name: "a", spec: { kind: "greedy", archetype: "aggressive" } },
      { name: "b", spec: { kind: "greedy", archetype: "economic" } },
    ];
    const pool = new GamePool(3);
    let parallel;
    try {
      parallel = await roundRobinParallel(specs, opts, pool);
    } finally {
      pool.close();
    }

    expect(parallel.winRates).toEqual(serial.winRates);
    expect(parallel.elo).toEqual(serial.elo);
    expect(parallel.gamesPlayed).toEqual(serial.gamesPlayed);
    expect(parallel.headToHead).toEqual(serial.headToHead);
  }, 60_000);
});
