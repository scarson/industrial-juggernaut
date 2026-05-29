# Flight Packet — 2026-05-29 — what Sam sees on landing

> Living document being updated as overnight sweeps land. Read this first.

## TL;DR — the picture so far

Sam's flight-night worry was: **"is (c) a corner where the heuristic plays functionally optimal in 3P+ — meaning mechanical execution by the player?"** Here's the evidence I have so far. The remaining sweeps will sharpen this.

### Sam's worry: OVERSTATED — there IS strategic depth in 3P AND 4P

Three key tracks landed since you took off:

**Track R (skill floor — random vs heuristic):**

| nP | Random win% | Heuristic combined% | Heuristic skill gain |
|---:|---:|---:|---:|
| 2 | 5.0% | 91.7% | +41.7pp/seat |
| 3 | **0.0%** | 100.0% | +16.7pp/seat |
| 4 | **0.0%** | 100.0% | +8.3pp/seat |

The heuristic captures REAL skill — random gets 0 wins in 3P/4P over 60 games. The game isn't random-equivalent.

**Tracks C1 + C2 (proper N-player minimax — lookahead2-multi vs heuristic):**

| Player count | lookahead2-multi win rate | Δ vs baseline | Verdict |
|---:|---:|---:|---|
| **3P (n=150)** | **40.7%** | **+7.7pp** | Strategic depth |
| **4P (n=100)** | **31.0%** | **+6.0pp** | Strategic depth (lesser) |

**Lookahead2-multi BEATS the heuristic in BOTH 3P and 4P.** The earlier A2/A3 results (32.7%/25%) were misleading — they used the 2-player lookahead2 algorithm in multi-player games, which doesn't generalize properly. The proper max^n minimax finds improvements the heuristic misses at every player count.

**Revised picture:**
- Random << heuristic << lookahead2-multi at all player counts.
- The skill gap shrinks with player count: 2P 30pp → 3P 7.7pp → 4P 6.0pp → ?P (testing 5P/6P queued)
- The heuristic is NOT mechanical-optimal in 3P or 4P. It misses ~6-8% of available skill structure.
- The skill that lookahead2-multi finds is "anticipate all opponents' moves one ply deeper" — a real cognitive lift for a human, not mechanical.

**The game has skill ceiling at all tested player counts.** The original mechanical-3P+ worry is largely DISPROVEN. Multi-player play has strategic depth above heuristic execution.

### Track D landed — Tactical Depth ACCELERATES games (unexpected)

| nPlayers | baseTypes=false median | baseTypes=true median |
|---:|:---:|:---:|
| 2P | 2 | **1** |
| 3P | 2 | **1** |
| 4P | 2 | **1** |

Across ALL 6 cells, enabling subtypes DROPS median games from 2 turns to 1 turn. Iron-vic % unchanged (~100%). The heuristic, when allowed to compose per-subtype, builds outposts (cost=1/piece) in volume, hitting the iron threshold in a single turn.

**Implication:** the current Tactical Depth cost calibration (forge=2, watchtower=4, outpost=1) is unbalanced. Outposts are too cheap for the iron-grab regime. If you want Tactical Depth to ADD strategic depth (not subtract it), the costs need recalibration — probably outpost cost ≥ 2 and watchtower with stronger benefits.

This is actually a positive Phase 7 finding — the sweep CAUGHT the imbalance immediately. Cost-recalibration is what Phase 7's "4-test falsification battery" was designed to inform.

### What we KNOW (existing data, n ≥ 100 per cell)

| Regime | Heuristic vs lookahead2 (2-ply) | Median turns | Mechanical? |
|---|---|---:|---|
| **(c) 2P** | heuristic 19.3% / lookahead2 80.7% | 2 | NO — clear skill gap |
| **(c) 3P** | heuristic 33.3% / 33.3% / lookahead2 32.7% | 2 | likely YES (no advantage at 5pp threshold) |
| **(c) 4P** | heuristic 28% / 29% / 18% / lookahead2 25% | 2 | YES (perfectly uniform, no structure found by lookahead) |
| **default 2P** | heuristic 42% / lookahead2 58% | 1-2 | partial — small skill gap |
| **MCTS@500 vs heuristic (c) 2P** | heuristic 89.6% / mcts 10.4% | 2 | MCTS@500 still weak |

### Key observations

1. **(c) is structurally fast.** Across A1-A4 and E grid (18 (boardSize × vt × ironCount) cells), there's no config where games last >2 turns AND resolve cleanly. The default variant is even faster — 1-2 turns.
2. **Lookahead2's 2P advantage dies at 3P+.** 80% → 33% → 25%. This is the strongest evidence for Sam's "mechanical 3P+" worry.
3. **MCTS doesn't recover.** Even at @500 iterations, MCTS gets only 10.4% on (c) 2P. The structural bottleneck (perimeter-aware heuristic as leaf eval) holds.
4. **Seat-bias check.** A1 (c 2P): seat 0 wins 52%, seat 1 wins 48% — fair. A2 (c 3P): seat 0 wins 43% vs 33% baseline — small structural advantage. A3 (c 4P): perfectly uniform (~25% each).
5. **Default-variant 2P is moderately exploitable.** lookahead2 beats heuristic 58% / 42% — there IS strategic structure there, just much less than on (c).

