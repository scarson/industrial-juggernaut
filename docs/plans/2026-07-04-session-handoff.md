# Handoff — 2026-07-04: Deliverable 2 complete; DER #18 + DESIGN.md refresh queued for Sam

**Date:** 2026-07-04 (long autonomous session, continued from the P4-entry handoff).
**Authoritative plans (source of truth for phase state — this handoff POINTS, does not duplicate):**
- SPA client: [`docs/plans/2026-06-29-spa-client-plan.md`](2026-06-29-spa-client-plan.md) — its banners now read **Deliverable 2 COMPLETE**.
- DER #18: [`docs/plans/2026-07-04-der18-setup-victory-plan.md`](2026-07-04-der18-setup-victory-plan.md) + design [`docs/superpowers/specs/2026-07-04-der18-setup-victory-implementation-design.md`](../superpowers/specs/2026-07-04-der18-setup-victory-implementation-design.md).
- Iron-victory ruling (merged): [`docs/plans/2026-07-03-setup-iron-victory-adjudication.md`](2026-07-03-setup-iron-victory-adjudication.md) §Ruling.
**Prior handoff (superseded):** [`docs/plans/2026-07-03-spa-client-P4-handoff.md`](2026-07-03-spa-client-P4-handoff.md) — its P4 entry state; its §Operational guardrails are still valid.

