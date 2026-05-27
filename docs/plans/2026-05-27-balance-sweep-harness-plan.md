# Balance-Sweep Harness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An offline harness that (1) **finds a balanced multi-turn game config** (unblocking the MCTS trustworthiness gates) and (2) answers the design-critique's balance questions, per `docs/superpowers/specs/2026-05-27-balance-sweep-harness-design.md`.

**Architecture:** Deterministic, seeded, CRN-based runner over `RuleConfig` variations driven by `heuristicAgent`; a metrics layer; a config-health gate + composite rank (the balanced-config search via a geometry grid); OFAT balance sweeps; a markdown report. Reuses the engine, driver `agentFor` seam, and `measureDistribution` unchanged.

**Tech Stack:** TypeScript (strict), Node ≥ 20, Vitest, fast-check, tsx. No runtime deps.

## Living Document Contract

This plan is a living document. Every executing agent MUST update it as
execution progresses, not only at completion.

- **On phase claim:** the executor MUST flip the banner to 🚧 IN PROGRESS
  with a claim timestamp (ISO 8601 UTC) and the active branch name. The
  banner MUST NOT include an expected-completion estimate. Followers
  determine liveness by observable signals (PR existence, recent commits),
  not time arithmetic. See Step 5's stale-claim reclaim protocol.
- **On phase ship:** update that phase's Execution Status banner with the
  shipped commit SHA(s) and date; if a PR is open, record PR #/URL in the
  top-of-plan table.
- **On phase defer:** ⏸ status + prose unblock condition + link to the
  likely-unblocker artifact (durable across paraphrase/scope edits;
  exact-string coordination is not).
- **On PR merge:** record the merge SHA in the banner + top-of-plan table.
- **On deviation:** inline-document in the affected task AND summarize in a
  top-of-plan "Deviations" subsection (not only in PR notes).
- **On discovery:** add a top-of-plan "Discoveries" subsection with
  file/line pointers so follow-ups avoid duplicate work.

The plan SHOULD reflect reality at the end of every session that touches it.
Rationale: `/writing-plans-enhanced` Step 5 — writing at ship time is cheap;
downstream reconstruction is expensive and fails silently.

---

## Execution Status

**Overall:** 🟡 S1–S4 shipped; S5 ran 2026-05-27 — **MAJOR FINDING: no healthy config exists anywhere in the wide grid** (heuristicAgent, 64 cells, refined nearest-misses at 150 games). The game does not have a balanced multi-turn region under these health thresholds + this agent; it likely needs a deeper redesign (see S5.1 Discovery). The MCTS trustworthiness gates (A5.2/A6) remain BLOCKED — there is no data-driven balanced "A" to re-validate them on. Spec/plan merged via PR #10 (`72944bb`). 374 tests green.

| Phase | Status | Ship SHA(s) | Notes |
|---|---|---|---|
| S1 — Metrics | ✅ Shipped | `8e104fc` | SweepMetrics + computeMetrics |
| S2 — Health gate + rank | ✅ Shipped | `c81f5fd` | isHealthy + rankHealthy |
| S3 — Runner (grid/OFAT, CRN, CIs) | ✅ Shipped | `5148523` | runConfig/sweepGrid/sweepOFAT + CRN |
| S4 — Orchestrator + report | ✅ Shipped | `53de15b` | findBalancedConfig/balanceSweep/report + infeasibility guard; 374 tests green |
| S5 — Execute the search; recommend balanced config | ✅ Ran 2026-05-27 — NO healthy config found | — | branch `claude/document-game-design-VpqqB`; report `docs/sweeps/2026-05-27-balance-report.md` |

