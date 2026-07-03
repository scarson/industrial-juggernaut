// ABOUTME: The iron-ore glyph drawn on a hex — a small ink lozenge marking a resource deposit on
// ABOUTME: the parchment map. Unowned board state (like factories), so no player color.
import { color } from "../design/tokens";

export interface IronGlyphProps {
  /** The glyph's center in the parent SVG's coordinate space (the hex's pixel center). */
  readonly center: { x: number; y: number };
  /** The hex radius; the glyph is sized as a fraction of it so it reads under the token. */
  readonly size: number;
  /** Canonical hexKey of the hex this deposit sits on — used for the `data-iron` hook. */
  readonly hexKey: string;
}

/**
 * An iron deposit as engraved ink on the map: a filled lozenge (ore lump) with a lighter
 * facet line, drawn in ink so it reads as cartographic annotation rather than a player piece.
 * Iron is unowned board state, so it never carries a player color.
 */
export function IronGlyph({ center, size, hexKey }: IronGlyphProps) {
  const r = size * 0.34;
  const ink = color("ink900");
  const facet = color("ink700");
  // A lozenge (tall diamond): top, right, bottom, left.
  const points = [
    `${center.x},${center.y - r}`,
    `${center.x + r * 0.72},${center.y}`,
    `${center.x},${center.y + r}`,
    `${center.x - r * 0.72},${center.y}`,
  ].join(" ");

  return (
    <g data-iron={hexKey}>
      <polygon points={points} fill={ink} stroke={ink} strokeWidth={size * 0.03} />
      <line
        x1={center.x - r * 0.72}
        y1={center.y}
        x2={center.x + r * 0.72}
        y2={center.y}
        stroke={facet}
        strokeWidth={size * 0.04}
      />
    </g>
  );
}
