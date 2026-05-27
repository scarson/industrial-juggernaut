# Balance Sweep Report

Games per config: 600

Health thresholds:

```json
{
  "minMedianTurns": 3,
  "maxMedianTurns": 25,
  "maxSetupDecided": 0.05,
  "minIronVictory": 0.5,
  "maxCapHit": 0.02,
  "maxSeatBias": 0.2,
  "minLeadVolatility": 0.2
}
```

## Recommended balanced config

Config: boardSize=96, radius=2, ironCount=12, victoryThreshold=12, attackRange=6, autoWinAt6=true, killBounty=full

Composite score: -0.030

| metric | value |
| --- | --- |
| medianTurns | 3 |
| meanTurns | 5.102 |
| setupDecidedFraction | 0 |
| ironVictoryFraction | 0.788 |
| capHitFraction | 0.017 |
| seatWinBias | 0.167 |
| leadVolatility | 0.348 |

## Grid health

| boardSize | radius | ironCount | victoryThreshold | attackRange | autoWinAt6 | killBounty | medianTurns | setupDecided | ironVic | seatBias | leadVol | health |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 96 | 2 | 12 | 11 | 6 | true | full | 2 | 0 | 0.813 | 0.150 | 0.324 | FAIL: medianTurns 2 below min 3 |
| 96 | 2 | 12 | 12 | 6 | true | full | 3 | 0 | 0.788 | 0.167 | 0.348 | PASS |
| 96 | 2 | 14 | 11 | 6 | true | full | 2 | 0 | 0.940 | 0.125 | 0.476 | FAIL: medianTurns 2 below min 3 |
| 96 | 2 | 14 | 12 | 6 | true | full | 2 | 0 | 0.940 | 0.092 | 0.427 | FAIL: medianTurns 2 below min 3 |
| 96 | 2 | 14 | 13 | 6 | true | full | 2 | 0 | 0.932 | 0.117 | 0.429 | FAIL: medianTurns 2 below min 3 |
| 96 | 2 | 16 | 11 | 6 | true | full | 2 | 0 | 0.993 | 0.092 | 0.600 | FAIL: medianTurns 2 below min 3 |
| 96 | 2 | 16 | 12 | 6 | true | full | 2 | 0 | 0.993 | 0.092 | 0.602 | FAIL: medianTurns 2 below min 3 |
| 96 | 2 | 16 | 13 | 6 | true | full | 2 | 0 | 0.993 | 0.092 | 0.600 | FAIL: medianTurns 2 below min 3 |
| 96 | 3 | 12 | 11 | 6 | true | full | 2 | 0 | 0.993 | 0.200 | 0.197 | FAIL: medianTurns 2 below min 3; leadVolatility 0.19666666666666666 below min 0.2 |
| 96 | 3 | 12 | 12 | 6 | true | full | 2 | 0 | 0.988 | 0.133 | 0.415 | FAIL: medianTurns 2 below min 3 |
| 96 | 3 | 14 | 11 | 6 | true | full | 1 | 0 | 1 | 0.100 | 0 | FAIL: medianTurns 1 below min 3; leadVolatility 0 below min 0.2 |
| 96 | 3 | 14 | 12 | 6 | true | full | 1 | 0 | 1 | 0.258 | 0.023 | FAIL: medianTurns 1 below min 3; seatWinBias 0.2583333333333333 above max 0.2; leadVolatility 0.023333333333333334 below min 0.2 |
| 96 | 3 | 14 | 13 | 6 | true | full | 2 | 0 | 1 | 0.283 | 0.313 | FAIL: medianTurns 2 below min 3; seatWinBias 0.2833333333333333 above max 0.2 |
| 96 | 3 | 16 | 11 | 6 | true | full | 1 | 0 | 1 | 0.058 | 0 | FAIL: medianTurns 1 below min 3; leadVolatility 0 below min 0.2 |
| 96 | 3 | 16 | 12 | 6 | true | full | 1 | 0 | 1 | 0.058 | 0 | FAIL: medianTurns 1 below min 3; leadVolatility 0 below min 0.2 |
| 96 | 3 | 16 | 13 | 6 | true | full | 1 | 0 | 1 | 0.108 | 0 | FAIL: medianTurns 1 below min 3; leadVolatility 0 below min 0.2 |

## Balance (OFAT effects)

### autoWinAt6

| value | medianTurns | ironVictoryFraction (±95% CI) | setupDecided | seatBias | leadVol |
| --- | --- | --- | --- | --- | --- |
| true | 3 | 0.788 ± 0.033 | 0 | 0.167 | 0.348 |
| false | 3 | 0.787 ± 0.033 | 0 | 0.167 | 0.348 |

### killBounty

