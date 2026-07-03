// ABOUTME: RulesReference — the /rules screen. Renders the curated rules structure (rules-content.ts)
// ABOUTME: as an atlas-plate reference: section cartouches, prose, and inline Digital Edition Ruling callouts.
import type { CSSProperties } from "react";
import { rulesSections, type DerCallout, type RulesSection } from "./rules-content";

/**
 * The teaching surface ("the board teaches itself", PRODUCT.md): a rules pamphlet laid on the
 * table, not a settings page. Section titles use the display serif (`.cartouche`) — a sanctioned
 * game-moment-adjacent use, since a rules plate is table furniture, not a UI label. Body prose
 * stays in the sans body face; DER callouts render as a hairline-bordered block with a small
 * brass-numbered badge (War-room restraint — no icon-and-color SaaS callout box).
 */
export function RulesReference() {
  return (
    <section className="table-panel" aria-label="Rules reference" style={PANEL_STYLE}>
      <header>
        <h1 className="cartouche" style={TITLE_STYLE}>
          Rules Reference
        </h1>
        <p style={SUBTITLE_STYLE}>
          The Digital Edition of Industrial Juggernaut, with every ruling that departs from the
          printed rules called out where it applies.
        </p>
      </header>

      {rulesSections.map((section) => (
        <Section key={section.id} section={section} />
      ))}
    </section>
  );
}

function Section({ section }: { section: RulesSection }) {
  return (
    <article data-testid={`rules-section-${section.id}`} style={SECTION_STYLE}>
      <h2 className="cartouche" style={SECTION_TITLE_STYLE}>
        {section.title}
      </h2>
      <p style={BODY_STYLE}>{section.body}</p>
      {section.ders.map((der) => (
        <DerBlock key={der.n} der={der} />
      ))}
    </article>
  );
}

function DerBlock({ der }: { der: DerCallout }) {
  return (
    <aside
      data-testid={`der-callout-${der.n}`}
      aria-label={`Digital Edition Ruling ${der.n}`}
      style={DER_STYLE}
    >
      <div style={DER_HEADER_STYLE}>
        <span className="mono brass-accent-bg" style={DER_BADGE_STYLE}>
          {der.n}
        </span>
        <span style={DER_LABEL_STYLE}>
          <span className="mono" style={DER_KICKER_STYLE}>
            DER #{der.n}
          </span>
          <strong style={DER_TITLE_STYLE}>{der.title}</strong>
        </span>
      </div>
      <p style={DER_BODY_STYLE}>{der.body}</p>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Styles — geometry only; colors reference tokens (no raw hex), matching the shell idiom.
// ---------------------------------------------------------------------------

const PANEL_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "1.5rem",
  padding: "1.5rem",
  maxWidth: "48rem",
  margin: "0 auto",
};
const TITLE_STYLE: CSSProperties = { margin: 0, fontSize: "1.75rem" };
const SUBTITLE_STYLE: CSSProperties = {
  margin: "0.35rem 0 0",
  color: "var(--color-ink-700)",
  fontSize: "0.95rem",
};
const SECTION_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.75rem",
  borderTop: "1px solid var(--hairline)",
  paddingTop: "1.25rem",
};
const SECTION_TITLE_STYLE: CSSProperties = { margin: 0, fontSize: "1.25rem" };
const BODY_STYLE: CSSProperties = { margin: 0, lineHeight: 1.6 };
const DER_STYLE: CSSProperties = {
  border: "1px solid var(--hairline)",
  borderLeft: "3px solid var(--accent)",
  padding: "0.6rem 0.85rem",
  display: "flex",
  flexDirection: "column",
  gap: "0.4rem",
};
const DER_HEADER_STYLE: CSSProperties = { display: "flex", alignItems: "center", gap: "0.6rem" };
const DER_BADGE_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "1.6rem",
  height: "1.6rem",
  fontSize: "0.85rem",
  flexShrink: 0,
};
const DER_LABEL_STYLE: CSSProperties = { display: "flex", flexDirection: "column", gap: "0.1rem" };
const DER_KICKER_STYLE: CSSProperties = {
  fontSize: "0.7rem",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--accent)",
};
const DER_TITLE_STYLE: CSSProperties = { fontSize: "0.95rem" };
const DER_BODY_STYLE: CSSProperties = { margin: 0, fontSize: "0.9rem", lineHeight: 1.55 };
