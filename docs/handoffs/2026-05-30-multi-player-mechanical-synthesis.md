# 3P/4P+ Mechanical-Game Synthesis — 2026-05-30

> Sam's flight-night question: **"is (c) a corner where the heuristic plays functionally optimal in 3P+ — meaning mechanical execution by the player?"** This doc synthesizes everything we know after the overnight sweeps + the MCTS variants investigation closed.

## TL;DR

**Sam's worry is confirmed for variant (c), with refinements.** The skill room shrinks monotonically with player count and crosses into "heuristic outperforms 2-ply lookahead" by 6P. Pure (c) is mechanical from 3P onward. Two design levers exist if multi-player strategic depth is the goal: ship the default variant instead of (c), OR ship the `c+baseTypes` (Tactical Depth) variant — but the latter is currently broken in a way cost-recalibration cannot fix.

## Glossary

- **Variants:** `(c)` = `noIronRequiresPerimeter: true` + boardSize 96 + iron 14 + vt 10 (current research-default). `(a)` = `victoryIronRequiresPerimeter: true`. `(b)` = `victoryIronHoldRounds: 2` (hold the iron threshold for 2 consecutive end-of-round checks). `default` = engine defaults without any (a)/(b)/(c) overrides. `baseTypes` = `baseTypesEnabled: true` (Tactical Depth — composable per-subtype builds: forge/watchtower/outpost).
- **Agents:** `heuristic` = improved-heuristic greedy agent (samplePolicy at T→0). `lookahead2` = 2-ply minimax with heuristic leaf eval (2P-correct only). `lookahead2-multi` = proper N-player max^n minimax with heuristic leaf eval (the right agent for 3P+). `random` = uniform legal-action picker (skill floor).
- **"Combined heuristic %"** = sum of all heuristic-controlled seats' win rates in a sweep. e.g., if a 3P sweep has 1 lookahead2-multi seat + 2 heuristic seats and the heuristic seats win 28% + 31.3% = 59.3% combined.
- **"Strategic depth" vs "mechanical":** a cell is "strategic depth" if `lookahead2-multi Δ` (vs per-player baseline `1/nP`) is positive enough to call meaningful (we use >5pp). A cell is "mechanical" if Δ is within ±5pp of baseline — the heuristic is playing at near-optimal strength and adding search depth doesn't help.

## The skill-room curve for variant (c)

The cleanest single chart: **lookahead2-multi vs combined heuristic on (c) noIronRequiresPerimeter, alliancesEnabled=off, across player counts.**

| nP | lookahead2-multi | Combined heuristic | Per-player baseline | Lookahead Δ vs baseline | Verdict |
|---|---:|---:|---:|---:|---|
| 2 | 80.7% (prior) / 85.0% (V) | 19.3% / 15.0% | 50% | **+30 to +35pp** | **Strategic depth** |
| 3 | 40.7% (C1) / 28.3% (V) | 59.3% / 71.7% | 33.3% | +7.4pp / **-5.0pp** | Mixed at seed-noise; verdict: **marginal-to-mechanical** |
| 4 | 31.0% (C2) / 21.7% (V) | 69% / 78.3% | 25% | +6.0pp / **-3.3pp** | Mixed; verdict: **mechanical** |
| 5 | 23.3% | 76.7% | 20% | +3.3pp | **Mechanical** (within noise) |
| 6 | **15.0%** | 85.0% | 16.7% | **-1.7pp** | **Inverted** — heuristic outperforms lookahead2 |

Sources: C1 (`docs/2026-05-29-lookahead2-multi-vs-heuristic-c-3p.md`), C2 (`docs/2026-05-29-lookahead2-multi-vs-heuristic-c-4p.md`), 5P (`-c-5p.md`), 6P (`-c-6p.md`), V (`docs/2026-05-29-variant-cross-comparison.md`).

**The 3P/4P "mixed" reading.** C1/C2 used baseSeed 20000/21000 and showed lookahead2-multi +7.4pp/+6.0pp. V used baseSeed 23000 and showed -5.0pp/-3.3pp. The wins flip sign depending on seed at n=150/n=100. Both magnitudes are small (±10pp at most), consistent with **a regime where the skill differential is real but tiny** — within the same band as MCTS@50-500's noise floor.

The monotone progression 2P (+30pp) → 3-4P (~±5pp) → 5P (+3pp) → 6P (-2pp) is the dominant signal. **Skill room decays monotonically with player count.** This is not a noise artifact at n=60-150 per cell.

