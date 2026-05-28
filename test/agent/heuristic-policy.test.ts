// ABOUTME: Tests for samplePolicy — the stochastic, heuristic-guided complete-action policy used as MCTS rollout/PW generator.
// ABOUTME: Seeded/deterministic; covers legality, determinism, temperature->0 = greedy argmax, diversity, and perimeter exploration.

import { describe, expect, it } from "vitest";
import { mkState } from "../helpers/state";
import { hex, key } from "../../src/geometry/cube";
import { applyAction } from "../../src/engine/apply";
import { defaultConfig } from "../../src/engine/config";
import { seed, type RngState } from "../../src/rng/pcg";
import { samplePolicy } from "../../src/agent/heuristic";
import type { Action, GameState } from "../../src/engine/types";

/** A near-zero temperature that drives every softmax to argmax (greedy limit). */
const ARGMAX_TEMP = 1e-6;

/** A canonical string for an Action so distinct compositions are comparable as set members. */
function actionKey(a: Action): string {
  switch (a.kind) {
    case "pass":
      return "pass";
    case "build":
      return "build:" + a.pieces.map((p) => `${p.type}@${key(p.hex)}`).sort().join("|");
    case "attack":
      return (
        "attack:" +
        a.attacks
          .map((d) => `${key(d.target)};${d.attackers.map(key).sort().join(",")};${key(d.defender)}`)
          .join("/")
      );
    case "ally":
      return `ally:${a.target}`;
    case "break-alliance":
      return `break-alliance:${a.target}`;
  }
}

/** A fixture with a 3-base radiating P0 that controls iron and can form a 4th-base perimeter. */
function perimeterFixture(): GameState {
  const cfg = { ...defaultConfig(), placeRange: 2, radius: 2 };
  return mkState({
    board: 96,
    basesP0: [hex(-1, 1, 0), hex(0, 0, 0), hex(1, -1, 0)],
    basesP1: [hex(-9, 9, 0)],
    iron: [hex(0, 0, 0)],
    config: cfg,
  });
}

/** A fixture where P0 has a 4-base perimeter and multiple comparably-valued expansion options. */
function diversityFixture(): GameState {
  const cfg = { ...defaultConfig(), placeRange: 5, radius: 3 };
  return mkState({
    board: 96,
    basesP0: [hex(0, 4, -4), hex(4, 0, -4), hex(0, -4, 4), hex(-4, 4, 0)],
    basesP1: [hex(-9, 9, 0)],
    iron: [hex(0, 0, 0), hex(1, -1, 0), hex(-1, 1, 0), hex(2, -2, 0)],
    config: cfg,
  });
}

describe("samplePolicy — legality", () => {
  const fixtures: { name: string; state: () => GameState; player: 0 | 1 }[] = [
    { name: "3-base radiating with iron", state: perimeterFixture, player: 0 },
    { name: "4-base perimeter, rich options", state: diversityFixture, player: 0 },
    {
      name: "single base, minimal options",
      state: () =>
        mkState({
          board: 96,
          basesP0: [hex(0, 0, 0)],
          basesP1: [hex(-9, 9, 0)],
          iron: [hex(0, 0, 0), hex(1, -1, 0)],
        }),
      player: 0,
    },
    {
      name: "no build budget, must pass or attack",
      state: () =>
        mkState({
          board: 96,
          basesP0: [hex(-1, 1, 0)],
          basesP1: [hex(-9, 9, 0)],
          iron: [],
        }),
      player: 0,
    },
  ];

  for (const f of fixtures) {
    it(`returns an applyAction-acceptable action: ${f.name}`, () => {
      // Sweep a handful of seeds so we exercise multiple sampled branches.
      for (let s = 0; s < 12; s++) {
        const state = f.state();
        const rng = seed(BigInt(s + 1));
        const { action } = samplePolicy(state, f.player, rng, 1.0);
        expect(() => applyAction(state, action)).not.toThrow();
      }
    });
  }
});

