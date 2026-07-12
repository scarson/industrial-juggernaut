# Handoff — 2026-07-12 overnight: UI/UX review + enhancement pass (PRs #75/#76/#77 merged); next: drama pass

**Date:** 2026-07-12 (overnight session, Sam-directed start, live-directed twice mid-run).
**Supersedes:** [`docs/plans/2026-07-12-session-handoff.md`](2026-07-12-session-handoff.md) — its §Seams 1/3/4 and its queue items *Instruments menu*, *Online join*, and *persistence* remain live; its queue items 1b (live top-bar labels) and part of 1c shipped this session. Its §Operational guardrails all still hold.
**Authoritative artifacts this handoff points at (not duplicates):**
- The full-session UX findings live in the PR bodies: [#75](https://github.com/scarson/industrial-juggernaut/pull/75) (truth & labels), [#76](https://github.com/scarson/industrial-juggernaut/pull/76) (board interactivity; adversarial-gate record in its comments), [#77](https://github.com/scarson/industrial-juggernaut/pull/77) (rules page).
- New pitfall: **WEB-7** (SVG overlay hit-testing + affordance/handler single-source) in [`docs/pitfalls/implementation-pitfalls.md`](../pitfalls/implementation-pitfalls.md).
- User memories added: `codex-token-expiry-blind-gate-substitution`, `browser-pane-coordinate-and-console-traps`.

**One line:** Sam asked for a fresh-eyes "is it fun?" review of the game interface; the verdict — lovely shell, but the game was a coordinate-chip form next to a picture of a board — drove three merged PRs (silent rejections now teach rules; the board itself is now the clickable interface with staged-piece ghosts, hover readout, turn banner and live top-bar labels; the rules page has a TOC, collapsible sections, self-explaining Ruling cards and four engine-rendered illustrations), leaving the **drama pass** (agent-turn pacing, victory staging on the board) speced below for a fresh session.

## Headline state

- **`origin/dev` tip:** `5b316714` (merge of #77). Working tree of this session's worktree: on `docs/2026-07-12-overnight-uiux-handoff` (this doc + WEB-7).
- **Staging verified as a cold visitor after each merge:** labels/banner/32 pointer-affordant placement cells confirmed live post-#76; "Digital Edition Ruling" marker confirmed in the served bundle post-#77.
- **Suite:** 705 client tests green at #77's tip; `typecheck:client`, `build:client`, `check:bundle` green throughout.
- **Codex CLI is DOWN:** refresh token expired mid-session (#75 got its codex pass; #76/#77 were gated by two/one fresh-context blind Opus adversarial rounds instead, disclosed on #76). **Sam action: `codex login`.**

## What shipped (pointers)

| PR | What | Merge |
|---|---|---|
| [#75](https://github.com/scarson/industrial-juggernaut/pull/75) | Rejected commands surface as NOT ALLOWED teaching callouts (store's `rejected` handler had discarded them); 1-based player labels (SetupPlacement was the only 0-based leak); HUD table headers + factory-supply label; NewGame's duplicate BOARD panels merged (knobs now feed generation; presets work) + friendly CSP-infeasibility gate (the probe previously THREW in a useMemo and white-screened the designer); placeRange-sensitive rule explanations (codex finding) | `43409ce8` |
| [#76](https://github.com/scarson/industrial-juggernaut/pull/76) | **The board becomes the interface** (UI brief §7, the descoped P3.11): `ui.boardHandlers` channel registry (placement/build/attackTarget) + PlayView routing by `highlightSets`; staged builds/attack selection publish to `ui.stagedBuild`/`ui.attackSelection` → brass ghosts; piece-typed build legality (`factoryHexes`/`baseHexes` — factories never legal on iron; clicking iron in factory mode auto-switches to Base; type-switch restarts staging so MIXED_PIECE_TYPES is unrepresentable); decorative layers `pointer-events:none` (WEB-7); hover surveyor readout (contested-aware, self-subscribing); turn banner + **live top-bar turn/seed labels** via the new `shell-labels` seam (App render-scoping pinned); affordance gated on the `selectComposer` resolution (blind-review P1) | `853570f2` |
| [#77](https://github.com/scarson/industrial-juggernaut/pull/77) | Rules page: hotlinked TOC with engraved dividers (Sam live-directed the dividers); `<details open>` collapsible sections (heading-rotor a11y fix); "Digital Edition Ruling N" cards (DER acronym never reaches the screen, test-pinned); four lazy engine-rendered illustrations (`rules/scenes.ts` + `RulesVignette` behind `VignetteBoundary`): placement ring, radiating disks, hull-vs-radiating, attack range | `5b316714` |

## Decisions made this session (rationale not re-derivable from code)

1. **Chips stay the keyboard/a11y action path; the board is the pointer path.** Board clicks route only through highlighted legal cells to the mounted composer's registered channel. DESIGN.md §5's composer contract was updated in #76 — do not "simplify" by removing the chip lists.
2. **Board-click legality is piece-typed and auto-switching.** Engine probe (recorded in #76's body): `legalActions` never emits factory-on-iron but does emit base-on-iron; the old single `buildHexes` union was the mechanism behind the silently-rejected factory-on-iron commit. Auto-switch happens only when nothing is staged (one piece type per build).
3. **Affordance = mounted handler, one source.** `selectComposer` is computed once in PlayView and passed down; `interactiveHexes` derives from it (WEB-7's second half). Any new composer wanting board clicks must claim a channel AND be included in that gate.
4. **Rejections are taught, not logged:** `authoritative.rejection` clears on any authoritative progress; STALE_INDEX never records (auto-resync). `explainError(code, state.config)` for placeRange-sensitive copy.
5. **Codex-unavailable substitution** (Sam's overnight gate was "/codex review + address findings"): fresh-context blind Opus rounds with PR disclosure, per the `codex-token-expiry-blind-gate-substitution` memory. Both rounds found real P1s — the substitute works, but it is a substitution, not the new normal.
6. **Drama pass deferred to a fresh session at Sam's direction** (session hit ~70% of 1M context). Spec below.
7. **Balance observation (NOT this track's to fix):** default 2P-vs-heuristic on the default preset loses on the player's FIRST click (agent's 3 radiating placements → instant iron victory), and a player placing their own 2nd base on iron can win symmetrically. The NewGame degeneracy warning shows, but the default preset walks a new player into a 1-click loss — worth raising when DER #18 leg 3 lands (balance track).

## Known advisories accepted (from the blind gates — carried, not fixed)

- **Mid-staging resync divergence:** a `sync` clears `ui.stagedBuild`/`ui.attackSelection` but a mounted composer's local `pieces`/`targetKey` survive; a post-resync Commit is re-validated by the reducer and fails safe to the rejection notice. Pre-existing pattern (mirrors `preview`); fix would be composers subscribing to sync epochs — YAGNI until online play makes resyncs common.
- **Hover readout is pointer-only** supplementary info (all actions remain keyboard-reachable via chips); not aria-live.
- **Brass budget on high-budget staging:** many staged ghosts = many brass strokes; stroke-only and transient, but eyeball it if budgets grow.
- **Victory freezes the turn banner/top-bar chip** on the final round's label — the drama pass should replace them with a game-over label.
- **`RulesVignette` re-runs `ruleScene` per render** (inconsequential — mounts once, no reactive props).
- **GameScreen.test spies on the Board module namespace** (`vi.spyOn(BoardModule, "Board")`) for the hover render-scoping test — works under current vitest/Vite ESM interop; if that test breaks mysteriously after a tooling bump, this idiom is the suspect.

## The drama pass — spec for the fresh session (Sam approved building it next)

**Problem (from the fresh-eyes review):** agent moves teleport in — three enemy placements and a victory can land inside one human click with zero pacing; ordinary moves get no board emphasis; victory is a text block with no spatial story (the winning iron is never shown).

**Design sketch (single-vision; build solo, review by blind fan-out):**
1. **Agent-turn pacing.** The LocalReducerDriver emits `applied` events in a burst. Do NOT touch the driver or store (authoritative folding must stay immediate — record/replay + online parity). Pace the *presentation*: PlayView already accumulates `applied` batches for the event log; introduce a presentation queue that reveals successive agent `applied` beats with ~350–500ms spacing (choreography timing family, `web/src/design/choreography.css` uses 360–680ms), rendering the board from the *presented* state index rather than the authoritative tip while beats drain. CAUTION: the composers/highlights must keep reading the AUTHORITATIVE state (never let a human act against a stale presented state) — the simplest safe cut is to pace only while `selectComposer` resolves to `waiting` (no controllable action anyway) and snap-to-tip the moment it's the human's turn or a prompt arrives. `prefersReducedMotion()` (in `web/src/design/motion.ts`) must snap instantly.
2. **Changed-hex emphasis.** On each presented beat, mark the just-changed hexes (the `applied.events` carry `placed`/`combat`/`baseDestroyed` hexes) with a brief emphasis — a transform-led pulse consistent with the Elevation section's feedback scale (150–250ms), opacity floor per DESIGN.md §4 (content never gated by motion). This is a Named-Rule brush (motion outside the four set pieces) — flag it as a judgment call in the PR body per `sam-design-taste-atmosphere`.
3. **Victory's spatial story.** When terminal, highlight the winner's controlling iron on the board (e.g. the brass selection treatment on `controlOf(state, winner).iron` — brass on many cells at game end is a deliberate Brass Budget brush; flag it) and swap the turn banner/top-bar labels to a game-over label ("Victory — Player N" via `turn-labels`).
4. Files to read first: `web/src/app/GameScreen.tsx` (PlayView: event accumulation seam, `stageableFrom`, `ChoreographyStage`), `web/src/design/choreography.css` + `motion.ts`, `web/src/game/choreography/*` (Victory has an animated/static split with `victory-static` testid), `web/src/hud/EventLog.tsx`, DESIGN.md §4 (motion discipline) + §5 (set pieces). Board emphasis likely = a new `emphasisHexes` Board prop rendered like highlights (a stroke/therm pulse class), tests structural + raise-then-lower console check (WEB-3).

**Process:** TDD red-first; blind adversarial gate (2 rounds while codex is down — or `/codex review` if Sam has re-authed); browser verification MUST drive a full agent turn and watch pacing live, plus reduced-motion; 375px; console via a page-side error counter (see `browser-pane-coordinate-and-console-traps`). Merge classification: Routine mechanically, but the PR body must flag the two Named-Rule brushes explicitly — if either feels heavy, downgrade to Review — Sam.

## Deferred / open (unchanged from the superseded handoff unless noted)

1. **Drama pass** — speced above. Unblock: none (Sam approved).
2. **Instruments menu** — `onInstrumentsClick` still unwired; brainstorm-first design work (PRODUCT.md: designer tooling wears the same clothes). Unblock: none, but it is a net-new taste surface — with Sam awake, propose before building.
3. **Online join (second human)** — untouched; token-distribution design problem (see superseded handoff §Seam 4). Unblock: brainstorm + Sam sign-off; Review-class regardless of standing grants.
4. **Compact-tier polish** — the expanded rail at 375px overlays/squeezes the main lane (seen during verification); landing below-fold walnut. Unblock: none.
5. **Sidecar refresh** — `.impeccable/design.json` drift GREW this session: no TurnBanner/HexReadout/shell-labels/rules-TOC/vignettes in its component set, and the board's interactivity contract is absent. Fold into the next `/impeccable document` run (its narrative Named Rules remain accurate; DESIGN.md §5's composer paragraph was updated in #76).
6. **Viewer's generate form** — NOT audited for the shadow-state trap #75 fixed in NewGame (its Players/Seed/Preset fields may bind correctly; nobody checked). Low priority.
7. **Defender prompt board-clicks** — the `boardHandlers` registry has no `defender` channel; defender choice is chips-only. Natural extension if wanted.
8. **`codex login`** — Sam, whenever convenient; then optionally `codex review` over `43409ce8..5b316714`.
9. **Persistence/resume; production cutover; DER #18 leg 3** — unchanged, other tracks/Sam-gated.

## Operational guardrails accumulated this session (durable homes cited)

- **WEB-7** (pitfalls doc): SVG paint order is hit-test order; affordance derives from the handler-mounting resolution; `elementFromPoint` first when a live click dies.
- **Browser-pane traps** (user memory `browser-pane-coordinate-and-console-traps`): clicks are screenshot-px not CSS-px; `read_console_messages` is accumulated history — use a page-side error counter.
- **Codex substitution protocol** (user memory `codex-token-expiry-blind-gate-substitution`).
- All prior guardrails in the superseded handoff (BEHIND≠conflict, cold-visitor verification, bun-only, gh merge local-cleanup error is cosmetic) held and were exercised this session.

## Priority queue

1. **[Fresh agent] Drama pass** (spec above).
2. **[Agent + Sam direction] Instruments menu** (propose UX first).
3. **[Agent, after brainstorm + Sam sign-off] Online join** (Review-class).
4. **[Agent] Compact-tier polish** (can ride with 1 or 2).
5. **[Sam] `codex login`; persistence decision; production cutover timing.**

## Continuation prompt (paste-ready for the fresh drama-pass session)

> You are resuming the Industrial Juggernaut SPA-client track to build the **drama pass**. **Read IN FULL first:** `docs/plans/2026-07-12-overnight-uiux-handoff.md` (especially §The drama pass and §Decisions — the spec and its cautions are there), then `PRODUCT.md` + `DESIGN.md` (mandatory before ANY UI work; Named Rules binding; §4 Elevation/motion discipline is the load-bearing part for this task), then `docs/pitfalls/implementation-pitfalls.md` §WEB-1–WEB-7.
>
> **State:** `origin/dev` tip `5b316714`. The game is playable on staging (https://industrial-juggernaut-staging.samuel-carson.workers.dev): the board is the clickable interface (chips remain the a11y path), rejections teach rules, the rules page teaches itself. 705 client tests green.
>
> **Your task:** the three-part drama pass speced in the handoff §The drama pass — (1) presentation-paced agent turns (never pace the store; pace only while `waiting`; snap on human turn/prompt/reduced-motion), (2) brief changed-hex emphasis on presented beats (Named-Rule brush — flag it), (3) victory's spatial story (winner's iron brass-marked + game-over labels; Brass Budget brush — flag it). Files-to-read list is in the spec.
>
> **Model routing** (Sam's standing `workflow-cost-discipline`): Sonnet for mechanical scaffolds, Opus for the taste/judgment work and blind review lenses, Fable only if a cross-layer architecture call emerges.
>
> **Process guardrails:** bun-only (`bun run test:client`, NEVER `bun test`); TDD red-first for all `web/src` production code; `git fetch origin dev` + branch off `origin/dev` in a `.claude/worktrees/<slug>` worktree (you cannot `git checkout dev`); PR to `dev` with a `## Merge classification` heading; adversarial gate before merge — `/codex review` if Sam has re-authed (`codex login`), else TWO fresh-context blind Opus rounds with a disclosure comment (see user memory `codex-token-expiry-blind-gate-substitution`); agent-merges Routine on green `check` (`gh pr merge --merge --delete-branch`; local cleanup error is cosmetic — delete the remote branch by hand). Verify in the Browser pane by DRIVING a full agent turn and watching the pacing live, plus `prefers-reduced-motion`, 375px, and a page-side console-error counter (user memory `browser-pane-coordinate-and-console-traps`: clicks are screenshot-px; `read_console_messages` is accumulated history). After merge, cold-visit staging. Do NOT edit `docs/git-strategy.md`/`CLAUDE.md`/`AGENTS.md`. Sam's taste floor: user memory `sam-design-taste-atmosphere` — flag every Named-Rule brush as an explicit judgment call in the PR body; if one feels heavy, classify the PR Review — Sam instead of merging.

## Adversarial review of THIS handoff

_(5 canonical + 1 session-specific; loop re-run after fixes.)_

### Round 1 — Naive fresh agent — 2 findings applied
Added the files-to-read list directly into the drama-pass spec (a fresh agent would otherwise hunt for the choreography system) and spelled out that `ui.boardHandlers` has no `defender` channel (deferred item 7) so the registry's shape isn't assumed complete.

### Round 2 — Recency-bias audit — 2 findings applied
The rules-page PR is loudest-in-memory; pulled the mid-session #75 material forward (the white-screening degeneracy probe, the placeRange codex finding) and recorded the early-session balance observation (1-click loss on defaults) as Decision 7 — it was observed at 03:00 and nearly slipped.

### Round 3 — Seam auditor — 2 findings applied
Made explicit that the drama pass MUST NOT pace the store/driver (record-replay + online parity depend on immediate authoritative folding) — the seam between presentation pacing and the authoritative stream is exactly where a fresh agent could corrupt the architecture. Also documented the sidecar-drift seam growing (deferred item 5) so the next `/impeccable document` run knows the gap widened.

### Round 4 — Operational guardrails auditor — 1 finding applied
The codex-substitution protocol lived only in a PR comment and chat; persisted as user memory + Decision 5 + the continuation prompt's gate instructions. WEB-7, browser traps confirmed already durable.

### Round 5 — Loss-averse auditor — 2 findings applied
Captured the accepted blind-review advisories (§Known advisories) — otherwise the next taste/correctness pass would either re-discover or "fix" deliberate deferrals — and the fragile Board-namespace spy idiom in GameScreen.test, which would otherwise be an unexplained mystery on a future tooling bump.

### Round 6 — Motion-discipline fidelity auditor (session-specific) — 1 finding applied
**Why this lens:** the handed-off task is the first work to add motion OUTSIDE the four sanctioned set pieces, in a design system whose §4 explicitly rations choreography, for a user whose taste calibration says both "atmosphere over flatness" AND "strip chrome with no job." The specific risk is the fresh agent either over-animating (juice popups — an anti-reference) or self-censoring (skipping the pass). Verified the spec names the exact motion budget (feedback scale 150–250ms for emphasis, choreography scale for pacing beats), the opacity-floor rule, the reduced-motion branch, and the flag-don't-self-censor instruction. Finding applied: added the explicit downgrade path ("if a brush feels heavy, classify Review — Sam") to both the spec and the continuation prompt.

**Loop outcome:** rounds 1–6 re-run after fixes; the second full pass produced zero material findings. Exiting on a clean sweep.
