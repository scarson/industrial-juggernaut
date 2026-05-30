# MCTS preserveSoftmaxPrior @500 iterations

**Date:** 2026-05-29. **Trigger:** v4 @50/@100 all 0%. Per Sam, test whether `preserveSoftmaxPrior` at @500 beats the prior baseline (B2 era: MCTS@500 = 10.4% at seed 31000).

**Methodology:** 16 2P games per variant, variant (c), baseSeed 39000.

## Results

| Variant | Win rate | Description |
| --- | ---: | --- |
| mcts500-baseline | 6.3% (1/16) | @500 control — default PW, uniform 1/k prior |
| mcts500-preserve | 6.3% (1/16) | @500 + preserveSoftmaxPrior (PW) |
| mcts500-preserve+d1 | ~6.7% (1/15)* | @500 + preserveSoftmaxPrior + maxDepth=1 |
| mcts500-preserve+d2 | 6.3% (1/16) | @500 + preserveSoftmaxPrior + maxDepth=2 |

*preserve+d1 lost game 16 to container restart. Recovered preserve+d2 directly reports `winRate: 6.3%` from the rrAggregator.

Win rates for baseline / preserve / preserve+d1 reconstructed from JSONL: ALL FOUR variants produced **identical** winner-seat distributions (9 wins as seat 0, 7 as seat 1 in completed games), implying the variants play essentially identically and lose the same games to the heuristic.

## Interpretation

**preserveSoftmaxPrior does NOT close the gap.** At @500 iterations:
- The prior B2 baseline (different seed) reported 10.4% — within the same noise band as today's 6.3%.
- The structural fix (preserving samplePolicy's softmax over typeValues) makes no measurable difference.
- maxDepth=1 and maxDepth=2 also make no difference.

**The bottleneck is not the PW prior.** Combined with v2-v4 (27 variants all near 0%), this rules out the leading "fixable from inside MCTS" hypotheses:
- ~~Config knobs (T, cPuct, maxDepth, candidateMode)~~
- ~~Eval-opts (prng-aware, iron-share)~~
- ~~PW prior equalization~~
- ~~Iteration budget (50 → 100 → 500 unchanged within noise)~~

What's left:
- **Search-rng / game-rng turn-order mismatch** — MCTS's rollout rng forecasts a different "who goes first next turn" than the real game's rng. MCTS plans against a fictional future. Most plausible structural cause, hardest to fix without violating the search-rng/game-rng separation.
- **Heuristic eval being too coarse** — at the leaf, evaluate() returns scores that are too close together for MCTS to differentiate winning from losing 2-turn lines.

v5b (hybrid bootstrap with `scoreActionLookahead2`) is the next test — it sidesteps both issues by handing MCTS a deterministic, lookahead-quality prior at the root decision point.

---
*Recovered after container restart; aggregation reconstructed from JSONL.*
