// ABOUTME: Sight-line blocking (R2): a center-to-center segment is blocked by a hex only when
// ABOUTME: it crosses that hex's OPEN INTERIOR; corner-grazes and edge-runs do NOT block (GEO-1, GEO-4).

import type { Hex } from "../engine/types";

// Geometry tolerance (GEO-1). All projected-float comparisons use this band;
// nothing here uses `===`/bare </> on projected coordinates.
const EPS = 1e-9;

// FIXED cube->plane projection (pointy-top), copied verbatim from hull.ts so every
// geometry module reasons about the same 2D points:
//   px = sqrt(3) * (h.x + h.z / 2)
//   py = 1.5 * h.z
type Pt = { px: number; py: number };

function project(h: Hex): Pt {
  return { px: Math.sqrt(3) * (h.x + h.z / 2), py: 1.5 * h.z };
}

// Canonical key over the integer lattice (GEO-4): hex membership is by string,
// never by object identity.
function key(h: Hex): string {
  return `${h.x},${h.y},${h.z}`;
}

// Parse a canonical "x,y,z" key (GEO-4) back into a Hex.
function parseKey(k: string): Hex {
  const [x, y, z] = k.split(",").map(Number);
  return { x: x!, y: y!, z: z! };
}

// The 6 corners of the projected hex cell centered at C. With the projection
// above, neighbor spacing is sqrt(3), so the pointy-top Voronoi cell has
// circumradius exactly 1. Corners at angles (pi/6 + k*pi/3), k = 0..5, CCW.
function hexCorners(c: Pt): Pt[] {
  const corners: Pt[] = [];
  for (let k = 0; k < 6; k++) {
    const ang = Math.PI / 6 + (k * Math.PI) / 3;
    corners.push({ px: c.px + Math.cos(ang), py: c.py + Math.sin(ang) });
  }
  return corners;
}

// R2: is the OPEN segment P0->P1 crossing the OPEN INTERIOR of the convex,
// CCW-ordered hexagon with positive length? Liang-Barsky-style half-plane clip:
// maintain [tEnter, tExit] over t in [0,1], intersecting with each of the 6 edge
// half-planes (interior is to the LEFT of each CCW edge). A positive-length chord
// strictly inside the cell means tExit - tEnter > EPS. A pure corner-graze or
// edge-run collapses to tExit - tEnter <= EPS and does NOT block.
function segmentCrossesInterior(p0: Pt, p1: Pt, corners: Pt[]): boolean {
  const dx = p1.px - p0.px;
  const dy = p1.py - p0.py;

  let tEnter = 0;
  let tExit = 1;

  const n = corners.length;
  for (let i = 0; i < n; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % n]!;
    // Inward normal for CCW edge a->b: interior is to the LEFT, i.e. the value
    //   f(P) = cross(a->b, a->P) = ex*(Py-ay) - ey*(Px-ax)  >= 0 inside.
    const ex = b.px - a.px;
    const ey = b.py - a.py;
    // f(P(t)) = num + t*den, where
    //   num = ex*(p0.py - a.py) - ey*(p0.px - a.px)
    //   den = ex*dy - ey*dx
    const num = ex * (p0.py - a.py) - ey * (p0.px - a.px);
    const den = ex * dy - ey * dx;

    if (Math.abs(den) <= EPS) {
      // Segment is parallel to this edge. `num` is the signed distance (scaled)
      // from the segment to the edge line: positive = strictly inside, ~0 = ON
      // the edge line, negative = strictly outside.
      //   - num < -EPS: segment is outside this half-plane => no crossing.
      //   - |num| <= EPS: segment lies ON this edge's supporting line => it runs
      //     ALONG the boundary, never through the OPEN interior (corner/edge
      //     graze, R2) => no positive-length interior chord.
      // Either way the segment cannot cross the open interior via this cell.
      if (num <= EPS) return false;
      // Strictly inside this half-plane: parallel edge imposes no t-bound.
      continue;
    }

    // Solve f = 0 -> t = -num/den. Sign of den says whether increasing t enters
    // or exits this half-plane.
    const t = -num / den;
    if (den > 0) {
      // entering the half-plane as t increases
      if (t > tEnter) tEnter = t;
    } else {
      // leaving the half-plane as t increases
      if (t < tExit) tExit = t;
    }
    if (tExit - tEnter <= EPS) return false; // no positive-length interior chord
  }

  return tExit - tEnter > EPS;
}

/**
 * R2 sight-line blocking.
 *
 * A center-to-center segment a->b is "blocked" by a hex ONLY if the segment
 * crosses that hex's OPEN INTERIOR with positive length. Merely grazing a vertex
 * or running along an edge does NOT block (the corner-graze convention). The two
 * endpoint hexes (a and b) are never blockers.
 *
 * Pure function. No randomness, no runtime deps. All float compares use EPS = 1e-9
 * (GEO-1); hex membership is keyed by canonical "x,y,z" strings (GEO-4).
 */
export function segmentBlocked(a: Hex, b: Hex, blockerKeys: Set<string>): boolean {
  const p0 = project(a);
  const p1 = project(b);
  const keyA = key(a);
  const keyB = key(b);

  for (const bk of blockerKeys) {
    if (bk === keyA || bk === keyB) continue; // endpoints never block
    const c = project(parseKey(bk));
    const corners = hexCorners(c);
    if (segmentCrossesInterior(p0, p1, corners)) return true;
  }

  return false;
}
