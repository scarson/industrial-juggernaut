# Alliance-Aware Agent Policy — Implementation Plan

**Plan date:** 2026-05-28 (overnight).
**Status banner:** ✅ Complete (Phases 1-3 + Phase 5 done; Phase 4 deferred as Sam-gated optional v2). Engine work landed 2026-05-28; full alliance-aware-policy stack now active. Result: alliance-aware heuristic uses alliances meaningfully (~14% coalition-win rate at default delta=4 vs ~0 incidental in the blind run); the anti-coalition delta scaling works as designed (higher delta → fewer coalition wins).
**Authoritative inputs:**
- `docs/plans/2026-05-28-alliance-layer-plan.md` — alliance feature shipped (engine Phases 1-6); Phase 7 sweep is the trigger for this plan.
- `docs/2026-05-28-design-followups-alliances-and-tactical-depth.md` — original spec and the known agent limitation.

## Why this is gated

Currently, the heuristic agent (`samplePolicy`) and the MCTS agent (`chooseActionMCTS`) handle alliance actions only via fallback paths:
- `samplePolicy` builds candidates from `sampleBuild`/`sampleAttack`/pass — it doesn't enumerate `ally` or `break-alliance` strategically. If a player has ALY actions in `legalActions` but those are the only legals, the fallback `acts[0]!` returns an ally (random choice).
- MCTS in `fixedCandidates` includes attacks + pass from `legalActions` but not ally/break-alliance. In progressive-widening mode, `samplePolicy`'s output (still missing alliance candidates) seeds the search.

**Net:** alliance actions are *legal* under the engine but *rarely chosen* by current agents. Phase 7's sweep will measure this directly. If the result is "alliances rarely form even with the flag on, the safeguards never fire," that's a SIGNAL that the agent improvement is needed for the sim to measure alliance dynamics; it doesn't make the engine work less valid.

**Don't start this plan unless:** Phase 7 shows incidental-only alliance formation AND Sam wants in-sim alliance behavior (as opposed to "alliances are a human-play feature; sim mechanical correctness is enough").

## Spec summary — what changes

### Heuristic agent (`src/agent/heuristic.ts`)
1. Add `ally`/`break-alliance` as candidate kinds in `samplePolicy`. Each player gets one "ally" candidate per non-self non-allied non-cooldown target, and one "break-alliance" candidate per current ally.
2. Score each candidate via a new heuristic. For ally: expected value = `weights.alliance × (target.iron + target.factories - self.iron + delta)` (positive if the target has more iron than self by enough to clear the anti-coalition delta). For break-alliance: expected value = `weights.breakAlliance × (currentCoalitionDeficitVsOpponent - cooldownCost)`.
3. Add weights `alliance: number`, `breakAlliance: number` to `HeuristicWeights`. Initial values: hand-picked starting points (e.g., 5, 2); tune via comparison sweep.

### MCTS agent (`src/agent/mcts.ts`)
1. Extend `fixedCandidates` to include `ally` and `break-alliance` actions from `legalActions` (parallel to attacks + pass).
2. No other change needed — the existing PW + evaluation machinery handles new action shapes via the heuristic + `applyAction` simulator.

### Evaluation function (`evaluate`, used as MCTS leaf-eval)
Already evaluates a state; with alliances enabled, the state includes alliance info. Currently `evaluate` doesn't weight coalition iron specifically. Optional v2: add coalition-aware bonus (the agent values being in a coalition that has good iron-density).

## Phases

### Phase 1: Heuristic candidate generation — ✅ Complete (2026-05-28)

