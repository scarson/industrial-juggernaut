# Handoff — 2026-07-12: Site navigable + landing shipped; docs run merged; next: instruments menu, live labels, online join

**Date:** 2026-07-12 (session spanned 2026-07-04 → 2026-07-12 across a machine sleep).
**Supersedes:** [`docs/plans/2026-07-04-session-handoff.md`](2026-07-04-session-handoff.md) — its §Operational guardrails remain valid; its "Deliverable 2 COMPLETE / playable" headline needed the navigation caveat this session closed (see §The playability gap below).
**Authoritative plans (this handoff POINTS, doesn't duplicate):**
- SPA client: [`docs/plans/2026-06-29-spa-client-plan.md`](2026-06-29-spa-client-plan.md) — P0–P4 banners COMPLETE; the navigation/landing work this session was post-plan polish Sam directed live.
- DER #18 (engine, setup-victory): [`docs/plans/2026-07-04-der18-setup-victory-plan.md`](2026-07-04-der18-setup-victory-plan.md) — Phases 1+2 shipped to `dev` (PRs #71/#72, merged 2026-07-04); leg 3 (default-knob) remains the balance track's, not this one's.
- Production cutover (Sam-gated, unstarted): [`docs/plans/2026-06-29-do-host-wire-protocol-plan.md`](2026-06-29-do-host-wire-protocol-plan.md) §"Deferred / Sam-gated".

**One line:** The game is now genuinely playable on the live staging site — a crafted landing (the DESIGN.md "Map Table" scene with a real-board hero) with working entry points shipped as PR #73 (Sam merged), the `/impeccable document` full run shipped as PR #70, and the remaining track work is the instruments menu, live top-bar labels, online join for a second human, and compact-tier polish.

## Headline state

- **`dev` tip:** `3d92b1b2` (merge of [PR #73](https://github.com/scarson/industrial-juggernaut/pull/73)). Working tree clean; no open PRs on this track.
- **Staging is live and verified:** https://industrial-juggernaut-staging.samuel-carson.workers.dev auto-deploys on every `dev` push (~20s). Post-#73 deploy succeeded (run 29183993580); the served bundle was curl-verified to carry the landing (`Begin a game` / `landing-plate` markers). **A cold visitor can now navigate: landing → Begin a game → NewGame designer → play vs agents; wordmark returns home.**
- **Merged this session:** [#70](https://github.com/scarson/industrial-juggernaut/pull/70) (full `/impeccable document` run: `.impeccable/design.json` schemaVersion-2 regen + two DESIGN.md accuracy fixes; Sam approved the merge after a BEHIND-not-conflict rebase) and [#73](https://github.com/scarson/industrial-juggernaut/pull/73) (top-bar layout + the Map Table landing + navigation + dead-chrome removal; blind-gated, Sam merged). Remote branches deleted.
- **Worktrees:** this session ran in `.claude/worktrees/hopeful-bell-b304d7` (left on the handoff docs branch). Local `dev` is stale as always — **`git fetch origin dev` and branch off `origin/dev`; you cannot `git checkout dev`** (main worktree holds it). A dev server may still be running from this worktree on **port 5273** (local `.claude/launch.json` was temporarily pointed at 5273 because another session owned 5173; that edit was deliberately **reverted, not committed** — if 5173 is free, the committed config works as-is).

## What shipped this session (pointers, not narrative)

| PR | What | Merge |
|---|---|---|
| [#70](https://github.com/scarson/industrial-juggernaut/pull/70) | Full `/impeccable document` scan-mode run — sidecar regenerated (choreography motion signatures, material-layering "shadows", 10 components incl. Composer + Victory); DESIGN.md accuracy fixes (factory gauge = tunable `config.factorySupply`, no elimination/bounty HUD counter; Hierarchy re-tensed) | `88559d76` |
| [#73](https://github.com/scarson/industrial-juggernaut/pull/73) | Top bar real layout (no more "——" collision; receding readouts; 375px zero-overflow) + **the Map Table landing** (Cartouche title plate; real engine-driven six-player board as hero in a lazy chunk; lamplight; Begin/Watch/Rules entry points; wordmark home link) + **semantic dead-chrome removal** (RailHost: rail mounts only when instruments are published; Instruments button renders only when wired; rail fixed at 19rem) + `VignetteBoundary` + DESIGN.md §5 synced | `3d92b1b2` |

Full diffs are the source of truth; the PR bodies carry the review trail (blind adversarial gate on #73: no blockers, 2 concerns fixed/flagged, 2 nits).

## The playability gap (context a fresh agent needs)

The 2026-07-04 handoff said Deliverable 2 was "playable… live online over the real DO." That was true at the driver/game level but **the top-level navigation never existed**: `HomeScreen` was a dead-end stub, `navigate()` had zero callers, `App` passed `<TopBar/>` no props. Sam experienced "the game isn't playable on the live site." This session closed the forward path (landing → all routes; wordmark → home). Lesson recorded: *"playable end-to-end" claims must be verified as a cold visitor on the deployed URL, not from tests or direct-URL navigation.*

## Decisions made this session (rationale not re-derivable from code)

1. **Rail semantics are now publish-driven** (`RailHost` in `web/src/app/shell/rail-content.tsx`): the rail mounts ONLY while a screen has published instruments. Rationale: an empty rail panel + placeholder on landing/viewer/rules violated "panels earn their pixels"; Sam asked "why do Instruments and Rail even appear?" The placeholder concept is deleted (not hidden). DESIGN.md §5 updated in-branch.
2. **The Instruments button recedes until wired** (`TopBar.tsx`): brass never sits on an inactive control (Brass Budget). It has been inert since P0 on every route. It returns automatically when `App` passes `onInstrumentsClick` — that wiring is the next agent's work, NOT a revert of this decision.
3. **The landing hero is the real Board renderer, not illustration** (`web/src/app/home/scene.ts` + `TableVignette.tsx`): a deterministic engine-driven six-player mid-game scene (seed 7n, size 150, 28 build-preferring rounds — all six shape/pattern identities visible). Rationale: authentic, zero clip-art risk, reuses the proven renderer. It value-imports the engine, so it lives in a **lazy chunk** (`React.lazy`) — same entry-graph discipline as the drivers/dev page; `check:bundle` enforces only `src/agent`+`src/wire`, but keep the discipline anyway.
4. **`landingScene` deliberately does NOT reuse `devState.ts`** — that file is marked DEV-ONLY/not-a-product-route; the two share engine primitives but curate different scenes. Don't "deduplicate" them into one module without deciding the dev file's product status first.
5. **`VignetteBoundary`** (exported from `HomeScreen.tsx`): a failed vignette (dropped lazy chunk on bad wifi, engine throw) leaves an empty parchment plate and working actions. Decoration must never white-screen the landing. There is still **no app-level error boundary** — only the vignette is guarded.
6. **The lamplight** (`landing.css` `.landing-lamplight`, brass-500 @ 13% alpha radial): flagged to Sam in the PR as a judgment call vs a strict ~10% Brass Budget reading; **he merged without objection** — treat as accepted (the budget governs brass *elements*; the glow is the North Star's "glowing at center" as light). Recorded with his broader taste calibration in user memory `sam-design-taste-atmosphere`.
7. **Landing copy makes no "resume" promise** — the old stub's "Start or resume" was dropped because no persistence exists. Don't reintroduce resume language before persistence is real.

## Seams (read before resuming)

1. **`.impeccable/design.json` has minor drift vs post-#73 DESIGN.md:** the sidecar's "Top Bar" snippet still shows the Instruments button unconditionally and no landing components exist in its component set. The narrative/rules blocks are still accurate (no Named Rule changed). Low priority; fold into the next `/impeccable document` touch-up rather than a dedicated PR.
2. **Engine modules in the eager chunk are pre-existing, not a #73 regression:** ~10 `src/engine/*` modules were already eagerly bundled on `origin/dev` (via `GameScreen` → `engine-client/barrel` value imports like `legalActions`); #73's blind reviewer verified the eager chunk grew only ~2.2KB and `scene.ts` stayed lazy. If bundle size becomes a concern, widening `check:bundle`'s scope is a deliberate follow-up, not a bug fix.
3. **Merge-authorization posture:** the `spa-client-merge-authorization` standing grant (agent merges track PRs after multi-round blind adversarial review) remains in force. #73 was left for Sam only because he was actively directing that exact surface mid-session. Default back to: blind gate → agent merges Routine; **Review-class → Sam** (net-new taste surfaces he hasn't directed, and ALL auth/token/join work).
4. **Second-human online join is a token-distribution design problem, not just UI:** `createRoom` (web/src/game/rooms.ts → src/host/room-create.ts) mints human-seat tokens **at create time and returns them all to the creator**; seat-claim vocabulary exists in `src/session/seats.ts`/`src/wire/protocol.ts`. A joiner needs a token the creator holds — so the join flow is share-link UX **plus possibly host changes** (e.g. claim-time minting). Any host/token change is Review-class + adversarial gate (three-layer agent-seat auth decisions are recorded in the 2026-07-03 deployable-client handoff §Decisions).
5. **`GameScreen` still creates local games via `header` alone and shows NewGame first** — the landing's "Begin a game" lands on `/game`'s NewGame designer, which is the intended designer-first flow (PRODUCT.md: the client doubles as the balance instrument). Don't "streamline" NewGame away for a quick-start button without Sam.

## Deferred / open (each with unblock condition + authoritative link)

1. **Instruments menu** — wire `onInstrumentsClick` to a real designer-tooling surface (PRODUCT.md: config knobs/telemetry in-client). Unblock: none — design work, brainstorm first. The button auto-returns when wired ([TopBar.tsx](../../web/src/app/shell/TopBar.tsx)).
2. **Live top-bar labels** — `turnLabel`/`seedLabel` are never passed; PlayView holds the state. Needs a shell-labels seam parallel to rail-content (do NOT make `App` subscribe to game state — see the render-scoping invariant in `App.test.tsx`). Unblock: none.
3. **Online join (second human)** — see Seam 4. Unblock: brainstorm + Sam's sign-off on the token-distribution shape (Review-class).
4. **Compact-tier polish** — landing leaves ~600px empty walnut below the fold on phones (#73 review NIT); board "check-in" tier gating from the UI brief §5 was never fully realized. Unblock: none.
5. **Persistence/resume** — nothing persists a local game across reloads. Unblock: Sam deciding it's wanted.
6. **Sidecar touch-up** — Seam 1. Unblock: next `/impeccable document` run.
7. **§8 production cutover** — unchanged, Sam-gated, separate plan ([wire-protocol plan §Deferred](2026-06-29-do-host-wire-protocol-plan.md)). Do NOT edit `docs/git-strategy.md`/`CLAUDE.md`/`AGENTS.md` before it.
8. **DER #18 leg 3** — balance track's, per [the adjudication §Ruling](2026-07-03-setup-iron-victory-adjudication.md).

## Operational guardrails accumulated this session (durable homes cited)

- **"BEHIND" ≠ merge conflict.** GitHub's strict up-to-date requirement blocks merges with `mergeStateStatus: BEHIND` while `mergeable: MERGEABLE`; the fix is rebase onto `origin/dev` + `--force-with-lease` + green CI, not conflict archaeology. (Also in the 2026-07-04 handoff guardrails; bit again on #70.)
- **A flex sibling of the hero surface needs an explicit width policy** — new pitfall **WEB-6** in [`docs/pitfalls/implementation-pitfalls.md`](../pitfalls/implementation-pitfalls.md) (rail sized to a long line's max-content; invisible to jsdom).
- **Verify the deployed surface as a cold visitor** before claiming "playable/live" (§The playability gap). curl the bundle for feature markers; click through in a real browser.
- **Sam's taste floor is above literal token compliance** — user memory `sam-design-taste-atmosphere` (the merged landing is the calibration reference; strip chrome with no job; flag Named-Rule brushes as judgment calls instead of self-censoring).
- **`gh pr merge --delete-branch` local-cleanup error** in this multi-worktree repo is cosmetic; the merge succeeds — delete the remote branch by hand if it survives. (Standing; user memory exists.)
- **bun-only:** `bun run test:client` / `bun run typecheck:client` / `bun run build:client` / `bun run check:bundle`; never `bun test`. Dev server via the Browser pane's `spa-dev` launch config, never bash.

## Priority queue

1. **[Agent] Instruments menu + live top-bar labels** (items 1–2; one coherent "shell completion" effort; taste surface → blind gate; Sam merges if net-new taste).
2. **[Agent, after brainstorm + Sam sign-off] Online join** (item 3; Review-class security surface).
3. **[Agent] Compact-tier polish** (item 4; can ride with #1).
4. **[Sam] Persistence/resume decision** (item 5) and, whenever he chooses, **production cutover** (item 7).

## Continuation prompt (paste-ready for a fresh agent)

> You are resuming the Industrial Juggernaut SPA-client track. **Read these IN FULL first:** this handoff (`docs/plans/2026-07-12-session-handoff.md` — especially §Seams and §Decisions), then `PRODUCT.md` + `DESIGN.md` (mandatory before ANY UI work; DESIGN.md's Named Rules are binding), then `docs/pitfalls/implementation-pitfalls.md` §WEB-1–WEB-6.
>
> **State:** `origin/dev` tip `3d92b1b2`. The game is playable on staging (https://industrial-juggernaut-staging.samuel-carson.workers.dev — auto-deploys on every `dev` push, ~20s): landing → Begin a game → NewGame designer → hotseat/vs-agents play; online play works for the room creator. The landing is the DESIGN.md "Map Table" scene (real-board hero, lazy chunk, `VignetteBoundary`); the rail mounts only when a screen publishes instruments (`RailHost` in `web/src/app/shell/rail-content.tsx`); the top bar's readouts and Instruments button recede until given a job.
>
> **Your work queue (in order):**
> 1. **Shell completion:** (a) wire the Instruments button (`onInstrumentsClick` in `web/src/app/App.tsx` → a real designer-tooling surface; brainstorm the UX first — PRODUCT.md wants config knobs/telemetry in-client, "designer tooling wears the same clothes"); (b) live top-bar `turnLabel`/`seedLabel` from PlayView (`web/src/app/GameScreen.tsx`) via a shell-labels seam parallel to rail-content — App must NOT subscribe to game state (the render-scoping test in `web/src/app/App.test.tsx` pins this); (c) compact-tier polish (landing below-fold walnut; UI brief §5 check-in tier).
> 2. **Online join for a second human** — STOP and brainstorm first, then get Sam's sign-off on the shape: `createRoom` (`web/src/game/rooms.ts` → `src/host/room-create.ts`) mints all human-seat tokens to the CREATOR at create time; a joiner needs token distribution (share-link vs claim-time minting = a host/auth change). ANY token/auth change is Review-class: adversarial Opus gate tasked to find a blocker, Sam merges.
> 3. Optional riders: sidecar Top Bar snippet refresh (next `/impeccable document` touch); persistence/resume only if Sam asks.
>
> **Model routing (Sam's standing instruction, `workflow-cost-discipline`):** default **Sonnet** for mechanical/spec-following work (test scaffolds, doc syncs, straightforward components, mechanical refactors). **Opus** for judgment-heavy work: anything Sam will look at (design/taste surfaces), adversarial/blind review gates, auth/token/join surfaces, debugging live-state weirdness, subagent-verified fixes. **Fable** only where the judgment delta genuinely warrants it: the join-flow security design, final taste review of a net-new surface, cross-layer architecture calls. Cap verifier fan-out (1 blind reviewer for small diffs; 2–3 lenses only for auth or class-of-bug fixes). Use workflows in moderation — single-vision design work is built solo and *reviewed* by fan-out, not designed by committee.
>
> **Process guardrails:** bun-only (`bun run test:client`, NEVER `bun test`); TDD red-first for all `web/src` production code; `git fetch origin dev` + branch off `origin/dev` (you cannot `git checkout dev` — main worktree holds it); worktrees at `.claude/worktrees/<slug>`; PR to `dev` with a `## Merge classification` heading; blind adversarial review before EVERY merge (standing `spa-client-merge-authorization` condition) — then agent-merges Routine on green `check`; **Review-class → Sam merges** (auth/token/join, and net-new taste surfaces he hasn't already directed). If a PR goes `BEHIND`, rebase + `--force-with-lease` + green CI (it is not a conflict). `gh pr merge --merge --delete-branch`; if local cleanup errors, the merge still succeeded — delete the remote branch by hand. Verify visually in the Browser pane (desktop + 375px; drive a state transition and read the console — WEB-3) and, after merge, confirm the staging deploy as a cold visitor. Do NOT edit `docs/git-strategy.md`/`CLAUDE.md`/`AGENTS.md` (production-cutover deliverables, Sam-gated). Sam's taste floor: see user memory `sam-design-taste-atmosphere` — the merged landing is the atmosphere reference; strip chrome that has no job; flag Named-Rule brushes as explicit judgment calls.

## Adversarial review of THIS handoff

_(6 canonical + 1 session-specific; loop re-run after fixes.)_

### Round 1 — Naive fresh agent — 2 findings applied
Added §The playability gap (a fresh agent reading only the 07-04 handoff would inherit its "playable" framing and skip cold-visitor verification) and the port-5273 note (a fresh agent hitting a dead 5173 or a mystery 5273 server would burn time). Every queue item names its entry files.

### Round 2 — Recency-bias audit — 1 finding applied
The landing work is recent and loud; the mid-session #70 material (sidecar regen contents, the BEHIND-not-conflict resolution, DER #18 71/72 having merged during the week) was pulled into the shipped table, guardrails, and Authoritative-plans block so it isn't crowded out.

### Round 3 — Seam auditor — 1 finding applied
The load-bearing seam is **join = token distribution, not UI** (Seam 4) — a fresh agent would otherwise build a share-link UI against tokens the joiner can't obtain. Also made explicit: merge-authorization posture (Seam 3) so #73's leave-for-Sam isn't misread as revoking the standing grant, and the devState/landingScene non-dedup rationale (Decision 4) so a cleanup pass doesn't merge them blindly.

### Round 4 — Operational guardrails auditor — 0 findings
All session guardrails have durable homes: WEB-6 in pitfalls, the taste calibration in user memory `sam-design-taste-atmosphere`, BEHIND≠conflict in two handoffs, cold-visitor verification here. Nothing lives only in transcript.

### Round 5 — Loss-averse auditor — 2 findings applied
Captured the lamplight acceptance (Decision 6 — otherwise the next taste pass might "fix" what Sam accepted) and the no-resume-copy decision (Decision 7 — the old stub's promise must not creep back). The earlier chat-only continuation prompt is superseded by this doc's (chat is ephemeral).

### Round 6 — Taste-direction fidelity auditor (session-specific) — 1 finding applied
**Why this lens:** this session's defining character was Sam live-directing visual taste ("sad… blob of browns"; "why do Instruments and Rail appear?"). The specific risk is a next agent either (a) regressing his calls (re-adding placeholder rails, dead brass, resume copy) or (b) over-generalizing them (stripping the Instruments button *concept*, muting all atmosphere). Verified each taste decision states both the change AND its boundary (Decision 2: recede-until-wired is not button removal; Decision 6: lamplight accepted, not unbounded brass license; memory: atmosphere ≠ chrome). Finding applied: added Seam 5 (don't streamline NewGame away) — Sam directed entry-point *presence*, not designer bypass.

### Round 7 — Mechanical fact-check of the continuation prompt (elected; per `handoff-continuation-factcheck`) — verified clean
Every path/symbol/SHA/URL in the continuation prompt and headline greped against the tree and forge: `3d92b1b2` = origin/dev tip ✓; staging URL + deploy run ✓ (bundle markers curl-verified); `web/src/app/shell/rail-content.tsx` exports `RailHost` ✓; `web/src/app/App.tsx` `onWordmarkClick`/no `onInstrumentsClick` ✓; `web/src/game/rooms.ts` + `src/host/room-create.ts` + `src/session/seats.ts` exist with the stated token semantics ✓; WEB-6 present in pitfalls ✓; memory file `sam-design-taste-atmosphere.md` + MEMORY.md index line ✓; test/gate commands match package.json ✓.

**Loop outcome:** Rounds 1, 2, 3, 5, 6 produced findings (applied); re-ran all seven after fixes; the final full pass produced zero further material findings. Exiting on a clean sweep.
