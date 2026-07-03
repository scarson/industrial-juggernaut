// ABOUTME: Renders a player's shape+pattern+color identity as a pure SVG primitive sized to a
// ABOUTME: hex cell — the "token top" drawn at a hex's center. No game logic, no ARIA (caller owns semantics).
import { useId } from "react";
import { color } from "../design/tokens";
import type { PlayerIdentity, PlayerPattern, PlayerShape } from "./player-identity";

export interface PlayerShapeIconProps {
  readonly identity: PlayerIdentity;
  /** Radius in px the circle shape fits within; other shapes are scaled to match its filled area. */
  readonly size: number;
  /**
   * Where the icon's visual center should land in the parent SVG's coordinate space. When
   * provided, the nested `<svg>` is positioned (via its `x`/`y` attributes) so the shape drawn
   * at its own center appears centered on this point — the caller does not need to offset by
   * `size` itself. When omitted, the nested `<svg>` is left unpositioned for standalone
   * rendering.
   */
  readonly center?: { x: number; y: number };
}

/**
 * A player's shape+pattern+color drawn as SVG, sized to fit inside a hex cell of the given
 * radius. Shape and pattern are redundant, independently-readable channels alongside color
 * (PRODUCT.md: player identity is never color alone) — the shape's fill carries color, and
 * the pattern overlay carries the third channel as a stroke/mark treatment on top.
 */
export function PlayerShapeIcon({ identity, size, center }: PlayerShapeIconProps) {
  const patternId = usePatternId(identity.pattern);
  // The box half-extent must clear the largest scaled circumradius (six-point, see
  // AREA_NORMALIZED_SCALE) so no shape clips its own icon — see ICON_HALF_EXTENT_FACTOR.
  const halfExtent = size * ICON_HALF_EXTENT_FACTOR;
  const boxSize = halfExtent * 2;
  const cx = halfExtent;
  const cy = halfExtent;
  const shapeRadius = size * 0.8 * AREA_NORMALIZED_SCALE[identity.shape];
  const positionProps =
    center === undefined ? {} : { x: center.x - halfExtent, y: center.y - halfExtent };

  return (
    <svg {...positionProps} width={boxSize} height={boxSize} viewBox={`0 0 ${boxSize} ${boxSize}`}>
      <defs>
        <PatternDef id={patternId} pattern={identity.pattern} />
      </defs>
      <ShapeElement
        shape={identity.shape}
        cx={cx}
        cy={cy}
        radius={shapeRadius}
        fill={identity.colorVar}
        stroke={identity.colorVar}
      />
      <ShapeElement shape={identity.shape} cx={cx} cy={cy} radius={shapeRadius} fill={`url(#${patternId})`} />
    </svg>
  );
}

/**
 * Per-shape circumradius scale, applied on top of the circle's baseline radius (`size * 0.8`)
 * so every shape's FILLED AREA matches the circle's at the same `size` (PRODUCT.md #4:
 * identity must be legible at a glance — a diamond and a triangle drawn at equal circumradius
 * fill wildly different areas and read as different visual weights).
 *
 * scale = sqrt(circleArea / shapeArea), where each shapeArea is the exact area of the polygon
 * `shapePoints()` draws at circumradius 1 (verified against the shoelace formula over the
 * actual rendered points, not just the closed-form derivation below):
 *   - circle:      pi * r^2                                     (baseline, scale 1)
 *   - square:      regularPolygonPoints(..., 4, 45)  is a square with diagonal 2r -> 2r^2
 *   - diamond:     regularPolygonPoints(..., 4, 0)   is the same square rotated 45 deg -> 2r^2
 *   - triangle:    equilateral triangle, circumradius r -> (3*sqrt(3)/4) r^2
 *   - pentagon:    regular pentagon, circumradius r  -> (5/2) r^2 sin(72 deg)
 *   - six-point:   sixPointStarPoints draws a 12-gon alternating outer radius R and inner
 *                  radius 0.42*R every 30 deg; that's 12 congruent triangles from the center,
 *                  each with included angle 30 deg between adjacent radii R and 0.42*R:
 *                  area = 12 * (1/2) * R * (0.42*R) * sin(30 deg) = 1.26 * R^2
 */
const AREA_NORMALIZED_SCALE: Record<PlayerShape, number> = {
  circle: 1,
  square: 1.253314,
  triangle: 1.55512,
  diamond: 1.253314,
  pentagon: 1.149481,
  "six-point": 1.579027,
};

/**
 * The nested icon `<svg>`'s half-extent as a multiple of `size`. Must be >= the largest
 * scaled circumradius fraction (`0.8 * max(AREA_NORMALIZED_SCALE)`, currently six-point at
 * 0.8 * 1.579027 =~ 1.263) so the widest shape's polygon doesn't clip the icon's own box;
 * the 1.3 constant leaves a small margin for the 1px identity stroke drawn on the shape edge.
 */
