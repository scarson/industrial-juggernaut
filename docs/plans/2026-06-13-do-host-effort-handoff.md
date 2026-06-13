# Session Handoff — Web-client foundation complete + DO-host effort kicked off (2026-06-13)

Durable consolidation for the next session. Detail lives in the linked artifacts; this doc is the map + the priority queue + a paste-ready continuation prompt. Points at artifacts rather than duplicating them.

> **⚡ UPDATE (later same session): plan 1 is now EXECUTED + merged** ([PR #20](https://github.com/scarson/industrial-juggernaut/pull/20), `dev` tip `915bbdba`). The `src/session/` Session Record & Replay Core ships: 8 source files, 40 new tests (engine now **386 green**), determinism proven by the live-driver cross-checks + replay-equivalence property tests, `src/index.ts` agent-free purity preserved. Plan 1's own Execution Status banners are all ✅. **Priority queue and continuation prompt below are updated accordingly — the new top item is "draft plan 2", NOT "execute plan 1".** The 4-plan table and "what shipped" below still say "plan 1 ready to execute" in places (point-in-time when this doc was written); the authoritative current state is this banner + plan 1's own ✅ banners.

## Headline state

- **Branch / tip:** `dev` at `dfe7107e` (all work merged). Local `claude/kind-dewdney-6a6267` mirrors `origin/dev`, clean tree. Worktree: `.claude/worktrees/kind-dewdney-6a6267`.
- **Branch flow (still in mid-cutover):** branch off `dev`, PR to `dev`, merge on green `check`. The repo's `docs/git-strategy.md` + CLAUDE.md/AGENTS.md still describe the OLD main-only flow — STALE; ignore until the cutover lands (DO-host plan 4). See memory [[web-client-foundation-phase1a]].
- **Engine state:** 346 vitest tests green, `bun run typecheck` clean. `bun run test` (NEVER `bun test`), bun-only machine.
- **CI noise:** every PR shows a red **"Workers Builds"** Cloudflare check — expected (no Worker exists yet); it does NOT gate merges (merge gate = the GitHub Actions `check` job). It should go green once DO-host plan 3 adds a `wrangler` Worker.

## What shipped this session (artifact pointers, not narrative)

- **Web-client foundation (Phase 1a) — COMPLETE.** All 7 phases merged: PRs [#11](https://github.com/scarson/industrial-juggernaut/pull/11)–[#17](https://github.com/scarson/industrial-juggernaut/pull/17). Plan + per-phase Execution Status: `docs/plans/2026-06-13-web-client-foundation-plan.md` (top banner: "All 7 phases done"). Delivered: CI gate, attack-validation fixes, bootstrap-factory-only (**gate `baseCount===1`**, not `<4` — see pitfalls GEO-7), `BoardSource` move + `representativeDefender` + RNG codec, the human-choice setup phase (`initGame`/`placeFirstBase`, structurally identical), the public API barrel `src/index.ts`, and the engine-vs-rulebook fidelity audit (**0 bugs**; spec Digital Edition Rulings #8–#17 added).
- **DO-host effort plan 1 — WRITTEN + MERGED (not yet executed).** `docs/plans/2026-06-13-session-record-replay-plan.md` (PR [#18](https://github.com/scarson/industrial-juggernaut/pull/18)). The pure Session Record & Replay Core: wire format, `applyEntry` round state machine, `recordGame`, `replayLog`, validation predicates. Passed `plan-review-cycle` (4 rounds incl. a cross-model codex round; review record in the plan). All Execution Status banners are `⬜ NOT STARTED` — **ready to execute**.
- **Fidelity audit artifact:** `docs/plans/2026-06-13-fidelity-audit-findings.md` (0 bugs, 7/7 known DERs confirmed, DERs #8–#17 + the #17 balance flag).

## The DO-host effort is a 4-plan arc (scope decision — flag for Sam)

Spec §3 says "the DO is a thin host (sockets, storage, one alarm) around a **pure `GameSession` module — TDD'd in plain vitest, no workerd**." Applying that seam + the writing-plans Scope Check, the §3/§6/§7 work split into 4 plans (full rationale in plan 1's Discoveries):

| Plan | Scope | Status |
|---|---|---|
| **1 — Session Record & Replay Core** | wire format + deterministic record→replay + validation; infra-free, bun/vitest; powers §4's all-agent viewer | ✅ written + merged (#18); ⬜ not executed |
| **2 — Interactive `GameSession` reducer** | human commands (`build`/`attack`/`endRound`/`pass`/`placeFirstBase` + `expectedLogIndex`), pending-decision/defender substitution, seat-claim, resync, wire events. Still pure (no workerd). Builds on plan 1's `applyEntry`/validation. | ⬜ not written |
| **3 — Durable Object host + staging deploy** | the thin DO wrapper (storage rows + atomic multi-key `put`, recovery/snapshot+tail, `replayVersion` mismatch, critical-section await-before-broadcast, hibernation, defender-timeout alarm, seat-claim CAS) + Worker shell + `wrangler.jsonc` + `@cloudflare/vitest-pool-workers` tests + `deploy-staging.yml` + the `replayVersion` CI guard. **Needs Cloudflare DO/Workers research** (the `cloudflare`/`durable-objects`/`workers-best-practices`/`wrangler` skills bias to Cloudflare docs — use them). | ⬜ not written |
| **4 — Production cutover (§6)** | `promote.yml`, `PROMOTE_TOKEN`, `main` branch protection, default-branch flip to `dev`, the `git-strategy.md`/CLAUDE.md/AGENTS.md rewrites, replay-compat golden-corpus gate, staging e2e smoke. Needs a staging-validated Worker (plan 3). Review-class — Sam merges. | ⬜ not written |

**If Sam wanted ONE monolithic DO-host plan instead of this split, restructure** — but plan 1's content (the replay model, wire format, validation) is needed under any split and isn't wasted.

## Open items that need Sam (both non-blocking, both already routed)

1. **Task 1.2 — `dev` branch protection** (foundation plan Phase 1, Task 1.2). Verified `gh api` command is IN that plan's Task 1.2 ("VERIFIED COMMAND" block). Sam runs it (admin); the merge gate works without it. My token is admin but per the plan Sam runs the protection change.
2. **DER #17 — overlapping iron double-counted** across the radiating↔perimeter boundary. Documented as spec ruling #17 + flagged as a possible balance bug. Spun off as a background task chip ("Balance review: overlapping iron…") for a future balance pass; `control()` stays pure for now. Sam asked to flag-not-investigate.

## Operational guardrails accumulated (so a fresh agent doesn't re-discover)

- **`bun run test`, never `bun test`** (bun's native runner ignores `vitest.config.ts`). [[local-env-bun-only]]
- **Code > the rules doc** as source of truth (the rules doc predates thousands of sim-iteration rounds). A code/rules mismatch is a candidate Digital Edition Ruling, not a bug. [[code-over-rules-doc-source-of-truth]]
- **Tautological mutual-consistency tests:** two functions sharing an implementation path (record/replay) can't test each other — cross-check against trusted independent code. [[tautological-mutual-consistency-tests]] (plan 1 Task 4.1 bakes this in.)
- **Engine-barrel purity:** `src/index.ts` is deliberately agent-free (foundation Phase 6). The session surface that pulls in agents (`recordGame`) goes on a SEPARATE `src/session/index.ts` — plan 1 Task 6.2 enforces this. Do NOT add agent-dragging exports to `src/index.ts`.
- **`advanceRound` now throws on a turn-0 (setup) state** (foundation Phase 5). Setup placement is `placeFirstBase`, which transitions turn 0→1 on the last placement.
- **Merge cadence:** one PR per phase to `dev`, auto-merge on green `check`; classification in the PR body (`## Merge classification`). Serialized, sequential phases (each branches from fresh `origin/dev`).
- **Git mechanics gotchas (hit every merge this session):**
  - **`dev` is checked out in the MAIN repo worktree** (`/Users/sam/Code/industrial-juggernaut`), so you CANNOT `git checkout dev` inside this worktree. Cut phase branches from the ref: `git checkout -b feat/<slug> origin/dev` (after `git fetch origin dev`). To sync the worktree's own branch to dev: `git reset --hard origin/dev`.
  - **Merge with `gh pr merge <N> --merge`, NOT `--delete-branch`.** `--delete-branch` ERRORS locally ("'dev' is already used by worktree at …") because gh tries to switch to dev locally; the remote merge still succeeds but it's confusing. After merging, delete the branch manually: `git push origin --delete <branch>` + `git branch -D <branch>` (switch off it first). Never `--squash`/`--rebase`.
  - **Wait for CI with a monitor**, not bash sleep+poll. The `check` job is the gate; ignore the red "Workers Builds".
- **Spec:** `docs/superpowers/specs/2026-06-12-web-client-design.md` (§3 session model/wire format, §4 client, §5 engine work, §6 gitflow/CI-CD, §7 testing, Digital Edition Rulings #1–#17). Authoritative for what to build.
- **Cost discipline:** tier subagent models per task (sonnet default; opus/codex where judgment delta matters). [[workflow-cost-discipline]]

## Priority queue (numbered, with dependencies)

0. ~~**Execute plan 1**~~ — ✅ DONE (PR #20, merged to `dev`; `src/session/` ships, 386 tests green).
1. **Draft plan 2** (interactive `GameSession` reducer) from spec §3 (Wire protocol + Pending decisions + the agent-drive invariant). Still pure/vitest. Builds on plan 1's now-shipped `applyEntry`/`validation`/`recordGame`/`replayLog` (real symbols on `dev` — `src/session/index.ts` barrel). Use the proven plan-flow: `superpowers:writing-plans-enhanced` → `plan-review-cycle` (incl. a cross-model codex round). **(Recommended next.)**
2. **Sam: run Task 1.2** branch-protection command (independent).
3. **Draft plan 3** (DO host + staging deploy) — needs Cloudflare research (use the `durable-objects`/`cloudflare`/`wrangler`/`workers-best-practices` skills). Largest infra surface. Wraps plan 1+2's pure `GameSession`.
4. **Draft plan 4** (production cutover) — after plan 3 produces a staging-validated Worker.
5. **(Optional) wire up §4's all-agent viewer** — plan 1's `recordGame`/`replayLog` are the backend; a Phase-1 minimal viewer (step through a recorded game) can be built on them independently of the DO host.

## Continuation prompt (paste-ready for a fresh session)

> Continue the Industrial Juggernaut DO-host effort. State: web-client foundation (Phase 1a) AND DO-host **plan 1 (Session Record & Replay Core)** are both COMPLETE and merged to `dev` (tip is whatever `git log origin/dev` shows; **386 tests green**; the `src/session/` module ships record/replay/validation). The 4-plan decomposition + current status is in `docs/plans/2026-06-13-do-host-effort-handoff.md` (read its ⚡ UPDATE banner). **Read that handoff first**, then CLAUDE.md + `docs/pitfalls/*` + the spec `docs/superpowers/specs/2026-06-12-web-client-design.md`.
>
> Branch off `dev` (NOT main — the repo's git-strategy.md is stale; see the handoff), PR to `dev`, merge on green `check` (the red "Workers Builds" check is expected noise, not a gate). `bun run test` (never `bun test`); bun-only machine. Git gotchas: branch from `origin/dev` (can't `git checkout dev` — it's checked out in the main worktree); merge with `gh pr merge <N> --merge` then delete the branch manually (`--delete-branch` errors locally).
>
> **Default task: draft plan 2 — the interactive `GameSession` reducer** from spec §3 (Wire protocol: command envelope + `expectedLogIndex` + seat-claim + resync; Pending decisions: defender proposal/substitution + timeout; the agent-drive invariant). It's pure/vitest (no workerd), building on plan 1's shipped `applyEntry`/`recordGame`/`replayLog`/validation (`src/session/index.ts`). Use `superpowers:writing-plans-enhanced` → then `plan-review-cycle` (≥3 rounds incl. a cross-model codex round — that round caught the highest-value bugs in plan 1). If instead Sam wants to first build §4's minimal all-agent VIEWER on plan 1's record/replay, that's priority-queue item 5. Confirm `bun run test` is green on `dev` before any code.

## Adversarial review of this handoff

7 rounds, looped after material findings until a full clean pass:

- **Round 1 — naive fresh agent (1 finding):** spec path was implicit (only via plan 1) → added the explicit `docs/superpowers/specs/2026-06-12-web-client-design.md` path with a section map.
- **Round 2 — recency-bias audit (0):** mid-session foundation work covered via pointers, not under-documented.
- **Round 3 — seam auditor (0):** plan-dependency chain (2→1, 3→staging-Worker, 4→3), the session-barrel-vs-engine-barrel purity seam, and the Workers-Builds-goes-green-when-plan-3-lands transition all explicit.
- **Round 4 — operational guardrails auditor (0 new):** guardrails consolidated with pointers to their durable homes (memory, pitfalls GEO-7, CLAUDE.md).
- **Round 5 — loss-averse auditor (0):** the scope-decomposition rationale + the "Sam might want a monolith" flag are captured (here + plan 1 Discoveries).
- **Round 6 — resumption-correctness auditor (session-specific, 2 findings):** this session's defining activity was the dev-branch gitflow with per-phase PR/merge cadence; a fresh agent resuming is most likely to mis-step on git mechanics. Caught two real gotchas I hit every merge: (a) `dev` is checked out in the main worktree so `git checkout dev` fails — branch from `origin/dev`; (b) `gh pr merge --delete-branch` errors locally (remote merge still succeeds) — use `--merge` then delete manually. Added both to Operational guardrails.
- **Round 7 — holistic coherence (fresh-eyes top-to-bottom, 0):** the doc reads headline → shipped → 4-plan arc → Sam items → guardrails → priority queue → continuation prompt; the continuation prompt correctly bootstraps off this doc. Coherent.

Loop re-run after the R1/R6 fixes produced 0 new material findings across all rounds.
