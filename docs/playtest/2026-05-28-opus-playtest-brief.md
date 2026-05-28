# Opus Playtest Brief — Industrial Juggernaut vs. the perimeter-aware heuristic

**Date:** 2026-05-28. **Audience:** an Opus subagent dispatched to play the game and try to win against the heuristic. **Premise:** the heuristic appears near-optimal on variant (c) in simulation — MCTS @25–@300 went 0–6.3% vs it across 64 head-to-head games. Sam wants to know: does that conclusion hold against a strong human-style reasoner (you), or does the heuristic exploit a regime that has visible weaknesses a planner can find?

This brief is everything you need to play. Read it once, then begin.

## 1. The game in 60 seconds

Industrial Juggernaut is a 2–6-player hex-grid strategy game. The board is an oval of 96 hexes. 14 of those hexes are **iron** (scattered, no three adjacent). Each player has:
- 12 base tokens.
- Access to a shared pool of 36 factory tokens.
- Battle tokens for combat.

**Victory:** **first player (or alliance) to control ≥ 10 iron hexes at the end of a round wins.** (Alliances have a scaled threshold — see §4.)

**A "round"** is one player's turn-within-a-turn: they Build OR Attack, then it's the next player's round. A "turn" is one complete cycle of all alive players' rounds (random order each turn).

## 2. Control, perimeter, and the radiating-vs-polygon transition

This is the most important mechanical concept. You **control** an iron hex / factory when it's inside your territory. Your territory is one of two shapes:

- **Radiating (1–3 bases on board):** each of your bases radiates a control circle of `radius` hexes. Your territory is the **union** of those circles. Radii can overlap with opponents — when both players have <4 bases, both can claim iron in the overlap. This is the bootstrap regime.
- **Perimeter (4+ bases on board, non-degenerate hull):** your territory becomes the **convex polygon** formed by your outermost bases. Bases stop radiating. Anything strictly inside is yours; anything outside (even if it was inside one of your radius circles before) is no longer yours.

**Transition cost:** placing your 4th base can REDUCE your controlled-iron count if the polygon excludes hexes that were inside one of your radius circles. Plan your perimeter carefully.

## 3. Build action

You choose to build EITHER factories OR bases on your round (not both). Build budget = `floor((controlled_iron + controlled_factories) / 2)`. **Bootstrap exception:** in the radiating regime, you can build 1 factory per round if you control ≥ 1 iron (even if the half-resources formula says 0).

**Factory placement:** within `radius` hexes (5 default, 2 on variant (c)) of your *farthest* base — not your nearest. They can't be placed on iron hexes.

**Base placement** has three rules:
1. Within `radius` hexes (= `placeRange`) of one of your existing bases.
2. Not inside an opponent's perimeter (no overlap with their polygon).
3. **The triangle rule:** if you already have ≥ 3 bases (i.e., placing your 4th or later), the new base must form an "unobscured triangle" with two of your existing bases — meaning straight lines from the new base to two of yours must not cross an opponent's perimeter. Radiating placements (your 2nd or 3rd base) don't need the triangle rule.

Bases can't be placed on iron hexes. Bases start **fresh** when placed; they become **fatigued** after being committed to combat that turn, and refresh at turn-start.

## 4. Attack action

You can attack one (or more, if you have ≥ 6 bases in range) opponent bases per round. Constraints:
- Target must be on the opponent's outer perimeter (no interior bases).
- You commit 3, 4, 5, or 6 of YOUR bases (allied bases count too), all within 6 hexes of the target.
- Defender commits exactly 1 of THEIR bases, within 6 hexes of the target.
- All committed bases become fatigued after the battle.

Win probabilities (from the combat table): commit 3 → 75%, 4 → 83%, 5 → 89%, 6 → 100% (automatic). On win: the defender's base is replaced by yours, perimeters re-resolve, iron ownership recomputes.

## 5. Alliances (relevant for 3+P games only — variants `c-alliances`)

Two players can mutually ally: costs the actor 1 base-in-hand, both add each other to their `alliance` array. While allied:
- Allied bases count toward attack range / combat commitments.
- Coalition iron is summed for victory; coalition victory threshold scales as `victoryThreshold + delta × coalitionSize` (default delta = 4 — a 3-player coalition needs `10 + 4×3 = 22` iron, more than the board has, so coalition victory is sometimes mathematically impossible — by design as the anti-gang-up safeguard).

**Break alliance:** weighted 2/3 success roll, 1-turn cooldown either way.

**As of 2026-05-28: an ally action that would merge all currently-alive players into a single coalition is BANNED at the rules level.** (It would be functionally identical to unanimous concession.) The CLI's `legal` subcommand won't emit such actions.

## 6. Elimination paths

