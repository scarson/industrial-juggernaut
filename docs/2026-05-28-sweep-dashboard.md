# Sweep Dashboard

**Date:** generated 2026-05-29T10:24:34.955Z. **Source:** every JSONL under `docs/sweeps/data/`.

Run `npx tsx src/sweep/dashboard.ts` to refresh.

## Files

| File | Records |
| --- | ---: |
| `2026-05-28-alliance-deltas-aware.jsonl` | 750 |
| `2026-05-28-alliance-deltas.jsonl` | 750 |
| `2026-05-28-alliance-weights.jsonl` | 250 |
| `2026-05-28-mcts-300-on-c.jsonl` | 28 |
| `2026-05-28-mcts-budgets.jsonl` | 48 |
| `2026-05-28-profile-turn-complexity.jsonl` | 3 |
| `2026-05-29-longer-game-regime-grid.jsonl` | 450 |
| `2026-05-29-lookahead2-multi-vs-heuristic-c-3p.jsonl` | 235 |
| `2026-05-29-lookahead2-multi-vs-heuristic-c-4p.jsonl` | 100 |
| `2026-05-29-lookahead2-self-play.jsonl` | 112 |
| `2026-05-29-lookahead2-vs-heuristic-c-2p.jsonl` | 300 |
| `2026-05-29-lookahead2-vs-heuristic-c-3p.jsonl` | 150 |
| `2026-05-29-lookahead2-vs-heuristic-c-4p.jsonl` | 100 |
| `2026-05-29-lookahead2-vs-heuristic-default-2p.jsonl` | 200 |
| `2026-05-29-lookahead3-vs-heuristic-c-2p.jsonl` | 1 |
| `2026-05-29-mcts500-vs-heuristic-c-2p.jsonl` | 48 |
| `2026-05-29-random-vs-heuristic.jsonl` | 180 |
| `2026-05-29-tactical-depth-effect.jsonl` | 57 |

## Per-file detail

### 2026-05-28-alliance-deltas.jsonl

**Records:** 750

| variant | games | iron | last-std | none | median t | iron-vic | victory bar |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `alliances OFF (baseline)` | 150 | 150 | 0 | 0 | 2.0 | 100.0% | `████████████████████` |
| `alliances ON, delta=2` | 150 | 145 | 5 | 0 | 2.0 | 96.7% | `███████████████████·` |
| `alliances ON, delta=3` | 150 | 145 | 5 | 0 | 2.0 | 96.7% | `███████████████████·` |
| `alliances ON, delta=4 (default)` | 150 | 145 | 5 | 0 | 2.0 | 96.7% | `███████████████████·` |
| `alliances ON, delta=5` | 150 | 139 | 11 | 0 | 2.0 | 92.7% | `███████████████████·` |

### 2026-05-28-mcts-300-on-c.jsonl

**Records:** 28

| phase | games | iron | last-std | none | median t | iron-vic | victory bar |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `h2h` | 16 | 15 | 1 | 0 | 2.0 | 93.8% | `███████████████████·` |
| `health` | 12 | 2 | 10 | 0 | 12.0 | 16.7% | `███·················` |

### 2026-05-28-profile-turn-complexity.jsonl

**Records:** 3

| scenario | finalTurns | victoryType | winner | rounds | legal[turn1] | legal[final turn] | ms[turn1] | ms[final turn] |
| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: |
| `Variant (c) 2P all-MCTS — long-game scenario` | 12 | last-standing | [0] | 24 | 63 | 102 | 29827 | 901 |
| `Variant (c) 2P MCTS(seat0) vs heuristic(seat1)` | 2 | iron | [1] | 4 | 65 | 126 | 13 | 34 |
| `Baseline 2P all-MCTS — turn-1 collapse scenario` | 1 | last-standing | [1] | 1 | 65 | 65 | 221 | 221 |

### 2026-05-28-alliance-deltas-aware.jsonl

**Records:** 750

