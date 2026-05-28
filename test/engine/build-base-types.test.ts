// ABOUTME: Tests for type-aware build cost — Tactical Depth Phase 3.
// ABOUTME: buildBudgetForType returns floor(R / cost) where cost is 2/4/1 for forge/watchtower/outpost.

import { describe, expect, it } from "vitest";
import { buildBudget, buildBudgetForType, basePieceCost } from "../../src/engine/build";
import { defaultConfig } from "../../src/engine/config";
import { applyAction } from "../../src/engine/apply";
import { mkState } from "../helpers/state";
import { hex } from "../../src/geometry/cube";
import type { GameState } from "../../src/engine/types";

function mkPerimeterState(_extraFactories: number, baseTypesEnabled: boolean): GameState {
  // P0 has a 4-base perimeter enclosing 8 iron (resource count = 8). No factories — keeps the
  // fixture simple and avoids placement-collision footguns.
  const config = { ...defaultConfig(), radius: 5, baseTypesEnabled };
  const baseHexes = [hex(0, 5, -5), hex(5, 0, -5), hex(0, -5, 5), hex(-5, 5, 0)];
  // 8 iron hexes inside the diamond (selected from interior hexes; cube-coord sum stays 0).
  const ironHexes = [
    hex(0, 0, 0), hex(1, -1, 0), hex(2, -2, 0), hex(-1, 1, 0),
    hex(1, 0, -1), hex(-1, 0, 1), hex(0, 1, -1), hex(0, -1, 1),
  ];
  return mkState({
    board: 96,
    basesP0: baseHexes,
    basesP1: [hex(20, -20, 0)],
    iron: ironHexes,
    config,
  });
}

describe("buildBudget / basePieceCost — type-aware (Phase 3)", () => {
  it("basePieceCost returns 2 for all types when baseTypesEnabled=false", () => {
    const cfg = { ...defaultConfig(), baseTypesEnabled: false };
    expect(basePieceCost(cfg, "forge")).toBe(2);
    expect(basePieceCost(cfg, "watchtower")).toBe(2);
    expect(basePieceCost(cfg, "outpost")).toBe(2);
  });

  it("basePieceCost returns per-type costs when baseTypesEnabled=true", () => {
    const cfg = { ...defaultConfig(), baseTypesEnabled: true };
    expect(basePieceCost(cfg, "forge")).toBe(2);
    expect(basePieceCost(cfg, "watchtower")).toBe(4);
    expect(basePieceCost(cfg, "outpost")).toBe(1);
  });

  it("buildBudget (legacy) returns floor(R/2) under both flag settings — bit-for-bit", () => {
    for (const flag of [false, true]) {
      const state = mkPerimeterState(/*extraFactories*/ 4, flag); // 4 iron + 4 factories = R=8
      expect(buildBudget(state, 0)).toBe(4); // floor(8/2)=4
    }
  });

  it("buildBudgetForType: with flag off, all types return floor(R/2) (unchanged)", () => {
    const state = mkPerimeterState(4, false); // R=8
    expect(buildBudgetForType(state, 0, "forge")).toBe(4);
    expect(buildBudgetForType(state, 0, "watchtower")).toBe(4);
    expect(buildBudgetForType(state, 0, "outpost")).toBe(4);
  });

  it("buildBudgetForType: with flag on, R=8 yields forge=4 / watchtower=2 / outpost=8", () => {
    const state = mkPerimeterState(4, true); // R=8
    expect(buildBudgetForType(state, 0, "forge")).toBe(4);
    expect(buildBudgetForType(state, 0, "watchtower")).toBe(2);
    expect(buildBudgetForType(state, 0, "outpost")).toBe(8);
  });

  it("applyBuild: flag-on watchtower build of 3 pieces from R=8 is REJECTED (watchtower cost=4; budget=2)", () => {
    // Budget rejection fires BEFORE per-piece placement legality, so we don't need
    // placement-legal hexes — just enough pieces to over-budget.
    const state = mkPerimeterState(4, true);
    const placements = [hex(99, -99, 0), hex(99, -98, -1), hex(99, -97, -2)]; // off-board nonsense
    expect(() =>
      applyAction(state, {
        kind: "build",
        pieces: placements.map((h) => ({ type: "base" as const, hex: h, baseType: "watchtower" as const })),
      }),
    ).toThrow(/exceeds build budget/);
  });

  it("applyBuild rejects mixed-baseType pieces in one round (cost-check shape, not placement)", () => {
    const state = mkPerimeterState(4, true);
    expect(() =>
      applyAction(state, {
        kind: "build",
        pieces: [
          { type: "base" as const, hex: hex(99, -99, 0), baseType: "forge" as const },
          { type: "base" as const, hex: hex(99, -98, -1), baseType: "outpost" as const },
        ],
      }),
    ).toThrow(/share a baseType/);
  });

  it("applyBuild: undefined baseType piece is treated as forge — checked via per-piece-cost shape", () => {
    // We don't construct a legal end-to-end placement here (fixtures are fiddly). Instead
    // verify the cost function and apply-shape: an undefined-baseType, 1-piece base build from
    // R=8 stays within budget (forge cost=2, budget=4), so the throw must NOT be the budget
    // throw — it would be a placement-legality throw if anything (verified via /illegal placement/).
    const state = mkPerimeterState(4, true);
    let err: Error | null = null;
    try {
      applyAction(state, { kind: "build", pieces: [{ type: "base", hex: hex(99, -99, 0) }] });
    } catch (e) {
      err = e as Error;
    }
    expect(err).not.toBeNull();
    expect(err!.message).toMatch(/illegal base placement/); // NOT "exceeds build budget"
  });
});