### Deviations
- **S5.1 — grid trimmed + split turn caps to bound wall-clock.** board300 games run ~50s/config even at the reduced cap (heuristicAgent evaluates moves across a 300-hex board each turn). The full `boardSize{96,150,220,300}×radius{2,3,4,5}×ironCount{10,12,14,16}×victoryThreshold{8,10,12}` = 192-cell grid did not finish in a sane wall-clock at 40–60 search games (killed twice mid-stage-1 at 30–48 min). Final `main.ts` config (documented inline): full 4-value sweep on the dominant coupled dims `boardSize`×`radius`, but `ironCount{12,16}`×`victoryThreshold{8,12}` (endpoints only) → 64 cells; `SEARCH_GAMES=30` at `SEARCH_TURN_CAP=40` for the coarse gate; survivors refined at `REFINE_GAMES=150`/`REFINE_TURN_CAP=100`. The low search cap is consistent with the gate (medianTurns band tops at 25, so a deep-but-terminating config finishes well under 40; >40 turns ⇒ median far above the ceiling ⇒ fails `maxMedianTurns` anyway; capHit>0.02 at cap-40 is a real "doesn't terminate" signal). Total wall-clock 23.4 min. The wide boardSize range (the point of the search) is preserved.

### Discoveries
- **S3.1 — iron-CSP feasibility limits the grid.** The iron placement CSP (max-degree-1 spacing, no outer-2-ring iron) can't fit much iron on small boards (e.g. boardSize 48 → 47 hexes can't hold 8 iron → `placeIron` throws). S5's geometry grid MUST use feasible `(boardSize, ironCount)` pairs, and `findBalancedConfig`/`sweepGrid`/`main.ts` MUST GUARD infeasible combos (try/catch `runConfig`, skip-and-note on placeIron failure) so one bad combo doesn't abort the whole sweep. For boardSize ≥ 96, ironCount ≤ ~16 is feasible.
- **S3.1 — `ironOverTime[0]` is POST-turn-1, not a setup snapshot** (`runGame` pushes the first row after turn 1 plays out). So `turn1LeadersOf`/`leadVolatility` measure the *after-turn-1* leader (an acceptable early-leader proxy, not literally turn-0). `runConfig` correctly computes `setupDecided` by mirroring `runGame`'s board (threading the post-`generateBoard` rng into `setupGame`), NOT from `ironOverTime[0]`.
- **S5.1 — NO healthy config in the wide grid (the milestone's load-bearing empirical finding).** Across 64 geometry cells (boardSize{96,150,220,300} × radius{2,3,4,5} × ironCount{12,16} × victoryThreshold{8,12}) driven by `heuristicAgent`, ZERO configs pass the full `defaultHealthThresholds()` gate, at 30 search games AND after refining the top nearest-misses at 150 games. Full data: `docs/sweeps/2026-05-27-balance-report.md`. The S4 "0/8 healthy on the 96-board" smoke generalizes — larger boards did NOT open a healthy region. Per the spec's Risk §8 and the plan's assertion-rigor rule, this is reported as a real finding; the health gate was NOT loosened to manufacture a pass.
  - **Failure structure (what blocks health):** the nearest misses fail by exactly ONE criterion. Best two (refined, 150 games): `boardSize=96,radius=2,ironCount=16,victoryThreshold=12` → med=2, iron=0.99, seat=0.167(PASS), lead=0.573 — fails ONLY `minMedianTurns` (med 2 < 3); `boardSize=96,radius=2,ironCount=12,victoryThreshold=12` → med=3, iron=0.78, lead=0.31 — fails ONLY `maxSeatBias` (0.233 > 0.20). Across the grid the two dominant blockers are (a) **games too short** (med 1–2: iron victory is reached almost immediately on most geometries — the radius-N base still blankets enough iron) and (b) **seatWinBias > 0.20**.
  - **Important seatBias caveat (threshold-vs-noise).** `seatWinBias` is computed within each player-count group; the sweep rotates 5 player counts, so even at 150 games a 2-player group has only ~30 games → sampling noise alone gives ≈ `1.96·√(0.25/30)` ≈ 0.18 expected seat deviation. `maxSeatBias=0.20` is barely above that noise floor, so many seatBias "fails" (incl. the 0.233 nearest-miss) are plausibly statistical, not a real first-mover advantage. A future run should either raise games-per-count or relax `maxSeatBias` to a defensible non-noise level before concluding the game is seat-biased. (This is a threshold-calibration question, not a reason to loosen the gate ad hoc now.)
  - **Balance findings (OFAT around `boardSize=96,radius=2,ironCount=12,victoryThreshold=12`, 150 games, weak-agent caveat applies — heuristicAgent, the roadmap's validity ceiling):**
    - **auto-win-at-6 does NOT dominate:** iron-victory 0.780±0.066 (on) vs 0.773±0.067 (off); med/seat/lead identical. At this fast geometry games rarely reach turn 6, so the rule is near-inert.
    - **kill-bounty=full does NOT snowball:** iron-victory 0.780±0.066 (full) → 0.753±0.069 (half) → 0.680±0.075 (none); lead-volatility flat ~0.31 across all three. Bounty size shifts the iron-vs-elimination mix slightly but shows no runaway-leader signal.
    - **victoryThreshold:** vt10 → med 2 (shorter); vt12 → med 3; vt14 (> ironCount 12, unwinnable-by-iron) → med 18, iron 0.000 (all games go to elimination/cap — confirms the `ironCount < victoryThreshold` prune).
    - **attackRange:** 6 vs 5 mildly improves health (iron-victory 0.780±0.066 vs 0.680±0.075; lead-volatility 0.313 vs 0.246).
  - **Consequence for adoption / MCTS gates:** there is NO recommended `defaultConfig` to propose — the data-driven balanced "A" does not exist in this grid. `defaultConfig` was NOT changed (per the non-goal). The MCTS trustworthiness gates A5.2/A6 stay blocked on a balanced game. Recommended next steps for Sam (design decision, not auto-actioned): (1) re-run with a calibrated `maxSeatBias` / more games-per-count to rule out the seat-noise artifact and see if the two single-criterion near-misses (`b96/r2/iron16/vt12`, `b96/r2/iron12/vt12`) actually clear; (2) if they still don't, treat as a genuine balance gap — the radius-N base blanketing iron makes games end turn-1–2 on nearly every geometry, which points at a rules-level change (base-placement / iron-spacing / victory mechanic) rather than a parameter tweak.

---

## Conventions Applied to EVERY Task

**TDD (mandatory):**
```
BEFORE: invoke /superpowers:test-driven-development; read docs/pitfalls/testing-pitfalls.md.
Failing test → red → minimal implement → green.
BEFORE complete: review vs pitfalls; verify edge cases; full suite green; npm run typecheck clean.
```
**Assertion rigor (statistics-heavy):**
```
Tests run randomized games. Seed everything. If an assertion flakes, fix the SEED or add GAMES —
never loosen a bound or the health gate. A config failing the health gate, or no healthy config in
the grid, is a real FINDING, not a test to soften — STOP and report.
```
**End of each phase:** ≥3-round review; update Execution Status.
**Global do-NOT:** no runtime deps; no `Math.random` (seeded PRNG only); no tsconfig relaxation; do NOT modify `src/engine/*` or `src/agent/*` (the sweep only READS them via the driver/agent seams); do NOT auto-apply the found config as the default (S5 *recommends*; adoption is a separate human-gated step). Reports under `docs/sweeps/` ARE deliverables — commit them.

**Board-coordinate discovery** (carried): seed-1n/size-96 is a 93-hex asymmetric oval; the sweep VARIES boardSize/iron/etc., so don't hardcode board assumptions in sweep code — derive from the config under test.

---

## Phase S1 — Metrics

**Execution Status:** ✅ SHIPPED on 2026-05-27 (commit `8e104fc`; 337 tests green)

### Task S1.1: `SweepMetrics` + computation
**Files:** Create `src/sweep/metrics.ts`; Test `test/sweep/metrics.test.ts`. Available: `src/eval/measure.ts` (`measureDistribution`), `src/driver/run.ts` (`runGame`, `GameResult`), `src/agent/heuristic-agent.ts`, `src/engine/control.ts`, `src/engine/config.ts`, `src/engine/turn.ts` (`setupGame`).
- [ ] TDD: `computeMetrics(games: { result: GameResult; nPlayers: number; setupDecided: boolean; turn1Leaders: PlayerId[] }[]): SweepMetrics` — the runner (S3) supplies, per game: the `GameResult`, the player count, a `setupDecided` flag (the runner computes this by calling `setupGame(seed, board, nPlayers, config)` and checking whether any player controls ≥ `victoryThreshold` iron at setup), and `turn1Leaders` (argmax of `result.ironOverTime[0]`, ties → all). `computeMetrics` returns: `gamesPlayed`; `turnsHistogram` + `medianTurns`/`meanTurns`; `victoryType` mix; `ironVictoryFraction`; `noWinnerFraction`; `capHitFraction`; **`setupDecidedFraction`** (mean of the `setupDecided` flags); `seatWinBias` (**computed WITHIN each player-count group** — for each nPlayers present, the max over seats of `|seatWinRate − 1/nPlayers|`; report the MAX such bias across groups, plus the per-group values); `leadVolatility` (fraction of games where the winner ∉ `turn1Leaders`). Pure; deterministic.
- [ ] Tests (seeded, crafted fixtures): each metric computes correctly — e.g. `setupDecidedFraction` = 1.0 for a forced setup-win fixture and 0 for a fixture where setup iron < threshold; `seatWinBias` ≈ 0 for symmetric dummy results; `leadVolatility` correct on a crafted case. Use small `runConfig`-style batches or hand-built `GameResult[]`.
- [ ] Commit `feat: sweep metrics (incl. setupDecidedFraction, seatWinBias, leadVolatility)`.

**End of Phase S1:** ≥3-round review; update Execution Status.

---

## Phase S2 — Health Gate + Rank

**Execution Status:** ✅ SHIPPED on 2026-05-27 (commit `c81f5fd`; 352 tests green)

### Task S2.1: `isHealthy` + `rankHealthy`
**Files:** Create `src/sweep/health.ts`; Test `test/sweep/health.test.ts`. Uses `SweepMetrics` (S1).
- [ ] TDD: `export interface HealthThresholds { minMedianTurns; maxMedianTurns; maxSetupDecided; minIronVictory; maxCapHit; maxSeatBias; minLeadVolatility }` + `defaultHealthThresholds()` (documented starting values: e.g. `{minMedianTurns:3, maxMedianTurns:25, maxSetupDecided:0.05, minIronVictory:0.5, maxCapHit:0.02, maxSeatBias:0.20, minLeadVolatility:0.2}`). `isHealthy(m, thresholds?): { pass: boolean; reasons: string[] }` — passes iff ALL criteria hold; `reasons` lists each failed criterion. `rankHealthy(scored: {config, metrics}[], thresholds?): {config, metrics, score}[]` — filter to passers, rank by a composite (normalized blend: + leadVolatility, − seatBias, + ironVictoryFraction, − distance of medianTurns from the band center), best first.
- [ ] Tests: the CURRENT default config's metrics (setup-decided-heavy — construct a representative degenerate `SweepMetrics`) FAIL with `setupDecided`/`ironVictory` reasons; a hand-built healthy `SweepMetrics` PASSES; `rankHealthy` filters failers and orders passers by the composite (assert a crafted ordering); composite only ranks among passers (a failing config never outranks a passing one).
- [ ] Commit `feat: config-health gate + composite rank`.

**End of Phase S2:** ≥3-round review; update Execution Status.

---

## Phase S3 — Runner (grid / OFAT, CRN, CIs)

**Execution Status:** ✅ SHIPPED on 2026-05-27 (commit `5148523`; 365 tests green)

### Task S3.1: `runConfig`, `sweepGrid`, `sweepOFAT`, CRN, confidence intervals
**Files:** Create `src/sweep/run.ts`; Test `test/sweep/run.test.ts`. Available: `measureDistribution`, `runGame` (+ `agentFor` seam), `heuristicAgent`, `defaultConfig`, `metrics` (S1).
- [ ] TDD:
  - `runConfig(config, opts: { games; turnCap; baseSeed; playerCounts?; agentFactory? }): SweepMetrics` — N seeded games rotating over `playerCounts` (default [2,3,4,5,6]) via `runGame({..., agentFor: (p)=>agentFactory(p)})` defaulting to `heuristicAgent`. For EACH game: derive its seed deterministically as `baseSeed + gameIndex` (config-INDEPENDENT — this is the CRN guarantee), build the board + `setupGame` once to compute the `setupDecided` flag, run `runGame`, then feed `{result, nPlayers, setupDecided, turn1Leaders}` to `computeMetrics`. Deterministic per `baseSeed`.
  - `sweepGrid(axes: Record<keyof RuleConfig, number[]>, fixed: Partial<RuleConfig>, opts): {config, metrics}[]` — Cartesian product of the axis values over the base config; **common random numbers** (the SAME `baseSeed` set for every config) so config differences aren't seed noise. Document the CRN guarantee.
  - `sweepOFAT(baseline: RuleConfig, axis: keyof RuleConfig, values: number[], opts): {value, metrics}[]` — vary one axis around the baseline, CRN.
  - `proportionCI(p, n): number` — ±95% CI half-width (`1.96*sqrt(p(1-p)/n)`) for reporting.
- [ ] Tests: `runConfig` determinism (same `(config, baseSeed)` → identical `SweepMetrics`); **CRN concretely** — the per-game seed is `baseSeed + gameIndex` regardless of config, so assert two DIFFERENT configs run at the same `baseSeed` use the identical per-game seed sequence (e.g. expose/observe the seed derivation, or assert that a no-op config field change leaves the seed sequence unchanged); `sweepGrid` enumerates the full Cartesian product; `sweepOFAT` varies only the one axis (other fields == baseline); `proportionCI` math. Keep game counts SMALL in tests (e.g. 20–40) for speed; generous timeout.
- [ ] Commit `feat: sweep runner — runConfig/sweepGrid/sweepOFAT with CRN + CIs`.

**End of Phase S3:** ≥3-round review; update Execution Status.

---

## Phase S4 — Orchestrator + Report

**Execution Status:** ✅ SHIPPED on 2026-05-27 (commit `53de15b`; 374 tests green; small-grid smoke 0/8 healthy — wide grid pending S5)

### Task S4.1: `findBalancedConfig`, `balanceSweep`, `report`
**Files:** Create `src/sweep/orchestrate.ts`, `src/sweep/report.ts`; Test `test/sweep/orchestrate.test.ts`.
- [ ] TDD:
  - `findBalancedConfig(grid, fixed, opts): { recommended: RuleConfig | null; ranked: {config, metrics, score}[]; gridTable }` — `sweepGrid` → `rankHealthy` → `recommended` = top passer (or `null` + the closest-failers if none pass). 
  - `balanceSweep(baseline, axes: (keyof RuleConfig)[], valuesPerAxis, opts): Record<axis, {value, metrics}[]>` — OFAT each axis around the balanced baseline.
  - `report({ recommended, ranked, gridTable, balance }): string` — a markdown report: the recommended balanced config (or "none found in grid" + nearest misses), the grid health table, and per-variable balance-effect tables.
- [ ] **Acceptance — selection logic (structural, hard assertion):** given a hand-built set of `{config, metrics}` containing both passing and failing metrics, `findBalancedConfig` returns `recommended` = the top-ranked PASSER (and `null` when none pass), and `ranked` excludes failers. This tests the selection/ranking deterministically WITHOUT depending on whether the real game has a healthy region.
- [ ] **Acceptance — real-grid smoke (reports, does not hard-assert existence):** `findBalancedConfig` over a small real geometry grid (a few points incl. a larger board) RUNS deterministically and returns a well-formed result; `console.log` whether a healthy config was found and its metrics. Do NOT hard-assert `recommended !== null` here — whether the real game HAS a healthy config is an empirical question answered in S5 (and a legitimate either-way finding). The unit test asserts only that the machinery runs + is deterministic. (If S5 later finds NO healthy config anywhere in a wide grid, that's a major finding for Sam — the game may need redesign — surfaced there, never papered over by loosening the gate.)
- [ ] Commit `feat: sweep orchestrator (findBalancedConfig, balanceSweep) + markdown report`.

**End of Phase S4:** ≥3-round review; update Execution Status.

---

## Phase S5 — Execute the Search; Recommend Balanced Config

**Execution Status:** ✅ RAN on 2026-05-27 (branch `claude/document-game-design-VpqqB`) — NO healthy config found; report `docs/sweeps/2026-05-27-balance-report.md`. See top-of-plan Discovery S5.1 for the finding + balance OFAT results. `defaultConfig` unchanged (correct: there is no balanced config to adopt). MCTS gates A5.2/A6 remain blocked.

### Task S5.1: run the real geometry grid + OFAT; produce the report
**Files:** A runnable script `src/sweep/main.ts` (tsx-runnable) + the generated `docs/sweeps/2026-05-27-balance-report.md`. (This is an EXECUTION/measurement task, not a unit-test task.)
- [x] Built `src/sweep/main.ts` (two-stage: `findBalancedConfig` geometry grid → refine nearest-misses → `balanceSweep` of `autoWinAt6`/`killBounty`/`victoryThreshold`/`attackRange` → write report). Grid/games trimmed for tractability — see Deviation S5.1.
- [x] **Bounded the compute (two-stage):** 64-cell grid at 30 search games / turn-cap 40; nearest-misses + OFAT refined at 150 games / turn-cap 100. Wall-clock 23.4 min. Games-per-config + turn caps documented in the report header and Deviation S5.1. (Original 192-cell × 40–60 games plan did not finish in sane wall-clock; see Deviation.)
- [x] Ran it (`npx tsx src/sweep/main.ts`). Recorded in the report + Discovery S5.1: **NO healthy config found** (the either-way outcome the spec/plan anticipated); headline balance findings — auto-win-at-6 near-inert, kill-bounty=full does not snowball, attackRange 6 mildly healthier — each with CIs + weak-agent caveat.
- [x] No healthy config found → NO `defaultConfig` recommendation; `defaultConfig` unchanged. The "no balanced region" outcome is surfaced as a MAJOR finding for Sam (design decision), per the spec Risk §8.
- [ ] Commit the report + `main.ts`: `feat: run balance sweep; no healthy config found (major balance finding)`.

**End of Phase S5:** ≥3-round review; update Execution Status; mark Overall complete; surface the recommended config + balance findings to Sam for the adoption decision.

---

## Self-Review (writing-plans step, at authoring time)
**Spec coverage:** metrics §4.1→S1; health gate §4.2→S2; runner §4.3→S3; orchestrator+report §4.4→S4; the two deliverables (§1: find balanced config + answer balance questions)→S4 acceptance + S5 execution. Non-goal "don't auto-apply config" honored (S5 recommends only). Every spec section maps to a task.
**Placeholder scan:** thresholds are concrete starting values (documented as tunable); no TBD. The "if no healthy config" path is an explicit STOP-and-report, not vagueness.
**Type consistency:** `SweepMetrics` (S1) consumed by `health` (S2), `run` (S3), `orchestrate`/`report` (S4); `HealthThresholds` (S2) used by S4; `RuleConfig` axes are `keyof RuleConfig` throughout; `heuristicAgent`/`agentFor` seam reused; `runConfig`/`sweepGrid`/`sweepOFAT` (S3) consumed by `findBalancedConfig`/`balanceSweep` (S4).
