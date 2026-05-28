# Neutral Defending Bases for 2P — Design Spec

**Date:** 2026-05-28 (overnight)
**Trigger:** Sam — "maybe 2P could have a few semi-randomly placed neutral/NPC bases that only defend (subject to some sane placement rules so they're not right on top of players, etc. Possibly symmetric or lightly asymmetric)." The motivation: 2P games structurally lack the *multiplayer pressure* (third-party threat, alliance dynamics) that 3P+ has — neutral bases simulate "the rest of the world" without committing to NPC alliances.
**Status:** Spec for Sam. NOT implemented. Independent of alliance work — neutral bases are a 2P-only complication.

## What problem this solves

The variant-(c) findings suggest 2P games are the riskiest case for engagement: 2P denial warfare runs 8-17 turns with no narrative variety beyond the duel. In real 2P play, the absence of "outside pressure" makes the game feel mechanical — both players know exactly what the other can do. **Neutral bases inject *positional uncertainty* without adding strategic complexity.**

## Mechanics (5 axes of design)

### 1. Placement
- **Semi-random**: deterministic given seed but varies across games. Use the iron-CSP-style approach — neutrals placed via constraint satisfaction at setup.
- **Constraint set:**
  - Min distance from player starting bases (avoid "right on top of players").
  - Min distance from each other (avoid neutrals clumping).
  - On board (not edge / outside hex).
  - NOT on iron hexes (or — could it sometimes be ON iron, making capture interesting? Probably no for v1; complicates iron-control logic).
- **Count:** 3-6 neutrals per 2P game, tunable. Default 4.
- **Symmetric vs asymmetric:** default symmetric (mirror placement to balance both players' challenge). Asymmetric option for later.

### 2. Combat behavior
- **Defend-only**: never initiate attacks.
- **Defense strength**: standard base defense (1 base = 1 defender, like a player base).
- **Take damage like a normal base** (defeated by 3+ attackers per the combat table).
- **No factories**: neutrals don't generate factories nor produce resources.
- **No control**: neutrals don't establish a control disk (don't claim iron).

### 3. Capture / destruction
- When a neutral base is defeated in combat, it is **removed from the board**. No territory transfer (since it never claimed any).
- **No kill bounty**: neutrals aren't players, so no `applyEliminations` bounty path.
- Optional: the attacking player gains 1 base-in-hand for defeating a neutral (a small reward for clearing the board). **Default: NO bounty** to avoid neutrals becoming farmable.

### 4. Spatial influence
- **Block placement**: do neutrals block opposing player placements within their range? In v1, no — they don't have control disks. They only physically occupy a hex.
- **Block sight lines**: a neutral hex blocks sight just like any base. This is the load-bearing positional effect — neutrals chunk the board.
- **No iron denial**: since neutrals don't establish control, the iron they sit near is open game.

### 5. Game-end interaction
- If both players are eliminated (degenerate edge), neutrals "win"? **No** — `status()` returns last-standing with empty winner (current behavior). Neutrals are not players.
- If a neutral has zero opponents because both human players were eliminated, the neutral just sits there until the game ends.

## Adversarial review

**R1 (does this actually add engagement?):** unclear. Neutrals add positional variability but not strategic depth. The 2P duel is still fundamentally a duel, just with extra hexes blocking sight lines. **Mitigation:** the variability is real (different games have different neutral positions, requiring different opening plans). Whether this translates to engagement requires playtest.

**R2 (does this slow games?):** somewhat. More objects on board → more sight-line considerations → marginally more per-decision cost. Probably acceptable (~5-10% time increase, not 2x).

**R3 (interaction with variant (c)):** if neutrals are placed near iron and the player has noIronRequiresPerimeter spared their elimination, the neutral could be the *thing they have to clear* to access iron. That's actually positive — neutrals become objectives.

**R4 (interaction with combat):** if combat decisively decides 1-vs-defender (defender wins on 3-attack 25% of time per Bernoulli), 4-attacks defeat with probability 5/6 — about right. Neutrals would be ~1-2-attack worth of investment per kill. Not too cheap, not too expensive.

**R5 (degeneracy: do both players just race to clear neutrals?):** possible. If clearing a neutral is on the critical path to a player's iron, both players have an asymmetric task. If clearing is purely optional, players ignore neutrals. The placement constraints (between players' starting positions, near contested iron) should ensure neutrals are on the critical path *sometimes* but not always.

## Recommendation

Build a v1 with:
- Count: 4 neutrals.
- Placement: symmetric, mirrored across the board centroid; satisfies the min-distance and no-iron constraints.
- Combat: defend-only, standard defense, no bounty when defeated.
- No control disk, no factory generation, no iron denial.
- Sight-line blocking: yes (like any base).

Behind a `neutralBasesIn2P: number` flag (default 0 = off). Engine treats neutrals as a special non-player base (new owner enum value, e.g. `"neutral"`).

## Implementation footprint

- New `RuleConfig` flag: `neutralBasesIn2P: number` (default 0).
- `Base.owner` becomes `PlayerId | "neutral"` (union); some code that assumes `owner: number` needs branching.
- `setupGame` places neutrals after player starts; uses a CSP similar to iron placement.
- `control()` ignores neutrals (no disk).
- `applyAction` combat logic: neutrals are defendable but not attacker — `legalActions` excludes attack actions originating from neutral bases (n/a since neutral has no turn).
- Combat: attacker target can be a neutral; outcome resolves; if defeated, neutral base removed; no bounty.
- `status()` ignores neutrals for victory checks.

Estimated work: ~2-3 hours. Bigger than concession (because of the `Base.owner` union change), smaller than alliances.

## Out of scope for first iteration

- Asymmetric placement (one player gets harder neutrals).
- Neutral bases that grow / reinforce over time.
- Neutrals on iron hexes (would require capture mechanics).
- Multi-tier neutrals (small vs. fortified).
- Bonus rewards for defeating neutrals.

## Open questions for Sam

1. Default count (4 neutrals)?
2. Symmetric placement or random-asymmetric default?
3. Should defeating a neutral give the attacker any reward (e.g., 1 base-in-hand)? Currently no.
4. Should there be a "neutral starts near each iron deposit" placement style, making each iron contested? Or just board-distributed?
