// ABOUTME: Rasterizes the straight center-to-center segment between two hexes into lattice hexes.
// ABOUTME: Cube-lerp + cube-round (GEO-2) keeps every interpolated point on the x+y+z=0 lattice.

import { hex, distance } from "./cube";
import type { Hex } from "../engine/types";

// Standard cube-round (GEO-2): round each component, then reset the component
// with the largest rounding delta to -(other two) so x+y+z=0 holds exactly.
function cubeRound(x: number, y: number, z: number): Hex {
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);

  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);

  if (dx > dy && dx > dz) {
    rx = -ry - rz;
  } else if (dy > dz) {
    ry = -rx - rz;
  } else {
    rz = -rx - ry;
  }

  return hex(rx, ry, rz);
}

export function hexLine(a: Hex, b: Hex): Hex[] {
  const n = distance(a, b);
  if (n === 0) {
    return [hex(a.x, a.y, a.z)];
  }

  const line: Hex[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    line.push(
      cubeRound(
        a.x + (b.x - a.x) * t,
        a.y + (b.y - a.y) * t,
        a.z + (b.z - a.z) * t,
      ),
    );
  }
  return line;
}
