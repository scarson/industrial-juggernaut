# Pre-Playtest Preparation — Sam's 2-Week-Out Window

**Date:** 2026-05-28 (overnight).
**Purpose:** Look ahead at the playtest Sam said is ~2 weeks away. Identify what needs to exist (and not exist) for that playtest to be useful. Capture the questions the sim can't answer that the playtest must.
**Audience:** Sam, when planning the playtest window. Also the agent working in that window.

## What the sim can answer vs. what the playtest must

### Sim has settled (high confidence)
- The current default rules (variant (c) ON) terminate sensibly under both greedy and MCTS agents.
- Iron-victory and last-standing victory mixes per agent. ✅ Measured.
- Median turn counts per agent + variant. ✅ Measured.
- The mechanical correctness of alliance formation, anti-coalition threshold scaling, cooldown decrement. ✅ Tested.
- The mechanical correctness of every other engine path (combat, perimeters, sight lines, factory generation). ✅ 196+ tests.

### Sim cannot settle (load-bearing playtest questions)
1. **Is variant (c) at 12-turn play actually engaging for humans?** Or does denial warfare feel tedious after turn 6?
2. **Is the 2P case engaging without alliance dynamics?** 2P games are the simplest case; the sim can't measure "do humans enjoy this."
3. **Do alliances form organically under human play?** Sim agents don't reason about coalitions; humans might form alliances every game. Or none.
4. **Are alliance-break decisions dramatic / satisfying?** The 2/3-coin-flip-with-cooldown was a design choice; only humans can say if it feels right.
5. **What is the actual wall-clock per turn?** The legal-action profile gives us legalActions-count evolution; humans add the *thinking* time on top, which varies wildly.
6. **Are the new mechanics learnable?** Asymmetric base types, alliances, concession, terrain blocks — how many rules can a new player absorb in one game?
7. **Does the game feel "balanced" perceptually?** Sim measures health-gate metrics; humans measure "fun" / "winnable" / "I want to play again."

## Recommended playtest scenarios

### Scenario A — variant (c) only (the minimum viable playtest)
- Settings: `noIronRequiresPerimeter: true`. All other flags default.
- Player counts: 2P first (simplest); 3P second.
- Goal: validate variant (c) as the default. Does iron-denial warfare feel engaging? Do games end in a "good" time?

### Scenario B — variant (c) + alliances (the new mid-game)
- Settings: `noIronRequiresPerimeter: true`, `alliancesEnabled: true`, `allianceVictoryDelta: 4`.
- Player counts: 3P, 4P.
- Goal: validate alliance dynamics. Do players form alliances? Do they break them? Does the anti-coalition threshold feel right?

### Scenario C — variant (c) + tactical depth (asymmetric bases)
- Pending implementation of the tactical-depth plan.
- Goal: validate Forge/Watchtower/Outpost asymmetric types — adds depth or complexity?

### Scenario D — variant (c) + neutral 2P bases (2P-specific richness)
- Pending implementation.
- Goal: do neutral bases meaningfully change 2P games?

## What needs to exist before playtest

### Mandatory (without these, playtest is hard)
- **A way to play the game.** Either physical pieces (preferred?) or a CLI that allows two humans to take turns at the same terminal. Current code has no human-playable interface.
- **Variant (c) adopted in default OR documented as an opt-in setting.** A printed setup card with the rules-as-played.
- **A way to track state visually.** Hexes, bases, factories, controlled iron — humans need to see this. ASCII board print? Image render? Whiteboard with cube-coord hexes?
- **Per-turn turn-order draw** (the bag mechanic) — physical bag, or simulated by RNG. Current sim does it deterministically; physical play needs a real bag.

### Strong-to-have
- **Per-player action menus** (CLI prompts: "you can build / attack / pass / ally") — reduces rules-lookup time.
- **Iron count / threshold visible at all times** so players know how close they are.
- **Sample first-move guide** for new players — what's a good opener? Sim data could inform this.

### Nice-to-have
- A "tutorial mode" with simplified ruleset (e.g., 2P + no alliances + variant (c) only).
- A solver that suggests "best moves" (sim-derived) — for post-game analysis.

## What needs to NOT exist before playtest

### Things to NOT include in the playtest ruleset (avoid layer-stacking confusion)
- Tactical depth (asymmetric base types) unless Phase 7 sim data shows it adds depth.
- Terrain manipulation, unless we want to test it specifically (Scenario E or similar).
- Concession — interesting but not load-bearing for first playtest.
- The Opus-vs-MCTS proxy — playtest replaces it.

Less is more for first playtest. Tell the user the rules; let them play; observe.

## Questions to ask playtesters

1. **How long did the game feel?** (Even if wall-clock was 90 min, did it feel like 60 or 180?)
2. **When did the game's outcome become decided?** (Was there suspense to the end, or did one player know they'd won/lost by turn 6?)
3. **What did you do strategically that didn't work?** (Probes for "dominant strategy" — if everyone says the same thing, the strategy IS dominant.)
4. **Were the rules learnable in this one game?** (For variant (c) + alliances.)
5. **What's the worst moment of the game?** (Probes for un-fun decision points.)
6. **What's the best moment?** (Probes for "this is what makes the game work.")
7. **Would you play again?** (The single most predictive metric.)

## Logistical timeline

### T-2 weeks (now): preparation begins
- Adopt variant (c) as default (FINAL Sam call).
- Decide playtest scenario (recommend Scenario A or B for first round).
- Build the bare-minimum playability layer (CLI or print-and-play).

### T-1 week: dress rehearsal
- Sam plays a solo game vs Claude/Opus or self-play to verify the play loop works.
- Refine the rules card based on what was confusing.

### T-0 (playtest day): actual session
- 1-3 games depending on scenario complexity.
- Notes during play (don't trust memory). Post-game survey for the questions above.

### T+1 week: integrate findings
- The playtest data overrides sim data on engagement questions.
- Sim data still drives mechanical decisions (delta values, gate thresholds, etc.).
- Iterate.

## Open questions for Sam (on playtest setup)

- **Physical vs digital playtest?** Physical = real bag, real hexes, real time. Digital = CLI, easy to log. Which is the actual plan?
- **Solo / 2P / 3P+ for first session?** Recommend 2P for first (simplest, least-rules).
- **What's the success criterion for the playtest?** "Both players had fun" or "median 90 min wall-clock" or "iron victory was the dominant ending" or something else?
- **Who are the playtesters?** Strangers vs. friends-of-Sam significantly affects what we learn.
