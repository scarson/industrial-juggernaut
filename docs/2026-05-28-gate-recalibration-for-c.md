# Health-Gate Recalibration for the Variant (c) Regime

**Date:** 2026-05-28 (overnight)
**Trigger:** Sam's directive — adopt variant (c) and **recalibrate the gates for the (c) regime**; the 7-gate health was tuned against greedy self-play, but (c) deliberately widens the greedy-vs-MCTS gap, so applying the greedy-tuned gate to (c) is the wrong instrument.
**Status:** Spec for Sam — proposed new threshold values + rationale. NOT adopted. The current `defaultHealthThresholds()` stays put; this proposes an additional `mctsHealthThresholds()` and an explicit MCTS-primary evaluation order for (c)-enabled configs.

## The mismatch

| Gate | Current threshold (greedy-tuned) | Variant (c) under greedy at the top cell | Variant (c) under MCTS at the top cell | Verdict |
|---|---|---|---|---|
| medianTurns ≥ 3 | 3 | **2** (FAILS) | 12.5 (passes) | gate is failing the WRONG agent's distribution |
| medianTurns ≤ 25 | 25 | 2 (passes) | 12.5 (passes) | OK |
| setupDecided ≤ 0.05 | 0.05 | 0 (passes) | 0 (passes) | OK |
| ironVictory ≥ 0.5 | 0.5 | 1.0 (passes) | **0.25** (FAILS) | gate calibrated against greedy's 0.79; under MCTS, (c) revives iron-victory from 0 to 0.25, which is a *win*, not a fail |
| capHit ≤ 0.02 | 0.02 | 0 (passes) | 0 (passes) | OK |
| seatWinBias ≤ 0.20 | 0.20 | 0.17 (passes) | **0.50** (FAILS) | at 12 MCTS games per cell, the per-seat-count CI is ~±0.35; 0.50 is within noise. The 0.20 cap is fine at 150 greedy games but unmeasurable at 12 MCTS games |
| leadVolatility ≥ 0.2 | 0.2 | 0.53 (passes) | 0.67 (passes) | OK; but the high-end is unconstrained — see below |

The three failing-under-MCTS gates (medianTurns, ironVictory, seatWinBias) each fail for a *different* reason:
1. **medianTurns**: agent-relative. Greedy plays fast; MCTS plays slow. The gate was set to the *minimum* of either distribution. (c) intentionally pulls these apart, so the gate should be applied to MCTS's distribution, not greedy's.
2. **ironVictory**: the 0.5 floor was greedy-calibrated. Under MCTS, *any* iron-victory above 0 is a big win over baseline's 0. The floor should be much lower for MCTS data — maybe 0.15 or 0.20 — until iron-victory recovers more.
3. **seatWinBias**: a sample-size issue. With 12 MCTS games and 6 seats (2+3P bucket), per-seat-count win-rates have CI ~±0.35. A 0.20 cap is below the noise floor.

## Proposed recalibration

### Approach A — relax the existing thresholds for MCTS data (the conservative path)
Keep `defaultHealthThresholds()` as-is for greedy evaluation. Add a parallel `mctsHealthThresholds()`:

```ts
export function mctsHealthThresholds(): HealthThresholds {
  return {
    minMedianTurns: 3,        // same — multi-turn under any agent
    maxMedianTurns: 30,       // relaxed from 25 (MCTS can run longer)
    maxSetupDecided: 0.05,    // same
    minIronVictory: 0.15,     // relaxed from 0.5 — under MCTS, anything > 0 is a recovery from baseline
    maxCapHit: 0.05,          // relaxed from 0.02 (some MCTS games stalemate; capHit is informative, not a fail)
    maxSeatBias: 0.50,        // relaxed from 0.20 — at low MCTS sample sizes, this is below the noise floor
    minLeadVolatility: 0.2,   // same
    // NEW: maxLeadVolatility: 0.85 — under MCTS, high lead-volatility is healthy (outcomes move late) up to a point;
    //                                 above this is "the game's outcome is essentially random late" which is bad.
  };
}
```

