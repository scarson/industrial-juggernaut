// ABOUTME: EventLog — narrates a run of engine events via eventLine, virtualized to a bounded tail
// ABOUTME: window so a long game (or a scrubbed-to-end frame) never mounts one DOM row per event.
import { color } from "../design/tokens";
import { eventLine } from "./event-copy";
import type { GameEvent } from "../engine-client/barrel";

/**
 * How many event rows the log keeps in the DOM at once. The log auto-follows the current frame's
 * events (newest at the bottom), so it only ever needs the tail — a fixed ceiling here means a
 * 1000-entry game renders a constant number of nodes, not one `<li>` per event. Chosen larger than
 * any single frame's event burst yet small enough that layout/paint stays cheap.
 */
export const EVENT_LOG_WINDOW = 60;

export interface EventLogProps {
  /** The events to narrate, oldest-first. The log renders the most recent `EVENT_LOG_WINDOW`. */
  readonly events: readonly GameEvent[];
}

/**
 * The event narration list — the reusable HUD/viewer telemetry surface. It renders the tail
 * (`EVENT_LOG_WINDOW` most recent events) as mono lines via `eventLine`, keeping DOM node count
 * bounded regardless of game length (a simple windowing: no virtual-scroll dependency, since the
 * log always follows the newest events rather than letting the user scroll an arbitrary offset).
 *
 * `role="log"` marks it as a live region for assistive tech; the honest numbers ride the mono face
 * (the Honest Numbers Rule). Each line keys on its position within the whole event stream so React
 * reconciles the sliding window by identity, not by array index within the slice.
 */
export function EventLog({ events }: EventLogProps) {
  const start = Math.max(0, events.length - EVENT_LOG_WINDOW);
  const windowed = events.slice(start);

  return (
    <div className="mono" role="log" aria-label="Event log" aria-live="polite" style={LOG_STYLE}>
      {windowed.length === 0 ? (
        <p style={EMPTY_STYLE}>No events yet.</p>
      ) : (
        <ol style={LIST_STYLE}>
          {windowed.map((event, i) => (
            <li key={start + i} style={ROW_STYLE}>
              {eventLine(event)}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// Structural/geometry inline styles only — colors reference tokens (no raw hex), matching the
// shell's inline-style idiom. The list scrolls within its own box so the rail never grows unbounded.
const LOG_STYLE: React.CSSProperties = {
  fontSize: "0.8rem",
  lineHeight: 1.35,
  maxHeight: "18rem",
  overflowY: "auto",
  color: color("parchment100"),
};
const LIST_STYLE: React.CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "0.15rem",
};
const ROW_STYLE: React.CSSProperties = {
  borderBottom: "1px solid var(--hairline)",
  padding: "0.15rem 0",
};
const EMPTY_STYLE: React.CSSProperties = {
  margin: 0,
  color: "var(--color-ink-700)",
};
