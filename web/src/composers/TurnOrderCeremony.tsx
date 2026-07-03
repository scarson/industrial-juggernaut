// ABOUTME: The turn-order draw ceremony — displays a turnRollover's drawn order, shape-tagged per
// ABOUTME: player, with the DER #12 iron weighting at 2P and a prefers-reduced-motion alternative.
import { prefersReducedMotion } from "../design/motion";
import { playerIdentity } from "../identity/player-identity";
import { PlayerShapeIcon } from "../identity/shapes";
import type { TurnRollover } from "../game/store";

export interface TurnOrderCeremonyProps {
  /** The last `turnRollover` driver event, as folded into `authoritative.turnRollover` by
   *  `game/store.ts`, or `null` before any round has closed. This is DISPLAY DATA ONLY — the
   *  authoritative turn order for gameplay purposes lives in `state.phase.order` (set by
   *  `advanceRound` inside `applyEntry` on the round-closing `applied` entry, which the store
   *  folds independently of this event). `turnRollover` exists solely to carry `ironWeights`,
   *  which `GameState` does not expose anywhere `applyEntry` folds — this component reads `order`
   *  off the rollover only to drive the ceremony's reveal, never as a second source of truth for
   *  what round order actually is. Callers pass `store.getState().authoritative.turnRollover` (or
   *  subscribe to it) — P3.11 decides when/how long this mounts. */
  readonly rollover: TurnRollover | null;
}

/**
 * Renders nothing before the first rollover. When one exists, shows the drawn order as
 * shape-tagged player entries plus, at 2 players (`ironWeights !== null`), the DER #12
 * iron-proportional weighting that justified the draw. Reduced-motion swaps the animated reveal
 * class for a plain static summary line — this component never times an animation itself; it
 * only chooses which class/markup renders, per `prefersReducedMotion()`.
 *
 * Set entirely in the working type (`.mono`/inherited body text), NOT the Cartouche display
 * serif: DESIGN.md's Cartouche Rule reserves that face for the title plate, combat resolution,
 * elimination, and victory (plus map cartouches) — a specific, closed list this ceremony is not
 * on. The turn-order draw is a quieter beat than those; it reads as instrument-panel data (who's
 * up, and the iron math behind it), which is exactly what the mono face is for.
 */
export function TurnOrderCeremony({ rollover }: TurnOrderCeremonyProps) {
  if (rollover === null) return null;

  const { order, ironWeights } = rollover;
  const reduced = prefersReducedMotion();
  const listClassName = reduced ? "mono" : "mono turn-order-animated";

  return (
    <section className="table-panel" aria-label="Turn order draw" style={PANEL_STYLE}>
      <ol role="list" aria-label="Turn order" className={listClassName} style={ORDER_LIST_STYLE}>
        {order.map((seat) => (
          <li key={seat} role="listitem" data-testid={`turn-order-seat-${seat}`} style={ORDER_ENTRY_STYLE}>
            <PlayerShapeIcon identity={playerIdentity(seat)} size={10} />
            <span>{seat}</span>
            {ironWeights !== null && (
              <span className="mono" data-testid={`iron-weight-${seat}`} style={WEIGHT_STYLE}>
                {ironWeights[seat]}
              </span>
            )}
          </li>
        ))}
      </ol>

      {reduced && (
        <p className="mono" data-testid="turn-order-static-summary" style={SUMMARY_STYLE}>
          Order: {order.join(", ")}
        </p>
      )}

      {ironWeights !== null && (
        <p className="mono" role="note" style={NOTE_STYLE}>
          2-player turn order is an iron-proportional first-player draw (Ruling #12).
        </p>
      )}
    </section>
  );
}

const PANEL_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.75rem",
  padding: "0.75rem",
};
const ORDER_LIST_STYLE: React.CSSProperties = {
  display: "flex",
  gap: "0.75rem",
  margin: 0,
  padding: 0,
  listStyle: "none",
};
const ORDER_ENTRY_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.3rem",
};
const WEIGHT_STYLE: React.CSSProperties = { color: "var(--color-parchment-300)" };
const SUMMARY_STYLE: React.CSSProperties = { margin: 0 };
const NOTE_STYLE: React.CSSProperties = {
  margin: 0,
  fontSize: "0.8rem",
  color: "var(--color-parchment-300)",
  borderLeft: "2px solid var(--accent)",
  paddingLeft: "0.6rem",
};
