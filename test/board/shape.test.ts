import { describe, it, expect } from "vitest";
import { ovalHexes, ringDepthFromEdge } from "../../src/board/shape";

describe("board shape", () => {
  it("produces close to the requested hex count", () => {
    const hexes = ovalHexes(96);
    expect(hexes.length).toBeGreaterThanOrEqual(90);
    expect(hexes.length).toBeLessThanOrEqual(102);
  });
  it("ringDepthFromEdge is 0 on the boundary and grows inward", () => {
    const hexes = ovalHexes(96);
    const depths = hexes.map((h) => ringDepthFromEdge(h, hexes));
    expect(Math.min(...depths)).toBe(0);
    expect(Math.max(...depths)).toBeGreaterThanOrEqual(2);
  });
  it("every returned hex satisfies the cube invariant x+y+z===0", () => {
    const hexes = ovalHexes(96);
    expect(hexes.every((h) => h.x + h.y + h.z === 0)).toBe(true);
  });
  it("a center hex has interior depth >= 1", () => {
    const hexes = ovalHexes(96);
    const center = hexes.find((h) => h.x === 0 && h.y === 0 && h.z === 0);
    expect(center).toBeDefined();
    expect(ringDepthFromEdge(center!, hexes)).toBeGreaterThanOrEqual(1);
  });
});
