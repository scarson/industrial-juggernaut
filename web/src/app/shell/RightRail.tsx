// ABOUTME: The app shell's one collapsible right rail — per-player resources, the factory
// ABOUTME: gauge, and the event log live inside it (wired in later phases; P0 ships the shell).
import { useId, useState, type ReactNode } from "react";
import type { Breakpoint } from "./useBreakpoint";

export interface RightRailProps {
  readonly breakpoint: Breakpoint;
  readonly children: ReactNode;
}

/**
 * A plain ARIA disclosure, not a Radix dialog: the rail is a persistent, in-flow region that
 * coexists with an interactive board, not a transient modal overlay — a dialog's focus trap
 * and scrim would fight "the board always wins space" (UI brief §5). At `wide` the rail's
 * content is always visible; at `narrow`/`compact` it collapses behind a toggle button whose
 * `aria-expanded` reflects state (UI brief §5 / DESIGN.md: rail collapses first below ~1100px).
 */
export function RightRail({ breakpoint, children }: RightRailProps) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const collapsesToToggle = breakpoint !== "wide";

  if (!collapsesToToggle) {
    return (
      <aside className="table-panel" aria-label="Rail" style={OPEN_RAIL_STYLE}>
        {children}
      </aside>
    );
  }

  return (
    <aside className="table-panel" aria-label="Rail" style={expanded ? OPEN_RAIL_STYLE : undefined}>
      <button
        type="button"
        className="chrome-button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((current) => !current)}
      >
        Rail
      </button>
      {/* Always mounted so the toggle's aria-controls reference resolves while collapsed. */}
      <div id={panelId} hidden={!expanded}>
        {children}
      </div>
    </aside>
  );
}

// The rail showing content is a fixed-width instrument column — the board always wins space
// (UI brief §5), so rail content (a long event-log line, a wide readout) must never widen it.
// Collapsed, the rail carries no width and shrinks to its toggle.
const OPEN_RAIL_STYLE: React.CSSProperties = {
  width: "19rem",
  flexShrink: 0,
  boxSizing: "border-box",
  overflowY: "auto",
  overflowX: "hidden",
  padding: "0.75rem",
};
