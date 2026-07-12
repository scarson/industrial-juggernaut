// ABOUTME: The app shell's slim top bar — wordmark, turn/phase chip, seed/config readout,
// ABOUTME: and the Instruments affordance. Readouts render only when a game supplies them.
export const TOPBAR_HEIGHT_CLASS = "shell-topbar";

export interface TopBarProps {
  /** Turn/phase + whose-move summary, e.g. "Round 3 · Oxide's move". Omitted = no chip. */
  readonly turnLabel?: string;
  /** Seed/config readout, rendered in the mono face, e.g. "0x9f3a". Omitted = no readout. */
  readonly seedLabel?: string;
  /** Invoked when the Instruments button is activated. */
  readonly onInstrumentsClick?: () => void;
  /** In-app home navigation for a plain click on the wordmark. Modifier clicks (new tab)
   *  fall through to the browser via the real `href="/"`; when this is unwired, plain
   *  clicks do too — the SPA fallback serves the full app either way. */
  readonly onWordmarkClick?: () => void;
}

/**
 * The slim top bar (UI brief §5: ≤44px — see the `shell-topbar` geometry in tokens.css).
 * Table Rule chrome; the wordmark is the one legitimate Cartouche use outside the board
 * (DESIGN.md names it "the title plate"); the seed/config readout is mono; the Instruments
 * button is the Brass Budget's one chrome affordance. The turn chip and seed readout are
 * instruments — when a screen has nothing to report they recede entirely rather than
 * holding empty placeholders.
 */
export function TopBar({ turnLabel, seedLabel, onInstrumentsClick, onWordmarkClick }: TopBarProps) {
  function handleWordmarkClick(event: React.MouseEvent<HTMLAnchorElement>) {
    if (onWordmarkClick === undefined) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    onWordmarkClick();
  }

  return (
    <header className={`table-surface ${TOPBAR_HEIGHT_CLASS}`}>
      <a className="cartouche" style={WORDMARK_STYLE} href="/" onClick={handleWordmarkClick}>
        Industrial Juggernaut
      </a>
      {turnLabel !== undefined && (
        <span data-testid="topbar-turn" style={TURN_CHIP_STYLE}>
          {turnLabel}
        </span>
      )}
      <div style={RIGHT_GROUP_STYLE}>
        {seedLabel !== undefined && (
          <span className="mono" data-testid="topbar-seed" style={SEED_STYLE}>
            {seedLabel}
          </span>
        )}
        {/* Brass never sits on an inactive control (the Brass Budget Rule), so the
            Instruments affordance exists only once the shell wires it to a real menu. */}
        {onInstrumentsClick !== undefined && (
          <button
            type="button"
            className="chrome-button brass-accent"
            style={INSTRUMENTS_STYLE}
            onClick={onInstrumentsClick}
          >
            Instruments
          </button>
        )}
      </div>
    </header>
  );
}

// Geometry + type sizing only; colors come from the token classes (.table-surface,
// .cartouche, .mono, .chrome-button.brass-accent) so the material stays token-governed.
const WORDMARK_STYLE: React.CSSProperties = {
  fontSize: "1.125rem",
  lineHeight: 1,
  whiteSpace: "nowrap",
  color: "inherit",
  textDecoration: "none",
};
// The chip is separated from the title plate by an engraved hairline rule (1px — a
// divider, not a colored side-stripe), and truncates rather than wrapping the 44px bar.
const TURN_CHIP_STYLE: React.CSSProperties = {
  borderLeft: "1px solid var(--hairline)",
  paddingLeft: "0.75rem",
  fontSize: "0.875rem",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  minWidth: 0,
};
// Seed + Instruments hold the bar's right end together regardless of which readouts exist.
// minWidth 0 lets the group's seed truncate on narrow viewports instead of pushing the
// Instruments button off-screen (the phone "check-in" tier must not horizontally overflow).
const RIGHT_GROUP_STYLE: React.CSSProperties = {
  marginLeft: "auto",
  display: "flex",
  alignItems: "center",
  gap: "1rem",
  minWidth: 0,
};
// Muted telemetry: parchment-300 clears AA on both walnut surfaces (gate-tested). Truncates
// under pressure — the wordmark and the Instruments button are the bar's two rigid items.
const SEED_STYLE: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-parchment-300)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  minWidth: 0,
};
const INSTRUMENTS_STYLE: React.CSSProperties = {
  fontSize: "0.875rem",
};
