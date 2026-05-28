# Rules-Variants Comparative Experiment — Methodology

**Date:** 2026-05-28 (overnight autonomous, after the 2026-05-27 MCTS revalidation overturned the parameter-only balance resolution)
**Goal:** Generate real comparative data for the three live §0.1 options — (a) P3 perimeter-gated victory-iron + noIron companion, (b) P2 hold-iron-for-N-rounds victory model, (c) accept-but-lengthen elimination — so Sam wakes to a comparison, not three sales pitches.
**Companion docs:** `2026-05-27-balance-rules-analysis.md` §0.1 (the live crossroads); `2026-05-27-perimeter-gated-iron-experiment.md` (P3 spec — operationalized here as variant (a)); `docs/sweep-harness.md` (how the harness runs).

## What's being tested

Three rules variants, each behind additive `RuleConfig` flags (defaults preserve current behavior):

| Variant | Flags set | Mechanic |
|---|---|---|
| (a) P3 | `victoryIronRequiresPerimeter: true` + `noIronRequiresPerimeter: true` | Iron counts toward victory only when inside the player's committed perimeter; `noIron` elimination only fires once the player has a perimeter. Iron in a radiating disk still counts for *resources*, not victory. |
| (b) P2 | `victoryIronHoldRounds: N` (N∈{2,3}) | Iron victory requires holding ≥`victoryThreshold` iron for N consecutive end-of-round checks (per-player streak; resets if the player's coalition drops below threshold). |
| (c) Lengthen | `noIronRequiresPerimeter: true` alone | Just the companion change without the victory-model change — `noIron` deferred until perimeter; iron-denial wins ARE legal once a perimeter exists, just not turn-1. |

Plus a **baseline** (all flags at defaults = current behavior) so every comparison has a within-experiment control.

## Decision 1 — How to implement (5 options + adversarial review)

The three flags are additive and default-off, so the engine's current behavior is preserved bit-for-bit. The question is **how to plumb them in**.

1. **Single big PR with all three flags TDD'd together** — one engine commit, comparable engines for all sweeps.
2. **Flag-by-flag, sequential** — full TDD pass per flag, commit, move on. Earlier flags inform later.
3. **Spike all flags loosely, then back-fill tests** — fastest to data, weakest on correctness.
4. **Only implement flags (a) + (b); skip (c)** since (c) is a subset of (a). Saves work but loses the chance to see (a)'s noIron-gating *alone*, which is the comparison Sam asked for.
5. **Build a configurable elimination/victory framework** that subsumes all three — most general, biggest scope creep / YAGNI risk.

**R1 (value):** #3 violates the project's TDD discipline (CLAUDE.md). #5 is YAGNI — Sam asked for three specific tests, not a framework. #4 elides (c)'s independent signal, which is precisely what tells us whether the victory-model change is *necessary* on top of noIron-gating.
**R2 (deps/risk):** #2 sequential lets each flag's correctness be validated in isolation before stacking; #1 batched is faster but if (b)'s streak state interacts with anything subtle, debugging is harder.
**R3 (autonomy/scope):** #2 commits per flag — each is a clean, reviewable chunk Sam can read independently. Aligns with the project's "commit per logical unit" discipline.

**Decision: option 2 — flag-by-flag, TDD, commit per flag.** Acknowledges Sam's "bias to action" by not waiting between flags (run straight through), but keeps the engine work auditable.

## Decision 2 — Sweep methodology per variant (5 options + adversarial review)

Each variant needs a search to find a *healthy* config under its mechanic, then an MCTS revalidation. The question is what to search.

1. **Hold geometry fixed at `b96/r2/iron12/vt12`, just toggle the flag.** Cheapest. Risk: the flag may shift the optimal geometry, so a fixed-geometry test under-credits a variant.
2. **Re-run the S5 wide grid (64 cells) for each variant.** Most thorough. Cost: 4 × 64 × ~150 games = expensive; total runtime hours even with the pool.
3. **Calibrate-neighborhood focused grid per variant** (radius {2,3} × ironCount {10,12,14,16} × victoryThreshold {10,11,12,13,14}, restricted to feasible cells) at 150 games/config. Moderate cost, comparable to S5's headline scale, focused on the region the calibration already identified as the only promising zone. *Recommended.*
4. **Adaptive narrowing**: cheap scan then deepen on promising. Best signal-per-CPU but hard to keep methodologically clean for comparison.
5. **Identical grid for all variants + baseline, 150 games/config, plus MCTS revalidation of each variant's healthiest cell.** Combines #3 with the explicit baseline.

**R1 (value):** #1 fails comparative rigor (variant may need different geometry to shine). #2 prohibitively expensive overnight (the parallel infra helps but doesn't make 4× 64 cells cheap). #4 hard to compare. #5 is just #3 with the discipline of running the baseline through the same grid.
**R2 (deps):** the baseline data already exists for the current default config (calibration report), but running the SAME grid in this run gives a directly-comparable within-experiment baseline rather than mixing data from different runs.
**R3 (rigor):** comparative claims need controlled comparison — same grid + same seeds + same agent = differences attributable to the flag, not noise.

**Decision: option 5 (≡ option 3 + within-experiment baseline) — identical focused grid for all 4 (baseline + a + b + c), 150 games/config under heuristic, common seeds, then MCTS revalidation of the healthiest cell per variant.** Same `revalidate.ts` settings (2-3P, turnCap 60, MCTS 100-iter) for comparable agent-relative health.

## Decision 3 — What to measure (5 lenses + adversarial review)

For each (variant × config) cell:
1. **Greedy health (the original 7-gate):** does it pass under heuristic self-play?
2. **MCTS health (the lesson from yesterday):** does it pass under MCTS self-play (same 7 gates)?
3. **Victory-type mix under MCTS:** iron vs last-standing fraction. Does iron victory revive?
4. **Median turns under MCTS:** game length under strong play.
5. **noIron-elimination fraction:** does denial still dominate?

**R1:** these are not orthogonal — #5 is part of the elimination story; #1 vs #2 IS the comparison; #3+#4 disambiguate "healthy how." But measuring all five gives a richer picture than a binary pass/fail.
**R2:** #1 and #2 are the load-bearing comparison. Don't lose them in the noise.
**R3 (autonomy):** the harness already computes #1; #2 is what `revalidate.ts` does; #3+#4 are in the GameResult stream. #5 needs a small addition — count eliminationCause histograms across games. Worth adding to the comparison harness (not the standard health gate).

**Decision: report all five for each variant.** Lead with #1 vs #2 (greedy-said-healthy vs MCTS-said-healthy), then #3 (iron-vs-elimination mix) as the discriminator that explains why a variant works or doesn't.

## Decision 4 — Output format (5 options + adversarial review)

1. Per-variant report sections in the analysis doc.
2. A summary table in a new comparison doc.
3. Separate per-variant docs.
4. Update the calibration report inline.
5. Dedicated comparison doc with summary table + per-variant detail + side-by-side verdict matrix + raw artifact links.

**R1:** #3 too fragmented to compare. #4 entangles old greedy-only data with new comparative data — confusing. #1 acceptable but the analysis doc is long; a focused comparison doc reads faster for Sam's morning.
**R2:** Sam asked for "comparative assessment" — a comparison doc IS the deliverable.
**R3:** the comparison doc should LINK to artifacts (sweep reports, MCTS revalidation logs) rather than duplicate them, per the cross-references discipline.

**Decision: option 5 — `docs/2026-05-28-rules-variants-comparison.md` with summary verdict table + per-variant detail + links to the underlying sweep reports.**

## Operational guardrails (carrying forward from the overnight pitfalls)

- **One heavy compute job at a time.** Sweeps run sequentially (per variant); within a sweep, parallel via the pool. No concurrent test suites during a sweep.
- **Parallel-run determinism is invariant** — don't weaken `test/sweep/{pool,run-parallel}.test.ts`.
- **No `defaultConfig` changes** — the variants are *flags*, default off. Whatever shows promising goes in the comparison report as a recommendation, not an adoption.
- **Validate every "healthy under variant X" claim under MCTS, not just greedy** (BAL-1).
- **Commit + push per logical unit** — container is ephemeral.

## Plan

1. **Methodology doc (this).** Commit.
2. **Engine: implement the three flags, TDD per flag, commit per flag.** Order: simplest first.
   - (i) `victoryIronRequiresPerimeter` (touches status.ts + control.ts, +`perimeter: boolean` field).
   - (ii) `noIronRequiresPerimeter` (touches status.ts applyEliminations; reuses `perimeter`).
   - (iii) `victoryIronHoldRounds` (adds `victoryStreak: number` to Player + end-of-round tick).
3. **Full suite green check** after all three; verify defaults preserve current behavior.
4. **Comparative runner script** (`src/sweep/compare-variants.ts`): runs the focused grid for baseline + (a) + (b) + (c) under greedy, then revalidates the best cell of each variant under MCTS, then writes the comparison report.
5. **Run it.** Wall-clock dominated by the MCTS revalidations; should fit in the remaining time.
6. **Comparison report** at `docs/2026-05-28-rules-variants-comparison.md`.
7. **Handoff doc update** + a fresh review pass.

## What I will NOT do autonomously

- Change `defaultConfig`.
- Pick a winner — the comparison provides data; the choice is Sam's.
- Implement Option (d) (it's a "don't try" option).
- Merge anything to main.

## Failure modes I'm watching for

- **`victoryIronHoldRounds` interaction with last-standing:** if a player wins last-standing while another's streak is mid-build, the game still ends. That's correct (last-standing is independent of iron) but worth confirming via a test.
- **`noIronRequiresPerimeter` + radiating-with-iron player:** if a 3-base player drops to 0 iron (denial), they're now spared elimination — meaning radiating players are effectively immortal until they perimeter-up. May produce a new stalemate mode (radiating-forever). The MCTS revalidation will surface this.
- **`victoryIronRequiresPerimeter` + small boards:** if no player can establish a perimeter with iron inside (geometry constrains hulls), no one can iron-win. Iron victory becomes structurally impossible → last-standing dominates by default — possibly the opposite of intent. Watch median-turns + iron-victory-fraction.
- **State serialization:** adding `victoryStreak` to Player changes the GameState shape. Any test that serializes/deserializes state needs to handle the new field. Audit during implementation.

## Stretch follow-ups (if time permits, bias-to-action per Sam)

- Test combined variants (a)+(b), (a)+(c), (b)+(c) — if individual results suggest stacking might unlock something.
- Probe a couple of `victoryIronHoldRounds` values (2 and 3) to see if the hold count matters.
- If a variant produces a clean winner under MCTS, run an exploiter probe (`A5.2`-like) on it as evidence of trustworthiness.
