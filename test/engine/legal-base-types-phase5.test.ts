// ABOUTME: Tests for Tactical Depth Phase 5 — legalActions enumerates subtypes when baseTypesEnabled.

import { describe, expect, it } from "vitest";
import { legalActions } from "../../src/engine/legal";
import { defaultConfig } from "../../src/engine/config";
import { mkState } from "../helpers/state";
import { hex } from "../../src/geometry/cube";
import type { Action, GameState } from "../../src/engine/types";

describe("legalActions — subtype enumeration (Phase 5)", () => {
  it("flag off: emits one 'base' action per legal hex (no baseType field) — pre-Phase-5 behavior", () => {
    const cfg = { ...defaultConfig(), baseTypesEnabled: false };
    const state = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0), hex(2, -2, 0), hex(-2, 2, 0)], // radiating, can place 4th
      basesP1: [hex(20, -20, 0)],
      iron: [hex(1, -1, 0)],
      config: cfg,
    });
    const acts = legalActions(state);
    const baseBuilds = acts.filter((a): a is Extract<Action, { kind: "build" }> =>
      a.kind === "build" && a.pieces[0]?.type === "base",
    );
    expect(baseBuilds.length).toBeGreaterThan(0);
    // No baseType field on any piece (flag-off path).
    for (const b of baseBuilds) {
      expect(b.pieces[0]).not.toHaveProperty("baseType");
    }
  });

  it("flag on: emits THREE 'base' actions per legal hex (one per subtype) when all subtypes affordable", () => {
    const cfg = { ...defaultConfig(), baseTypesEnabled: true };
    // Set up a perimeter player with enough resources (R=8) that all 3 subtypes are affordable.
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
    const acts = legalActions(state);
    const baseBuilds = acts.filter((a): a is Extract<Action, { kind: "build" }> =>
      a.kind === "build" && a.pieces[0]?.type === "base",
    );
    // Group by hex; each hex should appear with all 3 subtypes.
    const byHexKey = new Map<string, Set<string>>();
    for (const b of baseBuilds) {
      const p = b.pieces[0]!;
      const k = `${p.hex.x},${p.hex.y},${p.hex.z}`;
      if (!byHexKey.has(k)) byHexKey.set(k, new Set());
      const subtype = p.baseType ?? "forge";
      byHexKey.get(k)!.add(subtype);
    }
    // At least one hex should have all 3 subtypes available.
    let foundAllThree = false;
    for (const subtypes of byHexKey.values()) {
      if (subtypes.size === 3 && subtypes.has("forge") && subtypes.has("watchtower") && subtypes.has("outpost")) {
        foundAllThree = true;
        break;
      }
    }
    expect(foundAllThree).toBe(true);
  });

  it("flag on + low resources: only affordable subtypes are emitted (e.g. R=1 → outpost only)", () => {
    const cfg = { ...defaultConfig(), baseTypesEnabled: true };
    // Player has only 1 iron, so R=1 → outpost (cost 1) affordable, forge (cost 2) not.
    // But also bootstrap allows forge — hmm. With bootstrap=true and 1 iron + 0 factories,
    // buildBudgetForType(forge) returns max(floor(1/2)=0, bootstrap=1) = 1. So forge IS available.
    // To test the "only outpost affordable" path, give the player a higher base count that
    // disables bootstrap (4+ bases triggers perimeter check) but only 1 iron.
    const state: GameState = mkState({
      board: 96,
      basesP0: [hex(0, 5, -5), hex(5, 0, -5), hex(0, -5, 5), hex(-5, 5, 0)], // 4-base perimeter (no bootstrap)
      basesP1: [hex(20, -20, 0)],
      iron: [hex(0, 0, 0)], // single iron INSIDE the perimeter → R=1
      config: cfg,
    });
    const acts = legalActions(state);
    const baseBuilds = acts.filter((a): a is Extract<Action, { kind: "build" }> =>
      a.kind === "build" && a.pieces[0]?.type === "base",
    );
    // Should have ONLY outpost-typed actions (R=1, outpost cost=1, forge cost=2, watchtower cost=4).
    const subtypes = new Set(baseBuilds.map((b) => b.pieces[0]!.baseType ?? "forge"));
    expect(subtypes.has("outpost")).toBe(true);
    expect(subtypes.has("forge")).toBe(false);
    expect(subtypes.has("watchtower")).toBe(false);
  });
});
