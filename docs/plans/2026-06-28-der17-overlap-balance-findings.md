# DER #17 — Overlapping-iron balance investigation (findings)

**Question (from the 2026-06-13 fidelity audit, UNCERTAIN #4 / spec DER #17):** `control()` lets a radiating player's 5-hex disk and a perimetered player's hull both count the same iron hex. The rules (`industrial-juggernaut-rules-v10.md` ~line 76) say a perimeter makes its interior iron "no longer available to adjacent players that are still radiating." Code is the source of truth, so this is not automatically a bug — **does the double-count materially distort balance?**

**Verdict: YES — it is a real, material, exploitable bug, but its manifestation is agent- and regime-dependent.** A fix is warranted; it is a significant `control()`-semantics change with broad ripple, so it needs Sam's go-ahead + a dedicated plan, not a quick patch. Reproduction script: `scripts/der17-measure.ts` (`bun scripts/der17-measure.ts [N] [--heuristic]`).

## Method

`scripts/der17-measure.ts` plays the acceptance suite's realistic games (archetypes aggressive/economic/expansionist cycled, 2–6 players, board 96 / iron 14, threshold 10, turnCap 300), mirroring `src/driver/run.ts`'s loop exactly. It measures, per game:

- **Overlap prevalence** — at every turn boundary, how many iron hexes are controlled by ≥2 non-ally players (standard `control()`).
- **The exact DER #17 condition** — iron a *radiating* player controls that sits inside a non-ally *perimetered* opponent's valid hull (the iron the rule would subtract).
- **Victory counterfactual** — at each iron victory, the winner's "exclusive" iron = controlled iron MINUS any iron inside a non-ally opponent's perimeter (a perimetered winner keeps all its hull iron). An **overlap-assisted win** is one where the winner's exclusive iron < 10 (i.e. the win used double-counted iron).

**Detector self-test (PASSES):** a hand-built fixture where a radiating p0 reaches an iron hex inside a perimetered p1's hull → the detector fires (`derSubtractable=1`, p0 std=1 excl=0). So the always-0 greedy results are trustworthy, not a measurement bug.

"Exclusive" interpretation matches the rule: only the radiating↔perimeter boundary is corrected (radiating loses iron inside an opponent's perimeter). Radiating-vs-radiating "overlapping radii" is left shared — both the rules and the code intend that.

## Results

| Metric | Greedy (1000 games) | Heuristic (500 games) |
|---|---|---|
| Overlap prevalence (≥2 players share an iron hex) | 73.6% of boundaries, avg 8.3 hexes | (similar — mostly radiating↔radiating) |
| **Exact DER bug fires** (radiating iron inside opp perimeter) | **0% of boundaries, 0 instances ever** | 1.89% of boundaries, up to 9 instances/state |
| Played-out iron wins | 758 (avg winner std=excl=**14.00**) | 363 |
| **Overlap-assisted wins** (winner exclusive < 10) | **0 (0.00%)** | **41 (11.29%)** |
| …winner itself radiating (the exploit) | 0 | **all 41** |
| …a different player already had ≥10 exclusive (clear flip) | — | 0 |
| …**false victory, game would continue** (rightful leaders at 8–9 excl) | — | **41** |

Note: ~14–24% of all iron "wins" are **born-terminal** (a single base's radius-5 disk already covers ≥10 iron at setup) — a separate fast-resolution artifact, not DER-relevant (no perimeters exist at setup), excluded from the played-out rates above.

### The mechanism (verified end-to-end, seeds 49/74/119)

`seed=49, n=6, turn 1`: winner = player 0, **3 bases, radiating**, controls **all 14 board iron** via disks — **0 of it exclusively** (all 14 sit inside the perimeters of players 1/2/3, who are perimetered with 4–5 bases). Player 0 wins the iron victory on iron that, per the rules, belongs to the perimetered opponents.

The exploit: **stay radiating (few bases, big radius-5 disks), blanket the board's iron, and claim a turn-1 iron victory on iron inside opponents' perimeters.** This is exactly the strategy the rules' "no longer available to adjacent radiating players" clause was written to prevent. Under exclusive counting all 41 of these are *false* victories — the game would continue, and a perimetered player (the rightful leader, sitting at 8–9 exclusive iron) would win a few turns later.

### Two important caveats (honesty about scope)

1. **Agent-dependent.** Greedy is completely immune (0%) — its scoring drives players to perimeter (claim iron exclusively in a hull), so greedy winners' iron is genuinely theirs. The heuristic (the diverse `samplePolicy` agent) finds the radiate-and-blanket path. So whether the bug bites depends on play style.
2. **Regime is fast.** These self-play games resolve in ~1 turn (`maxTurns:1` in the acceptance suite — the radius-5 disk is very powerful relative to 14 iron / threshold 10). The exploit manifests in turn-1 resolutions. Real **human** play (longer, deliberate) — the frequency is uncertain, but the exploit is genuine and a human can deliberately reproduce it. The turn-1 degeneracy is itself a separate, larger dynamics issue (the disk/iron/threshold tuning), and the DER bug is entangled with it.

## Is a fix warranted? Yes.

The double-count rewards a strategy the rules explicitly forbid and lets it claim premature false victories, demonstrably (heuristic 11.3%). The spec has the client treat the engine as **authoritative for human play**, so a deliberate human exploit that contradicts the design intent should be closed. This is the case where the code/rules-doc divergence IS a bug (not just stale-doc) — fixing aligns the engine with validated design intent.

## Fix design (preserving GEO-5 purity)

**GEO-5 is NOT violated by any option.** GEO-5 forbids *caching* control/perimeter (recompute at point of use). All options below recompute everything per call; they just read more of `state`. `control(state, p)` already takes the full `state` — making it read other players' bases keeps it a pure, deterministic, uncached function of `(state, p)`.

**Option A — fix `control()` itself (most faithful; recommended-with-caveats).** For a *radiating* player, exclude any iron hex inside a non-ally player's valid perimeter (the perimetered player keeps it). One change in `src/engine/control.ts`. Faithful: the iron isn't the radiating player's for *anything* (victory, build budget, agent scoring all use `control()`).
- **Ripple:** `control()` feeds `status` (victory), `resourceCount`→`buildBudget`, the agents (`score.ts`/`heuristic.ts`), and `run.ts`'s snapshot. All change → real balance shift (the point). **Existing agent/acceptance tests that encode current behavior will likely break** (same pattern as the Phase-3 bootstrap fix that broke two agent tests), and the **balance-sweep / tuned constants** (factory clock = 8, etc.) may need re-validation.
- **Perf:** `control()` is hot; computing non-ally hulls per call adds O(players × convexHull(≤12)) cost. Probably fine, measure it.

**Option B — fix only victory counting (`coalitionIron` in `status.ts`).** Subtract a radiating member's perimeter-interior iron in the victory check only. Smaller ripple, fewer broken tests; closes the false-victory exploit. **But** `control()` is unchanged, so the radiating blanketer still gets the inflated build budget and the agents still value the iron — the strategy stays economically rewarded, only the win line is corrected. Inconsistent (iron is "theirs" for economy but not victory). A half-measure.

**Option C — defer.** Document as a known divergence (DER #17 already does) and fold the fix into a broader balance pass that also addresses the turn-1 fast-resolution (both stem from the radius-5 disk being over-powered). Lowest risk now; leaves the exploit open for the digital edition in the interim.

## Recommendation

**Option A, executed as a deliberate, planned change with re-validation** — it's the only faithful fix and it closes a real human exploit before the engine becomes the authority for human play. But because it ripples into victory + economy + agent behavior + the tuned balance constants, it should be its own plan (write → review → execute → re-run the balance sweep + update the agent tests that encode the current behavior), not a hot patch. If the turn-1 fast-resolution is about to be retuned anyway, bundling A into that pass (Option C's timing) is reasonable.

**This is Sam's decision** (a balance/design + significant-change call). I have NOT touched the engine. Next step: Sam picks fix-now-A / victory-only-B / defer-C, and I plan accordingly.
