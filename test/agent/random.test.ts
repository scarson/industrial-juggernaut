// ABOUTME: Tests for the truly-random agent.

import { describe, expect, it } from "vitest";
import { randomAgent } from "../../src/agent/random";
import { defaultConfig } from "../../src/engine/config";
import { applyAction } from "../../src/engine/apply";
import { mkState } from "../helpers/state";
import { hex } from "../../src/geometry/cube";
import { seed } from "../../src/rng/pcg";

describe("random agent", () => {
  it("produces a legal action", () => {
    const state = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      basesP1: [hex(8, -8, 0)],
      iron: [hex(1, -1, 0)],
      config: defaultConfig(),
    });
    const agent = randomAgent();
    const { action } = agent(state, 0);
    expect(() => applyAction(state, action)).not.toThrow();
  });

  it("is deterministic given a fixed rng state — same input state yields same action", () => {
    const baseState = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      basesP1: [hex(8, -8, 0)],
      iron: [hex(1, -1, 0)],
      config: defaultConfig(),
    });
    const state = { ...baseState, rngState: seed(42n) };
    const agent = randomAgent();
    const a = agent(state, 0);
    const b = agent(state, 0);
    expect(a.action).toEqual(b.action);
  });

  it("advances rngState (returned state.rngState differs from input)", () => {
    const baseState = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      basesP1: [hex(8, -8, 0)],
      iron: [hex(1, -1, 0)],
      config: defaultConfig(),
    });
    const state = { ...baseState, rngState: seed(99n) };
    const { state: out } = randomAgent()(state, 0);
    expect(out.rngState).not.toEqual(state.rngState);
  });
});
