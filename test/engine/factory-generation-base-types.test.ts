// ABOUTME: Tests for Tactical Depth Phase 4 — factory generation is gated to forge bases when baseTypesEnabled.
// ABOUTME: A player with only watchtowers/outposts cannot anchor factory placements.

import { describe, expect, it } from "vitest";
import { farthestBases, isLegalFactoryPlacement } from "../../src/engine/build";
import { defaultConfig } from "../../src/engine/config";
import { mkState } from "../helpers/state";
import { hex } from "../../src/geometry/cube";
import type { GameState } from "../../src/engine/types";

describe("factory generation — type-aware (Phase 4)", () => {
  it("with baseTypesEnabled=false, ALL bases anchor factory placement (existing behavior unchanged)", () => {
    const cfg = { ...defaultConfig(), baseTypesEnabled: false };
    const base = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      basesP1: [hex(20, -20, 0)],
      iron: [hex(1, -1, 0)],
      config: cfg,
    });
    // Even though the base is "watchtower" typed, flag-off ignores it.
    const bases = base.bases.map((b, i) => (i === 0 ? { ...b, type: "watchtower" as const } : b));
    const state: GameState = { ...base, bases };
    expect(farthestBases(state, 0).length).toBe(1);
    expect(isLegalFactoryPlacement(state, 0, hex(2, -2, 0))).toBe(true);
  });

  it("with baseTypesEnabled=true and only a watchtower base, farthestBases is empty and no factory placement is legal", () => {
    const cfg = { ...defaultConfig(), baseTypesEnabled: true };
    const base = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      basesP1: [hex(20, -20, 0)],
      iron: [hex(1, -1, 0)],
      config: cfg,
    });
    const bases = base.bases.map((b, i) => (i === 0 ? { ...b, type: "watchtower" as const } : b));
    const state: GameState = { ...base, bases };
    expect(farthestBases(state, 0)).toEqual([]);
    // No legal factory placement anywhere when there's no forge to anchor.
    expect(isLegalFactoryPlacement(state, 0, hex(2, -2, 0))).toBe(false);
    expect(isLegalFactoryPlacement(state, 0, hex(0, 1, -1))).toBe(false);
  });

  it("with baseTypesEnabled=true and only an outpost base, factory placement is also rejected", () => {
    const cfg = { ...defaultConfig(), baseTypesEnabled: true };
    const base = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      basesP1: [hex(20, -20, 0)],
      iron: [hex(1, -1, 0)],
      config: cfg,
    });
    const bases = base.bases.map((b, i) => (i === 0 ? { ...b, type: "outpost" as const } : b));
    const state: GameState = { ...base, bases };
    expect(farthestBases(state, 0)).toEqual([]);
    expect(isLegalFactoryPlacement(state, 0, hex(2, -2, 0))).toBe(false);
  });

  it("with baseTypesEnabled=true and a mix (forge + watchtower), factory placement is anchored ONLY to the forge", () => {
    const cfg = { ...defaultConfig(), baseTypesEnabled: true, placeRange: 5 };
    const base = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0), hex(15, -15, 0)], // forge at origin, watchtower at distance 15
      basesP1: [hex(40, -40, 0)],
      iron: [hex(1, -1, 0)],
      config: cfg,
    });
    const bases = base.bases.map((b, i) => {
      if (i === 0) return { ...b, type: "forge" as const };
      if (i === 1) return { ...b, type: "watchtower" as const };
      return b;
    });
    const state: GameState = { ...base, bases };
    // Forge is at (0,0,0); placeRange=5, so factory placement near the forge is OK.
    expect(isLegalFactoryPlacement(state, 0, hex(3, -3, 0))).toBe(true);
    // Near the watchtower (distance ~15 from forge) — should be REJECTED because the
    // watchtower can't anchor factories under flag-on, and (15,-15,0) is far from the forge.
    expect(isLegalFactoryPlacement(state, 0, hex(15, -14, -1))).toBe(false);
  });
});
