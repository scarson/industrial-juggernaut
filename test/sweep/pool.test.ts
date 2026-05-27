// ABOUTME: Tests for GamePool — the parallel worker pool MUST reproduce serial runOneGame records byte-for-byte.
// ABOUTME: Determinism is the load-bearing invariant; results return in submission order regardless of which worker ran them.

import { describe, expect, it } from "vitest";
import { GamePool, type SimJob } from "../../src/sweep/pool";
import { runOneGame, perGameSeed } from "../../src/sweep/run";
import { heuristicAgent } from "../../src/agent/heuristic-agent";
import { defaultConfig } from "../../src/engine/config";

const config = { ...defaultConfig(), boardSize: 72, ironCount: 6 };

function heuristicJobs(n: number, nPlayers: number): SimJob[] {
  return Array.from({ length: n }, (_unused, i) => ({
    seed: perGameSeed(1000n, i).toString(),
    config,
    turnCap: 25,
    nPlayers,
    seatAgents: Array.from({ length: nPlayers }, () => ({ kind: "heuristic" as const })),
  }));
}

describe("GamePool determinism", () => {
  it("runGames reproduces serial runOneGame records byte-for-byte (in submission order)", async () => {
    const jobs = heuristicJobs(8, 2);
    const pool = new GamePool(3);
    let parallel;
    try {
      parallel = await pool.runGames(jobs);
    } finally {
      pool.close();
    }
    const serial = jobs.map((j) =>
      runOneGame(config, BigInt(j.seed), j.nPlayers, () => heuristicAgent(), j.turnCap),
    );
    expect(parallel).toEqual(serial);
  }, 60_000);

  it("is invariant to worker count (1 worker == 4 workers)", async () => {
    const jobs = heuristicJobs(6, 3);
    const p1 = new GamePool(1);
    const p4 = new GamePool(4);
    let r1, r4;
    try {
      r1 = await p1.runGames(jobs);
      r4 = await p4.runGames(jobs);
    } finally {
      p1.close();
      p4.close();
    }
    expect(r4).toEqual(r1);
  }, 60_000);
});

describe("GamePool error handling", () => {
  it("rejects the job (does not hang) when the worker throws — e.g. infeasible iron geometry", async () => {
    // boardSize 48 (~47 hexes) cannot hold 12 iron under the spacing CSP -> generateBoard throws in the worker.
    const badJob: SimJob = {
      seed: "1000",
      config: { ...defaultConfig(), boardSize: 48, ironCount: 12 },
      turnCap: 20,
      nPlayers: 2,
      seatAgents: [{ kind: "heuristic" }, { kind: "heuristic" }],
    };
    const pool = new GamePool(2);
    try {
      await expect(pool.runGame(badJob)).rejects.toThrow(/worker job \d+ failed/);
    } finally {
      pool.close();
    }
  }, 60_000);

  it("a worker error does not poison the pool — a following good job still resolves", async () => {
    const badJob: SimJob = {
      seed: "1000",
      config: { ...defaultConfig(), boardSize: 48, ironCount: 12 },
      turnCap: 20,
      nPlayers: 2,
      seatAgents: [{ kind: "heuristic" }, { kind: "heuristic" }],
    };
    const pool = new GamePool(1);
    try {
      await expect(pool.runGame(badJob)).rejects.toThrow();
      const good = await pool.runGame(heuristicJobs(1, 2)[0]!);
      expect(good.result.turns).toBeGreaterThanOrEqual(1);
    } finally {
      pool.close();
    }
  }, 60_000);

  it("rejects runGame after close()", async () => {
    const pool = new GamePool(1);
    pool.close();
    await expect(pool.runGame(heuristicJobs(1, 2)[0]!)).rejects.toThrow(/closed/);
  }, 60_000);
});
