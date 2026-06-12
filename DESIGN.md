<!-- SEED: re-run /impeccable document once there's code to capture the actual tokens and components. -->
---
name: Industrial Juggernaut
description: Digital adaptation of a 2–6 player hex-grid strategy game of industrial expansion and military domination
---

# Design System: Industrial Juggernaut

## Overview

**Creative North Star: "The Map Table"**

The interface is a map table: a dark wooden surface where a beautiful aged map lies open, instruments and counters arranged around it, a game in progress between people who know each other. Everything on screen belongs to that scene. The hex board is a parchment-and-ink illustrated map — the hero, glowing at center. The app chrome is the table around it: dark walnut and iron, brass fittings, quiet and warm. Designer tooling (balance knobs, agent telemetry) is part of the same scene — the designer's instruments laid on the table, not a separate software product bolted alongside.

The references are Tony's board-art mockup (repo root: `IJ board art ChatGPT 2026-05-17.png`), the digital adaptation of Brass: Birmingham, and 19th-century antique atlas plates — engraved cartography, cartouches, coastal hatching, plate borders. The system explicitly rejects Clash of Clans and everything in its dialect: candy buttons, juice popups, reward sparkle. It equally rejects the other three PRODUCT.md anti-references — generic SaaS dashboard, grimdark wargame chrome, retro pixel/8-bit.

**Key Characteristics:**
- Committed color: the dark table surface carries 30–60% of the screen; the parchment map provides the light.
- The board is the hero; chrome recedes and panels earn their pixels.
- Tabletop materiality with digital legibility — state must read faster than the physical board, not just prettier.
- Warm, crafted, precise; drama is earned (combat, elimination, victory), never ambient.

## Colors

Hue anchors are committed; exact values are `[to be resolved during implementation]` in OKLCH, verified to WCAG 2.1 AA.

### Primary
- **Dark walnut / iron** (`[to be resolved during implementation]`): the table — app background, framing, toolbars. Carries most of the screen.

### Secondary
- **Aged parchment** (`[to be resolved during implementation]`): the board's material — map terrain base, and nothing else.
- **Brass / ember** (`[to be resolved during implementation]`): the single metallic accent — primary actions, selection, the warm glint on instruments. Scarce.

### Tertiary
- **Player set** (6 colors, `[to be resolved during implementation]`): oxide red, cobalt, violet (from the board art) plus three more, chosen as a set for deuteranopia/protanopia/tritanopia separability. Player identity always carries redundant encoding (tower/base shape, pattern, or marking) — never color alone.

### Neutral
- **Ink** (`[to be resolved during implementation]`): text and linework, warm-black like printed cartography.

### Named Rules
**The Table Rule.** The dark walnut/iron surface is the app's body. Panels, nav, and tooling sit on the table, in the table's palette. The map is the only parchment object on screen.

**The Parchment Belongs to the Board Rule.** Aged parchment is the board's material, not a UI tint. App chrome, panels, cards, and page backgrounds are never near-white warm-tinted "paper" — that is the generic AI default, and here it would also dissolve the board's figure-ground. If a panel looks like parchment, it had better be a map.

**The Brass Budget Rule.** The brass/ember accent appears on at most ~10% of any screen. Its scarcity is what makes selected states and primary actions read instantly.

## Typography

**Display Font:** vintage engraved/cartouche-flavored serif — `[font to be chosen at implementation]`
**Body Font:** warm humanist sans — `[font to be chosen at implementation]`
**Label/Mono Font:** monospace for balance numbers, telemetry, seeds, and sweep data — `[font to be chosen at implementation]`

**Character:** Atlas-plate engraving meets a modern instrument panel. The serif speaks only at game moments; the sans does the work; the mono tells the truth about the numbers.

### Hierarchy
`[Sizes and weights to be set at implementation.]` Product-register defaults apply: fixed rem scale (no fluid clamp headings), tight ratio (1.125–1.2), prose capped at 65–75ch; data tables may run denser.

### Named Rules
**The Cartouche Rule.** The display serif is reserved for game moments — the title plate, combat resolution, elimination, victory, and map cartouches. It never appears in UI labels, buttons, form controls, or data. If a settings panel is set in the display face, it's wrong.

## Elevation

Flat by default. The chrome conveys structure through the table's material layering (a second, slightly distinct neutral for panels and toolbars), not floating shadows. Depth is reserved for the board's physicality — pieces sit *on* the map, and the few choreographed set pieces (combat draw, elimination, victory) may use warm, ambient shadow to stage it. No cool gray SaaS card-shadows, ever.

## Do's and Don'ts

### Do:
- **Do** keep the hex map the largest, brightest, most crafted object on every play screen.
- **Do** dress designer tooling (balance knobs, telemetry, config) in the same table palette and type system as the game — integrated instruments, per PRODUCT.md's "designer tooling wears the same clothes."
- **Do** encode player identity redundantly (shape/pattern/marking + color) and verify the 6-color set under CVD simulation before committing values.
- **Do** give combat, elimination, and victory earned choreography — 150–250ms responsive feedback everywhere else, with `prefers-reduced-motion` alternatives for all of it.
- **Do** show the real numbers (combat odds, production math) in the mono face whenever drama is on screen — honest tension.

### Don't:
- **Don't** look like Clash of Clans: no candy-gloss buttons, juice popups, or reward sparkle (PRODUCT.md: "mobile-game gloss").
- **Don't** look like a generic SaaS dashboard: no KPI cards, sidebar-nav-with-gradient-accent scaffolding — especially in the balance tooling (PRODUCT.md: "generic SaaS dashboard").
- **Don't** decorate with grimdark wargame chrome: no ornate metal borders, skulls, or texture overload; the box art's drama stays atmospheric (PRODUCT.md: "grimdark wargame chrome").
- **Don't** use pixel art, CRT effects, or 8-bit styling (PRODUCT.md: "retro pixel/8-bit").
- **Don't** use parchment/cream as an app background tint — see The Parchment Belongs to the Board Rule.
- **Don't** set UI labels, buttons, or data in the display serif — see The Cartouche Rule.
