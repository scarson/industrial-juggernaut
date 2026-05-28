# Board-Terrain-Manipulation Events — Design Spec

**Date:** 2026-05-28 (overnight)
**Trigger:** Sam — "Maybe something that lets each player block a non-iron tile from future placement eligibility? Take that as 'board terrain manipulation, generally', as just one possible idea." This is the mid-game-event lever from the long-game-engagement exercise.
**Status:** Spec for Sam. NOT implemented. This is the broadest of the design follow-ups — many flavors share the same mechanical scaffolding.

## Why terrain manipulation is interesting

The variant-(c) findings show static action space (build/attack/pass) is the structural cause of one-strategy-dominance under strong play. **Board-terrain manipulation adds a new dimension to the action space**: players can shape the board itself, not just their position on it. This is qualitatively different from troop types (asymmetric pieces) or alliances (player relationships) — it's *modifying the playing field*.

The specific case Sam mentioned (block a non-iron tile from placement eligibility) is a "denial" move: prevent opponent expansion in a particular direction. This creates strategic decisions (where to block) without adding new troops or new combat rules.

## Five flavors of terrain manipulation

### 1. Block / claim — one-shot positional denial
- Each player gets N blocks per game (e.g., 2).
- A blocked tile cannot be built upon by anyone (or only by the blocker — variant). Blocked tiles still allow sight lines through them.
- Decisions: WHEN to block (saving for crisis vs. preemptive); WHERE (chokepoint vs. iron-adjacent vs. opponent-expansion-path).
- **Sam's stated example.** Cleanest, lowest-complexity.

### 2. Decay / regeneration — iron deposits change over time
- Iron deposits "decay" if not controlled for N turns (removed from the board).
- New iron deposits appear at random positions every N turns.
- Decisions: defend EXISTING iron (vs. denial), or PRESPECT for new iron (gambling on regeneration positions).
- **Pro:** adds time-varying state, breaks single-strategy convergence (no fixed iron map).
- **Con:** big change to the iron-mining mechanic; could feel chaotic.

### 3. Terrain reveals — hidden hexes start unknown
- A portion of the board is hidden at setup.
- Players "scout" hidden hexes by placing bases nearby (sight-line reveals).
- Decisions: invest in scouting vs. exploiting known territory.
- **Pro:** information asymmetry adds depth.
- **Con:** much bigger engine change (partial observability of state).

### 4. Random events — periodic table-wide effects
- Every N turns, an event card / random effect fires.
- Examples: "everyone loses 1 iron"; "a new iron deposit appears at hex X"; "all combats this turn have +1 attacker".
- **Pro:** adds variability without per-decision complexity.
- **Con:** Sam's "shitty way to spend two hours" concern — random events can decide outcomes unfairly.

### 5. Player-driven terrain changes — abilities like "scorched earth"
- A special action burns / destroys a hex (no one can build on it for the rest of the game).
- One-use per game (or limited).
- **Pro:** dramatic; high-leverage decision.
- **Con:** can be ungainfully used (destroy opponent's iron access). Easy to break game balance.

## Recommendation

**Flavor 1 — Block / Claim** as the v1 implementation, exactly as Sam described:
- Each player gets `terrainBlocksPerGame: number` blocks (default 2 when enabled).
- A blocked tile cannot be built upon by anyone (truly neutral, not blocker-only).
- Blocked tiles must be non-iron, on-board hexes.
- Blocked tiles do NOT block sight lines (purely a placement restriction; visibility unchanged).
- The block action is one of the player's normal-round actions (consumes the round like building).

**Rationale:** Simplest mechanical addition, smallest engine change, easiest to revert if it doesn't add depth. Other flavors (2-5) stack on top later if v1 proves valuable.

## Adversarial review

**R1 (auto-strategy convergence):** does everyone block the same 2 tiles (the obvious chokepoints)? If so, no real decision space. **Mitigation:** the BEST blocks are board-and-iron-distribution-specific; each game's iron-CSP placement creates different obvious chokepoints. Variability comes from the board, not from the mechanic.

**R2 (degenerate blocking pattern):** could a player block the only path to their own iron, accidentally? `legalActions` should prevent: block actions can't be on a hex that's within placeRange of any of the blocker's bases (anti-self-foot-shot). Add as a legality check.

**R3 (does this address the engagement problem):** the static-action-space critique was about variant (c)'s 12-turn games being repetitive. Blocks happen at most 2x per game per player — they're rare, decisive moments, not turn-by-turn variety. They might add HEADLINE moments without adding MID-TURN variety. Net: positive but limited.

**R4 (interaction with alliances):** if alliances are enabled and ally A blocks for ally B's benefit, that's fine — adds depth. But there's no mechanical link between blocks and alliances; they're independent mechanics.

**R5 (player burden):** 2 blocks per game = 1 extra decision per game per player. Acceptable.

## Implementation footprint

- New `RuleConfig` flag: `terrainBlocksPerGame: number` (default 0 = off).
- New `Base`-like structure or `Board` extension to track blocked hexes — likely a new `state.blockedHexes: Set<string>` field (Set of canonical hex keys, GEO-4).
- New `Action`: `{ kind: "block-terrain", hex: Hex }`.
- `legalActions` extension: when `terrainBlocksPerGame > 0` AND the actor still has remaining blocks AND the hex is on-board, not iron, not within actor's placeRange (anti-self-foot-shot), not already blocked.
- Per-player `blocksRemaining: number` field on `Player` (init from config).
- `applyAction` for block: add hex to `blockedHexes`, decrement `blocksRemaining`.
- Build action legality (`isLegalBasePlacement`): exclude blocked hexes from valid placement targets.

Estimated work: ~2-3 hours. Similar to neutral bases.

## Out of scope for first iteration

- Multi-purpose terrain types ("rubble" / "forest" / "highway" with different effects). Just simple block.
- Sight-line blocking by terrain — keep terrain purely a placement restriction in v1.
- Terrain that affects combat (e.g., +1 defense on a "fortified" hex).
- Time-decay of terrain (blocks lasting for N turns then expiring).

## Open questions for Sam

1. Default count (2 blocks per player per game)?
2. Should blocks block sight lines too? My recommendation: NO for v1 (purely placement; simpler).
3. Should blocks have a strategic reveal mechanic (placed face-down, revealed mid-game)? My recommendation: NO for v1 (no hidden information).
4. Sequence: alliances first (per the queue), then this — or could this come BEFORE alliances since it's smaller?
