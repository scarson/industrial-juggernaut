# Handoff — Balance Phase 1 execution (fresh session, subagent-driven)

**Purpose.** The balance-redesign design pass is COMPLETE (diagnosis → spec → plan, all merged to `dev`). This handoff starts the **execution** session for Phase 1. The executing agent runs `docs/plans/2026-07-02-balance-phase1-instrument-plan.md` task-by-task via `superpowers:subagent-driven-development`. The plan is the authoritative execution document — this handoff carries only the state, seams, and guardrails that live outside it.

> **Read first, in order:** (1) the plan (in full — it is self-contained, carries a Living Document Contract you are bound by, and encodes every constraint); (2) the spec `docs/superpowers/specs/2026-07-02-balance-redesign-design.md` (§5 decision rule, §8 merge protocol); (3) the evidence report `docs/sweeps/2026-07-02-balance-diagnosis/2026-07-02-elimination-decomposition.md` (what Phase 1 is instrumenting and why). Project memory auto-loads the compressed findings (`big300-elimination-mechanics`, `big300-evidence-quality-caveats`, `balance-redesign-merge-authorization`, `workflow-cost-discipline`).

## 1. Headline state (2026-07-02, end of design session)

- **`dev` tip:** `3f1d21a6` (merge of PR #38 — diagnosis evidence + spec + plan; docs-only). Local `main` is irrelevant; the repo is mid-gitflow-cutover — **branch off `origin/dev`, PR to `dev`** (git-strategy doc still carries stale main-language; ignore it on this point).
- **PR #38 MERGED** after a blind Fable adversarial review (verdict APPROVE; its 5 minor findings were applied before merge — see the PR thread for the full verdict).
- **No balance implementation code exists yet.** Every plan phase banner is ⬜ NOT STARTED. Nothing is in flight from this effort.
- **A separate client-track agent is active on `dev`** (DO-host/SPA plans; merged PR #37 `feat/session-command-envelope` mid-design-session). Expect `dev` to move while you work.

## 2. What the design session shipped (pointers, not narrative)

- Evidence: `docs/sweeps/2026-07-02-balance-diagnosis/` — instrumented decomposition of all 19 big300 MCTS games (zero combat; 79% factory-clock eliminations; iron radiating-reachable; setup lottery sparse-geometry-scoped) + committed data incl. the full 30→100→300 dose-response ladder (move-for-move identical — the clock regime is iteration-budget-robust at production strength; maxDepth is the untested axis, covered by plan Task 8).
- Spec: three decision-gated phases; Phase 1 = instrument only, **zero engine-rule changes**.
- Plan: 9 tasks / 5 phases (A data pipeline, B gates & report, C scripts, D probe/sweep execution + docs, E ship), survived a 5-round adversarial review (record at the plan's foot; includes a cross-model Codex round that caught a critical arithmetic bug in the compare snippet).

## 3. Execution directives (Sam's, from the design session)

- **Mode:** subagent-driven (`superpowers:subagent-driven-development`) — fresh subagent per task, review between tasks.
- **Model tiering (Sam, twice):** implementation subagents on **Sonnet**; between-task reviews on **Opus 4.8**; **Fable only** for the blind adversarial PR review at the ship gate. Do not run Fable elsewhere without cause.
- **Merge protocol (Sam-authorized, spec §8 + memory):** this effort's PRs may auto-merge after a blind Fable-subagent adversarial review (fresh agent, sees only diff/PR/repo — no session framing; outcome posted to the PR thread; substantive concerns → fix or escalate to Sam). Docs-only PRs are Routine and merge on green CI under the base rules without needing the Fable gate.
- **Sam merges nothing routinely here** — but anything alarming, judgment-ambiguous, or scope-drifting still escalates (Rule #1 unaffected). Engine-rule changes remain out of scope until Phase 3.

## 4. Seams (where context is silently lost)

1. **Concurrent client-track agent.** They consume the engine and `src/session` contracts; you touch `src/driver` + `src/sweep` only. Coordination rules (from the balance-redesign handoff §8, still live): no `SessionRecord`/`LogEntry` shape changes (`GameResult` is NOT serialized — verified); pure `src/index.ts` barrel additions need a `## Barrel additions` PR heading (Phase 1 expects none); don't touch `src/server`/`web/`. `dev` WILL move under your PR — `git fetch origin dev && git rebase origin/dev` + `--force-with-lease`, then re-wait for CI (this exact race happened to PR #38).
2. **Task 8's prior-evidence check is OUTCOME-equivalence, not file equality.** The committed `probe-b150sparse-*.jsonl` files use the design-pass scratch schema (`victim`/`maxIron`/`rounds`), NOT the schema the new `probe-ladder.ts` emits. The plan says exactly which fields to compare. A schema diff is NOT a STOP condition; an outcome diff IS.
3. **Worktree mechanics:** `dev` is checked out in the main repo, so you cannot `git checkout dev` from a worktree — branch from `origin/dev` after a fetch. `gh pr merge --merge` then delete the remote branch manually (`--delete-branch` is unreliable from worktrees). If a required check is invalidated by rebase, `gh pr merge --auto --merge` lands it on green.
4. **Evidence-tier discipline.** Some design-session figures are explicitly tier-labeled as session-scratch (see the decomposition doc's final caveat block). Phase-1 instrumentation re-derives the load-bearing ones — do not cite the scratch-tier numbers as committed evidence in new reports.
5. **The plan's line-number anchors** (e.g., `report.ts` ~102/129/138, orchestrate fixture ~426/498/533) were read at plan time against `dev`@`a8cbb5e2`-era code. If `dev` moved those files, trust the anchor TEXT (the quoted code/strings), not the numbers.

## 5. Operational guardrails accumulated this session

- **Never run MCTS probe processes in parallel on this machine** — memory pressure killed 3 concurrent probes silently (exit 144, empty output). Run ladder rungs serially in the background; the plan's Task 8 encodes this.
- Ladder cost calibration (measured): sparse board-150 clock game ≈ 5.5 min at iters=30, ~12–24 min at 100, ~30–32 min at 300. The full Task-8 ladder is one-to-two overnights.
- `bun run test` (vitest), never `bun test`; `bun run typecheck`; scripts run as `bun src/sweep/<file>.ts` from the repo root.
- Reviewer subagents given "no expensive sims" instructions will still run the full test suite unless told the exact commands to avoid — say "never `bun test` OR `bun run test`" when you mean it.
- Background `bun` writes appear only when a game completes (`appendFileSync` per game); an empty output file minutes in usually means the first (slowest-ordered) game is still running, not a hang.

## 6. Priority queue

1. **Tasks 1–3 (Phase A)** on `feat/balance-phase1-instrument` off `origin/dev` — the determinism-pinned data pipeline. Review between tasks (Opus).
2. **Tasks 4–5 (Phase B)** — diversity gate + report wiring.
3. **Tasks 6–7 (Phase C)** — probe-ladder + placeRange scripts.
4. **Task 8 (Phase D)** — the ladder (linchpin: maxDepth rung + extended n) and the weak-agent sweep; reports into `docs/sweeps/2026-07-02-balance-diagnosis/`.
5. **Task 9 (Phase E)** — verify, PR-2, blind Fable review, merge; update plan banners; report to Sam with the ladder verdict headline (spec §5 decision rule).
6. **After Phase 1:** the Phase-2 re-baseline + lever decision is a SAM SESSION (spec §7) — do not start Phase-2 lever work autonomously.

## 7. Continuation prompt (paste-ready)

> You're executing **Phase 1 of the Industrial Juggernaut balance-redesign program** — instrumentation only, no engine-rule changes. Read, in order: `docs/handoffs/2026-07-02-balance-phase1-execution-handoff.md` (state, seams, guardrails), then `docs/plans/2026-07-02-balance-phase1-instrument-plan.md` **in full** (the authoritative task list — it carries a Living Document Contract you MUST honor: claim/ship/defer banners, deviations, discoveries), then the spec `docs/superpowers/specs/2026-07-02-balance-redesign-design.md` §5+§8.
>
> Execute via `superpowers:subagent-driven-development`: fresh implementation subagent per task on **Sonnet**, between-task reviews on **Opus 4.8**, working on `feat/balance-phase1-instrument` branched off `origin/dev` (fetch first; you're in a worktree — never checkout dev directly). TDD per the plan's per-task blocks. Hard constraints (plan §Constraints): nothing under `src/engine/` changes; `SessionRecord`/`LogEntry` untouched; the control-parity and mcts-determinism goldens MUST stay green (a red golden in this phase is your bug, never a regeneration event); the parallel==sequential sweep invariant stays byte-identical; `bun run test`, never `bun test`. Run Task 8's MCTS ladder rungs serially, never in parallel (memory pressure kills concurrent probes on this machine).
>
> Ship (Task 9) via PR to `dev` with the plan's PR body, then the Sam-authorized merge protocol: dispatch a **blind Fable subagent** (no session context; sees only `git diff origin/dev...HEAD`, the PR, and the repo) for adversarial review, post its verdict to the PR thread, merge on APPROVE with `gh pr merge --merge` (rebase + `--force-with-lease` + `--auto` if dev moved), delete the remote branch manually. Escalate to Sam per Rule #1 for anything alarming; a concurrent client-track agent is active on dev — respect the coordination seams in the handoff §4. When done, update the plan's Execution Status banners and report DONE/DONE_WITH_CONCERNS with the regime-persistence ladder verdict as the headline.

---

## Adversarial review record (handoff)

- **Round 1 (naive fresh agent):** added the worktree/checkout-dev mechanics and the `bun src/sweep/<file>.ts` invocation form; defined where the merge-protocol authority lives (spec §8 + memory) rather than assuming it's known.
- **Round 2 (recency-bias):** pulled forward mid-session items that pre-dated the plan-review flurry — the evidence-tier caveat discipline (§4.4) and Sam's twice-given model-tiering directive (§3), both decided hours before the handoff.
- **Round 3 (seam auditor):** added the PR-38 rebase race as a live expectation (§4.1), the Task-8 schema-vs-outcome seam (§4.2), and the stale-line-anchor seam (§4.5).
- **Round 4 (operational guardrails):** persisted the parallel-probe kill, ladder cost calibration, and the reviewer-ran-vitest surprise (§5) — all previously transcript-only.
- **Round 5 (loss-averse):** confirmed the only session artifacts not in the repo are scratch (diagnosis v1–v3 drafts, review summaries) whose durable content lives in the decomposition doc + spec appendix + plan review record + memory; the Phase-2-is-a-Sam-session boundary (§6.6) was transcript-only and is now captured.
- **Round 6 (session-specific — AUTHORITY-CHAIN AUDITOR):** this session created a new merge authority (auto-merge behind blind Fable review) whose provenance is a chat message; the risk is a fresh agent either over-applying it (merging engine rules in Phase 3 without re-confirming) or under-applying it (blocking on Sam for docs). Fixes applied: §3 states the authorization scope + the docs-Routine carve-out + the unchanged Rule #1 escalation duty; the continuation prompt binds the protocol to Task 9 specifically.
- **Round 7 (fresh-eyes coherence pass):** full top-to-bottom re-read after fixes; verified read-order, queue, and prompt are mutually consistent and every §4 seam has an action, not just a description. Zero material findings — exit.
