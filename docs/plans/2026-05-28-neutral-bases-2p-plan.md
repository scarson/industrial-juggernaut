# Neutral Defending Bases for 2P — Implementation Plan

**Plan date:** 2026-05-28 (overnight)
**Status banner:** ⬜ Not started → 🚧 In progress → ✅ Complete.
**Overall status:** ⬜ Not started — Sam-greenlit directionally but gated on alliance work + tactical-depth sequencing (this is independent of both; can slot in whenever Sam picks it up).
**Authoritative inputs:**
- `2026-05-28-design-decisions-from-thought-exercises.md` — Sam confirmed try this BEFORE NPC alliances in 2P.
- `docs/2026-05-28-neutral-bases-2p-spec.md` — spec brainstorm with 5-axis design and rec.
- `docs/plans/2026-05-28-alliance-layer-plan.md` — pattern reference.

**Sequencing context:** independent of alliance + tactical depth. Best slotted in after variant (c) adopts (gives a clear "before vs after" measurement baseline). Could be done in parallel with tactical-depth work since they touch different parts of the engine.

## Spec summary

### What it is
Semi-randomly-placed neutral bases on the 2P board, defend-only. Inject *positional uncertainty* without committing to NPC alliances. From the spec doc, the v1 design:
- 4 neutral bases per 2P game (configurable).
- Symmetric placement (mirror across board centroid).
- Constraint set: not adjacent to player starting bases, not on iron, on-board, min distance from each other.
- Defend-only: never initiate attacks; defeated normally (≥3 attackers per combat table).
- No control disk (don't claim iron).
- Block sight lines (like any base).
- No factory generation, no resource production.
- No kill bounty when defeated.

### `RuleConfig` flags
- `neutralBasesIn2P: number` (default `0` = feature off; only applies in 2P games).

### `Base` extension
- `Base.owner` becomes `PlayerId | "neutral"` (union). Most existing code uses `b.owner === player`; that check naturally excludes neutrals. Some code branching on `b.owner` for indexing arrays may need updating.

## Phases

### Phase 1: Type plumbing + flag — ⬜ Not started
**Goal:** `Base.owner` accepts "neutral"; `neutralBasesIn2P` flag added; no behavior yet.

- [ ] Add `neutralBasesIn2P: number` (default 0) to `RuleConfig`.
- [ ] Change `Base.owner` from `PlayerId` to `PlayerId | "neutral"` in `src/engine/types.ts`.
- [ ] Find every site that does `b.owner === player` — these are correct (player is a number, "neutral" is a string; never equal).
- [ ] Find every site that indexes `arr[b.owner]` — branch on `typeof b.owner === "number"` before indexing.
- [ ] Run `npx tsc --noEmit` and address all type errors.
- [ ] Run full suite; defaults preserve behavior (no neutrals, no behavior change).
- [ ] Commit.

### Phase 2: Neutral placement at setup — ⬜ Not started
**Goal:** Setup CSP places N neutral bases in 2P games.

- [ ] Write failing test: when `neutralBasesIn2P: 4` and `nPlayers: 2`, after `setupGame` the board has 4 neutral bases.
- [ ] Test: neutrals are at least `MIN_DIST` from player starting bases (e.g. 6 hexes).
- [ ] Test: neutrals are at least `MIN_DIST` from each other (e.g. 4 hexes).
- [ ] Test: neutrals are NEVER on iron hexes.
- [ ] Test: in 3-6P games (`nPlayers !== 2`), no neutrals are placed regardless of flag.
- [ ] Test: deterministic — same seed produces same neutral placement.
- [ ] Implement a `placeNeutrals(board, playerStarts, iron, count, rng)` CSP. Constraints + retry budget.
- [ ] Wire into `setupGame` for 2P-only games.
- [ ] Full suite green.
- [ ] Commit.

### Phase 3: Control + visibility behavior — ⬜ Not started
**Goal:** Neutrals don't establish control; they DO block sight lines.

- [ ] Test: `control(state, playerId)` ignores neutrals (no disk contribution).
- [ ] Test: an iron hex adjacent to ONLY a neutral base is NOT controlled by any player (open game).
- [ ] Test: sight-line check (used for attack range, perimeter visibility) treats neutral bases as obstacles.
- [ ] Implement: `control()` filters by `b.owner === player` (already does); neutrals automatically excluded.
- [ ] Verify sight-line code in `src/geometry/sightline.ts` already treats all bases as blockers (likely already does — neutrals share the Base shape).
- [ ] Full suite green.
- [ ] Commit.

### Phase 4: Combat against neutrals — ⬜ Not started
**Goal:** Players attack neutrals like any base; defeated neutrals are removed; no bounty.

- [ ] Test: `legalActions` emits attacks targeting neutrals (subject to range/visibility).
- [ ] Test: combat resolution against a neutral defender uses standard combat table.
- [ ] Test: a defeated neutral base is removed from `state.bases`; no `basesInHand` change for the attacker (no bounty).
- [ ] Test: neutrals NEVER appear as attackers (legalActions doesn't emit attacks from `owner: "neutral"` bases — they have no turn).
- [ ] Implement: standard `applyAttack` already handles neutrals as defenders via shared Base structure (verify). Strip bounty for neutral-defender case in `applyEliminations` (neutrals aren't players, so they don't go through elimination — separate cleanup path).
- [ ] Full suite green.
- [ ] Commit.

### Phase 5: Turn order / phase exclusion — ⬜ Not started
**Goal:** Neutrals don't act, aren't in turn order, can't be eliminated as players.

- [ ] Test: `phase.order` never contains "neutral".
- [ ] Test: `applyEliminations` does NOT process neutrals (they're not in `state.players`).
- [ ] Test: `status()` ignores neutrals (last-standing check sees only player coalitions).
- [ ] Verify: `currentPlayer(state)` reads `phase.order[phase.indexInOrder]` which is always a `PlayerId` — neutrals can never appear.
- [ ] Full suite green.
- [ ] Commit.

### Phase 6: Comparison sweep — ⬜ Not started
**Goal:** measure how neutrals change 2P games.

- [ ] Build `src/sweep/compare-neutrals-2p.ts` comparing:
  - Baseline: `neutralBasesIn2P: 0` (off).
  - Variant: `neutralBasesIn2P: 4`.
  - Player counts: [2] only (mechanic is 2P-specific).
- [ ] Compare metrics: medianTurns, ironVictory, last-standing fraction, capHit.
- [ ] Run separately with greedy and (modest-budget) MCTS agents.
- [ ] Write `docs/2026-05-28-neutrals-2p-comparison.md`.
- [ ] Commit.

## Adversarial review (3 rounds)

**R1 — auto-elimination risk.** A neutral with no iron in its (nonexistent) disk doesn't get eliminated (it's not a player). But a player attacked TO ELIMINATION near a neutral... the neutral stays. Risks: stalemate where one player is cornered but un-attackable through neutrals. Mitigation: neutrals only count for sight blocking, not attack blocking — a base attacking THROUGH a neutral is still legal (sight-line blocking only prevents inferring opponent state, not the attack itself). Confirm this interpretation in Phase 4.

**R2 — does this address the "2P is too simple" problem?** Maybe. Adds positional uncertainty (board varies game-to-game) but no new strategic mechanics. If 2P games at variant (c) + neutrals still resemble 2P games at variant (c) without neutrals (just with extra obstacles), the mechanic adds little. Phase 6 sweep tells us.

**R3 — interaction with other variants.** Neutrals + noIronRequiresPerimeter (c) interact: a stranded player who can't reach iron because a neutral blocks the path is now in an even harder spot. The engine handles this correctly (pass + game continues), but it may make 2P games at variant (c) feel especially punishing for the player who gets the worse neutral layout. Worth measuring.

## Out of scope (follow-ups)

- Asymmetric placement (one player gets harder neutrals).
- Neutrals on iron hexes (would require capture mechanics + iron control transfer).
- Reinforcing neutrals.
- Reward for defeating neutrals.
- Multiple neutral tiers (small, medium, large).

## Open questions for Sam

- Default count (4 neutrals)?
- Sight-line blocking yes/no? Plan says yes; could be cleaner if no.
- Should defeating a neutral give the attacker +1 basesInHand? Plan says no (no bounty).
- Should neutrals start adjacent to each iron (variant: neutral-per-iron) so each iron is contested?

## Execution status — top-of-plan summary table

| Phase | Title | Status |
|---|---|---|
| 1 | Type plumbing + flag | ⬜ Not started |
| 2 | Neutral placement at setup | ⬜ Not started |
| 3 | Control + visibility behavior | ⬜ Not started |
| 4 | Combat against neutrals | ⬜ Not started |
| 5 | Turn-order/phase exclusion | ⬜ Not started |
| 6 | Comparison sweep | ⬜ Not started |
