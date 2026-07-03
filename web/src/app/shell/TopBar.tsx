// ABOUTME: The app shell's slim top bar — wordmark, turn/phase chip, seed/config readout,
// ABOUTME: and the Instruments affordance. No game state at P0; callers pass labels once wired.
export const TOPBAR_HEIGHT_CLASS = "shell-topbar";

export interface TopBarProps {
  /** Turn/phase + whose-move summary, e.g. "Round 3 · Oxide's move". Shows "—" when absent. */
  readonly turnLabel?: string;
  /** Seed/config readout, rendered in the mono face, e.g. "0x9f3a". Shows "—" when absent. */
  readonly seedLabel?: string;
  /** Invoked when the Instruments button is activated. */
  readonly onInstrumentsClick?: () => void;
}

/**
 * The slim top bar (UI brief §5: ≤44px — see the `shell-topbar` height token in tokens.css).
 * Table Rule chrome; the wordmark is the one legitimate Cartouche use outside the board
 * (DESIGN.md names it "the title plate"); the seed/config readout is mono; the Instruments
 * button is the Brass Budget's one chrome affordance.
 */
export function TopBar({ turnLabel, seedLabel, onInstrumentsClick }: TopBarProps) {
  return (
    <header className={`table-surface ${TOPBAR_HEIGHT_CLASS}`}>
      <span className="cartouche">Industrial Juggernaut</span>
      <span data-testid="topbar-turn">{turnLabel ?? "—"}</span>
      <span className="mono" data-testid="topbar-seed">
        {seedLabel ?? "—"}
      </span>
      <button type="button" className="brass-accent" onClick={onInstrumentsClick}>
        Instruments
      </button>
    </header>
  );
}
