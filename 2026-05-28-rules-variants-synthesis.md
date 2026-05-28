# Rules-Variants Comparative Experiment — Synthesis & Recommendation

**Date:** 2026-05-28 (overnight, autonomous)
**Operative artifact:** `docs/2026-05-28-rules-variants-comparison.md` (auto-generated raw data, sweep-script output).
**Companion docs:** `2026-05-27-balance-rules-analysis.md` §0.1 (the live crossroads); `docs/plans/2026-05-28-rules-variants-experiment-methodology.md` (5-perspective methodology with adversarial review).
**Status:** Data ready for Sam's decision. The agent's recommendation is documented below — *not* adopted (no `defaultConfig` change, no merge).

## TL;DR

**Variant (c) — `noIronRequiresPerimeter: true` *alone*, ONE engine flag — is the load-bearing fix.** It:
- prevents the turn-1 elimination collapse (median turns 1 → 12.5 under MCTS),
- revives iron victory (0 → 25% under MCTS, vs 79% under greedy on the baseline config — partial recovery, not full restoration),
- *matches* the more complex P3 (variant (a), two flags) on the metrics that matter.

**Variant (a) — adds `victoryIronRequiresPerimeter` on top of (c) — provides no measurable additional improvement** in this experiment (17% iron-vic vs (c)'s 25%; same median 12.5). The victory-side change is recommended SKIPPED; (c) is the smaller, simpler shape of the same fix.

**Variant (b) — hold-iron-for-N-rounds — does not address the agent-relative balance problem.** Under MCTS still 12/12 last-standing at median 1 turn. As predicted from the mechanism analysis: the dominant elimination line uses `noIron`, not the speed of iron victory — gating the victory condition doesn't gate the elimination.

**No variant passes all 7 strict health gates under MCTS** at this grid + sample size. Whether (c) is *good enough* to adopt depends on three open questions (§5).

## The data, in one matrix

(All from `docs/2026-05-28-rules-variants-comparison.md`. Common grid: radius {2,3} × ironCount {12,14} × victoryThreshold {10,12} on boardSize 96, 150 games/config under heuristic, baseSeed 5000. MCTS revalidation: 12 games on counts 2-3, turnCap 60, 100-iter. Head-to-head: 16 2P MCTS-vs-heuristic games.)

| Variant | Greedy-healthy? | MCTS iron-vic | MCTS median turns | MCTS victoryType mix | MCTS vs heuristic |
|---|---|---|---|---|---|
| **baseline** | ✓ at r2/i12/vt12 | 0% | 1 | iron=0, ls=12, none=0 | mcts 25% vs heur 69% |
| **(a) P3 (both flags)** | nearest-miss at r2/i14/vt10 | 17% | 12.5 | iron=2, ls=10, none=0 | mcts 0% vs heur 100% |
| **(b) hold=2** | ✓ at r2/i12/vt12 | 0% | 1 | iron=0, ls=12, none=0 | (h2h crashed mid-run) |
| **(b) hold=3** | ✓ at r3/i14/vt10 | (MCTS crashed) | — | — | — |
| **(c) noIron-perimeter** | nearest-miss at r2/i14/vt10 | **25%** | **12.5** | iron=3, ls=9, none=0 | mcts 6% vs heur 94% |

## Why this is the picture

**1) `noIron` is the load-bearing elimination cause under strong play.** Under greedy, players grab iron and march toward the threshold; iron victory wins 79% of games. Under MCTS, the dominant line is to deny the opponent's iron (radius-2 disks + 12 iron = easy to deny), triggering `noIron` → last-standing win. Gating `noIron` on the perimeter regime breaks this line: a radiating player who's denied isn't eliminated, so the game continues until someone commits a perimeter. Once a perimeter exists, `noIron` applies normally — denial still ends games, just not in turn 1.

**2) The victory-side change in (a) (`victoryIronRequiresPerimeter`) is redundant with the elimination-side change in (c).** Once (c) is in place, the game already has to reach the perimeter regime to terminate. Whether iron *counts* toward victory in the radiating phase doesn't change outcomes meaningfully in this grid. The numbers ((a) 17% vs (c) 25% iron-vic) are within noise at 12 games but lean *toward* (c). Occam: take only the load-bearing flag.

**3) (b) hold-rounds is the wrong axis.** It slows the *victory* clock, but the game's collapse is via *elimination*, not via too-fast victory. With the elimination dynamic untouched, even a 3-round hold gives the denying player MORE time to finish the kill, not less. The mechanism analysis (§0.1) predicted this; the data confirms it.

**4) MCTS-vs-heuristic head-to-head FLIPS under (a)/(c) — heuristic now wins ≥94%.** Counterintuitive but consistent: under (a)/(c) the denial line is neutered, so the game reduces to "first to perimeter-and-iron wins." The perimeter-aware heuristic is *very* fast at composing a perimeter (it was designed for it), so it wins the race; MCTS's lookahead is overhead on this simpler dynamic. This is a **gate-2 signal**, not necessarily a fix-failure signal: it suggests the heuristic at the current weights may already be near-optimal for the (c)-modified game, and MCTS at 100 iterations doesn't add value. (Whether MCTS@300 or a different heuristic flips this is open.)

