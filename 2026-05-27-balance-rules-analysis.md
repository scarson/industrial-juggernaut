# Balance Analysis — Why Industrial Juggernaut Ends Too Fast (Rules-Level)

**Date:** 2026-05-27
**Status:** Analysis for Sam's direction — a design crossroads. **UPDATE 1: the calibration run looked like "balanceable via parameters" (§0). UPDATE 2 (MCTS revalidation — §0.1) OVERTURNS that: under strong play the config collapses, so the parameter-only fix was a greedy-agent artifact and the rules-level question (P2/P3) is LIVE again, not parked. Read §0.1 first.**

## 0.1 OVERTURNED by MCTS revalidation (read this first)

The §0 "balanceable via parameters" resolution was based on **greedy/heuristic** self-play. The MCTS revalidation (`src/sweep/revalidate.ts`, all-MCTS self-play on the very same `b96/r2/iron12/vt12`) **overturns it**:

- **Under MCTS, 6/6 games ended by `last-standing` (elimination) — 0% iron victory.** 2P games end at **turn 1**; 3P games at **~turn 10**. Compare the greedy reference on the identical config: **79% iron victory, median 3 turns.**
- **Mechanism (confirmed by static analysis, `src/engine/status.ts:185`):** strong play's dominant line is to **deny the opponent's iron** — with radius-2 control disks and only 12 iron, that's easy — triggering the `noIron` elimination → last-standing win, faster and surer than racing to the iron threshold. Greedy never finds this line; it just accumulates iron. So the "healthy, iron-driven, median-3" profile is a **greedy-agent artifact**, not a property of the game.

**Conclusion:** the config is **NOT adoptable as a balanced default** — its balance does not survive competent play. "Balance" here is **agent-relative**, and the harness's health gate (tuned on greedy self-play) mis-certifies it. This is the P6 caveat (§2) realized in full.

**What this means for the project:**
- The MCTS trustworthiness gates (A5.2/A6) remain **blocked** — and now for a *deeper* reason than "no config searched": no config we've found is balanced under *strong* play.
- The rules-level options are **live again**: P3 (perimeter-gated victory-iron) is specced in `2026-05-27-perimeter-gated-iron-experiment.md`, **but** its §5 flags the crux — the `noIron` elimination must likely change too, or iron-denial still wins. P2 (change the victory *model* — hold-iron-for-N-rounds / economic VP) is the bigger alternative.
- A harness lesson: a config should be gated under the **strongest available agent**, not greedy — else the gate certifies agent myopia. (Candidate follow-up: make `revalidate` part of the standard "is this config balanced?" check, not an afterthought.)

**Sam's decision (the live crossroads):** (a) greenlight the P3 spike (with the `noIron` companion change), or (b) pursue the P2 victory-model change, or (c) reconsider whether elimination-via-iron-denial is an acceptable strategic axis (and if so, lengthen it so it isn't turn-1), or (d) accept that the game's depth lives in the human/alliance layer the sim can't model and stop tuning against agents. The reasoning in §1–§7 below feeds all four.

---

## 0. Resolution (SUPERSEDED by §0.1 — kept for the record)

> The following was the post-calibration resolution, **before** the MCTS revalidation overturned it. Preserved to show the reasoning chain; the operative conclusion is §0.1.


The focused 600-game re-run (`docs/sweeps/2026-05-27-calibration-report.md`) **found a healthy config**: `boardSize=96, radius=2, ironCount=12, victoryThreshold=12` passes all 7 health criteria (median 3, setupDecided 0, ironVictory 0.79, capHit 0.017, **seatBias 0.167**, leadVolatility 0.35). This is the *exact cell* S5 reported as a near-miss failing only `seatBias 0.233` at 150 games — at 600 games the seatBias drops to 0.167 and it passes. The per-count seatBias diagnostic shows the gate-driving value is the 3P bucket at 0.167, within its ±0.15 sampling CI — i.e. **not distinguishable from fair.** S5's "no healthy config" was a measurement artifact (too few games → seatBias noise), not a property of the game.

