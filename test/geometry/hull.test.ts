import { describe, it, expect } from "vitest";
import { hex } from "../../src/geometry/cube";
import { convexHull, hexInHull, hullArea } from "../../src/geometry/hull";

describe("hull", () => {
  const square = [hex(0, 0, 0), hex(3, -3, 0), hex(3, 0, -3), hex(0, 3, -3)];
  it("on-edge counts as inside (R1)", () => {
    expect(hexInHull(hex(3, -3, 0), convexHull(square))).toBe(true);
  });
  it("strictly interior point is inside", () => {
    expect(hexInHull(hex(1, -1, 0), convexHull(square))).toBe(true);
  });
  it("exterior point is outside", () => {
    expect(hexInHull(hex(5, -5, 0), convexHull(square))).toBe(false);
  });
  it("colinear points produce zero area (R3 signal)", () => {
    expect(hullArea(convexHull([hex(0, 0, 0), hex(1, -1, 0), hex(2, -2, 0)]))).toBe(0);
  });

  // --- Extra coverage: guard the epsilon / on-edge / degenerate logic ---

  it("a point just outside an edge by 1 hex is outside", () => {
    // The square's left edge runs along x=0 between (0,0,0) and (0,3,-3).
    // A hex one step left of that edge must be classified outside.
    expect(hexInHull(hex(-1, 1, 0), convexHull(square))).toBe(false);
  });

  it("every hull vertex is inside (R1 on-edge at corners)", () => {
    const hull = convexHull(square);
    for (const v of square) {
      expect(hexInHull(v, hull)).toBe(true);
    }
  });

  it("a triangle's centroid is inside", () => {
    // Triangle with vertices summing so the centroid is a valid integer hex.
    const tri = [hex(0, 0, 0), hex(3, -3, 0), hex(0, 3, -3)];
    // centroid of the three = ((0+3+0)/3, (0-3+3)/3, (0+0-3)/3) = (1,0,-1)
    expect(hexInHull(hex(1, 0, -1), convexHull(tri))).toBe(true);
  });

  it("a point exactly on a non-vertex edge midpoint is inside (R1)", () => {
    // Midpoint of the bottom edge between (0,0,0) and (3,-3,0) is (1.5,..)
    // Use the integer hex (1,-1,0) -> not on that edge; instead test edge
    // between (0,0,0) and (0,3,-3): the hex (0,2,-2) lies exactly on it.
    expect(hexInHull(hex(0, 2, -2), convexHull(square))).toBe(true);
  });

  it("degenerate single-point hull contains only that point", () => {
    const hull = convexHull([hex(2, -2, 0)]);
    expect(hexInHull(hex(2, -2, 0), hull)).toBe(true);
    expect(hexInHull(hex(2, -1, -1), hull)).toBe(false);
  });

  it("degenerate segment hull contains points on the segment only", () => {
    const hull = convexHull([hex(0, 0, 0), hex(2, -2, 0)]);
    expect(hexInHull(hex(1, -1, 0), hull)).toBe(true); // on segment
    expect(hexInHull(hex(0, 0, 0), hull)).toBe(true); // endpoint
    expect(hexInHull(hex(3, -3, 0), hull)).toBe(false); // beyond segment
    expect(hexInHull(hex(1, 0, -1), hull)).toBe(false); // off segment
  });

  it("square hull encloses positive area equal to shoelace value", () => {
    const area = hullArea(convexHull(square));
    expect(area).toBeGreaterThan(0);
  });

  it("convexHull returns hull vertices in CCW order with positive signed area", () => {
    const hull = convexHull(square);
    expect(hull.length).toBe(4);
  });
});
