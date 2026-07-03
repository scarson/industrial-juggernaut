// ABOUTME: CombatReveal — the earned combat set piece, driven by the authoritative `combat`
// ABOUTME: GameEvent. Honest committed count + odds stay visible in mono throughout the drama.
import { prefersReducedMotion } from "../../design/motion";
import { ComposerPanel } from "../../composers/shell";
import type { GameEvent } from "../../engine-client/barrel";

export interface CombatRevealProps {
  /** The authoritative combat event this set piece stages. P3.11 mounts this when a `combat`
   *  `GameEvent` arrives in an `applied` batch on the event stream. */
  readonly event: Extract<GameEvent, { kind: "combat" }>;
}

/**
 * Stages a single combat resolution: the real committed count and the attacker's win/loss,
 * exactly as the `combat` `GameEvent` reports them (spec: `{ target, committed, attackerWon }`
 * — this component renders only those fields; it does not compute or infer odds itself). The
 * numbers ride the mono face per DESIGN.md's Honest Numbers Rule — the animation is staging, not
 * obfuscation, so the count/outcome are present and legible in both the animated and reduced
 * branches. The moment's title ("Combat") is the one place this component spends the Cartouche
 * display serif, per DESIGN.md's Cartouche Rule (combat resolution is on the sanctioned list).
 *
 * Reduced motion (`prefersReducedMotion()`) swaps the animated reveal class for an instant final
 * state plus a `data-testid="combat-reveal-static"` summary line — no animation class renders in
 * that branch (PRODUCT.md: reduced motion is not optional).
 */
export function CombatReveal({ event }: CombatRevealProps) {
  const reduced = prefersReducedMotion();
  const rootClassName = reduced ? "combat-reveal" : "combat-reveal combat-reveal-animated";
  const outcome = event.attackerWon
    ? "The attacker wins and captures the target."
    : "The attacker loses — the defender holds.";

  return (
    <ComposerPanel ariaLabel="Combat resolution">
      <div data-testid="combat-reveal" className={rootClassName}>
        <h2 className="cartouche" style={TITLE_STYLE}>
          Combat
        </h2>
        <p className="mono" data-testid="combat-reveal-committed" style={NUMBER_STYLE}>
          {event.committed} committed
        </p>
        <p data-testid="combat-reveal-outcome" style={OUTCOME_STYLE}>
          {outcome}
        </p>
        {reduced && (
          <p className="mono" data-testid="combat-reveal-static" style={SUMMARY_STYLE}>
            {event.committed} committed — {event.attackerWon ? "attacker wins" : "attacker loses"}.
          </p>
        )}
      </div>
    </ComposerPanel>
  );
}

const TITLE_STYLE: React.CSSProperties = { margin: 0 };
const NUMBER_STYLE: React.CSSProperties = { margin: 0, fontSize: "1.1rem" };
const OUTCOME_STYLE: React.CSSProperties = { margin: 0 };
const SUMMARY_STYLE: React.CSSProperties = { margin: 0, color: "var(--color-parchment-300)" };
