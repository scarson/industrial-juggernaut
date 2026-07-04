# Handoff — SPA Client Track (Deliverable 2): P0–P3 merged, P4 (live play) is next

**Date:** 2026-07-03 (overnight autonomous run, continued)
**Authoritative plan:** [`docs/plans/2026-06-29-spa-client-plan.md`](2026-06-29-spa-client-plan.md) — its per-phase Execution Status banners + top table are the source of truth for phase state. This handoff POINTS at it; it does not duplicate it.
**Prior handoff (P3-entry, historical):** [`docs/plans/2026-07-03-spa-client-P3-handoff.md`](2026-07-03-spa-client-P3-handoff.md) — its **§Operational guardrails** are still valid and NOT repeated in full here; read them. Its body is the state at P3-*entry* (superseded banner at the top).

**What this is (one line):** Industrial Juggernaut is a hex-grid strategy game with a TypeScript rules engine (`src/`); Deliverable 2 is a Vite+React SPA client (`web/`) built in phases P0–P4 against that engine. P0–P3 are merged; P4 (online multiplayer over WebSocket) is next.

**Micro-glossary** (full definitions in the plan): **`GameDriver`** = the client's transport-agnostic interface — `submit(DriverCommand)` in, a stream of `DriverEvent`s out; three impls: `fake-driver` (tests), `LocalReducerDriver` (in-browser reducer — hotseat/offline, SHIPPED), `SocketDriver` (P4, over WebSocket). **Composer** = a contextual action panel next to the board (build/attack/defender/setup/turn-order). **The authoritative-state rule** = the store folds server `applied` entries via `applyEntry` (only when the log index lines up, else resync) and REPLACES state on `sync`; optimistic preview is advisory-only, cleared on every authoritative event, NEVER combat. **Bundle guard** (`check:bundle`) = fails if `src/agent` (P4: also `src/wire`) lands in the eager entry chunk instead of a lazy dynamic-import chunk. **DER** = Digital Edition Ruling (an engine rule that departs from the printed rules).

---

## Headline state

