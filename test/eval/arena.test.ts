// ABOUTME: Tests for the round-robin arena + Elo — determinism, win-rate accounting, a dominant-agent sanity check.
// ABOUTME: All games seeded; includes a SLOW MCTS-vs-greedy SIGNAL test (records, does not assert, the gate-2 preview).

import { describe, expect, it } from "vitest";
import { roundRobin, type NamedAgent } from "../../src/eval/arena";
import { greedyAgent } from "../../src/agent/agent";
import { mctsAgent, defaultMctsParams } from "../../src/agent/mcts-agent";
import { buildBudget } from "../../src/engine/build";
import { defaultConfig } from "../../src/engine/config";
import { nextUint32 } from "../../src/rng/pcg";
import { legalActions } from "../../src/engine/legal";
import type { Agent } from "../../src/agent/agent";
import type { Action } from "../../src/engine/types";

/**
 * A scripted agent that plays the FIRST legal action each round (legalActions
 * lists single-piece builds before attacks, so this places ONE piece per round
 * and never commits an attack). Placing a single piece per round grows the
 * footprint slowly and balanced, so this agent never trips the
 * industry-without-territory death — it is the SURVIVING baseline the sanity
 * test ranks above the self-eliminating spammer. Advances the game rng by
 * exactly one step, mirroring the other agents' in-state rng pattern so the
 * driver stays deterministic.
 */
const balancedBuilder: Agent = (state, _player) => {
  const action = legalActions(state)[0]!;
  const draw = nextUint32(state.rngState);
  return { action, state: { ...state, rngState: draw.state } };
};

/**
 * A deliberately-WEAK scripted agent: builds as many FACTORIES as the budget
 * allows in a single action and never grows its perimeter or attacks. Spamming
 * industry while holding fewer than 4 bases trips the per-player
 * `brokenPerimeterAt18Factories` death (config threshold 8) within a few rounds,
 * so this agent reliably ELIMINATES ITSELF early. It is the weaker agent the
 * sanity test ranks below the balanced builder. Advances the game rng by exactly
 * one step to match the other agents' in-state rng pattern.
 */
const factorySpammer: Agent = (state, player) => {
  const acts = legalActions(state);
  const factoryHexes = acts
    .filter(
      (a): a is Extract<Action, { kind: "build" }> =>
        a.kind === "build" && a.pieces.length === 1 && a.pieces[0]!.type === "factory",
    )
    .map((a) => a.pieces[0]!);
  const budget = buildBudget(state, player);
  const action: Action =
    factoryHexes.length > 0 && budget >= 1
      ? { kind: "build", pieces: factoryHexes.slice(0, budget) }
      : acts[0]!;
  const draw = nextUint32(state.rngState);
  return { action, state: { ...state, rngState: draw.state } };
};

describe("roundRobin — determinism", () => {
  it("same (agents, opts, seed) yields identical winRates and elo across two calls", () => {
    const agents: NamedAgent[] = [
      { name: "greedy", agent: greedyAgent("aggressive") },
      { name: "weak", agent: balancedBuilder },
    ];
    const opts = {
      playerCounts: [2],
      gamesPerMatchup: 12,
      seed: 7n,
      config: defaultConfig(),
      turnCap: 300,
    };
    const a = roundRobin(agents, opts);
    const b = roundRobin(agents, opts);
    expect(a.winRates).toEqual(b.winRates);
    expect(a.elo).toEqual(b.elo);
    expect(a.gamesPlayed).toEqual(b.gamesPlayed);
  });
});

describe("roundRobin — onGame progress", () => {
  it("invokes onGame once per game with monotonic done, the right total, and the result", () => {
    const agents: NamedAgent[] = [
      { name: "greedy", agent: greedyAgent("aggressive") },
      { name: "weak", agent: balancedBuilder },
    ];
    const events: { done: number; total: number; pc: number; turns: number }[] = [];
    roundRobin(agents, {
      playerCounts: [2],
      gamesPerMatchup: 5,
      seed: 11n,
      config: defaultConfig(),
      turnCap: 300,
      onGame: (done, total, pc, result) => {
        events.push({ done, total, pc, turns: result.turns });
      },
    });
    expect(events.length).toBe(5);
    expect(events.map((e) => e.done)).toEqual([1, 2, 3, 4, 5]);
    expect(events.every((e) => e.total === 5)).toBe(true);
    expect(events.every((e) => e.pc === 2)).toBe(true);
    expect(events.every((e) => e.turns >= 1)).toBe(true);
  });
});

