// ABOUTME: Tests for type-aware control() — Tactical Depth Phase 2.
// ABOUTME: With baseTypesEnabled, watchtower radiates further than forge, outpost less.

import { describe, expect, it } from "vitest";
import { control, radiusFor } from "../../src/engine/control";
import { defaultConfig } from "../../src/engine/config";
import { mkState } from "../helpers/state";
import { hex } from "../../src/geometry/cube";
import type { GameState } from "../../src/engine/types";

function mk1BaseRadiatingState(): GameState {
  return mkState({
    board: 96,
    basesP0: [hex(0, 0, 0)],
    basesP1: [hex(20, -20, 0)], // far away, doesn't matter
    iron: [hex(1, -1, 0), hex(5, -5, 0), hex(6, -6, 0), hex(7, -7, 0)],
    config: { ...defaultConfig(), radius: 5 },
  });
}

describe("control — type-aware radius (Phase 2)", () => {
  it("radiusFor returns config.radius regardless of type when baseTypesEnabled=false", () => {
    const cfg = { ...defaultConfig(), radius: 5, baseTypesEnabled: false };
    expect(radiusFor(cfg, "forge")).toBe(5);
    expect(radiusFor(cfg, "watchtower")).toBe(5);
    expect(radiusFor(cfg, "outpost")).toBe(5);
  });

  it("radiusFor returns per-type values when baseTypesEnabled=true", () => {
    const cfg = { ...defaultConfig(), radius: 5, baseTypesEnabled: true };
    expect(radiusFor(cfg, "forge")).toBe(5);
    expect(radiusFor(cfg, "watchtower")).toBe(7);
    expect(radiusFor(cfg, "outpost")).toBe(3);
  });

  it("clamps outpost radius at 2 even when config.radius - 2 would be smaller", () => {
    const cfg = { ...defaultConfig(), radius: 2, baseTypesEnabled: true };
    expect(radiusFor(cfg, "outpost")).toBe(2); // max(2, 2-2=0) = 2
  });

  it("with baseTypesEnabled=false, all bases use config.radius (existing behavior unchanged)", () => {
    const base = mk1BaseRadiatingState();
    // Set bases to different types but flag off — should not affect control.
    const players = base.players;
    const bases = base.bases.map((b, i) => (i === 0 ? { ...b, type: "watchtower" as const } : b));
    const state: GameState = { ...base, bases, players };
    const ctl = control(state, 0);
    // Iron at (5,-5,0) is exactly 5 hexes from origin → controlled at radius 5.
    expect(ctl.iron.map((h) => `${h.x},${h.y},${h.z}`)).toContain("5,-5,0");
    // Iron at (6,-6,0) is 6 hexes → NOT controlled (flag off → watchtower irrelevant).
    expect(ctl.iron.map((h) => `${h.x},${h.y},${h.z}`)).not.toContain("6,-6,0");
  });

  it("with baseTypesEnabled=true, a watchtower controls iron at distance 7 (radius=5 + 2)", () => {
    const base = mk1BaseRadiatingState();
    const config = { ...base.config, baseTypesEnabled: true };
    const bases = base.bases.map((b, i) => (i === 0 ? { ...b, type: "watchtower" as const } : b));
    const state: GameState = { ...base, bases, config };
    const ctl = control(state, 0);
    expect(ctl.iron.map((h) => `${h.x},${h.y},${h.z}`)).toContain("7,-7,0");
    // (Iron at (1,-1,0), (5,-5,0), (6,-6,0) trivially within radius 7 too.)
    expect(ctl.iron.length).toBe(4);
  });

  it("with baseTypesEnabled=true, an outpost (radius=3) does NOT control iron at distance 5", () => {
    const base = mk1BaseRadiatingState();
    const config = { ...base.config, baseTypesEnabled: true };
    const bases = base.bases.map((b, i) => (i === 0 ? { ...b, type: "outpost" as const } : b));
    const state: GameState = { ...base, bases, config };
    const ctl = control(state, 0);
    expect(ctl.iron.map((h) => `${h.x},${h.y},${h.z}`)).toContain("1,-1,0"); // dist 1, in
    expect(ctl.iron.map((h) => `${h.x},${h.y},${h.z}`)).not.toContain("5,-5,0"); // dist 5, OUT
    expect(ctl.iron.length).toBe(1);
  });

  it("a mixed-type player (forge + watchtower) gets the UNION of their radius disks", () => {
    const config = { ...defaultConfig(), radius: 5, baseTypesEnabled: true };
    const base = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0), hex(15, -15, 0)],
      basesP1: [hex(30, -30, 0)],
      iron: [
        hex(1, -1, 0),    // near forge at origin (dist 1)
        hex(16, -15, -1), // near watchtower (dist 1)
        hex(22, -15, -7), // 7 hexes from watchtower (in via type bonus), 26 from forge (out)
        hex(8, -8, 0),    // 8 from forge (out), 7 from watchtower (in by type bonus)
      ],
      config,
    });
    const bases = base.bases.map((b, i) => {
      if (i === 0) return { ...b, type: "forge" as const };
      if (i === 1) return { ...b, type: "watchtower" as const };
      return b;
    });
    const state: GameState = { ...base, bases };
    const ctl = control(state, 0);
    const ironKeys = ctl.iron.map((h) => `${h.x},${h.y},${h.z}`);
    expect(ironKeys).toContain("1,-1,0");
    expect(ironKeys).toContain("16,-15,-1");
    expect(ironKeys).toContain("22,-15,-7");
    expect(ironKeys).toContain("8,-8,0");
    expect(ctl.iron.length).toBe(4);
  });

  it("PERIMETER regime (4+ bases) uses the convex hull and IGNORES per-base radius — unchanged by type", () => {
    // 4 forges forming a perimeter: control is the hull interior, independent of any radius.
    const config = { ...defaultConfig(), radius: 5, baseTypesEnabled: true };
    const base = mkState({
      board: 96,
      basesP0: [hex(0, 4, -4), hex(4, 0, -4), hex(0, -4, 4), hex(-4, 4, 0)],
      basesP1: [hex(20, -20, 0)],
      iron: [hex(0, 0, 0)], // inside the hull
      config,
    });
    const bases = base.bases.map((b, i) => (i < 4 ? { ...b, type: "outpost" as const } : b));
    const state: GameState = { ...base, bases };
    const ctl = control(state, 0);
    expect(ctl.perimeter).toBe(true);
    expect(ctl.iron.map((h) => `${h.x},${h.y},${h.z}`)).toContain("0,0,0");
  });
});
