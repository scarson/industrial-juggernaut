# Handoff — Web Client design → plan session (2026-06-12/13)

**Author:** Claude (this session). **Purpose:** resume the Industrial Juggernaut web-client effort with zero context loss. This doc POINTS at the durable artifacts; it does not duplicate them.

## Headline state

- **Branch:** `dev` (the new integration branch) — tip `d89c4e0b`, pushed to origin. Local `main` mirrors `origin/main` (`9e32071d`).
- **Worktrees:** none live.
- **PRs:** none open.
- **Working tree:** clean except untracked `.context/` (holds the codex session id — see Seams) and this `docs/handoffs/` file.
- **What's next:** execute the foundation plan (Phase 1a) in a FRESH session via `superpowers:subagent-driven-development`. Paste-ready prompt at the bottom.

## What shipped this session (artifact pointers)

| Artifact | Location | State |
|---|---|---|
| Strategic context | `PRODUCT.md`, `DESIGN.md` (on `main`) | DESIGN.md is a SEED — re-run `/impeccable document` after first client code to extract real tokens |
| Architecture/system spec | `docs/superpowers/specs/2026-06-12-web-client-design.md` | DRAFT v3, two adversarial review rounds folded in |
| UI design brief | `docs/superpowers/specs/2026-06-13-game-client-ui-brief.md` | Confirmed (impeccable shape + 3 rendered direction probes; "blend" lane chosen) |
| Phase 1a implementation plan | `docs/plans/2026-06-13-web-client-foundation-plan.md` | Reviewed (4-round `plan-review-cycle`), subagent-ready, all phases ⬜ NOT STARTED |
| Memory | `~/.claude/projects/-Users-sam-Code-industrial-juggernaut/memory/` | `workflow-cost-discipline`, `plan-review-cross-model-value`, `local-env-bun-only` (all in MEMORY.md index) |

The plan is a **living document** (Living Document Contract + per-phase Execution Status banners). Read its banners for execution state; update them as you go. Its "Plan review cycle record" and "Discoveries" sections carry the review history and the gitflow-transient warning.

## Session arc (how we got here)

`/impeccable init` (PRODUCT.md + DESIGN.md seed) → `superpowers:brainstorming` (architecture spec, two review rounds: a multi-agent workflow + a codex consult each) → `/impeccable shape` (UI brief + visual probes) → `superpowers:writing-plans(-enhanced)` (foundation plan) → `plan-review-cycle` (4 rounds, codex as cross-model reviewer). All design decisions are logged in the spec's "Decisions made in this brainstorm" + the brief; the plan's review record logs the plan-level findings.

## In-flight work

None. The design+plan phase is complete and committed. Nothing is mid-execution.

## Ready to dispatch

**The foundation plan, Phase 1 onward.** Prerequisites: a fresh session, branch off `dev`, `bun run test` confirmed green. Use `superpowers:subagent-driven-development`. The plan's "File ownership & execution order" table is the dispatch guide (what's sequential vs parallel). See the continuation prompt below.

## Deferred items (each with unblock condition + where it resolves)

