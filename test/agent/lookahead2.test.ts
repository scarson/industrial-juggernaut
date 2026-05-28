// ABOUTME: Tests for the lookahead2 agent — verifies it produces legal actions and beats the heuristic h2h on variant (c) 2P.
// ABOUTME: Acceptance for Track A of the 2026-05-29 overnight queue (post-Opus-playtest).

import { describe, expect, it } from "vitest";
import { lookahead2Agent } from "../../src/agent/lookahead2";
import { heuristicAgent } from "../../src/agent/heuristic-agent";
import { runGame } from "../../src/driver/run";
import { defaultConfig } from "../../src/engine/config";
import { applyAction } from "../../src/engine/apply";
import { mkState } from "../helpers/state";
import { hex } from "../../src/geometry/cube";

const VARIANT_C = {
  ...defaultConfig(),
  boardSize: 96,
  radius: 2,
  ironCount: 14,
  victoryThreshold: 10,
  noIronRequiresPerimeter: true,
};

describe("lookahead2 agent", () => {
  it("produces an applyAction-acceptable action on a generic 2P state", () => {
    const state = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      basesP1: [hex(8, -8, 0)],
      iron: [hex(1, -1, 0), hex(7, -7, 0)],
      config: VARIANT_C,
    });
    const agent = lookahead2Agent();
    const { action } = agent(state, 0);
    expect(() => applyAction(state, action)).not.toThrow();
  });

  it("beats the heuristic at least 30% of the time across 10 2P (c) games (Opus playtest claim: ~80%; this is the lower-bound sanity gate)", () => {
    const agent = lookahead2Agent();
    const heur = heuristicAgent();
    let wins = 0;
    for (let seed = 1n; seed <= 10n; seed++) {
      const result = runGame({
        seed,
        boardSource: { kind: "generate", size: 96, ironCount: 14 },
        nPlayers: 2,
        archetypes: ["economic", "economic"],
        config: VARIANT_C,
        turnCap: 30,
        agentFor: (p) => (p === 0 ? agent : heur),
      });
      if (result.winnerOrCoalition.includes(0)) wins += 1;
    }
    expect(wins).toBeGreaterThanOrEqual(3);
  }, 120_000);
});
