# Alliance Layer — Implementation Plan

**Plan date:** 2026-05-28 (overnight)
**Status banner:** ⬜ Not started → 🚧 In progress → ✅ Complete. Phases below carry their own banners.
**Overall status:** ⬜ Not started
**Authoritative inputs:**
- `2026-05-28-design-decisions-from-thought-exercises.md` — Sam's directional decisions (medium-strength, tunable anti-coalition delta, weighted-with-cooldown break mechanic).
- `2026-05-28-design-followups-alliances-and-tactical-depth.md` §Alliance layer — the original spec brainstorm.
- `2026-05-27-balance-rules-analysis.md` §0.1 — why this work exists.
- `docs/pitfalls/implementation-pitfalls.md` — BAL-1, GEO-1..6 to honor; ORCH-1 not applicable (no subagent dispatch).

**Sequencing context:** This is Phase B of the next-several-hours queue (`docs/plans/2026-05-28-next-several-hours-queue.md`). Variant (c) validation (Phase A) runs in parallel; alliance work is additive (default-off flag) so it doesn't depend on (c) adoption.

**TDD mandate:** every behavior change in `src/` is preceded by a failing test in `test/`. The existing 397-test suite must remain green after each commit. Default-off flag ensures bit-for-bit preservation when alliances are not enabled.

## Spec summary (the refined design)

### Flags added to `RuleConfig`
- `alliancesEnabled: boolean` (default `false`) — master toggle. When false, ally/break-alliance actions are never legal; engine behavior bit-identical to today.
- `allianceVictoryDelta: number` (default `4`) — anti-coalition victory-threshold scaling. A coalition of size N must reach `victoryThreshold + (N - 1) * allianceVictoryDelta` iron to win by iron.
- *(deferred)* `allianceBreakMechanic` — for first iteration, hardcode the "weighted-with-cooldown" mechanic; if later versions need an alternative (e.g. neutral-EV-with-iron), promote to a config flag then.

### `Player` field additions
- `allianceCooldownTurns: number` (default `0`) — if > 0, the player cannot enter new alliances and the field decrements at turn rollover.

### New `Action` shapes
- `{ kind: "ally", target: PlayerId }` — propose-and-seal an alliance with `target`.
- `{ kind: "break-alliance", target: PlayerId }` — attempt to leave the existing alliance with `target`.

### Action semantics — `ally`
- **Legality:** `alliancesEnabled` is true; `target` is a different live player; not already allied to `target`; actor has `allianceCooldownTurns === 0`; actor has `basesInHand >= 1` (commit cost).
- **Effect:** actor's `basesInHand` -= 1 (the discarded base goes back to the unplaced pool); `actor.alliance` adds `target.id`; `target.alliance` adds `actor.id` (mutual). One-sided declarations are NOT supported — sealing requires both `.alliance` arrays to reflect the relationship.
- **Note:** the discarded base is NOT placed on the board; it's a commitment cost paid back into `basesInHand`'s "not yet on board" stockpile, reducing the actor's future build budget. **Alternative considered + ruled out:** "place a token base on the board adjacent to the ally" — too invasive on the placement-rules layer; defers.

### Action semantics — `break-alliance`
- **Legality:** `alliancesEnabled` is true; `target` is currently in actor's `alliance` array; actor and target are both live.
- **Effect (weighted-with-cooldown):**
  - Roll: 2/3 success, 1/3 failure (one rng draw, 0..1 float compared to 2/3).
  - On SUCCESS: actor.alliance removes target.id; target.alliance removes actor.id (mutual). Actor's `allianceCooldownTurns` set to 1.
  - On FAILURE: actor's `allianceCooldownTurns` set to 1; alliance arrays UNCHANGED — the betrayal "fizzles" but the actor still pays the cooldown.
  - Either way, the action ends the actor's round (consumes the round's action like a build/attack does).
- **Note:** the cooldown is per-actor only — the target who didn't initiate the break has no cooldown. This asymmetry is intentional (the betrayer pays the price for trying).

### Anti-coalition victory threshold in `status()`
- Replace the current iron-victory threshold check with: `if (coalitionVictoryIron(state, comp) >= victoryThreshold + (comp.length - 1) * allianceVictoryDelta) ...`.
- When `comp.length === 1`, this reduces to the existing threshold (no behavior change for singletons).
- The `allianceVictoryDelta` is the tunable knob.

