# Design Implications — if 3P+ is mechanical, what changes?

> Speculative companion to the flight packet. Treats Sam's mechanical-3P+ worry as confirmed (R + C1 data point that way) and explores what design moves are available.

## The premise

From overnight + flight data:
- **Random vs heuristic (Track R, 2026-05-29):** heuristic crushes random 91.7%/5% in 2P, 100%/0% in 3P and 4P. The game HAS real skill structure (random destroyed).
- **Lookahead2/lookahead2-multi vs heuristic in 3P/4P:** plays at baseline. Proper multi-player minimax doesn't find improvements above heuristic.
- **2P (c) is different:** lookahead2 wins 80.7%, exploiting the iron-weighted turn-order PRNG flip + locally-greedy composition.

**Conclusion:** in 3P+ (c), the heuristic strategy IS near-optimal. There is no significant strategic depth above "execute the heuristic correctly." A human who memorizes the heuristic's 5 rules of thumb plays at maximum strength.

## What that means for the gameplay experience

Mechanical 3P+ means:
- Players who know the rules play at the same level as players who think hard. No reward for strategic insight.
- Outcomes feel deterministic given setup (who got the better starting position wins).
- The game becomes a board-position lottery + mechanical execution.

For a strategy game targeting multi-player play, this is a design problem. Below are the available levers.

## Design options

Roughly ordered by scope of change required.

### Option A — accept and refocus

Accept that 3P+ on (c) is mechanical. Refocus the design around:
- 2P competitive play (where strategy genuinely matters; lookahead2 80% shows skill ceiling exists).
- Multi-player as a SOCIAL game where alliance dynamics + bluffing matter more than pure-strategy ceiling (note: alliances were sweep-validated earlier; coalition-win mechanics work).

**Cost:** minimal. The game ships as-is with this framing.
**Risk:** "casual" multi-player + "competitive" 2P is a niche positioning.

### Option B — Tactical Depth (asymmetric base types)

We've shipped engine Phases 1-4 of the Tactical Depth plan. The remaining work (Phases 5-7) exposes subtypes to legalActions and runs a comparison sweep. If asymmetric types open NEW strategic dimensions the heuristic can't trivially score, the heuristic stops being near-optimal because position evaluation gets more complex.

**Specific bet:** outpost vs watchtower trade-offs (cheap-low-radius vs expensive-high-radius-defensive) require strategic role choice. The heuristic's iron-x10-weight wouldn't capture "I should build outposts for spreading even though they don't grab more iron immediately."

**Cost:** ~10-15 hours engineering (Phases 5-7) + comparison sweep.
**Risk:** the asymmetric types might NOT introduce real strategic depth — they might just be 3 different ways to do the same thing. Track D (queued) will give early indication: if `baseTypesEnabled=true` doesn't shift heuristic-self-play metrics, the bet isn't paying off yet.

### Option C — Information asymmetry / hidden information

Currently the game is perfect information: you can see every iron hex, every base, every alliance. Adding hidden information would break the deterministic-optimal-play property:
- Hidden territory: opponents' perimeter polygons aren't fully visible until you're nearby.
- Hidden alliances: players ally privately, the public game state doesn't show who's allied with whom.
- Hidden resources: factory placement is secret until used.

**Specific bet:** hidden alliances. Currently the engine's `state.players[i].alliance` is publicly observable. If we made it private (e.g., players announce alliances by playing cards face-down), the heuristic's optimal play wouldn't be computable from public state.

**Cost:** significant rules redesign. Possibly months of work + playtesting.
**Risk:** changes the game's character substantially. Might fix multiplayer at cost of accessibility.

### Option D — Stochastic combat extension

Currently combat is a single Bernoulli (75%/83%/89%/100% by commit). What if combat had MORE variance — e.g., a 2-roll mechanic where you can re-roll once per turn? Strategic depth would come from "when to spend the re-roll."

Or: replace combat-table with a card draw mechanic where each player has a finite hand of combat modifiers.

**Specific bet:** adds STRATEGIC RESOURCE MANAGEMENT (when to use re-roll, what hand to keep) — a layer the heuristic doesn't currently consider.

**Cost:** moderate rules change.
**Risk:** introduces luck variance that might frustrate competitive 2P play.

### Option E — Anti-deterministic-T2 lever: random turn-order seed each turn

The 2P (c) exploit hinges on the iron-weighted T2 turn-order draw being deterministic in sim AND knowable in tabletop (your iron count is public; opponent's iron is public; total iron is public; the draw is iron-weighted random). The lookahead2 agent EXPLOITS the deterministic mod-arithmetic.

What if turn order had MORE entropy? E.g., each turn, draw player order from a velvet bag containing BOTH iron tokens AND a small fixed number of "wildcard" tokens that any player can win. The probability shifts toward but not exactly to the iron-richer player.

**Specific bet:** this would slightly damage lookahead2's deterministic edge in 2P without breaking 3P+ optimization. Probably not a multi-player fix though.

**Cost:** small rules tweak.
**Risk:** modest.

### Option F — Add a "tempo" mechanic

Currently you build OR attack on your turn. What if you could TRADE — accept iron tokens from another player in exchange for not attacking them? This adds a NEGOTIATION layer where each player's position becomes social, not just board-state-based.

This is essentially "alliances with explicit price." Closely related to the alliance work already shipped.

**Specific bet:** explicit trade adds a decision layer the heuristic can't score (it has no model of negotiation).

**Cost:** moderate rules + UI.
**Risk:** dramatically changes the game's feel.

## What I'd test next (if I had unlimited time)

1. **Variant search for "decisions that aren't trivially iron-maxing":** sweep configs where iron count alone doesn't determine winner. E.g., factory-rich+iron-poor vs iron-rich+factory-poor — what wins?
2. **Hidden-information mock:** simulate alliances as hidden, give the heuristic a "guess opponent strategy" sub-module. Does it still dominate?
3. **Mechanism-design sweeps:** for each design option above, simulate it (cheaply) and see if it produces lookahead2-multi advantage above baseline.

## What Sam's call probably should be

The decision depends on the design target. If competitive multi-player strategy is the target, B (Tactical Depth) is the cheapest direction and has engine support already shipped. If casual multi-player + competitive 2P is acceptable, A (accept) is fine.

The data we'll have when you land includes Tracks D, V, AB, lookahead3 — which will sharpen specifically whether Tactical Depth (B) is paying off.

---

*Speculative — written 2026-05-29 mid-flight while data was still landing. Likely needs updating once final results are in.*
