// ABOUTME: The composer shell — the `table-panel` wrapper, the rule-line note, and the hex-button
// ABOUTME: grid shared byte-identically across BuildComposer/AttackComposer/DefenderPrompt/SetupPlacement.
import type { ReactNode } from "react";
import type { Hex } from "../engine-client/barrel";

export interface ComposerPanelProps {
  /** The `aria-label` on the wrapping `<section>`, one per composer (e.g. "Build", "Attack"). */
  readonly ariaLabel: string;
  readonly children: ReactNode;
}

/** The `<section className="table-panel">` wrapper every composer/prompt mounts as its root — byte-identical across all 7. */
export function ComposerPanel({ ariaLabel, children }: ComposerPanelProps) {
  return (
    <section className="table-panel" aria-label={ariaLabel} style={PANEL_STYLE}>
      {children}
    </section>
  );
}

export interface RuleLineProps {
  readonly children: ReactNode;
}

/** The `<p role="note">` one-liner that explains a rule inline — byte-identical across the 6 composers that have one (ChainContinuePrompt has none). */
export function RuleLine({ children }: RuleLineProps) {
  return (
    <p className="mono" role="note" style={NOTE_STYLE}>
      {children}
    </p>
  );
}

export interface HexButtonItem {
  /** The canonical `hexKey(hex)` string — drives both `key` and the `data-testid` suffix. */
  readonly key: string;
  readonly hex: Hex;
  /** True disable: removes the button from the tab order's operable set (`disabled` attribute). */
  readonly disabled?: boolean;
  /** `aria-pressed`, for a toggleable single-selection list (e.g. the attack-target list). */
  readonly pressed?: boolean;
  /** `aria-disabled` without the `disabled` attribute — the button stays focusable/clickable (so
   *  clicking it can still show a rule explanation) but reads as unavailable to AT and renders
   *  with `style` (typically a greyed treatment) instead of the default. */
  readonly ariaDisabled?: boolean;
  /** Per-item style override — used for the greyed-illegal treatment. Defaults to the shared hex
   *  button look when omitted. */
  readonly style?: React.CSSProperties | undefined;
  /** Visible label text. Defaults to `key`. */
  readonly label?: string;
}

export interface HexButtonListProps {
  readonly ariaLabel: string;
  /** `data-testid` is `${testIdPrefix}-${item.key}`. */
  readonly testIdPrefix: string;
  readonly items: readonly HexButtonItem[];
  readonly onSelect: (hex: Hex) => void;
  /** Overrides the default flex-wrap grid style. */
  readonly listStyle?: React.CSSProperties;
}

/** The `role="group"` flex-wrap grid of hex buttons shared by BuildComposer's legal-build-hexes
 *  list, AttackComposer's target list, DefenderPrompt's eligible-defenders list, and
 *  SetupPlacement's placement-hexes list. AttackComposer's eligible-attackers list is NOT a
 *  button (no click handler — it's a `<span>` display of committed/uncommitted attackers) and
 *  stays local to AttackComposer rather than being forced into this shape. */
export function HexButtonList({ ariaLabel, testIdPrefix, items, onSelect, listStyle }: HexButtonListProps) {
  return (
    <div role="group" aria-label={ariaLabel} style={listStyle ?? HEX_LIST_STYLE}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className="chrome-button mono"
          data-testid={`${testIdPrefix}-${item.key}`}
          disabled={item.disabled}
          aria-pressed={item.pressed}
          aria-disabled={item.ariaDisabled}
          style={item.style}
          onClick={() => onSelect(item.hex)}
        >
          {item.label ?? item.key}
        </button>
      ))}
    </div>
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
  // A hairline frame + recessed inset sets the rule apart without the colored side-stripe that
  // DESIGN.md's anti-references reject (cf. the DER callout's hairline frame in RulesReference —
  // the accent belongs on scarce elements, not a callout's left edge).
  border: "1px solid var(--hairline)",
  backgroundColor: "var(--surface-app)",
  padding: "0.3rem 0.55rem",
};
const HEX_LIST_STYLE: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: "0.35rem" };
