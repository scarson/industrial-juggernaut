# Long-Game Engagement and the Randomness Question — Thought Exercise

**Date:** 2026-05-28 (overnight)
**Triggered by:** Sam asking about the 12-turn games variant (c) produces — too long wall-clock? Engaging late game? Do we need additional sources of randomness?
**Companion artifacts:** `2026-05-28-rules-variants-synthesis.md` (where variant (c) was recommended); the play-time estimate I gave Sam earlier in the session (~10-15 min/player for a median-3-turn game).
**Status:** Thought exercise / Sam-facing reasoning artifact. No engine or rules changes. Surfaces the right *questions* and what the experimental data we have can (and cannot) answer.

## TL;DR

- **12 turns is plausibly too long** with the current per-turn structure: 90 min – 3 hours wall-clock depending on player count and whether late-game decisions are forced.
- **Whether late-game is forced or expanding is the load-bearing unknown** — and it's actually measurable from the engine (count `legalActions(state).length` over the course of a played-out variant-(c) game). I'll measure it.
- **The engagement question is partly answered by the sim and partly NOT** — the alliance/negotiation layer (3P+) the sim doesn't model is probably what would make a 12-turn game engaging or tedious; the 2P case is the most-at-risk.
- **Sam's randomness intuition is sharp:** under strong play, deterministic games with a narrow action space (build/attack/pass) tend to converge on a single dominant strategy. Variant (c) didn't eliminate this — it just changed *which* strategy dominates and made it take longer. Adding **structural** variability (something that disrupts the iron-denial-arc dominant strategy) is a more durable fix than tuning the elimination/victory flags. But the design space for randomness is itself a minefield (decision-meaningfulness vs. variance), and not all randomness types are equally good.
- **The deepest finding from the thought exercise:** parameter tuning may be the wrong axis to fix this. The action space (build / attack / pass) is fundamentally narrow, and broadening it (new actions, new mid-game state changes, hidden information) is plausibly more productive than further perimeter/iron tweaks.

## What we know from the data

From the variant-(c) comparison and revalidation runs:
- Under MCTS, variant (c) games end at **t=8–32** (most clustering ~10–17). Median 12.5 turns.
- Most still end by `last-standing` (9/12 in revalidation), some by `iron` (3/12). So even with (c), the dominant winning line under strong play is **slow denial warfare**, not the iron race.
- Greedy games on (c)-cells end at t=2 (the heuristic is fast at composing a perimeter that controls iron). So **player skill determines game length** under (c) much more than under baseline (where MCTS gives 1-turn games and greedy gives 3-turn games — a smaller, opposite gap).

## Sam's questions, refactored

1. **Is 12 turns too long for human play?** (wall-clock pragmatics)
2. **Is the late-game engaging or tedious?** (game-feel)
3. **Do we need additional sources of variability/randomness?** (strategic-determinism critique)

## Multi-perspective brainstorm (10 lenses)

### 1. Wall-clock pragmatics (length math)
- Earlier estimate: ~2.5 min/player-round → median 3-turn game = 30–80 min total (2–6P).
- 12 turns at the same per-round time = 1.5–5 hours (2–6P). **Too long for most audiences.**
- **BUT** per-turn time isn't constant. Late turns might be faster (forced moves) or slower (combinatorial growth in attack options). The 12-turn box estimate is sensitive to this.
- If late turns are *faster*: 12-turn game might land ~60–120 min for 2–3P. Acceptable.
- If late turns are *slower*: 12-turn game lands 3+ hours. Probably untenable for typical board-game audiences.

### 2. Forced vs. expanding decisions (the key unknown)
- Early game: many legal placements (radius-N disk × on-board hexes minus iron/triangle constraints). Decision-rich.
- Mid game: perimeter commitment narrows where you can build, but combat (attack) UNLOCKS when you have 3+ bases. Combat actions are combinatorial (any 3-base group × any visible enemy × triangle decision).
- Late game: 12-base cap reached for some players → no more base placements. But more factories visible → more attack targets. Information state expands (more sight lines).
- **Net direction is empirically unknown.** Could be measured: count `legalActions(state).length` per round over a played-out variant-(c) game. **I'll do this as a small instrumentation experiment.**

### 3. Game-feel of denial warfare (the engagement-curve concern)
- IJ's mechanical action space is *fundamentally* narrow: `build / attack / pass`. No tech trees, no event cards, no terrain effects.
- 12 turns of "deny iron, defend perimeter, repeat" risks feeling **repetitive** — same actions, similar decisions, just more pieces. Compare to games where time → new mechanics unlocking (civilization, card games).
- The dramatic structure of a 3-turn iron-race game ("can I get to threshold before opponent denies me?") is replaced with a slower siege — which can be engaging (war games like *Twilight Imperium* succeed despite 8-hour playtime) but requires *something* to keep mid/late turns from feeling like-turns-3-4 again.