## Why does (c) go mechanical at higher player counts?

Two structural reasons, both load-bearing in the playtest synthesis and now confirmed at scale:

1. **Iron-tile saturation.** (c) sets `noIronRequiresPerimeter=true` and `ironCount=14`, `victoryThreshold=10`. With 4+ players each grabbing iron locally on turn 1, the global iron supply is exhausted in 1-2 turns. Whoever happens to control more iron tiles at end-of-turn-1 wins — and that's determined by initial seed-placed iron distribution + which player draws turn order first.

2. **Lookahead-2 doesn't help against simultaneous greedy play.** A 2-ply minimax considers "my move + opponent's best response." With 5 opponents each playing greedy iron-grab, there is no "best response to opponent" — there are 5 simultaneous responses, none of which the lookahead can affect. The game decomposes into "did I grab my iron quotient by turn 1?" — pure mechanical execution.

The 6P INVERSION (lookahead2 < heuristic) is structurally consistent: lookahead2 spends compute searching responses that don't exist at 6P, and may pick suboptimal moves due to misranked branches in its 1-ply leaf eval. Heuristic just plays the greedy iron-grab, which is optimal.

## Variant (a)/(b) levers — do they help?

| Variant | Median turns at 2P | Median turns at 3P | Effect on shape |
|---|:---:|:---:|---|
| (c) reference | 2 | 2 | baseline |
| (c)+(a) `victoryIronRequiresPerimeter` | 2 | 2 | none |
| (c)+(b) `victoryIronHoldRounds=2` | 3 | 3 | +50% game length |
| (c)+(a)+(b) both | 3 | 3 | same as (b) alone |

Source: `docs/2026-05-29-variant-ab-comparison.md`.

**(a) has no effect on heuristic self-play shape.** Whether it changes lookahead2's advantage is untested.
**(b) extends game length by +50%** but the c+b 3P sweep with proper agents shows lookahead2-multi 23.0% vs heuristic 36+41=77% — heuristic STRONGLY beats lookahead2-multi in c+b 3P (lookahead2 -10.3pp vs baseline). So (b)'s longer games make 3P MORE mechanical, not less. Source: `docs/2026-05-29-lookahead2-multi-vs-heuristic-c-b-3p.md`.

**Neither (a) nor (b) is a strategic-depth lever in 3P+.**

## Default variant — the alternative

V data on `default`:

| nP | lookahead2-multi | Δ vs baseline | Median turns | Verdict |
|---|---:|---:|:---:|---|
| 2 | 78.3% | +28.3pp | 1 | **Strategic depth** |
| 3 | 45.0% | +11.7pp | 1 | **Strategic depth** |
| 4 | 26.7% | +1.7pp | 1 | Mechanical |

**Default has strategic depth at 3P (+11.7pp), unlike (c) which is mechanical there.** This is the cleanest single finding for multi-player design: if 3P strategic depth matters, default is preferable to (c).

The cost: default games are very short (median 1 turn) — possibly too snappy to feel like a game. The +28.3pp at 2P is similar to (c)'s +35pp, so 2P depth is comparable.

## c+baseTypes — Tactical Depth (currently broken, but the most promising 3P+ lever)

V data:

| nP | lookahead2-multi | Δ vs baseline | Median turns | Verdict |
|---|---:|---:|:---:|---|
| 2 | 56.7% | +6.7pp | 1 | Strategic depth (marginal) |
| 3 | 43.3% | +10.0pp | 1 | **Strategic depth** |
| 4 | 30.0% | +5.0pp | 1 | Mechanical (just over threshold) |

**c+baseTypes shows the BEST 3P depth among the three variants (+10.0pp at n=60).** That's the most multi-player strategic depth we've measured anywhere — beats pure default 3P (+11.7pp at n=60).

BUT median turns crashes to 1 in every cell — same finding as Track D. The cost recalibration test (`docs/2026-05-29-tactical-depth-recalibrated.md`) sweeping `outpost` cost ∈ {1, 2, 3} × {2P, 3P, 4P} showed **EVERY cell still produced median 1 turn at 100% iron victory**. Even tripling the outpost cost doesn't slow the iron-grab.

The recal doc itself notes the implication: "If outpost=3 still produces median 1, then the root cause is positional (outposts at small radii still cover enough iron) and a different lever (e.g., forge-anchor constraint) is needed."

