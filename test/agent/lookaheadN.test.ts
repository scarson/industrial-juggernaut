// ABOUTME: Tests for the generalized N-ply lookahead agent — depth=2 reduces to lookahead2, depth=3 supports recursion.

import { describe, expect, it } from "vitest";
import { lookaheadNAgent } from "../../src/agent/lookaheadN";
import { lookahead2Agent } from "../../src/agent/lookahead2";
import { defaultConfig } from "../../src/engine/config";
import { applyAction } from "../../src/engine/apply";
import { mkState } from "../helpers/state";
import { hex } from "../../src/geometry/cube";

const VARIANT_C = {
  ...defaultConfig(),
  boardSize: 96, radius: 2, ironCount: 14, victoryThreshold: 10,
  noIronRequiresPerimeter: true,
};

function mkSimple2P() {
  return mkState({
    board: 96,
    basesP0: [hex(0, 0, 0)],
    basesP1: [hex(8, -8, 0)],
    iron: [hex(1, -1, 0), hex(7, -7, 0)],
    config: VARIANT_C,
  });
}

describe("lookaheadN agent", () => {
  it("throws on depth < 1", () => {
    expect(() => lookaheadNAgent(0)).toThrow();
    expect(() => lookaheadNAgent(-1)).toThrow();
  });

  it("depth=2 produces a legal action (smoke)", () => {
    const state = mkSimple2P();
    const agent = lookaheadNAgent(2);
    const { action } = agent(state, 0);
    expect(() => applyAction(state, action)).not.toThrow();
  });

  it("depth=3 produces a legal action (smoke — 3-ply minimax)", () => {
    const state = mkSimple2P();
    const agent = lookaheadNAgent(3);
    const { action } = agent(state, 0);
    expect(() => applyAction(state, action)).not.toThrow();
  });

  it("depth=2 and lookahead2 agree on the chosen action for the same state (semantic equivalence)", () => {
    const state = mkSimple2P();
    const lN = lookaheadNAgent(2)(state, 0);
    const l2 = lookahead2Agent()(state, 0);
    // Both algorithms pick the argmax T1 over the same T2 leaf eval search.
    // Verify they choose the same action; if different, document that semantic equivalence is approximate.
    expect(lN.action).toEqual(l2.action);
  });
});
