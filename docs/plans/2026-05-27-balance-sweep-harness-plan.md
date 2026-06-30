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

**Overall:** ✅ COMPLETE (DONE_WITH_CONCERNS), 2026-06-29, branch `claude/wonderful-mahavira-87ccd6` (not yet PR'd). S1 ✅ (`2e5d7cf1`), S2 ✅ (`ff826e65`), S3 ✅ (`69c65915`), S4 ✅ (`8ec625ab`), S5 ✅ (`fd461c99`). Suite 505 green; typecheck clean. **Headline finding: 0/176 feasible configs pass the health gate under the weak `heuristicAgent`** — verified trustworthy by a 4-lens adversarial workflow (byte-identical reproduction, no harness bug, gate unmodified). **Two regimes (the crux):** small/dense-board turn-1 resolution is INTRINSIC GEOMETRY (agent-insensitive — a stronger agent wins turn-1 *more* reliably); large-board cap-hit is AGENT-SENSITIVE (the best near-miss `big300` fails ONLY capHit by ~2pp, a metric a decisive agent could fix). So "no healthy config under weak play" is narrower than "no balanced region." **Sam's decision (2026-06-29): re-run the large-board nearest-misses under the paused MCTS agent FIRST** (do NOT loosen capHit, do NOT redesign yet). Full finding + memory: [[balance-sweep-two-regime-finding]]. Report: `docs/sweeps/2026-05-27-balance-report.md`.

| Phase | Status | Ship SHA(s) | Notes |
|---|---|---|---|
| S1 — Metrics | ✅ SHIPPED (commit, not yet PR'd) | `2e5d7cf1` | `src/sweep/metrics.ts` + 28 tests; full suite 423 green, typecheck clean. Spec + quality review passed; isolation verified (2 files only). |
| S2 — Health gate + rank | ✅ SHIPPED (commit, not yet PR'd) | `ff826e65` | `src/sweep/health.ts` + 26 tests; suite 449 green. `isHealthy`/`rankHealthy`; equal-weight composite. Spec + quality review passed (4 doc/test fixes folded). |
| S3 — Runner (grid/OFAT, CRN, CIs) | ✅ SHIPPED (commit, not yet PR'd) | `69c65915` | `src/sweep/run.ts` + 14 tests; suite 463 green. CRN via config-free `gameSeed`; probe==game board-consistency verified byte-for-byte (Opus spec review). Deviations: `bigint` seeds, numeric-only axis keys (see Deviations). |
| S4 — Orchestrator + report | ✅ SHIPPED (commit, not yet PR'd) | `8ec625ab` | `orchestrate.ts` + `report.ts` + 33 tests; suite 505 green. `findBalancedConfig`(grid→rankHealthy→recommended/null+nearest-misses), `balanceSweep`, pure `report()`. Composite extracted to shared `scoreMetrics` in `health.ts` (DRY). Spec + quality review passed. |
| S5 — Execute the search; recommend balanced config | ✅ DONE_WITH_CONCERNS (commit, not yet PR'd) | `fd461c99` | `src/sweep/main.ts` + report. 176 feasible configs (192 raw − 16 vt>ironCount), 80→360 games two-stage, ~64 min. **0/176 healthy** (verified). No config to adopt; recommended next = MCTS re-run of near-misses. `defaultConfig` unchanged. |

### Deviations
- **S3 — `baseSeed`/`gameSeed` use `bigint`, not `number`** (plan spec wrote `number`). The engine's `RunOptions.seed` and `initGame` take `bigint`; using `number` would force lossy `BigInt()` conversions past 2^53. `gameSeed(baseSeed: bigint, gameIndex: number): bigint`. **S4/S5 callers MUST pass `bigint` seeds (e.g. `1n`).** Faithful to the real API; confirmed correct by Opus spec review.
- **S3 — sweep axis type narrowed to numeric-only `RuleConfig` keys** (plan spec wrote `Record<keyof RuleConfig, number[]>`). Added `NumericRuleConfigKey` (the `K extends number` subset); `sweepGrid` axes = `Partial<Record<NumericRuleConfigKey, number[]>>`, `sweepOFAT` axis = `NumericRuleConfigKey`. Accepts the 9 numeric fields (radius, placeRange, attackRange, baseLimit, factorySupply, ironCount, boardSize, victoryThreshold, brokenPerimeterDeathAtFactories); rejects `allowPass`/`autoWinAt6`/`killBounty`/`combatTable` at compile time. The full-`Record` form would have forced every key present and mistyped non-numeric fields. **S5's grid/OFAT axes must be among those 9 numeric keys.**
- **S4 — `findBalancedConfig` is selection-only over a PRE-COMPUTED grid** (plan spec wrote `findBalancedConfig(grid, fixed, opts)` implying it calls `sweepGrid` internally). The shipped signature is `findBalancedConfig(grid: {config,metrics}[], opts)` — `grid` is the sweep RESULTS, not the axes, and `fixed` was dropped as vestigial. This is forced by the spec's own structural-selection acceptance test ("given a hand-built set of `{config, metrics}`"), and it cleanly separates the expensive sweep run from pure selection. **S5 calls `sweepGrid(axes, fixed, opts)` itself, then passes the results in;** `fixed` is applied at the `sweepGrid` call.
- **S4 — `report({ result, balance })` signature** (plan spec wrote `report({ recommended, ranked, gridTable, balance })`). `result: FindResult` bundles `recommended`/`ranked`/`gridTable`/`nearestMisses`; cleaner, no behavior change.

### Discoveries
- **`SweepMetrics` / `GameEntry` contract (S1, `src/sweep/metrics.ts`).** `victoryType` is keyed on `"iron" | "last-standing" | "none"` (matches `VictoryType` from `src/driver/record.ts`). `computeMetrics` reads `GameResult.{winnerOrCoalition, turns, victoryType, hitTurnCap}`; the caller (S3 runner) supplies `setupDecided` and `turn1Leaders` (argmax of `ironOverTime[0]`, ties→all). `seatWinBias` returns `{ maxBiasAcrossGroups, byNPlayers }` computed WITHIN each player-count group.
- **No-winner-game handling — load-bearing for S2/S4 interpretation.** Empty-coalition/cap games count in the seat-bias denominator (`gamesInGroup`) but contribute 0 wins to all seats → they dilute seat win-rates and INFLATE apparent `seatWinBias` when cap-hit frequency is high. `leadVolatility` counts no-winner games as volatile (no winner ∈ leaders). S2 thresholds and S4 reporting MUST read these alongside `noWinnerFraction`/`capHitFraction` for context.
- **S4 smoke-grid PREVIEW of the S5 question (`orchestrate.test.ts`).** A small real grid (`victoryThreshold∈{8,12} × boardSize∈{96,126}`, 20 games/config, 2 player counts) found **NO healthy config** — every config failed `medianTurns < 3` (games end almost immediately) and `leadVolatility < 0.2`. This is the "decided at setup/turn-1" problem appearing on cue. **It is plausible S5's wider grid also finds no healthy region** — that is a legitimate, important either-way finding (don't loosen the gate to manufacture a pass). The harness's nearest-misses path exists precisely for this case.
- **Operational floor: board size.** `boardSize: 64` (≈61 hexes) is INFEASIBLE with default `ironCount=14` (`placeIron` fails — too dense). S5's grid should keep `boardSize ≳ 80–90` at `ironCount=14`, or scale `ironCount` down with the board.

---

## Conventions Applied to EVERY Task

**TDD (mandatory):**
```
BEFORE: invoke /superpowers:test-driven-development; read docs/pitfalls/testing-pitfalls.md.
Failing test → red → minimal implement → green.
BEFORE complete: review vs pitfalls; verify edge cases; full suite green; bun run typecheck clean.
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

**Execution Status:** ✅ SHIPPED — `2e5d7cf1` on branch `claude/wonderful-mahavira-87ccd6` (not yet PR'd). `src/sweep/metrics.ts` + `test/sweep/metrics.test.ts`; 28 sweep tests, full suite 423 green, typecheck clean. Spec-compliance review ✅ (within-group `seatWinBias`, real `GameResult` fields, no tautological tests); code-quality review ✅ APPROVED (4 findings folded: 2 test-comment corrections, `seatWinBias` denominator doc, coalition-credit test). Isolation verified: only the 2 intended files changed since dev base.

### Task S1.1: `SweepMetrics` + computation
**Files:** Create `src/sweep/metrics.ts`; Test `test/sweep/metrics.test.ts`. Available: `src/eval/measure.ts` (`measureDistribution`), `src/driver/run.ts` (`runGame`, `GameResult`), `src/agent/heuristic-agent.ts`, `src/engine/control.ts`, `src/engine/config.ts`, `src/engine/turn.ts` (`setupGame`).
- [ ] TDD: `computeMetrics(games: { result: GameResult; nPlayers: number; setupDecided: boolean; turn1Leaders: PlayerId[] }[]): SweepMetrics` — the runner (S3) supplies, per game: the `GameResult`, the player count, a `setupDecided` flag (the runner computes this by calling `setupGame(seed, board, nPlayers, config)` and checking whether any player controls ≥ `victoryThreshold` iron at setup), and `turn1Leaders` (argmax of `result.ironOverTime[0]`, ties → all). `computeMetrics` returns: `gamesPlayed`; `turnsHistogram` + `medianTurns`/`meanTurns`; `victoryType` mix; `ironVictoryFraction`; `noWinnerFraction`; `capHitFraction`; **`setupDecidedFraction`** (mean of the `setupDecided` flags); `seatWinBias` (**computed WITHIN each player-count group** — for each nPlayers present, the max over seats of `|seatWinRate − 1/nPlayers|`; report the MAX such bias across groups, plus the per-group values); `leadVolatility` (fraction of games where the winner ∉ `turn1Leaders`). Pure; deterministic.
- [ ] Tests (seeded, crafted fixtures): each metric computes correctly — e.g. `setupDecidedFraction` = 1.0 for a forced setup-win fixture and 0 for a fixture where setup iron < threshold; `seatWinBias` ≈ 0 for symmetric dummy results; `leadVolatility` correct on a crafted case. Use small `runConfig`-style batches or hand-built `GameResult[]`.
- [ ] Commit `feat: sweep metrics (incl. setupDecidedFraction, seatWinBias, leadVolatility)`.

**End of Phase S1:** ≥3-round review; update Execution Status.

---

## Phase S2 — Health Gate + Rank

**Execution Status:** ✅ SHIPPED — `ff826e65` on branch `claude/wonderful-mahavira-87ccd6` (not yet PR'd). `src/sweep/health.ts` + `test/sweep/health.test.ts`; 26 tests, suite 449 green, typecheck clean. `defaultHealthThresholds()` = `{minMedianTurns:3, maxMedianTurns:25, maxSetupDecided:0.05, minIronVictory:0.5, maxCapHit:0.02, maxSeatBias:0.20, minLeadVolatility:0.2}` (STARTING values — S5 reports real-grid behavior against them; if none pass, that's a finding, NOT a threshold to loosen). Composite (for S4): equal-weight (0.25 each) blend of `leadVolatility`, `1−seatWinBias.maxBiasAcrossGroups`, `ironVictoryFraction`, and `1−|medianTurns−bandCenter|/halfWidth` (bandCenter=(min+max)/2). `rankHealthy` filters failers first, so a failing config never outranks a passer. Spec ✅ + quality ✅ (logic approved; 4 doc/test-clarity fixes folded incl. a real tie-stability test replacing a tautological one).

### Task S2.1: `isHealthy` + `rankHealthy`
**Files:** Create `src/sweep/health.ts`; Test `test/sweep/health.test.ts`. Uses `SweepMetrics` (S1).
- [ ] TDD: `export interface HealthThresholds { minMedianTurns; maxMedianTurns; maxSetupDecided; minIronVictory; maxCapHit; maxSeatBias; minLeadVolatility }` + `defaultHealthThresholds()` (documented starting values: e.g. `{minMedianTurns:3, maxMedianTurns:25, maxSetupDecided:0.05, minIronVictory:0.5, maxCapHit:0.02, maxSeatBias:0.20, minLeadVolatility:0.2}`). `isHealthy(m, thresholds?): { pass: boolean; reasons: string[] }` — passes iff ALL criteria hold; `reasons` lists each failed criterion. `rankHealthy(scored: {config, metrics}[], thresholds?): {config, metrics, score}[]` — filter to passers, rank by a composite (normalized blend: + leadVolatility, − seatBias, + ironVictoryFraction, − distance of medianTurns from the band center), best first.
- [ ] Tests: the CURRENT default config's metrics (setup-decided-heavy — construct a representative degenerate `SweepMetrics`) FAIL with `setupDecided`/`ironVictory` reasons; a hand-built healthy `SweepMetrics` PASSES; `rankHealthy` filters failers and orders passers by the composite (assert a crafted ordering); composite only ranks among passers (a failing config never outranks a passing one).
- [ ] Commit `feat: config-health gate + composite rank`.

**End of Phase S2:** ≥3-round review; update Execution Status.

---

## Phase S3 — Runner (grid / OFAT, CRN, CIs)

**Execution Status:** ✅ SHIPPED — `69c65915` on branch `claude/wonderful-mahavira-87ccd6` (not yet PR'd). `src/sweep/run.ts` + `test/sweep/run.test.ts`; 14 tests, suite 463 green, typecheck clean. Exports `gameSeed` (config-free CRN choke point — `baseSeed + gameIndex`, `bigint`), `runConfig`, `sweepGrid`, `sweepOFAT`, `proportionCI`. **Board/seed consistency verified byte-for-byte by Opus spec review:** the `setupDecided` probe reproduces `runGame`'s exact `initGame`→`placeFirstBase` setup sequence (same seed, structurally-identical `boardSource`), and `setupDecided` reads `control().iron.length` which is RNG-independent — so `setupDecidedFraction` is trustworthy. CRN tested non-tautologically (two materially-different configs at the same `baseSeed` emit identical seed sequences). Spec ✅ + quality ✅ (4 fixes folded: JSDoc timing, named `Z_95`, empty-axes/empty-values edge-case docs+tests, numeric-only axis type). See top-of-plan **Deviations** for the `bigint`-seed and numeric-axis-key API notes S4/S5 must honor.

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

**Execution Status:** ✅ SHIPPED — `8ec625ab` on branch `claude/wonderful-mahavira-87ccd6` (not yet PR'd). `src/sweep/orchestrate.ts` + `src/sweep/report.ts` + `test/sweep/orchestrate.test.ts`; 33 tests, suite 505 green, typecheck clean. Spec ✅ + quality ✅ (review folded a DRY fix + dead-alias removal + 2 test gaps + graceful empty-table). **S5 wiring contract:** call `sweepGrid(axes, fixed, opts)` → pass the `{config,metrics}[]` results to `findBalancedConfig(grid, opts)` (NOT `(grid, fixed, opts)` — see Deviations); call `balanceSweep(baseline, axes, valuesPerAxis, opts)`; call `report({ result, balance })` and write the string to `docs/sweeps/`. `report.ts` exports `report`; `orchestrate.ts` exports `NEAREST_MISSES_COUNT`, `GridEntry`, `FindResult`, `BalanceResult`. The composite is `scoreMetrics(metrics, thresholds)` exported from `health.ts` (single source of truth, used by both `rankHealthy` and nearest-miss ranking).

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

**Execution Status:** ✅ DONE_WITH_CONCERNS — `fd461c99` on branch `claude/wonderful-mahavira-87ccd6` (not yet PR'd). `src/sweep/main.ts` (+ module-scoped `node-shims.d.ts`) ran 176 feasible configs (192 raw − 16 pruned for `victoryThreshold > ironCount`; board-feasibility probe pruned zero in this grid), two-stage 80→360 games/config, CRN `baseSeed=1n`, `turnCap=60`, ~64 min single-threaded, deterministic. **Result: 0/176 pass the gate.** Report: `docs/sweeps/2026-05-27-balance-report.md`. `defaultConfig` NOT changed (adoption is human-gated).

**Verification (4-lens adversarial workflow, all `confirmed-with-caveats`):** the 0/176 finding reproduces byte-identically; no `main.ts` bug; gate is the unmodified `defaultHealthThresholds()`. **Two-regime crux:** small/dense-board (96) turn-1 resolution is INTRINSIC GEOMETRY (one base's radius-5 control disk owns ~6–10 iron at setup vs threshold 10 → first mover wins turn 1; stronger agent wins turn-1 *more* reliably — agent-INsensitive); large-board (220/300) cap-hit is AGENT-SENSITIVE (cap-hits are no-winner timeouts a decisive agent could convert to wins). Best near-miss `big300` (board 300 / radius 5 / ironCount 16 / vt 12) fails ONLY capHit (0.039±0.020 vs 0.02). Nuance: ~45% of board-300 failures fail WITHOUT capHit (seatBias/leadVolatility/ironVictory); seatBias is win-rate-based and inflated by no-winner games (metrics.ts, not a bug). `autoWinAt6`/`killBounty` showed zero effect — uninformative, since turn-1 resolution fires before those levers can (the engine reads them; not dead).

**Decision (Sam, 2026-06-29): re-run the large-board nearest-misses under the paused MCTS agent FIRST** — the gating experiment. Do NOT loosen `maxCapHit` (would tune the gate to weak play) and do NOT call the game unbalanced as a whole (overclaims from a weak-agent run); both become ripe only after the MCTS re-run. If `big300` passes under strong play, the MCTS trustworthiness gates (`docs/plans/2026-05-27-stronger-agent-mcts-plan.md` A5.2/A6) unblock honestly. Strongest single lever found: higher `victoryThreshold`. See [[balance-sweep-two-regime-finding]].

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
