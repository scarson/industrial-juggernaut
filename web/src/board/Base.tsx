// ABOUTME: A base piece on the board — a player's identity token (PlayerShapeIcon) placed at a hex
// ABOUTME: center, with a dimmed/rotated fatigued variant and a stranded mark when flagged.
import { color } from "../design/tokens";
import { playerIdentity } from "../identity/player-identity";
import { PlayerShapeIcon } from "../identity/shapes";
import type { Base as BaseModel } from "../engine-client/barrel";
import { hexKey } from "./projection";

export interface BaseProps {
  readonly base: BaseModel;
  /** The base's center in the parent SVG's coordinate space (its hex's pixel center). */
  readonly center: { x: number; y: number };
  /** The hex radius; the token is sized as a fraction of it, leaving a parchment margin. */
  readonly size: number;
  /** True when this base's hex is in the strandedHexes set — renders the stranded mark. */
  readonly stranded?: boolean;
}

/**
 * A base rendered as its owner's identity token at the hex center. A fatigued base (spent its
 * action this round) reads as dimmed and slightly rotated off-square — a deliberate "toppled
 * counter" cue distinct from a fresh, upright token. A stranded base (cut off from its network)
 * gets an ink caret mark so the at-risk piece reads before the player has to reason about it.
 */
export function Base({ base, center, size, stranded = false }: BaseProps) {
  const identity = playerIdentity(base.owner);
  const fatigued = base.state === "fatigued";
  // The token top fits inside a fraction of the hex so the parchment shows around it.
  const tokenSize = size * 0.62;
  const rotation = fatigued ? 12 : 0;

  return (
    <g
      data-base={hexKey(base.hex)}
      data-owner={base.owner}
      data-state={base.state}
      data-stranded={stranded ? "true" : undefined}
      opacity={fatigued ? 0.55 : 1}
      transform={rotation === 0 ? undefined : `rotate(${rotation} ${center.x} ${center.y})`}
    >
      <PlayerShapeIcon identity={identity} size={tokenSize} center={center} />
      {stranded ? <StrandedMark center={center} size={size} /> : null}
    </g>
  );
}

/**
 * The stranded mark — a small ink caret pinned to the token's upper-right, in ink (not the
 * player color) so it reads as an annotation overlaid on any player's token.
 */
function StrandedMark({ center, size }: { center: { x: number; y: number }; size: number }) {
  const ink = color("ink900");
  const r = size * 0.5;
  const cx = center.x + r * 0.72;
  const cy = center.y - r * 0.72;
  const arm = size * 0.24;
  return (
    <path
      data-stranded-mark="true"
      d={`M ${cx - arm} ${cy - arm} L ${cx} ${cy} L ${cx - arm} ${cy + arm}`}
      fill="none"
      stroke={ink}
      strokeWidth={size * 0.09}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}
