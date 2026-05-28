# Opus Structured Playtest — Industrial Juggernaut

**Date:** 2026-05-28
**Agent:** Opus 4.7 (structured 10-game study, separate from sister freeform agent)
**Setup:** 2P, variant `c`, P0 (me) vs heuristic. Seeds 1000-1009 in order.
**Goal:** Test whether adaptive reasoning across games unlocks wins where MCTS @25-@300 went 0-6.3%.

## Pre-game mental model (from brief)

- Iron × 10 dominates heuristic eval. It will grab any iron it can reach.
- Heuristic is greedy/no-lookahead. Composed builds use per-piece greedy — local optima exist.
- Variant c radius is 2 (tight). Most games end turn 2.
- Perimeter transition (4th base) can REDUCE controlled iron. Plan polygon carefully.
- Survival cliff: <4 bases AND ≥ death_threshold − 2 factories → severe penalty.
- Hypothesized exploits to test:
  - L-shape opening for 3 radiating bases → big rectangle on 4th.
  - Forward-base aggression / perimeter denial.
  - Factory rush in radiating below survival cliff.
  - Catch heuristic mid-perimeter completion with attack.

## Game-by-game log

### Game 1 (seed 1000)

**Strategy hypothesis before play:** Standard probe. I have no a-priori knowledge of seed 1000's geometry — start by inspecting the board, then look for L-shape opening / iron grab.

**Trajectory:**
- Setup placed me (P0) at corner (-5, 6, -1). P1 initial base at (5, -6, 1).
- P1 won random turn-1 order, used their first round to place 2nd base at (1, -1, 0) — central, ON an iron hex.
- After that pre-turn build, P1 controls 9 iron immediately (their two radius-2 circles cover 9 of the 14 iron hexes).
- My only legal action: **pass**. Build budget = floor(0+0)/2 = 0, no iron means no bootstrap factory.
- P1 turn 2 (or rest of turn 1?): built 4 bases — (-2,2,0), (5,-1,-4), (-5,1,4), (-3,6,-3) — establishing a perimeter that crosses the whole board, claiming all iron not denied. Iron victory.

**Outcome:** LOST. P1 iron victory in essentially 0 of my moves. Final iron P1=10+, P0=0.

**What I learned:**
- Variant c with radius 2 + 2P: if the opponent's first-base seed (which is "outermost ring") happens to be adjacent to a dense iron cluster, the random pre-turn build can let them grab 9 iron in 1 placement.
- My corner position with **zero iron in radius-2 reach** is a near-unwinnable opening — there is literally nothing I can do on turn 1 because budget=0 AND bootstrap factory requires ≥1 iron.
- **The seed/turn-order RNG can hand the heuristic a starting position so dominant that no agent can recover.** This is a structural ceiling on the win rate, not a heuristic strength.
- Implication: not all seeds are winnable. I should look at the starting state and ASSESS the geometry before deciding what's possible.

**Strategy update for next game:**
- First action every game: inspect starting iron-to-my-base distances. If 0 iron is reachable within radius 2 of my starting base AND opponent has dominant iron access, accept the loss is likely.
- When I DO have iron reachable, prioritize grabbing it turn 1 with a base placement that's also positioned to ENCLOSE more iron once I add bases 3 and 4.
- Specifically test L-shape: place 2nd base offset 2 hexes in one direction, 3rd base offset 2 hexes orthogonally, so the 4th base completes a roughly-rectangular perimeter.

