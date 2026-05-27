// ABOUTME: Tests for AgentSpec/buildAgent — the JSON-serializable agent descriptors workers use to reconstruct agents.
// ABOUTME: Verifies each spec builds a working Agent and that specs round-trip through JSON unchanged.

import { describe, expect, it } from "vitest";
import { buildAgent, type AgentSpec } from "../../src/sweep/agent-spec";
import { setupGame } from "../../src/engine/turn";
import { generateBoard } from "../../src/board/generate";
import { defaultConfig } from "../../src/engine/config";
import { seed } from "../../src/rng/pcg";
import { legalActions } from "../../src/engine/legal";

function freshState() {
  const { board, rng } = generateBoard(seed(1000n), { size: 96, ironCount: 12 });
  return setupGame(rng, board, 2, defaultConfig());
}

describe("buildAgent", () => {
  const specs: AgentSpec[] = [
    { kind: "heuristic" },
    { kind: "greedy", archetype: "economic" },
    { kind: "mcts", iterations: 20 },
  ];

  for (const spec of specs) {
    it(`builds a working Agent for ${spec.kind}`, () => {
      const agent = buildAgent(spec);
      const state = freshState();
      const { action } = agent(state, 0);
      // The chosen action must be one the engine considers legal for this state
      // (setup leaves player 0 to act first, so legalActions(state) is player 0's).
      const legal = legalActions(state);
      expect(legal.length).toBeGreaterThan(0);
      expect(legal.some((a) => JSON.stringify(a) === JSON.stringify(action))).toBe(true);
    });

    it(`round-trips ${spec.kind} through JSON unchanged`, () => {
      expect(JSON.parse(JSON.stringify(spec))).toEqual(spec);
    });
  }

  it("mcts without iterations builds the default-strength agent", () => {
    const agent = buildAgent({ kind: "mcts" });
    const { action } = agent(freshState(), 0);
    expect(action).toBeDefined();
  });
});
