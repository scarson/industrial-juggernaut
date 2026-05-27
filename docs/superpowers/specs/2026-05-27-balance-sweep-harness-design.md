# Design Spec — Balance-Sweep Harness (Milestone B)

**Date:** 2026-05-27
**Status:** Draft for review
**Scope:** An offline harness that runs many seeded games across `RuleConfig` parameter sets, measures outcome metrics, (1) **finds a balanced multi-turn game config** and (2) **answers the design-critique's balance questions**. Driven by the heuristic-greedy agent.
**Companion docs:** `2026-05-18-design-critique.md` (the "Variables to Test" + balance concerns this answers), `docs/superpowers/specs/2026-05-27-stronger-agent-mcts-design.md` (the agent milestone this unblocks), `2026-05-18-code-representation-options.md` (§"parameter sweep results" — the original sketch).

## 1. Goal & Why Now

The engine is built and plays *legal* games, but the **default balance is broken**: games are decided at setup/turn-1 (a radius-5 base on the 93-hex board blankets ~9–12 of 14 iron; 48/200 games won at setup). No single hand-picked knob fixes it (validated empirically) — it's a multi-dimensional board-geometry interaction, which is exactly what a sweep resolves.

So this harness has **two deliverables, in order**:
1. **Find a balanced config** — search `(boardSize, radius, ironCount, victoryThreshold, …)` and identify a parameter set yielding healthy multi-turn games (the data-driven "A" that unblocks the MCTS trustworthiness gates).
2. **Answer the balance questions** — once a balanced baseline exists, run one-factor-at-a-time sweeps of the critique's variables (auto-win-at-6, kill-bounty, victory threshold, iron count, attack range, build rate) and report their effects.

## 2. Scope & Non-Goals
**In scope:** a deterministic, seeded, parallel-capable runner over `RuleConfig` variations; an outcome-metrics layer; a **config-health gate + composite rank** (the balanced-config search); OFAT balance sweeps; structured result storage + a human-readable report. Agent = `heuristicAgent` (fast, competent post-fixes).