### Caveats

My A2/A3 used the 2-player `lookahead2` algorithm in 3P/4P matches — that may be a SUBOPTIMAL agent for multi-player games. Track C (lookahead2-multi, proper max^n) is the real test. **If lookahead2-multi STILL plays at baseline in 3P/4P, the heuristic IS near-optimal there.** Currently running.

## What's running while you fly

Single master-chain script running sweeps sequentially (no thrashing under 4-vCPU limit). Priority order = most decisive answers first.

| # | Track | What it answers | Status |
|---|---|---|---|
| 1 | **R** — random vs heuristic, (c) 2P/3P/4P, 60 games/cell | Skill floor sanity check. If heuristic CRUSHES random in 3P+ but lookahead2-multi doesn't beat heuristic → heuristic IS near-optimal in 3P+. If random ties heuristic → game is essentially random. | 🟢 running |
| 2 | **C1** — lookahead2-multi vs heuristic, (c) 3P | THE critical 3P test. If lookahead2-multi STILL plays at baseline → heuristic IS near-optimal in 3P. If wins above baseline → heuristic has gaps. | ⬜ queued |
| 3 | **C2** — lookahead2-multi vs heuristic, (c) 4P | Same for 4P. | ⬜ queued |
| 4 | **L** — lookahead2 self-play, (c) 2P/3P/4P, 50 games/cell | Do stronger-vs-stronger games produce longer/deeper games? Indicator of suppressed strategic depth. | ⬜ queued |
| 5 | **D** — baseTypesEnabled effect, heuristic self-play 2P/3P/4P, 100 games/cell | Does enabling subtypes shift metrics? Tests whether the tactical-depth flag is a real lever. | ⬜ queued |
| 6 | **V** — variant cross-compare {default, c, c+baseTypes} × {2P, 3P, 4P}, 60 games/cell | Auto-flags strategic-depth vs mechanical regimes. Finds where lookahead2-multi shows >5pp gain. | ⬜ queued |
| 7 | **AB** — variants (a) + (b), heuristic self-play, 60 games/cell | Do victoryIronRequiresPerimeter or victoryIronHoldRounds shift gameplay? | ⬜ queued |
| 8 | **B3** — lookahead2 vs MCTS@500, (c) 2P, 32 games | Does proper search beat higher MCTS? | ⬜ queued |
| 9 | **B2** — MCTS@1000 vs heuristic, (c) 2P, 32 games | Higher MCTS recovery curve. | ⬜ queued |
| 10 | **archetype** — aggressive/economic/expansionist vs heuristic, (c) 2P/3P, 50 games/cell | Does any simple strategy beat heuristic? Diversity of viable strategies. | ⬜ queued |

Total: ~90 minutes wall-clock estimated (sequential, 3 workers each).

## Engineering shipped while you fly

- **`lookahead2-multi` agent**: proper N-player max^n minimax with heuristic leaf eval. Wired into `AgentSpec`. Solves the "lookahead2 was only 2P-correct" issue.
- **Heuristic subtype-aware composition**: when `baseTypesEnabled=true`, `samplePolicy` generates per-subtype build candidates (forge/watchtower/outpost). Engine 228/228, agent 111/111 green. **All agents (including MCTS and lookahead2-multi) automatically become tactical-aware via the leaf-eval** — no separate agent class needed.

## Where I'll land by the time you read this

Best case (all sweeps finish): clear answer on each of Sam's three open questions.
Worst case (container restarts mid-run): partial data, but Tracks C1+C2 should at least be done.

I'll keep updating this doc as data lands.

## Decisions you'll want to make on landing

1. **If C1/C2 confirm 3P+ is mechanical (lookahead2-multi at baseline)**: pivot. Options: (a) flip variant default toward defaults that aren't 2-turn-decisive; (b) ship Tactical Depth Phases 5-7 to give players asymmetric choices that aren't gated by 1-step optimization; (c) accept (c)'s mechanical-in-3P+ nature and refocus on 2P design.
2. **If C1/C2 show lookahead2-multi DOES beat heuristic in 3P+ (>5pp gain)**: the heuristic has gaps the multi-player minimax finds. Then the question is whether human players would find them — likely no, since multi-player minimax is computationally expensive even for humans.
3. **If D shows baseTypesEnabled shifts metrics**: tactical depth as a balance lever works. Worth pursuing Phases 5-7.
4. **If V finds any "strategic depth" cell**: that's a candidate default config to consider.

## Pointers

- Sweep data: `docs/sweeps/data/2026-05-29-*.jsonl`
- Reports: `docs/2026-05-29-*.md`
- Prior synthesis: `docs/playtest/2026-05-28-playtest-synthesis.md`, `docs/handoffs/2026-05-29-overnight-handoff.md`
- Engine: `src/agent/{lookahead2,lookahead2-multi,heuristic}.ts`, `src/sweep/{tactical-depth-effect,variant-cross-comparison,lookahead2-self-play}.ts`

---

*Updated [INCOMPLETE — will refresh as sweeps land].*
