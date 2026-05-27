# Experiment Spec — Perimeter-Gated Victory-Iron (P3)

**Date:** 2026-05-27
**Status:** SPEC for Sam to greenlight — **not implemented.** Rules-mechanic changes are Sam's call; this is the design + measurement plan so adoption is a one-word decision.
**Companion:** `2026-05-27-balance-rules-analysis.md` (P3 is the highest-leverage rules option there); `docs/sweep-harness.md` (how the measurement runs); `industrial-juggernaut-rules-v10.md` §Perimeter, §Winning.

## 1. Why
The balance harness shows the game's depth problem is **agent-relative**:
- Under the **heuristic/greedy** agent, `b96/r2/iron12/vt12` looks healthy (median 3 turns, ironVictory 0.79).
- Under **MCTS**, the same config collapses to **turn-1 last-standing** (see the revalidation run): strong play's dominant line is to **deny the opponent's iron** (radius-2 control disks + 12 scarce iron make denial easy) → the opponent hits the `noIron` elimination (`src/engine/status.ts:185`) → last-standing win. Faster and surer than racing to the iron threshold.

Root cause (analysis doc P3): **victory-iron is acquired by a radiating control *disk* (mere placement), not by a committed *perimeter*.** So iron is cheap to grab and cheap to deny, and the game is decided before its strategic machinery (4-base perimeters, combat, stranded bases) engages.

## 2. The proposed change
Add a `RuleConfig` flag, default OFF (no behavior change unless set):

```
victoryIronRequiresPerimeter: boolean   // default false
```

When **true**: a player's controlled iron counts toward the **victory threshold** only when it lies inside a **committed perimeter** (the ≥4-base polygon, per §Perimeter "Setting the Perimeter") — NOT when merely inside a radiating disk (<4 bases). Iron inside a radiating disk still counts for **resources/bootstrapping** (so early economy is unchanged); it just doesn't count toward *winning*.

Intent: force a player through the real strategic act — committing a 4-base perimeter around iron — before they can win, so games can't be decided in the radiating phase.

## 3. Hypotheses (what we expect, and how we'll know)
- **H1 — games lengthen:** median turns rises out of the 1–2 band, because nobody wins until they enclose a perimeter. Measured: `medianTurns` under both heuristic and MCTS.
- **H2 — fewer turn-1 eliminations under MCTS:** iron-denial is harder when the *attacker* also needs a perimeter to convert iron into a win; the elimination line stops dominating. Measured: `victoryType` mix + `medianTurns` in the MCTS revalidation.
- **H3 — combat/perimeter become load-bearing:** ironVictory stays meaningful (≥0.5) but is now reached *through* perimeter play. Measured: `ironVictoryFraction` + game-length distribution.

## 4. How to measure (no new harness needed)
1. Add the flag + the control/victory wiring (the only engine change). Existing `control()` already distinguishes radiating vs perimeter territory — gate the victory-iron tally on perimeter membership when the flag is set.
2. `findBalancedConfigParallel` over a grid with the flag ON (reuse `calibrate.ts`'s neighborhood, 600 games, 4 workers) → health table.
3. `revalidate.ts` on the best flag-ON config → does it hold under MCTS (the test the flag-OFF config FAILS)?
4. Compare flag-OFF vs flag-ON head-to-head on the same grid.

## 5. Adversarial review
- **"It just moves the race to *who encloses a perimeter around iron first*."** Plausible. But that race requires ≥4 bases + visibility triangles + not-overlapping opponents — several turns of real positioning, vs. the current 1-turn disk grab. Even if still a race, it's a *longer, contestable* one. The sweep will show whether median rises.
- **"`noIron` elimination still fires, so MCTS still wins by iron-denial."** Key subtlety: with the flag, denying an opponent's iron still eliminates them (noIron is unchanged) — so this might NOT fix the turn-1 collapse. **Mitigation/decision point:** the flag may need to pair with a change to `noIron` (e.g., a player isn't eliminated for lack of iron until they've had a chance to establish a perimeter, or noIron only applies post-perimeter). This is the riskiest open question and must be part of the spike, not assumed away.
- **"Radiating-iron-for-resources but not-for-victory is a confusing rule."** True — it splits iron's two roles. Alternative simpler variant: iron counts for *nothing* (resources or victory) until perimeter-enclosed. Cleaner rule, bigger economic impact; worth A/B-ing.
- **"Greedy won't exercise it well."** The flag-ON config must be re-validated under **MCTS**, not just greedy (greedy already mis-measures the flag-OFF config). The revalidation harness covers this.

## 6. What this spec deliberately does NOT do
- Does not change `defaultConfig`.
- Does not implement the flag (Sam greenlights first).
- Does not touch `noIron` — but flags it (§5) as the likely-necessary companion change to actually fix the collapse.

## 7. Recommendation
If the revalidation confirms the flag-OFF config collapses under MCTS (it does, per the run), P3 is the leading rules direction — but **the noIron interaction (§5) is the crux**: perimeter-gating victory-iron alone may not stop iron-denial elimination. Greenlight a *spike* (flag + the noIron companion question) over adopting P3 sight-unseen. The bigger alternative (change the victory *model* entirely — hold-iron-for-N-rounds / economic VP, analysis-doc P2) remains on the table if P3's spike disappoints.