**Non-goals (deferred):** running sweeps under the MCTS/learned agents (too slow for thousands of games; the balanced *config* is agent-agnostic enough that greedy suffices — re-validating the final config under MCTS is a cheap later check, not part of the search); a GUI; statistical machinery beyond confidence intervals + common-random-numbers; auto-applying the found config as the new default (that's a human-reviewed follow-up — the harness *recommends*, a person adopts).

## 3. Architecture
Layered on the existing pure engine + driver; all offline Node.
```
report (markdown tables + recommended balanced config)
  └─ sweep orchestrator (geometry grid → health gate → OFAT around baseline)
       ├─ health gate + composite rank (is a config "balanced"?)
       ├─ metrics (turnsHistogram, victory mix, iron-frac, seat bias, setup-decided frac, lead volatility, cap-hits)
       └─ runner: measureDistribution / runGame over (config, seeds) — heuristicAgent
            └─ M1 engine + driver (unchanged)
```

## 4. Components

### 4.1 Metrics (`src/sweep/metrics.ts`)
Extend the existing `measureDistribution` output into a richer `SweepMetrics` per config: `gamesPlayed`, `turnsHistogram` + median/mean length, `victoryType` mix, `ironVictoryFraction`, `noWinnerFraction` (empty-coalition/degenerate), `capHitFraction`, **`setupDecidedFraction`** (games where a player already controls ≥ threshold iron at setup — the key degeneracy this milestone surfaced), `seatWinBias` (max deviation of per-seat win-rate from uniform, seat-rotated), and `leadVolatility` (a cheap proxy: how often the eventual winner was NOT the turn-1 iron leader). Pure; deterministic per seed.

### 4.2 Config-health gate + rank (`src/sweep/health.ts`)
`isHealthy(m: SweepMetrics): { pass: boolean; reasons: string[] }` — a config passes iff ALL hold (thresholds documented + configurable):
- median game length in a "has depth" band (e.g. `[3, 25]` turns — multi-turn but terminating);
- `setupDecidedFraction ≤ ~0.05` (games aren't decided before play);
- `ironVictoryFraction ≥ ~0.5` (the iron victory condition actually drives games, vs. last-standing/elimination dominating);
- `capHitFraction ≤ ~0.02` (games terminate);
- `seatWinBias ≤ ~0.20` (no overwhelming first-mover advantage);
- `leadVolatility ≥ ~0.2` (outcomes aren't fully determined early — some strategic swing).
`rankHealthy(configs)` — among passers, rank by a composite (normalized blend favoring higher lead-volatility, lower seat-bias, iron-victory-dominant, central game length). The composite only ranks *among already-healthy* configs, so the arbitrary-weighting risk is bounded (gate first, rank second). Returns the best as the **recommended balanced config**.

### 4.3 Runner (`src/sweep/run.ts`)
`runConfig(config, { games, turnCap, baseSeed, agentFactory }): SweepMetrics` — N seeded games (2–6P rotation) via the driver's `agentFor` seam + `heuristicAgent`, aggregated into `SweepMetrics`. `sweepGrid(axes, fixed, opts)` and `sweepOFAT(baseline, axis, values, opts)` enumerate config sets. Deterministic; **common random numbers** (same seed set across configs) so config-to-config *differences* aren't drowned in seed noise. Worker-thread parallelism is an OPTIONAL flag (correctness single-threaded first). Confidence-interval helper for proportions (≈ `1/√N`).

### 4.4 Orchestrator + report (`src/sweep/orchestrate.ts`, `src/sweep/report.ts`)
`findBalancedConfig(grid, opts)` — run the geometry grid, health-gate + rank, return the recommended config + the full grid table. `balanceSweep(baseline, axes, opts)` — OFAT each critique variable around the balanced baseline, return per-axis effect tables. `report(...)` — emit a markdown report (recommended config; grid health table; per-variable balance findings) to `docs/sweeps/<date>-balance-report.md`.

## 5. Data Flow
`findBalancedConfig` → `sweepGrid` over geometry axes → `runConfig` each (heuristicAgent, CRN seeds) → `metrics` → `health.gate+rank` → recommended config → `balanceSweep` OFAT around it → `report`. The recommended config is then **hand-reviewed and adopted** as the new `defaultConfig` (a separate, human-gated change), which unblocks the MCTS trustworthiness gates (A5.2/A6) re-run on a balanced game.

## 6. Module Layout
```
src/sweep/metrics.ts      # SweepMetrics + computation
src/sweep/health.ts       # isHealthy gate + rankHealthy composite
src/sweep/run.ts          # runConfig, sweepGrid, sweepOFAT, CRN, CIs
src/sweep/orchestrate.ts  # findBalancedConfig, balanceSweep
src/sweep/report.ts       # markdown report
test/sweep/*.test.ts
docs/sweeps/              # generated reports (gitignored? NO — reports are deliverables, commit them)
```
Reuses unchanged: `src/engine/*`, `src/driver/*` (the `agentFor` seam), `src/agent/heuristic-agent.ts`, `src/eval/measure.ts` (metrics build on it).

## 7. Testing Strategy
- **Metrics:** on crafted/seeded small runs, each metric computes correctly (e.g. `setupDecidedFraction` counts setup-iron-≥-threshold games; `seatWinBias` is 0 for a symmetric dummy).
- **Health gate:** a known-degenerate config (current default — setup-decided) FAILS with the right reason; a hand-constructed healthy-metrics object PASSES; `rankHealthy` orders by the composite.
- **Runner determinism:** `runConfig` same `(config, baseSeed)` → identical `SweepMetrics` twice; CRN means two configs run on the same seed set.
- **Orchestrator (acceptance):** `findBalancedConfig` over a small real geometry grid returns a config whose metrics PASS the health gate (i.e. the balanced config actually exists and is found) — this is the milestone's load-bearing test. If the grid contains NO healthy config, that's a real finding → widen the grid / report it (do NOT loosen the gate).
- Seed every randomized test; per assertion-rigor, never loosen the health gate or a determinism check to force green.

## 8. Risks
- **No healthy config in the searched grid.** Mitigated by a wide geometry grid (esp. larger `boardSize` so radius covers a smaller fraction); if still none, report it — the game may need a deeper redesign (a genuine finding for Sam).
- **Greedy-agent bias in the balance findings.** The balanced *config* search is robust (geometry/termination metrics don't need strong play); but the OFAT balance *answers* carry the documented weak-agent caveat (the roadmap's validity ceiling) — re-confirm key findings under MCTS later.
- **Throughput.** Thousands of games × grid points; mitigated by heuristicAgent (fast), CRN (fewer games for a given CI), and optional parallelism.

## 9. Design Reasoning & Alternatives
**Config-health metric — 5 options (full discussion 2026-05-27):** (1) **multi-criteria gate + composite rank — chosen** (interpretable, encodes the real definition of a good game, bounds the weighting-arbitrariness by gating before ranking); (2) single weighted composite — arbitrary trade-offs; (3) length-target-only — ignores degeneracy/fairness; (4) outcome-entropy — good but indirect/complex; (5) human-picks — against the autonomous mandate. **Search strategy:** geometry grid (find balanced config) + OFAT (balance questions) — full-factorial is infeasible; grid-for-the-coupled-geometry-dims + OFAT-for-single-balance-knobs is standard and tractable. **Agent:** heuristic-greedy — fast enough for thousands of games and adequate for the (largely agent-agnostic) config search; MCTS/learned reserved for a cheap final re-confirmation, not the search.

### What I'm still uncertain about
- Whether a healthy config exists in a reasonable grid (the grid must include larger boards). The acceptance test surfaces this.
- The exact health thresholds — defensible starting points; the report exposes the grid so they can be revisited.
- How much the greedy-agent bias colors the OFAT *balance* answers (vs. the config search, which is robust).

### What I'd add with more time
- Re-running the balance OFAT under the MCTS agent for the highest-stakes findings.
- Latin-hypercube sampling for a denser geometry search if the coarse grid is borderline.
- Lead-volatility via a richer per-turn iron-trajectory analysis (the spec uses a cheap proxy).
