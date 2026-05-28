// ABOUTME: Tests for the alliance-aware heuristic policy — Phase 1 of the alliance-aware-agent-policy plan.
// ABOUTME: samplePolicy at temp→0 should enumerate ally/break-alliance candidates and pick a strong ally over a weak one.

import { describe, expect, it } from "vitest";
import { mkState } from "../helpers/state";
import { hex } from "../../src/geometry/cube";
import { defaultConfig } from "../../src/engine/config";
import { seed } from "../../src/rng/pcg";
import { samplePolicy } from "../../src/agent/heuristic";
import type { GameState } from "../../src/engine/types";

const ARGMAX_TEMP = 1e-6;

/**
 * 3P fixture with alliances enabled, low victoryThreshold, and a clearly strong ally
 * candidate (P1 controlling lots of iron) vs a clearly weak one (P2 controlling little).
 * P0 has the ally action legal (basesInHand >= 1, cooldown 0, no existing ally).
 */
function strongVsWeakAllyFixture(): GameState {
  const cfg = {
    ...defaultConfig(),
    alliancesEnabled: true,
    allianceVictoryDelta: 1,
    victoryThreshold: 6,
    placeRange: 2,
    radius: 2,
  };
  return mkState({
    board: 96,
    // P0: a single base near origin (1 controlled iron after fixture setup below).
    basesP0: [hex(0, 0, 0)],
    // P1: a 4-base perimeter cluster far from P0 surrounding multiple iron hexes (strong ally).
    basesP1: [hex(20, -20, 0), hex(22, -20, -2), hex(20, -18, -2), hex(22, -22, 0)],
    // P2: a lone base far from both (weak ally; controls at most 1 iron).
    basesP2: [hex(-20, 20, 0)],
    iron: [
      // 1 iron for P0 (adjacent to its base).
      hex(1, -1, 0),
      // 4 iron inside P1's perimeter.
      hex(21, -20, -1),
      hex(21, -21, 0),
      hex(20, -19, -1),
      hex(21, -19, -2),
      // 1 iron for P2.
      hex(-19, 19, 0),
    ],
    config: cfg,
  });
}

describe("heuristic alliance-aware candidate generation (Phase 1)", () => {
  it("at temp→0, picks an ally action when a strong ally is available and alliances are enabled", () => {
    const state = strongVsWeakAllyFixture();
    const { action } = samplePolicy(state, 0, seed(1n), ARGMAX_TEMP);
    expect(action.kind).toBe("ally");
  });

  it("at temp→0 with a strong ally (P1, 4 iron) vs a weak ally (P2, 1 iron), targets the strong one", () => {
    const state = strongVsWeakAllyFixture();
    const { action } = samplePolicy(state, 0, seed(1n), ARGMAX_TEMP);
    expect(action.kind).toBe("ally");
    if (action.kind === "ally") {
      expect(action.target).toBe(1);
    }
  });

  it("does NOT emit ally candidates when alliancesEnabled is false (no regression on non-alliance games)", () => {
    const base = strongVsWeakAllyFixture();
    const noAllianceConfig = { ...base.config, alliancesEnabled: false };
    const state: GameState = { ...base, config: noAllianceConfig };
    const { action } = samplePolicy(state, 0, seed(1n), ARGMAX_TEMP);
    expect(action.kind).not.toBe("ally");
    expect(action.kind).not.toBe("break-alliance");
  });

  it("does NOT emit ally candidates when the actor's allianceCooldownTurns > 0", () => {
    const base = strongVsWeakAllyFixture();
    const players = base.players.map((p, i) => (i === 0 ? { ...p, allianceCooldownTurns: 1 } : p));
    const state: GameState = { ...base, players };
    const { action } = samplePolicy(state, 0, seed(1n), ARGMAX_TEMP);
    expect(action.kind).not.toBe("ally");
    expect(action.kind).not.toBe("break-alliance");
  });
});
