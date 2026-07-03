// ABOUTME: The forced-pass notice — renders only when legalActions(state) yields exactly the
// ABOUTME: pass action (the current player is stuck), showing the auto-notice and DER #5's
// ABOUTME: voluntary-pass-is-illegal rule line. A notice only: it never submits pass itself.
import { legalActions } from "../engine-client/barrel";
import { explainError } from "../rules/error-explanations";
import type { GameState } from "../engine-client/barrel";
import type { GameDriver } from "../game/driver";

export interface ForcedPassNoticeProps {
  /** The authoritative state to check for a forced pass. */
  readonly state: GameState;
  /** Unused by the notice itself today (no submit path) — kept on the prop contract so a future
   *  explicit "pass" affordance (if one is added) has the driver already threaded through, and so
   *  this component's contract matches its siblings' `{state, driver}` shape. */
  readonly driver: GameDriver;
}

/**
 * Forced-pass detection CONSUMES `legalActions(state)` — it never recomputes `config.allowPass`
 * or the build/attack legality rules itself. `legalActions` already returns exactly
 * `[{kind:"pass"}]` for a stuck player when `allowPass` is off (see `src/engine/legal.ts`'s
 * fallback), which is the sanctioned existence check this component mirrors.
 */
export function ForcedPassNotice({ state }: ForcedPassNoticeProps) {
  const actions = legalActions(state);
  const forced = actions.length === 1 && actions[0]!.kind === "pass";

  if (!forced) return null;

  return (
    <section className="table-panel" aria-label="Forced pass" style={PANEL_STYLE}>
      <p className="mono" role="note" style={NOTE_STYLE}>
        No legal build or attack is available — this round passes automatically.
        {" "}
        {explainError("PASS_NOT_FORCED")}
      </p>
    </section>
  );
}

const PANEL_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.75rem",
  padding: "0.75rem",
};
const NOTE_STYLE: React.CSSProperties = {
  margin: 0,
  fontSize: "0.8rem",
  color: "var(--color-parchment-300)",
  borderLeft: "2px solid var(--accent)",
  paddingLeft: "0.6rem",
};
