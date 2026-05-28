# CPU Utilization Finding — Environment-Specific

**Date:** 2026-05-28 (measured during the MCTS@300 stress-test run, then re-confirmed after container restart).
**Purpose:** Capture what we measured about how the GamePool actually uses cores, AND the load-bearing caveat that this finding is specific to the Claude Code cloud container's 4-core environment. Sam's desktop and MacBook Air M5 have 10+ cores; the recommendation changes there.

## What we measured

In the CC cloud container (4 vCPU, 15 GiB RAM, no swap), during active MCTS@300 sweep compute:

| Sample | Source | Result |
|---|---|---|
| 5-sec /proc/stat aggregate | Transient (phase transition; main thread writing partial state) | 26.2% aggregate, CPU1 99.8%, others 1-2% |
| `top -bn2 -H` per-thread snapshot | Mid-h2h phase | All 4 worker threads at 91-98% CPU each |
| 10-sec /proc/stat (steady-state h2h) | Aggregated over 10s during compute | **Aggregate 99.9%, every individual CPU at 100%** |
| `ps` lifetime average per worker | Across the ~70-min run | 72.9% / 82.2% / 85.5% / 95.8% — averaged across both compute and brief idle phases |

**Conclusion in the 4-core environment:** the GamePool's game-level parallelism (4 workers, one game each) is **already saturating all available cores** during active sweep work. There is essentially no slack.

## The environment-specific caveat (load-bearing)

This conclusion is SPECIFIC to the 4-core container. On Sam's other compute (10+ core desktop, MacBook Air M5), the picture changes substantially:

- **More than 4 cores idle if pool stays at 4 workers.** Default `WORKERS = 4` in current scripts under-uses larger machines.
- **`GamePool(workers: number)` is already parameterizable** — bump to match physical cores (or just `os.cpus().length - 1` to leave one for the parent / OS). Existing `revalidate.ts` already takes `--workers N`; other scripts should too.
- **Intra-game parallelism (root parallelism per MCTS search) becomes attractive on 10+ core hosts** in a way it isn't here:
  - With 8 game-level workers + 2-way root parallelism per MCTS, you'd use 16 logical cores while still running 8 concurrent games — no degradation of throughput.
  - At our 4-core container, the same setup means 8 worker × 2-way = 16 logical-core demand → 4× oversubscription → context-switching cost wipes the benefit.

## Recommendation by environment

| Environment | Game-level workers | Intra-game (root) parallelism | Rationale |
|---|---|---|---|
| **CC cloud container (4 vCPU)** | 4 (current default) | None (1-way) | Already saturated; adding intra-game would oversubscribe |
| **Sam's desktop (assume 10-16 cores)** | `cores - 1` for OS headroom | 1-way for sweeps; 2-4-way per move for single-game / Opus pilot / latency-sensitive demos | Sweeps prefer throughput; single-game scenarios prefer per-move latency |
| **MacBook Air M5 (assume 10 cores)** | 8-9 workers for sweeps | Same recommendation as desktop | Same logic |

**Specifically for an Opus-vs-MCTS pilot:**
- On the cloud container: reduce `WORKERS` to 1, give the freed 3 cores to a 3-way root parallelism if/when it's implemented.
- On Sam's 10-core machines: keep e.g. 2-4 game-level workers + 4-way root parallelism per MCTS move. Per-move latency drops 4×; throughput unchanged.

## Code/script implications

- **Currently in the repo:** `WORKERS` is hardcoded in `mcts-300-on-c.ts`, `compare-variants.ts`, `compare-alliance-deltas.ts`, `explore-c-variant.ts`, `profile-turn-complexity.ts`. All at 4. `revalidate.ts` accepts `--workers N`.
- **Suggested follow-up:** factor `WORKERS` to a shared helper that respects `--workers` arg + falls back to `os.cpus().length - 1` (capped at the run's needs). Small, mechanical, environment-portable.
- **Intra-MCTS root parallelism (not yet implemented):** when the workload calls for it, a `mctsRootParallelism: number` config knob in `mctsAgent({ ...defaultMctsParams(), iterations, rootParallelism: 4 })` would spawn N subtree searches per move (different rng seeds) and merge their root-visit distributions. ~200 LOC + TDD. Well-understood technique (standard "Root parallelization" in MCTS literature).

## Why this is worth persisting

The 4-core CC container conclusion ("we're already saturated; don't add intra-MCTS parallelism") would be **wrong advice** if applied unthinkingly on Sam's 10-core hardware. A future agent or session might re-derive the saturation finding and conclude "no parallelism work needed" — which would leave the Air M5 at 30% utilization for sweeps. Hence this explicit, environment-tagged note.

## Future-state checklist

When migrating off the cloud container:
- [ ] Default `WORKERS` should be `os.cpus().length - 1` (with `--workers N` override).
- [ ] Profile a sample sweep on the target hardware to confirm saturation.
- [ ] If a latency-sensitive scenario lands (Opus pilot, h2h gates, etc.), reconsider intra-MCTS parallelism per the recommendation table above.
- [ ] Update the "Container/Environment" section of the handoff doc with the new compute profile.