### Cooldown decrement at turn rollover
- In `advanceRound`'s turn-rollover branch (already modified for the variant-(b) `victoryStreak` update), additionally: `allianceCooldownTurns = max(0, allianceCooldownTurns - 1)` per non-eliminated player.

### Out of scope for this implementation
- Iron-stealing on break (Sam's "neutral coin-flip steal/lose iron" variant) — defer; would require either positional iron transfer (complex) or a `victoryIronBonus` field that complicates the iron-victory tally. Documented as a follow-up variant.
- Agent strategic awareness of alliances — heuristic and MCTS will encounter ally/break-alliance as legal actions (when enabled) but won't pursue them strategically (no heuristic weights for coalition reasoning). Acceptable for first iteration; the sweep's job is to verify mechanical correctness and probe the *dynamics* via scripted exploiter agents.
- UI / CLI representation — flags only per Sam.

## Phases

Each phase ends with: a commit, a status banner update at the top of this plan, and a brief "Discoveries" entry below (if anything surprising surfaced).

### Phase 1: Engine flags + types — ⬜ Not started
**Goal:** RuleConfig flags + Player field + Action shapes wired through types. No behavior yet.

- [ ] Add `alliancesEnabled: boolean` (default false), `allianceVictoryDelta: number` (default 4) to `RuleConfig` in `src/engine/config.ts`.
- [ ] Add `allianceCooldownTurns: number` to `Player` in `src/engine/types.ts`. Default 0.
- [ ] Initialize `allianceCooldownTurns: 0` in `setupGame` (`src/engine/turn.ts`) per player.
- [ ] Add `{ kind: "ally", target: PlayerId }` and `{ kind: "break-alliance", target: PlayerId }` to the `Action` union in `src/engine/types.ts`.
- [ ] Run `npx tsc --noEmit`; fix any test fixtures missing the new `Player` field (likely `test/helpers/state.ts` + a couple of `test/engine/turn.test.ts` Player literals — same pattern as variant (b) `victoryStreak`).
- [ ] Run the full test suite — must remain green (defaults preserve behavior).
- [ ] Commit `feat(engine): add alliance RuleConfig flags + Player.allianceCooldownTurns + Action shapes (no behavior yet)`.

**Test discipline:** no new tests in this phase — all changes are pure type/default additions. The full suite serving as a regression net is the verification.

### Phase 2: `ally` action — ⬜ Not started
**Goal:** TDD the ally action through `legalActions` + `applyAction`.

- [ ] Write failing test in `test/engine/legal.test.ts`: when `alliancesEnabled: true` and player has `basesInHand >= 1`, `legalActions` includes one `ally` action per non-self, non-allied, live player.
- [ ] Write failing test: when `alliancesEnabled: false`, `legalActions` never includes `ally` actions (even with all other conditions met).
- [ ] Write failing test: when actor has `allianceCooldownTurns > 0`, no `ally` actions surface.
- [ ] Write failing test: when actor and target are already mutually allied, no `ally` action surfaces (between them — others still legal).
- [ ] Implement the legality branches in `legalActions`.
- [ ] Write failing test in `test/engine/apply.test.ts`: `applyAction(state, { kind: "ally", target: 1 })` mutually adds id-refs to `alliance` arrays AND decrements `actor.basesInHand` by 1.
- [ ] Write failing test: ally action fails (throws) when not legal (any of the above legality conditions violated).
- [ ] Implement `applyAction` for `ally`.
- [ ] Full test suite green.
- [ ] Commit `feat(engine): ally action — TDD legal + applied semantics, default-off`.

**Discoveries placeholder:** *(filled in after the phase)*

### Phase 3: `break-alliance` action with weighted-with-cooldown — ⬜ Not started
**Goal:** TDD the break action — both success and failure paths — with the 2/3-success weighted roll and cooldown semantics.

- [ ] Write failing tests in `test/engine/legal.test.ts`: break action is legal iff (alliancesEnabled, currently mutually allied, both live, no cooldown).
- [ ] Implement legality.
- [ ] Write failing tests in `test/engine/apply.test.ts` for `applyAction(state, { kind: "break-alliance", target: 1 })`:
  - **Success path** (rng draws < 2/3): alliance arrays mutually clear references; actor's `allianceCooldownTurns` set to 1; rng advances by 1.
  - **Failure path** (rng draws >= 2/3): alliance arrays UNCHANGED; actor's `allianceCooldownTurns` set to 1; rng advances by 1.
  - **Determinism:** same seed + state -> same outcome (twice-called identical results).
- [ ] Implement `applyAction` for `break-alliance` — single rng draw at action time; threading the advanced rng into the returned state per GEO-3.
- [ ] Full test suite green.
- [ ] Commit `feat(engine): break-alliance action — weighted (2/3-success) with cooldown, TDD'd both paths`.

**Discoveries placeholder:** *(filled in after the phase)*

### Phase 4: Anti-coalition victory threshold — ⬜ Not started
**Goal:** Status check scales the iron threshold with coalition size.

- [ ] Write failing test in `test/engine/status.test.ts`: a 2-player coalition with `coalitionVictoryIron == victoryThreshold` does NOT win when `allianceVictoryDelta > 0` (needs threshold + delta).
- [ ] Write failing test: a 2-player coalition with `coalitionVictoryIron == victoryThreshold + allianceVictoryDelta` DOES win.
- [ ] Write failing test: a singleton with `coalitionVictoryIron == victoryThreshold` wins (no behavior change for singletons; delta of 0 contribution).
- [ ] Write failing test: the threshold scales linearly — a 3-player coalition needs `victoryThreshold + 2 * allianceVictoryDelta`.
- [ ] Update `status()` in `src/engine/status.ts` to use the scaled threshold.
- [ ] Full test suite green (existing coalition-iron-victory test should still pass because `comp.length === 1` reduces to the old behavior — verify; if not, the existing test was using a 2-allied-coalition and needs the threshold adjusted explicitly).
- [ ] Commit `feat(engine): anti-coalition victory threshold scales with coalition size`.

**Discoveries placeholder:** *(filled in after the phase)*

### Phase 5: Cooldown decrement at turn rollover — ⬜ Not started
**Goal:** `allianceCooldownTurns` decrements once per turn, just like `victoryStreak` updates.

- [ ] Write failing test in `test/engine/turn.test.ts`: after `advanceRound` rolls a turn (indexInOrder->0), each non-eliminated player's `allianceCooldownTurns` is `max(0, prev - 1)`.
- [ ] Write failing test: within-turn `advanceRound` calls (no rollover) leave cooldown unchanged.
- [ ] Write failing test: eliminated players' cooldown is not touched.
- [ ] Implement in `advanceRound`'s rollover branch.
- [ ] Full test suite green.
- [ ] Commit `feat(engine): cooldown decrement on turn rollover`.

**Discoveries placeholder:** *(filled in after the phase)*

### Phase 6: Engine smoke + agent acceptance — ⬜ Not started
**Goal:** confirm the engine works end-to-end with alliances enabled in a played game, and that the existing agents don't crash.

- [ ] Write an integration test in `test/engine/`: 2-player game with `alliancesEnabled: true` and a scripted "ally-on-turn-1" agent — verify the alliance forms, iron-victory uses the scaled threshold, and a break action works.
- [ ] Verify in test: heuristic agent and MCTS agent both handle states with alliances enabled (they may not USE the new actions strategically, but they shouldn't crash). Probably no code change needed — agents already iterate `legalActions` results; new actions are just options they ignore (or pick randomly via samplePolicy fallback).
- [ ] Full test suite green.
- [ ] Commit `test(engine): alliance feature smoke + agent-compatibility`.

**Discoveries placeholder:** *(filled in after the phase)*

### Phase 7: Comparison sweep — ⬜ Not started
**Goal:** measure the *mechanical* effect of alliances at varying deltas. (The strategic effect needs playtest; this phase only verifies mechanics + measures aggregate outcomes.)

- [ ] Write `src/sweep/compare-alliance-deltas.ts` modeled on the existing `compare-variants.ts`:
  - Variants: baseline (alliances off) + alliances-on at delta ∈ {2, 3, 4, 5}.
  - Heuristic and MCTS agents WITH a scripted "first-turn-ally-random-opponent" exploiter as a third agent (to actually exercise the alliance dynamic — heuristic/MCTS won't initiate).
  - Use 3-4P games (alliances are irrelevant in 2P).
  - 150 games per variant, MCTS revalidation on top cells.
- [ ] Run the sweep.
- [ ] Generate report at `docs/2026-05-28-alliance-comparison.md`.
- [ ] Write a synthesis section: which delta produces the most interesting dynamic? Does alliance reduce or increase game length? Does the anti-coalition threshold prevent 2-vs-1 auto-gg in 3P?
- [ ] Commit + push report.

**Discoveries placeholder:** *(filled in after the phase)*

## Adversarial review (≥3 rounds, per writing-plans-enhanced discipline)

**Round 1 — naive-fresh-agent ambiguity audit.**
- "*Default-off flag*" — clear, but the EXACT default needs to appear in both `RuleConfig` interface AND `defaultConfig()` return. Plan explicit at Phase 1.
- "*Discard one base from basesInHand*" — the meaning of "discard": does the base return to the unplaced stockpile (basesInHand decrement, no on-board placement) or is it actually destroyed (basesInHand AND total cap decrement)? Plan: decrement basesInHand only; no other cap change. The base is "spent" on the alliance commitment.
- "*The 2/3 success ratio*" — needs to be in terms of the existing PCG rng API. Plan: `nextFloat(state.rngState)` returns a [0, 1) float; success iff `< 2/3`. Document explicitly in Phase 3.

**Round 2 — interpretation-drift / cross-task conflict.**
- Phase 4 modifies `status()`. Phase 5 modifies `advanceRound`. Phase 3 modifies `applyAction`. None of these intersect directly, but Phase 2 + Phase 3 + Phase 5 all touch `Player.allianceCooldownTurns`. The cooldown lifecycle: set by break action (Phase 3) → decremented by turn rollover (Phase 5) → read by ally-action legality (Phase 2). If Phase 2 is implemented BEFORE Phase 5, the cooldown can never become non-zero in a played game (no break action yet) — so Phase 2's "cooldown blocks ally" test is correct but never exercised end-to-end until Phase 3 ships. Acceptable: the test asserts the LEGALITY logic in isolation; integration is exercised in Phase 6.
- Phase 4's coalition-iron threshold: does it apply to BOTH the victory check AND the `victoryStreak` update logic in variant (b)? The variant-(b) streak update in `advanceRound` uses raw `coalitionVictoryIron(state, comp) >= threshold` (without the delta). With Phase 4 in place, those should ALSO scale. Resolution: in Phase 4, update the streak-increment threshold check in `advanceRound` (`src/engine/turn.ts`) similarly. Add a test that exercises this interaction.

**Round 3 — pitfalls coverage.**
- GEO-3 (PRNG threading): Phase 3's break action draws once from rng and threads forward. Phase 3 tests must verify rng advancement is exactly one step. Plan call-out added.
- GEO-4 (canonical hex keys): no hex operations in this feature. N/A.
- GEO-5 (derived state recomputed): coalitions are recomputed each `status()` call; this stays true. N/A.
- BAL-1 (validate under MCTS, not just greedy): Phase 7's sweep must include MCTS revalidation, not just greedy. Plan already specifies this.

## Out-of-scope items (for follow-up plans)

- Iron-stealing break mechanic (the "neutral-EV-with-iron" variant Sam mentioned). Defer to a v2 plan.
- Tactical-depth troop types (per sequencing — comes after alliances are validated).
- Concession mechanic; neutral-defending-bases in 2P; board-terrain manipulation — separate specs in Phase C of the queue.
- Agent strategic alliance awareness (`heuristicWeights` extension for coalition reasoning, MCTS evaluating alliance moves). Phase 7's scripted exploiter is sufficient for first iteration.

## Discoveries log

*(empty — phases haven't run yet)*

## Execution status — top-of-plan summary table

| Phase | Title | Status |
|---|---|---|
| 1 | Engine flags + types | ⬜ Not started |
| 2 | `ally` action | ⬜ Not started |
| 3 | `break-alliance` (weighted-with-cooldown) | ⬜ Not started |
| 4 | Anti-coalition victory threshold | ⬜ Not started |
| 5 | Cooldown decrement at turn rollover | ⬜ Not started |
| 6 | Engine smoke + agent acceptance | ⬜ Not started |
| 7 | Comparison sweep | ⬜ Not started |
