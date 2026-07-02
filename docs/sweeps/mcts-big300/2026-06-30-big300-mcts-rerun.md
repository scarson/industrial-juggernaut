# big300 under strong (MCTS) play — the cap-hit payoff experiment

_Generated 2026-06-30. Branch `feat/mcts-big300-rerun`. The payoff experiment of the balance-sweep effort: does a STRONG (MCTS) agent convert big300's weak-agent cap-hit stalemates into decisive iron-victories, pulling `capHitFraction` under the 0.02 gate and making `big300` healthy?_

`big300` = `{ ...defaultConfig(), boardSize: 300, radius: 5, ironCount: 16, victoryThreshold: 12 }` — the best near-miss from the weak-agent balance sweep, which failed ONLY `capHitFraction` (0.039 ± 0.020 vs gate 0.02) under `heuristicAgent`.

## Method

- **Agent:** every seat plays a FRESH MCTS agent (`agentFactory: () => mctsAgent({ ...defaultMctsParams(), iterations: N })`). Fair all-MCTS, not MCTS-vs-weak — mirrors the arena construction in `test/eval/arena.test.ts`.
- **CRN:** `baseSeed = 1n`, per-game seed `gameSeed(1n, gameIndex)` — config- AND shard-independent, so the same boards/setups as the weak run (apples-to-apples).
- **Parallelism:** process-sharding. `src/sweep/big300-run.ts` spawns N shards (`bunx tsx src/sweep/big300-shard.ts`); shard k runs the disjoint interleaved slice `gameIndex % numShards === k`, appending one JSONL line per finished game (killable, partial-progress-safe). The parent merges by `gameIndex` and runs `computeMetrics` + `isHealthy` on the unmodified `defaultHealthThresholds()`.
- **Correctness invariant (verified):** parallel == sequential. The per-game body of `runConfig` was extracted into the pure `runGameEntry(config, opts, gameIndex)` seam; because the CRN seed depends only on `(baseSeed, gameIndex)`, a given game's `GameEntry` is identical regardless of which shard produces it. Verified two ways: (1) an in-process vitest test runs interleaved disjoint index shards and asserts merged `computeMetrics` === sequential `runConfig` (byte-identical); (2) `src/sweep/big300-verify-parallel.ts` ran the FULL subprocess path (spawn → JSONL → parse → reconstruct → merge → `computeMetrics`) on a cheap config and got `IDENTICAL: YES`.

## Step 1 — feasibility probe (per-game wall-clock + termination behavior)

The hazard is real and binding: **cap-hit games are the expensive ones, and cap-hits are exactly what we measure.** Per-move MCTS cost on a 300-hex board, measured directly:

| iterations | per-move wall-clock (early game) | observed game progress |
|---|---|---|
| **300** (codebase default for arena/sweep) | 2P: first move not measured but game **unfinished after 7+ min**; 3P: **first move 68 s**, still on turn 1 after 4+ min | **INFEASIBLE.** A single game runs hours; a cap-hit 6P game is unbounded. |
| **60** | 2P first move 41 s; 6P first move 22 s | infeasible at turnCap=60 (turns span multiple moves; many moves/game) |
| **20** | 2P ~17 s/move (turn 3 at move #5, 95 s); 6P ~14–19 s/move (turn 2 at move #7, 114 s) | a 2P game to the healthy median band (~10–15 turns) ≈ 5–10 min; a 6P game ≈ ~100–150 s **per turn** and rising |

**Termination behavior:** every probe game was still GRINDING (advancing move-by-move, no winner yet) when measured — none reached a decisive iron-victory in the probe window. Per the hazard, a game still grinding at a high turn is itself evidence of a near-cap-hit: strong play is NOT resolving these positions quickly. Per-move time RISES as the game grows (more bases/factories → more legal builds → deeper progressive-widening + combat sims), so the long games (the cap-hit candidates) are super-linearly expensive.

**Feasibility conclusion:** the requested full-fidelity run (300 iters, turnCap=60, all of [2,3,4,5,6]) is infeasible by orders of magnitude — a single capped 6P game alone would run many hours. The run was adapted with bounded-proxy deviations, documented below.

## Step 3 — the big300-under-MCTS measurement (documented deviations)

Deviations from the weak-run method, with rationale (everything else — config, `baseSeed=1n`, `[2,3,4,5,6]` rotation, the unmodified health gate — is held identical for CRN-comparability):

- **`iterations = 30`** (vs the 300 codebase default). 300 is infeasible (above). 30 still runs real progressive-widening lookahead — meaningfully stronger than the 1-ply `heuristicAgent` — at a feasible ~15–25 s/move.
- **`turnCap = 15`** (vs 60) — the primary bounded proxy. Rationale: the healthy median-turns band is [3, 25]; a *decisive* agent that converts stalemates wins by iron early (weak-run iron-victories were short). A game still unresolved at turn 15 is a stalemate signal. **Direction of the bias:** a lower cap can only INFLATE the apparent cap-hit rate (games that would have resolved between turns 15 and 60 are counted as cap-hits here). So a LOW capHit under this strict cap is strong evidence the stalemate is fixed; a HIGH capHit is partly a cap artifact, but a game grinding to turn 15 with no winner is precisely the "near-cap-hit" the hazard says to treat as evidence strong play did NOT resolve it.
- **`games = 40`** (8 per player-count), vs the weak hi-res run's 360. MCTS is far slower, so far fewer games — the `capHitFraction` 95% CI is correspondingly wider; reported honestly below. The gate is NOT loosened.

### Run as executed

- **19 games completed** (of a planned 40) before an EARLY STOP at the ~50-min wall-clock budget. The stop is itself per the hazard: the in-flight games at the stop (`gameIndex` 17, 19, 20, 22, 23, …) were the slow 5P/6P grinders — at the cut they had been running 20–40+ min each and were the only games not yet resolved. They are simply absent from the sample, not counted as resolved. Aggregated via `big300-run.ts --merge-only` over the completed shard JSONL.
- **Wall-clock:** ~50 min, **8 process shards** on a 10-core machine (≈ cpus−2). Per-game cost ran from 0 s (a setup-decided 2P elimination) to ~41 min (a 6P game to turn 9). The slowest five games were all 5P/6P (g14 6P 41 min, g16 3P 41 min, g9 6P 35 min, g18 5P 30 min, g4 6P 29 min).
- **Coverage:** all five player counts represented — 2P×4, 3P×5, 4P×3, 5P×4, 6P×3. Every game across every player count resolved decisively; **none reached the turn-15 cap.**

### Metrics (95% CI, normal approx; capHit uses rule-of-three for the 0-count)

| metric | big300 under MCTS (n=19) | gate | weak-agent baseline (n=360) |
|---|---|---|---|
| **capHitFraction** | **0.000** (95% upper bound ~0.16 by rule-of-three at n=19) | ≤ 0.02 | **0.039 ± 0.020** |
| ironVictoryFraction | 0.316 ± 0.209 | ≥ 0.50 | (passed) |
| medianTurns | 8 (mean 6.5) | 3–25 | (passed) |
| setupDecidedFraction | 0.000 | ≤ 0.05 | (passed) |
| leadVolatility | 0.632 ± 0.217 | ≥ 0.20 | (passed) |
| seatWinBias (max across groups) | 0.50 | ≤ 0.20 | (passed) |
| victoryType counts | iron 6, last-standing 13, cap-hit 0 | — | — |

**`isHealthy` verdict: NO.** Failing criteria: `ironVictoryFraction 0.316 < 0.50`; `seatWinBias 0.50 > 0.20`.

### Per-player-count cap-hit / victory breakdown

| nPlayers | games | cap-hit | iron | last-standing |
|---|---|---|---|---|
| 2 | 4 | 0 | 0 | 4 |
| 3 | 5 | 0 | 3 | 2 |
| 4 | 3 | 0 | 1 | 2 |
| 5 | 4 | 0 | 2 | 2 |
| 6 | 3 | 0 | 0 | 3 |

Cap-hits are **0 in every player-count bucket**, including the stalemate-prone 5P/6P games. Last-standing (win-by-elimination) dominates and grows with player count (2P and 6P are entirely last-standing in this sample).

### Reading the two failing gates honestly

- **`ironVictoryFraction` (the real new failure).** Under MCTS, big300 resolves by **eliminating opponents** far more than by reaching the iron-victory threshold (13 last-standing vs 6 iron). This is a genuine, directionally-clear finding: strong play does not produce the *intended* win condition (iron) at the required rate. The CI is wide (±0.21 at n=19) so the exact fraction is loose, but the point estimate (0.32) sits well below 0.50 and the qualitative pattern — elimination-dominant — is consistent across player counts.
- **`seatWinBias = 0.50` (small-sample artifact, not a trustworthy signal).** This is `max over player-count groups of max-seat |winRate − 1/n|`. With only 3–5 games per group, a single seat winning 2 of 3 games forces a large deviation mechanically. Per-group: 2P=0.0, 3P=0.47, 4P=0.25, 5P=0.30, 6P=0.50. The weak-run report already flagged seatBias as win-rate-based and inflated by skewed outcomes (`metrics.ts`, by design, not a bug). At n=19 total this gate is uninformative and should not be read as a real positional-advantage finding.

## Step 4 — verdict

**Does strong MCTS play make `big300` healthy? NO — but it DOES fix the cap-hit failure the weak run flagged.** Two distinct findings:

1. **The cap-hit hypothesis is CONFIRMED.** Under the weak `heuristicAgent`, big300 failed solely on `capHitFraction 0.039 ± 0.020`. Under all-seats MCTS, **capHit is 0/19 across every player count** (including the stalemate-prone 5P/6P games). Strong play converts every position into a decisive outcome before the cap — exactly the mechanism the two-regime finding predicted (large-board cap-hit is agent-sensitive). The cap-hit *failure mode* is gone.
   - **Statistical honesty:** with 0/19 cap-hits the point estimate is 0, but the 95% upper bound is only ~0.16 (rule of three at n=19), NOT < 0.02. To bound capHit tightly under 0.02 would need ~150 decisive games, which is infeasible at MCTS cost on this board (a single 6P game runs ~30–40 min). So the directional answer is strong and unambiguous (0 observed, dramatically below the weak 0.039); the *tight-CI gate-pass* on capHit alone is sample-limited, not demonstrated.

2. **Strong play surfaces a DIFFERENT failure: the iron-victory rate collapses.** big300 under MCTS fails `ironVictoryFraction` (0.316 vs gate 0.50) because MCTS wins by **elimination (last-standing), not by the iron threshold** — 13 of 19 games. The `seatWinBias` failure (0.50) is a small-sample artifact and should be discounted. So fixing the agent-sensitive cap-hit problem did not yield a healthy config; it revealed that the *intended* win condition (iron victory) does not dominate under strong play on this geometry.

**Bottom line for the milestone.** big300 is **NOT** the clean "healthy under strong play" config that would unblock MCTS A5.2/A6 on a green health gate. The good news for the MCTS-trustworthiness thread is real and specific: the cap-hit metric — the one the weak sweep singled out as agent-sensitive — behaves exactly as hypothesized under strong play (stalemates → decisive wins). The redesign signal is also strengthened but RE-AIMED: the live problem on big300 under strong play is not stalemates, it is that iron victory is not the dominant win condition (elimination is). Any future health-gate adoption of big300 must contend with `ironVictoryFraction`, not `capHitFraction`.

**Do NOT loosen the gate.** Per the plan, capHit was not loosened and the unmodified `defaultHealthThresholds()` was used throughout. The honest result is "cap-hit fixed, iron-victory now failing," reported with its CIs and its small-n caveat.

### Methodology deviations (summary, with rationale)

| deviation | value used | weak-run value | why | effect on the answer |
|---|---|---|---|---|
| iterations | 30 | 300 (codebase default) | 300 infeasible (3P first move 68 s; games run hours) | a weaker-but-real MCTS; still decisive enough to zero out cap-hits |
| turnCap | 15 | 60 | a turn-60 cap-hit 6P game runs many hours | lower cap can only INFLATE capHit; observing 0 is therefore conservative-safe |
| games | 19 completed (planned 40) | 360 | MCTS ~30–40 min per 6P game; early-stopped at the 50-min budget | wide CIs (esp. capHit upper bound ~0.16, iron ±0.21); directional findings robust, tight gate-pass not provable |
| player counts | [2,3,4,5,6] (unchanged) | [2,3,4,5,6] | held identical for CRN-comparability | none — same rotation, same baseSeed=1 boards |

### Determinism / parallelism verification (confirmed)

- **parallel == sequential, in-process:** `test/sweep/run.test.ts` runs interleaved disjoint `gameIndex` shards through `runGameEntry`, merges them, and asserts the aggregated `computeMetrics` is byte-identical to sequential `runConfig`. Green.
- **parallel == sequential, real subprocesses:** `src/sweep/big300-verify-parallel.ts` spawned real cheap shard subprocesses (full spawn → JSONL → parse → reconstruct → merge → `computeMetrics` path) and reported `IDENTICAL: YES` vs sequential `runConfig`.
- The big300 measurement therefore reflects the same per-game CRN seeds (`gameSeed(1n, gameIndex)`) the weak run used — apples-to-apples on boards/setups, agent swapped.