- **Deploy/promote pipeline, `main` branch protection, GitHub default-branch flip to `dev`, `PROMOTE_TOKEN`, and the `git-strategy.md`/CLAUDE.md/AGENTS.md rewrites.** Unblock condition: a deployable Worker must exist (the pipeline needs something to deploy) AND Sam must perform the GitHub-admin actions + set secrets. Resolves in: the **DO-host plan** (not yet written — it's the next plan after this foundation plan). Tracked in: web-client spec §6 + foundation plan Task 1.2 (which does dev-protection only).
- **DO-host + wire-protocol plan, and the client/SPA plan.** Unblock condition: foundation plan (engine barrel + setup phase) merged to `dev`. Resolves in: their own future plans, written from spec §3 (session model) and §4 + the UI brief (client).
- **Alliances (engine + protocol + UI).** Unblock condition: Phase 1–2 shipped; it's the lowest-priority scope item with its own design addendum. Resolves in: spec §5 item 10 + a Phase 3 plan.
- **`/impeccable document` re-run** to replace the DESIGN.md seed with extracted tokens + the component sidecar. Unblock condition: first client code exists. Resolves in: run the command after the client plan ships any UI.
- **Three "for Sam" spec open questions** (spec's "Still uncertain / for Sam"): all-agent watch as client-side-replay-only in v1 (PRODUCT.md says "watch"); the 90s online defender-timeout value; whether the staging e2e smoke must block Phase 1 promotion. These don't block the foundation plan; they're decisions for the DO-host/client plans.

## Seams (where context is silently lost)

1. **Gitflow transient state (the big one).** Branches `dev`/`main` exist, but `git-strategy.md` + CLAUDE.md/AGENTS.md still describe the OLD main-only flow (no `dev`, "no commits to local main", PRs to `main`). A fresh agent reading those docs would branch off `main` and PR to `main` — WRONG. **Correct flow now: branch off `dev`, PR to `dev`.** This is documented in the plan's Discoveries section and the continuation prompt. The docs get rewritten in the deferred cutover (DO-host plan).
2. **`main`-commit exception scope.** Sam granted "commit straight to main" ONLY for PRODUCT.md/DESIGN.md early in the session. A later attempt to push the spec to `main` was correctly auto-blocked. Everything since lives on `dev`. Do not assume the main exception extends.
3. **codex session continuity.** `.context/codex-session-id` (untracked) holds session id `019ebcaf-6d85-7722-9f85-e0e7077731ce` — the codex thread that reviewed the design (v1→v2) and the plan. It has ~3.7M OpenAI tokens of loaded context (engine code, specs, plan). A future agent can `codex exec resume <id>` for more cross-model review at OpenAI billing (near-zero Claude cost). If continuing it, the prompt pattern is in this session's transcript.
4. **Two planner overrides of review-suggested fixes** (both confirmed correct by codex, both documented in the plan): the bootstrap gate keys on `floor(rc/2)===0` (NOT `baseCount<4`, which would break legal radiating base placement); and the spec's replay model is `rngBeforeApply` (NOT a round-2 finder's "preceding entry's post-state", which omits agent selection draws). If an executor "simplifies" either back, it's a regression — the plan's tests guard both.

## Operational guardrails accumulated this session

- **bun-only machine:** `bun run test` (vitest), NEVER `bun test`; wrangler via `bunx`. (memory: `local-env-bun-only`)
- **Multi-agent workflow cost:** tier models per task (Sonnet/Haiku for mechanical, Opus for judgment; Fable only where the delta matters), cap verifier fan-out, batch verification. A 129-agent Fable workflow blew the spend limit this session. (memory: `workflow-cost-discipline`)
- **Cross-model review is high-value + cheap:** codex (OpenAI billing) caught all 3 P0s in the plan review that author self-review missed. Use it as the independent voice. (memory: `plan-review-cross-model-value`)
- **TDD scope:** mandatory for `src/` production code; NOT for config (`.github/`, `*.json`) or docs. The plan's Execution Discipline block encodes this.
- **Engine purity:** no `Math.random`, no Node APIs, no runtime deps, and nothing in `src/engine|rng|board|index.ts` may VALUE-import from `src/agent` or `src/driver` (would drag the agent stack into a future Worker bundle).

## Priority queue (numbered, with dependencies)

1. **Execute foundation plan Phase 1** (CI gate; dev protection needs Sam's GitHub-admin action) — no code deps.
2. **Phases 2→3→4→5→6** in order (respect the File ownership table; 2/3 share `apply.ts`, 3/4.2 share `legal.ts`, 5.1→5.2 share `turn.ts`, 6 after 2–5). 4.3 (codec) and 7 (audit) are parallelizable.
3. **After foundation merges to `dev`:** write the DO-host + wire-protocol plan (spec §3), which also lands the deferred deploy pipeline + gitflow doc rewrites.
4. **Then:** the client/SPA plan (spec §4 + UI brief), then alliances (Phase 3).

## Continuation prompt

See the comprehensive paste-ready prompt at the end of this handoff (also delivered to Sam in chat). It is self-contained for a fresh agent.

---

## Handoff adversarial review record

- **Round 1 (naive fresh agent):** added explicit branch-off-`dev` instruction (a cold agent would otherwise follow stale git-strategy.md); spelled out the codex session id rather than "the codex thread."
- **Round 2 (recency-bias):** pulled forward mid-session items under-weighted by recency — the main-commit-exception scope seam, the `/impeccable document` re-run to-do, the three "for Sam" spec questions.
- **Round 3 (seam auditor):** the 4 seams above; verified each names its resolving artifact.
- **Round 4 (operational guardrails):** confirmed all five guardrails live in memory files or the plan, not just transcript.
- **Round 5 (loss-averse):** captured the codex-session-resume capability (3.7M tokens of context that would cost real money to rebuild) and the two planner overrides (regression risk if undone).
- **Round 6 (session-specific: handoff-into-execution auditor):** This session was pure design/planning handing off to an EXECUTION agent that will write code under TDD + multi-agent dispatch. Failure mode the canonical rounds miss: the executor mis-sequencing parallel tasks or following stale process docs. Findings applied: the continuation prompt explicitly names the File ownership table, the green-baseline precondition, the two overrides as "do not undo", and the branch-off-`dev` rule. Verified the plan's Discoveries section carries the gitflow warning so it survives even if this handoff doc isn't read.
- **Final full pass:** zero material findings.
