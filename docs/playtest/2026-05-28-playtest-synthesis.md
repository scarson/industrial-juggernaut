# Opus Playtest Synthesis — Both Agents Beat the Heuristic on Variant (c)

**Date:** 2026-05-28. **Status:** complete. **Authors of input:** two independent Opus subagents (a freeform "verify + try to win" agent and a structured 10-game learning-curve study). **Status of pre-playtest conclusion ("heuristic is near-optimal on (c)"):** **FALSIFIED.**

## Headline numbers

| Agent | Goal framing | Seeds tested | Wins | Win rate |
|---|---|---:|---:|---:|
| Original (freeform) | "win at least one" | ~100 (sweep 1-100) | ~80 | **~80%** |
| Structured (10-game study) | "play 10, look for learning" | 1000-1009 (10) | 4 | **40%** |
| **Baseline:** MCTS @25-@300 (`docs/2026-05-28-mcts-budgets-on-c.md`) | — | 16/budget × 4 budgets = 64 | 1 (only at @300) | **0-6.3%** |

**Two independent agents, dispatched without knowledge of each other's work, converged on substantially the same exploit and each crushed the MCTS baseline by 5×-10×.**

## What both agents found

### Finding 1 (the structural defect): 2-step lookahead is sufficient

The heuristic plays 1-step argmax — it picks the action maximizing `evaluate(state_after_my_action)[me]`. It does NOT consider what it (or the opponent) will do on turn 2. Both agents independently discovered that **enumerating T1 × T2 placements and picking a sequence that wins on T2** beats the heuristic the vast majority of the time.

The mechanism the heuristic misses: on the (c) regime, almost every game ends on turn 2 (median 2.0 turns in 150-game sims). T1 is *positioning for T2*, not for immediate iron. The heuristic, by maxing immediate iron in T1, often paints itself into a corner where its T2 build can't reach 10 iron — or where it doesn't act first on T2.

### Finding 2 (the meta-game exploit): T1 choice influences who acts first on T2

In 2-player games, turn order is decided by an iron-weighted velvet-bag draw: each player puts in tokens equal to their controlled-iron count; the first token drawn plays first. In code (`src/engine/turn.ts`), this is `nextInt(rng, total_iron)` and "P0 first" iff `value < P0.iron`.

Because the PRNG state is deterministic given the seed AND build actions don't draw RNG, the player CAN search: "for each candidate T1 placement, what iron count would I have, and would I therefore act first on T2 given the upcoming PRNG draw?" The heuristic does not — it just maxes evaluate.

**This finding has a real-game / sim-only split:**
- **In simulation (where the player can read the PRNG state):** the player can deterministically select T1 moves that flip the T2 order. This is what gives the ~80% win rate.
- **At a real tabletop (random physical draw):** the player can't predict the draw. They CAN still influence the *probability* — e.g., a T1 move that leaves them with 3 iron and opponent with 8 means a 3/11 chance of going first; a T1 move with 7 iron each means 7/14 = 50%. So the strategic lever survives, but the certainty doesn't. Expected win rate in tabletop play, based on this lever alone, is probably 40-55% (better than 50/50 chance if you play it well, but not 80%).

The structured agent (4/10) is closer to a realistic tabletop ceiling; the original agent's 80% is the sim-only number where PRNG-flip is selectable.

### Finding 3 (independent of PRNG): locally-greedy multi-piece composition

`sampleBuild` composes multi-piece builds greedily — pick the best single placement, apply, pick the next-best, repeat. This can fall into local optima a global-best multi-piece composition would dominate. Both agents observed this:
- The structured agent's game 8 (seed 1007) used a hand-composed T2 build that the heuristic's greedy composer wouldn't reach.
- The original agent noted ~5-10% of seeds are "unwinnable as P0 with single-base wins" but "multi-piece turn-2 builds might cover some of these."

This is independent of the PRNG mechanic. It's a pure strategy defect in the heuristic.

## Why MCTS at our tested budgets fails where Opus agents succeed

The agent vs heuristic h2h data (MCTS @25-@300: 0-6.3% win rate) reflects MCTS's specific weakness on this regime:

1. **UCB exploration under-allocates rollouts to "weak-looking" T1 moves.** The winning T1 placement often has LOW immediate evaluate (it sacrifices iron for positional advantage). UCB sees this as a low-value child and doesn't expand it enough to discover the T2 follow-through.
2. **Progressive widening generates candidates via `samplePolicy` which is iron-dominant.** The "weak-looking" T1 candidate may not even be sampled into the tree.
3. **Maxⁿ leaf eval is `evaluate` itself.** So MCTS's leaves use the same flawed heuristic — search depth doesn't help if the evaluator can't recognize the winning leaf.