**What this means for this analysis:** the game **is balanceable into multi-turn depth without any rules-mechanic change** — a parameter set suffices. The decisive parameter is the **base control radius: 5 → 2** (this is exactly the "Base control radius — Revisit if starting territories feel too large or small" knob the designer flagged in §Variables to Test). A radius-2 disk covers far less of the board, so iron acquisition is no longer a one-move uncontested land-grab — which is precisely the *mechanism* P1/P3 identified, achieved here by tuning rather than redesign. The config also uses ironCount 12 (vs 14) and victoryThreshold 12 (vs 10).

**Caveats that keep P2/P3 on the shelf rather than discarded:**
- It is the **only** healthy cell of 16 in the focused grid, and a **marginal** pass: median 3 sits at the floor of the band, capHit 0.017 is just under the 0.02 cap, and the victoryThreshold is knife-edged (OFAT: vt11 → median 2 too short; vt12 → median 3 pass; vt13 → unwinnable, ironVictory 0). It is a narrow island, not a broad plateau.
- The pass is under the **greedy/heuristic agent** (the documented weak-agent caveat, P6). It must be re-validated under MCTS before adoption.
- radius 2 is a large departure from the rules-as-written radius 5 and changes the game's feel — a design judgment for Sam, even though it is "only" a parameter.

So the recommendation in §5 still stands, now with step 1 complete: **re-validate `b96/r2/iron12/vt12` under MCTS (step 2); if it holds, adopt it as `defaultConfig` (Sam-gated) and the rules redesigns are not needed; if it does not hold under strong play, P3 (perimeter-gated iron) becomes the live option.** The reasoning below is preserved as the record of why the rules redesigns were considered and why they are now parked.
**Companion docs:**
- `2026-05-18-design-critique.md` — the original design critique + "Variables to Test" this builds on.
- `docs/sweeps/2026-05-27-balance-report.md` — the S5 wide-grid sweep (64 configs, the data this reasons over).
- `docs/sweeps/2026-05-27-calibration-report.md` — the focused 600-game re-run testing the seatBias-noise hypothesis (generated by `src/sweep/calibrate.ts`).
- `industrial-juggernaut-rules-v10.md` — the canonical rules (Perimeter, Build Action, Winning).
- `docs/handoffs/2026-05-27-session-handoff.md` — "THE central open question" framing this resolves toward.

> This doc captures the reasoning behind the rules-level diagnosis so a future session (or Sam) doesn't have to re-derive it. It is paired with the empirical sweep reports, which are the source of truth for the numbers.

## 1. The problem, stated precisely

The base-placement bug fix (triangle rule applies only to the 4th+ base — see the handoff and `docs/pitfalls/implementation-pitfalls.md` GEO-series) removed *setup*-decided degeneracy: the S5 sweep shows `setupDecidedFraction ≈ 0` across nearly the whole grid. But games still **end at turn 1–2** across nearly the entire searched parameter space (S5: `medianTurns = 1` for the majority of cells).

The mechanism, in the rules:

> **Victory-iron is acquired by *placement*, not *conflict*.**

A base, while a player has fewer than 4 bases, radiates a free 5-hex-radius disk of control (`industrial-juggernaut-rules-v10.md` §Perimeter, "Radiating Bases"). On the default 96-hex oval (~6-ring) with 14 interior iron hexes, the union of 2–3 radiating disks blankets nearly all the iron. The build rate is `floor(resources / 2)` where `resources = controlled iron + controlled factories` (§Build Action), so controlling ~6 iron already buys 3 bases per round → explosive, **uncontested** radial land-grab → 10 iron (the victory threshold, §Winning) before any opponent perimeter can contest it. The game's interesting machinery — 4-base perimeters, combat, stranded bases, the factory-death clock — is gated *behind* having 4 bases and adjacent conflict, both of which arrive *after* the game is already won.

So the game is, under the current rules + simulated (alliance-free, greedy) play, a race to place 2–3 bases on the densest iron, not a strategic contest.

## 2. Six perspectives on the rules-level cause

