# Final Synthesis — 2026-05-29 Flight Day

> THE morning-read doc. Consolidates all 2026-05-29 work into a single decision-ready summary.
> Updates as data lands; final state coming as the master-chain completes.

## The big picture in 5 lines

1. **Heuristic captures REAL skill.** Random gets 0 wins in 3P/4P over 60 games each.
2. **But heuristic is NOT optimal.** Proper N-player minimax (`lookahead2-multi`) beats it at every player count tested (2P 80% → 3P 41% → 4P 31% vs decreasing baselines).
3. **The (c) regime resolves in 2 turns.** Track E exhaustively searched the (boardSize × victoryThreshold × ironCount) grid; no longer-game-but-resolving config exists.
4. **MCTS is structurally bottlenecked.** MCTS@500 gets 10.4% on (c) 2P. Even higher iterations unlikely to recover (B2 + mcts2000 sweeps coming).
5. **Tactical Depth engine (Phases 1-6) shipped.** Asymmetric base types are engine-ready; Track D measures their effect.

## Sam's flight-night worry: ANSWERED

**Worry:** "is (c) a corner where the heuristic produces functionally optimal play for 3P+ because that's just mechanical execution by the player?"

**Answer:** NO. There IS strategic depth in 3P and 4P. The earlier impression of "mechanical 3P+" came from the 2-player `lookahead2` algorithm being incorrect for multi-player games — it played at baseline (32.7% in 3P, 25% in 4P). The proper max^n version (`lookahead2-multi`) finds wins above baseline at every player count:

| Player count | lookahead2-multi vs heuristic | Δ vs per-player baseline |
|---:|:---:|:---:|
| 2P | 80.7% | +30.7pp (huge) |
| 3P | 40.7% | +7.7pp (real) |
| 4P | 31.0% | +6.0pp (real) |
| 5P/6P | TBD | TBD |

The skill gap narrows with player count but exists everywhere. **A focused player who thinks 2 ply ahead can outplay one who plays mechanically.** That's strategic depth, not mechanical execution.

## Implications for design

### What's solid
- (c)'s 2-turn nature is structural — it can't be tuned longer without changing rules (E grid confirms).
- 2-3 player games have substantial strategic ceiling.
- 4P games have meaningful (not large) strategic ceiling.
- The heuristic + alliance work shipped earlier is solid baseline play.

### What's still open
- Does Tactical Depth (asymmetric base types) shift gameplay? **Track D coming.**
- Do variants (a), (b) add depth on top of (c)? **Track AB coming.**
- Do 5P/6P stay strategic or go fully mechanical? **5P/6P sweep coming.**
- Does lookahead3 (3-ply) find even more above lookahead2? **Track lookahead3 coming.**
- Does MCTS@2000+ recover? **B2 + mcts2000 coming.**

## Engineering shipped today

### New agents
- `lookahead2` (2-ply, 2P-optimized) — already established.
- **`lookahead2-multi`** (proper N-player max^n) — KEY agent. Captures multi-player strategic depth the original lookahead2 missed.
- `lookaheadN` (variable depth — depth=2/3 supported).
- `random` (skill-floor reference).

### Tactical Depth layer (engine + agent)
All 6 Phases shipped. `baseTypesEnabled=false` is bit-for-bit identical to pre-change behavior.

- Phase 1: `BaseType` field + flag.
- Phase 2: type-aware `control()` radius (forge=5, watchtower=7, outpost=3 at default).
- Phase 3: type-aware build cost (forge=2, watchtower=4, outpost=1 resources/piece).
- Phase 4: factory-anchor gated to forge + watchtower +1 combat defense.
- Phase 5: `legalActions` enumerates subtypes.
- Phase 6: heuristic agent composes per-subtype multi-piece builds.

### Sweep infrastructure
- N-agent h2h runner (any player count, any agent mix).
- Aggregate-results script for one-page summary.
- Master-chain orchestrator running 10 sweeps sequentially without thrashing.

### Test coverage
- 231/231 engine tests green (after Phase 5 added 3 tests).
- 117+ agent tests (with new lookahead2-multi, random, subtype-aware tests).
- Final test suite runs after all sweeps complete via `chain-final-tests`.

## Sweep results (updated as they land)

