# Design Spec — Stronger Agent: Heuristic MCTS (Milestone 1)

**Date:** 2026-05-27
**Status:** Draft for review
**Scope:** First "stronger agent" milestone — a search-based agent that is *trustworthy for balance sweeps*.
**Companion docs:** `2026-05-27-agent-roadmap.md` (Part 2 — the full strong-agent vision; this spec is its Phase A), `2026-05-18-design-critique.md`, `docs/superpowers/specs/2026-05-27-rules-engine-m1-design.md` (the engine this builds on).

## 1. Goal & Success Criteria

Build a search-based agent strong enough that **balance-sweep conclusions drawn from its self-play are credible** — not the strongest possible agent, but one whose play quality doesn't bias the balance signals a sweep is trying to isolate.

"Trustworthy for sweeps" is operationalized as four measurable gates (the milestone is done when all hold):

1. **Non-degenerate games** — self-play produces a real distribution of iron-contested outcomes across 2–6 players, not the M1 greedy agent's universal turn-3 mutual-elimination.
2. **Beats the greedy baseline decisively** — in head-to-head round-robin, the MCTS agent's win-rate against the M1 greedy agent is well above 50% (target: ≥ 70% in 2P, with a clear positive margin in 3–6P).
3. **Robustness** — gross balance signals (e.g. "does auto-win-at-6 dominate?", "does kill-bounty=12 snowball?") **agree across ≥ 2 independent agent configurations** (different eval weights and/or search budgets). A conclusion that flips between configs is an agent artifact, not a balance fact, and fails this gate.
4. **No trivial exploit** — a scripted exploiter (e.g. always-rush-iron, always-max-commit-attack) cannot reliably (> 50%) beat the MCTS agent.

## 2. Scope & Non-Goals

**In scope:** a determinized N-player max^n MCTS agent for **2–6 players with no alliance reasoning** (every player treated as solo; max^n backup). Covers the alliance-independent sweep knobs (`autoWinAt6`, `killBounty`, `victoryThreshold`, `ironCount`, `radius`/`placeRange`/`attackRange`, board params, combat token ratios). An improved, perimeter-aware heuristic (the eval + rollout/sampling policy). An evaluation harness. Empirical investigation + authorized tuning of the factory-death clock.

**Non-goals (deferred):**
- **Alliance formation/betrayal modeling** — the engine supports coalitions, but this agent neither forms nor exploits them. Sweeps of *alliance-specific* dynamics wait for a later alliance-agent milestone. (Roadmap §2.6.)
- **Learned policy/value (AlphaZero-style)** — Phases C–D; pursued only if this milestone proves insufficient for trustworthy sweeps. Gated on evidence, not committed now.
- **The sweep harness itself** — its own later spec; this milestone delivers the agent it depends on.
- **Live-game serving / Cloudflare deployment** — this agent runs in Node for offline sweeps; the code-rep doc's "heavy search can't run in a Worker" caveat is irrelevant here.

## 3. Architecture

A **determinized, N-player max^n Monte Carlo Tree Search** that uses the existing **pure M1 engine** (`applyAction`, `status`, `advanceRound`, `control`, `legalActions`) as its forward simulator. No machine learning. The agent exposes the **same interface as the greedy agent** (`{action, state}` with the PRNG advanced in the returned state) so the driver and sweeps use it interchangeably, and it is **deterministic given a seed**.

Layered on top of the engine; depends downward only:
```
eval harness (Elo round-robin, robustness, exploiter)
  └─ mcts agent (chooseActionMCTS)
       └─ mcts core (tree, max^n PUCT, chance nodes, PW candidate-gen)
            └─ heuristic (position eval + stochastic action policy)
                 └─ M1 engine (applyAction / status / advanceRound / control / legalActions)
```

## 4. Components

### 4.1 Improved heuristic (`src/agent/heuristic.ts`)
A position evaluator `evaluate(state): number[]` returning a per-player score vector, from features (weights configurable — they are also a robustness-check dimension):
- **Controlled iron** (dominant — it is the victory metric) and **distance-to-`victoryThreshold`**.
- **Controlled factories** (production + denial of the shared pool).
- **Perimeter area + compactness/defensibility** (compact perimeters expose less frontier).
- **Tempo** — fresh bases available.
- **Frontier exposure** — border shared with opponents weighted by their in-range muster.
- **Perimeter-establishment term** — explicitly values reaching/holding a valid 4-base perimeter even at a transient iron dip. **This is the direct fix for the M1 myopia** (the greedy scorer treated the 4th base as iron-losing and never expanded). Every candidate-generation option below is heuristic-bounded, so this feature is the real lever.

The heuristic also exposes a **stochastic action policy** `samplePolicy(state, player, rng, temperature): {action, rng}` — a temperatured composer that (a) picks a round-type weighted by the heuristic-estimated value of each, (b) for builds, composes a multi-piece build by sampling placements proportional to their per-piece heuristic score (so it can sample non-greedy compositions, including the 4th-base perimeter), (c) for attacks, samples among the representative attacks from `legalActions`. Reused as the MCTS rollout/default policy AND the candidate generator (§4.2). At temperature → 0 it reduces to the greedy composer (giving us Option 1 as a sub-case for free).