### P1 — Geometry (board too small / radius too large)
The most-tested perspective, and the one we can rule out as a *standalone* fix. S5 swept `boardSize ∈ {96,150,220,300} × radius ∈ {2,3,4,5}`. Larger boards + smaller radius *do* lengthen games (e.g. `300/r5/iron12/vt12` → median 27.5 turns). **But** at the geometry that gives length, iron-victory becomes *unreachable*: `ironVictoryFraction` collapses toward 0, `capHitFraction` rises (games stop terminating), and games end by elimination / no-winner instead of by the actual victory condition. Geometry trades "too fast" for "never terminates by the win condition." **No sweet spot exists anywhere in the 64-cell grid.** This is a real, load-bearing finding.

### P2 — Victory-condition *value* vs. *model*
The OFAT sweep varied the threshold 8→14: every value fails (8/10 → median 2; 14 → `ironVictoryFraction` 0, i.e. unreachable). So the problem is not the threshold *number* — it is the *model*: "instantaneously control a fixed fraction (10) of a fixed scarce resource (14)." That model is brittle by construction — on any board it is either a trivial land-grab or impossible. **The sweep never tested an alternative victory *model***: hold-iron-for-N-rounds (creates defensive pressure and a multi-round arc), cumulative economic victory points over time, or a ratio of *contested* iron. This is the single largest untested lever.

### P3 — Radiating disks grant free, uncontested iron (the likely root)
The deepest issue: victory-iron counts inside a *radius*, not a *committed perimeter*. You win by grabbing unclaimed hexes that no opponent can stop (they act after you in turn order). Making victory-iron require a **4-base perimeter** rather than a radiating disk would force players through the game's actual strategic act — committing a perimeter (§Perimeter, "Setting the Perimeter") — before they can win. That structurally lengthens games and makes combat / perimeter-shaping load-bearing instead of vestigial. Highest leverage-to-blast-radius targeted change. Adversarial counter: it might just shift the race to "be first to enclose a 4-base perimeter around the densest iron" — needs a test — but it raises the floor of engagement either way.

### P4 — Economy tempo (snowball)
`resources = iron + factories`, build half each round, no upkeep or decay; the factory-death clock is a cliff, not a curve. A pure snowball. **But** S5 already found the per-round build cap **inert** for game length (radial coverage dominates build *count*). So tempo-throttling is weak *alone*; it only re-matters if iron acquisition is first made contested (P3).

### P5 — Seat bias is a *symptom* of short games, not an independent failure
A game decided in 1–2 turns *must* show high seat bias: later players never get to respond, and the 3–6P catch-up rule ("the two who played last go first next turn", §Turn Order) never gets to fire. The first calibration cell already demonstrates this — at 600 games, `b96/r2/iron12/vt11` shows `seatBias 0.15` (below the 0.20 gate), versus the ~0.23 the comparable cell showed at 150 games. **seatBias and length are coupled; fix length upstream and bias falls out.** We should not chase seatBias as its own target, and the health gate's `maxSeatBias` should be read jointly with `medianTurns`.

