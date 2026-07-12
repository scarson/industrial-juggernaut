// ABOUTME: The setup-placement composer — during first-base placement (phase.turn===0), highlights
// ABOUTME: the drawn player's legal outer-ring hexes and submits placeFirstBase on a click.
import { useEffect } from "react";
import { currentPlayer } from "../engine-client/barrel";
import { highlightSets } from "../board/highlight";
import { hexKey, keyToHex } from "../board/projection";
import { playerIdentity } from "../identity/player-identity";
import { PlayerShapeIcon } from "../identity/shapes";
import { ComposerPanel, RuleLine, HexButtonList } from "./shell";
import type { HexButtonItem } from "./shell";
import type { GameState, Hex, PlayerId } from "../engine-client/barrel";
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
  /** Board-click seam: while this seat's placement turn is live, the composer claims the store's
   *  `placement` board channel so a click on a highlighted outer-ring cell places there. Optional —
   *  without a store (older mounts, tests) the hex-button list remains the only path. */
  readonly store?: GameStore;
}

/**
 * Hex selection is the highlighted-hex-button list (`data-testid="placement-hex-<key>"`) — the
 * keyboard/a11y action path — plus, when a `store` is provided, the SVG board itself via the
 * `placement` board-click channel (PlayView routes clicks on `placementHexes` cells here).
 */
export function SetupPlacement({ state, player, driver, store }: SetupPlacementProps) {
  const order = state.phase.order;
  const acting = currentPlayer(state);
  const controllableNow = acting === player && driver.controllableSeats().includes(player);
  const placementHexes = highlightSets(state).placementHexes;

  function place(hex: { x: number; y: number; z: number }) {
    driver.submit({ type: "placeFirstBase", hex });
  }

  // Claim the placement board channel only while THIS seat's turn is live — a waiting instance
  // must not register (its click would submit for the wrong seat and be rejected as NOT_YOUR_TURN).
  useEffect(() => {
    if (store === undefined || !controllableNow) return;
    const legal = placementHexes;
    store.getState().setBoardHandler("placement", (hex: Hex) => {
      if (!legal.has(hexKey(hex))) return;
      driver.submit({ type: "placeFirstBase", hex });
    });
    return () => store.getState().setBoardHandler("placement", null);
  }, [store, controllableNow, placementHexes, driver]);

  const placementItems: HexButtonItem[] = [...placementHexes].map((keyStr) => ({
    key: keyStr,
    hex: keyToHex(keyStr),
  }));

  return (
    <ComposerPanel ariaLabel="Setup placement">
      <div role="group" aria-label="Placement order" style={ORDER_ROW_STYLE}>
        {order.map((seat) => (
          <span key={seat} style={ORDER_ENTRY_STYLE}>
            <PlayerShapeIcon identity={playerIdentity(seat)} size={10} />
          </span>
        ))}
      </div>

      <p className="mono" data-testid="setup-turn-indicator" style={TURN_INDICATOR_STYLE}>
        Player {acting + 1} to place
      </p>

      <RuleLine>
        First-base placement is a free choice of any hex on the outer ring (Ruling #6) — the
        printed rule&rsquo;s seating convention does not translate to a screen.
      </RuleLine>

      {controllableNow ? (
        <HexButtonList
          ariaLabel="Legal placement hexes"
          testIdPrefix="placement-hex"
          items={placementItems}
          onSelect={place}
        />
      ) : (
        <p className="mono" style={WAITING_STYLE}>
          Waiting for player {acting + 1} to place their first base…
        </p>
      )}
    </ComposerPanel>
  );
}

const ORDER_ROW_STYLE: React.CSSProperties = { display: "flex", gap: "0.4rem" };
const ORDER_ENTRY_STYLE: React.CSSProperties = { display: "inline-flex" };
const TURN_INDICATOR_STYLE: React.CSSProperties = { margin: 0 };
const WAITING_STYLE: React.CSSProperties = { margin: 0, color: "var(--color-parchment-300)" };
