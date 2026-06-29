import { describe, it, expect } from "vitest";
import { hex, key } from "../../src/geometry/cube";
import { control, resourceCount } from "../../src/engine/control";
import { mkState } from "../helpers/state";

describe("control", () => {
  it("radiating: union of 5-hex disks for <4 bases", () => {
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)] });
    const ctl = control(s, 0);
    expect(ctl.hexes.has(key(hex(0, 0, 0)))).toBe(true);
    expect(ctl.hexes.has(key(hex(5, -5, 0)))).toBe(true);
    expect(ctl.hexes.has(key(hex(6, -6, 0)))).toBe(false);
  });
  it("two still-radiating players both control a shared overlap iron", () => {
    // p0 base (0,0,0), p1 base (8,-8,0); iron (4,-4,0) is distance 4 from each (<= radius 5).
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(8, -8, 0)], iron: [hex(4, -4, 0)] });
    expect(control(s, 0).iron.map(key)).toContain(key(hex(4, -4, 0)));
    expect(control(s, 1).iron.map(key)).toContain(key(hex(4, -4, 0)));
  });
  it("perimeter regime activates at 4 bases (R1 interior)", () => {
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0), hex(4, -4, 0), hex(4, 0, -4), hex(0, 4, -4)] });
    expect(control(s, 0).hexes.has(key(hex(2, -2, 0)))).toBe(true);
  });
  it("R3: colinear 4 bases => no enclosed territory, falls back to radiating", () => {
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0), hex(1, -1, 0), hex(2, -2, 0), hex(3, -3, 0)] });
    expect(control(s, 0).hexes.has(key(hex(0, 4, -4)))).toBe(true);
  });

  // Structural: resourceCount sums controlled iron + factories.
  it("resourceCount sums controlled iron and factories", () => {
    const s = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      iron: [hex(4, -4, 0), hex(0, 4, -4)],
      factories: [hex(0, 0, 0)],
    });
    // both iron hexes are within radius 5 of (0,0,0); the factory at (0,0,0) too.
    expect(resourceCount(s, 0)).toBe(3);
  });

  // Structural: perimeter is recomputed each call (GEO-5) — same inputs, same result.
  it("recomputes from bases each call (no caching)", () => {
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0), hex(4, -4, 0), hex(4, 0, -4), hex(0, 4, -4)] });
    const a = control(s, 0);
    const b = control(s, 0);
    expect([...a.hexes].sort()).toEqual([...b.hexes].sort());
  });

  // DER #17: a radiating player does NOT command iron that sits inside a non-ally
  // opponent's valid perimeter — the perimetered player claims it exclusively.
  it("radiating player excludes iron inside a non-ally opponent's perimeter (DER #17)", () => {
    const ironHex = hex(0, 0, 0);
    const p1Bases = [hex(2, -2, 0), hex(-2, 2, 0), hex(2, 0, -2), hex(-2, 0, 2)]; // hull enclosing origin
    const p0Base = hex(5, 0, -5); // dist 5 to origin (<= radius 5), outside p1's hull
    const s = mkState({ board: 96, basesP0: [p0Base], basesP1: p1Bases, iron: [ironHex] });
    // Territory is unchanged: p0's disk still reaches the iron hex.
    expect(control(s, 0).hexes.has(key(ironHex))).toBe(true);
    // But the iron is NOT p0's — it sits inside perimetered p1's hull.
    expect(control(s, 0).iron.map(key)).not.toContain(key(ironHex));
    // The perimetered owner keeps it.
    expect(control(s, 1).iron.map(key)).toContain(key(ironHex));
  });

  it("ally perimeter does NOT subtract a radiating member's iron (coalition keeps it)", () => {
    const ironHex = hex(0, 0, 0);
    const p1Bases = [hex(2, -2, 0), hex(-2, 2, 0), hex(2, 0, -2), hex(-2, 0, 2)];
    const p0Base = hex(5, 0, -5);
    const base = mkState({ board: 96, basesP0: [p0Base], basesP1: p1Bases, iron: [ironHex] });
    // Make p0 and p1 mutual allies (alliance includes self by convention). Build
    // immutably — do NOT assign s.players[i].alliance in place.
    const s = {
      ...base,
      players: base.players.map((p) =>
        p.id === 0 ? { ...p, alliance: [0, 1] } : p.id === 1 ? { ...p, alliance: [1, 0] } : p,
      ),
    };
    // Radiating p0 keeps the iron because the perimeter belongs to an ally.
    expect(control(s, 0).iron.map(key)).toContain(key(ironHex));
  });

  it("factories inside a non-ally opponent's perimeter are excluded for a radiating player", () => {
    const facHex = hex(0, 0, 0);
    const p1Bases = [hex(2, -2, 0), hex(-2, 2, 0), hex(2, 0, -2), hex(-2, 0, 2)];
    const p0Base = hex(5, 0, -5);
    const s = mkState({ board: 96, basesP0: [p0Base], basesP1: p1Bases, factories: [facHex] });
    expect(control(s, 0).factories.map(key)).not.toContain(key(facHex));
    expect(control(s, 1).factories.map(key)).toContain(key(facHex));
  });
});
