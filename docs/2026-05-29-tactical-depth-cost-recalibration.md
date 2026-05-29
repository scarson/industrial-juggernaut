# Tactical Depth Cost Recalibration — Phase 7 Pre-Work

> Track D found the current cost calibration unbalanced. Outposts are too cheap. This doc captures the finding and proposes recalibration directions for Sam to weigh.

## The finding

Track D (`docs/2026-05-29-tactical-depth-effect.md`) ran heuristic self-play on variant (c) with `baseTypesEnabled` on vs off across 2P/3P/4P, 100 games per cell. Result:

| Cell | Median turns (flag=false) | Median turns (flag=true) |
|---|:---:|:---:|
| 2P | 2 | **1** |
| 3P | 2 | **1** |
| 4P | 2 | **1** |

**With subtypes enabled, the heuristic finishes games one turn FASTER.** The hypothesis (subtypes add strategic depth) is currently FALSIFIED — instead, they accelerate games.

## Why this is happening

Current cost calibration (from the original plan):
- forge: 2 resources/piece
- watchtower: 4 resources/piece
- outpost: 1 resource/piece

With outpost cost = 1, a player with 8 resources can build EIGHT outposts in one turn (vs four forges with the vanilla rule). Eight pieces:
- Allows the player to reach the iron threshold in turn 1 by capturing 10+ iron via a wider spread of small-radius outposts.
- Bypasses the 4-base perimeter rule entirely (perimeter activates at 4 bases, but with 8 outposts you HAVE a perimeter at turn 1).

The original plan's choice of outpost=1 was probably aimed at "cheap and easy spreading." But the 1 cost is TOO cheap for the (c) regime — turning what should be a strategic choice ("more pieces in exchange for less coverage each") into a dominant build.

## Recalibration proposals

### Option 1: Make outposts cost 2 (same as forge)

- Math: outpost cost = forge cost = 2. The differentiation is purely radius-vs-coverage.
- Predicted effect: outposts become a NICHE choice for spreading in flat terrain. The heuristic should prefer forges in most cases due to larger control radius.
- Test: re-run Track D with outpost=2.

### Option 2: Make outposts cost 1 but require a forge base nearby

- Math: outpost cost = 1, but legal only within `outpost_anchor_range` of a forge base.
- Predicted effect: outpost spam becomes situational — you need an established forge first.
- Implementation: gate `isLegalBasePlacement` for outposts.

### Option 3: Outpost has a base-limit constraint

- Math: outpost cost = 1, but each player can have at most N outposts on the board at once.
- Predicted effect: outposts become a tactical sub-resource, not the dominant build.
- Implementation: new player field `outpostsOnBoard`, gated in legal.

### Option 4: Watchtower gets a stronger benefit to balance

- Math: keep outpost = 1, but make watchtower's defense bonus +2 instead of +1, or its radius +3 instead of +2.
- Predicted effect: doesn't fix the outpost-spam issue, just makes watchtower more attractive in proximity.
- This is the WEAKEST option — doesn't address the root cause.

### Recommendation

**Option 1 (outpost cost = 2) is the cheapest fix.** It makes subtypes a pure-strategy choice (radius vs coverage) rather than a resource arbitrage. If after that, gameplay is still mechanical/uninteresting, the asymmetric-types concept needs deeper redesign.

If you want true strategic depth, **Option 2 (require forge anchor)** layers a positional constraint: "outposts are how you EXTEND, not how you spread initially." That creates a temporal decision: forge first, then outposts.

## Implementation cost

| Option | Engineering cost | Test cost |
|---|---|---|
| 1 (cost=2) | 1 line in `src/engine/build.ts` | re-run Track D (~12 min) |
| 2 (forge anchor) | ~30 lines: gate in `isLegalBasePlacement` + Tests | re-run Track D + new placement tests |
| 3 (base limit) | ~50 lines: new Player field + Player wireup + tests | re-run Track D + new limit tests |
| 4 (watchtower buff) | 1-2 lines in `src/engine/combat.ts` or `src/engine/control.ts` | re-run Track D — won't fix |

## What Phase 7 should test

Once a recalibration option is chosen:
1. **Effect test:** does median turns now SHIFT in the expected direction (longer games with subtypes)?
2. **Strategic depth test:** does lookahead2-multi beat heuristic by MORE under subtypes-on than under subtypes-off? (Track V partial answer.)
3. **Balance test:** do subtypes get used roughly equally over many games, or does the heuristic strongly favor one?
4. **Falsification test:** at higher player counts (5P/6P), does the pattern hold?

These are the "4-test falsification battery" the original plan referenced.

---

*Generated 2026-05-29 immediately after Track D landed. Sam's call on which option to pursue.*
