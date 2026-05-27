// ABOUTME: Builds the oval (elliptical) landmass and computes per-hex ring depth from the board edge.
// ABOUTME: Deterministic shape generation; ring depth feeds the iron-placement CSP (iron only where depth >= 2).

import { hex, key, neighbors } from "../geometry/cube";
import type { Hex } from "../engine/types";

// Aspect ratio: wider than tall, an "oval continent".
const ASPECT = 1.3;

// Count the hexes inside the ellipse with half-axes (A, B).
function countInside(A: number, B: number): Hex[] {
  const out: Hex[] = [];
  // Bounding region: axial q in [-A, A], r in [-B, B] (with generous margin).
  const qMax = Math.ceil(A) + 1;
  const rMax = Math.ceil(B) + 1;
  for (let r = -rMax; r <= rMax; r++) {
    for (let q = -qMax; q <= qMax; q++) {
      const cx = q + r / 2;
      const cy = r;
      if ((cx / A) ** 2 + (cy / B) ** 2 <= 1) {
        const z = r;
        const x = q;
        const y = -x - z;
        out.push(hex(x, y, z));
      }
    }
  }
  // Deterministic order: sort by (r, q) i.e. (z, x).
  out.sort((a, b) => a.z - b.z || a.x - b.x);
  return out;
}

export function ovalHexes(size: number): Hex[] {
  // Estimate from ellipse area in hex units: pi * A * B ~ size, A = ASPECT * B.
  let B = Math.sqrt(size / (Math.PI * ASPECT));
  let A = ASPECT * B;

  let best = countInside(A, B);
  // Deterministic search: nudge A,B together until count is within +/-6 of size.
  const step = 0.02;
  let guard = 0;
  while ((best.length < size - 6 || best.length > size + 6) && guard < 2000) {
    if (best.length < size - 6) {
      B += step;
    } else {
      B -= step;
    }
    A = ASPECT * B;
    best = countInside(A, B);
    guard++;
  }
  return best;
}

// How many rings IN from the board edge `h` sits.
// depth = (min single-hex steps from h to ANY off-board hex) - 1.
export function ringDepthFromEdge(h: Hex, board: Hex[]): number {
  const onBoard = new Set(board.map(key));
  // BFS from h until we reach a hex NOT on the board; that distance - 1 is depth.
  const visited = new Set<string>([key(h)]);
  let frontier: Hex[] = [h];
  let dist = 0;
  while (frontier.length > 0) {
    const next: Hex[] = [];
    for (const cur of frontier) {
      for (const nb of neighbors(cur)) {
        const k = key(nb);
        if (!onBoard.has(k)) {
          // Reached an off-board hex at distance dist+1; depth = (dist+1) - 1.
          return dist;
        }
        if (!visited.has(k)) {
          visited.add(k);
          next.push(nb);
        }
      }
    }
    frontier = next;
    dist++;
  }
  // Fully enclosed board with no off-board frontier (should not happen): treat
  // as deeply interior.
  return dist;
}
