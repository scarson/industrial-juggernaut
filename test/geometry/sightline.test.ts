import { describe, it, expect } from "vitest";
import { hex, key } from "../../src/geometry/cube";
import { segmentBlocked } from "../../src/geometry/sightline";

describe("segmentBlocked (R2: block only on open-interior crossing)", () => {
  it("blocked when a blocker hex lies strictly between endpoints", () => {
    const blockers = new Set([key(hex(1, -1, 0))]);
    expect(segmentBlocked(hex(0, 0, 0), hex(2, -2, 0), blockers)).toBe(true);
  });
  it("endpoints themselves never count as blockers", () => {
    const blockers = new Set([key(hex(0, 0, 0)), key(hex(2, -2, 0))]);
    expect(segmentBlocked(hex(0, 0, 0), hex(2, -2, 0), blockers)).toBe(false);
  });
  it("a corner-grazing blocker does not block", () => {
    const blockers = new Set([key(hex(1, 0, -1))]);
    expect(segmentBlocked(hex(0, 0, 0), hex(2, -1, -1), blockers)).toBe(false);
  });

  // --- extra structural tests ---
  it("a blocker entirely off to the side does not block", () => {
    // (0,2,-2) sits well off the (0,0,0)->(2,-2,0) line; no interior crossing.
    const blockers = new Set([key(hex(0, 2, -2))]);
    expect(segmentBlocked(hex(0, 0, 0), hex(2, -2, 0), blockers)).toBe(false);
  });
  it("a blocker whose interior the segment clearly crosses blocks", () => {
    // Longer collinear run (0,0,0)->(3,-3,0); (2,-2,0) is an interior center.
    const blockers = new Set([key(hex(2, -2, 0))]);
    expect(segmentBlocked(hex(0, 0, 0), hex(3, -3, 0), blockers)).toBe(true);
  });
  it("an empty blocker set never blocks", () => {
    expect(segmentBlocked(hex(0, 0, 0), hex(3, -3, 0), new Set())).toBe(false);
  });
  it("only the interior crossing among several blockers triggers a block", () => {
    const blockers = new Set([
      key(hex(0, 2, -2)), // off to the side
      key(hex(1, -1, 0)), // on the line, interior crossing
    ]);
    expect(segmentBlocked(hex(0, 0, 0), hex(2, -2, 0), blockers)).toBe(true);
  });
});
