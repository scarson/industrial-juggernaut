# Agent Roadmap — Simulator Playing Agents

**Date:** 2026-05-27
**Status:** Planning capture (brainstorming in progress; formal M1 spec still to be written)
**Companion docs:** `2026-05-18-design-critique.md`, `2026-05-18-code-representation-options.md`

This document records (1) the milestone-1 scoping decision for the playing agent and (2) a detailed design for the **stronger agent**, captured now as a deferred follow-up so the idea isn't lost.

---

## Part 1 — Milestone Boundary Decision

### Milestone 1: Engine core + greedy-weighted archetype agent

The first spec/milestone delivers:

- The **pure rules engine** (hex model, territory as disk-union and convex-hull, legality predicates, combat, victory/elimination, perimeter computation). Deterministic given an RNG seed.
- A **greedy-weighted archetype agent** that plays *somewhat competently* — meaningfully better than uniform random — built as a thin scoring layer over the engine.
- A driver that plays full games to completion (the agent doubles as the "can the engine play a legal game end-to-end" acceptance test).

**Why this agent is cheap here:** the victory metric (controlled iron) is also the dominant positional heuristic, and the engine already computes it. A single feature — `Δ(controlled iron)` from a candidate move — moves you most of the way from random to non-embarrassing at near-zero extra cost.

#### Agent design (M1)

```
score(move) =
    w_iron * Δcontrolled_iron
  + w_fact * Δcontrolled_factories
  + w_area * Δperimeter_area
  + w_aggr * combat_EV          # P(win) * resources_gained - fatigue_cost
choose = softmax-sample(scores, temperature)
```

Static hard-prunes (reuse engine machinery, weight 0 / heavy penalty):

- 4th-base placement yielding zero iron (self-elimination per rules) → weight 0
- Any move that drops an iron hex you currently hold → heavy penalty
- A factory that lands outside your resulting perimeter → penalty

**Archetypes** = weight presets + temperature:
- *Aggressive* — high `w_aggr`, low temperature
- *Economic* — high `w_fact`
- *Expansionist* — high `w_area`

**Multi-piece placement** — greedy sequential: score all single placements, place the best, recompute, repeat until the build budget is spent.

**One allowed dynamic rule** (the single concession to non-static reasoning, because over-committing is so punishing it distorts results): keep ≥1 fresh base near your frontier for defense.

#### What M1 explicitly does NOT do

It plays all dynamic/lookahead situations naively: 4th-base *timing*, counterattack anticipation, multi-attack sequencing, alliance formation/betrayal. These are deferred to the stronger agent (Part 2). The discipline that keeps M1 cheap is **only pruning statically-obvious bad moves** — the moment a prune needs lookahead to evaluate, it belongs in Part 2.

#### Validity ceiling (accept this going in)

M1's agent buys **engine validation + gross-imbalance detection + structural signals** (does the game terminate? is there seat/turn-order bias? does any setting let a weak agent trivially dominate?). It does **not** settle *subtle* balance questions (e.g., kill-bounty snowball *under good play*) — and, unfortunately, it under-tests the game's best mechanic (the 4th-base perimeter timing decision) precisely because it handles that myopically. Those questions wait for the stronger agent.

---

## Part 2 — Stronger Agent (Deferred Follow-Up, Detailed)

The strong agent is what makes the balance simulator's conclusions *trustworthy under good play*. It is a substantially larger effort than M1 (roughly 3x), and it confronts problems M1 deliberately ignores. Captured here in detail.

### 2.1 Game-theoretic framing

Industrial Juggernaut is **not** a 2-player zero-sum game. It is an **N-player (2–6) stochastic game with temporary, freely-dissolvable coalitions** (alliances), where the alliance's combined iron counts toward victory. This is the single most important — and least charted — property for agent design. Most strong game AI (chess, Go, 2-player poker) is 2-player zero-sum or fixed-team; this is neither.

Consequences:

- Utility must be **per-player win probability** (or expected rank), not a single scalar the way minimax assumes.
- Backup must be **max^n style**: at each decision node the acting player maximizes *their own* value component of an N-vector, not the negation of an opponent's.
- A "paranoid" (assume everyone targets me) assumption is a cheap fallback but plays badly in 3–6P because it ignores that opponents also fight each other.
- **Coalitions shift the effective objective mid-game.** The agent needs an explicit alliance model (2.6), not just a board evaluator.

### 2.2 Search algorithm — MCTS variant

Recommended core: **determinized / information-set Monte Carlo Tree Search** with explicit chance nodes.

- **Randomness sources:** (a) turn-order draws from the bag, (b) combat draws. Turn order is hidden-future information → handle by determinization (sample plausible turn orders) or information-set MCTS.
- **Combat is friendly to search:** it's an exact Bernoulli with *known* probabilities from the rules table (3→0.75, 4→0.833, 5→0.889, 6→1.0). So combat is a clean two-branch chance node (win with p, lose with 1−p) — no rollout variance needed; expand both branches weighted by p.
- **N-player backup:** store an N-vector of value estimates at each node; each node's acting player selects the child maximizing their own component (max^n). UCB/PUCT applied per acting player.
- **Tree/leaf/root parallelism** for throughput.

Expectimax with chance nodes is a viable simpler alternative for 2-player or shallow horizons, but MCTS scales better to the branching factor and long horizon.

### 2.3 Action abstraction (essential)

The raw action space is enormous and *structured*: build-vs-attack, then combinatorial hex placements (choosing k placements from dozens of legal hexes), then attack groupings (which 3–6 of your bases, which target, which defender). Enumerating raw actions is intractable for search.

Define **macro-actions** that inject domain knowledge and shrink branching:

- `BuildFactoriesNearFarthestBase(n)`
- `ExpandToward(iron_cluster_X)` — place bases to enclose a target iron group
- `LockPerimeterNow` — place the 4th base at the area-maximizing position
- `Attack(target T, minimal sufficient commitment)`
- `FortifyFrontier(facing player P)`
- `ProposeAlliance(P)` / `AcceptAlliance(P)` / `DissolveAlliance(P)`

Use **progressive widening** so search expands the most promising macro-actions first, and only refines into concrete placements when a macro-action proves valuable.

### 2.4 Evaluation / value function

Hand-crafted feature set (Phase A/B), later replaced or augmented by a learned net (Phase C/D):

- **Controlled iron** (dominant; and distance-to-10 / distance-to-victory-threshold)
- **Controlled factories** (production capacity, and denial — the shared 36-supply is finite)
- **Perimeter area** and **compactness/defensibility** (compact perimeters expose less frontier)
- **Frontier exposure** — length of border shared with each opponent and their muster potential against it
- **Tempo** — number of fresh bases available this/next round
- **Relative standing** — your iron vs. each opponent's; lead and lead volatility
- **Alliance value** — marginal win-probability change from current/candidate coalitions
- **Factory-supply scarcity** — how many of the 36 factories remain in the central pool

### 2.5 Threat model (defense)

Maintain an explicit **threat map**: for each of your perimeter (outer) bases, compute every opponent's ability to bring 3–6 in-range bases to bear and the resulting win odds (directly from the combat table). This drives:

- Holding the right number of fresh reserves (generalizes M1's single static rule into a quantitative reserve policy).
- Choosing *which* base to commit as the lone defender.
- Pre-emptive fortification of the most-threatened frontier segment.
- Deciding whether a tempting attack leaves you fatally exposed next round (the lookahead M1 lacks).

### 2.6 Alliance / diplomacy module

The richest and least-charted component. An alliance raises your win probability when the combined iron path to the threshold is faster than going solo *and* the partner is unlikely to win the shared prize first.

- **Formation:** estimate `P(win | ally with P) − P(win | solo)`; propose/accept when positive and robust.
- **Betrayal timing:** defect when defection raises your win probability above continued cooperation — classically, when the ally is one move from the shared victory, or when you can seize their iron via attack. The rules explicitly reward the player who "manages alliances well, knowing when to cooperate and when to strike."
- **Trust / reputation:** in iterated play against the same opponents, model reputation; a bot that always betrays gets frozen out.
- **Negotiation surface:** against *humans*, alliances are negotiated in natural language. A complete agent may need a protocol layer (structured proposals) or an LLM-mediated negotiation layer to participate credibly. Against other bots, a structured proposal/accept/dissolve protocol suffices.

This module is arguably a research project on its own and can be developed independently of the search core.

### 2.7 Learned approach (Phase D — full AlphaZero-style)

- **Board encoding:** the hex grid as a tensor — channels for terrain (iron), each player's bases (fresh / fatigued), factories, per-player control masks, per-player perimeter masks, central factory-supply scalar. Use hexagonal convolutions or axial-coordinate tensors with hex-aware kernels.
- **Policy head:** over macro-actions, or a **factored / autoregressive** head (action-type → target hex → commitment level) so multi-piece placement is generated sequentially conditioned on prior placements in the same round.
- **Value head:** an **N-vector of win probabilities** (one per player) to support the multiplayer max^n backup — not a single scalar.
- **Training:** self-play with MCTS-guided policy improvement (AlphaZero loop), adapted to N players (each player's search uses its own value component). Reward = terminal win/loss, optionally shaped early with an iron-control bonus to accelerate learning.
- **Alliance complication:** alliances break the clean self-play assumption. Options: train across **randomized alliance configurations**, or fold alliance decisions into the action space and let self-play discover coalition policies. This is an open research risk.
- **Symmetry augmentation:** exploit board rotational/reflective symmetry to multiply training data.

### 2.8 Phased path to the strong agent

- **Phase A** — MCTS over macro-actions + hand-crafted evaluation, max^n backup, exact combat chance nodes. Already far stronger than M1; no learning required.
- **Phase B** — add the quantitative threat map (2.5) and the alliance module (2.6).
- **Phase C** — replace/augment hand-crafted eval with a value net trained (supervised) on Phase A/B self-play games.
- **Phase D** — full AlphaZero-style policy + value self-play.

### 2.9 Agent evaluation methodology

- **Elo via round-robin** against a ladder of baselines: uniform-random, the M1 greedy-weighted agent, and prior strong-agent versions.
- **Ablations** — does each module (threat map, alliance) raise Elo?
- **Exploitability probes** — can a scripted exploiter find a repeatable winning line?
- **Balance re-runs** — re-run the parameter sweeps from the simulator under strong agents and compare conclusions to the M1 weak-agent runs; divergences are exactly the "subtle balance" findings M1 couldn't reach.

### 2.10 Deployment constraint (carry over from the code-representation doc)

A heavy MCTS or neural agent **cannot run inside a Cloudflare Worker** (10 ms free / 30 s paid CPU caps). Per the chosen all-TypeScript-on-Cloudflare stack, the strong agent must run **off-Workers** — a separate long-running service (Rust or Python, GPU for the learned variant), or a Cloudflare Container — invoked by the Worker / Durable Object. This is also where a Rust rules-core (compiled once, shared with the engine) would finally earn its keep for search throughput.

### 2.11 Open risks / hard parts (honest list)

1. **N-player + shifting coalitions** is the genuinely hard, under-researched core; most strong-AI techniques assume 2-player zero-sum.
2. **Alliance negotiation with humans** may require a natural-language / LLM layer to be credible.
3. **Action-space combinatorics** demand good abstractions; bad abstractions cap agent strength regardless of search depth.
4. **The 4th-base timing decision** needs genuine multi-turn planning — the thing M1 most conspicuously lacks and the strong agent most needs to get right, since it's the game's signature mechanic.
5. **Self-play under alliances** lacks the clean theoretical guarantees AlphaZero enjoys in 2-player zero-sum settings.
