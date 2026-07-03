// ABOUTME: Hud — composes ResourcePanel + FactoryGauge + TurnOrderTokens + the reused EventLog
// ABOUTME: into the right rail's vertical instrument stack (UI brief §5).
import { ResourcePanel } from "./ResourcePanel";
import { FactoryGauge } from "./FactoryGauge";
import { TurnOrderTokens } from "./TurnOrderTokens";
import { EventLog } from "./EventLog";
import type { GameEvent, GameState } from "../engine-client/barrel";

export interface HudProps {
  readonly state: GameState;
  /**
   * The events to narrate in the log, oldest-first. This task's `Hud` takes the stream as a
   * plain prop; P3.11 is responsible for wiring the real cumulative event stream (accumulated
   * from `applied` events) and passing it here — the store's `authoritative` slice does not
   * itself carry a cumulative event list.
   */
  readonly events: readonly GameEvent[];
}

/**
 * The right rail's instrument stack: per-player resources, the shared factory-supply gauge,
 * the turn-order tokens, and the event log — a vertical stack of `.table-panel` instruments,
 * matching the War-room lane's restrained, hairline-bordered character (no card grid, no
 * Cartouche, brass reserved for the current-player emphasis inside `TurnOrderTokens`).
 */
export function Hud({ state, events }: HudProps) {
  return (
    <div aria-label="HUD" style={STACK_STYLE}>
      <ResourcePanel state={state} />
      <FactoryGauge state={state} />
      <TurnOrderTokens state={state} />
      <div className="table-panel" style={LOG_PANEL_STYLE}>
        <EventLog events={events} />
      </div>
    </div>
  );
}

const STACK_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
};
const LOG_PANEL_STYLE: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
};