In short: MCTS@N with the perimeter-aware heuristic as its leaf eval is structurally bottlenecked by the heuristic. Adding iterations doesn't change which states the search values.

## Implications for the project

### Gate-2 (`docs/plans/2026-05-27-stronger-agent-mcts-plan.md`)

The previous conclusion — "heuristic is near-optimal so gate-2 is the wrong instrument" — was wrong. The heuristic is NOT near-optimal; it's just stronger than MCTS@25-300 at the specific narrow lookahead MCTS uses. **A 2-step lookahead beat both the heuristic and MCTS.**

Implications for the gate-2 reframe options:
- **(a) Re-anchor gate-2 to a weaker baseline** — no longer the right move. Heuristic-aware MCTS could be made to beat the heuristic by fixing the structural issues (3 below).
- **(b) Build alliance-aware policy** — orthogonal to this finding; still valid.
- **(c) Re-think gate-2 entirely** — possibly the right move, but for a different reason: gate-2 should measure "does the agent find non-greedy strategic patterns," not "does MCTS beat the heuristic at iron-rush."

### MCTS structural fixes worth trying

1. **Evaluator awareness of turn-order PRNG / iron-weighted draw.** A leaf eval that scores "P0 expected to go first on T2 given current rng" higher in close-game positions would let MCTS find the same exploit.
2. **PW candidate-generation that explicitly includes "low-immediate-iron" T1 placements.** Currently samplePolicy is iron-dominant; would need to introduce diversity by spatial coverage or by deliberately sampling "weak" moves at high temperature.
3. **Deeper minimax-like search at root.** A bounded 2-ply alpha-beta enumeration over (T1-action × T2-action) might be cheap enough to outperform MCTS in this narrow setup-decided regime.

### Balance implications for the (c) regime

The findings reinforce that **(c) is genuinely setup-decided.** Most 2P games end on turn 2; the entire decision space is "T1 placement + T2 placement, conditional on going first." That's:
- Two ply of decisions for the player.
- Combinatorially small enough to brute-force solve.
- Why the original agent's 80% is achievable: it's near-optimal play given perfect-information determinism.

Whether this is what we want as the default regime is now a sharper question. The variant solves the turn-1-collapse problem but creates a 2-turn micro-game where opening positions dominate. **Sam's call: is this the gameplay we want, or should we tune toward longer games?**

## Caveats and what we DON'T know

- The PRNG-flip is implementation-dependent. A different turn-order randomization (e.g., explicit hash of seed + turn-number) would close the deterministic-search path; the iron-weighted *probability* lever would survive.
- We only tested 2-player (c). 3P+ variants weren't playtested by either Opus agent.
- We didn't test against MCTS-as-opponent — only heuristic. MCTS at higher iterations (1000+) might recover some win rate via more thorough exploration.
- The original agent's 80% claim was demonstrated on a programmatic seed scan (1-100); both agents wrote `solver.py` style scripts. A pure "deep-thinking-without-search" win rate would likely be lower.

## Honest assessment

**The heuristic is decisively beatable on variant (c) with 2-step lookahead, and the MCTS budgets we tested don't perform that lookahead effectively.** Two findings flow from this:

1. **Engineering:** MCTS-as-currently-implemented is structurally bottlenecked. Fixes 1-3 above are worth trying before declaring MCTS the wrong tool.
2. **Balance:** (c)'s setup-decided 2-turn nature makes brute-force lookahead very powerful. If we want games where strategic depth (rather than opening enumeration) determines outcomes, the variant or the turn structure needs more tuning.

The conclusion that emerges depends on which Sam values more: **a regime where games have clear winners decidable from setup** (current (c)) or **a regime where mid-game choices matter** (would need longer games — bigger board, higher victory threshold, slower iron build-up).

---

*Inputs:*
- Original agent transcript: `docs/playtest/transcripts/agent-ac9e6612098ce031b.jsonl`
- Structured agent transcript: `docs/playtest/transcripts/agent-a5077355d604c9581.jsonl`
- Structured per-game log: `docs/playtest/2026-05-28-opus-game-log-structured.md`
- Pre-playtest brief: `docs/playtest/2026-05-28-opus-playtest-brief.md`