- **`dev` tip:** `32c482ff` (docs PR #61 merge). **P0+P1+P2+P3 all merged.** The SPA is **playable end-to-end** — real hotseat + offline-vs-agents — browser-verified on the in-browser reducer driver, live on staging.
- **No open PRs.** All session PRs (#56–#61) merged and their branches deleted.
- **This handoff's branch:** `docs/p4-handoff` (off `origin/dev` `32c482ff`) — carries this doc + a plan Discoveries(P3) note (choreography-animations). Merge it, then start P4 fresh.
- **⚠️ Local `dev` is STALE.** The main worktree's local `dev` sits at an old commit (~`f579d68f`); it was never realigned during this multi-phase effort (all work branched off `origin/dev` after fetching). **A fresh session MUST `git fetch origin dev` and branch off `origin/dev`, never local `dev`.** (Seam 5 below.)
- **Staging:** `https://industrial-juggernaut-staging.samuel-carson.workers.dev` serves the real SPA (all routes incl. `/game`), redeployed on every `dev` push.

## What shipped this session (pointers, not narrative — full detail in the plan)

- **P3 — Interactive play UI + LocalReducerDriver** ([PR #60](https://github.com/scarson/industrial-juggernaut/pull/60), merge `92003667`): the Zustand store, optimistic preview, the composer family (build/attack/defender/chain-continue/forced-pass/setup/turn-order + the extracted `shell.tsx` primitives), the HUD (reusing P2.7's `EventLog`/`event-copy`), combat/elimination/victory choreography, and the **`LocalReducerDriver`** wrapping the real `src/session` reducer + `src/agent` (lazy chunk) in-browser. `GameScreen` assembles them. Barrel additions: `isBootstrapOnly` (`src/index.ts`) + a web-side re-export of pure `distance`.
- **Docs accuracy** ([PR #61](https://github.com/scarson/industrial-juggernaut/pull/61), merge `32c482ff`): plan → P3 MERGED, P4 READY.
- **Pitfall WEB-3** (`docs/pitfalls/implementation-pitfalls.md` §4) + user memory `class-fix-needs-sweep-not-point-fix`: the border shorthand/longhand class lesson (see Seam 4 + Guardrails).

## Next phase — P4 (SocketDriver / live play) — READY, but Sam-merges

**Read the plan's PHASE P4 section — it is authoritative and now carries the execution notes.** Summary:
- P4 swaps the transport: a **`SocketDriver`** implementing the SAME `GameDriver` contract P3 built against, over a WebSocket to the `GameRoom` Durable Object, mapping `DriverCommand ↔ ClientCommand` and `ServerMessage ↔ DriverEvent`. It is the **ONLY** client module that imports `src/wire` (value-imports the codecs via dynamic `import()` — keep it out of the eager chunk, same discipline as the agent lazy-chunk). **P4 ADDS the SocketDriver; it does NOT remove the `LocalReducerDriver`** — hotseat/offline-vs-agents stays on the local driver, online play uses the socket driver. Both are `GameDriver` impls behind the same store/composer/HUD stack; nothing above the driver seam changes. That's why P4 is "a swap, not a rework."
- **The gate is OPEN:** the DO-host plan's Part B (`GameRoom` DO + Worker + staging deploy) AND `src/wire` shipped with Deliverable 1. **Before writing the SocketDriver, READ the SHIPPED `src/wire` + `src/host` surface** (the DO-host plan `docs/plans/2026-06-29-do-host-wire-protocol-plan.md` Part B banner + the actual code) — do not trust the plan's original assumptions about message shapes. (This is the same "verify the shipped surface, don't assume" lesson P3.10 learned when the plan's `Effects`/`turnRollover` assumption needed checking against the real reducer.)
- **P4.1 authors the honest total `WireErrorCode → DriverErrorCode` map** and MAY widen `DriverErrorCode`. P3's `LocalReducerDriver` used a *controller-scoped interim* total map (orphan BUILD_*/transport codes → `FROZEN`); when P4.1 defines the authoritative map, reconcile the LocalReducerDriver's mapping with it (Seam 3).
- **🔒 Every P4 PR is `Review — socket-auth / session management`, so SAM MERGES P4, NOT THE AGENT.** This is the one phase Sam's overnight auto-merge authorization does NOT cover. Build it, run the per-task + phase + adversarial review, open the PR, and STOP for Sam.
- **Honor the resolved agent-seat auth boundary** (DO-host plan §"Agent-seat auth boundary — RESOLVED", three layers): seat tokens minted for HUMAN seats only; the WS upgrade refuses to bind a socket to an agent seat; the reducer envelope rejects mutating commands from an agent-kind acting seat. A socket must NEVER drive an agent seat.

## Deferred / follow-up items (each with its unblock condition + link)

1. **#44 — Shell hosts the HUD via a rail-content context.** Retires the `SELF_CONTAINED_ROUTES` hack in `web/src/app/App.tsx` (which suppresses the shell's placeholder rail on `/game` so GameScreen's own rail doesn't double up). Introduce a React context: App is the provider (wraps both `<main>` and `RightRail`), `GameScreen` sets its HUD content into it (effect-based, cleared on unmount), `RightRail` renders provided content or the placeholder. The store is a module-level Zustand singleton, so the HUD subscribes fine wherever it's rendered — no store-plumbing needed. **Pickable now** (client-only, Routine); **ideally done at the START of the P4 session** so P4's GameScreen uses the clean seam from the start. Task #44.
2. **#46 — Choreography animations are unbuilt.** `web/src/game/choreography/*` + `TurnOrderCeremony` add `-animated` classes but there are **zero `@keyframes`/`animation:` rules in `web/src`** — the reveal renders honest static content with no motion (NOT a defect; the reduced-motion static branch + tests are correct). A `/impeccable animate` candidate. **Pickable now** (client-only, Routine). Task #46; recorded in the plan's Discoveries (P3).
3. **`/impeccable document` re-run.** The plan called for it after the first UI code (ran at P0 close-out). A refresh after P3's interactive UI would capture the composer/HUD/choreography component vocabulary into `DESIGN.md`. Non-blocking; nice-to-have.

## Seams (where context is silently lost — READ if resuming)

1. **P4 must read the SHIPPED `src/wire`/`src/host`, not the plan's assumptions.** The SPA plan was written before Deliverable 1 executed. Verify message shapes against the merged code. (Mirrors the P3.10 R4 lesson.)
2. **Agent-seat auth boundary is load-bearing for P4.** The three-layer defense (DO-host B6.2/B2.2 + reducer envelope) must be honored by the SocketDriver + session management. A regression here is a real security hole (a socket driving an agent seat).
3. **LocalReducerDriver's interim error map ↔ P4.1's honest map.** P3 shipped a controller-scoped total `WireErrorCode → DriverErrorCode` map; P4.1 defines the authoritative one (may widen `DriverErrorCode`). Reconcile — don't leave two diverging maps.
4. **The border shorthand/longhand class (WEB-3) — closed, but the LESSON generalizes.** A point fix on `TurnOrderTokens` left the identical bug in `AttackComposer`; the blind adversarial merge gate caught the sibling. Fix pattern-bugs with a codebase-wide sweep, not a point fix. Static jsdom tests miss re-render style reconciliation — the phase-close browser pass must DRIVE A STATE TRANSITION and read the console. De-emphasis regression tests must raise-THEN-lower (focus-then-blur). See pitfall WEB-3 + memory `class-fix-needs-sweep-not-point-fix`.
5. **Local `dev` is stale; branch off `origin/dev`.** See Headline state. `git fetch origin dev && git checkout -b <branch> origin/dev`.
6. **`gh pr merge --delete-branch` local-cleanup trap.** In this multi-worktree repo, `gh pr merge` prints `failed to run git: 'dev' is already used by worktree …` — this is ONLY local cleanup failing; the merge on GitHub SUCCEEDED and the remote branch is NOT deleted. Delete it by hand: `git push origin --delete <branch>`. (User memory `gh-merge-delete-branch-dev-worktree-trap`. P4 is Sam-merged so this is Sam's to hit, but the #44/#46 follow-ups are agent-merged and WILL hit it.)

## Operational guardrails (this session's additions; the rest are in the P3-entry handoff's §Operational guardrails, still valid)

- **Merge authority (Sam, standing overnight):** merge this-track PRs — Routine AND Review-class — ONLY after converged multi-round blind adversarial review (blind subagent tasked to FIND A BLOCKER, Opus-tier; iterate fresh blind reviewers until a round finds no blocker; fix what any round finds; re-verify closure with a fresh blind round before merging). **EXCEPTION: P4 is explicitly Sam-merges-only** (socket auth / session management) — build + review + PR, then STOP. Memory: `spa-client-merge-authorization`.
- **The blind adversarial merge gate is load-bearing — it has caught a CONFIRMED defect on BOTH #59 and #60** that per-task + phase review missed (#59: untrusted-import DoS; #60: the AttackComposer border-conflict sibling). Keep it for every PR; it earns its keep specifically on untrusted-input, auth, and "class-of-bug" surfaces.
- **The phase-close browser pass must DRIVE state transitions, not just screenshot.** It caught the `TurnOrderTokens` re-render warning that every static test + the phase review missed. Start a real game, take an action, advance a turn, and read the console at error level.
- **bun-only:** `bun run test:client` (SPA, ~507 tests, ~4s) / `bun run test` (root, 2170, ~60–110s, run in background), NEVER `bun test`. `bun run typecheck` + `typecheck:client`; `bun run build:client && bun run check:bundle`.
- **Bundle discipline:** the entry chunk must never contain `src/agent` OR (for P4) `src/wire` value-imports — both belong in lazy dynamic-import chunks. `check:bundle` proves it for the client entry graph, but Vite compiles ES workers as a SEPARATE Rollup build the guard never sees — verify worker/lazy chunks by grepping the built chunks, not just trusting `check:bundle`.
- **Worktree hygiene:** worktrees at `.claude/worktrees/<slug>`. Never `git commit` in a worktree while an implementer subagent is active there (use `git commit -- <paths>`); tell every isolated-worktree agent to stay strictly in its own worktree. (Memory: `controller-worktree-index-race`.)
- **Model tiering:** Opus for judgment-heavy/adversarial (gates, phase reviews, the SocketDriver + session-management design); Sonnet for mechanical/logic/docs. Two-stage review per task (spec THEN quality), both isolated-worktree blind subagents.

## Priority queue (numbered, with dependencies)

1. **[Agent, Routine] Merge THIS handoff branch** (`docs/p4-handoff` → `dev`): this doc + the plan Discoveries(P3) note. CI + self-fact-check (docs-only).
2. **[Agent, Routine] #44 — shell-hosts-HUD via rail-content context** (Task #44). Best done first so P4's GameScreen uses the clean seam. Retires the `SELF_CONTAINED_ROUTES` hack.
3. **[Sam-merges, Review-class] P4 — SocketDriver / live play** (Task #45). Read the plan's PHASE P4 section + the SHIPPED `src/wire`/`src/host` first. Every P4 PR STOPS for Sam.
4. **[Agent, Routine, anytime] #46 — choreography animations** (Task #46) + **`/impeccable document` re-run** — both non-blocking polish.
5. **[Sam-gated, SEPARATE plan] §8 production cutover** — do NOT edit `docs/git-strategy.md`/`CLAUDE.md`/`AGENTS.md` (still main-centric) until Sam approves the prod cutover. Authoritative: DO-host plan §"Deferred / Sam-gated".

## Continuation prompt (paste-ready for a fresh agent)

> You are resuming the Industrial Juggernaut deployable-client track. **SPA client Phases P0, P1, P2, P3 are all merged to `dev`** (`origin/dev` tip was `32c482ff` at handoff — `git fetch origin dev` and branch off `origin/dev`, NOT local dev which is stale). The game is playable end-to-end (hotseat + offline-vs-agents) on the in-browser `LocalReducerDriver`, live on staging. Read the handoff `docs/plans/2026-07-03-spa-client-P4-handoff.md` IN FULL first (its §Seams + §Operational guardrails, and the P3-entry handoff's §Operational guardrails it points to), then the plan `docs/plans/2026-06-29-spa-client-plan.md` — its PHASE P4 section is the authoritative task spec and is marked READY.
> **First:** merge the pending handoff branch `docs/p4-handoff` → `dev` (docs-only, Routine, CI + self-fact-check). **Then (recommended order):** (a) Task #44 — refactor the shell to host the HUD via a rail-content context, retiring the `SELF_CONTAINED_ROUTES` hack in `App.tsx`, so P4's GameScreen uses the clean seam (client-only, Routine, merge under Sam's authorization after a converged blind adversarial round). (b) **P4 — the `SocketDriver`**: BEFORE writing it, read the SHIPPED `src/wire` + `src/host` surface (the DO-host plan `docs/plans/2026-06-29-do-host-wire-protocol-plan.md` Part B banner + the merged code) — do not trust the SPA plan's pre-Deliverable-1 assumptions about message shapes. Implement the `GameDriver` over a WebSocket to the `GameRoom` DO; it is the ONLY module importing `src/wire` (dynamic `import()`, out of the eager chunk). P4.1 authors the honest total `WireErrorCode → DriverErrorCode` map (may widen `DriverErrorCode`; reconcile with the LocalReducerDriver's interim map). Honor the resolved agent-seat auth boundary (a socket must never bind/drive an agent seat — DO-host B6.2/B2.2 + reducer envelope). **CRITICAL: every P4 PR is Review-class (socket auth / session management) — build + per-task/phase/adversarial review + open the PR, then STOP for Sam. P4 is NOT covered by the overnight auto-merge authorization.**
> Guardrails: bun-only (`bun run test:client` / `bun run test`, never `bun test`); the client entry chunk must never contain `src/agent` or `src/wire` value-imports (lazy chunks only — verify built chunks, not just `check:bundle`); the blind adversarial merge gate is load-bearing (it caught real defects on #59 and #60 that per-task review missed) — run it before every merge; the phase-close browser pass must DRIVE a state transition and read the console (static tests miss re-render defects); worktrees at `.claude/worktrees/<slug>`, never commit there while an implementer is active (`git commit -- <paths>`); `gh pr merge --delete-branch` prints a local-cleanup error but the merge succeeds — delete the remote branch by hand (`git push origin --delete <branch>`); model-tier per `workflow-cost-discipline` (Opus for the SocketDriver/session/gates, Sonnet for mechanical). Do NOT edit `docs/git-strategy.md`/`CLAUDE.md`/`AGENTS.md` (§8 cutover, Sam-gated).

## Adversarial review of THIS handoff

_(6 canonical + 1 session-specific round; loop re-run after fixes; outcome at the end.)_

### Round 1 — Naive fresh agent — 2 findings applied
The doc assumed you know what the project is and what "GameDriver"/"composer"/"the authoritative-state rule"/"bundle guard"/"DER" mean. Added a one-line **What this is** + a **Micro-glossary** of the five load-bearing terms (with "full definitions in the plan" so it orients without duplicating). Reading order (this handoff → its guardrails-pointer → the plan's P4 section) now yields every definition.

### Round 2 — Recency-bias audit — 0 findings
Recent items (border-conflict fix, the two merges) are not over-represented at the expense of mid-session state: the full P3 execution lives in the plan (pointed to); the LocalReducerDriver interim error map (Seam 3), WEB-2/`/impeccable`-re-run (deferred items), and the choreography gap (item 2) are all captured. Nothing hot-but-recent crowded out.

### Round 3 — Seam auditor — 1 finding applied
Six seams, each naming both sides. Added the **"P4 adds SocketDriver, does NOT remove LocalReducerDriver"** clarification (both `GameDriver` impls coexist; nothing above the driver seam changes) — the one meeting point a fresh P4 agent could get wrong by "replacing" the local driver. The #44-before-P4 ordering seam is in deferred item 1.

### Round 4 — Operational guardrails auditor — 0 findings
Guardrails are durable: this session's additions are inline; the rest are referenced in the P3-entry handoff's still-valid §Operational guardrails (on `dev`). The load-bearing P4-Sam-merges rule is in the plan's P4 banner, task #45, and here — triple-covered.

### Round 5 — Loss-averse auditor — 0 findings
Scanned for transcript-only "oh by the way" items: the choreography-animations gap (item 2 + plan Discoveries + task #46), the `/impeccable document` re-run (item 3), the `distance` re-export (in "what shipped"), and the controller-scoped interim error map (Seam 3) are all in durable artifacts, not just chat.

### Round 6 — Authorization-boundary handoff auditor (session-specific) — 0 findings
**Why this lens:** this session's defining pivot is that the NEXT phase (P4) is the ONE place the standing overnight merge-authorization does NOT apply — every P4 PR is Sam-merges-only (socket auth / session management). The single most dangerous handoff failure is a fresh agent inheriting "you have merge authority" and merging a P4 socket-auth PR autonomously. Verified the Sam-merges-only constraint is unmissable: it appears in the §Next phase header (🔒), §Operational guardrails (EXCEPTION), the priority queue, the continuation prompt (CRITICAL … STOP for Sam), the plan's P4 banner, AND task #45 — six independent placements, each phrased as a hard stop. No finding; the boundary is over-documented by design.

### Round 7 — Holistic fact-check (elected) — 0 findings
Per the `handoff-continuation-factcheck` memory (grep every path/symbol, don't trust prose): verified `src/wire`, `src/host`, both plan docs, the P3-entry handoff, `SELF_CONTAINED_ROUTES` (App.tsx), `isBootstrapOnly` (src/index.ts), `WireErrorCode` (src/wire), `DriverErrorCode` (web/src/game/driver.ts), the choreography dir contents, and the SHAs (`dev` `32c482ff`, P3 merge `92003667`) all exist/match. Zero discrepancies.

**Loop outcome:** Rounds 1 and 3 produced material findings (fixed); I re-ran all seven rounds after applying them and the full pass produced zero further material findings. Exiting at a clean sweep.