### 4. The unmodeled alliance layer (multiplayer 3P+)
- The sim plays without alliances. Real-game 3P+ play has alliance formation, betrayal, coalition pivots — explicitly a designed mid-game mechanic.
- A 12-turn 4-player game with active diplomacy is structurally *closer to* a civilization game than to a 12-round wargame. The negotiation arc IS the engagement — combat is the medium, not the message.
- **The 2P case is the most at risk** — no alliance dynamics, just a duel. 12 turns of 2P denial warfare with no new mechanics is the hardest scenario to keep engaging.

### 5. Strategic-determinism critique (why Sam asked about randomness)
- Under strong play, narrow-action-space deterministic games converge on a *dominant strategy*. The whole agent-relative balance problem was an instance of this: MCTS found "deny iron → noIron win" as the dominant line.
- Variant (c) eliminates that specific dominant line and substitutes another (slow denial warfare). It changed *which* strategy dominates, not the fact that one strategy dominates.
- Adding *system* randomness (more variance in outcomes) makes any single dominant strategy *probabilistic*, not certain, which preserves replay value and forces adaptation.
- Adding *event* randomness (cards, random objectives) introduces new decision branches per game, broadening the strategy space without changing the action space.
- **Risk:** too much randomness = decisions don't matter; sweet spot needs careful design.

