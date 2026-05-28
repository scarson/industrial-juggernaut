# Concession Mechanic — Design Spec

**Date:** 2026-05-28 (overnight)
**Trigger:** Sam confirmed concession is in scope; the unresolved question is **what happens to a conceding player's assets** in 3–6P games.
**Status:** Spec for Sam. NOT implemented; opens the asset-handling decision.

## Why concession matters

Long games with denial-warfare dynamics can have one player effectively eliminated by mid-game while the game continues for hours. Without a concession mechanic, that player either (a) plays a forced losing position for the rest of the game (frustrating, time-wasting, doesn't want to play again) or (b) "rage-quits" informally (un-fun for everyone). Concession is a *consensual* exit that respects player time.

In 2P games, a concession is simple: the other player wins. In 3-6P games, the conceding player's assets (bases, controlled iron, factories, basesInHand) become a non-trivial resource that affects the remaining players' positions. **The asset-handling decision is the design choice.**

## The asset-handling options (5 lenses)

### 1. Vanish — assets are removed from play
- Conceding player's bases are removed from the board.
- Factories they controlled go... where? Either removed entirely OR become un-owned (any player whose disk now reaches them controls them).
- BasesInHand discarded (out of game).
- **Pros:** simple; doesn't reward survivors with a windfall; closer to "the player just isn't here anymore."
- **Cons:** invites concession as a strategic move — "deny my opponents the win by removing my iron/factories." Anti-competitive incentive.

### 2. Become neutral defenders — bases stay on board, defend only
- Bases stay where they are; can't attack, can't be built upon; opposing players can attack them like normal.
- Factories continue to exist but generate no bonus (or stay productive but neutral).
- Iron under former player's hexes becomes contested.
- **Pros:** preserves board state; the "ghost" of the conceding player creates positional complications for everyone.
- **Cons:** can make the game LONGER (more obstacles to navigate); incomplete behavior model for "neutral" (do they get attacked, eliminated, ignored?).

### 3. Spoils-distribution — assets are awarded by some rule
- Specific examples:
  - **Kill-bounty model:** bases are removed; the player who pressured the conceder most (most attacks against them, by attack count or successful) gains 12 bases-in-hand (kill bounty).
  - **Pro-rata:** assets are split among remaining players by some metric (iron-controlled? perimeter-area?).
  - **King-killer:** the LEADING player at the moment of concession gets nothing; assets distributed among trailing players (king-killer / catch-up).
- **Pros:** mechanical drama; ties concession to in-game state.
- **Cons:** complex; needs a "who pressured most" tracking; can be game-y ("I'll concede to give my ally the bounty").

### 4. Auto-loss-condition — concession is a trigger for a different elimination cause
- Conceding player is treated as if they hit the broken-perimeter / no-iron death — assets handled by existing elimination machinery (currently: bases removed from play, kill bounty to byPlayer).
- **Pros:** reuses existing code; predictable outcome.
- **Cons:** there's no "byPlayer" in concession (it's voluntary); awarding bounty to "no one" or to "everyone equally" is awkward.

### 5. Negotiated exit — player chooses how their assets dissolve
- The conceding player picks where their iron goes / which player gets their bases / etc.
- **Pros:** maximally agentic; preserves the conceding player's strategic agency through their last act.
- **Cons:** another decision the loser must make while frustrated; potential for spite-plays ("I'll give everything to player X just to screw player Y").

## Adversarial review

**R1 (auto-gg / griefing potential):** options 1 and 5 both invite concession-as-weapon — concede to deny survivors a windfall, or to screw a specific opponent. Anti-competitive incentive bad. Option 2 (neutral defenders) and option 4 (auto-loss-condition without by-player) avoid this. Recommendation: **option 2 OR option 4** to minimize griefing.

**R2 (time-cost of concession):** option 2 lengthens games (more obstacles); options 1, 3, 4 shorten or are neutral. Sam's stated concern is "long games are bad" — favor options that *shorten* games when a player concedes.

**R3 (rules complexity):** options 3, 5 are complex (new tracking, new decisions). Options 1, 2, 4 are simpler. The base rule is the conceding player's bases — where do they go? Cleanest: option 2 (stay as neutral) or option 4 (removed via existing elimination machinery, no bounty).

**R4 (engine reuse):** option 4 reuses the most existing engine — `applyEliminations` already removes bases and awards bounty. Adding a concession trigger is small. Option 2 needs new "neutral" base ownership and rules for combat against neutral.

**R5 (player feel):** option 2 (assets stay as neutral) preserves the *narrative* of the player's contribution. Option 4 (removed via elimination machinery) is cleaner mechanically but more abrupt. Sam likes minimum-mechanical-change; favor option 4.

## Recommendation

**Option 4 (concession as elimination, no by-player bounty)** — least invasive to existing code, no griefing incentive, simple to explain. Concession initiates the noBases elimination cause; bases are removed; bounty is awarded to **no one** (no by-player passed in). Existing `applyEliminations` with `byPlayer = null` already produces the no-bounty path — confirmed in test coverage.

The conceding player's `basesInHand` is also discarded (zeroed); they no longer have any state in the game.

**Concession is available as an action only when:**
- It's the conceding player's turn (they can't concede in someone else's turn — anti-griefing).
- *(optional)* The player has met a "loss criterion" — e.g., they have fewer than X% of the iron the leader has. Prevents pure griefing concession. **Decision:** for first iteration, skip this gate — concession is unconditional. Add the criterion later if observed griefing.

**Implementation footprint:**
- New `Action`: `{ kind: "concede" }`.
- `legalActions` includes `{ kind: "concede" }` always, for the current player (if `concessionEnabled: true`, default false).
- `applyAction` for concede: set the conceding player's `eliminated = true`, then run `applyEliminations(state, null)` to mop up bases. RNG threading: one no-op draw to maintain GEO-3 advancement determinism.
- Status check after concession may trigger last-standing victory.
- New `RuleConfig` flag: `concessionEnabled: boolean` (default false).

**Open question for Sam:** the "loss criterion" gate for concession (anti-griefing). Skip for v1?

## Out of scope for first iteration

- Negotiated-exit (option 5) — player chooses asset distribution.
- Spoils distribution (option 3) — adds tracking complexity.
- Pre-concession "you can offer terms before conceding" — wargame-style negotiation, too rich for now.
