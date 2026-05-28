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

### Game 2 (seed 1001)

**Strategy hypothesis before play:** Same corner start (-5,6,-1). P1 second-base at (1,-1,0) centrally. This time I have 1 iron at (-4,4,0) — bootstrap works. Try aggressive overlap: place 2nd base ON P1's iron (0,1,-1) — captures 6 iron via overlap rule AND obstructs P1's perimeter geometry. Hypothesis: forcing P1 to perimeter-around me costs them iron.

**Key discovery before play:** `placeRange` is 5 even though `radius` is 2 in variant c. Brief was slightly misleading — they're separate config fields. I can PLACE up to 5 hexes from any of my bases, even though my TERRITORY only extends radius 2.

**Trajectory:**
- I built base at (0,1,-1) (heuristic-recommended, also greedy max-iron). My iron jumped 1 → 7 (overlap captures 6 of P1's iron tiles since both <4 bases).
- P1 immediately responded with budget=4: built 4 bases (-3,3,0), (1,3,-4), (-6,3,3), (-3,6,-3) — completing a massive 6-base perimeter that wraps the center.
- Final: P0=7 iron, P1=13. P1 iron victory.

**Outcome:** LOST. P1 iron victory turn 2 round 0. P1 had budget 4 from their 8-iron start; my best move (capturing 6 in overlap) wasn't enough to deny their perimeter completion.

**What I learned:**
- **placeRange ≠ radius**: in variant c, placeRange=5 (default), radius=2. Critical for placing distant bases.
- The starting position is essentially decided BEFORE my first move: if P1 starts at a central iron-rich hex, their pre-turn build pushes them to ≥8 iron, which gives them turn-1 budget of 4 bases — enough for an instant perimeter win.
- My max possible single-move iron capture is ~6-7 (via overlap with P1's dense cluster). P1 keeps their 8 PLUS gets MORE via their 4-base perimeter completion. Net: P1 wins.
- **The heuristic's greedy "grab max iron" recommendation was a TRAP here** — it gave me 7 iron, looked good on eval, but my response just helped P1 complete their dominant perimeter on their first composed-build.
- **The key parameter for me is P1's iron count at start of my turn-1.** If P1 < 8 iron → P1 budget < 4 → P1 can't complete perimeter turn 1 → I have a turn-2 chance.

**Strategy update for next game:**
- IF P1 has ≥8 iron after their pre-turn build → likely lost seed, but still try a denial play (place base to SHRINK P1's max perimeter, not max-iron-grab for me).
- IF P1 has <8 iron after their pre-turn build → I have a real game. Build budget will be limited for both of us.
- **NEW hypothesis to test:** instead of grabbing P1's iron via overlap, place my base OUTSIDE P1's reach but in a position that ENCLOSES many neutral iron when I add bases 3-4. The heuristic-recommended (greedy) move gives short-term iron but enables P1's perimeter completion.

### Game 3 (seed 1002)

**Strategy hypothesis before play:** First fair seed (I go first, both at 1 iron). Play (-1,1,0) — the heuristic's own choice — to capture 6 neutral iron via central placement, reaching 7 iron. Hypothesis: with 7 iron and going first turn 2 (iron-weighted draw favors me), I can complete a 4-base perimeter before P1 does.

**Trajectory:**
- T1.R1 (P0): built (-1,1,0). My iron went 1 → 7 (or maybe 8 — see below).
- T1.R2 (P1): built (1,-1,0). P1's iron went 1 → 8 (overlapping with me on 3 hexes but P1's territory also contains 5 non-overlapping iron tiles).
- T2.R1 (P1): P1 went first (probably tiebreak or higher iron). Built 4 bases (-3,3,0), (5,-1,-4), (-5,1,4), (-3,6,-3) — board-spanning perimeter.
- Final: P0=8 iron (in iron-list ownership), P1=14 by `control()`. P1 won by iron.

**Outcome:** LOST. P1 won despite me reaching 7-8 iron, because they ALSO reached 8 iron with their central placement, gaining budget=4 → 4-base perimeter → all 14 iron enclosed.

**What I learned:**
- **Critical realization: P1 (1,-1,0) is iron-budget heaven.** Centrally placed, radius 2 hits ~7-8 iron tiles. The heuristic ALWAYS heads here as P1's 2nd base move. To win, I must DENY this hex or reduce P1's iron yield from it.
- **From (-5,6,-1), I CANNOT reach (1,-1,0) on turn 1.** Distance 7, placeRange 5. So I can't occupy it directly.
- **(0,1,-1) at distance 5 from my base is the CLOSEST I can get to P1's central iron cluster.** Placing there: captures 5 neutral iron AND I'm adjacent to (1,-1,0). Maybe even better than (-1,1,0) because it overlaps with what P1 wants — every iron in OUR overlap reduces P1's net new iron.
- **Even with 7-8 iron turn 1, P1 also gets 7-8 → budget 4 → wins turn 2.** I need to actively REDUCE P1's iron yield, not just maximize mine.
- The heuristic's `hint` recommendation maximizes MY iron via greedy local search — but doesn't deny P1's iron. That's the exploit window.

**Strategy update for next game:**
- **New plan: maximize SHARED OVERLAP, not just my iron.** Place at a hex that grabs iron AND is within P1's eventual radius 2. Every shared iron splits P1's gain (we both have it, but it doesn't help them reach 10 unless we count it for them — and we do — but if MORE iron is "wasted" in overlap rather than P1-exclusive, P1's max is suppressed).
  - Actually wait — overlap is GOOD for both. Doesn't suppress P1's count.
- **Better plan: place at a CHOKE position that prevents P1 from forming a board-spanning perimeter.** Specifically, place on an iron tile P1 would otherwise capture AND that's adjacent to where P1's perimeter corner needs to go.
  - P1's perimeter corners in winning games have been: (-3,3,0), (5,-1,-4), (-5,1,4), (-3,6,-3), (-3,6,-3). The two closest to my corner: (-3,3,0) and (-3,6,-3). These are within my placeRange 5.
- **Test in game 4: place at (-3,3,0) (iron-rich AND a P1-perimeter-corner candidate).** This denies P1 that perimeter point AND grabs iron for me. Then turn 2, my goal is a 4-base perimeter that includes max iron.

### Game 4 (seed 1003)

**Strategy hypothesis before play:** P1 went first (pre-turn build (1,-1,0)). P1 already has 9 iron. To "deny" P1's perimeter, I'd want a base in the middle of where their convex hull would go — but a single base inside doesn't break a convex polygon, P1 just routes around. Switched strategy mid-thought: play (-1,1,0) — the central denial spot — to maximize MY iron via 6-tile overlap AND occupy a central hex P1 wants for their perimeter geometry.

**Trajectory:**
- T1.R0 (P1, pre-turn): built (1,-1,0). P1 iron 9.
- T1.R1 (P0): built (-1,1,0). My iron 1 → 9 (huge overlap with P1's central cluster — 7 P1-overlap iron + 1 my existing + 1 (-1,1,0) itself).
- T2.R0 (P1): built 4 bases (-3,3,0), (1,3,-4), (-5,1,4), (-6,6,0). 6 bases → perimeter encloses board. P1 iron → 14.

**Outcome:** LOST. P1 iron victory turn 2 round 0.

**What I learned — MAJOR INSIGHT:**
- **P1's heuristic ALWAYS picks (1,-1,0) as their 2nd base in seeds I've tested.** It's the dense-iron-cluster magnet — 7-8 iron in radius 2.
- **Even when I occupy (-1,1,0) and have my base inside the polygon P1 wants to form, P1's polygon is still valid because they place around the OUTSIDE.** My base becomes a "pocket" inside their territory. The iron in that pocket is listed as → P0 but it's also inside P1's perimeter — so P1's `control()` count includes it. **My base inside their polygon doesn't deny them iron — it just becomes a stranded base.** Confirmed: P1 iron=14 in final state means ALL 14 iron count for P1's control even though several are "→ P0" in iron-list.
- This is a critical mechanical understanding: **the iron-list "→ P_X" ownership is a display artifact; the engine's `control()` counts iron-inside-my-polygon regardless of nominal owner.**
- **Perimeter denial via single-base occupation does NOT work** — convex hulls just contain me.
- **For perimeter denial to work, I'd need my base to be OUTSIDE the polygon and on the LINE of the polygon's convex hull** — i.e., placed at a corner of where P1's hull would go.
- The P1 perimeter corners I've seen across games: (-3,3,0), (-3,6,-3), (-5,1,4), (-6,6,0), (5,-1,-4), (1,3,-4). These are at the edges of the board. They're EXTREME positions.

**Strategy update for next game:**
- Test EDGE BASE denial: place my base at (-3,6,-3) or similar P1-corner-candidate. This won't grab much iron, but it physically obstructs P1's hull.
- **Question to investigate:** does the heuristic re-route around denial, OR does it pick a smaller hull? If smaller, P1's iron drops, possibly below 10.
- Alternative: try a MAXIMUM-iron move via a different hex than (-1,1,0). Maybe placing AT an iron hex centrally — but ON an iron hex blocks future factory placement there.

