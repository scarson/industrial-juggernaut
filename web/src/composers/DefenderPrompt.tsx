// ABOUTME: The defender prompt — shown to the seat a pending attack decision targets. Renders the
// ABOUTME: reducer's eligibleDefenders as choices plus a rule line; a Phase-2 deadline adds a
// ABOUTME: countdown and an "I'm still thinking" extend affordance.
import { hexKey } from "../board/projection";
import { ComposerPanel, RuleLine, HexButtonList } from "./shell";
import type { HexButtonItem } from "./shell";
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
      <ComposerPanel ariaLabel="Defender decision">
        <p className="mono" style={WAITING_STYLE}>
          Waiting for the defending player…
        </p>
      </ComposerPanel>
    );
  }

  const { decisionId, eligibleDefenders, deadlineEpochMs } = pending;
  // Pure render of `deadlineEpochMs - now()` — no `setInterval`. That's fine today because
  // `deadlineEpochMs` is always null in P3 (the defender timeout is a Phase-2/P4-rooms feature,
  // see the prop doc above); once P4's SocketDriver wires a real non-null deadline, this MUST
  // gain a `setInterval` (or equivalent) so the countdown actually ticks live instead of only
  // reflecting whatever `now()` happened to read at mount/re-render.
  const remainingMs = deadlineEpochMs !== null ? deadlineEpochMs - now() : null;
  const remainingSeconds = remainingMs !== null ? Math.max(0, Math.ceil(remainingMs / 1000)) : null;

  function choose(defender: { x: number; y: number; z: number }) {
    driver.submit({ type: "resolveDecision", decisionId, defender });
  }

  function extend() {
    driver.submit({ type: "extendDecision", decisionId });
  }

  const defenderItems: HexButtonItem[] = eligibleDefenders.map((hex) => ({ key: hexKey(hex), hex }));

  return (
    <ComposerPanel ariaLabel="Defender decision">
      <RuleLine>Choose which base will defend against this attack.</RuleLine>

      <HexButtonList
        ariaLabel="Eligible defenders"
        testIdPrefix="defender-choice"
        items={defenderItems}
        onSelect={choose}
      />

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
    </ComposerPanel>
  );
}

const WAITING_STYLE: React.CSSProperties = { margin: 0, color: "var(--color-parchment-300)" };
const COUNTDOWN_ROW_STYLE: React.CSSProperties = { display: "flex", alignItems: "center", gap: "0.75rem" };