describe("samplePolicy — determinism", () => {
  it("same (state, player, rng, temperature) yields identical action AND identical returned rng", () => {
    const state = perimeterFixture();
    const rng: RngState = seed(42n);
    const a = samplePolicy(state, 0, rng, 1.0);
    const b = samplePolicy(state, 0, rng, 1.0);
    expect(actionKey(a.action)).toBe(actionKey(b.action));
    expect(a.rng).toEqual(b.rng);
  });

  it("advances the rng (returned rng differs from the incoming rng)", () => {
    const state = perimeterFixture();
    const rng: RngState = seed(7n);
    const { rng: out } = samplePolicy(state, 0, rng, 1.0);
    expect(out).not.toEqual(rng);
  });
});

describe("samplePolicy — temperature -> 0 reduces to greedy argmax", () => {
  it("returns the SAME action across many incoming seeds at temperature 1e-6", () => {
    const keys = new Set<string>();
    for (let s = 0; s < 40; s++) {
      const state = perimeterFixture();
      const rng = seed(BigInt(s + 1));
      const { action } = samplePolicy(state, 0, rng, ARGMAX_TEMP);
      keys.add(actionKey(action));
    }
    // Argmax is deterministic w.r.t. the policy: one action regardless of seed.
    expect(keys.size).toBe(1);
  });

  it("the argmax action is itself applyAction-acceptable", () => {
    const state = perimeterFixture();
    const { action } = samplePolicy(state, 0, seed(1n), ARGMAX_TEMP);
    expect(() => applyAction(state, action)).not.toThrow();
  });
});

describe("samplePolicy — diversity at higher temperature", () => {
  it("samples >= 2 distinct actions across many seeds in a fixture with multiple good options", () => {
    const keys = new Set<string>();
    for (let s = 0; s < 80; s++) {
      const state = diversityFixture();
      const rng = seed(BigInt(s + 1));
      const { action } = samplePolicy(state, 0, rng, 1.0);
      keys.add(actionKey(action));
    }
    expect(keys.size).toBeGreaterThanOrEqual(2);
  });
});

describe("samplePolicy — anti-fixed-greedy: explores the 4th-base perimeter", () => {
  // The perimeter-aware heuristic deliberately values a 4th-base perimeter, so the
  // 3-base radiating fixture below lets samplePolicy compose the perimeter-forming
  // base build. The "fixed candidate set" blind spot (Option 1 throughput fallback)
  // never explores within a build; this property proves samplePolicy CAN reach the
  // perimeter move that a single fixed composition misses. We assert that, over many
  // seeds at a higher temperature, the chosen action is a 4th-base BUILD (a base build
  // that brings P0 to a valid 4-base perimeter) with non-trivial frequency, AND that
  // the policy is not locked to a single composition (>= 2 distinct actions sampled).
  it("samples a perimeter-forming 4th-base build with non-trivial frequency", () => {
    const state = perimeterFixture();
    let perimeterBaseBuilds = 0;
    const keys = new Set<string>();
    const N = 200;
    for (let s = 0; s < N; s++) {
      const rng = seed(BigInt(s + 1));
      const { action } = samplePolicy(state, 0, rng, 1.5);
      keys.add(actionKey(action));
      if (action.kind === "build" && action.pieces.every((p) => p.type === "base")) {
        // A base build that lands P0 at >= 4 bases is a perimeter-forming move.
        const basesAfter = applyAction(state, action).state.bases.filter((b) => b.owner === 0).length;
        if (basesAfter >= 4) perimeterBaseBuilds++;
      }
    }
    // Non-trivial frequency: at least 10% of samples reach the perimeter build.
    expect(perimeterBaseBuilds).toBeGreaterThan(N * 0.1);
    // And the policy is genuinely exploring, not locked to one composition.
    expect(keys.size).toBeGreaterThanOrEqual(2);
  });
});