You're out of the game (in priority order) when:
1. **No bases:** opponent destroyed your last one.
2. **Broken-perimeter-when-industrialized:** you control ≥ 8 factories while having < 4 bases. (Industry without territory is a death clock — added 2026-05-27 to fix a simultaneous-mass-elimination defect.)
3. **No iron:** you control 0 iron hexes — but on variant (c) this only applies once you've established a perimeter. While radiating you're spared.
4. **Empty perimeter:** you place a 4th base whose polygon contains no iron.
5. **Stranded base encirclement:** an opponent fully encircles a stranded (lost-connectivity) base of yours.

## 7. The variant you'll play: `c` (`noIronRequiresPerimeter: true`)

- **Board:** 96 hexes, 14 iron, oval.
- **Radius:** 2 (smaller than default 5 — tighter, more contested).
- **Victory threshold:** 10 iron.
- **noIronRequiresPerimeter:** TRUE. A radiating player (your first 3 bases) can have 0 iron and survive. Once you set a perimeter, you must hold ≥ 1 iron or you're out (rule 3 above).
- **Most games end on turn 2** (in agent vs. agent simulation). This is a SETUP-DECIDED regime: opening positions and turn-1 builds dominate.

## 8. How the heuristic plays — perfect knowledge

The opponent agent is at `src/agent/heuristic.ts`. It evaluates positions via a weighted sum and at temperature ~1e-6 plays the deterministic argmax. **For a fixed state, it always picks the same move.**

### Position evaluation (per-player score):
```
score = 10 × controlled_iron
      + quadratic_ramp(iron, threshold)             # +10 at threshold-1, +40 at threshold
      + 1 × controlled_factories
      + 1 × hull_area
      + 0.5 × fresh_bases
      + 4 if (≥4 bases AND non-degenerate hull AND ≥1 iron inside)   # the perimeter bonus
      − 0.5 × exposed_border_hexes                  # the frontier penalty
      − 12 × max(0, factories − (factory_death_threshold − 2))   # severe ramp if <4 bases approaching factory-death
```
- `iron × 10` DOMINATES. Everything else is a tie-breaker shaping term.
- The **threshold ramp** is super-linear: 2 iron from victory you get +0 bonus; 1 iron from victory you get +10 bonus on top of the linear; 0 from victory (won) you get +40. **Iron is exponentially more valuable as you near 10.**
- The **survival term** at `survival × 12` is steep — if you're <4 bases and your controlled factories are 1 or 2 below the death threshold, building another factory is net-NEGATIVE because the penalty outweighs the `fact × 1` reward.
- `frontier` penalty: each of your controlled hexes adjacent to an opponent-controlled hex costs 0.5. Compact bunches are preferred.

### Action choice (samplePolicy at temp→0):
For each round it generates EXACTLY 2–4 candidates and argmaxes:
1. **One composed factory-build** — greedy per-piece placement maximizing per-move score (iron capture + control delta), iterated until budget is spent or no legal placement remains. Returns the multi-piece build action.
2. **One composed base-build** — same, but for bases. (Most-of-the-time the winning candidate on variant (c).)
3. **One representative attack** if attacks are legal — scored via probability-weighted expected post-evaluate.
4. **Pass** if pass is legal.
5. (Alliance candidates if `alliancesEnabled` — irrelevant in your 2P games.)

### The 5 rules the heuristic effectively follows:
1. Always grab controllable iron first (×10 weight).
2. Don't build factories at <4 bases when within 2 of the factory-death threshold.
3. Complete the 4-base perimeter ASAP once it's reachable (+4 standing bonus).
4. Keep bases compact (frontier penalty for adjacency to opponents).
5. When within 2 iron of victory, race hard (quadratic ramp).

### What the heuristic CANNOT do — these are the opportunities:
- **No lookahead.** It evaluates state-after-this-action. It does not consider what you'll do next, or its own next turn.
- **No opponent modeling.** Treats the rest of the board as a fixed position to optimize against. Doesn't anticipate your move.
- **No multi-turn perimeter planning.** Gets the +4 only when the 4th base lands. Might miss a sequence where deferring iron in turn 1 enables a stronger perimeter in turn 2 that captures MORE iron net.
- **No threat assessment.** Attacks scored by probability-weighted expected `evaluate`, no deeper combat tree.
- **No factory squeeze.** Doesn't reason about denying the shared factory supply.
- **No bluffing or mixed strategy.** Deterministic.
- **Greedy per-piece composition.** A multi-piece build is composed by picking the best single placement, applying it, picking the next-best, etc. It can fall into local optima where a different multi-piece composition would dominate.