### P6 — (Contrarian) Is it the *agent*, not the rules?
The greedy / heuristic agent beelines for iron and likely under-uses *combat* (attacking the leader's perimeter to deny iron). Some of the "too fast" could be agent myopia rather than a rules defect. Counter: if player 1 can reach 10 iron on turn 1 by uncontested radial expansion, *no* opponent agent can prevent it (they move later) — that is a rules problem, not an agent one. But whether games that *look* 1-turn-decided actually have combat counterplay is exactly what a stronger agent would reveal. **Cheapest guard against over-correcting the rules for an agent artifact: re-check the most promising configs under MCTS before any redesign verdict.** (This is the documented weak-agent caveat from the sweep design spec.)

## 3. Adversarial review — what survives

| Perspective | Verdict |
|---|---|
| P1 Geometry | **Holds; rules out geometry-only.** Empirically settled by S5. |
| P2 Victory model | **Biggest gap.** Sweep tested values, never the model. Most promising rules direction; untested. |
| P3 Perimeter-gated iron | **Likely root; highest leverage.** Targeted, testable with the existing harness. |
| P4 Economy tempo | **Weak alone**; conditionally relevant after P3. |
| P5 Seat bias | **Reframed as a symptom.** Read jointly with length; do not optimize directly. |
| P6 Agent myopia | **Mandatory caveat.** Re-validate under MCTS first. |

### Three things I almost missed (and they matter)

1. **Alliances are a core balancing mechanic the simulation omits entirely.** The rules lean heavily on alliances ("Two players combining Iron counts can reach 10 quickly… The player who manages alliances well… often wins games that pure military players lose", §Strategy Notes; §Alliances pools iron toward the threshold). The harness has no negotiation layer — greedy agents never ally. So the game's intended mid-game social arc is **invisible to the simulation**. The "rules-level problem" may be partly "the balance harness structurally cannot model the mechanic the designer intended to carry mid-game tension." This bounds how much *any* sweep can certify about this game, and is the most important caveat on every balance conclusion here.

2. **On big boards, elimination / no-iron endings dominate — not iron-victory.** The "No Iron → eliminated" rule (§Ways to be defeated) plus spread-out iron means big-board games terminate by elimination, which is *why* `ironVictoryFraction` collapses there. It is not that iron-victory is merely slow on big boards; it is that a *different* terminal condition fires first. This couples P1 ↔ P2: scaling geometry doesn't slow the iron race, it swaps the win condition for an elimination race.

3. **The 2-player turn-order rule is a snowball *amplifier*, not a catch-up.** In 2P, each player puts battle tokens in the bag equal to their controlled iron count, and the drawn player goes first (§Turn Order, "2 Player Game"). Going first is an advantage, so the iron *leader* is more likely to go first → rich-get-richer. That reads backwards for balance and is worth flagging as a possible rules bug independent of the length problem.

## 4. What the calibration run will and won't settle

**Will settle:** whether the S5 seatBias failures were sampling noise (the first cell already says: largely yes), and whether a median-3 *healthy* config hides in the `b96/r2/vt12` neighborhood at honest (600-game) sample sizes. The per-count seatBias diagnostic in the calibration report shows *which* player count drives the aggregate (the gate metric is `max` over counts, dominated by the under-sampled 6P bucket).

**Won't settle:** anything about P2 (victory model), P3 (perimeter-gated iron), or the alliance blind spot. Those require rules changes and new tests, not more games.

## 5. Recommendation (sequence, cheapest-first)

1. **Let the calibration finish** — settles the seatBias-noise question and whether a near-miss passes all 7 criteria at 600 games.
2. **Re-validate the best 1–2 configs under MCTS** — cheap; guards against P6 (agent myopia) *before* touching any rule. This also unblocks the paused MCTS trustworthiness gates (A5.2/A6) if a config holds up.
3. **If still too-fast under strong play**, the rules change with the best leverage-to-blast-radius is **P3: gate victory-iron behind a committed perimeter rather than a radiating disk** — and it is testable with the existing harness. **P2 (change the victory *model*)** is the bigger but heavier swing; reserve it if P3 proves insufficient.
4. **Flag the alliance blind spot** as a standing limit on what the harness can ever certify for this game.

None of steps 3–4 are autonomous — they are rules-design decisions for Sam.

## 6. What I'm still uncertain about

- **How much of "too fast" is agent myopia vs. rules** — only the MCTS re-validation (step 2) resolves this. I lean rules (the turn-1 uncontested-win argument is structural), but I am not certain combat counterplay is fully absent.
- **Whether P3 (perimeter-gated iron) actually lengthens games or just relocates the race.** Plausible either way; needs a spike.
- **Whether the game is balanced *with alliances* and only broken in the alliance-free sim.** Unfalsifiable with the current harness — a genuine epistemic limit, not a TODO.

## 7. What I'd add with more time

- A spike implementing P3 (victory-iron requires perimeter) behind a `RuleConfig` flag, then re-running the calibration grid to see whether it produces a healthy median-3+ region.
- A minimal alliance model (even a crude "two trailing players pool iron when it lets them win") to probe whether the social layer is what carries mid-game tension.
- A victory-model spike for P2 (hold-iron-for-N-rounds) as the heavier alternative.
- Per-count seatBias as a first-class column in the standard report (not only the calibration supplement), since the max-over-counts aggregate is structurally noisy.
