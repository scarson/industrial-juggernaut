# Product

## Register

product

## Users

- **Sam and Tony (designer mode)** — the primary users for now. They play against the engine's agents, watch agent-vs-agent games, and probe balance questions. They need config knobs (rule variants, agent archetypes, sweep parameters) inside the game client, not in a separate tool.
- **Friends & family playtesters** — the next ring out. People who know or are learning the physical game and want to play it digitally. They need the board to teach itself: legible state, clear legal moves, no manual required for the basics.
- **Context**: desktop browser first (big hex map, room for side panels), with layouts responsive enough that a phone or tablet check-in isn't broken. Sessions are deliberate, seated, strategy-game-length — not glanceable mobile moments.

## Product Purpose

A digital adaptation of **Industrial Juggernaut**, a 2–6 player hex-grid strategy game of industrial expansion and military domination, designed by Tony (Sam's uncle). The repo already holds the rules engine, simulator, and playing agents (greedy archetypes + MCTS); the UI grows on top of that foundation.

The first surface is a **playable game client that doubles as the designer's balance instrument**: play full games against agents, expose balance/config knobs, and make game state visible enough to answer design questions. Success looks like Sam and Tony playtesting and iterating on balance faster digitally than they could with the physical board.

## Brand Personality

**Crafted, strategic, tactile.** Tabletop-warm at the core, with war-room cartographic vibes and industrial flavor where it fits.

The reference mood comes from Tony's AI-generated mockups (in repo root: `IJ board art ChatGPT 2026-05-17.png`, `IJ ChatGPT Image May 17, 2026 at 09_01_28 PM.png`). These are a liked direction, **not a hard commitment**. What works in them: the board as a vintage illustrated map (aged terrain, coastal cartography, ornate cartouche titling), player territories as rings of colored towers, factories as miniature buildings, the warmth of a wooden table. The box art's Victorian-industrial drama (smokestacks, embers, brass-and-iron lettering) is flavor to draw on sparingly — mood, not chrome.

The interface should feel like the digital cousin of the physical board: a game made by people, for a family table, that happens to live in a browser.

## Anti-references

- **Generic SaaS dashboard** — KPI cards, sidebar nav, gradient accents. The balance tooling especially must not make the game feel like analytics software.
- **Mobile-game gloss** — shiny candy buttons, juice popups, reward sparkle; the free-to-play visual dialect.
- **Grimdark wargame chrome** — ornate metal borders, skulls, gritty texture overload. The box art's drama stays atmospheric; it never becomes decoration on the UI.
- **Retro pixel/8-bit** — pixel art, CRT effects, chiptune-era styling.

## Design Principles

1. **The board is the hero.** Chrome recedes; the hex map gets the space, the light, and the craft. Every panel earns its pixels or collapses.
2. **Designer tooling wears the same clothes.** Balance knobs, agent telemetry, and config live inside the game's own visual language — integrated instruments, not a bolted-on admin panel.
3. **Tabletop materiality, digital clarity.** Take warmth and physicality from the board game, but information design must beat the cardboard, not just imitate it — digital should make territory, production, and threat *more* legible than the table ever could.
4. **Legible at a glance.** Territory perimeters, iron control, factory ownership, and who's winning should read as fast as glancing at the physical table mid-game. Playtesters shouldn't need to ask "wait, whose is that?"
5. **Honest tension.** Combat and odds get drama appropriate to the moment, but the real numbers are always visible. Designers need truth; players deserve it too.

## Accessibility & Inclusion

- **WCAG 2.1 AA** contrast throughout (body text ≥4.5:1).
- **Color-blind-safe player identity** — load-bearing constraint, not a nice-to-have: 2–6 simultaneous player colors on a hex map MUST carry redundant encoding (tower/base shape, pattern, or marking), never color alone. Palette chosen for deuteranopia/protanopia/tritanopia separability.
- **Reduced motion** — every animation has a `prefers-reduced-motion` alternative.
- **Keyboard** — core play actions reachable without a pointer where practical.