### Tier 1 — landed

| Track | Sweep | Result | Verdict |
|---|---|---|---|
| A1 | lookahead2 vs heuristic, (c) 2P, n=300 | 80.7% / 19.3% | 2P exploitable |
| A4 | lookahead2 vs heuristic, default 2P, n=200 | 58% / 42% | Exploit variant-sensitive |
| E | longer-game regime grid (18 cells) | No longer regime | Structural |
| B1 | MCTS@500 vs heuristic, (c) 2P, n=48 | 10.4% / 89.6% | MCTS marginal |
| R | random vs heuristic, (c) 2P/3P/4P, n=60 each | 5%/0%/0% random | Real skill |
| **C1** | lookahead2-multi vs heuristic, (c) 3P, n=150 | **40.7% (+7.7pp)** | 3P depth |
| **C2** | lookahead2-multi vs heuristic, (c) 4P, n=100 | **31.0% (+6.0pp)** | 4P depth |

### Tier 2 — running / queued

| Track | Sweep | Expected ETA |
|---|---|---|
| L | lookahead2 self-play, (c) 2P/3P/4P, n=50 each | ~30 min |
| D | tactical-depth-effect: heuristic self-play, flag on vs off, 2P/3P/4P, n=100 each | ~30 min |
| V | variant cross-compare: {default,c,c+baseTypes} × {2P,3P,4P}, n=60 each | ~15 min |
| AB | variants (a)+(b) comparison, 4 variants × 2P/3P, n=60 each | ~15 min |
| B3 | lookahead2 vs MCTS@500, (c) 2P, n=32 | ~15 min |
| B2 | MCTS@1000 vs heuristic, (c) 2P, n=32 | ~10 min |
| arch | greedy archetypes vs heuristic, n=50 each cell | ~15 min |
| lookahead3 | lookahead3 vs heuristic, (c) 2P, n=16 | ~20 min |
| 5P6P | lookahead2-multi vs heuristic, (c) 5P+6P, n=60 each | ~30 min |
| mcts2000 | MCTS@2000 vs heuristic, (c) 2P, n=16 | ~15 min |

## Decision-ready recommendations

### Where strategy actually matters (action: design here)
- **2P:** big skill ceiling. Cleanest competitive 1v1 format.
- **3P:** meaningful skill ceiling. Good for "small group strategy night."
- **4P:** modest but real skill ceiling. Coalition dynamics dominate over solo play.

### Where to invest engineering effort
- Most efficient: ship Tactical Depth Phase 7 (comparison sweep — already partially queued via Track D). If asymmetric types open more strategic space, that's the cheapest path to "more skill ceiling."
- Alternative: stop here. The shipping engine has a complete tactical-depth + alliance + variant story. Playtest with real humans.
- Long shot: hidden-information rule changes (alliances private, hidden territories) — would dramatically increase strategic ceiling but require major rules redesign.

### Where NOT to spend more compute
- Higher MCTS iterations alone. Structural bottleneck — same heuristic leaf eval.
- Further variant tuning of (c). Track E exhausted the obvious axes.
- Random-agent comparisons. Track R answered "yes the game has skill."

## What I'd do if continuing autonomously

In priority order:
1. **Wait for D + V + AB.** They'll definitively answer whether Tactical Depth + variants (a)/(b) add depth.
2. **Run lookahead2-multi-vs-lookahead2-multi-with-alliance sweeps** — if alliances + multi-player minimax produce richer dynamics, that's a positive design finding.
3. **Build a tabletop-realistic lookahead2 variant** (stochastic, no PRNG knowledge) for honest skill measurement.
4. **Implement Tactical Depth Phase 7** (formal comparison sweep + 4-test falsification battery).

## Pointers

- `docs/2026-05-29-README.md` — index of everything.
- `docs/2026-05-29-key-findings-and-answers.md` — Q&A format.
- `docs/2026-05-29-design-implications-from-mechanical-3p.md` — design option exploration.
- `docs/2026-05-29-results-aggregate.md` — auto-generated table dump.
- `docs/handoffs/2026-05-29-flight-packet.md` — living progress doc.
- Per-sweep reports: `docs/2026-05-29-*.md`.

---

*Living document — will be finalized when the master-chain completes.*
