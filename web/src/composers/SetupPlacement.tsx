// ABOUTME: The setup-placement composer — during first-base placement (phase.turn===0), highlights
// ABOUTME: the drawn player's legal outer-ring hexes and submits placeFirstBase on a click.
import { currentPlayer } from "../engine-client/barrel";
import { highlightSets } from "../board/highlight";
import { keyToHex } from "../board/projection";
import { playerIdentity } from "../identity/player-identity";
import { PlayerShapeIcon } from "../identity/shapes";
import type { GameState, PlayerId } from "../engine-client/barrel";
import type { GameDriver } from "../game/driver";
import type { GameStore } from "../game/store";

export interface SetupPlacementProps {
  /** The authoritative state to place against — callers mount this only while `state.phase.turn
   *  === 0` (setup); it does not itself branch on turn number beyond reading `phase.order`. */
  readonly state: GameState;
  /** The seat this instance renders for. Unlike `BuildComposer`/`AttackComposer` (which callers
   *  mount only once `currentPlayer(state) === player` already holds, since a play-phase turn
   *  belongs to exactly one composer instance), setup has up to 6 seats placing in sequence
   *  before the first round exists — P3.11 mounts ONE `SetupPlacement` per controllable seat for
   *  the whole setup phase, and this component itself decides, from `currentPlayer(state)` and
   *  `driver.controllableSeats()`, whether `player`'s click affordance or the waiting state
   *  shows. */
  readonly player: PlayerId;
  /** Submits the eventual `{type:"placeFirstBase", hex}` command. */
  readonly driver: GameDriver;
  /** Accepted for prop-contract parity with `BuildComposer`/`AttackComposer` — first-base
   *  placement has no optimistic preview to stage (a single click submits immediately, no
   *  multi-piece staging step exists to preview), so this is unused today. */
  readonly store: GameStore;
}

/**
 * Hex selection here is a highlighted-hex-button list (`data-testid="placement-hex-<key>"`), NOT
 * the SVG board — routing a real `Board` click into this composer is P3.11's job, the same split
 * `BuildComposer`/`AttackComposer` document for their own hex selection.
 */
export function SetupPlacement({ state, player, driver }: SetupPlacementProps) {
  const order = state.phase.order;
  const acting = currentPlayer(state);
  const controllableNow = acting === player && driver.controllableSeats().includes(player);
  const placementHexes = highlightSets(state).placementHexes;

  function place(hex: { x: number; y: number; z: number }) {
    driver.submit({ type: "placeFirstBase", hex });
  }

  return (
    <section className="table-panel" aria-label="Setup placement" style={PANEL_STYLE}>
      <div role="group" aria-label="Placement order" style={ORDER_ROW_STYLE}>
        {order.map((seat) => (
          <span key={seat} style={ORDER_ENTRY_STYLE}>
            <PlayerShapeIcon identity={playerIdentity(seat)} size={10} />
          </span>
        ))}
      </div>

      <p className="mono" data-testid="setup-turn-indicator" style={TURN_INDICATOR_STYLE}>
        Player {acting} to place
      </p>

      <p className="mono" role="note" style={NOTE_STYLE}>
        First-base placement is a free choice of any hex on the outer ring (Ruling #6) — the
        printed rule&rsquo;s seating convention does not translate to a screen.
      </p>

      {controllableNow ? (
        <div role="group" aria-label="Legal placement hexes" style={HEX_LIST_STYLE}>
          {[...placementHexes].map((keyStr) => {
            const hex = keyToHex(keyStr);
            return (
              <button
                key={keyStr}
                type="button"
                className="chrome-button mono"
                data-testid={`placement-hex-${keyStr}`}
                onClick={() => place(hex)}
              >
                {keyStr}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="mono" style={WAITING_STYLE}>
          Waiting for player {acting} to place their first base…
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
const ORDER_ROW_STYLE: React.CSSProperties = { display: "flex", gap: "0.4rem" };
const ORDER_ENTRY_STYLE: React.CSSProperties = { display: "inline-flex" };
const TURN_INDICATOR_STYLE: React.CSSProperties = { margin: 0 };
const NOTE_STYLE: React.CSSProperties = {
  margin: 0,
  fontSize: "0.8rem",
  color: "var(--color-parchment-300)",
  borderLeft: "2px solid var(--accent)",
  paddingLeft: "0.6rem",
};
const WAITING_STYLE: React.CSSProperties = { margin: 0, color: "var(--color-parchment-300)" };
const HEX_LIST_STYLE: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: "0.35rem" };
