# Balance-Sweep Harness — Usage

How to drive the offline balance/agent-evaluation harness under `src/sweep/` (+ `src/eval/`). All scripts run via `tsx` from the repo root and are deterministic for a fixed seed.

## Runnable scripts

| Script | Question it answers | Output |
|---|---|---|
| `npx tsx src/sweep/main.ts` | Wide geometry grid search — is there a balanced config anywhere? | `docs/sweeps/2026-05-27-balance-report.md` |
| `npx tsx src/sweep/calibrate.ts` | Focused, high-games (600) confirmation around the `b96/r2/vt12` near-misses; is the seatBias failure real or noise? | `docs/sweeps/2026-05-27-calibration-report.md` |
| `npx tsx src/sweep/revalidate.ts [--workers N]` | Does the balanced config survive **strong (MCTS) play**? (Part A: all-MCTS health; Part B: gate-2 MCTS-vs-heuristic) | stdout |

Reports are deliverables — commit them.

## Parallelism

Game simulation is embarrassingly parallel (each game is independent and seed-determined). `GamePool` (`src/sweep/pool.ts`) spawns a pool of persistent `tsx` worker processes; `runConfigParallel` / `roundRobinParallel` / `findBalancedConfigParallel` (`src/sweep/run-parallel.ts`) shard games across them.

- Pass `--workers N` where a script supports it (default 4 = all cores; the parent is I/O-bound awaiting results).
- **Determinism guarantee:** a parallel run is **bit-for-bit identical** to the serial run. Seeds are derived from the game *index* (not execution order), and aggregation (`computeMetrics`, `aggregateArena`) is order-independent. This is enforced by tests (`test/sweep/run-parallel.test.ts`, `test/sweep/pool.test.ts`): parallel == serial, and worker-count-invariant. **Never** weaken these tests to make a run faster.
- Only run **one** heavy sweep at a time — N workers already saturate N cores; a second concurrent sweep (or the test suite) starves them.
- All-MCTS multiplayer self-play is expensive (a 4P multi-turn game can take 15–20 min); prefer 2P MCTS-vs-heuristic matchups for agent comparisons.

## Health gate

`isHealthy(metrics, thresholds)` (`src/sweep/health.ts`) — a config is healthy iff ALL pass. Defaults (`defaultHealthThresholds()`):

| threshold | meaning |
|---|---|
| `minMedianTurns: 3` / `maxMedianTurns: 25` | multi-turn but terminating |
| `maxSetupDecided: 0.05` | not decided before play |
| `minIronVictory: 0.5` | the iron win condition actually drives games |
| `maxCapHit: 0.02` | games terminate |
| `maxSeatBias: 0.20` | no overwhelming first-mover advantage |
| `minLeadVolatility: 0.2` | outcomes aren't fully determined early |

`seatWinBias` is the MAX over player counts, so it is dominated by the highest count (fewest games/seat → noisiest); read it alongside the report's **per-count seatBias** section, which shows whether a high value is genuine low-count bias or an under-sampled high-count artifact. At 150 games/config the per-seat CI (~±0.18) is near the 0.20 gate — a "seatBias FAIL" there is often noise (this is why the calibration runs 600).

## Interpreting agent-relative balance

Config "health" is **agent-dependent**: the same config can be median-3 / iron-driven under the heuristic agent and turn-1 / elimination-driven under MCTS. Neither agent is human-like, and alliances (a core mid-game mechanic) are unmodeled — so the harness *informs* a balance decision but does not settle it. See `2026-05-27-balance-rules-analysis.md` for the full caveats.

## Determinism rules (do not break)

- All randomness flows through the seeded PCG (`src/rng/pcg.ts`); no `Math.random`.
- A config's games use common random numbers: per-game seed = `baseSeed + gameIndex`, config-independent, so config-to-config metric *differences* aren't seed noise.
- Agents are reconstructed in workers from serializable `AgentSpec`s (`src/sweep/agent-spec.ts`) — they carry no hidden state, so worker play matches in-process play exactly.
