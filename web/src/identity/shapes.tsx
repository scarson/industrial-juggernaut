// ABOUTME: Renders a player's shape+pattern+color identity as a pure SVG primitive sized to a
// ABOUTME: hex cell — the "token top" drawn at a hex's center. No game logic, no ARIA (caller owns semantics).
import { useId } from "react";
import { color } from "../design/tokens";
import type { PlayerIdentity, PlayerPattern, PlayerShape } from "./player-identity";

export interface PlayerShapeIconProps {
  readonly identity: PlayerIdentity;
  /** Radius in px the shape should fit within, centered in a `2*size` square viewBox. */
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
  const diameter = size * 2;
  const cx = size;
  const cy = size;
  const shapeRadius = size * 0.8;
  const positionProps = center === undefined ? {} : { x: center.x - size, y: center.y - size };

  return (
    <svg {...positionProps} width={diameter} height={diameter} viewBox={`0 0 ${diameter} ${diameter}`}>
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
