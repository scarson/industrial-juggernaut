# Concession Mechanic — Implementation Plan

**Plan date:** 2026-05-28 (overnight)
**Status banner:** ⬜ Not started → 🚧 In progress → ✅ Complete.
**Overall status:** ⬜ Not started — Sam-confirmed in scope; asset-handling is the open design call.
**Authoritative inputs:**
- `2026-05-28-design-decisions-from-thought-exercises.md` — Sam: "Concession mechanic is probably good to have. Need to consider what happens to the player's assets in 3-6P games."
- `docs/2026-05-28-concession-mechanic-spec.md` — spec; recommended option 4 (concession-as-elimination, no by-player bounty).
- `docs/plans/2026-05-28-alliance-layer-plan.md` — pattern reference.

**Sequencing context:** smallest of the queued mechanics; could ship in parallel with any other plan. Recommend after variant (c) is adopted (so concession is measured against the adopted balance baseline).

## Spec summary

### What concession is
A voluntary, in-turn action that ends a player's involvement in the game. Their bases are removed (via existing `applyEliminations` machinery with `byPlayer = null`); no kill bounty is awarded. The conceding player becomes `eliminated: true`. If only one live player remains after concession, `status()` declares last-standing victory; otherwise game continues.

### `RuleConfig` flag
`concessionEnabled: boolean` (default `false`). Behavior preserved when off.

### New `Action`
`{ kind: "concede" }` — no target, no parameters. Legal iff `concessionEnabled` AND it's the player's turn AND they are not already eliminated.

## Phases

### Phase 1: Flag + Action shape + stubs — ⬜ Not started

- [ ] Add `concessionEnabled: boolean` (default false) to `RuleConfig`.
- [ ] Add `{ kind: "concede" }` to `Action` union.
- [ ] Wire stubs through `apply.ts`/`mcts.ts`/`score.ts` switches (throw "not implemented" / return 0).
- [ ] Full suite green; commit.

### Phase 2: legalActions emits concede — ⬜ Not started

- [ ] Tests:
  - Flag off: no concede action emitted.
  - Flag on, current player not eliminated: concede emitted.
  - Flag on, other players: concede not emitted for them (only for the actor of the current turn).
- [ ] Implement `legalActions` extension.
- [ ] Full suite green; commit.

### Phase 3: applyAction for concede — ⬜ Not started

- [ ] Tests:
  - Concede sets actor's `eliminated: true`.
  - All actor's bases are removed from `state.bases` (via `applyEliminations(state, null)`).
  - No `basesInHand` change for any other player (no bounty).
  - Actor's `basesInHand` is preserved (no special handling beyond elimination's standard).
  - `status()` correctly declares last-standing when concession leaves 1 player.
  - Throws when not legal (flag off, already eliminated).
- [ ] Implement: set eliminated flag, run `applyEliminations(state, null)` for cleanup.
- [ ] Full suite green; commit.

### Phase 4: Driver integration — ⬜ Not started

- [ ] Smoke test: a 2P game with concession enabled and a scripted agent that concedes on turn 5 ends correctly with the other player winning last-standing on turn 5.
- [ ] Smoke test: a 3P game with concession enabled — when one player concedes, the remaining 2 continue normally (assuming flag-off variant where alliance threshold doesn't fire) until iron-victory or eventual elimination.
- [ ] Commit.

### Phase 5: Comparison sweep (optional) — ⬜ Not started

- [ ] Build `src/sweep/compare-concession.ts`:
  - Variants: concession off / on.
  - Use a scripted agent that concedes when their iron drops below 30% of the leader's.
  - 3-4P games.
- [ ] Measure: average game length, did the concession-trigger threshold fire?, did games end faster?
- [ ] `docs/2026-05-28-concession-comparison.md`. Commit.

## Adversarial review

**R1 — Asset-handling griefing.** Recommended option (concession = elimination with no bounty) avoids griefing incentive (you can't concede to give specific allies a windfall). However, by NOT awarding bounty, the OTHER players neither benefit nor are harmed by concession. This is neutral — neither rewards nor punishes survivors for the concession. Seems right for v1.

**R2 — Concession-as-attack-mitigation.** Could a player concede ANY time, or only when "losing"? Spec says unconditional; this enables tactical concession (e.g., a player about to be killed concedes first to deny their opponent the bounty). That IS a griefing vector — the about-to-die player concedes to deny the kill-bounty. Note: with my recommended option (no bounty for concession), the kill-bounty IS denied — but it would have been denied either way if the attacker can't actually finish the kill. Net: minor griefing risk; defer the gate-on-loss-criterion to v2.

**R3 — Interaction with alliances.** If a player concedes while in an alliance, the mutual alliance refs should be cleaned (their alliance partner needs `alliance` array updated). Currently `applyEliminations` already removes the eliminated player's id from other players' coalitions via `coalitions()` recomputation each call — but the static `alliance` arrays of survivors would still contain the conceded player's id. Defense in depth: in `applyEliminations`, when a player is eliminated, also remove their id from other players' `alliance` arrays. Add this to the concession test, or to `applyEliminations` generally. Verify.

## Out of scope

- Loss-criterion gate for concession (e.g. only legal when you have < X% of leader's iron).
- Spoils distribution (option 3 from the spec — bounty to "pressurer").
- Negotiated exit (option 5 — player chooses asset distribution).
- Bot/heuristic strategic use of concession (the heuristic won't concede; that's fine — concession is a human-quality-of-life feature).

## Open questions for Sam

- Should concession unconditionally available, or gated on a loss criterion? Recommended: unconditional v1, gate later if observed griefing.
- Should we clean up alliance refs to the conceded player in survivors' `Player.alliance` arrays? Recommended: yes (defense in depth).

## Execution status — top-of-plan summary table

| Phase | Title | Status |
|---|---|---|
| 1 | Flag + Action shape + stubs | ⬜ Not started |
| 2 | legalActions emits concede | ⬜ Not started |
| 3 | applyAction for concede | ⬜ Not started |
| 4 | Driver smoke tests | ⬜ Not started |
| 5 | Comparison sweep (optional) | ⬜ Not started |
