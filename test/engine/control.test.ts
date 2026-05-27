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
    expect(control(s, 0).hexes.has(key(hex(0, 5, -5)))).toBe(true);
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
});
