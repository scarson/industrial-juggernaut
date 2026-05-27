// ABOUTME: Convex hull, point-in-hull (R1: on-edge counts as inside), and hull area over hex centers.
// ABOUTME: All predicates use the FIXED pointy-top cube->plane projection and a 1e-9 epsilon (GEO-1).

import type { Hex } from "../engine/types";

// Geometry tolerance (GEO-1). Every orientation / sidedness / on-segment test
// uses this band; projected floats are NEVER compared with `===` or bare </>.
const EPS = 1e-9;

// FIXED cube->plane projection (pointy-top). Used identically by convexHull,
// hexInHull, and hullArea so every predicate reasons about the same 2D points:
//   px = sqrt(3) * (h.x + h.z / 2)
//   py = 1.5 * h.z
type Pt = { px: number; py: number };

function project(h: Hex): Pt {
  return { px: Math.sqrt(3) * (h.x + h.z / 2), py: 1.5 * h.z };
}

// 2D cross product of (b - a) x (c - a). Sign gives orientation:
//   > EPS  => counter-clockwise (left turn)
//   < -EPS => clockwise (right turn)
//   |.| <= EPS => collinear (on the line through a,b) per GEO-1
function cross(a: Pt, b: Pt, c: Pt): number {
  return (b.px - a.px) * (c.py - a.py) - (b.py - a.py) * (c.px - a.px);
}

// Canonical key over the integer lattice (GEO-4) for de-duplicating inputs.
function key(h: Hex): string {
  return `${h.x},${h.y},${h.z}`;
}

// Monotone-chain convex hull over the projected 2D centers. Returns the hull
// VERTICES as Hex[] in CCW order. Degenerate inputs:
//   - 0 / 1 distinct points -> the unique points as-is
//   - all-collinear (incl. 2 distinct points) -> the two extreme points
export function convexHull(points: Hex[]): Hex[] {
  // De-duplicate by lattice identity (GEO-4): repeated centers are one point.
  const seen = new Set<string>();
  const distinct: Hex[] = [];
  for (const p of points) {
    const k = key(p);
    if (!seen.has(k)) {
      seen.add(k);
      distinct.push(p);
    }
  }

  if (distinct.length <= 2) return distinct;

  // Sort by projected (px, py) lexicographically. EPS bands the float compare so
  // that points equal-to-tolerance keep a stable secondary ordering.
  const sorted = distinct.slice().sort((a, b) => {
    const pa = project(a);
    const pb = project(b);
    if (Math.abs(pa.px - pb.px) > EPS) return pa.px - pb.px;
    if (Math.abs(pa.py - pb.py) > EPS) return pa.py - pb.py;
    return 0;
  });

  const proj = new Map<Hex, Pt>();
  for (const h of sorted) proj.set(h, project(h));
  const P = (h: Hex): Pt => proj.get(h)!;

  // Build lower and upper hulls. We POP while the turn is clockwise OR collinear
  // (cross <= EPS) so collinear points never become hull vertices — this yields
  // the two extreme points for an all-collinear input.
  const build = (pts: Hex[]): Hex[] => {
    const h: Hex[] = [];
    for (const p of pts) {
      while (h.length >= 2 && cross(P(h[h.length - 2]!), P(h[h.length - 1]!), P(p)) <= EPS) {
        h.pop();
      }
      h.push(p);
    }
    return h;
  };

  const lower = build(sorted);
  const upper = build(sorted.slice().reverse());

  // Concatenate, dropping each chain's last point (it is the other's first).
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));

  // All-collinear case: both chains collapse so the hull degenerates. Fall back
  // to the two extreme (lexicographically first/last) points.
  if (hull.length <= 2) {
    return [sorted[0]!, sorted[sorted.length - 1]!];
  }

  // monotone-chain (lower then upper) produces CCW order.
  return hull;
}

// Distance test helper: is projected point q on segment a-b (a,b,q collinear
// already established)? Checks q lies within the bounding box of a-b, with EPS.
function onSegment(a: Pt, b: Pt, q: Pt): boolean {
  const minX = Math.min(a.px, b.px) - EPS;
  const maxX = Math.max(a.px, b.px) + EPS;
  const minY = Math.min(a.py, b.py) - EPS;
  const maxY = Math.max(a.py, b.py) + EPS;
  return q.px >= minX && q.px <= maxX && q.py >= minY && q.py <= maxY;
}

// Is h inside-or-on the hull polygon? ON-EDGE COUNTS AS INSIDE (R1).
// Degenerate hulls (0/1/2 vertices, zero area): only points lying exactly on
// the point/segment are "inside". All sidedness uses EPS (GEO-1); no === on floats.
export function hexInHull(h: Hex, hull: Hex[]): boolean {
  const q = project(h);

  if (hull.length === 0) return false;

  if (hull.length === 1) {
    const a = project(hull[0]!);
    return Math.abs(q.px - a.px) <= EPS && Math.abs(q.py - a.py) <= EPS;
  }

  if (hull.length === 2) {
    const a = project(hull[0]!);
    const b = project(hull[1]!);
    // collinear with the segment AND within its extent
    return Math.abs(cross(a, b, q)) <= EPS && onSegment(a, b, q);
  }

  // General polygon. The hull is convex and CCW-ordered. For each edge, the
  // interior lies to the LEFT (cross >= 0). A point is inside-or-on iff it is
  // not strictly to the right of any edge. If it is exactly on an edge line
  // (|cross| <= EPS) and within that edge's extent, it is on the boundary =>
  // inside per R1.
  const n = hull.length;
  const pts = hull.map(project);
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    const c = cross(a, b, q);
    if (c < -EPS) {
      // strictly right of this edge -> outside
      return false;
    }
    if (Math.abs(c) <= EPS) {
      // on this edge's supporting line; inside iff within the edge extent (R1)
      if (onSegment(a, b, q)) return true;
      // collinear but beyond the edge -> outside
      return false;
    }
  }
  // left of (or on) every edge -> strictly interior
  return true;
}

// Shoelace area on the projected vertices; returns the absolute area. A
// degenerate / collinear hull returns exactly 0 (computed area < EPS => 0).
export function hullArea(hull: Hex[]): number {
  if (hull.length < 3) return 0;
  const pts = hull.map(project);
  let sum = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    sum += a.px * b.py - b.px * a.py;
  }
  const area = Math.abs(sum) / 2;
  return area < EPS ? 0 : area;
}
