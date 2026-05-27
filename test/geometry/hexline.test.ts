import { describe, it, expect } from "vitest";
import { hex, key } from "../../src/geometry/cube";
import { hexLine } from "../../src/geometry/hexline";

describe("hexLine", () => {
  it("includes both endpoints and is contiguous of length distance+1", () => {
    const line = hexLine(hex(0,0,0), hex(3,-3,0));
    expect(line.map(key)[0]).toBe(key(hex(0,0,0)));
    expect(line.map(key).at(-1)).toBe(key(hex(3,-3,0)));
    expect(line).toHaveLength(4);
  });
  it("is symmetric as a set", () => {
    const a = new Set(hexLine(hex(0,0,0), hex(2,-3,1)).map(key));
    const b = new Set(hexLine(hex(2,-3,1), hex(0,0,0)).map(key));
    expect(a).toEqual(b);
  });
});
