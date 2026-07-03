// ABOUTME: Pins the flat-top cube-to-pixel projection formula, hex corner geometry, and the
// ABOUTME: viewBox padding math against hand-computed values for small fixed boards (no RNG).
import { describe, expect, test } from "vitest";
import { hexToPixel, hexCorners, hexPoints, boardViewBox, hexKey, keyToHex } from "./projection";
import type { Board } from "../engine-client/barrel";

const SQRT3 = Math.sqrt(3);
const SIZE = 10;

describe("hexToPixel", () => {
  test("origin {0,0,0} projects to pixel {0,0}", () => {
    expect(hexToPixel({ x: 0, y: 0, z: 0 }, SIZE)).toEqual({ px: 0, py: 0 });
  });

  test("neighbor {1,0,-1} projects per the flat-top formula (q=x, r=z axial mapping)", () => {
    // px = size * 1.5 * x = 10 * 1.5 * 1 = 15
    // py = size * SQRT3 * (z + x/2) = 10 * SQRT3 * (-1 + 0.5) = -5 * SQRT3
    const { px, py } = hexToPixel({ x: 1, y: 0, z: -1 }, SIZE);
    expect(px).toBe(15);
    expect(py).toBeCloseTo(-5 * SQRT3, 10);
  });

  test("neighbor {0,1,-1} projects per the flat-top formula", () => {
    // px = 10 * 1.5 * 0 = 0
    // py = 10 * SQRT3 * (-1 + 0) = -10 * SQRT3
    const { px, py } = hexToPixel({ x: 0, y: 1, z: -1 }, SIZE);
    expect(px).toBe(0);
    expect(py).toBeCloseTo(-10 * SQRT3, 10);
  });
});

describe("hexCorners", () => {
  test("returns 6 corners at circumradius `size`, centered on the given point, at 0/60/120/180/240/300 degrees", () => {
    const corners = hexCorners({ x: 0, y: 0 }, SIZE);
    expect(corners).toHaveLength(6);
    const expectedAngles = [0, 60, 120, 180, 240, 300];
    for (let i = 0; i < expectedAngles.length; i++) {
      const rad = (expectedAngles[i]! * Math.PI) / 180;
      const corner = corners[i]!;
      expect(corner.x).toBeCloseTo(SIZE * Math.cos(rad), 10);
      expect(corner.y).toBeCloseTo(SIZE * Math.sin(rad), 10);
    }
  });

  test("corners are offset correctly for a non-origin center", () => {
    const center = { x: 15, y: -5 * SQRT3 };
    const corners = hexCorners(center, SIZE);
    // first corner (0 degrees) sits at center.x + size, center.y
    const firstCorner = corners[0]!;
    expect(firstCorner.x).toBeCloseTo(center.x + SIZE, 10);
    expect(firstCorner.y).toBeCloseTo(center.y, 10);
  });
});

describe("hexPoints", () => {
  test("joins the 6 corners as an SVG points string (x,y pairs, space-separated)", () => {
    const points = hexPoints({ x: 0, y: 0 }, SIZE);
    const pairs = points.trim().split(/\s+/);
    expect(pairs).toHaveLength(6);
    // Each token is an "x,y" pair.
    for (const pair of pairs) {
      expect(pair.split(",")).toHaveLength(2);
    }
  });

  test("its points match hexCorners for the same center/size", () => {
    const center = { x: 15, y: -5 * SQRT3 };
    const expected = hexCorners(center, SIZE)
      .map((c) => `${c.x},${c.y}`)
      .join(" ");
    expect(hexPoints(center, SIZE)).toBe(expected);
  });
});

describe("boardViewBox", () => {
  test("covers all hexes in a tiny fixed 3-hex board, padded by one hex radius", () => {
    const board: Board = {
      hexes: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: -1 },
        { x: 0, y: 1, z: -1 },
      ],
      iron: [],
    };

    const viewBox = boardViewBox(board, SIZE);

    // Centers (from hexToPixel): (0,0), (15, -5*SQRT3), (0, -10*SQRT3)
    // Flat-top half-extents: horizontal = size, vertical = size*SQRT3/2
    // minX/maxX/minY/maxY = extreme center +/- half-extent, then padded by one more `size`.
    const hx = SIZE;
    const hy = (SIZE * SQRT3) / 2;
    const expectedMinX = 0 - hx - SIZE;
    const expectedMaxX = 15 + hx + SIZE;
    const expectedMinY = -10 * SQRT3 - hy - SIZE;
    const expectedMaxY = 0 + hy + SIZE;

    expect(viewBox.minX).toBeCloseTo(expectedMinX, 10);
    expect(viewBox.minY).toBeCloseTo(expectedMinY, 10);
    expect(viewBox.width).toBeCloseTo(expectedMaxX - expectedMinX, 10);
    expect(viewBox.height).toBeCloseTo(expectedMaxY - expectedMinY, 10);
  });

  test("single-hex board still gets padded (non-zero width/height)", () => {
    const board: Board = { hexes: [{ x: 0, y: 0, z: 0 }], iron: [] };
    const viewBox = boardViewBox(board, SIZE);
    const hx = SIZE;
    const hy = (SIZE * SQRT3) / 2;
    expect(viewBox.minX).toBeCloseTo(-hx - SIZE, 10);
    expect(viewBox.minY).toBeCloseTo(-hy - SIZE, 10);
    expect(viewBox.width).toBeCloseTo(2 * (hx + SIZE), 10);
    expect(viewBox.height).toBeCloseTo(2 * (hy + SIZE), 10);
  });
});

describe("hexKey", () => {
  test("produces canonical comma-joined string keys for cube coordinates", () => {
    expect(hexKey({ x: 0, y: 0, z: 0 })).toBe("0,0,0");
    expect(hexKey({ x: 1, y: -1, z: 0 })).toBe("1,-1,0");
    expect(hexKey({ x: -2, y: 1, z: 1 })).toBe("-2,1,1");
  });

  test("equal-but-distinct Hex objects produce the same key (GEO-4)", () => {
    const a = { x: 1, y: 0, z: -1 };
    const b = { x: 1, y: 0, z: -1 };
    expect(a).not.toBe(b);
    expect(hexKey(a)).toBe(hexKey(b));
    const set = new Set([hexKey(a), hexKey(b)]);
    expect(set.size).toBe(1);
  });
});

describe("keyToHex", () => {
  test("parses a canonical comma-joined string key back to a numeric Hex — the inverse of hexKey", () => {
    expect(keyToHex("0,0,0")).toEqual({ x: 0, y: 0, z: 0 });
    expect(keyToHex("1,-1,0")).toEqual({ x: 1, y: -1, z: 0 });
    expect(keyToHex("-2,1,1")).toEqual({ x: -2, y: 1, z: 1 });
  });

  test("round-trips through hexKey", () => {
    const hex = { x: 3, y: -5, z: 2 };
    expect(keyToHex(hexKey(hex))).toEqual(hex);
  });
});
