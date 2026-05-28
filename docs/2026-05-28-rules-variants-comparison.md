# Rules-Variants Comparative Experiment — Results

**Date:** 2026-05-28 (overnight)
**Methodology:** `docs/plans/2026-05-28-rules-variants-experiment-methodology.md`
**Driving question:** which of the four §0.1 options — (a) P3 perimeter-gate, (b) P2 hold-iron, (c) lengthen elimination, (d) accept-and-stop-tuning — produces a config that is *balanced under MCTS*, not just under greedy?
**Variants tested:** baseline + (a) + (b)×2 hold values + (c). Common grid: radius {2,3} × ironCount {12,14} × victoryThreshold {10,12} on boardSize 96, 150 games/config under heuristic, baseSeed 5000. MCTS revalidation: 12 games on counts 2,3, turnCap 60, 100-iter, plus 16-game 2P MCTS-vs-heuristic head-to-head.

## Verdict matrix

| Variant | Best cell | Greedy-healthy? | MCTS-healthy? | MCTS iron-vic | MCTS median turns | MCTS vs heuristic |
| --- | --- | --- | --- | --- | --- | --- |
| baseline | r=2 iron=12 vt=12 | YES | no | 0.00 | 1 | 25% vs 69% (decisive 15) |
| (a) P3 | r=2 iron=14 vt=10 | no (nearest miss) | no | 0.17 | 12.5 | 0% vs 100% (decisive 16) |
| (b) P2 hold=2 | r=2 iron=12 vt=12 | YES | no | 0.00 | 1 | — |
| (b) P2 hold=3 | r=3 iron=14 vt=10 | YES | — | — | — | — |
| (c) noIron-perimeter | r=2 iron=14 vt=10 | no (nearest miss) | no | 0.25 | 12.5 | 6% vs 94% (decisive 16) |

## Per-variant detail

### baseline

Current default rules (all variant flags off). The control — what the calibration validated under greedy and the revalidation overturned under MCTS.

**Flags:** `{}`
**Elapsed:** 1173.6s
**Best cell:** r=2, ironCount=12, victoryThreshold=12 — PASSED all 7 health gates under greedy.
- **Greedy metrics:** med=3 cap=0.01 setup=0.00 iron=0.84 seat=0.17 lead=0.41
- **MCTS metrics:** med=1 cap=0.00 setup=0.00 iron=0.00 seat=0.33 lead=0.18 FAIL
- **MCTS victory type mix:** iron=0, last-standing=12, none(cap)=0 of 12.
- **2P MCTS-vs-heuristic head-to-head:** mctsWinRate=25.0% vs heuristicWinRate=68.8% over 16 games (decisive 15).

### (a) P3

Variant (a): perimeter-gate victory-iron + perimeter-gate noIron elimination together. Iron only counts toward victory once committed in a perimeter; radiating players with 0 iron aren't eliminated.

**Flags:** `{"victoryIronRequiresPerimeter":true,"noIronRequiresPerimeter":true}`
**Elapsed:** 2392.3s
**Best cell:** r=2, ironCount=14, victoryThreshold=10 — did NOT pass all 7 under greedy (best ranked nearest-miss).
- **Greedy metrics:** med=2 cap=0.00 setup=0.00 iron=1.00 seat=0.10 lead=0.49
- **MCTS metrics:** med=12.5 cap=0.00 setup=0.00 iron=0.17 seat=0.50 lead=0.75 FAIL
- **MCTS victory type mix:** iron=2, last-standing=10, none(cap)=0 of 12.
- **2P MCTS-vs-heuristic head-to-head:** mctsWinRate=0.0% vs heuristicWinRate=100.0% over 16 games (decisive 16).

### (b) P2 hold=2

Variant (b): iron victory requires holding the threshold across 2 consecutive end-of-turn checks (one rollover of denial pressure before victory fires).

**Flags:** `{"victoryIronHoldRounds":2}`
**Elapsed:** 1112.8s
**Best cell:** r=2, ironCount=12, victoryThreshold=12 — PASSED all 7 health gates under greedy.
- **Greedy metrics:** med=4 cap=0.01 setup=0.00 iron=0.84 seat=0.17 lead=0.39
- **MCTS metrics:** med=1 cap=0.00 setup=0.00 iron=0.00 seat=0.33 lead=0.18 FAIL
- **MCTS victory type mix:** iron=0, last-standing=12, none(cap)=0 of 12.

### (b) P2 hold=3

Variant (b) with a longer hold: 3 consecutive end-of-turn checks. Probes whether the hold *length* matters.

**Flags:** `{"victoryIronHoldRounds":3}`
**Elapsed:** 291.1s
**Best cell:** r=3, ironCount=14, victoryThreshold=10 — PASSED all 7 health gates under greedy.
- **Greedy metrics:** med=3 cap=0.00 setup=0.00 iron=1.00 seat=0.18 lead=0.52

### (c) noIron-perimeter

Variant (c): perimeter-gate noIron alone, without changing the victory model. Iron-denial elimination still wins games, but only after the player has committed a perimeter — preventing turn-1 collapse.

**Flags:** `{"noIronRequiresPerimeter":true}`
**Elapsed:** 2511.4s
**Best cell:** r=2, ironCount=14, victoryThreshold=10 — did NOT pass all 7 under greedy (best ranked nearest-miss).
- **Greedy metrics:** med=2 cap=0.00 setup=0.00 iron=1.00 seat=0.12 lead=0.47
- **MCTS metrics:** med=12.5 cap=0.00 setup=0.00 iron=0.25 seat=0.50 lead=0.67 FAIL
- **MCTS victory type mix:** iron=3, last-standing=9, none(cap)=0 of 12.
- **2P MCTS-vs-heuristic head-to-head:** mctsWinRate=6.3% vs heuristicWinRate=93.8% over 16 games (decisive 16).

## Interpretation notes (auto-flagged, not Sam's verdict)
- **No variant tested produced a config that is healthy under MCTS** in this grid. The agent-relative balance problem is not fixed by these specific flag values; consider expanding the grid, tuning the flag values (e.g. holdRounds 4-5), combining variants, or option (d).
- **Greedy-healthy but MCTS-unhealthy (the BAL-1 trap, again):** baseline, (b) P2 hold=2. These reproduce the same artifact as the baseline calibration — the gate certifies agent myopia.
- The grid is intentionally small (4 cells per variant before infeasibility prune); a variant being "MCTS-unhealthy in this grid" doesn't mean no MCTS-healthy config exists for it elsewhere in geometry space. Treat as a SIGNAL, not a verdict.

---
*Generated by `src/sweep/compare-variants.ts`.*
