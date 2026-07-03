---
name: Industrial Juggernaut
description: Digital adaptation of a 2–6 player hex-grid strategy game of industrial expansion and military domination
colors:
  walnut-900: "#241910"
  walnut-800: "#2f2114"
  walnut-700: "#3b2a19"
  parchment-300: "#d8c39c"
  parchment-100: "#e6d8b8"
  brass-500: "#b78d3c"
  brass-400: "#c9a24e"
  ink-900: "#1a140d"
  ink-700: "#4a3d2c"
  player-oxide: "#c0492f"
  player-cobalt: "#2f6f9f"
  player-violet: "#6f4a86"
  player-gold: "#dcb43f"
  player-steel: "#8fa9b5"
  player-forest: "#3c5f45"
typography:
  display:
    fontFamily: "Fraunces, Iowan Old Style, Palatino Linotype, Palatino, Georgia, serif"
    fontWeight: 600
    letterSpacing: "0.01em"
  body:
    fontFamily: "Source Sans 3, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, system-ui, sans-serif"
    fontWeight: 400
  label:
    fontFamily: "IBM Plex Mono, ui-monospace, SF Mono, Cascadia Mono, Menlo, Consolas, monospace"
    fontWeight: 400
    fontVariation: "tabular-nums"
spacing:
  topbar-height: "44px"
components:
  chrome-button:
    backgroundColor: "{colors.walnut-800}"
    textColor: "{colors.parchment-100}"
    padding: "0.25em 0.75em"
  chrome-button-brass:
    backgroundColor: "{colors.walnut-800}"
    textColor: "{colors.brass-500}"
    padding: "0.25em 0.75em"
  brass-action:
    backgroundColor: "{colors.brass-500}"
    textColor: "{colors.ink-900}"
  table-panel:
    backgroundColor: "{colors.walnut-800}"
    textColor: "{colors.parchment-100}"
  board-surface:
    backgroundColor: "{colors.parchment-300}"
    textColor: "{colors.ink-900}"
---

# Design System: Industrial Juggernaut

## 1. Overview

**Creative North Star: "The Map Table"**

The interface is a map table: a dark wooden surface where a beautiful aged map lies open, instruments and counters arranged around it, a game in progress between people who know each other. Everything on screen belongs to that scene. The hex board is a parchment-and-ink illustrated map — the hero, glowing at center. The app chrome is the table around it: dark walnut and iron, brass fittings, quiet and warm. Designer tooling (balance knobs, agent telemetry) is part of the same scene — the designer's instruments laid on the table, not a separate software product bolted alongside.

The references are Tony's board-art mockup (repo root: `IJ board art ChatGPT 2026-05-17.png`), the digital adaptation of Brass: Birmingham, and 19th-century antique atlas plates — engraved cartography, cartouches, coastal hatching, plate borders. The system explicitly rejects all four PRODUCT.md anti-references: mobile-game gloss (Clash of Clans candy buttons, juice popups, reward sparkle), generic SaaS dashboard, grimdark wargame chrome, and retro pixel/8-bit.

The color strategy is **Committed**: the dark walnut table carries 30–60% of every screen, and the parchment board provides the light. This is deliberately NOT the cream/paper near-white default — parchment exists on screen only as the board's own material, framed by dark chrome.

**Key Characteristics:**
- Committed color: the dark table surface carries 30–60% of the screen; the parchment map provides the light.
- The board is the hero; chrome recedes and panels earn their pixels.
- Tabletop materiality with digital legibility — state must read faster than the physical board, not just prettier.
- Warm, crafted, precise; drama is earned (combat, elimination, victory), never ambient.
- Layout is structural-responsive (the right rail collapses below 1100px; below 768px is a "check-in" tier), never fluid-typography-responsive.

## 2. Colors

A warm, committed palette: walnut chrome for the table, parchment strictly for the map, one scarce brass accent, and a six-color CVD-verified player set. All values are authored in OKLCH in `web/src/design/tokens.css`; `web/src/design/tokens.ts` holds the source hex the accessibility gate asserts on (the frontmatter above carries that hex).

### Primary
- **Walnut 900** (`#241910`, `oklch(22.44% 0.0241 60.42)`): the Table — app body, the deepest surface. Carries most of every screen.
- **Walnut 800** (`#2f2114`, `oklch(26.10% 0.0311 63.66)`): instruments laid on the table — panels, toolbars, the right rail, button faces. One material step up from the body.
- **Walnut 700** (`#3b2a19`, `oklch(30.04% 0.0377 65.55)`): hairlines and raised chrome edges — the borders that separate panels from the table.

