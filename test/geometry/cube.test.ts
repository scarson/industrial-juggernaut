import { describe, it, expect } from "vitest";
import { hex, key, distance, neighbors, add } from "../../src/geometry/cube";

describe("cube", () => {
  it("enforces x+y+z=0 via constructor", () => {
    const h = hex(1, -1, 0); expect(h.x + h.y + h.z).toBe(0);
    expect(() => hex(1, 1, 1)).toThrow();
  });
  it("distance", () => {
    expect(distance(hex(0,0,0), hex(0,0,0))).toBe(0);
    expect(distance(hex(0,0,0), hex(3,-3,0))).toBe(3);
    expect(distance(hex(0,0,0), hex(2,-1,-1))).toBe(2);
  });
  it("has 6 neighbors all at distance 1", () => {
    const ns = neighbors(hex(0,0,0));
    expect(ns).toHaveLength(6);
    for (const n of ns) expect(distance(hex(0,0,0), n)).toBe(1);
  });
  it("key is canonical for value equality", () => {
    expect(key(hex(1,-1,0))).toBe(key(add(hex(0,-1,1), hex(1,0,-1))));
  });
});
