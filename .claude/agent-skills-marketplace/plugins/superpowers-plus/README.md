# superpowers-plus

Workflow orchestration that wraps the [`superpowers`](https://github.com/obra/superpowers) plugin into front-to-back workflows. Eleven skills covering the full arc: design (brainstorm + adversarial review), planning (subagent-proofed plans + Living Document Contract + adversarial plan review), correctness audits (four hunter methodologies + cross-validation cycle), milestone audits (five-axis project health review + remediation cycle), and session handoff (structured context preservation).

**Agents should read each skill's `SKILL.md`.** This README is the human-facing overview of the plugin as a whole.

## Skills in this plugin

### Workflow orchestration

| Skill | What it does | When to invoke |
|---|---|---|
| [`build-robust-features`](skills/build-robust-features/SKILL.md) | End-to-end "design → plan → execute" workflow for non-trivial work. Chains brainstorming, a 5-round adversarial design review (at least one round MUST use the leading model from a different provider — typically Claude ↔ OpenAI/Codex), then delegates to `writing-plans-enhanced` | When building features, fixing planned bugs, or executing project to-dos that will be delegated to subagents — i.e., the start of any non-trivial body of work that needs both a stress-tested design *and* a subagent-ready plan |
| [`writing-plans-enhanced`](skills/writing-plans-enhanced/SKILL.md) | Wraps `superpowers:writing-plans` with subagent-proofing requirements, an Execution Strategy recommendation step, and the mandatory **Living Document Contract** that binds every executor to keep the plan synchronized with reality | Use *instead of* `superpowers:writing-plans` whenever the plan will be executed by subagents or across multi-session/multi-agent dispatches |
| [`plan-review-cycle`](skills/plan-review-cycle/SKILL.md) | Adversarial multi-round review of a written plan — minimum 3 rounds across 6 dimensions (ambiguity, context gaps, interpretation latitude, cross-task dependencies, testing pitfalls, implementation pitfalls); keeps looping until a round produces zero findings | After writing any plan that subagents will execute, before committing. Often invoked automatically by `writing-plans-enhanced` Step 4 and the plan-review phases of `bug-hunt-cycle` / `health-review-cycle` |
| [`handoff`](skills/handoff/SKILL.md) | Structured context preservation across sessions or before fresh-agent dispatch. Five mining lenses (recent / mid-session / little to-dos / seams / naive-agent), routes content to the right durable artifact, then minimum 6 adversarial review rounds | When approaching auto-compaction, ending a long session, wrapping a multi-agent coordination cycle, or before dispatching a follow-up agent who won't share hot context |

### Bug-hunt workflow

| Skill | What it does | When to invoke |
|---|---|---|
| [`bug-hunt-cycle`](skills/bug-hunt-cycle/SKILL.md) | Full eight-phase bug-hunt: scope research → parallel dispatch of four hunter methodologies → cross-validation → test-gap analysis → user-decision loop → fix plan (via `writing-plans-enhanced` with bug-hunt-specific custom instructions) → plan review → commit | After finishing a phase / PR, before merging, or when auditing a body of work end-to-end |
| [`bug-hunter-differential`](skills/bug-hunter-differential/SKILL.md) | Differential / invariant hunter — identifies pairs or sets of functions that should agree (round-trip, plan/apply, producer/consumer) and checks whether the invariant actually holds | When the bug class lives in the gap *between* two functions rather than inside one — schema drift, missing inverse, plan/apply divergence |
| [`bug-hunter-exploratory`](skills/bug-hunter-exploratory/SKILL.md) | Depth-first hunter — identifies the riskiest code in scope and follows suspicious threads down through callers and callees | When you want focused deep analysis of the highest-risk parts of a codebase, not broad coverage |
| [`bug-hunter-holistic`](skills/bug-hunter-holistic/SKILL.md) | Holistic hunter — reads every source file in scope, then reasons about contracts, sibling consistency, failure modes, concurrency, and error propagation | When the scope is small enough to fit in one context and you want semantic analysis with the full picture loaded |
| [`bug-hunter-multipass`](skills/bug-hunter-multipass/SKILL.md) | Five-pass hunter — each pass targets one bug class (contract violations, sibling pattern deviations, failure modes, concurrency, error propagation) | When you want systematic coverage of known bug categories rather than open-ended exploration |

### Health-review workflow

| Skill | What it does | When to invoke |
|---|---|---|
| [`health-review-cycle`](skills/health-review-cycle/SKILL.md) | Full six-phase health review: dispatch the sibling `project-health-review` skill → cross-validation → user-decision loop → fix plan (via `writing-plans-enhanced` with health-review-specific custom instructions) → plan review → commit | When you want the end-to-end audit-and-remediate loop (not just the snapshot), typically before major milestones or large refactors |
| [`project-health-review`](skills/project-health-review/SKILL.md) | The five-axis adversarial dispatch on its own. Five parallel adversarial agents (Code Quality, Architecture, Test Quality, Ops Readiness, API Design), independent contexts, deduplication and severity ranking in a synthesis pass, raw + consolidated reports written to `docs/health-reviews/` | When you want a snapshot view of project health without committing to the full cycle. Useful pre-planning, pre-investor-demo, or before a major refactor decision |

## Why one plugin, not three

Earlier versions of this marketplace split these skills across three plugins (`superpowers-plus` for orchestration, `bug-hunters` for hunter methodologies, `project-health-review` for the five-axis dispatch). That split optimized for architectural purity — workhorses as dependency-free leaves, orchestration tier above them — but the cycle skills (`bug-hunt-cycle`, `health-review-cycle`) had cross-plugin runtime dependencies that weren't declared anywhere. Claude Code's marketplace.json schema doesn't have a `requires:` field, so cross-plugin deps are honor-system: install `superpowers-plus` alone and the cycle skills fail at dispatch with no clear "plugin X is missing" guidance.

The collapsed structure (everything in one plugin) trades architectural purity for atomicity:

- **Atomic install.** One `superpowers-plus` install gives you the whole workflow surface — orchestration + workhorses + cycles. No partial-install footguns.
- **Intra-plugin dispatch.** All sibling skill invocations resolve via bare names (e.g., `bug-hunt-cycle` invokes `bug-hunter-exploratory`, not `bug-hunters:bug-hunter-exploratory`). Simpler resolution, no namespace prefixes.
- **No incoherent fallback sections.** When the cycle skills used to invoke other-plugin skills, every cycle had an "Inline fallback (when X is unavailable)" section that handwaved at "read the SKILL.md from the plugin source repo" — which doesn't make sense (a skill that's "unavailable" can't have its rules read either). All those sections are gone now.
- **Workhorse-only use case still works.** If someone wants only `bug-hunter-exploratory` for a one-off invocation, they invoke the skill directly — they just install superpowers-plus first. The "install only the workhorse plugin" case wasn't a real use pattern; for personal-marketplace use, atomic install wins.

## Why "plus"

The base `superpowers` plugin is the foundation: TDD, brainstorming, writing-plans, executing-plans, dispatching-parallel-agents, and so on. The skills here don't replace any of that — they encode operational discipline that the base skills assume but don't enforce, and chain the base primitives into front-to-back workflows:

- **`build-robust-features` exists** because brainstorming a design and then writing a plan are two disciplines with different failure modes — and the gap between them is where a lot of "the plan looked fine but the design was wrong" pain comes from. The skill chains brainstorming → adversarial design review → `writing-plans-enhanced` so the design is stress-tested *before* it gets baked into a plan.
- **`bug-hunt-cycle` exists** because correctness-critical audits benefit from multiple independent hunting methodologies (depth-first, holistic, multipass, differential) running in parallel and being cross-validated. The cycle owns scope research, parallel dispatch, completeness-enforced cross-validation, test-gap analysis, and the user-decision loop. It delegates plan-writing (with bug-hunt-specific custom instructions) to `writing-plans-enhanced` and plan review to `plan-review-cycle`.
- **`health-review-cycle` exists** because milestone-level project audits need the five-axis adversarial review wrapped in validation, decision, and remediation discipline. Same delegation shape as `bug-hunt-cycle`.
- **`writing-plans-enhanced` exists** because `superpowers:writing-plans` produces plans that read naturally to a human but leave subagents room to interpret. Subagents under pressure default to over-engineering, weakening assertions, and improvising scope. The enhanced wrapper closes those gaps and adds the Living Document Contract — the single most important coordination primitive when multiple agents touch the same plan over multiple sessions.
- **`plan-review-cycle` exists** because plan quality is a place where review is asymmetrically cheap and missed problems are asymmetrically expensive. A subagent that misreads task 3 burns 30+ minutes; a review round that catches the ambiguity costs ~10 minutes. The skill enforces minimum 3 rounds.
- **`handoff` exists** because hot context is a non-renewable resource. The skill encodes the discipline of mining lossy, routing everything to the right artifact, and adversarial-reviewing the handoff itself before declaring it done.
- **The hunter methodologies (`bug-hunter-*`) and `project-health-review` are workhorses** that the cycle skills compose. They're independently useful as one-off invocations, and they're the dispatch primitives the cycles parallelize.

## Living Document Contract

The most distinctive element of `writing-plans-enhanced` is the **Living Document Contract** — a verbatim block that gets pasted into every plan and binds every future executor to update the plan as work progresses, not only at completion. The contract specifies:

- **Per-phase Execution Status banners** with claim/ship/defer/discovery semantics
- **🚧 / ✅ / ⏸ / ⬜ markers** that are scan-able above every phase body
- **Stale-claim reclaim protocol** based on observable signals (PR exists, branch has recent commits) rather than time arithmetic — agents can't reliably estimate their own wall-clock
- **Prose-description-plus-link** as the durable coordination pattern for deferred work, instead of brittle exact-string gate keys that break under paraphrase or scope edits

This is the mechanism that lets a follow-up dispatch say "Phase N's banner now shows ⏸ DEFERRED pending X; X's plan now shows ✅ SHIPPED; execute Phase N" instead of running a 30-minute archaeology session to figure out what's done.

## Typical use

**Building a feature from "I want X" to a subagent-ready plan:**

```
/superpowers-plus:build-robust-features
```

Walks you through brainstorming the design, runs a 5-round adversarial design review with at least one round on a leading model from a different provider (typically Claude ↔ OpenAI/Codex — same-provider review has correlated blind spots), then hands off to `writing-plans-enhanced` for the plan-writing-and-review pipeline. Use this when both the *design* and the *plan* need to be sound — i.e., the start of any non-trivial body of work.

**Auditing a phase / PR / package for bugs:**

```
/superpowers-plus:bug-hunt-cycle Phase 9
```

Composes the four hunters with cross-validation, test-gap analysis, and a remediation plan written via `writing-plans-enhanced` and reviewed via `plan-review-cycle`. Plan filename suffix: `-bug-hunt-remediation-plan.md`.

**Running one bug-hunting methodology directly (no cycle):**

```
/superpowers-plus:bug-hunter-exploratory
```

Each hunter writes a report to `docs/bug-hunts/` with bug findings, file:line evidence, and severity. No consolidation, no fix plan — just the report. Use when you want a focused review of one area through one lens.

**Doing a milestone health check:**

```
/superpowers-plus:health-review-cycle
```

Composes the five-axis adversarial review with validation, user-decision loop, and a remediation plan via the same `writing-plans-enhanced` + `plan-review-cycle` pipeline. Plan filename suffix: `-health-review-remediation-plan.md`.

**Running the five-axis review directly (no cycle):**

```
/superpowers-plus:project-health-review
```

You get five raw reports + one consolidated synthesis under `docs/health-reviews/`. No validation, no fix plan, no further work. Useful pre-planning, pre-investor-demo, or before a major refactor decision when you just need to know where the project hurts.

**Writing a plan from a settled spec / bug-hunt findings:**

```
/superpowers-plus:writing-plans-enhanced
```

Walks you through `superpowers:writing-plans`, then layers in subagent-proofing, the Living Document Contract, and (at Step 4) hands off to `plan-review-cycle` automatically.

**Reviewing an already-written plan:**

```
/superpowers-plus:plan-review-cycle
```

Runs the 6-dimension adversarial review loop until you converge.

**Closing out a long or multi-agent session:**

```
/superpowers-plus:handoff
```

Mines hot context across five lenses, updates every stale living artifact, creates new artifacts for material that doesn't have a home yet, runs minimum 6 adversarial review rounds (including at least one session-specific perspective), and produces a handoff doc that lets the next agent resume in 2 minutes instead of 30.

## Design choices worth knowing

- **All skills assume `docs/` layout.** Plans land in `docs/plans/`, pitfalls live at `docs/pitfalls/...`, bug-hunt artifacts in `docs/bug-hunts/`, health-review artifacts in `docs/health-reviews/` — matching the convention installed by [`project-setup`](../project-setup/). The skills work without that layout but read most coherently when bootstrapped with `project-init`.
- **RFC 2119 terminology.** Every skill uses MUST / SHOULD / MAY precisely. The strength of the obligation matters — "MUST update the banner on phase ship" is non-negotiable; "SHOULD include an Execution Status table" is recommended-with-judgment.
- **Cycle skills delegate, they don't duplicate.** `bug-hunt-cycle` and `health-review-cycle` MUST NOT restate the subagent-proofing rules from `writing-plans-enhanced` or the multi-round review rules from `plan-review-cycle` — they invoke those skills and pass cycle-specific custom instructions on top. This keeps the rules in one place and prevents drift.
- **Plan-filename suffixes are consistent and distinct.** `-bug-hunt-remediation-plan.md` for bug-hunt cycles; `-health-review-remediation-plan.md` for health-review cycles. Easy to identify and search for.
- **Hunter outputs are correctness-only.** The `bug-hunter-*` skills explicitly do NOT report coverage gaps, weak assertions, style nits, or refactoring opportunities. Their job is to find code that does the wrong thing — test-quality work happens in `project-health-review`'s Test Quality dimension instead.
- **Strongest-tier reasoning model recommended for adversarial dispatches.** Both `bug-hunt-cycle` Phase 2 and `project-health-review`'s execution instruct each subagent to dispatch on the latest Opus / GPT-5 at x-high effort unless the user explicitly overrides. Adversarial review benefits asymmetrically from maximum reasoning bandwidth — saving model cost trades poorly against missed bugs that ship to production.
- **Review-round floors are real floors.** "Minimum 3 rounds" in `plan-review-cycle` and "minimum 6 rounds" in `handoff` mean what they say. If round 1 produces 0 findings, the skill explicitly tells you you're not looking hard enough — go again.
- **Self-propagating discipline.** Plans written by `writing-plans-enhanced` carry the Living Document Contract verbatim. Future executors reading the plan inherit the contract automatically. The skill seeds the convention; the convention sustains itself.

## Relationship to other plugins

- **[`project-setup`](../project-setup/)** — bootstraps the `docs/plans/`, `docs/pitfalls/...`, `docs/bug-hunts/`, `docs/health-reviews/`, and `CLAUDE.md` / `AGENTS.md` layout that these skills assume.
- **`superpowers`** (external) — base primitives that this plugin wraps: `superpowers:brainstorming` (used by `build-robust-features`), `superpowers:writing-plans` (used by `writing-plans-enhanced`), `superpowers:test-driven-development`, `superpowers:executing-plans`, `superpowers:subagent-driven-development`, `superpowers:dispatching-parallel-agents`. Install superpowers from its upstream marketplace before using these skills.

## Cross-platform notes

- **Claude Code:** invoke each skill via the `Skill` tool by name (`build-robust-features`, `bug-hunt-cycle`, `bug-hunter-differential`, `bug-hunter-exploratory`, `bug-hunter-holistic`, `bug-hunter-multipass`, `health-review-cycle`, `project-health-review`, `writing-plans-enhanced`, `plan-review-cycle`, `handoff`). All cross-skill invocations are intra-plugin (bare names work).
- **Codex / Cursor / generic shell-based:** read the relevant `SKILL.md` from the plugin install location and follow it end-to-end. Each skill is self-contained, with explicit fallback notes for environments that can't invoke skills by name.
- **No bundled scripts.** Pure instruction. The Living Document Contract block in `writing-plans-enhanced` is meant to be copy-pasted verbatim — paraphrasing breaks the cross-session coordination semantics.
