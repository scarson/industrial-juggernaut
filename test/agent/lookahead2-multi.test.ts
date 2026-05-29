// ABOUTME: Tests for lookahead2-multi — N-player generalization of lookahead2.
// ABOUTME: Smoke + legality on 2P/3P fixtures. Strategic gates live in the sweep harness, not unit tests.

import { describe, expect, it } from "vitest";
import { lookahead2MultiAgent } from "../../src/agent/lookahead2-multi";
import { defaultConfig } from "../../src/engine/config";
import { applyAction } from "../../src/engine/apply";
import { mkState } from "../helpers/state";
import { hex } from "../../src/geometry/cube";

const VARIANT_C = {
  ...defaultConfig(),
  boardSize: 96, radius: 2, ironCount: 14, victoryThreshold: 10,
  noIronRequiresPerimeter: true,
};

describe("lookahead2-multi agent", () => {
  it("produces a legal action in 2P (matches the original lookahead2 semantics)", () => {
    const state = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      basesP1: [hex(8, -8, 0)],
      iron: [hex(1, -1, 0), hex(7, -7, 0)],
      config: VARIANT_C,
    });
    const agent = lookahead2MultiAgent();
    const { action } = agent(state, 0);
    expect(() => applyAction(state, action)).not.toThrow();
  });

  it("produces a legal action in 3P (handles the opponent-loop with multiple opponents)", () => {
    const state = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      basesP1: [hex(10, -10, 0)],
      basesP2: [hex(-10, 10, 0)],
      iron: [hex(1, -1, 0), hex(9, -9, 0), hex(-9, 9, 0)],
      config: VARIANT_C,
    });
    const agent = lookahead2MultiAgent();
    const { action } = agent(state, 0);
    expect(() => applyAction(state, action)).not.toThrow();
  });

  it("produces a legal action in 4P", () => {
    const state = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      basesP1: [hex(10, -10, 0)],
      basesP2: [hex(-10, 10, 0)],
      basesP3: [hex(10, 0, -10)],
      iron: [hex(1, -1, 0), hex(9, -9, 0), hex(-9, 9, 0), hex(9, 0, -9)],
      config: VARIANT_C,
    });
    const agent = lookahead2MultiAgent();
    const { action } = agent(state, 0);
    expect(() => applyAction(state, action)).not.toThrow();
  });
});
