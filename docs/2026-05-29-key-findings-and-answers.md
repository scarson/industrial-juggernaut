# Key Findings & Answers — 2026-05-29 Flight Day

> Q&A format. Cuts through the sweep noise to the actionable picture. Source data: all 2026-05-29 reports + the prior overnight + playtest synthesis.

## Q1 — Is the heuristic near-optimal in 3P+ on (c)?

**A: Partly.** It depends on player count:
- **3P:** No — `lookahead2-multi` (proper N-player minimax) beats it by +7.7pp (40.7% vs 33.3% baseline). Real strategic structure exists.
- **4P:** Likely yes — `lookahead2-multi` at 23.2% (n=56 partial) ≈ 25% baseline. Mechanical. *(C2 finishing — final number coming.)*
- **5P/6P:** Queued; expect mechanical based on the trend.

The original 2P-only `lookahead2` played at baseline in 3P/4P (A2/A3 → 32-33%, 25%). That MASKED the 3P strategic structure — proper minimax finds it.

## Q2 — Is the heuristic better than random?

**A: Crushingly yes.** Random gets:
- 2P: 5% (heuristic 91.7%)
- 3P: **0%** of 60 games (heuristic 100%)
- 4P: **0%** of 60 games (heuristic 100%)

So the game has REAL skill structure (the heuristic captures it well). 3P+ outcomes are NOT random noise. Random play is impossible; heuristic play is strong but not maximal (at least in 3P).

## Q3 — Does MCTS recover with more iterations?

**A: Hardly.** MCTS@500 vs heuristic on (c) 2P: heuristic 89.6%, MCTS 10.4%. *(B2 mcts1000 running — early signal suggests similar.)*

MCTS is structurally bottlenecked because it uses the heuristic as its leaf eval. More iterations don't help when the eval can't see "weak T1 → winning T2" leaves.

## Q4 — Does deeper lookahead help? (lookahead3 vs lookahead2)

**A: Queued — coming.** Hypothesis: marginal gain in 3P (where lookahead2-multi already wins +7.7pp), little to no gain in 4P (mechanical regime).

## Q5 — Does the (c) variant produce longer games at any boardSize / vt / iron tuning?

**A: No.** Track E exhaustively swept 3×3×2 = 18 cells of (boardSize × victoryThreshold × ironCount). Result: every cell either resolved fast (median 2-3 turns) or stalled at turn-cap. **(c)'s 2-turn nature is structural** — you can't tune it longer within these axes.

## Q6 — Do variants (a) and (b) add strategic depth?

**A: Queued — track AB coming.** Both flags exist in the engine; we haven't benchmarked them properly under (c).

## Q7 — Do asymmetric base types (Tactical Depth) open strategic space?

**A: TBD — Track D queued.** Engine layer (Phases 1-5) shipped today; heuristic agents now compose per-subtype builds; legalActions emits subtype-aware actions; combat respects watchtower +1 defense. Track D will run heuristic self-play with the flag on vs off across 2P/3P/4P (100 games per cell) to see if the flag actually shifts gameplay metrics.

## Q8 — Do the existing M1-era greedy archetypes (aggressive, economic, expansionist) beat the heuristic?

**A: Queued — archetype sweep coming after lookahead3.** This tests whether ANY non-heuristic strategy is viable.

## Q9 — Is the game decided by setup geometry / turn order, or by play quality?

**A: Mixed.**
- **Setup matters:** 2P (c) games end in 1-2 turns. Initial seat geometry and turn-1 PRNG draw heavily influence outcome.
- **Play matters:** if play didn't matter, random would tie heuristic. Random gets crushed (Q2). So play quality differentiates outcomes significantly.
- **The PRNG-flip exploit is real but sim-only:** lookahead2's 80.7% in 2P depends on deterministic PRNG knowledge. In a tabletop game with a physical velvet bag, the exploit reduces to a probability-shift lever rather than certainty.

## Q10 — What's the answer to Sam's original flight-night worry?

Restating: **"is (c) a corner where the heuristic produces functionally optimal play for 3P+ because that's just mechanical execution by the player?"**

**Updated answer with C1 data:**
- **3P:** No — there IS strategic depth above heuristic-level (lookahead2-multi finds ~+8pp). A focused player who thinks 2 ply ahead can outplay one who plays mechanically.
- **4P:** Yes (likely). Convergence to baseline by C2 partial data. Lookahead provides no meaningful gain in 4P. Mechanical regime.

**Combined design picture:**
- **2P:** big skill gap (80% lookahead2 vs heuristic). The game has DEEP strategic ceiling.
- **3P:** modest skill gap. Real but not crushing.
- **4P+:** mechanical. The heuristic IS near-optimal.

For multi-player as a competitive strategy game, 2-3P is the design sweet spot. 4P+ becomes coordination + execution. Whether that's a feature or a bug is your call.

## Bottom-line recommendations

If the game's target is competitive multi-player **strategy**:
- 3P is the sweet spot. Lean design into that.
- 4P+ needs additional mechanics if you want strategic depth (asymmetric types? hidden info? trade?).

If the game's target is multi-player as a **social** experience (negotiation, alliances, betrayal):
- 4P+ is fine — coordination dynamics > pure strategy.
- Lean into alliance mechanics (already shipped) and bluffing structure.

The TACTICAL DEPTH layer (asymmetric base types) is now engine-ready (Phases 1-6 shipped today). Track D will tell us if it opens new strategic space. If yes, that's the cheapest path to "add ceiling to 4P+."

---

*Living document — will be updated as C2, L, D, V, AB, B-series, archetype, lookahead3, 5P/6P sweeps land.*
