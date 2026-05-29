// ABOUTME: Tests for the heuristic's subtype-aware build composition when baseTypesEnabled.
// ABOUTME: Phase 6 acceptance — sampleBuild stamps baseType, samplePolicy iterates subtypes.

import { describe, expect, it } from "vitest";
import { samplePolicy } from "../../src/agent/heuristic";
import { defaultConfig } from "../../src/engine/config";
import { applyAction } from "../../src/engine/apply";
import { mkState } from "../helpers/state";
import { hex } from "../../src/geometry/cube";
import { seed } from "../../src/rng/pcg";

describe("samplePolicy — subtype-aware composition (Phase 6)", () => {
  it("flag off: composed base build pieces have NO baseType field (pre-Phase-1 behavior)", () => {
    const cfg = { ...defaultConfig(), radius: 5 };
    const state = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0), hex(2, -2, 0), hex(-2, 2, 0)],
      basesP1: [hex(20, -20, 0)],
      iron: [hex(1, -1, 0), hex(0, 1, -1), hex(-1, 0, 1)],
      config: cfg,
    });
    const { action } = samplePolicy(state, 0, seed(42n), 1e-6);
    if (action.kind === "build") {
      for (const p of action.pieces) {
        expect(p).not.toHaveProperty("baseType");
      }
    }
    // Whatever was chosen, it must be legal.
    expect(() => applyAction(state, action)).not.toThrow();
  });

  it("flag on: at temp→0 the chosen action is legal AND if it's a base build, pieces share their baseType", () => {
    const cfg = { ...defaultConfig(), radius: 5, baseTypesEnabled: true };
    const state = mkState({
      board: 96,
      basesP0: [hex(0, 5, -5), hex(5, 0, -5), hex(0, -5, 5), hex(-5, 5, 0)],
      basesP1: [hex(20, -20, 0)],
      iron: [
        hex(0, 0, 0), hex(1, -1, 0), hex(2, -2, 0), hex(-1, 1, 0),
        hex(1, 0, -1), hex(-1, 0, 1), hex(0, 1, -1), hex(0, -1, 1),
      ],
      config: cfg,
    });
    const { action } = samplePolicy(state, 0, seed(1n), 1e-6);
    expect(() => applyAction(state, action)).not.toThrow();
    if (action.kind === "build" && action.pieces[0]?.type === "base") {
      const types = new Set(action.pieces.map((p) => p.baseType ?? "forge"));
      // All pieces in one round must share their baseType.
      expect(types.size).toBe(1);
    }
  });

  it("flag on: applying a watchtower-typed build leaves watchtower-typed bases on the board", () => {
    const cfg = { ...defaultConfig(), radius: 5, baseTypesEnabled: true };
    const state = mkState({
      board: 96,
      basesP0: [hex(0, 5, -5), hex(5, 0, -5), hex(0, -5, 5), hex(-5, 5, 0)],
      basesP1: [hex(20, -20, 0)],
      iron: [
        hex(0, 0, 0), hex(1, -1, 0), hex(2, -2, 0), hex(-1, 1, 0),
        hex(1, 0, -1), hex(-1, 0, 1), hex(0, 1, -1), hex(0, -1, 1),
      ],
      config: cfg,
    });
    const placeAction = {
      kind: "build" as const,
      pieces: [{ type: "base" as const, hex: hex(1, 1, -2), baseType: "watchtower" as const }],
    };
    const { state: after } = applyAction(state, placeAction);
    const placed = after.bases.find((b) => b.hex.x === 1 && b.hex.y === 1 && b.hex.z === -2);
    expect(placed?.type).toBe("watchtower");
  });
});
