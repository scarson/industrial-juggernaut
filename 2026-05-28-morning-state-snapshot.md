# Morning State Snapshot — 2026-05-28

**For Sam, on waking. 60-second read.** Full state is in `docs/handoffs/2026-05-27-session-handoff.md`; this is the executive summary.

## What changed overnight (in plain English)

**Engine work shipped:**
- **Alliance layer Phases 1-6 implemented** (Phase 7 sweep script ready, deferred). Engine flags `alliancesEnabled` + `allianceVictoryDelta`; ally + break-alliance actions; anti-coalition victory threshold scaling; cooldown decrement at turn rollover. 196 engine tests green.
- **Gate recalibration for MCTS regime implemented** as `mctsHealthThresholds()` — the relaxed thresholds appropriate for evaluating under strong agents (variant (c) regime).
- **All three variant flags (a/b/c) from the earlier comparison experiment** remain shipped (engine-implemented) from yesterday — still default-off; variant (c) is the one you greenlit for adoption.

**Compute in flight:**
- **MCTS@300 stress test on variant (c)** is running. Probably needs ~1-1.5 more hours when you wake. Result lands at `docs/2026-05-28-mcts-300-on-c.md`. Tests whether MCTS@100's h2h loss to heuristic was a search-depth issue or structural.

**Compute queued:**
- **Alliance Phase 7 sweep** (`src/sweep/compare-alliance-deltas.ts`) — measures alliance delta effects. Auto-runs when MCTS@300 finishes.
- **Legal-action profile** (`src/sweep/profile-turn-complexity.ts`) — measures per-turn decision complexity to inform the wall-clock question.

**Plans + specs queued for your future greenlight (default-off discipline; nothing implemented without your sign-off):**
- Tactical depth (asymmetric base types: Forge/Watchtower/Outpost).
- Neutral defending bases for 2P.
- Board-terrain manipulation (Block flavor).
- Concession mechanic.

**Other docs added:**
- **Design ladder** (`2026-05-28-design-ladder.md`) — bird's-eye status of all 14 design levers; recommend reading early.
- **Pre-playtest preparation** (`2026-05-28-pre-playtest-preparation.md`) — what the 2-week-out playtest must answer, recommended scenarios, prerequisites.
- **PR-merge strategy** (`docs/plans/2026-05-28-pr-merge-strategy.md`) — three-PR chunked approach recommended for the branch.
- **Variant flags summary** (`2026-05-28-variant-flags-summary.md`) — quick reference for every RuleConfig flag.

## Decisions you need to make (in priority order)

1. **Flip `noIronRequiresPerimeter: true` in `defaultConfig()`?** You greenlit this directionally; just need a final "yes, do it now." Small audit of tests that encode the old behavior to follow.
2. **Read the MCTS@300 result when it lands.** If MCTS@300 wins h2h (or comes close), the agent is fine and we just need higher iterations in the arena. If MCTS@300 still loses, the heuristic is genuinely near-optimal and we need a different agent improvement direction.
3. **Pick a follow-up:** of the four design plans queued (tactical depth, neutral 2P bases, terrain blocks, concession), which goes next? My recommendation: alliance Phase 7 sweep data → adopt-validate-then-add (so tactical depth after alliances are validated).
4. **PR strategy:** three-PR or one-big-PR for the branch? Three-PR recommended; full strategy in `docs/plans/2026-05-28-pr-merge-strategy.md`.

## Branch state

- `claude/document-game-design-VpqqB` — all work pushed; everything committed.
- `origin/main` still at PR #10 (72944bb). Nothing merged.
- Engine tests: 196 green at last full run. The subset suite (engine + sweep + eval + driver) was just confirmed at 294 green; full suite (including MCTS tests) will be re-verified once MCTS@300 frees the cores.

## Watching for issues

The wider-grid validation run crashed silently mid-cell-#2 last night. Root cause unknown (likely a GamePool worker-death race), but the resilient `compare-variants.ts` pattern works fine; just this script's `explore-c-variant.ts` didn't have the per-job try/catch. Documented as a known issue; the cell-#1 data we have is enough.

## Continuation prompt (if a fresh agent picks this up)

> Read `docs/handoffs/2026-05-27-session-handoff.md`, then `2026-05-28-design-decisions-from-thought-exercises.md` (Sam's directional answers — authoritative). The alliance layer engine is shipped (Phases 1-6); Phase 7 sweep script exists but is not launched. MCTS@300 stress test is running. After MCTS@300 finishes: launch the alliance Phase 7 sweep, then the profile script, then a full suite re-run including MCTS tests. Do NOT change `defaultConfig` or implement new mechanics without Sam's explicit greenlight. Plans for the next design layers (tactical depth, neutral 2P bases, terrain blocks, concession) are in `docs/plans/2026-05-28-*-plan.md`.

That's the state. Coffee, then decisions in order above.
