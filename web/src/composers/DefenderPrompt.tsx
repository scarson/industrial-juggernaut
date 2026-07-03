// ABOUTME: The defender prompt — shown to the seat a pending attack decision targets. Renders the
// ABOUTME: reducer's eligibleDefenders as choices plus a rule line; a Phase-2 deadline adds a
// ABOUTME: countdown and an "I'm still thinking" extend affordance.
import { hexKey } from "../board/projection";
import { explainError } from "../rules/error-explanations";
import type { DriverPending, GameDriver } from "../game/driver";

export interface DefenderPromptProps {
  /** The pending decision to render, already gated to a seat this client controls — `game/store.ts`
   *  only ever sets `authoritative.pending` for a `promptedSeat` in `driver.controllableSeats()`.
   *  `null` means either no decision is outstanding or one is outstanding for another seat; both
   *  render as the waiting state below, since this component has no way (and no need) to tell
   *  them apart. */
  readonly pending: DriverPending | null;
  /** Submits `resolveDecision`/`extendDecision`. */
  readonly driver: GameDriver;
  /** The clock the countdown reads "now" from — injected so tests are deterministic. Defaults to
   *  `Date.now`. */
  readonly now?: () => number;
}

/**
 * `pending.eligibleDefenders` is REDUCER-PROVIDED — this component renders it as-is and NEVER
 * recomputes defender eligibility client-side (the same rule `AttackComposer` follows for
 * `representativeDefender`, but here there is no client-side fallback at all: the prompt exists
 * because the server/reducer already decided who's eligible).
 */
export function DefenderPrompt({ pending, driver, now = Date.now }: DefenderPromptProps) {
  if (pending === null) {
    return (
      <section className="table-panel" aria-label="Defender decision" style={PANEL_STYLE}>
        <p className="mono" style={WAITING_STYLE}>
          Waiting for the defending player…
        </p>
      </section>
    );
  }

  const { decisionId, eligibleDefenders, deadlineEpochMs } = pending;
  const remainingMs = deadlineEpochMs !== null ? deadlineEpochMs - now() : null;
  const remainingSeconds = remainingMs !== null ? Math.max(0, Math.ceil(remainingMs / 1000)) : null;

  function choose(defender: { x: number; y: number; z: number }) {
    driver.submit({ type: "resolveDecision", decisionId, defender });
  }

  function extend() {
    driver.submit({ type: "extendDecision", decisionId });
  }

  return (
    <section className="table-panel" aria-label="Defender decision" style={PANEL_STYLE}>
      <p className="mono" role="note" style={NOTE_STYLE}>
        {explainError("DEFENDER_INELIGIBLE")}
      </p>

      <div role="group" aria-label="Eligible defenders" style={HEX_LIST_STYLE}>
        {eligibleDefenders.map((hex) => {
          const key = hexKey(hex);
          return (
            <button
              key={key}
              type="button"
              className="chrome-button mono"
              data-testid={`defender-choice-${key}`}
              onClick={() => choose(hex)}
            >
              {key}
            </button>
          );
        })}
      </div>

      {remainingSeconds !== null && (
        <div style={COUNTDOWN_ROW_STYLE}>
          <span className="mono" data-testid="defender-countdown">
            {remainingSeconds}
          </span>
          <button type="button" className="chrome-button" onClick={extend}>
            I&rsquo;m still thinking
          </button>
        </div>
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
const WAITING_STYLE: React.CSSProperties = { margin: 0, color: "var(--color-parchment-300)" };
const NOTE_STYLE: React.CSSProperties = {
  margin: 0,
  fontSize: "0.8rem",
  color: "var(--color-parchment-300)",
  borderLeft: "2px solid var(--accent)",
  paddingLeft: "0.6rem",
};
const HEX_LIST_STYLE: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: "0.35rem" };
const COUNTDOWN_ROW_STYLE: React.CSSProperties = { display: "flex", alignItems: "center", gap: "0.75rem" };
