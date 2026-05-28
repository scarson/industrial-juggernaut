# Alliance-Aware Agent Policy — Implementation Plan

**Plan date:** 2026-05-28 (overnight).
**Status banner:** ⬜ Not started — TRIPLE-GATED: (1) alliance Phase 7 sweep data shows agents don't form/break alliances meaningfully, (2) Sam confirms the agent gap is worth closing in sim (vs deferring to playtest), (3) the agent improvement is the right direction (vs the rules-side simplification).
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

### Phase 1: Heuristic candidate generation — ⬜ Not started

- [ ] Write failing test: under alliances enabled + heuristic agent + a "good ally available" state, the agent picks the ally action with high probability (>= 50% across many seeds).
- [ ] Implement: extend `samplePolicy` to enumerate alliance candidates. Add to candidate set with computed `typeValue`.
- [ ] Test: under "no good ally" state (only self-allied), agent doesn't ally.
- [ ] Full suite green. Commit.

### Phase 2: MCTS candidate generation — ⬜ Not started

- [ ] Write failing test: MCTS in fixed-candidates mode under alliances enabled opens `ally` and `break-alliance` edges in the root.
- [ ] Implement: extend `fixedCandidates` in `mcts.ts`.
- [ ] Full suite green. Commit.

### Phase 3: Heuristic weight tuning sweep — ⬜ Not started

- [ ] Build `src/sweep/tune-alliance-weights.ts`: sweep `weights.alliance ∈ {0, 1, 3, 5, 10}` and `weights.breakAlliance ∈ {0, 1, 3, 5}`.
- [ ] Measure: alliance formation rate, alliance break rate, average coalition size at game end, who wins.
- [ ] Pick weights that produce ~30-50% alliance formation rate (alliances are USED but not always-on).
- [ ] Generate `docs/2026-05-28-alliance-weights-tuning.md`. Commit.

### Phase 4: Alliance-aware leaf-evaluation (optional / v2) — ⬜ Not started

- [ ] If Phase 3 alone gives sufficient alliance dynamics, SKIP this phase. The pure-candidate-generation change might be enough.
- [ ] Otherwise: extend `evaluate(state, weights)` to include a coalition-iron-density term.
- [ ] TDD; sweep again. Commit.

### Phase 5: Re-run alliance comparison sweep with alliance-aware agents — ⬜ Not started

- [ ] Re-run `src/sweep/compare-alliance-deltas.ts` with the alliance-aware heuristic + MCTS.
- [ ] Compare to the Phase 7 baseline (alliance-blind agents).
- [ ] Did the data change meaningfully? Did the anti-coalition delta become tunable in a way it wasn't before?
- [ ] `docs/2026-05-28-alliance-comparison-with-aware-agents.md`. Commit.

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
| 1 | Heuristic candidate generation for alliance actions | ⬜ Not started (triple-gated) |
| 2 | MCTS candidate generation for alliance actions | ⬜ Not started |
| 3 | Heuristic weight tuning sweep | ⬜ Not started |
| 4 | Alliance-aware leaf evaluation (optional) | ⬜ Not started |
| 5 | Re-run alliance comparison with aware agents | ⬜ Not started |
