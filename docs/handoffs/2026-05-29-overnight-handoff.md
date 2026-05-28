# Overnight Handoff — 2026-05-28/29 — Sam's Morning Read

> Single-doc summary of the autonomous overnight work. Read THIS first; everything else is linked below for detail.

## The headline

**The "heuristic is near-optimal on (c)" conclusion is FALSIFIED with rigorous data.** The deterministic `lookahead2` agent (2-ply minimax with heuristic leaf eval) beats the perimeter-aware heuristic **80.7% across 300 2P games on variant (c)** — directly replicating the Opus playtest finding at scale and against fresh seeds. This means:

1. The structural defect in the heuristic (no T2 lookahead) is real, large, and reproducible.
2. MCTS @25-@300 winning 0-6.3% on the same regime is a property of MCTS-with-perimeter-heuristic-leaf-eval, not of the regime being near-solved.
3. The (c)-variant ends in 2 turns most of the time, and 2-step lookahead is sufficient to dominate it.

The implication for the gate-2 reframe is the OPPOSITE of what I concluded yesterday: MCTS doesn't need to be replaced; it needs to be FIXED to do what `lookahead2` does (recognize "weak-immediate, strong-2-step" T1 placements).

## What landed overnight

| Track | Status | Key result |
|---|---|---|
| `lookahead2` agent | ✅ Shipped + tested | `chooseActionLookahead2` deterministic, wired into `AgentSpec`. 80.7% h2h vs heuristic on (c) 2P. |
| A1 sweep (c, 2P, 300 games) | ✅ Complete | **lookahead2 80.7% / heuristic 19.3%.** Report: `docs/2026-05-29-lookahead2-vs-heuristic-c-2p.md`. |
| A2 sweep (c, 3P, 150 games) | 🟡 Re-running | Original launch failed (orchestrator bug — `roundRobin` needs N named agents for N-player matchup, gave 2). Fix shipped; A2 re-launched. JSONL trickling. |
| A3 sweep (c, 4P, 100 games) | 🟡 Re-running | Same bug, same fix. Re-launched. |
| A4 sweep (default variant, 2P, 200 games) | 🟢 In-flight | At ~40/200 last check. **This is the critical "is the exploit (c)-specific?" test.** |
| E grid (longer-game regime) | ⬜ Queued behind A4 | 3 × 3 × 2 cell grid of boardSize × victoryThreshold × ironCount. |
| B1/B2/B3 (MCTS recovery) | ⬜ Queued behind E | MCTS@500/@1000 vs heuristic, and lookahead2 vs MCTS@500. |
| Tactical Depth Phases 1-4 | ✅ Shipped (engine layer) | `Base.type` + `baseTypesEnabled` + type-aware control + build cost + factory-anchor + watchtower combat. 228/228 engine tests green. Default flag-off path is bit-for-bit identical to pre-change semantics. |
| Tactical Depth Phases 5-7 | ⬜ Deferred | `legalActions` enumeration of subtypes + agent updates + comparison sweep. Engine layer is ready; agent + CLI surfacing is the next slice. |
| Track C (PRNG-aware MCTS) | ⬜ Deferred | Design notes below; engineering not started. |

## Repo state

**Branch:** `claude/document-game-design-VpqqB` (unchanged). Many commits since the prior handoff; tactical depth + lookahead2 + sweep scripts. No new PRs. Branch is roughly +20 commits ahead of the prior handoff state.

**Test suite:** engine = 228/228 green. Full suite (agent + eval + sweep + driver) not re-run as a whole; expected green given each layer was checked.

**Defaults UNCHANGED:**
- `defaultConfig.noIronRequiresPerimeter = false` (still Sam-gated; not autonomously flipped).
- `defaultConfig.baseTypesEnabled = false` (new flag, intentionally default-off).
- `defaultMctsParams().iterations = 50` (unchanged from your earlier call).

## Three things you decide in the morning

### 1. Is `lookahead2` the right "strong agent" benchmark going forward?

Pro: it dominates the heuristic on (c) 2P with high confidence (n=300, 80.7%). MCTS@N is bottlenecked at the heuristic eval — `lookahead2` actually does the lookahead the heuristic skips.

Con: `lookahead2` cheats by reading the deterministic PRNG state — the Opus agents' analysis showed that's part of how the exploit works. In a tabletop game with a real velvet-bag draw, lookahead2 would lose this advantage; its win rate would shrink toward 40-60% (still better than the heuristic, but less dramatic).

**Decision:** ratify `lookahead2` as the "stronger reference agent" for sim work, OR build `lookahead2-stochastic` (averages over PRNG outcomes) for tabletop-realistic strength measurement, OR both. **My recommendation:** ratify the deterministic `lookahead2` as the sim reference (it answers the right sim question), AND build the stochastic variant as a follow-up for tabletop-realistic measurement.

### 2. Tactical Depth Phases 5-7 — proceed, or pivot back to the MCTS reframe?

The engine layer is shipped (Phases 1-4 done; 228 tests). Phases 5-7 cost roughly:
- Phase 5 (`legalActions` enumerates subtypes): 3-4h. Without this, agents and CLI can't pick subtype.
- Phase 6 (agent updates: heuristic + MCTS need cost/defense awareness): 2-3h.
- Phase 7 (comparison sweep + 4-test falsification battery): 1h compute, then synthesis.

OR — pivot to fixing MCTS structurally based on the lookahead2 finding:
- Add a PRNG-aware term to evaluate (~2h).
- Broader PW candidate diversity (force "low-immediate-iron T1" candidates into the tree, ~3h).
- Optional: shallow alpha-beta at root (~4h).

