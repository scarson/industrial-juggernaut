// ABOUTME: One landmass cell — a parchment-filled, ink-stroked hex polygon that parses its own
// ABOUTME: data-hex on click/hover. Highlight and selection are rendered as cell treatments.
import { color } from "../design/tokens";
import { hexPoints, hexKey } from "./projection";
import type { Point } from "./projection";
import type { Hex as HexModel } from "../engine-client/barrel";

/** How a cell is decorated for the active composer. `null` = plain parchment. */
export type HexHighlight = "build" | "attack" | "placement" | null;

export interface HexProps {
  readonly hex: HexModel;
  /** The hex's pixel center in the parent SVG's coordinate space. */
  readonly center: Point;
  /** The hex radius. Absolute value mostly sets stroke-width ratios (the viewBox scales). */
  readonly size: number;
  readonly highlight?: HexHighlight | undefined;
  /** True when this cell is part of the in-progress selection (brass — the scarce accent). */
  readonly selected?: boolean | undefined;
  readonly onHexClick?: ((hex: HexModel) => void) | undefined;
  readonly onHexHover?: ((hex: HexModel | null) => void) | undefined;
}

// Parses a `"x,y,z"` data-hex back to a numeric Hex — the SVG element IS the hit-test target
// (pitfall GEO-2: there is no pixel->hex inverse), so the click handler reads coordinates off
// the clicked element rather than inverting the projection.
function parseHexKey(dataHex: string): HexModel {
  const [x, y, z] = dataHex.split(",").map(Number);
  return { x: x!, y: y!, z: z! };
}

/**
 * A single landmass cell. Parchment fill with ink linework is the map's base material; a
 * highlighted cell tints its fill and thickens its stroke, and a selected cell takes the scarce
 * brass stroke (the Brass Budget Rule — brass is only ever the current selection). The polygon
 * parses its own `data-hex` on interaction so the parent Board wires no per-cell closures.
 */
export function Hex({ hex, center, size, highlight = null, selected = false, onHexClick, onHexHover }: HexProps) {
  const key = hexKey(hex);

  return (
    <polygon
      data-hex={key}
      data-highlight={highlight ?? undefined}
      data-selected={selected ? "true" : undefined}
      points={hexPoints(center, size)}
      fill={fillFor(highlight)}
      stroke={strokeFor(highlight, selected)}
      strokeWidth={strokeWidthFor(highlight, selected) * size}
      onClick={
        onHexClick === undefined
          ? undefined
          : (e) => onHexClick(parseHexKey(e.currentTarget.getAttribute("data-hex")!))
      }
      onPointerEnter={onHexHover === undefined ? undefined : () => onHexHover(hex)}
      onPointerLeave={onHexHover === undefined ? undefined : () => onHexHover(null)}
      style={{ cursor: onHexClick === undefined ? undefined : "pointer" }}
    />
  );
}

// Every highlighted cell tints toward the lit parchment; plain cells are the map base parchment.
// Attack does NOT flood-fill a player color (that would misread as owned territory) — its danger
// hue rides the stroke instead, so the fill stays neutral-lit across all three highlight kinds.
function fillFor(highlight: HexHighlight): string {
  if (highlight !== null) return color("parchment100");
  return color("parchment300");
}

// Selection wins the stroke (the scarce brass accent). Otherwise: attack takes the oxide danger
// hue on its edge (linework, not fill — an annotation channel, never a territory claim), build and
// placement darken to ink-900, and a plain cell uses muted ink-700 linework.
function strokeFor(highlight: HexHighlight, selected: boolean): string {
  if (selected) return color("brass500");
  if (highlight === "attack") return color("oxide");
  if (highlight !== null) return color("ink900");
  return color("ink700");
}

// Stroke width as a fraction of `size` — the viewBox scales, so ratios (not px) are what read.
function strokeWidthFor(highlight: HexHighlight, selected: boolean): number {
  if (selected) return 0.06;
  if (highlight === "attack") return 0.07; // heavier so the danger edge reads without a fill flood
  if (highlight !== null) return 0.045;
  return 0.025;
}
