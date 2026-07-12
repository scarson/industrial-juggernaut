// ABOUTME: RulesReference — the /rules screen. Renders the curated rules structure (rules-content.ts)
// ABOUTME: as an atlas-plate reference: hotlinked contents, collapsible section cartouches, prose,
// ABOUTME: engine-rendered rule illustrations, and inline Digital Edition Ruling callouts.
import { lazy, Suspense, type CSSProperties } from "react";
import { rulesSections, type DerCallout, type RulesSection } from "./rules-content";
import { VignetteBoundary } from "../app/HomeScreen";
import type { RuleSceneKey } from "./scenes";

// The board illustrations value-import engine code (scene curation), so they load from their own
// lazy chunk — the same entry-graph discipline as the landing hero. The prose renders immediately;
// the plates develop into their figures.
const RulesVignette = lazy(() => import("./RulesVignette"));

/** Which sections get an engine-rendered illustration, and its caption. A picture is attached
 *  only where it teaches something prose struggles with (geometry: rings, disks, hulls, range). */
const SECTION_VIGNETTES: Partial<Record<string, { scene: RuleSceneKey; caption: string }>> = {
  setup: {
    scene: "placement",
    caption: "Setup: every hex on the outermost ring is a legal first-base choice.",
  },
  building: {
    scene: "radiating",
    caption: "Before a perimeter exists, each player's bases radiate a control disk.",
  },
  territory: {
    scene: "perimeter",
    caption:
      "Four or more bases form a convex-hull perimeter that claims its whole interior — shown " +
      "against a still-radiating opponent.",
  },
  combat: {
    scene: "attack",
    caption: "Enemy bases within attack range carry the danger edge — each is a legal target.",
  },
};

/**
 * The teaching surface ("the board teaches itself", PRODUCT.md): a rules pamphlet laid on the
 * table, not a settings page. Section titles use the display serif (`.cartouche`) — a sanctioned
 * game-moment-adjacent use, since a rules plate is table furniture, not a UI label. Body prose
 * stays in the sans body face; ruling callouts render as a hairline-bordered block with a small
 * brass-numbered badge (War-room restraint — no icon-and-color SaaS callout box). Sections are
 * native `<details>` disclosures (open by default) reachable from the contents list.
 */
export function RulesReference() {
  return (
    <section className="table-panel" aria-label="Rules reference" style={PANEL_STYLE}>
      <header>
        <h1 className="cartouche" style={TITLE_STYLE}>
          Rules Reference
        </h1>
        <p style={SUBTITLE_STYLE}>
          The Digital Edition of Industrial Juggernaut. Where this edition departs from the printed
          rules, a numbered Digital Edition Ruling card explains the change where it applies.
        </p>
      </header>

      <nav aria-label="Contents" style={TOC_STYLE}>
        {rulesSections.map((section, i) => (
          <span key={section.id} style={TOC_ENTRY_STYLE}>
            {i > 0 && (
              <span aria-hidden="true" style={TOC_DIVIDER_STYLE}>
                |
              </span>
            )}
            <a className="mono" href={`#rules-${section.id}`} style={TOC_LINK_STYLE}>
              {section.title}
            </a>
          </span>
        ))}
      </nav>

      {rulesSections.map((section) => (
        <Section key={section.id} section={section} />
      ))}
    </section>
  );
}

function Section({ section }: { section: RulesSection }) {
  const vignette = SECTION_VIGNETTES[section.id];
  return (
    <article id={`rules-${section.id}`} data-testid={`rules-section-${section.id}`} style={SECTION_STYLE}>
      <details open>
        <summary style={SUMMARY_STYLE}>
          {/* A native <h2> inside <summary> is valid HTML but WebKit/VoiceOver drops it from the
              heading rotor; an explicit heading role on an inline span is exposed by the major
              screen readers while the summary keeps its disclosure semantics. */}
          <span role="heading" aria-level={2} className="cartouche" style={SECTION_TITLE_STYLE}>
            {section.title}
          </span>
        </summary>
        <div style={SECTION_BODY_STYLE}>
          <p style={BODY_STYLE}>{section.body}</p>
          {vignette !== undefined && (
            <figure data-testid={`rules-vignette-${vignette.scene}`} style={FIGURE_STYLE}>
              <div className="board-surface" style={FIGURE_PLATE_STYLE}>
                <VignetteBoundary>
                  <Suspense
                    fallback={
                      <span className="mono" style={FIGURE_NOTE_STYLE}>
                        Laying out the illustration…
                      </span>
                    }
                  >
                    <RulesVignette scene={vignette.scene} />
                  </Suspense>
                </VignetteBoundary>
              </div>
              <figcaption style={FIGCAPTION_STYLE}>{vignette.caption}</figcaption>
            </figure>
          )}
          {section.ders.map((der) => (
            <DerBlock key={der.n} der={der} />
          ))}
        </div>
      </details>
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
            Digital Edition Ruling {der.n}
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
// Muted-on-chrome via reduced-opacity text-on-chrome (the top bar's readout precedent).
// ink-700 is parchment-side linework and falls far below AA on the walnut surface.
const SUBTITLE_STYLE: CSSProperties = {
  margin: "0.35rem 0 0",
  color: "var(--text-on-chrome)",
  opacity: 0.75,
  fontSize: "0.95rem",
};
// The contents list is an instrument row: quiet mono links separated by hairline dividers.
const TOC_STYLE: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "0.35rem 1rem",
  borderTop: "1px solid var(--hairline)",
  borderBottom: "1px solid var(--hairline)",
  padding: "0.6rem 0",
};
const TOC_ENTRY_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "1rem",
};
// A quiet engraved divider between contents entries — decorative, hidden from AT.
const TOC_DIVIDER_STYLE: CSSProperties = {
  color: "var(--color-ink-700)",
  fontSize: "0.8rem",
};
const TOC_LINK_STYLE: CSSProperties = {
  fontSize: "0.8rem",
  color: "var(--color-parchment-300)",
  textDecoration: "none",
};
const SECTION_STYLE: CSSProperties = {
  borderTop: "1px solid var(--hairline)",
  paddingTop: "1.25rem",
};
// The heading renders inline beside the native disclosure marker.
const SUMMARY_STYLE: CSSProperties = { cursor: "pointer" };
const SECTION_TITLE_STYLE: CSSProperties = { margin: 0, fontSize: "1.25rem", display: "inline-block" };
const SECTION_BODY_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.75rem",
  paddingTop: "0.75rem",
};
const BODY_STYLE: CSSProperties = { margin: 0, lineHeight: 1.6 };
const FIGURE_STYLE: CSSProperties = {
  margin: 0,
  display: "flex",
  flexDirection: "column",
  gap: "0.4rem",
};
const FIGURE_PLATE_STYLE: CSSProperties = {
  padding: "0.5rem",
};
const FIGURE_NOTE_STYLE: CSSProperties = { fontSize: "0.8rem", color: "var(--color-ink-700)" };
const FIGCAPTION_STYLE: CSSProperties = {
  fontSize: "0.85rem",
  color: "var(--text-on-chrome)",
  opacity: 0.75,
};
// A uniform hairline frames each ruling; the brass numbered badge is the accent.
// (A thicker colored left edge is the side-stripe callout pattern DESIGN.md's
// anti-references reject — the accent belongs on the badge, not the border.)
const DER_STYLE: CSSProperties = {
  border: "1px solid var(--hairline)",
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