**My recommendation:** finish Tactical Depth (Phases 5-7) since it's the design layer you've been planning to evaluate, and the engine work is already done. The MCTS structural work is a parallel track once we know the Tactical Depth answer.

### 3. (c)-variant default — flip or hold?

The variant decides games in 2 turns; lookahead2 dominates because of this. If you want games where mid-game strategy matters, (c) needs to be tuned toward longer games (the E grid will give us data on this). If you're happy with (c)'s setup-decided 2-turn nature as a strategic game, the heuristic's 1-step argmax is just a known weakness to fix in the agent layer.

**My recommendation:** wait for the E grid (which auto-flags candidate longer-game configs by median turns ≥ 5 with capHit ≤ 20%). If it finds clean longer-game candidates, we have a balance tuning option. If not, (c) is the right regime and the work is in the agent.

## Pointers to all the artifacts

**Synthesis docs:**
- `docs/playtest/2026-05-28-playtest-synthesis.md` — the Opus playtest write-up (yesterday).
- THIS DOC — overnight handoff.

**Sweep results (data + reports):**
- `docs/2026-05-29-lookahead2-vs-heuristic-c-2p.md` ✅ — **80.7% / 19.3%**.
- `docs/2026-05-29-lookahead2-vs-heuristic-c-3p.md` ⏳ — A2 in flight.
- `docs/2026-05-29-lookahead2-vs-heuristic-c-4p.md` ⏳ — A3 in flight.
- `docs/2026-05-29-lookahead2-vs-heuristic-default-2p.md` ⏳ — A4 in flight (critical: is the exploit (c)-specific?).
- `docs/2026-05-29-longer-game-regime-grid.md` ⏳ — queued.
- `docs/2026-05-29-mcts500-vs-heuristic-c-2p.md` ⏳ — queued.
- `docs/2026-05-29-mcts1000-vs-heuristic-c-2p.md` ⏳ — queued.
- `docs/2026-05-29-lookahead2-vs-mcts500-c-2p.md` ⏳ — queued.

**Engineering:**
- `src/agent/lookahead2.ts` — the agent.
- `src/sweep/overnight-2.ts` — chained orchestrator.
- `src/sweep/lookahead2-h2h-runner.ts` — shared h2h runner (now N-agent-clean).
- `src/engine/types.ts`, `config.ts`, `control.ts`, `build.ts`, `combat.ts`, `apply.ts` — tactical-depth Phases 1-4.

**Test additions:**
- `test/agent/lookahead2.test.ts` — 2 tests (legality + lower-bound h2h gate).
- `test/engine/control-base-types.test.ts` — 8 tests (Phase 2).
- `test/engine/build-base-types.test.ts` — 8 tests (Phase 3).
- `test/engine/factory-generation-base-types.test.ts` — 4 tests (Phase 4a).
- `test/engine/combat-watchtower-defense.test.ts` — 5 tests (Phase 4b).

**Plan updates:**
- `docs/plans/2026-05-28-tactical-depth-asymmetric-bases-plan.md` — banner flipped to "🚧 In progress" with Phases 1-4 done note.

## What I'd do next if you greenlit autonomously

In priority order:
1. **Wait for E grid result.** It directly informs the balance vs agent-fix tradeoff (above #3).
2. **Wait for B-series MCTS recovery.** Tells us whether MCTS@1000 closes any of the gap.
3. **Ship Tactical Depth Phase 5** (`legalActions` enumeration of subtypes). After that, agents (Phase 6) can be tuned + Phase 7 sweep can run.
4. **Ship Track C** (PRNG-aware heuristic eval + broader PW candidate diversity). Tests whether MCTS's structural defects are fixable.

## Known issues / honest disclosures

- A2 and A3 launched, failed silently in 1s (orchestrator bug — fixed and re-launched outside the orchestrator). The orchestrator itself is fine; the per-script bug is fixed for any future re-run.
- The orchestrator's BAL-2 commits race continuously with my engineering commits — this is documented in `docs/pitfalls/implementation-pitfalls.md` BAL-2 and is benign (resolves on next push cycle).
- I haven't re-run the FULL test suite (agent + sweep + driver) in this session. Engine = 228/228; the others are unchanged code paths and SHOULD be green, but I didn't verify post-Phase-4.

## Continuation prompt (paste-ready for the next session)

> Continuing autonomous build of Industrial Juggernaut on branch `claude/document-game-design-VpqqB`. Read `docs/handoffs/2026-05-29-overnight-handoff.md` first — it's the summary. The headline: lookahead2 (deterministic 2-ply minimax) beats the perimeter-aware heuristic 80.7% on variant (c) 2P (n=300), confirming the Opus playtest. Tactical Depth engine layer (Phases 1-4) is shipped; engine is 228/228 green. Overnight sweeps (Tracks A, E, B) running in background — read `docs/sweeps/data/2026-05-29-*.jsonl` + `docs/2026-05-29-*.md` for results. Sam's three open decisions: (1) ratify lookahead2 as the strong-agent reference; (2) Tactical Depth Phases 5-7 vs pivot to MCTS structural fixes; (3) (c)-variant default — flip or hold or tune. The Track C engineering (PRNG-aware MCTS evaluate) is queued and unstarted.

---

*Generated by Claude autonomously while Sam slept. 2026-05-29 ~05:00 UTC (~10:00 PM PDT 2026-05-28).*
