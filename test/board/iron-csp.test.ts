import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { seed } from "../../src/rng/pcg";
import { ovalHexes, ringDepthFromEdge } from "../../src/board/shape";
import { placeIron } from "../../src/board/iron-csp";
import { distance, key } from "../../src/geometry/cube";

describe("placeIron CSP", () => {
  const board = ovalHexes(96);
  it("for any seed: 14 iron, none in outer 2 rings, max-degree-1 adjacency", () => {
    fc.assert(fc.property(fc.bigInt({ min: 0n, max: 100000n }), (s) => {
      const { iron } = placeIron(seed(s), board, 14);
      expect(iron).toHaveLength(14);
      for (const h of iron) expect(ringDepthFromEdge(h, board)).toBeGreaterThanOrEqual(2);
      for (const h of iron) {
        const adj = iron.filter((o) => o !== h && distance(h, o) === 1);
        expect(adj.length).toBeLessThanOrEqual(1); // max degree 1
      }
    }), { numRuns: 200 });
  });
  it("is deterministic for a fixed seed", () => {
    const board2 = ovalHexes(96);
    const a = placeIron(seed(123n), board2, 14).iron.map(key);
    const b = placeIron(seed(123n), board2, 14).iron.map(key);
    expect(a).toEqual(b);
  });
});
