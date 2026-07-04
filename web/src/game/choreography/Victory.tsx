// ABOUTME: Victory — the earned victory set piece. Coalition-aware: `winners` may be plural (a
// ABOUTME: shared coalition victory), rendering every winner shape-tagged.
import { prefersReducedMotion } from "../../design/motion";
import { ComposerPanel } from "../../composers/shell";
import { playerIdentity } from "../../identity/player-identity";
import { PlayerShapeIcon } from "../../identity/shapes";
import type { PlayerId } from "../../engine-client/barrel";

export interface VictoryProps {
  /** The authoritative winners. A single id is the common case; more than one is a coalition
   *  victory (spec: `Player.alliance` shares a win). P3.11 mounts this from the `gameOver`
   *  `DriverEvent` (`winners: PlayerId[]`) — a SIBLING of `applied`, not a `GameEvent` nested in
   *  `applied.events`. (The engine's `GameEvent` union declares a `victory` variant, but nothing
   *  ever constructs it; game-over flows through `status()` → the wire `gameOver` message.) */
  readonly winners: readonly PlayerId[];
}

/**
 * Stages the game's end: one winner, or — when `winners` is plural — every member of the
 * winning coalition, each shape-tagged with `playerIdentity`. The moment's title ("Victory" /
 * "Coalition Victory") is set in the Cartouche display serif per DESIGN.md's Cartouche Rule
 * (victory is on the sanctioned list).
 *
 * Reduced motion (`prefersReducedMotion()`) swaps the animated reveal class for an instant final
 * state plus a `data-testid="victory-static"` summary line — no animation class renders in that
 * branch (PRODUCT.md: reduced motion is not optional).
 */
export function Victory({ winners }: VictoryProps) {
  const reduced = prefersReducedMotion();
  const rootClassName = reduced ? "victory" : "victory victory-animated";
  const isCoalition = winners.length > 1;
  const title = isCoalition ? "Coalition Victory" : "Victory";
  const summary = winners.map((id) => `Player ${id + 1}`).join(isCoalition ? " and " : "");

  return (
    <ComposerPanel ariaLabel="Victory">
      <div data-testid="victory" className={rootClassName}>
        <h2 className="cartouche" data-testid="victory-title" style={TITLE_STYLE}>
          {title}
        </h2>
        <div role="list" aria-label="Winners" style={WINNER_ROW_STYLE}>
          {winners.map((id, i) => (
            <div
              key={id}
              role="listitem"
              data-testid={`victory-winner-${id}`}
              // `--i` drives the CSS stagger delay (choreography.css); the winners reveal one
              // after another for a coalition. Cast: custom properties aren't in CSSProperties.
              style={{ ...WINNER_ITEM_STYLE, ["--i"]: i } as React.CSSProperties}
            >
              <PlayerShapeIcon identity={playerIdentity(id)} size={14} />
              <span className="mono">Player {id + 1}</span>
            </div>
          ))}
        </div>
        {reduced && (
          <p className="mono" data-testid="victory-static" style={SUMMARY_STYLE}>
            {isCoalition ? "Shared victory: " : "Winner: "}
            {summary}.
          </p>
        )}
      </div>
    </ComposerPanel>
  );
}

const TITLE_STYLE: React.CSSProperties = { margin: 0 };
const WINNER_ROW_STYLE: React.CSSProperties = { display: "flex", gap: "0.75rem", flexWrap: "wrap" };
const WINNER_ITEM_STYLE: React.CSSProperties = { display: "flex", alignItems: "center", gap: "0.3rem" };
const SUMMARY_STYLE: React.CSSProperties = { margin: 0, color: "var(--color-parchment-300)" };
