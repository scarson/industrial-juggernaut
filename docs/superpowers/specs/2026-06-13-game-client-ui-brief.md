# Industrial Juggernaut — Game Client UI Design Brief

**Date:** 2026-06-13
**Status:** Confirmed by Sam (impeccable shape pass; brief + visual direction probes).
**Companion docs:** architecture/system spec `2026-06-12-web-client-design.md` §4 (this brief is the UI half of that section); strategic context `PRODUCT.md`; visual system seed `DESIGN.md`.
**Method:** Produced via `/impeccable shape`. Three rendered direction probes (Atlas-table / War-room instrument / Strategy-clean); Sam selected a deliberate blend. Scope answers below are task-scoped and do not persist to PRODUCT.md/DESIGN.md.

## 1. Feature summary

The playable game screen plus its integrated designer instrument: a board-centric view where Sam/Tony (designer mode) and friends/family (playtesters) play full games against agents or hotseat opponents. Desktop-first, mobile-friendly enough for a check-in. It doubles as the balance instrument — live telemetry and quick-fork-with-tweaked-knobs live in the same visual language as the game.

## 2. Primary user action

Read the board state at a glance and commit one round's action (build / attack-chain / pass) with full knowledge of the odds. Everything else recedes so this stays effortless.

## 3. Design direction — committed blend

- **The board (hero) = Atlas-table lane:** aged parchment, cartographic ink linework, serif at game moments (the Cartouche Rule), brass frame fittings used sparingly.
- **Chrome / right rail / designer instruments = War-room lane:** cooler dark iron-walnut, mono-forward numbers, gauge components (the 36-factory supply counter), precise thin linework, optional coordinate ticks for the designer.
- **Color strategy:** Committed (DESIGN.md) — dark chrome carries 30–60%, parchment *only* on the board, brass accent ≤10% (primary actions, current selection, the Instruments affordance).
- **Candidate palette (committed by the probes; feeds real DESIGN.md token extraction after first client code):** walnut chrome `#241910` / `#2f2114`; parchment board `#d8c39c`–`#e6d8b8`; brass `#b78d3c`; CVD-safe player set oxide-red `#c0492f`, cobalt `#2f6f9f`, violet `#6f4a86`, each with a redundant shape top (circle / square / triangle), extended to 6. Convert to OKLCH and verify AA + CVD at build.
- **Scene sentence:** *A designer at a desk in evening lamplight, leaning over a glowing parchment campaign map on a dark workbench, brass instruments and a ledger to the right — focused, unhurried, probing.* (Forces dark chrome + luminous board.)
- **Anchors:** Tony's board art (warmth/materiality), Brass: Birmingham digital (period UI restraint), antique atlas plates (the board), Into the Breach (clarity benchmark for the board's information design — not its style).
- **Probe outcome:** the blend won; the board takes Atlas warmth, the instruments take War-room precision, and Strategy-clean's legibility discipline carries into the board's information design.

## 4. Scope (task-scoped)

Fidelity: this pass delivered a confirmed brief + direction probes. Breadth: the whole game-client surface (game screen + composers + rail + designer drawer + setup/first-run), built across Phase 1. Interactivity: shipped-quality components. Time intent: polish until it ships, phased.

## 5. Layout strategy

Board is the largest, brightest object, left-weighted, filling most of the viewport. A slim top bar (≤44px): wordmark, turn/phase + whose-move chip, seed/config readout (mono), Instruments button. One collapsible right rail: per-player resources (mono, shape-tagged), the prominent shared factory-supply gauge, the event log. Action composers appear **contextually next to the board** when it's your turn — never permanent panels. The designer drawer slides over the rail (designer mode only), read-only during others' turns. Prompts (defender choice, chain-continue, forced-pass) are lightweight, near the board, each with a one-line rule explanation (the teaching surface). On narrow desktop the board always wins space; the rail collapses first.

## 6. Key states

Default (your turn / waiting); build composing; attack composing (target → attackers → commitment → odds); chain-continue prompt; defender-choice prompt (+ timeout indicator online); combat resolution (choreographed reveal); elimination; victory (choreographed); forced-pass notice; setup phase (place first base); new-game / empty (the designer instrument); all-agent watch (client-side viewer, play/pause/step); reconnecting / version-mismatch reload; board-generating loading; friendly error (CSP-infeasible board params). Every choreographed state has a reduced-motion alternative.

## 7. Interaction model

Click your hex/region → contextual composer; legal targets highlighted from engine hints (`legalActions`); illegal attempts explained via rule callouts, not error codes. Attack: target → attackers → commitment pips/slider → **public odds shown before the draw** → resolve. Hover → control/iron/occupant tooltip. Designer: Instruments button → drawer (live telemetry: seed, full `RuleConfig`, per-move agent eval/odds); fork button → new-game screen pre-filled with the current config.

## 8. Content requirements

Custom SVG throughout (board, towers/shapes, iron/factory glyphs) — no raster game art needed for v1 (Tony's box art is a later landing-page asset). Copy: turn/phase, resource labels, factory supply "X / 36", odds (75 / 83 / 89 / auto), event-log lines (capture, build, elimination + bounty, victory), defender prompt + rule one-liner, forced-pass notice, board-gen error. Rules-reference = v10 text with Digital Edition Ruling callouts merged inline. Dynamic ranges: 2–6 players, 96–300 hexes, ≤12 bases/player, ≤36 factories, unbounded event log (virtualized).

## 9. Recommended impeccable references for build

`layout.md` (board + rail + composer spatial system), `colorize.md` (commit the OKLCH palette from the candidate hex), `typeset.md` (serif / sans / mono trio + Cartouche Rule), `animate.md` (combat / elimination / victory choreography + reduced-motion), `onboard.md` (setup phase, first-run, empty states), `harden.md` (error / edge / reconnect states).

## 10. Open questions (defaults asserted)

- The full 6-player shape set (3 beyond circle / square / triangle) needs CVD-sim verification — asserting diamond / pentagon / six-point; verify at build.
- Narrow-desktop space contention: board always wins, rail collapses first; mobile stays at PRODUCT.md's "check-in not broken" bar.
- The committed palette + visual lane feed the real DESIGN.md token extraction — re-run `/impeccable document` after the first client code lands to replace the DESIGN.md seed with extracted tokens and the component sidecar.