### Secondary
- **Parchment 300** (`#d8c39c`, `oklch(82.50% 0.0572 82.87)`): the aged map base — the board's material and nothing else.
- **Parchment 100** (`#e6d8b8`, `oklch(88.53% 0.0452 87.19)`): the lit map highlight; doubles as body text on dark chrome (AA ≥10:1 on walnut).
- **Brass 500** (`#b78d3c`, `oklch(66.80% 0.1103 81.17)`): the single metallic accent — primary actions, current selection, the Instruments affordance. Scarce by rule.
- **Brass 400** (`#c9a24e`, `oklch(73.13% 0.1122 84.37)`): the hover glint on brass elements (AA on dark chrome).

### Tertiary
The player identity set — six colors chosen as a set for deuteranopia/protanopia/tritanopia separability, gate-verified in `web/src/design/cvd-check.test.ts` (CIE76 ΔE ≥ 9.0 under Machado-2009 simulation). Player identity is **always color + shape + pattern** (see Do's and Don'ts), never color alone.

- **Oxide red** (`#c0492f`): player 0 — circle, solid. Brief-committed.
- **Cobalt** (`#2f6f9f`): player 1 — square, ring pattern. Brief-committed.
- **Violet** (`#6f4a86`): player 2 — triangle, dots pattern. Brief-committed.
- **Atlas gold** (`#dcb43f`): player 3 — diamond, hatch pattern. Extension color: high-lightness warm yellow (deutan-robust axis).
- **Weathered steel** (`#8fa9b5`): player 4 — pentagon, cross pattern. Extension color: low-chroma slate.
- **Bottle-green forest** (`#3c5f45`): player 5 — six-point star, checker pattern. Extension color: deep low-L green.

### Neutral
- **Ink 900** (`#1a140d`, `oklch(19.63% 0.0165 70.94)`): warm-black cartographic text and linework on parchment (AA ≥10.6:1 on the map).
- **Ink 700** (`#4a3d2c`, `oklch(36.89% 0.0328 73.96)`): muted secondary linework.

### Named Rules
**The Table Rule.** The dark walnut/iron surface is the app's body. Panels, nav, and tooling sit on the table, in the table's palette (`.table-surface`, `.table-panel`).

**The Parchment Belongs to the Board Rule.** Aged parchment is the board's material, not a UI tint. App chrome, panels, cards, and page backgrounds are never near-white warm-tinted "paper" — that is the generic AI default, and here it would also dissolve the board's figure-ground. If a panel looks like parchment, it had better be a map (`.board-surface` is legal only on board surfaces).

**The Brass Budget Rule.** The brass/ember accent appears on at most ~10% of any screen. Its scarcity is what makes selected states and primary actions read instantly.

**The Cobalt–Violet Shape Rule.** The brief-committed cobalt and violet collapse to ΔE ≈ 9.4 under deuteranopia — the palette's one inherent floor. For that pair, shape redundancy is load-bearing, not decorative: they carry the two most orientation-distinct hard-edged shapes (square vs triangle) and must never be reassigned to the round-ish shape cluster (circle/pentagon/six-point).

## 3. Typography

**Display Font:** Fraunces (static 400/600, self-hosted latin WOFF2; fallback Iowan Old Style → Palatino → Georgia → serif)
**Body Font:** Source Sans 3 (static 400/600, self-hosted; fallback system sans stack)
**Label/Mono Font:** IBM Plex Mono (static 400/600, self-hosted; fallback ui-monospace stack), `tabular-nums` via the `.mono` utility

**Character:** Atlas-plate engraving meets a modern instrument panel. The serif speaks only at game moments; the sans does the work; the mono tells the truth about the numbers.

### Hierarchy
The per-surface rem scale lands with the first real screens (P1–P3); product-register defaults govern it: fixed rem scale (no fluid clamp headings), tight ratio (1.125–1.2), prose capped at 65–75ch, data tables may run denser. Weights in use today: 400 (working text), 600 (emphasis, display moments).

### Named Rules
**The Cartouche Rule.** The display serif is reserved for game moments — the title plate, combat resolution, elimination, victory, and map cartouches (`.cartouche`). It never appears in UI labels, buttons, form controls, or data. If a settings panel is set in the display face, it's wrong.

**The Honest Numbers Rule.** Combat odds, budgets, seeds, and telemetry are always set in the mono face with `tabular-nums` (`.mono`) — the numbers stay legible and honest whenever drama is on screen.

## 4. Elevation

Flat by default. The chrome conveys structure through the table's material layering — walnut-800 panels with walnut-700 hairline borders on the walnut-900 body — not floating shadows. Depth is reserved for the board's physicality (pieces sit *on* the map), and the few choreographed set pieces (combat draw, elimination, victory) may use warm, ambient shadow to stage the moment. No cool gray SaaS card-shadows, ever.