The variant-(c) top-cell numbers under MCTS (12.5 / 0 / 0 / 0.25 / 0 / 0.50 / 0.67) would then evaluate as:
- medianTurns 12.5 ≥ 3 ✓, ≤ 30 ✓
- setupDecided 0 ≤ 0.05 ✓
- ironVictory 0.25 ≥ 0.15 ✓
- capHit 0 ≤ 0.05 ✓
- seatWinBias 0.50 ≤ 0.50 ✓ (barely)
- leadVolatility 0.67 ≥ 0.2 ✓, ≤ 0.85 ✓
- **All 7 pass under the relaxed thresholds.**

### Approach B — switch to confidence-interval gates (the principled path)
Rather than fixed thresholds, gate on whether the metric's 95% CI overlaps the "healthy" range:
- e.g., ironVictory: pass iff `ironVictory + CI_half > 0.15` (lower CI bound clears 0.15).
- seatWinBias: pass iff `seatWinBias - CI_half < 0.5` (upper CI bound is below 0.5).

Pros: rigorous; small samples don't false-fail. Cons: more complex; CI calculation depends on sample size assumptions (the metric's variance varies across metric types — proportions vs medians vs ratios).

### Approach C — drop strict gating in favor of "score" (the loose path)
Compute a composite score (weighted sum of normalized metric distances from ideal) and rank configs by score, not pass/fail. Less brittle, but loses the clean go/no-go.

## Recommendation

**Approach A first**, because:
1. It's the smallest change — extends `health.ts` with a new function; no other plumbing change.
2. It addresses the immediate problem (variant (c) gets fair evaluation under MCTS).
3. It's directionally what Sam's "recalibrate, don't over-index" intent calls for.
4. We can move to Approach B later if needed; A doesn't preclude it.

The numerical thresholds proposed (medianTurns 3-30, ironVictory ≥0.15, seatWinBias ≤0.50, capHit ≤0.05, leadVolatility 0.2-0.85) are *initial guesses*, informed by the variant (c) data. They should be re-examined after the deeper-validation (wider-grid) run finishes — if other (c) cells produce different numbers, the thresholds may need a second pass.

## Implementation footprint (when greenlit)

- Add `mctsHealthThresholds()` factory in `src/sweep/health.ts`.
- Add an `maxLeadVolatility` field to `HealthThresholds` interface (default = Infinity for backwards compatibility).
- Update `isHealthy()` to check `maxLeadVolatility` (no-op when Infinity).
- `compare-variants.ts` and `explore-c-variant.ts` use `mctsHealthThresholds()` for their MCTS revalidation step. Greedy grids still use the existing `defaultHealthThresholds()` — that's the appropriate gate for greedy data.
- TDD per usual.

Estimated work: ~30 min. Not in this session's queue unless Sam greenlights now; otherwise after the alliance work.

## What this spec does NOT do

- Doesn't change `defaultConfig`.
- Doesn't change `defaultHealthThresholds()` — the existing greedy-tuned thresholds stay valid for greedy evaluation.
- Doesn't adopt variant (c) — that's a separate decision; this just makes the *measurement* of (c) coherent.

## Open questions for Sam

1. The proposed initial values (medianTurns 3-30, ironVictory ≥0.15, seatWinBias ≤0.50, capHit ≤0.05, leadVolatility 0.2-0.85) — are any of them obviously off? They're sized against variant (c)'s top-cell numbers with some headroom but no formal calibration.
2. Approach A (relaxed-thresholds for MCTS) vs Approach B (CI-aware gates) vs Approach C (score-not-gate). I recommend A; Sam may prefer B for rigor.
3. Should this implementation come BEFORE the alliance comparison sweep (so the alliance sweep uses the recalibrated gates)? My instinct: yes — it's a 30-min change that makes the alliance sweep's success criteria sharper.