### 4.2 MCTS core (`src/agent/mcts.ts`)
- **Nodes** carry visit count `N`, per-action edge statistics, and an **N-vector** of value estimates (one component per player).
- **Selection:** PUCT, where at each node the **acting player maximizes their own value component** (max^n backup of the N-vector). Acting player = `currentPlayer(state)`.
- **Candidate generation = Option 4 (progressive widening over policy-sampled complete actions).** A node opens `k = ceil(C · N^α)` children (defaults `C=2, α=0.5`, configurable); each new child is a *complete* legal Action drawn from `samplePolicy` (deduped). This bounds branching, samples diverse compositions (mitigating fixed-greedy bias), and adapts to the current `RuleConfig` rather than hard-coding default-rule assumptions.
  - **Throughput fallback (Option 1):** a config flag `candidateMode: "fixed"` replaces PW-sampling with a small fixed candidate set (greedy-composed builds + representative attacks + pass) for faster sweeps; the robustness gate (§4.4) is the arbiter of whether the cheaper mode is trustworthy.
  - **Fidelity escalation (Option 2):** documented but NOT built in v1 — if measurement shows build *composition* quality is the binding constraint, add a per-piece within-round decomposition for builds (agent-layer accumulator, commit via one `applyAction`).
  - **Macro-action DSL is explicitly rejected** — see §8 reasoning (it makes agent competence covary with swept parameters, contaminating balance conclusions).
- **Chance nodes (combat):** an `attack` action's outcome is an exact Bernoulli with `p = combatTable[commit]`. Expand BOTH outcomes (win `p`, lose `1−p`) as a chance node and back up the probability-weighted expectation — no rollout variance for combat.
- **Turn-order randomness:** **determinized** — when a simulation crosses a turn rollover (`advanceRound` redraws order), sample one order via the threaded PRNG. (Information-set MCTS over hidden future draws is a deferred refinement.)
- **Leaf evaluation:** at a depth cutoff (configurable `maxDepth`) or terminal state, evaluate with the heuristic, mapped to an N-vector of pseudo-win-probabilities (terminal states use actual win=1/loss=0 for the winning coalition; non-terminal use a softmax over per-player heuristic scores). Optional short heuristic-guided rollouts behind a flag (default off — heuristic leaf eval is cheaper and deterministic).
- **Budget:** configurable `iterations` per move (default ~1000, tuned for sweep throughput). The chosen root action = most-visited child (robust to value noise).

### 4.3 Agent interface (`src/agent/mcts-agent.ts`)
`chooseActionMCTS(state, player, params): {action, state}` — same shape as `chooseAction`; reads/advances `state.rngState`; deterministic given the seed. `params` bundles `{iterations, candidateMode, C, α, maxDepth, temperature, evalWeights}`. The driver/sweep selects the agent (greedy vs MCTS-config-X) per player.

### 4.4 Evaluation harness (`src/eval/`)
- **Round-robin / Elo** (`arena.ts`) — play seeded matches between a set of agents (greedy, MCTS configs), report win-rates/Elo. This proves gate (2).
- **Robustness checker** (`robustness.ts`) — run a small fixed sweep (e.g. vary `autoWinAt6` and `killBounty`) under ≥ 2 MCTS configs; assert the *direction* of each gross signal agrees. Proves gate (3).
- **Exploiter probe** (`exploiter.ts`) — scripted exploiters (always-rush-iron; always-6-commit-attack); assert none reliably beats the MCTS agent. Proves gate (4).

### 4.5 Factory-clock investigation (first empirical step)
Before/while building MCTS, run the **improved-heuristic greedy** agent and measure the game-length / outcome distribution. If smart play (building perimeters, throttling factory-spam) does NOT lengthen games into real iron contests — i.e. the turn-3 mass-elimination is a *rules* artifact of the shared 18-factory death clock — tune `brokenPerimeterDeathAtFactories` (threshold and/or **per-player vs. shared placed-factory count**) until games are non-degenerate. This change is **authorized by Sam** (2026-05-27) and MUST be documented with before/after distributions in the plan's Discoveries and a `docs/pitfalls` or rules note. Gate (1) depends on this.

## 5. Data Flow

driver/sweep → `chooseActionMCTS(state, player, params)` → MCTS loops `iterations` times: **select** (max^n PUCT to a leaf) → **expand** (PW: sample a new complete action via `samplePolicy`; for attacks create a chance node) → **evaluate** (heuristic N-vector at cutoff/terminal) → **backup** (add the N-vector along the path) — using the pure engine as the simulator throughout → return most-visited root action + advanced PRNG.