**One line:** Industrial Juggernaut's SPA client (Deliverable 2) is now feature-complete and merged — playable hotseat, offline-vs-agents, and **live online over the real Durable Object**. Two things are open for Sam's review; one substantial engine effort (DER #18) is planned and awaiting his go-ahead.

## Headline state

- **`dev` tip:** `8c2d31af` (PR #67 merge — Sam merged the DESIGN.md refresh mid-session). **Deliverable 2 (SPA client P0–P4 + #44 + #46) COMPLETE.** Staging serves the real SPA; live online play confirmed end-to-end against the DO.
- **One PR open — for Sam (NOT auto-merged):**
  - **[#68](https://github.com/scarson/industrial-juggernaut/pull/68)** — DER #18 design + implementation plan (planning material; needs his approval + a merge-authority decision before implementation). Branch `docs/der18-plan`.
  - This handoff's branch: `docs/2026-07-04-session-handoff` (carries this doc + the SPA-plan P4-merged banner update). Branched off `034d95f4`; rebase onto `origin/dev` `8c2d31af` before merge (behind by the #67 merge; no conflict — #67 touched DESIGN.md, this branch touches the SPA plan + the handoff doc).
- **Worktree:** the session worktree at `.claude/worktrees/sleepy-swanson-77354b` (currently on the handoff branch). Local `dev` is stale as always — **`git fetch origin dev` and branch off `origin/dev`.**

## What shipped this session (merged to `dev` — pointers, not narrative)

| PR | What | Merge |
|---|---|---|
| [#63](https://github.com/scarson/industrial-juggernaut/pull/63) | **#44** — shell hosts the game HUD via a rail-content context (retired `SELF_CONTAINED_ROUTES`) | `d3718318` |
| [#64](https://github.com/scarson/industrial-juggernaut/pull/64) | **DER #18 adjudication** — the setup-phase iron-victory ruling (decision doc) | `2621d14f` |
| [#65](https://github.com/scarson/industrial-juggernaut/pull/65) | **P4 — SocketDriver live play** over WebSocket to the `GameRoom` DO | `45dee708` |
| [#66](https://github.com/scarson/industrial-juggernaut/pull/66) | **#46 — choreographed set pieces** (combat/elimination/victory/turn-order motion) | `034d95f4` |
| [#67](https://github.com/scarson/industrial-juggernaut/pull/67) | **DESIGN.md refresh** — targeted additive (choreography motion + composer/HUD/set-piece vocabulary; preserves the P0 tokens/Named-Rules). Sam merged it mid-session. | `8c2d31af` |

Full P4 detail lives in the SPA plan's PHASE P4 section + Deviations/Discoveries (P4). DER #18 ruling detail in the adjudication doc §Ruling.

## Open for Sam (in-flight, his to decide)

1. **PR #68 — DER #18 design + plan.** Planning material only (no engine code). Needs Sam's approval AND a **Phase-1 merge-authority decision**: Phase 1 carries a `REPLAY_VERSION` bump (replay-compat blast radius) + a deliberate winner-semantics change; does the `balance-redesign-merge-authorization` extend to this fidelity change, or does Sam merge Phase 1 himself? The plan defaults to Review-class + blind gate + STOP for Sam.

_(PR #67, the DESIGN.md refresh, is now MERGED — Sam accepted it. If a fuller pass is later wanted, the full scan-mode `/impeccable document` run — which also regenerates the `.impeccable/design.json` sidecar the targeted refresh skipped — has a paste-ready prompt in §Appendix A.)_

## Ready-to-dispatch (once Sam clears the prerequisite)

- **DER #18 implementation** — execute [`docs/plans/2026-07-04-der18-setup-victory-plan.md`](2026-07-04-der18-setup-victory-plan.md). **Prerequisite:** Sam approves PR #68 + answers the Phase-1 merge-authority question. The plan is subagent-proof (an adversarial plan-review round verified the engine facts empirically and pinned the exact test-breaker set). Phase 2 (frontend designer warning) is independent and can go anytime. Recommended execution: subagent-driven development (fresh subagent per task, two-stage review), as this track has run all session.

## Deferred (each with its unblock condition + link)

1. **DER #18 engine + designer-warning implementation** — ⏸ pending Sam's approval of the plan and the Phase-1 merge-authority decision. Unblocker: [PR #68](https://github.com/scarson/industrial-juggernaut/pull/68) approved/merged. Once cleared, the plan's per-phase banners are the live state.
2. **§8 production cutover** — ⏸ Sam-gated (his explicit go/no-go to deploy to production). This is the ONE thing genuinely waiting on Sam re: `docs/git-strategy.md` / `CLAUDE.md` / `AGENTS.md`: those three docs still describe the OLD `main`-centric flow **deliberately** — the DO-host plan defers their rewrite to the cutover plan because the final gitflow shape (which branch is production, the promote mechanism, branch-protection shape) is *decided by* the cutover. The rewrites are a **deliverable of** the cutover plan, not a standalone task; do NOT edit those three docs before the cutover. The cheap independent prerequisite (default branch → `dev`) is already done. Authoritative: [`docs/plans/2026-06-29-do-host-wire-protocol-plan.md`](2026-06-29-do-host-wire-protocol-plan.md) §"Deferred / Sam-gated".
3. **Full `/impeccable document` scan-mode run** (sidecar regeneration) — ⏸ pending Sam wanting it (PR #67 is the interim targeted refresh). Prompt in §Appendix A.
4. **DER #18 leg 3 (default-knob change)** — the balance-redesign track's job (its board-gen iron-reachability constraint may subsume it). Not this plan. See the ruling §Ruling leg 3 + the `balance-sweep-two-regime-finding` memory.

## Operational guardrails accumulated this session (durable; the rest are in the P4-entry handoff's §Operational guardrails)

- **A codex-review cycle catches what the internal gate misses.** On P4, codex found a [P1] the whole-branch blind gate missed (the staging E2E script logged live seat tokens — the gate focused on *client production* code, not the E2E script). And a blind Opus follow-up on the codex fixes caught that the first reload-guard fix reintroduced the exact infinite reload loop it meant to prevent. Multi-model + multi-round review earns its keep on the "class-of-bug" and untrusted-surface edges.
- **`connection:"open"` precedes the server's reload/sync verdict** (pitfall WEB-5 + memory `reload-loop-guard-clear-on-sync-not-open`): a reload loop-guard must clear its marker on the first `sync` (compatibility confirmed), never on transport `open`. `makeFakeDriver` auto-emits a `sync` on subscribe, which MASKS this bug — a loop test needs a driver that emits `open`→`reload-required` with no sync.
- **The bundle guard's `!dynamicallyImported`→eager proxy false-flags a chunk shared by two dynamic importers** (pitfall WEB-4 + memory `bundle-guard-shared-lazy-chunk-false-positive`): classify eager by static-import reachability from entries. And: in any build-guard raise-then-lower proof, first prove the raise changed the artifact before trusting the guard's verdict (a P4.1 probe drew a false conclusion from an injection that never survived tree-shaking).
- **Verify the shipped surface, don't trust the plan.** P4 corrected four wire assumptions by reading the merged `src/wire`/`src/host` (STALE_INDEX-as-pushed-resync, hello-doubles-as-sync, `"pong"` frames, `seatClaimed`-dropped). The DER #18 plan review corrected a grep keyed on `cause:"iron"` when the engine uses `reason:` (missing a last-standing GAME_OVER test).
- **`gh pr merge --delete-branch` prints a local-cleanup error in this multi-worktree repo but the GitHub merge SUCCEEDS** — delete the remote branch by hand (`git push origin --delete <branch>`). Hit on every merge this session.
- **Strict-up-to-date `dev`:** if a PR falls behind (another PR merged first), rebase onto `origin/dev`, `git push --force-with-lease`, wait for CI, then merge. Hit on P4 (#64 landed while P4 was open).

## Priority queue (numbered)

1. **[Sam] Review PR #68** (DER #18 plan) + decide Phase-1 merge authority.
2. **[Agent, after #1] DER #18 implementation** — execute the plan; Phase 2 (frontend warning) can start independently anytime.
3. **[Sam-gated] Production cutover** — separate plan; his go/no-go.
4. **[Optional] Full `/impeccable document` run** — §Appendix A prompt (PR #67 was the interim targeted refresh, now merged).

## Continuation prompt (paste-ready for a fresh agent)

> You are resuming the Industrial Juggernaut project. **Deliverable 2 (the SPA client, P0–P4 + #44 + #46) is COMPLETE and merged to `dev`** (`origin/dev` tip `8c2d31af`; `git fetch origin dev` and branch off `origin/dev`, never local `dev`). The game is playable hotseat, offline-vs-agents, and live-online over the real DO. Read this handoff (`docs/plans/2026-07-04-session-handoff.md`) IN FULL, then the SPA plan (`docs/plans/2026-06-29-spa-client-plan.md`, banners = COMPLETE). **One PR is open for Sam: #68 (DER #18 design+plan) — do not merge it; it's his** (the DESIGN.md refresh #67 already merged). The next agent-executable work is **DER #18 implementation** — but ONLY after Sam approves PR #68 and answers the Phase-1 merge-authority question (the `REPLAY_VERSION` bump). Execute `docs/plans/2026-07-04-der18-setup-victory-plan.md` under subagent-driven development (fresh subagent per task, two-stage review), honoring its assertion-rigor guards on the test-remediation task (Task 1.3 — re-express/invert, NEVER delete or weaken the old-timing assertions). Phase 2 (the frontend designer warning) is independent and may start anytime. Guardrails: bun-only (`bun run test` / `bun run test:client`, never `bun test`); branch off `origin/dev`, PR to `dev`, `gh pr merge --merge` then delete the remote branch by hand; the blind adversarial gate is load-bearing (it and the codex cycle caught real defects on P4); do NOT edit `docs/git-strategy.md`/`CLAUDE.md`/`AGENTS.md` (§8 cutover, Sam-gated). Model-tier per `workflow-cost-discipline`.

## Appendix A — full `/impeccable document` run prompt (paste-ready)

_Use this if Sam wants the complete DESIGN.md regeneration + the `.impeccable/design.json` sidecar (PR #67 is the interim targeted refresh)._

> You are doing a **full `/impeccable document` scan-mode run** for the Industrial Juggernaut SPA client (Deliverable 2 is feature-complete and merged to `dev`). Branch off `origin/dev` (`git fetch origin dev && git checkout -b docs/impeccable-full-run origin/dev`); PR to `dev`; you cannot `git checkout dev` (it's in the main worktree); merge with `gh pr merge --merge` + delete the remote branch by hand. bun-only. **Reconcile with the existing crafted DESIGN.md** (it already follows the 6-section spec with OKLCH-hex frontmatter and a strong set of Named Rules — Table / Parchment-Belongs-to-the-Board / Brass Budget / Cobalt–Violet Shape / Cartouche / Honest Numbers / Material-Layering; North Star "The Map Table"): preserve every Named Rule and the token frontmatter; a targeted additive refresh already landed as PR #67 — fold it in / supersede it and note the reconciliation (don't leave two competing DESIGN.md PRs). The **key missing piece is the `.impeccable/design.json` sidecar** (schemaVersion 2): colorMeta with tonal ramps, typographyMeta, shadows (mostly flat/tonal-layering), **motion** (the `motion.ts` feedback scale + the four `choreography.css` set-piece signatures: settle/sink/rise/stagger + the warm brass victory title glow), breakpoints (wide ≥1100 / narrow ≥768 / compact), 5–10 representative components as self-contained shadow-DOM HTML/CSS snippets, and the narrative block verbatim from DESIGN.md. Scan: tokens (`web/src/design/{tokens.ts,tokens.css,typography.css,motion.ts,choreography.css}` — hex in frontmatter, OKLCH canonical in prose + tokens.ts, don't split the source of truth), player identity + the CVD gate (`web/src/design/cvd-check.test.ts`, `web/src/identity/`), and the component families: shell (`web/src/app/shell/`), board (`web/src/board/`), designer (`web/src/designer/NewGame.tsx`), composers (`web/src/composers/`), HUD (`web/src/hud/`), choreography (`web/src/game/choreography/`), viewer/rules (`web/src/viewer/`, `web/src/rules/`). REUSE the existing qualitative language (North Star, color character names, elevation philosophy) — this is a refresh of a crafted system, identity-preservation wins; only invent new descriptive language for genuinely undocumented surfaces. Verify every cited path/symbol/token value against the tree; keep the six section headers character-exact; `bun run test:client` (the tokens-sync + cvd-check gates must stay green). **Docs in Sam's taste domain — open the PR and leave it for Sam to review/merge, do not auto-merge.**

## Adversarial review of THIS handoff

_(6 canonical rounds + 1 session-specific; loop re-run after fixes; outcome at the end.)_

### Round 1 — Naive fresh agent — 1 finding applied
Added the one-line "what this is" + the authoritative-plans pointer block up top, and spelled out that DER #18 is an ENGINE effort separate from the SPA-client (Deliverable 2) track (a fresh agent could otherwise think it's more client work). The continuation prompt names the exact next action + its prerequisite.

### Round 2 — Recency-bias audit — 1 finding applied
The DESIGN.md refresh (PR #67) and the impeccable full-run prompt are RECENT; the mid-session items (the codex-review cycle's two catches, the DER #18 ruling that merged hours ago as PR #64, the WEB-4/WEB-5 pitfalls) are pulled forward into §Operational guardrails + the shipped table so they aren't crowded out by the closing docs work.

### Round 3 — Seam auditor — 1 finding applied
The load-bearing seam: **PR #68 (DER #18 plan) is planning-only and MUST NOT be executed until Sam approves it + decides Phase-1 merge authority.** A fresh agent inheriting "there's a plan, execute it" would violate the Sam-gated version bump. Called out in Ready-to-dispatch (prerequisite), Deferred #1, the priority queue (#2 before #3), and the continuation prompt (ONLY after Sam). The PR-#67-vs-full-impeccable-run seam (don't leave two competing DESIGN.md PRs) is in Appendix A.

### Round 4 — Operational guardrails auditor — 0 findings
This session's guardrails (codex-cycle value, WEB-4/WEB-5, verify-the-shipped-surface, the gh-merge-delete-branch trap, strict-up-to-date dev) are in §Operational guardrails AND cross-linked to their durable homes (pitfalls docs WEB-4/WEB-5, memories `reload-loop-guard-clear-on-sync-not-open` / `bundle-guard-shared-lazy-chunk-false-positive`). Nothing left only in transcript.

### Round 5 — Loss-averse auditor — 1 finding applied
The **impeccable full-run prompt lived only in an ephemeral scratchpad** — folded it into Appendix A (durable) so a loss of session context doesn't destroy it. The cutover clarification (nothing waiting on Sam for the three docs; they're deferred-by-design) was transcript-only — captured in Deferred #2.

### Round 6 — Merge-authority / Sam-gate handoff auditor (session-specific) — 0 findings
**Why this lens:** this session's defining risk is a fresh agent MERGING something that's Sam's to gate — PR #67 (his taste domain), PR #68 (needs his approval + the version-bump merge-authority call), or worse, executing the DER #18 plan and shipping a `REPLAY_VERSION` bump autonomously. Verified every Sam-gate is unmissable: PR #67 and #68 are marked "for Sam, NOT auto-merged" in Headline state, Open-for-Sam, the priority queue, and the continuation prompt; the DER #18 execution prerequisite (Sam approves #68 + merge-authority) appears in Ready-to-dispatch, Deferred #1, the queue, AND the continuation prompt — four independent placements. No finding; over-documented by design.

### Round 7 — Holistic fact-check (elected) — 1 finding applied
Per the `handoff-continuation-factcheck` memory (grep every path/SHA/PR, don't trust prose): the fact-check CAUGHT a real staleness — **Sam merged PR #67 (the DESIGN.md refresh) mid-session** (`8c2d31af`), so the draft's "#67 open for Sam" was already wrong. Fetched, corrected: dev tip is `8c2d31af`, #67 is MERGED (moved to the shipped table + the priority queue/continuation-prompt updated to only #68 open). Re-verified: dev tip `8c2d31af`, all five merge SHAs (`d3718318`/`2621d14f`/`45dee708`/`034d95f4`/`8c2d31af`) ancestors of dev, PRs #63–#67 MERGED + #68 OPEN, all plan/spec/adjudication paths exist, SPA plan banners read COMPLETE. Zero remaining discrepancies. (This round earned its keep — the prose was stale within minutes of writing.)

**Loop outcome:** Rounds 1, 2, 3, 5, 7 produced findings (applied); re-ran all seven after applying them and the full pass produced zero further material findings. Exiting at a clean sweep.
