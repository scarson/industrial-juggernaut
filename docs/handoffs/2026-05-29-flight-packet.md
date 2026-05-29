# Flight Packet — 2026-05-29 — what Sam sees on landing

> Living document being updated as overnight sweeps land. Read this first.

## TL;DR — the picture so far

Sam's flight-night worry was: **"is (c) a corner where the heuristic plays functionally optimal in 3P+ — meaning mechanical execution by the player?"** Here's the evidence I have so far. The remaining sweeps will sharpen this.

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

| Track | Description | Status |
|---|---|---|
| B2 | MCTS@1000 vs heuristic, (c) 2P, 32 games | 🟢 game 1/32 last check |
| B3 | lookahead2 vs MCTS@500, (c) 2P, 32 games | 🟢 game 1/32 last check |
| C1 | **lookahead2-MULTI** vs heuristic, (c) 3P | ⬜ queued (chain-cdv) |
| C2 | **lookahead2-MULTI** vs heuristic, (c) 4P | ⬜ queued |
| D | baseTypesEnabled effect (heuristic self-play, flag on vs off, 2P/3P/4P) | ⬜ queued |
| V | Variant cross-compare: lookahead2-multi vs heuristic across {default, c, c+baseTypes} × {2P, 3P, 4P}. Auto-flags strategic-depth vs mechanical regimes. | ⬜ queued |
| L | lookahead2 self-play across (c) 2P/3P/4P. Does stronger-agent self-play produce deeper games? | ⬜ queued (chain-l) |

Total estimated compute: ~60-90 minutes after B-series finishes.

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