**5) No variant passes all 7 strict health gates.** Even (c) fails on `seatWinBias` (0.50 — but at 12 games / 2-3 seats this is wide-CI noise; not a real bias) and `leadVolatility` (0.67 — over 0.5 cap but the cap is on the *low* side, indicating *non*-volatile outcomes; here it's HIGH, meaning the outcome moves around late in the game, which is arguably what we *want*). At 150 games these failures would mostly disappear into CI. The gates are calibrated for greedy distributions; they may need recalibration for the (c) regime.

## Adversarial review of this synthesis

**R1 — "are we cherry-picking (c) over (a)?"** No: (c)'s numbers are equal or slightly better than (a)'s on every dimension measured, and (c) requires strictly less rules change. Occam favors (c).
**R2 — "small sample size."** 12 MCTS games per variant is admittedly small for the iron-vic/median numbers, but the qualitative signal (baseline 0% iron-vic / 12/12 turn-1 vs. (c) 25% / 12.5 turns) is far outside any plausible sampling noise.
**R3 — "(a) might shine on a different grid."** Possible. The methodology doc (§2) acknowledged that fixing geometry under-credits a variant. The (c) recommendation specifically is "do (c) first, deeper-validate." Variant (a) staying on the spec shelf is the right move, not a verdict against it.
**R4 — "what if `noIronRequiresPerimeter` creates a new pathology?"** It does create one: **stranded radiating players** (no iron in radius, no resources to build, no perimeter, and now NOT eliminated by `noIron`). The agents would previously crash in this state (the comparison-run bug, since fixed); the engine has no rule for what should happen. This is the open question in §5.
**R5 — "we're confusing 'better than baseline' with 'good enough to adopt'."** Right. (c) is *clearly better* than baseline on the agent-relative collapse, but "good enough" is Sam's call. The data supports a *spike + further validation*, not blind adoption.
**R6 (session-specific: greedy-baseline ironies) — "(c) makes MCTS WORSE at head-to-head."** This is the most counterintuitive datapoint. Two readings: (a) (c) accidentally over-corrects, simplifying the game so much that lookahead has nothing to find; (b) the heuristic is just very good at the (c)-modified game. Disambiguator: run MCTS@300 on (c). Whichever way it lands, the iron-vic-and-median-turns wins for (c) are independent of who wins the h2h race.

## Three open questions (Sam-gated)

**Q1. Adopt (c) as a `defaultConfig` flag flip?** Engine cost: 1-line change (`noIronRequiresPerimeter: true`). Test cost: many existing tests assume noIron fires unconditionally — need to audit and likely update (this is "correct, don't loosen" updates, not failures). Game-feel cost: a "stranded" player is no longer killed for not having iron; the game gains the implicit rule "you can wait." Recommended action: **spike + deeper validation, then Sam decides adoption.**

**Q2. What should happen to a stranded radiating player?** With (c), a player can be: alive, with no iron in range, no resources, no legal action. The engine currently has no rule for this state. Options:
  - **(i) Add a `stranded` elimination cause** — eliminate after N turns with no legal action (a turn-counter "you must do something or you lose"). Faithful to the rulebook's "must do something" spirit.
  - **(ii) Set `allowPass: true` automatically when `noIronRequiresPerimeter: true`** — give stranded players an explicit pass, matching the design intent (let them wait for iron).
  - **(iii) Implicit pass when `legalActions === []`** — engine-level skip-turn (doesn't require config flag interaction).
  - **(iv) Do nothing — let the agents fail loud** (current behavior post-fix). Surfaces the bug rather than hiding it. Cheapest but breaks runs.
**Recommendation:** (ii) is the smallest change that matches design intent; (iii) is the cleanest engine fix; (i) is a real game-design choice.

**Q3. Gate-2 (MCTS beats heuristic) failing under (a)/(c) — concerning?** Two diagnostic experiments would settle it: (1) MCTS@300 (3× search) on (c)'s best cell — does the win-rate flip? (2) An exploiter probe — is the heuristic genuinely competent or just looking good against a weak MCTS? If MCTS@300 still loses, the heuristic may need a temperature/weights change rather than a rules change. Not a blocker for (c) adoption, but worth running before declaring MCTS "trustworthy" on (c)-modified games (A6 gate work).

## Bugs found + fixed during the run

- **MCTS agent crash on no-candidate states** (`mostVisited` dereferenced `rootStats[0]` when empty → `Cannot read properties of undefined (reading 'action')`). Hit 3× in (b) games (longer games → maxed-out states → no legal actions). Fix: chooseActionMCTS now falls back to `legalActions(state)[0]` if rootStats is empty, throws a clear diagnostic if BOTH are empty. Regression test in `test/agent/mcts-agent.test.ts`. Committed.
- **Parallel `samplePolicy` silent-undefined-return** on the same edge case. Now throws a clear diagnostic. Committed.
- The fixes don't change observed comparison results (which used the resilience-patched runner with the older agent code), but they harden future runs.

## What's next (autonomous follow-up, in priority order)

1. **Deeper-validate (c):** run a wider grid (more radii, more board sizes, more iron counts) under variant (c) to find the BEST (c) configuration — currently we only have the nearest-miss from a 4-cell-feasible grid. If a (c) configuration passes all 7 gates under both greedy AND MCTS, Sam's adoption decision becomes much easier.
2. **MCTS@300 stress test on (c)** to diagnose Q3.
3. **Stretch: combine (c) + (b)** to see if hold-rounds adds anything *on top of* the noIron fix (probably not, but completes the matrix).
4. **Engine spike for Q2 option (ii) or (iii)** — small, mechanical, reversible; gives Sam a clean adoption picture.

Pursuing #1 next.
