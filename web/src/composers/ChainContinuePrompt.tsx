// ABOUTME: The chain-continue prompt — shown after a landed attack while the acting player may
// ABOUTME: still attack again this round. "Done attacking" submits endRound; "attack again" hands
// ABOUTME: control back to the caller (AttackComposer) without submitting anything itself.
import type { GameDriver } from "../game/driver";

export interface ChainContinuePromptProps {
  /** Submits `endRound`. */
  readonly driver: GameDriver;
  /** Whether a further legal attack exists this round. The caller derives this from
   *  `legalActions(state).some(a => a.kind === "attack")` — the same existence check the reducer's
   *  own auto-close uses (`autoCloseIfNoAttack`, src/session/pending.ts) — rather than this
   *  component re-deriving the "3 fresh in-range attackers" threshold itself. The reducer
   *  auto-closes the round (no prompt reaches the client at all) once that's false; this prop
   *  exists so the component's own rendering is provably driven by the same check, not a second
   *  guess at the rule. */
  readonly canAttackAgain: boolean;
  /** Called when the player chooses to attack again — hands control back to the caller (P3.11's
   *  game screen re-mounts/re-focuses AttackComposer). This component does not itself drive
   *  attack declaration. */
  readonly onAttackAgain: () => void;
}

export function ChainContinuePrompt({ driver, canAttackAgain, onAttackAgain }: ChainContinuePromptProps) {
  function doneAttacking() {
    driver.submit({ type: "endRound" });
  }

  return (
    <section className="table-panel" aria-label="Continue attacking" style={PANEL_STYLE}>
      <div style={BUTTON_ROW_STYLE}>
        {canAttackAgain && (
          <button type="button" className="chrome-button mono" onClick={onAttackAgain}>
            Attack again
          </button>
        )}
        <button type="button" className="chrome-button brass-accent-bg" onClick={doneAttacking}>
          Done attacking
        </button>
      </div>
    </section>
  );
}

const PANEL_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.75rem",
  padding: "0.75rem",
};
const BUTTON_ROW_STYLE: React.CSSProperties = { display: "flex", gap: "0.5rem" };
