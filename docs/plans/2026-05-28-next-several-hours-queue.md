# Next Several Hours — Work Queue (post-thought-exercise decisions)

**Date:** 2026-05-28 (overnight, after Sam answered the design-decision questions and went away again)
**Trigger:** Sam asked to queue up the next several hours of work, with the same multi-perspective + adversarial-review discipline as before, and to use `writing-plans-enhanced` for significant implementation phases.
**Canonical decisions:** `2026-05-28-design-decisions-from-thought-exercises.md` — read that first; this doc is the *execution sequence* atop those decisions.
**Status:** Live queue. Mark items DONE as they ship; add new items only with reasoning.

## Sequencing rationale (5-perspective decision + adversarial review)

The order below isn't arbitrary. Five perspectives I considered:

1. **Critical path** — alliance implementation is the *biggest* item and the most strategic; everything else either feeds into validating it (gate recalibration, deeper (c) validation) or is parallel work that doesn't block it (design specs, profile).
2. **Compute-vs-doc interleaving** — heavy compute jobs (wider grid in flight, MCTS@300) saturate the 4 cores; doc/spec work should fill the gaps so I'm productive while compute runs.
3. **Risk-of-rework** — finalize gate recalibration *before* the alliance comparison sweep, so the sweep's success criteria are settled. Otherwise, the sweep produces data measured against a moving target.
4. **Sam-readability** — when Sam checks in, he should see incremental durable artifacts, not "everything pending until alliance is done." Spec docs ship continuously.
5. **Autonomy boundaries** — alliance + tactical-depth implementations are real engine changes; even with Sam's directional greenlight, they should go through the proper plan-and-execute discipline (TDD, default-off flag, bit-for-bit preservation). Don't shortcut.

**Adversarial review (3 rounds):**

- **R1 (wasteful):** the gate-recalibration spec is technically "just a doc," but if I skip it, the alliance comparison sweep's pass/fail criteria are ambiguous and I'd have to redo the sweep with different gates. Keep gate recalibration *before* alliance sweep. Confirmed.
- **R2 (premature):** is alliance implementation premature if (c) isn't formally adopted yet? Risk: I implement alliances on top of an unadopted (c). Mitigation: alliances are an additive flag (`alliancesEnabled: false` default); they don't depend on (c). Implementation is independent; ADOPTION (defaulting either on) is what's sequenced. So implementing both in parallel as opt-in flags is fine — just don't make either default.
- **R3 (over-scope):** the tactical-depth implementation is also greenlit directionally. Should it go in this queue too? Time-wise, probably not all of it. Decision: implement alliances fully; spec tactical-depth as a follow-up plan. Sequenced per Sam's adopt-validate-then-add discipline.

## Phase A — In flight & immediate (compute + light doc, ~1-2 hours)

| # | Item | Status | Compute? | Output |
|---|---|---|---|---|
| A1 | Wider grid (c) deeper validation | RUNNING (wider-grid task) | yes (workers busy) | `docs/2026-05-28-c-variant-deeper.md` |
| A2 | Refine alliance spec — coin-flip-break + tunable delta | TODO | no (compute-free) | append to `2026-05-28-design-followups-alliances-and-tactical-depth.md` |
| A3 | Spec gate recalibration for (c) regime | TODO | no | new doc `docs/2026-05-28-gate-recalibration-for-c.md` |
| A4 | Run profile script (legal-actions per turn) | TODO (after A1) | yes (small) | append measured data to `2026-05-28-long-game-engagement-and-randomness.md` |
| A5 | Run MCTS@300 stress test on (c) | TODO (after A1) | yes (medium) | new doc `docs/2026-05-28-mcts-300-on-c.md` |

A2 and A3 run NOW (compute-free, while A1 is in flight). A4 and A5 run sequentially after A1 finishes.

## Phase B — Alliance layer (the significant implementation phase, ~3-5 hours)

| # | Item | Status | Compute? | Output |
|---|---|---|---|---|
| B1 | Plan alliance implementation via `writing-plans-enhanced` skill | TODO (next) | no | new plan in `docs/plans/` |
| B2 | Execute the plan (TDD, commit per logical unit) | TODO (after B1) | yes (small TDD-test compute) | engine + tests + flag |
| B3 | Comparison sweep — alliances on vs off, multiple deltas | TODO (after B2) | yes (medium) | new doc `docs/2026-05-28-alliance-comparison.md` |
| B4 | Synthesis of alliance findings | TODO (after B3) | no | append to comparison doc |

## Phase C — Lighter design specs (compute-free, ~1-2 hours)

| # | Item | Status | Compute? | Output |
|---|---|---|---|---|
| C1 | Spec concession mechanic + asset-handling in 3-6P | TODO | no | new doc `docs/2026-05-28-concession-mechanic-spec.md` |
| C2 | Spec neutral defending bases for 2P | TODO | no | new doc `docs/2026-05-28-neutral-bases-2p-spec.md` |
| C3 | Spec board-terrain-manipulation events | TODO | no | new doc `docs/2026-05-28-terrain-events-spec.md` |
| C4 | Spec Opus-vs-MCTS proxy (sized-up) | TODO | no | new doc `docs/2026-05-28-opus-vs-mcts-proxy-spec.md` |

Phase C runs interleaved with Phase B's compute waits.

## Phase D — Wrap-up (~30 min)

| # | Item | Status | Output |
|---|---|---|---|
| D1 | Update `docs/handoffs/2026-05-27-session-handoff.md` comprehensively | TODO | refreshed handoff |
| D2 | Final full test-suite green check | TODO | confirmation |

## Operational guardrails (carrying forward)

- **One heavy compute job at a time.** 4 cores; concurrent sweeps starve each other.
- **Parallel-run determinism is invariant.** Don't weaken pool tests to speed anything.
- **Default-off flags.** Every engine change ships behind a flag with default-preserving behavior. Existing 397 tests stay green.
- **Commit + push per logical unit.** Container is ephemeral.
- **Plain English in chat.** Refer to things by what they are, not by question codes.
- **Validate under MCTS, not greedy.** BAL-1.
- **Sequencing serial.** Adopt-validate-then-add per Sam.

## What I will NOT do without explicit re-greenlight

- Change `defaultConfig`.
- Implement tactical-depth troop types (greenlit *directionally*; implementation pending after alliances are validated).
- Merge anything to `main`.
- Run a long compute job concurrently with another.

## Risk register

- **Alliance comparison may show alliances are uninteresting under sim** (heuristic/MCTS don't reason about coalitions well — known limitation). Mitigation: spec doc already acknowledges this; sim validates *mechanical correctness*, not *strategic richness*. Playtest is the real verification.
- **Tunable anti-coalition delta sweep may not have a clean winner**, leaving us with "delta=3 vs 4 are both fine, pick later." Acceptable outcome; document as such.
- **MCTS@300 may take a LONG time** (3× per move; could push 2+ hours for the revalidation step). Mitigation: bound game count (8 games instead of 12); timeout-guard.
- **Phase B may overrun.** If alliance plan reveals more complexity than expected, ship the engine implementation but defer the comparison sweep to a follow-up; sim-test pre-shipped engine in isolation.

---

Beginning execution at A2 (compute-free, doesn't disturb A1 in flight).
