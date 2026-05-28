# Tactical Depth — Asymmetric Base Types — Implementation Plan

**Plan date:** 2026-05-28 (overnight)
**Status banner:** ⬜ Not started → 🚧 In progress → ✅ Complete. Phases below carry their own banners.
**Overall status:** ⬜ Not started — gated on alliance layer validation per Sam's serial sequencing (adopt → validate → next layer).
**Authoritative inputs:**
- `2026-05-28-design-decisions-from-thought-exercises.md` — Sam's decisions: asymmetric role types (NOT literal RPS cycle); also-in-scope: mid-game events (separate plan).
- `docs/2026-05-28-terrain-events-spec.md` — companion lever; orthogonal mechanic, separate plan.
- `docs/2026-05-28-design-followups-alliances-and-tactical-depth.md` §Tactical depth — spec brainstorm + 4-test verification methodology.
- `docs/plans/2026-05-28-alliance-layer-plan.md` — pattern reference (TDD discipline, default-off flag, phased structure).

**Sequencing context:** Per the adopt-validate-then-add discipline, this implementation does NOT begin until:
1. Variant (c) is formally adopted as default.
2. Alliance layer is validated (Phase 7 sweep complete + Sam reviews data).
This plan is QUEUED — written so it's ready to execute when those gates clear.

## Spec summary — the design

### What asymmetric base types means
Bases gain a `type: BaseType` field where `BaseType = "forge" | "watchtower" | "outpost"`. Each type has different control/build/combat properties:

| Type | Control radius | Build cost (resources) | Combat profile | Factory generation |
|---|---|---|---|---|
| **forge** | `config.radius` (default 5) | 1 | standard (1 defender) | YES (current default behavior — factories build within disk) |
| **watchtower** | `config.radius + 2` (e.g. 7 at default) | 2 | +1 defense (combat-table effectively −1 attacker for kills) | NO |
| **outpost** | `max(2, config.radius - 2)` (e.g. 3 at default) | 0.5 (rounds down — bootstrap context only OR free at certain rates) | standard | NO |

Asymmetric *roles*, NOT a literal RPS cycle. Each has a niche:
- **Forge** = the workhorse (factory generator, standard radius). Current default behavior; existing bases become `forge`s.
- **Watchtower** = the perimeter-extender (large disk, defensive, no factory). Use for territory claims and choke-point control.
- **Outpost** = the cheap spreader (small disk, free-ish, no factory). Use for fast territory grab.

### `RuleConfig` flag
`baseTypesEnabled: boolean` (default `false`). When false, the engine's existing behavior is preserved bit-for-bit; all bases are implicitly `forge` (with the existing `Base` interface unchanged in behavior). When true, `Base.type` is materially considered by `control()`, build legality, combat, and factory generation.

