// ABOUTME: The territory-fill layer — a translucent player-color wash over each controlled hex, and a
// ABOUTME: two-color diagonal split for contested (2+ controller) overlap zones. Sits over parchment, under glyphs.
import { playerIdentity } from "../identity/player-identity";
import { hexCorners } from "./projection";
import type { Point } from "./projection";
import type { PlayerId } from "../engine-client/barrel";

// The territory wash sits directly on top of the parchment fill and UNDER the ink linework, iron,
// factory, and base layers (Board.tsx paints those after this layer). Its opacity is chosen so the
// player color reads as a claim while the parchment character and the ink glyphs stay legible — the
// board stays parchment (the Parchment-Belongs-to-the-Board Rule), so territory is a wash, not a
// solid tile. Judged in the browser at 96- and 300-hex scales.
const SINGLE_FILL_OPACITY = 0.2;
// Each half of a contested split carries slightly more alpha than a lone wash: two colors sharing
// one hex each get less visual area, so a touch more opacity keeps both readable without either
// half reading as an uncontested claim.
const CONTESTED_FILL_OPACITY = 0.28;

export interface TerritoryProps {
  /** The controlled hex's key (canonical `hexKey`) — the test/inspection handle. */
  readonly hexKey: string;
  /** The controlling player ids in ascending order (`territoryFills`' per-hex list). */
  readonly controllers: PlayerId[];
  /** The hex's pixel center in the parent SVG's coordinate space. */
  readonly center: Point;
  /** The hex circumradius in SVG user units. */
  readonly size: number;
}

/**
 * One controlled hex's fill. A single controller paints a translucent full-hex wash in the
 * player's identity color. Two-or-more controllers (an overlap zone) render as a two-color
 * diagonal split of the two LOWEST controllers — a "shared-credit" treatment that reads as
 * contested rather than as either player's solid claim. All treatments are FILLS with no stroke,
 * so they never collide with the highlight/selection channel (which lives on the Hex stroke).
 */
export function TerritoryFill({ hexKey, controllers, center, size }: TerritoryProps) {
  if (controllers.length === 1) {
    return (
      <polygon
        data-territory={String(controllers[0])}
        data-hex-fill={hexKey}
        points={hexPointsString(hexCorners(center, size))}
        fill={playerIdentity(controllers[0]!).colorVar}
        fillOpacity={SINGLE_FILL_OPACITY}
        stroke="none"
        pointerEvents="none"
      />
    );
  }

  // Contested: split the hex along its 0°<->180° diagonal into two half-polygons, one per
  // controller. hexCorners returns the 6 corners at 0/60/120/180/240/300 degrees, so corners
  // [0,1,2,3] are the lower half (0°->180° sweep) and [3,4,5,0] the upper half.
  const [a, b] = [controllers[0]!, controllers[1]!];
  const corners = hexCorners(center, size);
  const lowerHalf = [corners[0]!, corners[1]!, corners[2]!, corners[3]!];
  const upperHalf = [corners[3]!, corners[4]!, corners[5]!, corners[0]!];

  return (
    <g data-territory="contested" data-hex-fill={hexKey} data-controllers={`${a},${b}`}>
      <polygon
        data-controller={String(a)}
        points={hexPointsString(lowerHalf)}
        fill={playerIdentity(a).colorVar}
        fillOpacity={CONTESTED_FILL_OPACITY}
        stroke="none"
        pointerEvents="none"
      />
      <polygon
        data-controller={String(b)}
        points={hexPointsString(upperHalf)}
        fill={playerIdentity(b).colorVar}
        fillOpacity={CONTESTED_FILL_OPACITY}
        stroke="none"
        pointerEvents="none"
      />
    </g>
  );
}

/** Joins a corner list to an SVG `points="x,y x,y ..."` string. */
function hexPointsString(points: Point[]): string {
  return points.map((c) => `${c.x},${c.y}`).join(" ");
}