### Hypothesized exploits (you're free to find better):
- **Perimeter denial:** instead of grabbing iron in turn 1, place bases that deny the heuristic from reaching its iron grabs in turn 2 (frontier penalty discourages it, but iron×10 will still drive it to push through).
- **Factory rush in radiating:** build 1–2 factories early to boost build budget; just stay below the survival cliff (factory ≤ death_threshold − 3).
- **Maximize the perimeter polygon:** an L-shape (per the rules doc, §Strategy Notes) for your first three bases lets your 4th enclose a large rectangle. The heuristic doesn't optimize hull AREA explicitly until 4+ bases.
- **Forward-base aggression:** place a base IN the heuristic's expected expansion zone to force perimeter conflict.
- **Attack the 4th-base perimeter trigger:** if you can become 3+ bases ready to attack just as the heuristic completes its perimeter, capturing a perimeter base swings iron drastically.

## 9. CLI walkthrough — how to play

The CLI is at `src/cli/play.ts`, invoked via `npx tsx src/cli/play.ts <subcommand>`. All state is in JSON files; opponents auto-resolve.

### Start a game:
```
npx tsx src/cli/play.ts new --seed 42 --players 2 --variant c --you 0 --opponent heuristic --out /tmp/g.json
```
- `--seed N` — any integer; controls board generation + first-turn order.
- `--you P` — your player id (0 or 1 in a 2P game). P0 generally goes first (random in turn 1; weighted by iron in 2P after).
- `--out FILE` — state will be persisted there.

### Look at the state:
```
npx tsx src/cli/play.ts show /tmp/g.json          # pretty human view
npx tsx src/cli/play.ts show /tmp/g.json --json   # structured JSON view for agent reasoning
```

### See your legal actions:
```
npx tsx src/cli/play.ts legal /tmp/g.json --json
```
Returns an array of `{index, action, display}` objects. Use the `index` field with `act`.

### Play a move:
```
npx tsx src/cli/play.ts act /tmp/g.json --index 5
```
This applies the chosen action, advances the round, auto-plays opponents until your next turn (or game end), and writes the new state to the same file. The output tells you what opponents did and what the new status is.

### See what the heuristic would do (sanity / learning):
```
npx tsx src/cli/play.ts hint /tmp/g.json
```
Returns the heuristic's argmax for the current player. **Don't use this as your move — use it to understand what you're playing against.**

### When the game ends:
The JSON view's `gameOver` field becomes `true` and `victory.winners` lists the winning player(s). Iron victory = whoever first reached the threshold; last-standing = whoever has the only surviving coalition.

## 10. Your task and how to measure success

**Primary goal:** **win at least one 2P game against the heuristic on variant (c).**

**Recommended approach:**
1. Try 5–10 different seeds to find one where the geometry gives you a chance (board layout matters — you may get an unfortunate starting position).
2. For each seed, study the initial state. Compare it to what the heuristic would do via `hint`. Look for divergences.
3. Play your move. Watch what the heuristic does in response (the `act` output prints it). Adjust.
4. If you lose, try again with a different seed OR a different strategy on the same seed.

**Document each game you play:** in your reasoning (chain of thought), record:
- Which seed you used.
- What you tried.
- What happened.
- Why you think it worked or didn't.

Your Claude Code session captures the full transcript automatically — every reasoning step, every CLI invocation, every state response. So **think OUT LOUD** as you reason. Sam will read the transcript.

**Stretch goals (if you win the 2P (c) game):**
- Win a 3P or 4P game on variant `c-alliances` (you'll need to reason about ally targets).
- Beat MCTS@50 instead of the heuristic (`--opponent mcts --mcts-iter 50`).
- Find a strategy that wins against MULTIPLE seeds reliably (suggest a pattern).

**Time budget:** spend 30–60 minutes. Quality of reasoning matters more than raw game count. If you don't win, that's also valuable data — articulate WHY (is the heuristic really near-optimal? was your hypothesis wrong? did you misread state?).

## 11. Pitfalls and gotchas

- **Hex coordinate system is cube coordinates.** Each hex has `(x, y, z)` integers where `x + y + z = 0`. Neighbors share an edge.
- **Iron is denoted by its hex coord, not an ID.** "Iron at `(2,-1,-1)`" is a specific hex; controlling that hex means it falls inside your territory.
- **Don't trust `basesInHand` to predict perimeter completion** — placing a base is legal only if the placement rules (range, triangle visibility, not inside enemy perimeter) are all satisfied. Many in-hand bases doesn't mean many legal placements.
- **Attack range = 6 hexes; build range = `radius` (2 on variant c).** Attack reach is longer than build reach.
- **Combat is stochastic** — even committing 5 attackers has a 11% failure chance. The CLI uses the seeded PRNG, so re-running the same `act` deterministically gives the same outcome. To try a different combat outcome you'd need to restart with a different seed.
- **`hint` advances no state** — it just queries the heuristic. Use freely.

---

Good luck. The deck IS stacked — but the heuristic is shallow. If you can think two moves ahead, the asymmetry might be yours.
