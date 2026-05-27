// ABOUTME: Tests for the shared Agent adapter (greedyAgent) and the perimeter-aware position heuristic.
// ABOUTME: Seeded, structural; covers iron dominance, the anti-myopia perimeter term, threshold bonus, elimination, frontier penalty.

import { describe, expect, it } from "vitest";
import { mkState } from "../helpers/state";
import { hex } from "../../src/geometry/cube";
import { applyAction } from "../../src/engine/apply";
import { defaultConfig } from "../../src/engine/config";
import { greedyAgent } from "../../src/agent/agent";
import { evaluate, defaultHeuristicWeights } from "../../src/agent/heuristic";

describe("greedyAgent (shared Agent adapter)", () => {
  it("returns an applyAction-acceptable action wrapping chooseAction", () => {
    const state = mkState({
      board: 96,
      basesP0: [hex(-1, 1, 0), hex(2, -1, -1), hex(0, -2, 2)],
      basesP1: [hex(-4, 4, 0), hex(-5, 5, 0), hex(-6, 6, 0)],
    });
    const agent = greedyAgent("economic");
    const { action, state: advanced } = agent(state, 0);
    // applyAction must accept the chosen action without throwing.
    expect(() => applyAction(state, action)).not.toThrow();
    // The agent advances the PRNG (greedy draws one softmax sample).
    expect(advanced.rngState).not.toEqual(state.rngState);
  });
});

describe("evaluate", () => {
  it("scores a player controlling more iron higher, all else equal", () => {
    // Two single-base players; P0 sits on/near 2 iron, P1 near 1. Radius small
    // so each controls only its own neighborhood (no overlap).
    const cfg = { ...defaultConfig(), radius: 1 };
    const state = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      basesP1: [hex(-4, 4, 0)],
      iron: [hex(0, 0, 0), hex(1, -1, 0), hex(-4, 4, 0)],
      config: cfg,
    });
    const scores = evaluate(state);
    expect(scores[0]!).toBeGreaterThan(scores[1]!);
  });

  it("rewards establishing a valid 4-base perimeter even when controlled iron is unchanged (anti-myopia)", () => {
    // P0 with 3 radiating bases vs the same 3 plus a 4th forming a valid,
    // non-degenerate hull that encloses iron. Iron placed so both regimes
    // control exactly the same iron — the only difference is the perimeter.
    const three = [hex(-2, 2, 0), hex(2, 0, -2), hex(0, -2, 2)];
    const four = [...three, hex(0, 2, -2)];
    const iron = [hex(0, 0, 0), hex(1, -1, 0)];

    const s3 = mkState({ board: 96, basesP0: three, iron });
    const s4 = mkState({ board: 96, basesP0: four, iron });

    const score3 = evaluate(s3)[0]!;
    const score4 = evaluate(s4)[0]!;
    expect(score4).toBeGreaterThan(score3);
  });

  it("raises score as controlled iron approaches victoryThreshold (super-linear bonus)", () => {
    // Compare two single-player states differing only in controlled-iron count:
    // one at threshold-1, one at threshold-3. The distance-to-threshold bonus
    // makes the gap exceed what a purely linear iron term would give.
    const cfg = { ...defaultConfig(), radius: 5, victoryThreshold: 6 };
    const w = defaultHeuristicWeights();

    // threshold-1 = 5 controlled iron; threshold-3 = 3 controlled iron.
    const ironNear = [hex(0, 0, 0), hex(1, -1, 0), hex(-1, 1, 0), hex(2, -2, 0), hex(-2, 2, 0)];
    const ironFar = [hex(0, 0, 0), hex(1, -1, 0), hex(-1, 1, 0)];

    const sNear = mkState({ board: 96, basesP0: [hex(0, 0, 0)], iron: ironNear, config: cfg });
    const sFar = mkState({ board: 96, basesP0: [hex(0, 0, 0)], iron: ironFar, config: cfg });

    const near = evaluate(sNear, w)[0]!;
    const far = evaluate(sFar, w)[0]!;

    // Higher absolute score near the threshold.
    expect(near).toBeGreaterThan(far);
    // And the increase per the 2 extra iron exceeds the purely-linear iron value
    // of 2 iron (2 * w.iron) — i.e. the super-linear threshold bonus contributed.
    expect(near - far).toBeGreaterThan(2 * w.iron);
  });

  it("scores an eliminated player lowest", () => {
    const state = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      basesP1: [hex(-4, 4, 0)],
      iron: [hex(0, 0, 0)],
    });
    state.players[1]!.eliminated = true;
    const scores = evaluate(state);
    expect(scores[1]!).toBeLessThan(scores[0]!);
    // Eliminated players get a sentinel far below any live score.
    expect(scores[1]!).toBeLessThan(-1e6);
  });

  it("penalizes frontier exposure: bases adjacent to opponent-controlled hexes score lower than isolated", () => {
    const cfg = { ...defaultConfig(), radius: 1 };
    const adj = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      basesP1: [hex(2, -2, 0)],
      iron: [hex(0, 0, 0)],
      config: cfg,
    });
    const iso = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      basesP1: [hex(-4, 4, 0)],
      iron: [hex(0, 0, 0)],
      config: cfg,
    });
    expect(evaluate(adj)[0]!).toBeLessThan(evaluate(iso)[0]!);
  });
});
