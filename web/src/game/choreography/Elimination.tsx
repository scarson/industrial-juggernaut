// ABOUTME: Elimination — the earned elimination set piece, driven by the authoritative
// ABOUTME: `eliminated` GameEvent. Shows the cause and bounty recipient (when one exists).
import { prefersReducedMotion } from "../../design/motion";
import { ComposerPanel } from "../../composers/shell";
import { eventLine } from "../../hud/event-copy";
import { playerIdentity } from "../../identity/player-identity";
import { PlayerShapeIcon } from "../../identity/shapes";
import type { EliminationCause, GameEvent } from "../../engine-client/barrel";

export interface EliminationProps {
  /** The authoritative eliminated event this set piece stages. P3.11 mounts this when an
   *  `eliminated` `GameEvent` arrives in an `applied` batch on the event stream. */
  readonly event: Extract<GameEvent, { kind: "eliminated" }>;
}

/** Causes that never pay a bounty (spec §8: `emptyPerimeter` is self-inflicted). Mirrors
 *  `hud/event-copy.ts`'s `NO_BOUNTY_CAUSES` (not exported there) — defense in depth so this
 *  component never renders a bounty element for a self-inflicted cause even if `bountyTo` is
 *  wrongly populated upstream. */
const NO_BOUNTY_CAUSES: ReadonlySet<EliminationCause> = new Set(["emptyPerimeter"]);

/**
 * Stages a single elimination: the cause (spec §8's four `EliminationCause`s) and, when the
 * cause pays one, the bounty recipient. The cause phrasing is sourced from `eventLine` (called
 * with `bountyTo` forced to `null` so it returns the cause sentence alone) rather than duplicated
 * here — `hud/event-copy.ts` is the single source of truth for cause-to-English mapping. The
 * bounty line is rendered separately (its own `data-testid`) so the cause and the bounty are two
 * distinct, non-overlapping pieces of on-screen text rather than one sentence with the bounty
 * folded in twice. This component adds the richer staging (shape-tagged player token, the
 * moment's Cartouche title) around that content rather than re-deriving it.
 *
 * Reduced motion (`prefersReducedMotion()`) swaps the animated reveal class for an instant final
 * state plus a `data-testid="elimination-static"` summary line — no animation class renders in
 * that branch (PRODUCT.md: reduced motion is not optional).
 */
export function Elimination({ event }: EliminationProps) {
  const reduced = prefersReducedMotion();
  const rootClassName = reduced ? "elimination" : "elimination elimination-animated";
  const causeLine = eventLine({ ...event, bountyTo: null });
  const identity = playerIdentity(event.player);
  const bountyRecipient =
    event.bountyTo !== null && !NO_BOUNTY_CAUSES.has(event.cause) ? event.bountyTo : null;

  return (
    <ComposerPanel ariaLabel="Elimination">
      <div data-testid="elimination" className={rootClassName}>
        <h2 className="cartouche" style={TITLE_STYLE}>
          Eliminated
        </h2>
        <div style={TOKEN_ROW_STYLE}>
          <PlayerShapeIcon identity={identity} size={12} />
          <p data-testid="elimination-cause" style={CAUSE_STYLE}>
            {causeLine}
          </p>
        </div>
        {bountyRecipient !== null && (
          <p className="mono" data-testid="elimination-bounty" style={BOUNTY_STYLE}>
            Bounty to Player {bountyRecipient + 1}.
          </p>
        )}
        {reduced && (
          <p className="mono" data-testid="elimination-static" style={SUMMARY_STYLE}>
            {causeLine}
            {bountyRecipient !== null && ` Bounty to Player ${bountyRecipient + 1}.`}
          </p>
        )}
      </div>
    </ComposerPanel>
  );
}

const TITLE_STYLE: React.CSSProperties = { margin: 0 };
const TOKEN_ROW_STYLE: React.CSSProperties = { display: "flex", alignItems: "center", gap: "0.5rem" };
const CAUSE_STYLE: React.CSSProperties = { margin: 0 };
const BOUNTY_STYLE: React.CSSProperties = { margin: 0 };
const SUMMARY_STYLE: React.CSSProperties = { margin: 0, color: "var(--color-parchment-300)" };
