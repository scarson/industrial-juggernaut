# Stronger Agent: Heuristic MCTS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a determinized N-player max^n heuristic MCTS agent (2–6P, no alliance reasoning) that is *trustworthy for balance sweeps*, per `docs/superpowers/specs/2026-05-27-stronger-agent-mcts-design.md`.

**Architecture:** MCTS over the existing pure M1 engine as simulator; an improved perimeter-aware heuristic serves as leaf evaluation and as the stochastic action policy that drives progressive-widening candidate generation (spec's Option 4). Combat is exact-Bernoulli chance nodes; turn-order draws are determinized. Same `{action, state}` interface as the greedy agent. An eval harness (Elo arena, robustness checker, exploiter probe) measures the four "trustworthy" gates.

**Tech Stack:** TypeScript (strict), Node ≥ 20, Vitest, fast-check, tsx. Reuses `src/engine/*`, `src/agent/{score,greedy,archetypes}.ts`, `src/driver/*` unchanged (except the authorized factory-clock config/rule tweak in Phase A2). No runtime dependencies.

## Living Document Contract

This plan is a living document. Every executing agent MUST update it as
execution progresses, not only at completion.

- **On phase claim:** the executor MUST flip the banner to 🚧 IN PROGRESS
  with a claim timestamp (ISO 8601 UTC) and the active branch name. The
  banner MUST NOT include an expected-completion estimate — agents cannot
  reliably estimate their own wall-clock, and a fabricated duration
  becomes a stale anchor that misleads future readers. Followers
  encountering a 🚧 banner determine liveness by observable signals (PR
  existence, recent branch commits), not by arithmetic on expected times.
  See Step 5's stale-claim reclaim protocol.
- **On phase ship:** the executor MUST update that phase's **Execution
  Status** banner with the shipped commit SHA(s) and date. If a PR is
  open, the PR number and URL MUST appear in the top-of-plan Execution
  Status table.
- **On phase defer:** the executor MUST update the banner with ⏸ status
  AND a prose description of the unblock condition + a link to the
  likely-unblocker artifact (plan page, task, or PR whose own Execution
  Status banner will signal completion). Prose + link is durable across
  paraphrases and scope edits; exact-string coordination between agents
  is not.
- **On PR merge:** the executor MUST record the merge SHA in the banner
  + the top-of-plan Execution Status table.
- **On deviation from the written plan** (scope edits, structural
  refactors, dropped tasks, reordered phases): the executor MUST
  inline-document the deviation in the affected task AND summarize it
  in the top-of-plan Execution Status as a "Deviations" subsection.
  Deviation state MUST NOT live only in PR notes or status reports.
- **On discovery** (pre-existing drift surfaced during execution, new
  bugs found, architectural issues noted): the executor MUST add a
  "Discoveries" subsection at the top of the plan with pointers to the
  files/lines affected. Follow-up dispatches read this subsection to
  avoid duplicate discovery work.

The plan SHOULD reflect reality at the end of every session that touches
it. Anything worth putting in a status report to the user is worth
putting in the plan.

Rationale: `/writing-plans-enhanced` Step 5. Writing at ship time is
cheap; reconstruction by downstream readers is expensive, compounds
across dispatches, and fails silently when state is split across PR
notes and commit messages.

---

## Execution Status

**Overall:** 🚧 In progress — A1, A2 (PR #9 `7749f3e`), A3, A4 shipped; A5 claimed 2026-05-27. 300 tests green.

| Phase | Status | Ship SHA(s) | Notes |
|---|---|---|---|
| A1 — Improved heuristic | ✅ Shipped | `f5b838d`,`5b9ce56` | evaluate() + samplePolicy(); 235 tests green |
| A2 — Factory-clock investigation + tuning | ✅ Shipped | `41c1056` (A2.2); `fe664f2`,`ba94212` (A2.1) | per-player factory clock, threshold 18→8; 240 tests green |
| A3 — MCTS core | ✅ Shipped | `9f31613`,`75a87ae`,`1a1328a`,`47a0640` | tree/max^n/PUCT, PW+chance+determinized, basesInHand fix, leaf-eval+search loop+stepRound; 287 tests |
| A4 — MCTS agent interface | ✅ Shipped | `6a475e7`,`4c5e297` | chooseActionMCTS + IS-MCTS legality fix; 300 tests |
| A5 — Eval harness | 🚧 In progress | — | branch `claude/document-game-design-VpqqB` |
| A6 — Trustworthiness gates (acceptance) | ⬜ Not started | — | — |

### Deviations
- A2.1 pulled the A5.1 `agentFor` driver seam forward (A2 needs to run arbitrary agents through the real driver; duplicating the loop would risk divergence). Committed 5 files incl. `src/driver/record.ts` (the `RunOptions.agentFor?` type field lives there) — additive, acceptance test stays green. A5.1 will find the seam already present.

### Discoveries
- **A5.x — TRUE ROOT CAUSE found + fixed (commit `5caf744`): the 2nd base was impossible.** `isLegalBasePlacement` required a two-visible-bases triangle for ALL outside-perimeter placements, but `setupGame` starts each player at 1 base → 0 legal base placements → no player ever grew past 1 base → forced factory-spam → factory-death. The A2 factory-clock change and the A5.1 survival penalty were both treating symptoms of THIS. Fixed (Option 1): triangle rule applies only at ≥3 existing bases (perimeter-establishing 4th+); radiating 2nd/3rd need only proximity. Distribution transformed: 2P iron victories 0→200, maxBases 1→11; 2–6P empty-coalition 17→0; 1000-game acceptance `iron:1000, last-standing:0, capHits:0`. Rules doc clarified.
  - **NEW design crossroads (BLOCKED on Sam's direction — beyond factory-clock authorization):** with base-growth working, games now resolve in ~1 TURN (acceptance `turnsHistogram {1:184,2:14,...}`, maxTurns 1) — iron victory is too fast/easy (10-iron threshold vs 14 board iron + a 4-base perimeter enclosing most of it in one turn). This is a BALANCE issue (a "Variables to Test" item: victory threshold / iron count / build budget), and it makes gate (2) uninformative: a 1-turn iron-rush has no depth for lookahead, and MCTS@60 iters now LOSES to the competent greedy baseline 0/20 (Elo 1334 vs 1665). Whether MCTS adds value (and whether the learned agent is warranted) cannot be assessed until balance gives games strategic depth. Surfaced to Sam for direction.
- **A5.1 — greedy baselines self-eliminate in 2P; heuristic undervalues survival → fixing `evaluate` (Option 1).** Arena diagnosis: both `greedyAgent` and `heuristicAgent` compose multi-piece factory builds crossing the per-player factory-death threshold (8) while `<4` bases → self-destruct at turn 3. So "MCTS beats greedy 20/0 (Elo 1665 vs 1335, 60 iters)" is *partly* MCTS avoiding a multi-turn trap greedy can't see (legit search value) and *partly* a broken baseline. Root cause: `evaluate` rewards factories + perimeters but does NOT penalize the imminent-self-destruct state, so myopic agents walk into it; it also mis-scores MCTS leaf-eval at the cutoff and risks factory-over-build distortion in sweeps. Decision (5-option adversarial): add a survival penalty to `evaluate` (penalize ≥threshold controlled factories while `<4` bases, ramped), then re-measure. Also: the game has a strong ~60/40 first-mover/seat advantage at 2P default — eval pairings need a skill gap exceeding it or seat-balanced counts (arena already rotates seats). MCTS-vs-greedy signal must use the *competent* baseline once `evaluate` is fixed.
- **A4.1 — MCTS crashes under stochastic transitions (varying legal sets); fixing with IS-MCTS legality filtering.** `runMcts` opens/validates a node's edges against the state from its FIRST visit, but combat chance outcomes + determinized turn-order draws (threaded across iterations) route a DIFFERENT state to the same node on later iterations → a stale edge action becomes illegal → `applyAction` throws on varied mid-game/attack-legal boards. Reachable; would crash A5/A6's many-game runs. Decision (5-option adversarial): re-validate edges against the current-iteration state at selection, select only currently-legal edges, expand from current state if under-populated, never apply an illegal action (standard determinized/IS-MCTS). Turn-order-as-chance-nodes rejected (branching explosion); freeze-state / deterministic-turn-order rejected (bias the search away from the real game → hurts trustworthiness).
- **A4.1 — no MCTS-beats-greedy divergence on crafted fixtures (open question for A6 gate 2).** The perimeter-aware heuristic already fixes greedy's 4th-base myopia, so greedy composes valid perimeters too; on the one-ply `evaluate`, greedy's area-max placement scores ≥ MCTS's compact one. Whether MCTS beats greedy *over many games* (gate 2) is now genuinely open — the Elo arena (A5) decides it. If MCTS does NOT beat greedy, that itself is a finding (the heuristic may suffice for sweeps; search adds little).
- **A3.2 — engine self-consistency bug found + fixed (commit `1a1328a`).** `legalActions` emitted base-build placements without gating on `basesInHand`, so a maxed-out player (0 bases in hand) got actions `applyAction` rejects — a `legalActions ⊆ applyAction-acceptable` violation reachable in late game. Root-caused to `isLegalBasePlacement` (now returns false at `basesInHand===0`); self-consistency test strengthened with a maxed-out fixture.
- **A3.3 — MCTS expansion O(iterations²) trap (fixed, inline-documented in `runMcts`).** Naively re-calling `expandNode` on every node visit re-paid the full policy-sampling budget as `node.N` grew → quadratic hang (200 iters never finished). Fixed with a per-node saturation cache (stop re-expanding a node once a call adds no new edge): 400 iters in ~190ms, linear. Candidate `docs/pitfalls` entry for a future pass.
- **A2.2 — per-player factory-death clock fixes the rules-bound degeneration.** Implemented the authorized Option-4 change: `brokenPerimeterAt18Factories` now fires on the player's OWN controlled-factory count (`control(state,p).factories.length >= config.brokenPerimeterDeathAtFactories`, gated on `<4` bases) instead of the shared placed-pool (`36 − factorySupply`). Default threshold recalibrated **18 → 8** (per-player scale). `EliminationCause` name preserved (the "18"/"shared" is now historical). See `src/engine/status.ts` `applyEliminations`, `src/engine/config.ts`, `docs/pitfalls/implementation-pitfalls.md` GEO-6.
  - **Step-1 diagnostic (confirms root cause).** Cause breakdown over the A2.1 batch (200 games, 2–6P, seed 1n, default config): `{ brokenPerimeterAt18Factories: 590 }` — the SOLE elimination cause. Disabling the clock (`threshold=999`) lengthened games from turns `{1:111,2:49,3:40}` to `{1:48,301:152}` (152 cap-hit stalls), iron victories flat at 48 → the shared clock both *caused* the turn-3 wipeouts AND was the only thing terminating the other 152 games. Degeneration confirmed rules-bound.
  - **Threshold sweep (200 games, 2–6P, heuristic-greedy, seed 1n).** Iron victories stay at 48 across all thresholds (iron rushes resolve before the clock matters); the clock governs how the OTHER 152 games end. empty-coalition wipeouts / cap-hits by threshold: `4→33/0`, `5→47/0`, `6→48/0`, **`8→17/0`**, `10→26/4`, `12→51/40`. Chose **8** — minimum empty-coalition wipeouts with zero turn-cap stalls.
  - **Before → after (heuristic-greedy, same batch).** Before (shared, threshold 18): `{last-standing:152 (ALL empty-coalition), iron:48}`, turns `{1:111,2:49,3:40}`, 0 caps — degenerate turn-3 mass-elimination. After (per-player, threshold 8): `{last-standing:152, iron:48}`, **emptyWinner 152→17, realWinner 48→183**, turns `{1:48,2:117,3:35}`, 0 caps. Decoupling converted simultaneous empty-coalition wipeouts into sequential eliminations with REAL winners; 91.5% of games now end with a real winner, all 48 turn-1 games are decisive iron victories (not degeneracies), games extend past turn 1, nothing stalls.
  - **1000-game greedy acceptance shift (`play-many.test.ts`).** Old finding was degenerate; new distribution `{iron:242, last-standing:757, none:1}`, emptyWinner 76, realWinner 924, capHits 1. The test's only assertion (`capHits < 50`) still holds with huge margin — no assertion change needed (the test never encoded the old degenerate distribution; it prints it via console.log).
  - **Calibration for gate (1):** post-tuning real-contest data is the source for A6 gate (1)/(2) thresholds. iron victories ≈ 24% (48/200) heuristic-greedy; 4P/5P carry the iron contests (24/40, 21/40), 2P resolves last-standing, 6P rarely reaches iron.
- **A2.1 — turn-3 mass-elimination is RULES-bound, not agent-bound.** Heuristic-greedy self-play (200 games, 2–6P, seed 1n): `{last-standing: 152 (all empty-coalition), iron: 48}`, turns histogram `{1:111, 2:49, 3:40}`, 0 cap hits. The improved perimeter-aware heuristic did NOT lengthen games — they still collapse by turn 3 via simultaneous `brokenPerimeterAt18Factories` elimination of all <4-base players, driven by the SHARED placed-factory count (one player's factory-spam advances the death clock for everyone). 24% reach real iron victories. → proceed with A2.2 factory-clock tuning (see A2.2 for the 5-option decision).

---

## Conventions Applied to EVERY Task

These conventions are part of every task below by reference (not repeated per-task, to stay scannable).

**TDD (mandatory, every code task):**
```
BEFORE starting work:
1. Invoke /superpowers:test-driven-development
2. Read docs/pitfalls/testing-pitfalls.md (esp. §8 Engine Determinism & Geometry)
Follow TDD: write a failing test → run it red → implement minimal code → run it green.

BEFORE marking this task complete:
1. Review tests against docs/pitfalls/testing-pitfalls.md
2. Verify coverage (error paths? edge cases? boundary values?)
3. Run the full suite and confirm green; run npm run typecheck (clean, strict).
```

**Assertion rigor (CRITICAL — this milestone is statistics-heavy):**
```
Many tests here are randomized/statistical (win-rates, outcome distributions,
sampling). If an assertion races, flakes, or fails nondeterministically, the
fix is deterministic control of inputs (fix the seed) or MORE SAMPLES — NOT
assertion removal or threshold-loosening. A statistical gate that is
borderline gets a larger sample size, never a weaker bound. If a gate cannot
be made to pass reliably with a fixed seed and a reasonable sample, STOP and
raise to the dispatching agent — a failing trustworthiness gate is a real
finding (agent too weak, or a bug), not a test to soften. Commit subjects
touching assertions say "add"/"strengthen"/"preserve"/"weaken(rationale)".
```

**End of each phase (logical group):**
```
After completing this phase: review the batch from ≥3 perspectives.
If round 3 still finds issues, keep going until clean.
Then update this plan's Execution Status banner + table for the phase.
```

**Global do-NOT boundaries:**
- Do NOT change the BEHAVIOR of existing `src/engine/*` modules EXCEPT the single authorized factory-clock change in Phase A2 (config default and/or the `applyEliminations` shared-vs-per-player count). Adding the NEW pure orchestration helper `src/engine/round.ts` in A3.3 — which only *composes* existing engine functions, changing no rule — is allowed, and keeps layering clean (both the driver and the MCTS agent depend downward on it). If you want any other engine change, STOP and raise it.
- Do NOT add runtime dependencies. Do NOT use `Math.random` — all randomness threads through the seeded PRNG in `src/rng/pcg.ts` (GEO-3).
- Do NOT relax `tsconfig` strictness. Do NOT key hex Sets/Maps by object identity — use `key()` (GEO-4).
- Do NOT cache derived state (perimeter/control) across mutations — recompute (GEO-5).
- Do NOT consume the game's main PRNG with thousands of search draws in a way that breaks driver replay: derive an internal search RNG from `state.rngState` and advance the returned `state.rngState` deterministically (see A4).

**Board-coordinate discovery (carried from the engine build):** the generated seed-1n/size-96 board is a 93-hex asymmetric oval; several hand-picked coords are off-board (`(0,5,-5)`,`(8,-8,0)` off; `(0,0,0)`,`(2,-2,0)`,`(4,-4,0)`,`(5,-5,0)`,`(6,-6,0)`,`(0,4,-4)` on). Use on-board coords or union via `mkState`'s `iron`/base arrays in fixtures.

**Shared `Agent` interface (define once in A1, used by A2/A5/A6):** all agents are normalized to a single closure type `type Agent = (state: GameState, player: PlayerId) => { action: Action; state: GameState }`. Each agent family exposes a *factory* that binds its config and returns an `Agent`: `greedyAgent(archetype)`, `heuristicAgent(params)` (A2.1), `mctsAgent(params)` (A4.1), and the scripted exploiters (A5.2). The arena/robustness/exploiter harnesses consume `Agent` closures only — they never branch on agent kind. Put the `Agent` type in `src/agent/agent.ts` (new, tiny) in Task A1.1 so every later task imports the same definition.

---

## Phase A1 — Improved Heuristic

**Execution Status:** ✅ SHIPPED on 2026-05-27 (commits `f5b838d` evaluate(), `5b9ce56` samplePolicy(); 235 tests green)

The perimeter-aware evaluation + stochastic policy that every later phase depends on. This is the dominant lever for the 4th-base-myopia fix.

### Task A1.1: `evaluate(state)` position evaluator

**Files:** Create `src/agent/agent.ts` (the shared `Agent` type + a `greedyAgent(archetype)` adapter that wraps the existing `chooseAction`), `src/agent/heuristic.ts`; Test `test/agent/heuristic.test.ts`.

Available: `src/engine/control.ts` (`control`), `src/engine/config.ts` (`RuleConfig`), `src/engine/build.ts` (`farthestBases`), `src/geometry/hull.ts` (`convexHull`, `hullArea`), `src/agent/greedy.ts` (`chooseAction`), `src/engine/types.ts`. Define `export type Agent = (state: GameState, player: PlayerId) => { action: Action; state: GameState }` in `agent.ts`; each agent family's factory (`greedyAgent` here; `heuristicAgent`/`mctsAgent`/exploiters later) lives with its agent and returns an `Agent`.

- [ ] **Step 1: failing tests** for `evaluate(state, weights?): number[]` (one score per player). Define `export interface HeuristicWeights { iron; fact; area; tempo; perimeter; frontier }` with a `defaultHeuristicWeights()`. Assert:
  - controlled iron dominates: a player controlling more iron scores higher, all else equal.
  - **perimeter-establishment term:** in a fixture where player P has 3 radiating bases and could place a 4th to form a valid (non-degenerate, iron-enclosing) perimeter, `evaluate` of the post-4th-base state scores P higher than the 3-base state — even if controlled-iron is momentarily equal — because the `perimeter` feature rewards a valid 4-base hull. (This is the anti-myopia property; construct with on-board coords via mkState.)
  - distance-to-`victoryThreshold` raises score as iron approaches the threshold.
  - eliminated players score 0 (or lowest).
- [ ] **Step 2: run red** — `npx vitest run test/agent/heuristic.test.ts` (module missing).
- [ ] **Step 3: implement** `evaluate`: per player, a weighted sum of features computed from `control` + hull: controlled iron, controlled factories, `hullArea` of the player's bases (0 if <4 or degenerate), a `perimeter` indicator/bonus for holding a valid 4-base perimeter that encloses ≥1 iron, a `tempo` count of fresh bases, and a `frontier` exposure penalty (count of the player's perimeter/board-border hexes adjacent to opponent-controlled hexes). Pure; key by `key()`.
- [ ] **Step 4: green + typecheck.** Commit `feat: perimeter-aware position heuristic`.

### Task A1.2: `samplePolicy(state, player, rng, temperature)` stochastic action policy

**Files:** Modify `src/agent/heuristic.ts`; Test `test/agent/heuristic-policy.test.ts`.

Available additionally: `src/engine/legal.ts` (`legalActions`), `src/engine/build.ts` (`buildBudget`), `src/agent/score.ts` (`scoreMove`, `Weights`), `src/engine/apply.ts` (`applyAction`), `src/rng/pcg.ts` (`nextFloat`).

- [ ] **Step 1: failing tests** for `samplePolicy(state, player, rng, temperature): { action: Action; rng: RngState }`:
  - returns a complete legal `Action` that `applyAction` accepts (no throw), for several fixtures.
  - deterministic given the rng/seed.
  - at `temperature → 0` it returns the argmax (greedy) action — reproducing the Option-1 greedy composer as a sub-case.
  - at higher temperature, over many seeds it samples ≥2 distinct actions in a fixture with multiple good options (diversity), AND can (with non-trivial frequency) sample a 4th-base perimeter-forming build that the temperature→0 greedy never composes (the anti-fixed-greedy property — construct a fixture where greedy composes factories but a base-perimeter build is also legal and decent).
- [ ] **Step 2: run red.**
- [ ] **Step 3: implement** `samplePolicy`: (a) compute candidate round-types (factory-build, base-build, attack, pass) available given `buildBudget`/`legalActions`; (b) for builds, compose a multi-piece build by sampling placements proportional to `softmax(perPieceScore / temperature)` over legal single placements of that type, capped at `buildBudget(state)`, recomputing legality against the progressively-built hypothetical (reuse the pattern from `greedy.ts`); (c) for attacks, sample among the representative attacks weighted by `scoreMove`; (d) pick the round-type weighted by the heuristic-estimated value of its sampled instance. Thread `rng` through every draw (GEO-3); no `Math.random`.
- [ ] **Step 4: green + typecheck.** Commit `feat: stochastic heuristic action policy (samplePolicy)`.

**End of Phase A1:** ≥3-round review; update Execution Status.

---

## Phase A2 — Factory-Clock Investigation + Authorized Tuning

**Execution Status:** ✅ SHIPPED on 2026-05-27 (branch `claude/document-game-design-VpqqB`). A2.1 measured the rules-bound degeneration; A2.2 applied the authorized per-player factory-death clock (threshold 18→8) — 240 tests green, typecheck clean. Before/after distributions in Discoveries; rule note in `docs/pitfalls/implementation-pitfalls.md` GEO-6.

Empirically determine whether the M1 turn-3 mass-elimination is agent-bound or rules-bound, and apply the **Sam-authorized (2026-05-27)** factory-clock tuning if needed. This gates trustworthiness gate (1).

### Task A2.1: measure game-length/outcome distribution under the improved heuristic-greedy

**Files:** Create `src/eval/measure.ts` (a small reusable measurement helper) + a script/test `test/eval/distribution.test.ts`.

- [ ] **Step 1:** write a helper `measureDistribution(opts): { byVictoryType; emptyWinner; realWinner; turnsHistogram; capHits }` that runs N seeded games via `runGame` using a **heuristic-greedy agent** — i.e. a `chooseAction`-shaped wrapper around `samplePolicy(..., temperature→0)`. (Create `src/agent/heuristic-agent.ts` exposing `chooseActionHeuristic(state, player, params)` for this; it's also reused in A5.)
- [ ] **Step 2:** as a TEST, run a modest batch (e.g. 200 games across 2–6P) and ASSERT the structural shape of the result (rows/types present), AND `console.log` the distribution + turns histogram. This test documents the *current* (post-improved-heuristic, pre-tuning) behavior.
- [ ] **Step 3: commit** `feat: game-distribution measurement helper + heuristic-greedy agent`.
- [ ] **Step 4 (analysis, in the plan not code):** record the observed turns histogram in this plan's Discoveries. If a clear majority of games STILL end by mass-elimination before any iron contest (turns ≤ ~3, mostly empty-winner), proceed to A2.2; if smart play already de-degenerates games, SKIP A2.2 and note that the M1 finding was agent-bound (mark A2.2 ⏸ DEFERRED — not needed).

### Task A2.2 (conditional): tune the factory-death clock

**Files:** Modify `src/engine/config.ts` (default) and/or `src/engine/status.ts` (`applyEliminations` shared-vs-per-player factory count). Test: extend `test/engine/status.test.ts` + re-run `test/eval/distribution.test.ts`.

- [x] Implemented Option (b) per-player decoupling: the death trigger counts the player's OWN controlled factories (`control(state,p).factories.length >= threshold`), gated on `<4` bases — replacing the shared `36 − factorySupply` count. Unit tests in `status.test.ts` lock the per-player semantics (eliminate ≥threshold / survive <threshold incl. a discriminating shared-vs-per-player fixture / ≥4-base never hit). Default threshold recalibrated 18→8 by experiment (minimum empty-coalition wipeouts, zero stalls). Before/after histograms in Discoveries; rule note added as GEO-6 in `docs/pitfalls/implementation-pitfalls.md`.
- [x] Committed `fix: per-player factory-death clock so smart play reaches iron contests (authorized rule tuning)`.

**End of Phase A2:** ≥3-round review; update Execution Status (and the conditional banner for A2.2).

---

## Phase A3 — MCTS Core

**Execution Status:** ✅ SHIPPED on 2026-05-27 (commits `9f31613`,`75a87ae`,`1a1328a` (engine self-consistency fix),`47a0640`; 287 tests green)

Determinized N-player max^n MCTS over the pure engine. Behavior+signature level per the design; the executor writes complete tests for every enumerated behavior before implementing.

### Task A3.1: tree + max^n backup + PUCT selection

**Files:** Create `src/agent/mcts.ts`; Test `test/agent/mcts.test.ts`.

- [ ] TDD behaviors (write complete failing tests first):
  - Node holds visit count `N`, per-edge `{action, childVisits, valueVec: number[]}`, and an N-vector value. `backup(path, leafValueVec)` adds the leaf N-vector along the path.
  - **max^n selection:** a unit test on a hand-built 2-level tree where player 0 acts at the root and player 1 at depth 1 asserts each node's chosen child maximizes the ACTING player's own vector component via PUCT (use a fixed exploration constant; assert the deterministic pick for crafted stats).
  - PUCT formula with a configurable `c_puct`, prior from the policy (uniform prior acceptable for this unit task; policy-prior wired in A3.2).
- [ ] Implement; pure data structures + functions, no `Math.random`. Commit `feat: MCTS tree, max^n backup, PUCT selection`.

### Task A3.2: expansion (progressive widening via samplePolicy) + chance nodes + determinized turn order

**Files:** Modify `src/agent/mcts.ts`; Test extends `test/agent/mcts.test.ts`.

- [ ] TDD behaviors:
  - **Progressive widening:** a node opens `k = ceil(C * N^α)` children (defaults `C=2, α=0.5`, configurable); each new child is a complete legal action from `samplePolicy(state, player, rng, temperature)`, deduped by a canonical action key. Assert child count grows with visits per the PW formula and that all opened children are `applyAction`-acceptable.
  - **Chance nodes (combat):** when the expanded action is an `attack`, create a chance node holding both outcome children — the deterministic win-state and lose-state (build each WITHOUT a PRNG draw, since the two branches are enumerable). Use the **standard sample-per-simulation** scheme: on each simulation that reaches the chance node, pick the win branch with probability `p = combatTable[commit]` and the lose branch with `1−p`, drawn from the search RNG; ordinary visit-count averaging then makes the backed-up value converge to the `p`-weighted expectation over many simulations (do NOT also re-weight in backup — that would double-count). Unit-test: over N seeded simulations through a chance node with known `p`, the empirical win/lose visit split is within tolerance of `p:(1−p)` (a statistical assertion — size N so it's comfortable; per the assertion-rigor convention, grow N if borderline, don't loosen). Also expose a pure `expectedValue(chanceNode)` helper (= `p·win + (1−p)·lose`) and unit-test it exactly on a crafted node, so the expectation logic is verified deterministically and independently of the sampling.
  - **Determinized turn order:** when a simulation step crosses a turn rollover (`advanceRound` redraws order), the order is drawn via the search RNG (determinized per simulation). Assert determinism given a fixed search seed.
  - `candidateMode: "fixed"` flag: replaces PW-sampling with a fixed candidate set (greedy-composed builds + representative attacks + pass) — assert it yields a bounded child set and all-legal actions. (Throughput fallback; spec §4.2.)
- [ ] Implement. Document the chance-node expectation-vs-simulation handling inline. Commit `feat: MCTS expansion (progressive widening), combat chance nodes, determinized turn order`.

### Task A3.3: leaf evaluation + the search loop

**Files:** Modify `src/agent/mcts.ts`; Test extends `test/agent/mcts.test.ts`.

- [ ] TDD behaviors:
  - **Leaf eval:** at a configurable `maxDepth` cutoff or a terminal state, produce an N-vector: terminal → actual win=1/loss=0 per the winning coalition from `status`; non-terminal → softmax over `evaluate(state)` per-player scores (pseudo win-probs summing to 1). Unit-test terminal and non-terminal mappings.
  - **Shared round-step (correctness + DRY):** the MCTS simulation MUST advance a round exactly as the live driver does, or its value estimates are biased. Extract the driver's per-round body into a shared pure helper `stepRound(state, action): { state, events }` = `applyAction` → `applyEliminations(state, actingPlayer)` → `removeEncircledStrandedBases` (status-check + `advanceRound` stay with the caller). Refactor `src/driver/run.ts` to call `stepRound` (keeping the 1000-game acceptance test green — run it), and have the MCTS simulation call the SAME `stepRound`. Put `stepRound` in `src/engine/round.ts` (new). This task therefore also modifies `src/driver/run.ts` — note that A5.1 also touches `run.ts` (different region, later phase, sequenced — no parallel conflict).
  - **Search loop** `runMcts(state, player, params, searchRng): { rootStats }` runs `iterations` of select→expand→evaluate→backup using `stepRound`/`advanceRound`/`status` as the simulator; returns root edge statistics. Assert: deterministic given seed; the most-visited root action is `applyAction`-acceptable; on a tiny crafted decision (one obviously-winning move) the search concentrates visits on it.
- [ ] Implement. Commit `feat: MCTS leaf evaluation and search loop`.

**End of Phase A3:** ≥3-round review (this phase has the most internal coupling — verify chance-node + determinization + backup interact correctly); update Execution Status.

---

## Phase A4 — MCTS Agent Interface

**Execution Status:** ✅ SHIPPED on 2026-05-27 (commits `6a475e7` chooseActionMCTS, `4c5e297` IS-MCTS legality fix; 300 tests green)

### Task A4.1: `chooseActionMCTS`

**Files:** Create `src/agent/mcts-agent.ts`; Test `test/agent/mcts-agent.test.ts`.

- [ ] TDD behaviors:
  - `chooseActionMCTS(state, player, params): { action, state }` where `params = { iterations, candidateMode, C, alpha, maxDepth, temperature, evalWeights, cPuct }` (provide `defaultMctsParams()`). Returns the most-visited root action and a `state` whose `rngState` is advanced DETERMINISTICALLY by exactly ONE step (`nextUint32(state.rngState).state`), while the search itself runs on a SEPARATE INTERNAL rng derived from the incoming state rng (`const searchRng = seed(nextUint32(state.rngState).value's-derived-bigint)` — concretely `seed(BigInt(nextUint32(state.rngState).value) ^ SALT)`). This keeps the driver's main PRNG stream from being bloated by thousands of search draws while staying fully deterministic (see global do-NOT). `mctsAgent(params)` returns the shared `Agent` closure. Same `{action, state}` shape as greedy's `chooseAction`, so the driver uses it interchangeably.
  - **Determinism:** same `(state, player, params, seed)` → identical action AND identical returned `rngState` across two calls.
  - **Returns a legal action:** `applyAction(state, action)` does not throw (loop over several fixtures).
  - **Beats greedy locally:** in a crafted mid-game fixture where there's a clearly-correct move greedy gets wrong (e.g. the 4th-base timing), low-iteration MCTS picks the better move. (Deterministic, fixed seed.)
- [ ] Implement. Commit `feat: MCTS agent (chooseActionMCTS)`.

**End of Phase A4:** ≥3-round review; update Execution Status.

---

## Phase A5 — Eval Harness

**Execution Status:** 🚧 IN PROGRESS — claimed 2026-05-27 (branch `claude/document-game-design-VpqqB`)

### Task A5.1: Elo / round-robin arena

**Files:** Create `src/eval/arena.ts`; Modify `src/driver/run.ts` (add the agent seam below); Test `test/eval/arena.test.ts`.

**Driver agent seam (concrete, back-compat):** `runGame` currently maps `archetypes: string[]` → greedy agents internally. Add ONE optional field to `RunOptions`: `agentFor?: (player: PlayerId) => Agent` (the shared `Agent` type). In `runGame`, if `agentFor` is provided, obtain each acting player's agent from it; otherwise fall back to the existing archetype→greedy path UNCHANGED. This is purely additive — the existing 1000-game acceptance test (which passes `archetypes` and no `agentFor`) MUST stay green (run it to confirm). Do NOT remove or alter the `archetypes` path.

- [ ] TDD behaviors: `roundRobin(agents, opts): { winRates; elo }` plays seeded matches between named agents across configured player counts; deterministic given seed; win-rates sum correctly; a strictly-dominant scripted agent gets a higher win-rate than a random one (sanity). Commit `feat: round-robin arena + Elo`.

### Task A5.2: robustness checker + exploiter probe

**Files:** Create `src/eval/robustness.ts`, `src/eval/exploiter.ts`; Tests `test/eval/robustness.test.ts`, `test/eval/exploiter.test.ts`.

- [ ] TDD: `checkRobustness(signals, configsA, configsB): {agree: boolean; perSignal}` runs a tiny fixed sweep (vary `autoWinAt6` and `killBounty`) under two MCTS configs and reports whether the *direction* of each gross signal agrees. Exploiter agents (`alwaysRushIron`, `alwaysMaxCommitAttack`) as `chooseAction`-shaped policies; `probeExploiters(mctsAgent, opts): {worstExploiterWinRate}`. Deterministic; structural assertions. Commit `feat: robustness checker + scripted exploiter probe`.

**End of Phase A5:** ≥3-round review; update Execution Status.

---

## Phase A6 — Trustworthiness Gates (Acceptance)

**Execution Status:** ⬜ NOT STARTED

### Task A6.1: the four gates

**Files:** Test `test/acceptance/mcts-trustworthy.test.ts`.

**Tractability:** MCTS self-play is far slower than the greedy 1000-game run (each move runs `iterations` engine simulations). Keep these gate tests tractable: use a MODEST per-move iteration budget and a few-hundred (not thousands) game count — enough for the bounds with margin, sized per the assertion-rigor convention — and a generous Vitest timeout (e.g. `300_000`). The gates validate the agent *config that sweeps will actually use*; pick that config's budget here. If runtime is still impractical, reduce game count before reducing iterations (search quality matters more than sample count for gates 2/4), and note the choice.

**Calibration:** set gate (1)'s minimum real-contest fraction and gate (2)'s win-rate thresholds from the POST-A2 measured distribution (with margin) — i.e. read the actual numbers A2 recorded in Discoveries and pick thresholds comfortably below the observed values, rather than inventing them. If A2 showed the degeneration was agent-bound (A2.2 skipped), 2P games are already non-degenerate and gate (2)'s 0.70 applies directly.

- [ ] Assert the four operationalized gates from the spec, each seeded and deterministic, with sample sizes chosen so the bound is comfortably met (per the assertion-rigor convention — increase samples if borderline, never loosen):
  1. **Non-degenerate:** MCTS self-play across 2–6P yields a real outcome distribution (a clear fraction of games reach iron contests / iron victories; NOT ~100% turn-3 empty-winner). Assert a minimum real-contest fraction (set from A2's post-tuning data with margin).
  2. **Beats greedy:** `roundRobin([mcts, greedy])` → MCTS win-rate ≥ 0.70 in 2P and a positive margin in 3–6P.
  3. **Robustness:** `checkRobustness` over ≥2 MCTS configs → all gross signals agree in direction.
  4. **No trivial exploit:** `probeExploiters` → worst exploiter win-rate ≤ 0.50.
- [ ] If any gate fails, that is a REAL finding — STOP and raise it (agent too weak / config wrong / a bug), do NOT loosen the gate. Possible responses (per spec): escalate to Option-2 fidelity (per-piece build search), revisit the leaf-eval→win-prob mapping, retune the heuristic, or adjust search budget.
- [ ] Commit `test: MCTS trustworthiness acceptance gates`.

**End of Phase A6:** ≥3-round review; update Execution Status; mark Overall complete.

---

## Self-Review (writing-plans step, completed at authoring time)

**Spec coverage:** heuristic + perimeter term (§4.1)→A1; factory-clock investigation+tuning (§4.5)→A2; MCTS core — max^n/PUCT/PW/chance/determinization/leaf-eval (§4.2)→A3; agent interface (§4.3)→A4; eval harness — arena/robustness/exploiter (§4.4)→A5; the four gates (§1)→A6; candidate-mode fallback (Option 1) wired in A3.2; Option-2 escalation referenced in A6 as the failure response. Every spec section maps to a task.

**Placeholder scan:** no "TBD/handle appropriately"; behaviors specify concrete properties. A2.2 is explicitly conditional (gated on A2.1's measurement) with a defined skip/defer rule — flagged, not vague.

**Type consistency:** `HeuristicWeights`/`evaluate`/`samplePolicy` (A1) consumed by `mcts` (A3) and `mcts-agent` (A4); `MctsParams`/`defaultMctsParams` defined in A4 and used in A5/A6; `chooseActionMCTS` returns `{action, state}` matching the greedy `chooseAction` shape the driver expects; the `runGame` agent-injection seam (A5.1) is called out as a driver touch-point with a back-compat constraint (keep `archetypes` path + acceptance test green).