const ICON_HALF_EXTENT_FACTOR = 1.3;

function usePatternId(pattern: PlayerPattern): string {
  const reactId = useId();
  return `player-pattern-${pattern}-${reactId}`;
}

interface ShapeElementProps {
  readonly shape: PlayerShape;
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
  readonly fill: string;
  readonly stroke?: string;
}

/**
 * The shape's outline as a `<circle>`/`<polygon>`, reused for both the color fill (primary
 * channel) and the pattern overlay (third channel) so the two stay geometrically identical.
 */
function ShapeElement({ shape, cx, cy, radius, fill, stroke }: ShapeElementProps) {
  const strokeProps = stroke === undefined ? {} : { stroke, strokeWidth: 1 };

  if (shape === "circle") {
    return <circle cx={cx} cy={cy} r={radius} fill={fill} {...strokeProps} />;
  }
  return <polygon points={shapePoints(shape, cx, cy, radius)} fill={fill} {...strokeProps} />;
}

function shapePoints(shape: Exclude<PlayerShape, "circle">, cx: number, cy: number, radius: number): string {
  switch (shape) {
    case "square":
      return regularPolygonPoints(cx, cy, radius, 4, 45);
    case "triangle":
      return regularPolygonPoints(cx, cy, radius, 3, -90);
    case "diamond":
      return regularPolygonPoints(cx, cy, radius, 4, 0);
    case "pentagon":
      return regularPolygonPoints(cx, cy, radius, 5, -90);
    case "six-point":
      return sixPointStarPoints(cx, cy, radius, radius * 0.42);
  }
}

function regularPolygonPoints(
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  startAngleDeg: number,
): string {
  const points: string[] = [];
  for (let i = 0; i < sides; i++) {
    const angle = startAngleDeg + (360 / sides) * i;
    points.push(pointAt(cx, cy, radius, angle));
  }
  return points.join(" ");
}

function sixPointStarPoints(cx: number, cy: number, outerRadius: number, innerRadius: number): string {
  const points: string[] = [];
  for (let i = 0; i < 12; i++) {
    const angle = -90 + i * 30;
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    points.push(pointAt(cx, cy, radius, angle));
  }
  return points.join(" ");
}

function pointAt(cx: number, cy: number, radius: number, angleDeg: number): string {
  const angleRad = (angleDeg * Math.PI) / 180;
  const x = cx + radius * Math.cos(angleRad);
  const y = cy + radius * Math.sin(angleRad);
  return `${round(x)},${round(y)}`;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

interface PatternDefProps {
  readonly id: string;
  readonly pattern: PlayerPattern;
}

/**
 * The SVG `<pattern>` tile for a player's pattern channel. Each tile is deliberately small
 * and simple so the mark reads at hex-token size rather than dissolving into noise. Marks
 * are drawn in ink (not the player color) since they sit on top of the color fill below.
 */
function PatternDef({ id, pattern }: PatternDefProps) {
  const tile = 6;
  const markColor = color("ink900");

  switch (pattern) {
    case "solid":
      return <pattern id={id} width={tile} height={tile} patternUnits="userSpaceOnUse" />;
    case "ring":
      return (
        <pattern id={id} width={tile} height={tile} patternUnits="userSpaceOnUse">
          <circle cx={tile / 2} cy={tile / 2} r={tile / 2 - 1} fill="none" stroke={markColor} strokeWidth={0.75} />
        </pattern>
      );
    case "dots":
      return (
        <pattern id={id} width={tile} height={tile} patternUnits="userSpaceOnUse">
          <circle cx={tile / 2} cy={tile / 2} r={1} fill={markColor} />
        </pattern>
      );
    case "hatch":
      return (
        <pattern id={id} width={tile} height={tile} patternUnits="userSpaceOnUse">
          <line x1={0} y1={tile} x2={tile} y2={0} stroke={markColor} strokeWidth={1} />
        </pattern>
      );
    case "cross":
      return (
        <pattern id={id} width={tile} height={tile} patternUnits="userSpaceOnUse">
          <line x1={0} y1={tile / 2} x2={tile} y2={tile / 2} stroke={markColor} strokeWidth={1} />
          <line x1={tile / 2} y1={0} x2={tile / 2} y2={tile} stroke={markColor} strokeWidth={1} />
        </pattern>
      );
    case "checker":
      return (
        <pattern id={id} width={tile} height={tile} patternUnits="userSpaceOnUse">
          <rect x={0} y={0} width={tile / 2} height={tile / 2} fill={markColor} />
          <rect x={tile / 2} y={tile / 2} width={tile / 2} height={tile / 2} fill={markColor} />
        </pattern>
      );
  }
}