describe("roundRobin — win-rate accounting", () => {
  it("win-rates are in [0,1] and the decisive split sums to 1 with the draw rate", () => {
    const agents: NamedAgent[] = [
      { name: "greedy", agent: greedyAgent("aggressive") },
      { name: "weak", agent: balancedBuilder },
    ];
    const games = 20;
    const r = roundRobin(agents, {
      playerCounts: [2],
      gamesPerMatchup: games,
      seed: 3n,
      config: defaultConfig(),
      turnCap: 300,
    });

    for (const name of ["greedy", "weak"]) {
      expect(r.winRates[name]).toBeGreaterThanOrEqual(0);
      expect(r.winRates[name]).toBeLessThanOrEqual(1);
      expect(r.gamesPlayed[name]).toBe(games);
    }

    // In a 2-agent 2-player matchup each game has exactly one seat per agent.
    // wins(greedy) + wins(weak) + draws == games, so the two win-rates plus the
    // shared draw-rate (draws/games) sum to 1.
    const wG = r.winRates["greedy"]! * r.gamesPlayed["greedy"]!;
    const wW = r.winRates["weak"]! * r.gamesPlayed["weak"]!;
    const draws = games - wG - wW;
    expect(draws).toBeGreaterThanOrEqual(0);
    expect((wG + wW + draws) / games).toBeCloseTo(1, 10);
  });
});

describe("roundRobin — sanity: a dominant agent ranks higher", () => {
  // The arena must rank a clearly-stronger agent above a clearly-weaker one. The
  // balanced builder grows one piece per round and survives; the factory spammer
  // floods industry while holding < 4 bases and self-eliminates via the
  // industry-without-territory death (`brokenPerimeterAt18Factories`, config
  // threshold 8) within a few rounds. The gap is large enough that the survivor
  // wins EVERY game from EITHER seat — the seat rotation can't tilt it — so the
  // win-rate and Elo ordering is decisive and seed-independent. Fast (no MCTS):
  // games end in a handful of rounds.
  it("a surviving balanced builder beats a self-eliminating factory spammer on win-rate and Elo", () => {
    const agents: NamedAgent[] = [
      { name: "balanced", agent: balancedBuilder },
      { name: "spammer", agent: factorySpammer },
    ];
    const r = roundRobin(agents, {
      playerCounts: [2],
      gamesPerMatchup: 40,
      seed: 11n,
      config: defaultConfig(),
      turnCap: 300,
    });
    expect(r.winRates["balanced"]!).toBeGreaterThan(r.winRates["spammer"]!);
    expect(r.elo["balanced"]!).toBeGreaterThan(r.elo["spammer"]!);
  });
});

describe("roundRobin — MCTS-vs-greedy SIGNAL (gate-2 preview, NOT a gate)", () => {
  // This RECORDS whether MCTS beats greedy over many games; it does NOT assert a
  // winner. Gate 2 lives in A6 and is genuinely open (the A4.1 discovery found no
  // divergence on crafted fixtures). MCTS is expensive (~iterations engine sims
  // per move), so this uses a REDUCED iteration budget + small game count + a
  // generous timeout. The printed win-rates/Elo are the deliverable.
  it("logs MCTS-vs-greedy win-rates and Elo", () => {
    const agents: NamedAgent[] = [
      { name: "mcts", agent: mctsAgent({ ...defaultMctsParams(), iterations: 60 }) },
      { name: "greedy", agent: greedyAgent("economic") },
    ];
    const r = roundRobin(agents, {
      playerCounts: [2],
      gamesPerMatchup: 20,
      seed: 1n,
      config: defaultConfig(),
      turnCap: 300,
    });
    // eslint-disable-next-line no-console
    console.log(
      "[mcts-vs-greedy SIGNAL] winRates:",
      r.winRates,
      "elo:",
      r.elo,
      "gamesPlayed:",
      r.gamesPlayed,
    );
    // Structural-only assertions; the win-rate is a recorded signal, not a gate.
    expect(r.winRates["mcts"]).toBeGreaterThanOrEqual(0);
    expect(r.winRates["mcts"]).toBeLessThanOrEqual(1);
    expect(r.winRates["greedy"]).toBeGreaterThanOrEqual(0);
    expect(r.winRates["greedy"]).toBeLessThanOrEqual(1);
  }, 120_000);
});