## 6. Module Layout
```
src/agent/heuristic.ts      # evaluate() + samplePolicy()
src/agent/mcts.ts           # tree, selection, expansion (PW), chance nodes, backup
src/agent/mcts-agent.ts     # chooseActionMCTS(state, player, params)
src/eval/arena.ts           # round-robin / Elo
src/eval/robustness.ts      # cross-config signal-agreement check
src/eval/exploiter.ts       # scripted exploiter agents + probe
test/agent/heuristic.test.ts
test/agent/mcts.test.ts
test/agent/mcts-agent.test.ts
test/eval/*.test.ts
test/acceptance/mcts-trustworthy.test.ts   # the four gates
```
(Reuses, does not modify, the existing `src/engine/*`, `src/agent/{score,greedy,archetypes}.ts`, `src/driver/*`.)

## 7. Testing Strategy
- **Determinism:** same `(state, player, params, seed)` → identical action and advanced rng.
- **Chance-node correctness:** an attack node's backed-up value equals the `p`-weighted mix of its win/lose children (assert on a crafted small tree).
- **max^n backup:** each player's selection maximizes their own N-vector component (unit test on a hand-built tree).
- **Heuristic unit tests:** the perimeter-establishment term makes a perimeter-forming move outrank factory-spam in a fixture where greedy chose factories.
- **Policy sampling:** `samplePolicy` can (with non-trivial probability over seeds) sample a 4th-base perimeter build that greedy never composes.
- **Gate tests (`mcts-trustworthy.test.ts`):** (1) non-degenerate self-play distribution; (2) MCTS beats greedy ≥ target; (3) robustness across 2 configs; (4) exploiter probe. These may be slower (seeded, bounded game counts) — keep them deterministic; if a gate is statistically borderline, increase sample size, never loosen the gate.
- Seed every randomized test (testing-pitfalls §8); all property/gate tests deterministic by fixed seed.

## 8. Design Reasoning & Alternatives Considered

**Candidate-action approach — 5 options, adversarial review** (the load-bearing decision; full discussion 2026-05-27):

1. *Greedy-composed fixed set* — cheapest/fastest, but MCTS never searches *within* a build, so the 4th-base myopia fix lives entirely in the heuristic, not the search. Kept as the **throughput fallback** (`candidateMode:"fixed"`), valuable because it falls out of the policy at temperature→0.
2. *Per-piece micro-decision tree* — highest fidelity (searches full composition), but multiplies tree depth → convergence risk under budget (a starved MCTS can play *worse* than greedy) and lowest sweep throughput (fewer games → wider CIs). Kept as the **fidelity escalation** if composition quality is measured to be the bottleneck.
3. *Hand-designed macro DSL* — **rejected.** Macros encode default-rule assumptions; under a sweep that varies a parameter, macro competence covaries with that parameter, so the agent's bias correlates with exactly the variable under study — contaminating the balance conclusion in a near-invisible way. Fails the *purpose*, not just the budget. Also rots as rules change.
4. *PW over policy-sampled complete actions* — **chosen primary.** Bounded, tunable branching; samples diverse compositions (removing option 1's fixed-greedy blind spot); bias tracks the config-adaptive heuristic rather than hard-coded rules, so it's least likely to covary adversarially with a swept parameter; moderate cost.
5. *Hierarchical type-then-detail* — collapses toward 1/4 in practice (evaluating "attack" at the type node requires an instantiated attack below it), so its extra machinery buys little.

**Decisive lens:** two sweep-specific forces pull opposite — fidelity-per-move (favors 2) vs. games-per-hour→CI-width (favors 1). Rather than pick the theoretically-best abstraction blind, we pick a config-robust middle (4) and make the **trustworthiness harness (§4.4) the empirical arbiter**, escalating to 2 or dropping to 1 based on measurement.

**Alliance scope:** chose 2–6P with no alliance reasoning over (a) 2P-only (discards alliance-independent multiplayer signals — seat bias, length, snowball — for no benefit) and (b) a basic alliance model (pulls in the roadmap's hardest research module and balloons the milestone). Most sweep knobs are alliance-independent, so this covers the priority balance questions.

**Why not just a strong heuristic with no search?** Considered. A pure heuristic can't handle the multi-turn 4th-base *timing* tradeoff (the documented failure) — that genuinely needs lookahead. But the heuristic is still the dominant lever (every candidate option is heuristic-bounded), so the spec invests in it heavily; search adds the timing/threat reasoning the heuristic can't.

### What I'm still uncertain about
- **Whether the turn-3 death is agent- or rules-bound.** §4.5 is the experiment that decides; the factory-clock tuning is pre-authorized so it won't block.
- **Whether MCTS clears the trustworthiness bar at a sweep-affordable budget.** The fidelity/throughput tension is real; the fallback/escalation knobs + robustness harness are the hedge.
- **Leaf-eval → win-probability mapping.** Softmax-over-heuristic-scores is a reasonable first cut but uncalibrated; if robustness fails, this is a prime suspect to revisit (or add rollouts).

### What I'd add with more time
- Information-set MCTS for hidden future turn-order draws (currently determinized).
- Transposition table keyed by a canonical state hash (the engine is pure, so this is clean) for search efficiency.