| value | medianTurns | ironVictoryFraction (±95% CI) | setupDecided | seatBias | leadVol |
| --- | --- | --- | --- | --- | --- |
| full | 3 | 0.788 ± 0.033 | 0 | 0.167 | 0.348 |
| half | 3 | 0.773 ± 0.034 | 0 | 0.158 | 0.349 |
| none | 3 | 0.725 ± 0.036 | 0 | 0.150 | 0.338 |

### victoryThreshold

| value | medianTurns | ironVictoryFraction (±95% CI) | setupDecided | seatBias | leadVol |
| --- | --- | --- | --- | --- | --- |
| 11 | 2 | 0.813 ± 0.031 | 0 | 0.150 | 0.324 |
| 12 | 3 | 0.788 ± 0.033 | 0 | 0.167 | 0.348 |
| 13 | 18 | 0 ± 0 | 0 | 0.150 | 0.326 |

### attackRange

| value | medianTurns | ironVictoryFraction (±95% CI) | setupDecided | seatBias | leadVol |
| --- | --- | --- | --- | --- | --- |
| 5 | 3 | 0.695 ± 0.037 | 0 | 0.167 | 0.300 |
| 6 | 3 | 0.788 ± 0.033 | 0 | 0.167 | 0.348 |

## Per-count seatBias (noise-floor diagnostic)

`seatWinBias` (the gate metric) is the MAX over player counts, so it is dominated by the highest count, which has the fewest games per seat and thus the largest sampling noise. This table breaks it out per count so a "seatBias FAIL" can be read as genuine low-count bias vs. an under-sampled high-count artifact.

| config | 2P | 3P | 4P | 5P | 6P | max(gate) |
| --- | --- | --- | --- | --- | --- | --- |
| boardSize=96, radius=2, ironCount=12, victoryThreshold=11 | 0.075 | 0.150 | 0.075 | 0.125 | 0.083 | 0.150 |
| boardSize=96, radius=2, ironCount=12, victoryThreshold=12 | 0.083 | 0.167 | 0.042 | 0.100 | 0.075 | 0.167 |
| boardSize=96, radius=2, ironCount=14, victoryThreshold=11 | 0.083 | 0.125 | 0.033 | 0.108 | 0.100 | 0.125 |
| boardSize=96, radius=2, ironCount=14, victoryThreshold=12 | 0.075 | 0.092 | 0.033 | 0.092 | 0.075 | 0.092 |
| boardSize=96, radius=2, ironCount=14, victoryThreshold=13 | 0.083 | 0.108 | 0.050 | 0.117 | 0.108 | 0.117 |
| boardSize=96, radius=2, ironCount=16, victoryThreshold=11 | 0.042 | 0.067 | 0.042 | 0.092 | 0.083 | 0.092 |
| boardSize=96, radius=2, ironCount=16, victoryThreshold=12 | 0.042 | 0.067 | 0.042 | 0.092 | 0.083 | 0.092 |
| boardSize=96, radius=2, ironCount=16, victoryThreshold=13 | 0.042 | 0.067 | 0.042 | 0.092 | 0.083 | 0.092 |
| boardSize=96, radius=3, ironCount=12, victoryThreshold=11 | 0.000 | 0.200 | 0.092 | 0.175 | 0.100 | 0.200 |
| boardSize=96, radius=3, ironCount=12, victoryThreshold=12 | 0.008 | 0.050 | 0.042 | 0.133 | 0.058 | 0.133 |
| boardSize=96, radius=3, ironCount=14, victoryThreshold=11 | 0.025 | 0.075 | 0.033 | 0.100 | 0.058 | 0.100 |
| boardSize=96, radius=3, ironCount=14, victoryThreshold=12 | 0.000 | 0.242 | 0.192 | 0.258 | 0.167 | 0.258 |
| boardSize=96, radius=3, ironCount=14, victoryThreshold=13 | 0.008 | 0.100 | 0.133 | 0.283 | 0.142 | 0.283 |
| boardSize=96, radius=3, ironCount=16, victoryThreshold=11 | 0.017 | 0.058 | 0.008 | 0.050 | 0.042 | 0.058 |
| boardSize=96, radius=3, ironCount=16, victoryThreshold=12 | 0.017 | 0.058 | 0.008 | 0.050 | 0.042 | 0.058 |
| boardSize=96, radius=3, ironCount=16, victoryThreshold=13 | 0.033 | 0.108 | 0.025 | 0.108 | 0.075 | 0.108 |

Per-seat 95% CI half-width on a fair (0.5) win-rate at 600 games: 2P≈±0.13, 3P≈±0.15, 4P≈±0.18, 5P≈±0.20, 6P≈±0.22

Read: where a count's per-seat CI is wider than the 0.20 gate, that count cannot be distinguished from fair at this sample size — its bias is not yet evidence.