Motion follows the same discipline: feedback transitions run 150/200/250ms (`duration.fast/base/slow` in `web/src/design/motion.ts`) with symmetric/enter/exit easings; every animation has a `prefers-reduced-motion` alternative (`prefersReducedMotion()` / `transitionOf()` return honest no-motion values). Choreography exists only at combat/elimination/victory.

### Named Rules
**The Material-Layering Rule.** Elevation is a change of material (a lighter walnut + a hairline), never a drop shadow. If a panel floats, it's off the table.

## 5. Components

The component vocabulary is young (the P0 shell); these are the committed primitives. All chrome components share the same quiet-instrument character: hard-edged (no radius tokens exist — corners are square), hairline-bordered, UA styling fully reset.

### Buttons
- **Shape:** square-cornered, 1px hairline border (`--hairline`, walnut-700). No radius.
- **Chrome button** (`.chrome-button`): walnut-800 face, inherited text color, `0.25em 0.75em` padding, pointer cursor. The quiet instrument default for chrome-side actions (rail toggle).
- **Brass affordance:** the ONE button per screen that earns the brass budget composes `.chrome-button .brass-accent` (brass text on the panel face) — today, the Instruments button. A filled variant (`.brass-accent-bg`, brass face + ink text) is reserved for primary game actions (Start, Commit).
- **Focus:** 2px brass outline, 2px offset, `:focus-visible` only. Keyboard reachability is a PRODUCT.md requirement.

### Cards / Containers
- **`.table-panel`:** walnut-800 + hairline border + parchment-100 text — the rail, toolbars, any instrument panel. This is the ONLY "card"; nested cards are prohibited.
- **`.board-surface`:** parchment-300 + ink-900 text — board/map surfaces exclusively (the Parchment rule).

### Navigation
- **Top bar** (`.shell-topbar`): slim, ≤44px (`--layout-topbar-height`), on the table surface: wordmark (Cartouche serif — the title plate), turn/phase chip, seed/config readout in mono, and the Instruments button (brass). 
- **Right rail:** ONE collapsible complementary landmark (`aria-label="Rail"`); expanded at the wide tier (≥1100px), collapsed behind a `.chrome-button` toggle with `aria-expanded`/`aria-controls` (always-mounted, `hidden`-toggled panel) below it. Routing is an in-house pushState router (4 static routes) — no router dependency.

### Player Identity Token (signature component)
`PlayerShapeIcon` (`web/src/identity/shapes.tsx`): a pure SVG primitive rendering a player's identity — color (CSS var fill) + shape (circle/square/triangle/diamond/pentagon/six-point) + pattern overlay (solid/ring/dots/hatch/cross/checker) — sized to a hex cell, positionable on the board via its `center` prop. The triple encoding is the accessibility contract: every place a player is shown, at least shape+color travel together.

## 6. Do's and Don'ts

### Do:
- **Do** keep the hex map the largest, brightest, most crafted object on every play screen.
- **Do** dress designer tooling (balance knobs, telemetry, config) in the same table palette and type system as the game — integrated instruments, per PRODUCT.md's "designer tooling wears the same clothes."
- **Do** encode player identity redundantly — color + shape + pattern, via `playerIdentity(id)` — and treat the CVD gate (`cvd-check.test.ts`) as the palette's definition of done; cobalt and violet keep the most shape-distinct markers.
- **Do** give combat, elimination, and victory earned choreography — 150–250ms feedback everywhere else, with `prefers-reduced-motion` alternatives for all of it.
- **Do** show the real numbers (combat odds, production math) in the mono face whenever drama is on screen — honest tension.
- **Do** reset UA button chrome (`.chrome-button`) — a raw grey browser button on the walnut table is the "generic" tell.

### Don't:
- **Don't** look like Clash of Clans: no candy-gloss buttons, juice popups, or reward sparkle (PRODUCT.md: "mobile-game gloss").
- **Don't** look like a generic SaaS dashboard: no KPI cards, sidebar-nav-with-gradient-accent scaffolding — especially in the balance tooling (PRODUCT.md: "generic SaaS dashboard").
- **Don't** decorate with grimdark wargame chrome: no ornate metal borders, skulls, or texture overload; the box art's drama stays atmospheric (PRODUCT.md: "grimdark wargame chrome").
- **Don't** use pixel art, CRT effects, or 8-bit styling (PRODUCT.md: "retro pixel/8-bit").
- **Don't** use parchment/cream as an app background tint — see The Parchment Belongs to the Board Rule. Audit test: if a non-board element's background is in the warm near-white band, it's a violation.
- **Don't** set UI labels, buttons, or data in the display serif — see The Cartouche Rule.
- **Don't** float panels on drop shadows — see The Material-Layering Rule.
- **Don't** spend brass on more than ~10% of a screen, or on inactive/decorative elements — see The Brass Budget Rule.
