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

**Overall:** Not started.

| Phase | Status | Ship SHA(s) | Notes |
|---|---|---|---|
| S1 — Metrics | ⬜ Not started | — | — |
| S2 — Health gate + rank | ⬜ Not started | — | — |
| S3 — Runner (grid/OFAT, CRN, CIs) | ⬜ Not started | — | — |
| S4 — Orchestrator + report | ⬜ Not started | — | — |
| S5 — Execute the search; recommend balanced config | ⬜ Not started | — | — |

### Deviations
- (none yet)

### Discoveries
- (none yet)

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

**Execution Status:** ⬜ NOT STARTED

### Task S1.1: `SweepMetrics` + computation
**Files:** Create `src/sweep/metrics.ts`; Test `test/sweep/metrics.test.ts`. Available: `src/eval/measure.ts` (`measureDistribution`), `src/driver/run.ts` (`runGame`, `GameResult`), `src/agent/heuristic-agent.ts`, `src/engine/control.ts`, `src/engine/config.ts`, `src/engine/turn.ts` (`setupGame`).
- [ ] TDD: `computeMetrics(games: { result: GameResult; nPlayers: number; setupDecided: boolean; turn1Leaders: PlayerId[] }[]): SweepMetrics` — the runner (S3) supplies, per game: the `GameResult`, the player count, a `setupDecided` flag (the runner computes this by calling `setupGame(seed, board, nPlayers, config)` and checking whether any player controls ≥ `victoryThreshold` iron at setup), and `turn1Leaders` (argmax of `result.ironOverTime[0]`, ties → all). `computeMetrics` returns: `gamesPlayed`; `turnsHistogram` + `medianTurns`/`meanTurns`; `victoryType` mix; `ironVictoryFraction`; `noWinnerFraction`; `capHitFraction`; **`setupDecidedFraction`** (mean of the `setupDecided` flags); `seatWinBias` (**computed WITHIN each player-count group** — for each nPlayers present, the max over seats of `|seatWinRate − 1/nPlayers|`; report the MAX such bias across groups, plus the per-group values); `leadVolatility` (fraction of games where the winner ∉ `turn1Leaders`). Pure; deterministic.
- [ ] Tests (seeded, crafted fixtures): each metric computes correctly — e.g. `setupDecidedFraction` = 1.0 for a forced setup-win fixture and 0 for a fixture where setup iron < threshold; `seatWinBias` ≈ 0 for symmetric dummy results; `leadVolatility` correct on a crafted case. Use small `runConfig`-style batches or hand-built `GameResult[]`.
- [ ] Commit `feat: sweep metrics (incl. setupDecidedFraction, seatWinBias, leadVolatility)`.

**End of Phase S1:** ≥3-round review; update Execution Status.

---

## Phase S2 — Health Gate + Rank

**Execution Status:** ⬜ NOT STARTED

### Task S2.1: `isHealthy` + `rankHealthy`
**Files:** Create `src/sweep/health.ts`; Test `test/sweep/health.test.ts`. Uses `SweepMetrics` (S1).
- [ ] TDD: `export interface HealthThresholds { minMedianTurns; maxMedianTurns; maxSetupDecided; minIronVictory; maxCapHit; maxSeatBias; minLeadVolatility }` + `defaultHealthThresholds()` (documented starting values: e.g. `{minMedianTurns:3, maxMedianTurns:25, maxSetupDecided:0.05, minIronVictory:0.5, maxCapHit:0.02, maxSeatBias:0.20, minLeadVolatility:0.2}`). `isHealthy(m, thresholds?): { pass: boolean; reasons: string[] }` — passes iff ALL criteria hold; `reasons` lists each failed criterion. `rankHealthy(scored: {config, metrics}[], thresholds?): {config, metrics, score}[]` — filter to passers, rank by a composite (normalized blend: + leadVolatility, − seatBias, + ironVictoryFraction, − distance of medianTurns from the band center), best first.
- [ ] Tests: the CURRENT default config's metrics (setup-decided-heavy — construct a representative degenerate `SweepMetrics`) FAIL with `setupDecided`/`ironVictory` reasons; a hand-built healthy `SweepMetrics` PASSES; `rankHealthy` filters failers and orders passers by the composite (assert a crafted ordering); composite only ranks among passers (a failing config never outranks a passing one).
- [ ] Commit `feat: config-health gate + composite rank`.

**End of Phase S2:** ≥3-round review; update Execution Status.

---

## Phase S3 — Runner (grid / OFAT, CRN, CIs)

**Execution Status:** ⬜ NOT STARTED

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

**Execution Status:** ⬜ NOT STARTED

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

**Execution Status:** ⬜ NOT STARTED

### Task S5.1: run the real geometry grid + OFAT; produce the report
**Files:** A runnable script `src/sweep/main.ts` (tsx-runnable) + the generated `docs/sweeps/2026-05-27-balance-report.md`. (This is an EXECUTION/measurement task, not a unit-test task.)
- [ ] Build `src/sweep/main.ts` that runs `findBalancedConfig` over a substantial geometry grid (include larger `boardSize` — e.g. {96, 150, 220, 300} — × `radius` {2,3,4,5} × `ironCount` {10,12,14,16} × `victoryThreshold` {8,10,12}; prune obviously-degenerate combos), then `balanceSweep` of the critique's variables (`autoWinAt6`, `killBounty`, `victoryThreshold`, `attackRange`) around the recommended baseline, then writes the report.
- [ ] **Bound the compute (two-stage):** the grid is ~100+ configs — use a SMALLER games-per-config for the grid SEARCH (e.g. 60–100, enough to gate health and rank), then re-run only the TOP few candidates + the OFAT balance axes at HIGH games-per-config (e.g. 300–400) for tight CIs. This keeps total wall-clock sane (heuristicAgent is fast; enable worker-thread parallelism if available). The grid may take a while — it's an offline run; that's fine. Document the games-per-config used at each stage in the report.
- [ ] Run it (`npx tsx src/sweep/main.ts`). RECORD in the report + this plan's Discoveries: the recommended balanced config (with its metrics), and the headline balance findings (does auto-win-at-6 dominate? does kill-bounty=full snowball? etc., each with CIs + the weak-agent caveat).
- [ ] If a healthy config is found: note it as the recommended new `defaultConfig` for a SEPARATE human-gated adoption step (which then unblocks the MCTS gates A5.2/A6). Do NOT change `defaultConfig` here.
- [ ] Commit the report + `main.ts`: `feat: run balance sweep; recommend balanced config + balance findings`.

**End of Phase S5:** ≥3-round review; update Execution Status; mark Overall complete; surface the recommended config + balance findings to Sam for the adoption decision.

---

## Self-Review (writing-plans step, at authoring time)
**Spec coverage:** metrics §4.1→S1; health gate §4.2→S2; runner §4.3→S3; orchestrator+report §4.4→S4; the two deliverables (§1: find balanced config + answer balance questions)→S4 acceptance + S5 execution. Non-goal "don't auto-apply config" honored (S5 recommends only). Every spec section maps to a task.
**Placeholder scan:** thresholds are concrete starting values (documented as tunable); no TBD. The "if no healthy config" path is an explicit STOP-and-report, not vagueness.
**Type consistency:** `SweepMetrics` (S1) consumed by `health` (S2), `run` (S3), `orchestrate`/`report` (S4); `HealthThresholds` (S2) used by S4; `RuleConfig` axes are `keyof RuleConfig` throughout; `heuristicAgent`/`agentFor` seam reused; `runConfig`/`sweepGrid`/`sweepOFAT` (S3) consumed by `findBalancedConfig`/`balanceSweep` (S4).