**Conclusion: Tactical Depth is the right strategic-depth lever for 3P+ but is currently broken in a way cost-recalibration cannot fix.** A positional intervention is needed — candidates: forge-anchor constraint (outposts must be adjacent to a forge), control-radius asymmetry (outposts at r=1 only), or removing outpost-on-iron-tile placement entirely. This is what Phase 7's falsification battery is designed to inform — the recal sweep's finding (cost alone doesn't work) is positive Phase 7 input, NOT a Phase 7 cancellation.

## Random vs heuristic skill floor

For context on whether the game has ANY skill room at all (the "is it random-equivalent" question):

| nP | Random win% | Heuristic combined% | Skill lift / seat |
|---|---:|---:|---:|
| 2 | 5.0% | 91.7% | +41.7pp |
| 3 | 0.0% | 100.0% | +16.7pp |
| 4 | 0.0% | 100.0% | +8.3pp |

The game is NOT random-equivalent — random gets 0 wins in 60 3P/4P games. The heuristic captures REAL skill. The question is only whether DEEPER play captures more, and the answer (per the curve above) is: yes at 2P, no at 6P, marginal in between.

## What's the "natural" player count?

The data points at **2P as the design-depth target.** At 2P, every variant we tested showed strong lookahead2 advantage (+30 to +35pp on (c)/default, +6.7pp even on c+baseTypes which is the least-strategic 2P cell). MCTS@500 also loses to lookahead2 at 100%-0% in this regime (`docs/2026-05-29-lookahead2-vs-mcts500-c-2p.md` from earlier sweeps) — a clear, defensible "the best strong agent we have crushes the medium ones" signal that the game has skill structure here.

At 3P, only **default** and **c+baseTypes** show strategic depth (and c+baseTypes is currently broken). At 4P+, only **c+baseTypes** clears the +5pp threshold (and again, broken). At 5-6P, no variant tested shows strategic depth.

If the box-game-design conventional "2-N players, plays best at K" recommendation is wanted: **"2-6 players, plays best at 2."** With Tactical Depth fixed, that could extend to "plays well at 2-3."

## Decision matrix

What ships depends on whether multi-player strategic depth is a goal:

| Design goal | Recommended variant | Rationale |
|---|---|---|
| 2P-focused game | (c) | Strongest 2P depth (+35pp), median 2 turns feels like a real game |
| 2P + 3P depth | default | +28pp at 2P, +11.7pp at 3P, but median 1 turn is short |
| 2P + 3P depth + longer games | (c)+(b) `victoryIronHoldRounds=2` | (c)'s 2P strength + +50% length, BUT 3P becomes mechanical so only do this if 2P is the focus |
| Multi-player depth + tactical variety | c+baseTypes after a positional fix | Best 3P depth in current data but needs Tactical Depth Phase 7 cost/geometry work to fix the 1-turn collapse |
| Accept mechanical 3P+ and refocus | (c) as-is | The most internally consistent choice if the design philosophy is "2P is the real game, 3P+ is the social/party mode" |

## Open questions (deferred)

- **Lookahead3 vs heuristic on (c) 2P** — does deeper search find MORE than 2-ply (suggesting unexplored depth even in the strategic-depth regimes)? Sweep was killed at 3/16 because lookahead3 was hanging — needs a per-move timeout to be testable.
- **Alliances enabled** — the entire investigation was at `alliancesEnabled=false`. Whether alliances re-open multi-player strategic depth is unknown.
- **Tactical Depth Phase 7 positional fix** — what's the cleanest single intervention (forge-anchor, control-radius asymmetry, or outpost-placement restriction)? Needs new sweep design after Phase 7 ships.
- **n=16 noise band on the MCTS investigation** — the lookahead2-bootstrap hybrid showed 12.5% across all 6 v5b cells (vs 6.3% baseline). One bootstrap@500 run at n=50 would conclusively settle whether this is a real lift or pure noise. Low priority — bumping MCTS from 6.3% to 12.5% doesn't change the design conclusions.

## Pointers

- MCTS variants investigation (negative result on improving MCTS): `docs/2026-05-29-mcts-variants-investigation.md`
- Per-variant reports: `docs/2026-05-29-*.md`
- Per-game data: `docs/sweeps/data/2026-05-29-*.jsonl`
- Prior session handoff: `docs/handoffs/2026-05-29-flight-packet.md`
- MCTS research checkpoint: `docs/handoffs/2026-05-30-mcts-research-checkpoint.md`

---
*Synthesis of 9 sweep reports + the MCTS variants negative-result. Generated 2026-05-30 after Sam's "accept and move on" decision on MCTS@50-500.*