### 6. Which sources of randomness might work
- **Variable starting iron geometry** (already partially randomized via iron-CSP seed). Could vary more — different iron *amounts* per game, hidden iron revealed over time.
- **Periodic events** — e.g., "Round 5: a new iron deposit appears at hex X." Disrupts deterministic optimal play but designed to be predictable in distribution.
- **Random objectives** — secret victory conditions (a la *Twilight Imperium*'s objectives). Each player has their own victory path; you can't deny what you don't know is needed.
- **Variable initiative more aggressively** — currently turn order shuffles each turn; could add larger penalties/bonuses for going first/last.
- **Combat noise expansion** — the Bernoulli table is `{3: 0.75, 4: 5/6, 5: 8/9, 6: 1}`. The 6-attack guaranteed win removes randomness from the top of the curve. A `6: 0.95` or `0.97` would mean even a max attack can fail — making big commitments meaningful.
- **Bag-of-tokens for resource yield** (Pollux bag mechanic extended). Currently the bag is just turn order; could expand to govern resource production.

### 7. Which sources of randomness probably DON'T work
- **Random per-action outcomes** (build fails with probability P) — frustrating, undermines spatial planning.
- **Full event-card decks** — diluteive of strategic identity; works in *Twilight Imperium* because the game is already 8 hours, doesn't work in a tight 90-minute game.
- **Random elimination triggers** — undermines the strategic structure that elimination has weight.

### 8. The civilization-game analogy
- Long games (3+ hours) succeed when they have a **narrative arc**: starting position → mid-game expansion → late-game endgame conditions. Each phase feels qualitatively different.
- IJ's current rules give: setup → perimeter → contact → endgame. But the *mechanics* don't change between phases — only positions do. Compare to civilization games where new mechanics (research, religion, late-game wonders) unlock.
- A 12-turn IJ game would have ~4x the duration of the "natural" 3-turn arc *without 4x the qualitative variety*. That's the engagement risk.

### 9. Wargame analogy (the "siege" model)
- Some long-form wargames (e.g., *Combat Commander*, *Sekigahara*) ARE 12+ turns and engaging because every turn presents fresh tactical situations (terrain, line of sight, supply).
- IJ's hex board with iron deposits is similar in spirit — but combat is fast (Bernoulli, no maneuver layer), so tactical depth per turn is shallow.
- A long IJ game would feel less like a wargame (tactical) and more like a long *Acquire* (positional). Positional games tolerate length but require careful pacing.

### 10. The deepest question — is parameter tuning the wrong axis?
- We started tuning flags (perimeter-gate iron, hold-rounds, noIron-perimeter) to fix the agent-relative collapse.
- The data suggests these tweaks *delay* the problem (turn-1 → turn-12) but don't fundamentally solve it (one dominant strategy under strong play).
- **The narrow action space is the structural issue.** Broadening it — adding hidden information, time-varying state, asymmetric objectives — addresses the root cause that tuning can't reach.
- This is a much bigger design move than (c). Worth flagging even if Sam ultimately rejects it.

## Adversarial review (3 rounds)

**Round 1 — what's wrong-premised or wasteful?**
- "12 turns is too long" assumes per-round time is constant. The forced-vs-expanding question (perspective #2) is the disambiguator. I should measure, not assume.
- "Late game is tedious" is asserted from board-game-design intuition but not from playtest data. Could be wrong — a slow siege might be exactly what 3P+ alliance dynamics need to breathe.
- "We need more randomness" risks over-correcting: more randomness on top of an already-balanced (c)-mod could ruin the spatial planning depth that *is* working.
- "Parameter tuning is the wrong axis" (#10) is the kind of speculative leap I should be careful about. Without evidence that broader-axis changes work, it's just an opinion.

**Round 2 — what's missing from the brainstorm?**
- **The "abort" option**: in some games, a player can concede when their position is hopeless. With 12-turn denial games, the loser may know they've lost by turn 6 and want to stop. IJ has no concession mechanic; adding one shortens games meaningfully and respects player time.
- **Solo-play / fewer-players time scaling**: 2P 12-turn might be 90 min; 6P 12-turn might be 4 hours. The wall-clock problem is much WORSE at higher player counts. Variant (c) was tested only at 2-3P; 4-6P MCTS data doesn't exist.
- **Per-turn time as a function of board size**: bigger boards = more legal actions = slower decisions. The wider-grid run currently in flight will tell us if larger boards work under (c) — and if they do, time-per-turn becomes worse on top of more turns.
- **The setup time** is not free. A 90-min game with 30 min of setup is still a 2-hr commitment.

**Round 3 — what would falsify or strengthen the conclusions?**
- **Falsify "12 turns is too long":** measure `legalActions.length` per turn in variant-(c) games — if it shrinks past turn 5 (forced moves), per-turn time drops and 12 turns becomes ~60-90 min. (I can do this — see Action item.)
- **Strengthen "alliance layer is the engagement engine":** can't measure; needs playtest data with humans. The 2P-vs-3P+ split in the existing data is suggestive (2P games are starker, 3P bring in coalition dynamics even with solo MCTS), but real validation needs people.
- **Falsify "we need more randomness":** if a slightly tweaked variant (c) (e.g., a tighter `noIron` grace, or combined with another knob) produces a healthy game without adding randomness, the determinism critique is moot. This is more parameter exploration.
- **Strengthen "narrow action space is the root cause":** demonstrate that even with extensive parameter tuning across many variant combinations, no flag combination passes all gates AND has multi-strategy play. We don't have this yet; would require a large sweep.

## Answers, to the extent I can give them

**Q1 — Is 12 turns too long for human play?**
- *Conditional answer:* probably yes for 2P without a forced-moves dynamic; probably tolerable for 3-4P with alliances; probably too long for 5-6P regardless. The forced-moves question (measurable) is the swing factor.
- *Action:* I'll measure per-turn `legalActions.length` in a representative variant-(c) game to disambiguate.

**Q2 — Engaging late game?**
- *Honest answer:* The sim can't measure engagement. The structural risks are real (static action space, repetitive denial dynamic), and the structural mitigations are real (alliance layer in 3P+, possible forced-moves narrowing). The 2P case is most at risk; multiplayer probably tolerates more.
- *Action:* This is partly a playtest question that the sim can't settle. Note as a key uncertainty for Sam.

**Q3 — Do we need additional randomness?**
- *Diagnosis is sharp:* yes, in the sense that variant (c) alone changes *which* strategy dominates, not the fact that one dominates. The fundamental narrow-action-space problem persists.
- *But:* not all randomness is equal. System randomness (more variance in existing mechanics) preserves planning. Event randomness (cards) broadens the strategy space. Random objectives change WHAT you're optimizing.
- *Don't over-prescribe:* before adding randomness, confirm that parameter tuning truly can't reach a healthy point (the deeper-validation run currently in flight will inform this).

## What I'd add with more time

- **Per-turn legal-action-count measurement** under variant (c) — the most actionable piece of follow-up data. I'll do this as a small instrumentation script after the deeper-validation run finishes.
- **Per-turn elapsed-CPU-time profile** as a proxy for human decision difficulty: if MCTS-100-iter takes much longer per move late-game, decisions are combinatorially harder → human time per move rises.
- **Alliance-layer pseudo-model** — even a simple "in 3P+, occasionally form a 1-turn alliance" might reveal whether the multiplayer dynamic the sim ignores changes the late-game character. Too large a change for now.
- **Player-time-per-game survey of comparable games** to calibrate "how long is too long" for IJ's intended audience.

## Things I'm uncertain about

- Whether 12-turn variant-(c) games actually feel repetitive in human play. Sim cannot answer.
- Whether the dominant strategy under (c) is "always denial warfare" or whether multiple viable paths exist. The MCTS-vs-heuristic data suggests heuristic wins on (c) via fast iron-race; MCTS struggles. That implies multiple paths exist at the meta level (race-vs-deny) but is muddy.
- Whether adding event/objective randomness would help or hurt IJ specifically. It depends on positioning (heavy vs. medium-weight game).
- Whether the project's design intent is for IJ to be a 60-90 min game (in which case 12-turn games are a problem) or a 2-3 hr game (in which case they might be the target).

## Things I almost missed

- The **concession mechanic** (R2 brainstorm) — board-game design rarely talks about it but it materially shortens long games and respects player time.
- The **setup time** (R2) — easy to ignore in the "how long" calculation. With ~30 min of setup, even a 60-min game commitment becomes 90+ min including teaching.
- The **player-count scaling** (R2) — 5-6P MCTS data doesn't exist; we've been making 2-3P inferences and projecting. The wall-clock problem is much worse at high player counts.

## Action items I'll take

1. **Wait for the deeper-validation (wider grid) run to finish.** That tells us if any variant-(c) cell is fully healthy under MCTS, and on what geometry.
2. **Then measure `legalActions.length` per turn** in 2-3 representative variant-(c) games (one early-ended, one mid, one long). Append findings here.
3. **Synthesize Sam's morning state** including these findings into the handoff.

The randomness-design discussion deserves a real session with Sam — too many design tradeoffs to commit unilaterally, and it touches game identity not just balance.
