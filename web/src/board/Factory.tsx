// ABOUTME: The factory glyph drawn on a hex — an ink smokestack mark for an unowned factory on
// ABOUTME: the parchment map. Factories are shared board state, so they carry no player color.
import { color } from "../design/tokens";

export interface FactoryProps {
  /** The glyph's center in the parent SVG's coordinate space (the hex's pixel center). */
  readonly center: { x: number; y: number };
  /** The hex radius; the glyph is sized as a fraction of it. */
  readonly size: number;
  /** Canonical hexKey of the hex this factory sits on — used for the `data-factory` hook. */
  readonly hexKey: string;
}

/**
 * A factory as engraved ink on the map: a squat building block with a chimney, drawn in ink
 * so it reads as map annotation. Factories are unowned board state (they gate victory but
 * belong to no player), so the glyph never carries a player color.
 */
export function Factory({ center, size, hexKey }: FactoryProps) {
  const w = size * 0.5;
  const h = size * 0.42;
  const ink = color("ink900");
  const left = center.x - w / 2;
  const top = center.y - h / 2;
  const chimneyW = w * 0.22;
  const chimneyH = h * 0.55;

  return (
    <g data-factory={hexKey} fill={ink} stroke={ink} strokeWidth={size * 0.03}>
      {/* The building body. */}
      <rect x={left} y={top} width={w} height={h} fill="none" />
      {/* The chimney rising from the left of the body. */}
      <rect x={left + w * 0.14} y={top - chimneyH} width={chimneyW} height={chimneyH} />
      {/* A saw-tooth roofline mark to read as "works" rather than a plain box. */}
      <line x1={left} y1={center.y} x2={left + w} y2={center.y} strokeWidth={size * 0.025} />
    </g>
  );
}