### Out of scope for v1
- Mobility (bases don't move).
- Type conversion (you can't upgrade a forge to a watchtower).
- More than 3 types.
- Per-player-asymmetric type allowances.

## Phases

Each phase ends with: a commit, status banner update, and a "Discoveries" entry.

### Phase 1: Engine flag + Base.type field — ⬜ Not started
**Goal:** plumb the new field through types and config; default behavior preserved.

- [ ] Add `baseTypesEnabled: boolean` (default false) to `RuleConfig` in `src/engine/config.ts`.
- [ ] Add `type BaseType = "forge" | "watchtower" | "outpost"` to `src/engine/types.ts`. Add optional `Base.type?: BaseType` (optional for backwards compat; default = "forge" when undefined OR when `baseTypesEnabled` is false).
- [ ] In `setupGame` and any base-creating code path, populate `type: "forge"` for existing bases (mechanical no-op).
- [ ] Run `npx tsc --noEmit` and fix any test fixtures that construct `Base` literals without the new optional field.
- [ ] Full test suite green.
- [ ] Commit `feat(engine): Base.type field + baseTypesEnabled flag (no behavior change)`.

### Phase 2: Type-aware `control()` — ⬜ Not started
**Goal:** when `baseTypesEnabled`, each base uses its type's control radius.

- [ ] Write failing tests in `test/engine/control.test.ts`: 
  - A single watchtower base (radius +2) controls more hexes than a forge at same position when flag is on.
  - A single outpost base (radius -2) controls fewer hexes than a forge.
  - When flag is OFF, all bases use `config.radius` regardless of type (default behavior).
  - Mixed-type bases on one player: union of disks at respective radii.
- [ ] Modify `control()` to consult `base.type` when `state.config.baseTypesEnabled`, using a `radiusFor(type, config)` helper.
- [ ] Verify perimeter-regime (4+ bases) still uses convex hull (no type-specific perimeter change in v1 — KISS).
- [ ] Full test suite green.
- [ ] Commit `feat(engine): type-aware control radius (watchtower +2, outpost -2 when flag on)`.

### Phase 3: Type-aware build cost — ⬜ Not started
**Goal:** `buildBudget` and build legality consider type costs.

- [ ] Write failing tests in `test/engine/build.test.ts`:
  - A player with `buildBudget = 1` can build one forge (cost 1) OR two outposts (cost 0.5 each rounded — actually, simpler v1: outpost cost 1 with a 50% rebate on resourceCount? Or fractional via "every 2nd outpost is free"?).
  - **Design decision**: model outpost cost as 1 resource per 2 placed in the same round (integer math). So buildBudget=1 → 1 forge OR 2 outposts. buildBudget=2 → 2 forges OR 4 outposts OR 1 forge + 2 outposts.
  - Watchtower cost 2: buildBudget=1 → NO watchtower legal. buildBudget=2 → 1 watchtower.
- [ ] Update `buildBudget` to compute per-piece capacity correctly for mixed-type builds.
- [ ] Update `isLegalBasePlacement` to also check the type-cost can be paid.
- [ ] Update `Action.build.pieces` to carry the base's type: `pieces: { type: "factory"; hex: Hex } | { type: "forge" | "watchtower" | "outpost"; hex: Hex }[]`.
- [ ] Full test suite green.
- [ ] Commit `feat(engine): type-aware build cost (forge:1, watchtower:2, outpost:0.5)`.

### Phase 4: Type-aware factory generation + combat — ⬜ Not started
**Goal:** Only forges generate factories; watchtowers have +1 defense.

- [ ] Tests for factory-build legality: factory can only be built within a forge's control disk (NOT watchtower/outpost only). If a player has only watchtowers + outposts in range, no factory builds are legal.
- [ ] Test for combat: a watchtower defender survives at combat-table[N-1] outcomes (effectively +1 attacker required).
- [ ] Implement: `isLegalFactoryPlacement` checks at least one in-range base is a forge.
- [ ] Implement: `resolveCombat` consults defender's `base.type` for the watchtower defense bonus.
- [ ] Full test suite green.
- [ ] Commit `feat(engine): type-aware factory generation + watchtower combat bonus`.

### Phase 5: `legalActions` enumerates types — ⬜ Not started
**Goal:** when flag is on, `legalActions` emits separate build actions for each viable type.

- [ ] Tests: a player with buildBudget=2 has legal builds for forge, watchtower, AND outpost (where geometry permits).
- [ ] Implement: the existing single-piece build enumeration branches on type.
- [ ] Full test suite green.
- [ ] Commit `feat(engine): legalActions enumerates base types under flag`.

### Phase 6: Agent updates — ⬜ Not started
**Goal:** heuristic doesn't crash on the expanded action space; samples each type as candidate.

- [ ] heuristic.ts samplePolicy: extend `sampleBuild` loop from `["factory", "base"]` to include "forge", "watchtower", "outpost" as separate base subtypes when flag is on. (Currently it loops over `["factory", "base"]`; the "base" branch would now expand to three subtypes.)
- [ ] MCTS via fixedCandidates + samplePolicy fallback should handle the expanded set automatically.
- [ ] Smoke test: a heuristic game with `baseTypesEnabled: true` runs to completion without crashing.
- [ ] Full test suite green.
- [ ] Commit `feat(agents): handle new base types under baseTypesEnabled (sample all 3 subtypes)`.

### Phase 7: Comparison sweep + 4-test falsification battery — ⬜ Not started
**Goal:** measure whether asymmetric types add real tactical depth or just complexity (the Sam-flagged risk).

- [ ] Build `src/sweep/compare-base-types.ts` running:
  - **Variant 1:** baseline (flag off) — control.
  - **Variant 2:** flag on, "all-forge" strategy enforced (scripted agent only builds forges) — should resemble baseline.
  - **Variant 3:** flag on, "all-watchtower" strategy.
  - **Variant 4:** flag on, "all-outpost" strategy.
  - **Variant 5:** flag on, free choice (heuristic picks).
- [ ] Per the 4-test methodology in the design-followups doc:
  - **Multi-strategy convergence:** does any pure mix dominate? If forge-only beats all others everywhere, types are window-dressing.
  - **Context-dependence:** does the best mix vary across board sizes / iron counts?
  - **Counter-strategy:** does MCTS adapt mix in response to opponent's commitment?
  - **Per-decision impact:** how often does the type choice actually change a game's outcome?
- [ ] Write `docs/2026-05-28-base-types-comparison.md` with the results AND an adversarial-Opus-review section assessing "did this add depth or complexity?"
- [ ] Commit + push.

## Adversarial review (3 rounds)

**R1 — naive-fresh-agent ambiguity.** "Outpost cost 0.5" — TypeScript can't represent half-integers cleanly in buildBudget arithmetic. Decision: model as "1 outpost per 0.5 buildBudget = 2 outposts per buildBudget point." Plan now explicit at Phase 3.

**R2 — interaction with existing flags.** `baseTypesEnabled: true` + `victoryIronRequiresPerimeter: true` (variant a/P3) + `noIronRequiresPerimeter: true` (variant c). Watchtowers have NO factory generation but DO contribute to perimeter (≥4 base count). A "perimeter of all watchtowers" produces no factories — strategically interesting but functionally bare. Verify perimeter regime works correctly with watchtower-only hulls.

**R3 — false-positive depth assertion risk.** The 4-test battery is necessary; if Phase 7 shows pure-forge wins everywhere and ≥80% of decisions are type-irrelevant, the feature is COMPLEXITY-WITHOUT-DEPTH and should be REVERTED behind a flag. Add an explicit "failure verdict" criterion in Phase 7: if the data shows this, write a NEGATIVE conclusion and DON'T recommend adoption.

## Out of scope (deferred follow-ups)

- Mobility (movable bases).
- More than 3 types.
- Type "upgrades" (forge → fortified-forge).
- Asymmetric per-player type rosters.
- Type-aware MCTS heuristic weights (extension of `HeuristicWeights` to differentiate base types in evaluation). Defer until comparison sweep shows depth.

## Open questions for Sam

- Exact build costs: forge 1, watchtower 2, outpost 0.5 — are these the right ratios, or should outpost be free (0) and watchtower be 3? Comparison sweep can test alternatives.
- Watchtower combat bonus: +1 attacker required (effective +1 defender) — or a different bonus type (e.g., immunity to combat for first attack)?
- Should outposts have a base-count cap (e.g., max 3 outposts per player) to prevent outpost-spam?

## Discoveries log

*(empty — phases haven't run yet)*

## Execution status — top-of-plan summary table

| Phase | Title | Status |
|---|---|---|
| 1 | Engine flag + Base.type field | ⬜ Not started |
| 2 | Type-aware control() | ⬜ Not started |
| 3 | Type-aware build cost | ⬜ Not started |
| 4 | Type-aware factory generation + combat | ⬜ Not started |
| 5 | legalActions enumerates types | ⬜ Not started |
| 6 | Agent updates (heuristic + MCTS compatibility) | ⬜ Not started |
| 7 | Comparison sweep + 4-test falsification battery | ⬜ Not started |
