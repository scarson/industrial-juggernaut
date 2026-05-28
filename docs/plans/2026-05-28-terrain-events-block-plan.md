# Board-Terrain Manipulation (Block) — Implementation Plan

**Plan date:** 2026-05-28 (overnight)
**Status banner:** ⬜ Not started → 🚧 In progress → ✅ Complete.
**Overall status:** ⬜ Not started — Sam's "block a non-iron tile" lever, directionally greenlit. Independent of alliance + tactical-depth work; can slot in opportunistically.
**Authoritative inputs:**
- `2026-05-28-design-decisions-from-thought-exercises.md` — Sam: "Take that as 'board terrain manipulation, generally'."
- `docs/2026-05-28-terrain-events-spec.md` — spec with 5 flavors; recommended starting with "Block" (Sam's example).
- `docs/plans/2026-05-28-alliance-layer-plan.md` — pattern reference.

**Sequencing context:** independent of variant adoption + alliance/tactical work. Could be implemented in parallel; recommend sequencing after the alliance comparison data lands so we don't stack measurement variables.

## Spec summary

### What "Block" is
Each player gets N blocks per game. A block converts an on-board non-iron hex into a "blocked" tile — no one can place a base there for the rest of the game. The block doesn't affect sight lines (purely a placement restriction) and doesn't grant control. The action consumes the player's round (like build/attack).

### `RuleConfig` flags
- `terrainBlocksPerGame: number` (default `0` = feature off; values >0 enable, give each player that many blocks).

### `GameState` extension
- New field: `state.blockedHexes: Set<string>` — set of canonical hex keys (GEO-4) that are blocked.

### `Player` extension
- New field: `blocksRemaining: number` — initialized to `config.terrainBlocksPerGame` in `setupGame`, decremented on each successful block action.

### New `Action`
- `{ kind: "block-terrain"; hex: Hex }` — block the given hex. Legal iff: `terrainBlocksPerGame > 0`, actor has `blocksRemaining > 0`, hex is on-board, hex is NOT iron, hex is NOT already blocked, hex is NOT within actor's placeRange of any of actor's bases (anti-self-foot-shot — prevents accidentally blocking your own expansion path).

## Phases

### Phase 1: State + flag — ⬜ Not started

- [ ] Add `terrainBlocksPerGame: number` (default 0) to `RuleConfig`.
- [ ] Add `blockedHexes: Set<string>` to `GameState`. (Serialization note: Sets don't JSON-serialize natively. If serialized through the worker boundary, convert to `string[]` and back. Already a pattern from `Control.hexes`.)
- [ ] Add `blocksRemaining: number` to `Player`, init in `setupGame` from config.
- [ ] Add `{ kind: "block-terrain"; hex: Hex }` to Action union; wire stubs in apply/score/mcts switches (throw "not yet implemented").
- [ ] Full suite green.
- [ ] Commit.

### Phase 2: legalActions emits block — ⬜ Not started

- [ ] Tests:
  - Flag off (default): no block actions emitted.
  - Flag on + `blocksRemaining = 0`: no block actions.
  - Flag on + `blocksRemaining > 0`: block actions emitted for every on-board, non-iron, non-blocked, NOT-in-own-placeRange hex.
  - Anti-self-foot-shot test: a block action targeting a hex within actor's placeRange is NOT emitted.
- [ ] Implement extension in `legalActions`.
- [ ] Full suite green.
- [ ] Commit.

### Phase 3: applyAction for block-terrain — ⬜ Not started

- [ ] Tests:
  - Successful block: hex added to `state.blockedHexes`; actor's `blocksRemaining` decremented by 1.
  - Idempotent: blocking the same hex twice (across calls) — no double-decrement (legal-actions wouldn't emit, but defensive).
  - Throws when not legal.
- [ ] Implement.
- [ ] Full suite green.
- [ ] Commit.

### Phase 4: Build legality excludes blocked hexes — ⬜ Not started

- [ ] Tests:
  - A hex in `blockedHexes` is rejected by `isLegalBasePlacement`.
  - A hex in `blockedHexes` is rejected by `isLegalFactoryPlacement`.
  - These checks fire regardless of `terrainBlocksPerGame` (the SET being populated is what matters; flag controls whether it can grow).
- [ ] Update build-legality checks to reject blocked hexes.
- [ ] Full suite green.
- [ ] Commit.

### Phase 5: Agent updates — ⬜ Not started

- [ ] Heuristic and MCTS agents handle the new action shape (default behavior: ignore strategically; rely on samplePolicy fallback if it's the only option).
- [ ] Smoke test: a game with `terrainBlocksPerGame: 2` runs to completion without crashing.
- [ ] Commit.

### Phase 6: Comparison sweep — ⬜ Not started

- [ ] Build `src/sweep/compare-terrain-blocks.ts`:
  - Variants: `terrainBlocksPerGame ∈ {0, 1, 2, 3, 4}`.
  - Both 2P and 3P games.
- [ ] Use a scripted "block-eager" agent (always blocks on first turn against opponent's expansion path) in addition to heuristic, since heuristic won't pursue blocks strategically.
- [ ] Generate `docs/2026-05-28-terrain-blocks-comparison.md`.
- [ ] Commit.

## Adversarial review

**R1 — Will heuristic ever actually use the block action?** Unlikely — `samplePolicy` doesn't have a block-scoring path. The action might only appear in samplePolicy's fallback (when no other actions are available, which is rare). So with heuristic agents, terrain blocking will be near-zero use. **Mitigation:** Phase 6 uses a scripted "block-eager" agent.

**R2 — Does the anti-self-foot-shot rule have edge cases?** A player with bases on a tiny board may not be able to block ANY hex (everything is within own placeRange). Plan: gracefully no-op (no block actions emitted); player doesn't waste their action attempting an impossible block.

**R3 — Interaction with variant (c) noIronRequiresPerimeter.** A stranded radiating player (0 iron, spared from elimination) who CAN block could use their block to deny opponent expansion. That's a legitimate desperate move. But they also have no other moves so blocking is effectively their only useful action. Worth observing in sweep.

## Out of scope

- Multi-purpose terrain types ("rubble" vs "forest" vs "highway").
- Sight-line blocking by terrain (v1 = placement-only).
- Terrain that affects combat (e.g., +1 defense on a fortified hex).
- Time-decay of terrain (blocks lasting for N turns then expiring).

## Open questions

- Default count (2 blocks per player)?
- Should blocks block sight lines too? Plan says NO for v1.
- Should blocks have a strategic "reveal" (placed face-down)? Plan says NO for v1.

## Execution status — top-of-plan summary table

| Phase | Title | Status |
|---|---|---|
| 1 | State + flag | ⬜ Not started |
| 2 | legalActions emits block | ⬜ Not started |
| 3 | applyAction for block-terrain | ⬜ Not started |
| 4 | Build legality excludes blocked hexes | ⬜ Not started |
| 5 | Agent updates | ⬜ Not started |
| 6 | Comparison sweep | ⬜ Not started |