- [x] Failing test written (`test/agent/heuristic-alliance-aware.test.ts`): under alliances enabled + a "strong vs weak ally" state, the heuristic at temp→0 picks `ally(target=strong)`. Red phase confirmed (build vs ally).
- [x] Implemented in `src/agent/heuristic.ts`: `samplePolicy` enumerates `ally` and `break-alliance` candidates from `legalActions` (delegating gating so the legality logic isn't duplicated). Scoring:
   - `ally(T)`: `evaluate(post-apply)[player] + POLICY_ALLIANCE_WEIGHT × control(state, T).iron.length` — prefers strong partners.
   - `break-alliance(T)`: `evaluate(state)[player] − POLICY_BREAK_ALLIANCE_WEIGHT × control(state, T).iron.length` — penalizes breaking off a strong ally; scored against the unchanged state because `applyAction(break-alliance)` draws rng we don't want to consume in the scorer.
- [x] Initial weights `POLICY_ALLIANCE_WEIGHT = 5`, `POLICY_BREAK_ALLIANCE_WEIGHT = 5` — starting points, tuned in Phase 3.
- [x] Negative tests pass: alliances disabled → no ally candidates; actor on cooldown → no ally candidates.
- [x] Full suite green: 314 tests (was 310 + 4 new). MCTS-vs-greedy SIGNAL unchanged (still 0/1 — alliance-aware ally not relevant in the 2P-no-alliance test).
- [x] Committed.

### Phase 2: MCTS candidate generation — ✅ Complete (2026-05-28)

- [x] Failing tests written in `test/agent/mcts.test.ts` (expandNode candidateMode='fixed' block): (a) opens `ally` candidate when alliances enabled + non-allied target exists; (b) opens `break-alliance` candidate when actor already has a live ally. Red phase confirmed (break-alliance test failed because fixedCandidates didn't iterate over alliance actions from legalActions).
- [x] Implemented in `src/agent/mcts.ts`: `fixedCandidates` now also iterates `legalActions` for `ally` and `break-alliance` kinds and adds them to the deduped candidate set. The PW path uses `samplePolicy` directly (which already includes alliance candidates via Phase 1), so no PW-side change needed.
- [x] Full suite green: 316 tests (was 314 + 2 new Phase 2 tests).
- [x] Committed.

### Phase 3: Heuristic weight tuning sweep — ✅ Complete (2026-05-28)

- [x] Built `src/sweep/tune-alliance-weights.ts`. Trimmed to a single-axis sweep on `allianceWeight ∈ {0, 1, 3, 5, 10}` (50 3P heuristic-self-play games per weight on variant (c) with alliances enabled, delta=4). `breakAllianceWeight` left at its default (5) — sweeping a second axis without a clear signal on the first is wasted compute.
- [x] Per-game JSONL + commits (BAL-2). Report: `docs/2026-05-28-alliance-weights-tuning.md`.
- [x] Findings:
   - Weights 0-5 cluster: 24-32% coalition wins, mean coalition size 2.13-2.42, median 2 turns, mostly iron-victory. Within-seed noise dominates between-weight differences.
   - Weight=10 is a phase transition: 96% coalition wins, mean size ≈ 3 (full 3-player), median 1 turn, ALL last-standing. Mechanism: every player allies with every other on turn 1, leaving "exactly one non-eliminated coalition" → engine's `status()` declares last-standing immediately. **Engine semantics finding worth flagging** (in the report): the "exactly one coalition remaining" rule fires whether others were eliminated OR merged via alliance.
   - Weight=0 isn't a true alliance-blind baseline: `evaluate` ignores alliance arrays AND basesInHand, so ally typeValue equals pass typeValue, and the heuristic picks ally as a tie-break "do nothing useful" action when builds/attacks degrade position. A real blind baseline needs `alliancesEnabled=false`.
- [x] **Recommendation: keep `DEFAULT_POLICY_ALLIANCE_WEIGHT = 5`** — safe regime, within sweep noise of the other low weights. Higher weights destroy gameplay. The right way to get more signal is Phase 4 (alliance-aware `evaluate`) or alliance-event instrumentation, not bumping this weight.
- [x] Committed.

### Phase 4: Alliance-aware leaf-evaluation (optional / v2) — ⬜ Not started

- [ ] If Phase 3 alone gives sufficient alliance dynamics, SKIP this phase. The pure-candidate-generation change might be enough.
- [ ] Otherwise: extend `evaluate(state, weights)` to include a coalition-iron-density term.
- [ ] TDD; sweep again. Commit.

### Phase 5: Re-run alliance comparison sweep with alliance-aware agents — ✅ Complete (2026-05-28)

- [x] Built `src/sweep/compare-alliance-deltas-aware.ts` (mirror of compare-alliance-deltas.ts, same seeds + configs, alliance-aware heuristic at default weight=5). Report: `docs/2026-05-28-alliance-comparison-aware.md`.
- [x] Headline: **alliance-aware heuristic produces meaningful coalition dynamics that the blind version did not.** Coalition-win rate (size ≥ 2):
   - alliances OFF: 0% (none possible).
   - delta=2: 15.3% (vs ~0 incidental in the blind run).
   - delta=4 (default): 14.0%.
   - delta=5: 10.7%.
   - Iron-vic share drops from 96.7% (blind, delta=4) to 91.0% (aware, delta=4), with last-standing picking up the rest — meaning coalitions are deciding games in ways the blind run couldn't measure.
- [x] **The anti-coalition delta scales as designed:** higher delta → lower coalition-win rate (15.3% → 10.7% as delta goes 2 → 5). The safeguard's tunability is now empirically demonstrated.
- [x] Median turns still 2 (the (c)-regime opening still dominates). No length-stretching effect from alliances under self-play.
- [x] Engine all-player-coalition ban (`legal.ts`, committed separately 2026-05-28) prevents the degenerate "everyone allies → declared last-standing winner" pathology surfaced by Phase 3's weight=10 sweep.
- [x] Committed.

## Adversarial review

**R1 — Premature optimization risk.** Adding alliance-aware reasoning to the agents might make ALLIANCES the dominant strategy when they shouldn't be. The agent improvement should be PROPORTIONATE — agents should value alliances when they help, not always. The weight-tuning sweep (Phase 3) addresses this directly.

**R2 — Spec drift risk.** If the heuristic is tuned to "love alliances," does it stop using its other competent moves (perimeter building, attacks)? Test: existing perimeter-building tests should remain green even with alliance weights set. Add an explicit regression test.

**R3 — Does this even help?** Maybe the agent-blind sweep (Phase 7 of the original plan) already shows "alliances work mechanically; the safeguard fires correctly," and the sim-strategic-richness question is genuinely playtest-only. In that case, this plan IS the wrong direction — defer to playtest. Sam's call.

**R4 — Validation method.** The current weights tuning sweep measures alliance formation rate. But "formation rate" isn't engagement; it's a proxy. The real measure is "does the agent's win rate IMPROVE with alliance reasoning vs without?" That's the test: heuristic-with-alliances should beat heuristic-without-alliances in head-to-head when alliances are enabled. If not, alliances aren't strategically valuable AT THE AGENT'S DEPTH. Add this h2h to the validation.

## Open questions

- Should the agent's alliance reasoning include OPPONENT modeling? ("My target opponent might break the alliance immediately; don't ally with them.") Current proposal: no — that's MCTS's job, not the heuristic's.
- Should `evaluate` include alliance partner's iron in self-iron computation, even when not yet allied? Current proposal: no — `evaluate` works on the current state; it doesn't speculate on future alliances.

## Out of scope (deferred)

- A neural-network alliance policy. The simpler heuristic is sufficient first; learned-agent work is triple-gated already.
- Per-opponent trust modeling.
- Multi-step alliance plans (the agent decides on an alliance sequence over multiple turns).

## Execution status — top-of-plan summary table

| Phase | Title | Status |
|---|---|---|
| 1 | Heuristic candidate generation for alliance actions | ✅ Complete (2026-05-28) |
| 2 | MCTS candidate generation for alliance actions | ✅ Complete (2026-05-28) |
| 3 | Heuristic weight tuning sweep | ✅ Complete (2026-05-28) — keep weight=5 |
| 4 | Alliance-aware leaf evaluation (optional) | ⬜ Sam-gated (recommend deferring; see Phase 3 findings) |
| 5 | Re-run alliance comparison with aware agents | ✅ Complete (2026-05-28) — coalitions form meaningfully, delta-scaling works |
