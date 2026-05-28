# PR-Merge Strategy for the `claude/document-game-design-VpqqB` Branch

**Date:** 2026-05-28 (overnight).
**Purpose:** The branch has accumulated MANY independent changes across multiple sessions (parallel infra, variants, alliances, gate recalibration, design specs, plans). All sits ahead of `main`. This doc proposes a chunked PR strategy so the merge isn't one giant blob review.
**Status:** Spec. Sam chooses whether to follow the chunking or merge in one PR.

## What's on the branch (since `origin/main = 72944bb`, PR #10 merged)

Roughly grouped:

### A — Balance-sweep harness (S1–S5) + initial calibration
- The sweep machinery (`src/sweep/{metrics,health,run,orchestrate,report}.ts`), tests.
- Wide-grid (S5) report; calibration (600-game) report.
- Initial balance-rules-analysis doc.

### B — Parallel-execution infra
- `agent-spec.ts`, `pool.ts`, `worker.ts`, `run-parallel.ts`.
- Refactors: `runOneGame` shared; `buildArenaSchedule`/`aggregateArena` split.
- Determinism tests (parallel == serial, worker-count-invariant).
- Hardening: error handling, no-pool-poisoning, closed-pool guard.
- Worker-bug fix (mcts-agent robustness for empty rootStats).
- `docs/sweep-harness.md` usage doc.
- Pitfall BAL-1 added.

### C — Variant flags (a)/(b)/(c) — engine + measurement
- `RuleConfig` extensions: `victoryIronRequiresPerimeter`, `noIronRequiresPerimeter`, `victoryIronHoldRounds`.
- Engine: status.ts (coalitionVictoryIron, scaled holds), applyEliminations (noIron gating), turn.ts (victoryStreak update).
- TDD tests across the three variants.
- `compare-variants.ts` + report + synthesis.
- `explore-c-variant.ts` (partial — only cell #1 succeeded).
- Analysis doc §0.1 overturning the parameter-only resolution.

### D — Alliance layer (engine, Phases 1-6)
- `RuleConfig`: `alliancesEnabled`, `allianceVictoryDelta`.
- `Player.allianceCooldownTurns`.
- Action shapes `ally`, `break-alliance`.
- `legalActions` extensions.
- `applyAction` for ally + break-alliance.
- `status()` scaled threshold.
- `advanceRound` cooldown decrement.
- Smoke tests.
- Phase 7 sweep script (NOT launched).

### E — Gate recalibration + design specs + plans
- `mctsHealthThresholds()` + `maxLeadVolatility`.
- Spec docs: gate recalibration, P3 spike, concession, neutral 2P bases, terrain events, Opus proxy.
- Plans: alliance layer, tactical depth, neutral bases, terrain blocks, concession.
- Design ladder synthesis.
- Pre-playtest prep doc.

### F — Misc improvements
- `report.ts` per-count seatBias section.
- Sweep progress logging (`onProgress`, `onGame` callbacks).
- Profile script (`profile-turn-complexity.ts`).
- Documentation updates throughout.

## Two PR options

### Option 1: ONE BIG PR (single review)
**Title:** "Balance sweep + parallel infra + variant flags + alliance layer + gate recalibration"
**Pros:** Single review; can see the full arc; the changes are interrelated (alliance layer uses parallel infra; variants use gate recalibration).
**Cons:** Diff is huge (~40+ files, many tests, many docs). Reviewer fatigue real risk. Hard to roll back individual pieces.
**Recommended for:** if Sam is doing the review in one block.

### Option 2: THREE SEQUENCED PRs
Each PR builds on the previous; merge sequentially.

**PR #1 — Sweep harness + parallel infra + sweep findings** (groups A + B)
- All the measurement machinery + the historical S5/calibration reports.
- Adds: 64+ test files for the sweep + parallel, no engine behavior change.
- Reviewable in ~30-45 min.
- Risk: low (no engine changes).

**PR #2 — Variant flags + analysis overturn** (group C)
- The three variant flags (a, b, c) + their TDD.
- Comparison sweep + synthesis docs.
- Analysis doc §0.1.
- Engine behavior unchanged when flags are default-off.
- Reviewable in ~45-60 min (engine-touching, but mostly additive).
- Risk: medium (engine changes, but flag-gated).

**PR #3 — Alliance layer + gate recalibration + design plans** (groups D + E + F)
- Alliance layer Phases 1-6 + gate recalibration + plans/specs.
- Most plans don't have executable code attached; design docs are read-only.
- Reviewable in ~45 min if focusing on the engine code; longer if reviewing all the plans/specs.
- Risk: medium (engine changes, flag-gated).

### Option 3: FIVE PRs (max granularity)
- PR #1: Sweep harness (group A).
- PR #2: Parallel infra (group B).
- PR #3: Variants (group C).
- PR #4: Alliance layer (group D).
- PR #5: Gate recalibration + design specs/plans (group E + F).

**Pros:** each PR is small and crisp. Review cycle iterates faster. Easy to revert specific changes.
**Cons:** 5x the merge overhead. PR #2 depends on PR #1; PR #3 depends on PR #2; etc. (No real concurrency.)
**Recommended for:** if Sam wants careful review with explicit pause points.

## My recommendation

**Option 2 (three sequenced PRs).** Rationale:
- One-big-PR (Option 1) loses the natural review boundaries (sweep infra vs engine variants vs alliance).
- Five PRs (Option 3) is too much overhead for changes that came in essentially one autonomous arc.
- Three PRs naturally splits at the SIM ↔ ENGINE ↔ NEXT-LAYER boundaries, each independently reviewable, each independently revertable.

## Merge classification per `docs/git-strategy.md`

- **PR #1 (sweep + parallel):** likely `Review — architecture (parallel-worker serialization contract)`. The worker IPC + serialization is a real architectural addition.
- **PR #2 (variant flags):** `Review — engine` (rules surface area). Flags are default-off, but the engine touches are real.
- **PR #3 (alliances + plans):** `Review — engine` (more rules surface area). Could be `Routine` if PR #2 has been merged and reviewed, but the alliance feature itself is substantive.

None should be `Routine` — engine surface-area additions warrant review.

## Pre-merge checklist (apply to each PR)

- [ ] Full test suite green at `HEAD`.
- [ ] `tsc --noEmit` clean.
- [ ] No `defaultConfig` changes (or, if there are, explicit Sam-approval call-out).
- [ ] No `Math.random` introduced; PRNG threading verified.
- [ ] Determinism invariants intact (parallel == serial tests pass).
- [ ] `docs/handoffs/` updated for the merge state.

## Open questions

- **Are we ready to merge any of this NOW?** Variant (c) isn't formally adopted yet (default flip pending Sam's final go). Alliance layer hasn't run its Phase 7 sweep. Some plans reference forthcoming work. **Most likely:** wait until at least Phase 7 (alliance sweep) lands + Sam approves variant (c) default flip, THEN do PR #1 + #2 + #3.
- **Should the (c) default-flip be part of PR #2 or a separate PR #2a?** Recommend separate — flipping a default is a 1-line, explicit Sam-call.
- **The partial-data items (explore-c-variant crashed; MCTS@300 still running):** don't gate PRs on these. The data we have is sufficient for review.

## Continuation

When Sam picks this up: read this doc → decide chunking (1/2/3 PRs) → confirm pre-merge checklist → run final suite → open PRs in dependency order → merge each before opening the next (the branch fast-forwards each time).