| variant | games | iron | last-std | none | median t | iron-vic | victory bar |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `alliances OFF (baseline)` | 150 | 150 | 0 | 0 | 2.0 | 100.0% | `████████████████████` |
| `alliances ON, delta=2` | 150 | 139 | 11 | 0 | 2.0 | 92.7% | `███████████████████·` |
| `alliances ON, delta=3` | 150 | 139 | 11 | 0 | 2.0 | 92.7% | `███████████████████·` |
| `alliances ON, delta=4 (default)` | 150 | 137 | 13 | 0 | 2.0 | 91.3% | `██████████████████··` |
| `alliances ON, delta=5` | 150 | 134 | 16 | 0 | 2.0 | 89.3% | `██████████████████··` |

### 2026-05-28-alliance-weights.jsonl

**Records:** 250
**Aggregate:** 250 games · iron=191 · last-standing=59 · none=0 · median turns=2.0
**Iron-vic:** 76.4% `███████████████·····`

### 2026-05-28-mcts-budgets.jsonl

**Records:** 48
**Aggregate:** 48 games · iron=48 · last-standing=0 · none=0 · median turns=2.0
**Iron-vic:** 100.0% `████████████████████`

### 2026-05-29-longer-game-regime-grid.jsonl

**Records:** 450
**Aggregate:** 450 games · iron=184 · last-standing=45 · none=221 · median turns=11.5
**Iron-vic:** 40.9% `████████············`

### 2026-05-29-lookahead2-multi-vs-heuristic-c-3p.jsonl

**Records:** 235
**Aggregate:** 235 games · iron=235 · last-standing=0 · none=0 · median turns=2.0
**Iron-vic:** 100.0% `████████████████████`

### 2026-05-29-lookahead2-multi-vs-heuristic-c-4p.jsonl

**Records:** 100
**Aggregate:** 100 games · iron=100 · last-standing=0 · none=0 · median turns=2.0
**Iron-vic:** 100.0% `████████████████████`

### 2026-05-29-lookahead2-self-play.jsonl

**Records:** 112
**Aggregate:** 112 games · iron=112 · last-standing=0 · none=0 · median turns=2.0
**Iron-vic:** 100.0% `████████████████████`

### 2026-05-29-lookahead2-vs-heuristic-c-2p.jsonl

**Records:** 300
**Aggregate:** 300 games · iron=300 · last-standing=0 · none=0 · median turns=2.0
**Iron-vic:** 100.0% `████████████████████`

### 2026-05-29-lookahead2-vs-heuristic-c-3p.jsonl

**Records:** 150
**Aggregate:** 150 games · iron=149 · last-standing=0 · none=1 · median turns=2.0
**Iron-vic:** 99.3% `████████████████████`

### 2026-05-29-lookahead2-vs-heuristic-c-4p.jsonl

**Records:** 100
**Aggregate:** 100 games · iron=100 · last-standing=0 · none=0 · median turns=2.0
**Iron-vic:** 100.0% `████████████████████`

### 2026-05-29-lookahead2-vs-heuristic-default-2p.jsonl

**Records:** 200
**Aggregate:** 200 games · iron=200 · last-standing=0 · none=0 · median turns=1.0
**Iron-vic:** 100.0% `████████████████████`

### 2026-05-29-lookahead3-vs-heuristic-c-2p.jsonl

**Records:** 1
**Aggregate:** 1 games · iron=1 · last-standing=0 · none=0 · median turns=2.0
**Iron-vic:** 100.0% `████████████████████`

### 2026-05-29-mcts500-vs-heuristic-c-2p.jsonl

**Records:** 48
**Aggregate:** 48 games · iron=45 · last-standing=3 · none=0 · median turns=2.0
**Iron-vic:** 93.8% `███████████████████·`

### 2026-05-29-random-vs-heuristic.jsonl

**Records:** 180
**Aggregate:** 180 games · iron=177 · last-standing=1 · none=2 · median turns=2.0
**Iron-vic:** 98.3% `████████████████████`

### 2026-05-29-tactical-depth-effect.jsonl

**Records:** 57
**Aggregate:** 57 games · iron=55 · last-standing=0 · none=2 · median turns=2.0
**Iron-vic:** 96.5% `███████████████████·`

---
*Generated by `src/sweep/dashboard.ts`.*
