// ABOUTME: Pure cube-coordinate-to-pixel projection for a flat-top hex grid — the geometry
// ABOUTME: layer the SVG board renderer builds on. No React, no DOM, no RNG.
import type { Board, Hex } from "../engine-client/barrel";

export const SQRT3 = Math.sqrt(3);

export type Point = { x: number; y: number };
export type PixelPoint = { px: number; py: number };
export type ViewBox = { minX: number; minY: number; width: number; height: number };

// Canonical string key for a cube hex — `Hex` is a value object, so two equal-but-distinct
// instances must collapse to the same Set/Map key (pitfall GEO-4). Never key by identity.
export function hexKey(hex: Hex): string {
  return `${hex.x},${hex.y},${hex.z}`;
}

// Flat-top axial mapping q=x, r=z (cube's `y` is redundant given x+y+z=0).
// px = size * 1.5 * q
// py = size * SQRT3 * (r + q/2)
// py grows DOWNWARD, matching SVG's y-down coordinate space — pixel coords feed straight
// into <polygon>/<svg> with no sign flip (a "north" neighbor has negative py).
export function hexToPixel(hex: Hex, size: number): PixelPoint {
  const px = size * 1.5 * hex.x;
  const py = size * SQRT3 * (hex.z + hex.x / 2);
  return { px, py };
}

// The 6 corners of a flat-top hex of circumradius `size` centered at `center`, at angles
// 0/60/120/180/240/300 degrees — the point order a <polygon points="..."> attribute expects.
export function hexCorners(center: Point, size: number): Point[] {
  const corners: Point[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i);
    corners.push({
      x: center.x + size * Math.cos(angle),
      y: center.y + size * Math.sin(angle),
    });
  }
  return corners;
}

// The SVG `points="..."` string for a hex centered at `center` — the six corners joined
// as `"x,y x,y ..."`. Hoisted so the corners→points-string mapping lives in ONE place
// instead of being inlined per-cell in the renderer's JSX.
export function hexPoints(center: Point, size: number): string {
  return hexCorners(center, size)
    .map((c) => `${c.x},${c.y}`)
    .join(" ");
}

// Tight bounding box over every hex's polygon, plus one extra hex radius of margin.
// A flat-top hex's horizontal half-extent (center to corner) is `size`; its vertical
// half-extent (center to edge midpoint) is `size * SQRT3 / 2`.
export function boardViewBox(board: Board, size: number): ViewBox {
  const halfExtentX = size;
  const halfExtentY = (size * SQRT3) / 2;

  let minPx = Infinity;
  let maxPx = -Infinity;
  let minPy = Infinity;
  let maxPy = -Infinity;

  for (const hex of board.hexes) {
    const { px, py } = hexToPixel(hex, size);
    minPx = Math.min(minPx, px);
    maxPx = Math.max(maxPx, px);
    minPy = Math.min(minPy, py);
    maxPy = Math.max(maxPy, py);
  }

  const minX = minPx - halfExtentX - size;
  const maxX = maxPx + halfExtentX + size;
  const minY = minPy - halfExtentY - size;
  const maxY = maxPy + halfExtentY + size;

  return { minX, minY, width: maxX - minX, height: maxY - minY };
}
