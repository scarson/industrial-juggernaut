// ABOUTME: Cube-coordinate hex math: constructor, canonical key, distance, add/subtract, neighbors.
// ABOUTME: Foundation of the geometry layer; `key` is THE canonical hex membership key (GEO-4).

import type { Hex } from "../engine/types";

export function hex(x: number, y: number, z: number): Hex {
  if (x + y + z !== 0) {
    throw new Error(`Invalid hex (${x},${y},${z}): components must sum to 0`);
  }
  return { x, y, z };
}

// THE canonical membership key (GEO-4): every Set/Map of hexes keys by this
// string, never by object identity.
export function key(h: Hex): string {
  return `${h.x},${h.y},${h.z}`;
}

export function distance(a: Hex, b: Hex): number {
  return (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z)) / 2;
}

// Component-wise; a sum/difference of two valid hexes is still valid, so we
// build the raw object to avoid a redundant invariant re-check.
export function add(a: Hex, b: Hex): Hex {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function subtract(a: Hex, b: Hex): Hex {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

const DIRECTIONS: readonly Hex[] = [
  { x: 1, y: -1, z: 0 },
  { x: 1, y: 0, z: -1 },
  { x: 0, y: 1, z: -1 },
  { x: -1, y: 1, z: 0 },
  { x: -1, y: 0, z: 1 },
  { x: 0, y: -1, z: 1 },
];

export function neighbors(h: Hex): Hex[] {
  return DIRECTIONS.map((d) => add(h, d));
}
