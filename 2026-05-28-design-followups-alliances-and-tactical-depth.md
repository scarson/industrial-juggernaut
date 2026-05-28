# Design Follow-ups — Alliance Layer + Tactical Depth — Thought Exercise

**Date:** 2026-05-28 (overnight)
**Triggered by:** Sam's three follow-ups on the long-game-engagement exercise — (1) capture legal-action-space evolution, (2) implement alliance layer with anti-gang-up safeguards, (3) consider tactical RPS for troop types.
**Companion docs:** `2026-05-28-long-game-engagement-and-randomness.md` (the exercise these expand on); `2026-05-27-balance-rules-analysis.md` §0.1 (the live design crossroads); `2026-05-28-rules-variants-synthesis.md` (variant (c) recommendation).
**Status:** Thinking artifact. #1 has small in-flight code (profile script ready to run); #2 and #3 are SPECS for Sam — not implemented, not adopted, not even greenlit for implementation. The point is to think them through with the same discipline as the rules-variants experiment so Sam can decide directionally.

## Why three separate but related discussions

The three follow-ups are interlocked:
- **#1 (legal-action profile)** is *measurement infrastructure* that informs both #2 and #3. Without it, "this added depth" or "this didn't" is unverifiable speculation.
- **#2 (alliances)** unlocks the 3P+ negotiation layer the sim cannot currently model — addresses the "is the late game engaging?" question for multiplayer.
- **#3 (tactical RPS)** expands the action space — addresses the "narrow action space → dominant strategy convergence" critique that variant tuning alone cannot fix.

Sam noted the slippery slope on #3 (complexity without depth) and the auto-gg risk on #2. Both are real, and each spec centers its respective failure mode.

---

## #1 — Legal-action-space capture (in flight)

**Status:** Profile script committed (`src/sweep/profile-turn-complexity.ts`). Logs `legalActions(state).length`, per-action elapsed ms, and per-player bases/factories/iron across all rounds of a played-out game. Will run after the wider-grid validation finishes (CPU contention). Three scenarios: variant-(c) 2P all-MCTS, variant-(c) 2P MCTS-vs-heuristic, baseline 2P all-MCTS.

**Systematization plan (Sam's "definitely start capturing"):**
- The profile script is a *one-off* tool today. To make it standard, I'd extract a `playInstrumentedGame()` helper into a shared module (or expose it from the existing driver as an optional callback), then have variant-comparison and revalidation runs *optionally* emit per-round summaries to a sidecar JSON file. Lightweight, doesn't change default behavior.
- The data it produces should anchor every future "is X turn count reasonable" claim. The thought exercise made this claim without data; never again.
- **Open question:** do we also want per-decision breakdowns (build vs attack vs pass) to understand which axis is growing/shrinking? Easy to add. Recommended.

**Concrete deliverable:** I'll run the profile after the wider-grid finishes, paste the results into the long-game-engagement doc as a new "Measured" section, and commit. If the data is striking, I'll lift the helper into a shared module so it's not a one-off.

---

## #2 — Alliance layer

### Why this matters more than I initially weighted
The long-game-engagement exercise treated the alliance layer as "the unmodeled depth." Sam is sharper: **without alliances, the simulator is fundamentally misrepresenting the multiplayer game**. The sim's claim that variant (c) "fixes" the 2-3P collapse is conditional on a model that's missing the central multiplayer mechanic. A 4P MCTS game without alliance modeling is a *worse* approximation of real play than a 2P game (more players, more missing dynamics). So the design recommendations from the sim are most reliable in 2P and degrade as player count rises.

### What's already in the engine
- `Player.alliance: PlayerId[]` field exists.
- `coalitions()` (`status.ts`) groups non-eliminated players into coalitions by undirected alliance membership.
- `coalitionIron()` and `coalitionVictoryIron()` already union iron across coalition members (with the variant-(a) flag respecting perimeter regime per member).
- `status()` already declares coalition victory when ANY coalition's iron meets the threshold.

**So a *strong* alliance — mechanically shared iron and shared victory — is largely supported already.** What's missing is the declaration/breaking mechanic and the action types.

### Five mechanic options for declaring alliances

1. **Permanent on declaration** — once allied, allied for life. Simple, but eliminates the betrayal mechanic and probably auto-gg's the third player in 3P (two players ally turn 1, never break).
2. **Per-turn re-affirmation** — alliance must be re-declared each turn; defaulting to broken. Cheap to break, encourages dynamic coalitions. *Risk:* table-talk and back-room deals every turn, slowing play.
3. **Token cost to enter, token cost to break** — alliance = a real commitment (e.g., spend a base to declare), breaking gives the opponent free resources. Adds strategic weight to alliance decisions.
4. **Bilateral declaration only when one player is "weakest"** — alliances can only form when the smaller party is in a losing position (an explicit balance-of-power rule). Anti-gang-up by construction.
5. **Hidden alliance assignments** — each player gets a secret alliance partner card at setup; they share victory but don't know who their partner is. Used in *Dune*. Eliminates the gang-up dynamic by removing trust. Best for fixed player counts.

### Five anti-gang-up safeguards (orthogonal to mechanic choice)

1. **Outnumbered combat bonus** — a player attacked by N opponents in one round gets a +X defense bonus; scales with N. Mechanical anti-ganging.
2. **Iron yield bonus for the smallest player** — if you have the least iron, your perimeter generates extra iron per turn. Catch-up mechanic.
3. **Anti-coalition victory threshold** — coalitions need a *higher* victory threshold than singletons (e.g., singleton wins at 10 iron, 2-coalition at 14, 3-coalition at 18). Penalizes large coalitions structurally.
4. **Mandatory alliance-break on victory approach** — when ANY coalition member reaches X% of threshold, alliance breaks automatically. Prevents two players cruising to a shared win.
5. **Secret victory thresholds** — each player has a private threshold (e.g., randomized in [8, 12]); allies can't trust each other because they don't know each other's win condition. Borrows from #5 above but for thresholds instead of partners.

### Recommendation: a minimal viable spec

For a first implementation that lets us *measure* the alliance dynamic without committing to a heavy mechanism:

- **Mechanic: option 3 (token cost, with cost = 1 base into the discard).** Concrete commitment, can be broken anytime (no cost to break, but you've already lost a base). Asymmetric: enter is costly, exit is free. Avoids permanent commitment trap (option 1) and avoids per-turn slowdown (option 2).
- **Safeguard: option 3 (anti-coalition victory threshold).** Most structurally elegant — the bigger you ally, the harder you have to work, mechanically symmetric. Easy to implement (`coalitionIron >= threshold + (coalition.size - 1) * delta`). Doesn't require new state or AI complexity.
- **Out of scope for first version:** secret information (option 4/5 from mechanics; #5 from safeguards) — adds asymmetric-information complexity that requires major engine changes (private state, partial-observability). Worth considering later.

### Implementation footprint sketch

- New `Action`: `{ kind: "ally", target: PlayerId }` and `{ kind: "break-alliance", target: PlayerId }`. Available as alternatives to build/attack/pass.
- New `RuleConfig` flags: `alliancesEnabled: boolean` (default false), `allianceVictoryDelta: number` (default 4 — each additional coalition member adds 4 to the threshold needed to win).
- `legalActions` extended to surface ally/break-alliance actions when `alliancesEnabled`.
- `applyAction` for ally: discard one of the actor's bases, add `target.id` to actor's alliance and actor's id to target's alliance (mutual). For break-alliance: remove the mutual references.
- `status()` victory check: `requiredThreshold = victoryThreshold + (coalitionSize - 1) * allianceVictoryDelta`.

### NPC alliance for 2P (Sam's suggestion)

An NPC third party in 2P that occasionally aids the weaker side could simulate the 3P "third player" pressure that real games have. Implementation options:
- **Phantom player:** add a third "AI" player that occasionally builds bases / attacks the leader. Highly invasive.
- **Periodic events:** every N turns, a "neutral attack" hits the player with the most iron. Less invasive, captures the spirit.
- **Skip:** stay focused on real 2P balance; multiplayer can be its own track.

I'd recommend SKIP for the first iteration — adding a "fake third player" to test the alliance dynamic in 2P is more confusing than informative. Better to just test alliances in 3P+ directly.

### Adversarial review

**R1 — Are we overestimating how much alliance changes the game?** Possibly. If alliances are mechanically just "iron sharing + shared victory," the strategic effect might be just "find your ally, race to enclose iron together." The interesting dynamic is *betrayal*, which our minimal spec barely supports (break-alliance is costless mechanically, only the lost-base cost). Worth probing: does any rational MCTS player ever ally in token-cost-3 mode? If no — alliances are a dead mechanic in the sim. (Note: MCTS won't model the human-level utility of allies; this is a known sim limitation.)

**R2 — The anti-coalition threshold may break 2P balance.** If singletons need 10 iron and 2-coalitions need 14, then in 2P the threshold is *always* 10 (no coalitions possible). Safe. In 3P, if all three ally, they need 18 iron — but they're playing 3-way; harder than 1v1v1. Probably works as intended. In 6P with full 6-ally coalition, they need 30 iron — likely unreachable. So full-table coalitions are structurally disincentivized, which is the goal.

**R3 — The "implement and measure" loop is harder for alliances than for variant tuning.** Variant (c) showed a measurable mechanical effect (median turns, iron-vic fraction). Alliance effects are largely strategic, and our agents don't model alliances well — heuristic doesn't reason about coalitions at all; MCTS searches them shallowly. Sim-measuring "is the alliance mechanic engaging" is fundamentally limited. **The right way to validate alliances is playtest, not sweep.** The sim can verify mechanical correctness (alliances form, victory fires for coalition, threshold scales) but not strategic depth.

**R4 — Anti-gang-up safeguards may over-correct.** If a 2-vs-1 coalition is *too disadvantaged* (e.g., +4 threshold per ally is too steep), no one will ever ally because the math doesn't work. The delta needs tuning. Suggested initial value (delta=4) is a *guess* — the experiment should explore [2, 3, 4, 5].

**R5 — Why not the simpler option 1 (permanent alliance)?** Because it auto-gg's 3P: turn-1 alliance between 2 players locks in the third's loss. The whole reason this section exists is Sam's anti-ganging concern. Option 1 fails that test.

### Open questions for Sam (alliance layer)

- **Q-A1:** Is "iron sharing + shared victory" the right semantic for "alliance," or do you want lighter (non-aggression pact) or heavier (full territory sharing) flavors?
- **Q-A2:** Should breaking an alliance trigger a *fight* (combat between former allies), or just end the sharing relationship? Breaking-as-fight adds drama; breaking-as-shrug is simpler.
- **Q-A3:** Is the anti-coalition victory threshold the right *kind* of anti-gang-up, or do you prefer something more visceral (outnumbered combat bonus, weak-player iron yield)?
- **Q-A4:** For first-iteration scope, are flags-only (`alliancesEnabled`) acceptable, or do you want full UI/CLI representation of alliance declarations?

---

## #3 — Tactical depth via RPS troop types

### The concern Sam flagged
"Verify it actually adds tactical depth instead of there being such obvious local optima that everyone immediately converged on the optimal mix and it adds complexity without anything interesting." This is the textbook failure mode of half-baked RPS: nominal choice that collapses to one dominant strategy. The methodology must center on the falsification test, not the "it's tactical now!" assertion.

### What "troop types" even means in IJ
IJ has one piece type that matters: bases. Factories don't fight, they produce. So "troop types" really means **base types** with different combat/control/build properties. Five concrete dimensions of differentiation:

1. **Control radius** — short-range strong, long-range weak. (e.g. "Forge" radius 5, "Watchtower" radius 8 but lower combat.)
2. **Combat strength** — some bases attack stronger, some defend stronger. (Differential combat-table entries.)
3. **Build cost** — some bases cost 1 resource, some cost 3. Cost-quality tradeoff.
4. **Build constraints** — some bases can only be placed at specific locations (e.g., on iron hexes, near factories).
5. **Special abilities** — e.g., "Saboteur" can attack from distance, "Forge" doubles factory yield.

Different dimensions create different "RPS" structures:
- **Radius vs combat** — long-range weak vs short-range strong. Like infantry vs sniper.
- **Cheap vs expensive** — quantity vs quality.
- **General vs specialist** — versatile but mediocre vs narrow but strong.

### Five RPS proposals

1. **Heavy / Light / Mobile (classic RPS)** — Heavy beats Light in combat, Light beats Mobile (faster), Mobile beats Heavy (mobility). Mobile literally moves; major engine change.
2. **Forge / Watchtower / Outpost (radius + role)** — Forge: standard radius, generates factories. Watchtower: larger radius, no factory generation, +1 defense. Outpost: smaller radius, cheaper to build, no combat penalty. NO MOBILITY. Asymmetric roles, not literal RPS cycle. Recommended if we do this.
3. **Bunker / Garrison / Patrol (combat-focused)** — different combat strengths only. Bunker high-defense, Garrison balanced, Patrol high-attack. Doesn't add positional depth; only combat depth. Probably too narrow.
4. **Iron-Forge / Wood-Forge / Stone-Forge (resource-typed)** — three resource types, each generated by a different forge. Build actions need matching resources. Major engine change, breaks the "iron" unifying mechanic.
5. **No new types, just specialize existing rules** — instead of new types, add modifiers (e.g., "your first 3 bases are 'Founders' with +1 defense"). Adds nuance without proliferation. Lightest touch.

### Recommendation: proposal 2 or proposal 5

**Proposal 2 (Forge/Watchtower/Outpost) is the most likely to add depth without overcomplicating** — three asymmetric base types, no mobility, all decided at placement time. Engine cost: moderate (new base.type field, build/control logic branches on type). Player burden: 3 types is the maximum I'd consider; 4+ overcomplicates.

**Proposal 5 (specialization without new types) is the safest** — a "Founders" rule (first 3 bases are special) or "Frontier" rule (bases on the boundary are special) adds nuance without new types. Engine cost: tiny. Player burden: low. Probably the right *first* step before going to proposal 2.

### Verification methodology — the load-bearing part

To verify tactical depth (not just complexity), the sweep methodology must include:

1. **Multi-strategy convergence test:** run a sweep with each "pure mix" (all Forge, all Watchtower, all Outpost). If ANY pure mix dominates the other two and the *mixed* strategies in head-to-head, the type system is broken (one type is strictly best). Need: each pure mix loses to at least one other AND mixed strategies outperform pures.
2. **Context-dependence test:** the optimal mix should depend on the BOARD GEOMETRY (different boards favor different mixes). Run pure mixes on multiple board sizes/iron-densities; if the same mix wins everywhere, no contextual depth.
3. **Counter-strategy test:** if MCTS sees opponent committing to type T, it should adapt its own mix. If MCTS plays the same mix regardless of opponent, there's no responsive depth.
4. **Per-decision impact:** measure how often the *choice* of type changes the outcome — if 90% of games are decided by other factors (positioning, iron), the type system is window-dressing.

These four tests together form the falsification battery. Implementing the type system without running them is the failure mode Sam warned against.

### Implementation footprint sketch (proposal 2)

- New `RuleConfig` flag: `baseTypesEnabled: boolean` (default false).
- New `Base.type: "forge" | "watchtower" | "outpost"` field.
- `control()` branches on type for radius.
- Combat: per-type combat-table modifiers.
- Build actions: `{ kind: "build", pieces: [{ kind: "base", type: "forge" }, ...] }`. Existing action shape extended.
- Cost: outpost cheaper (e.g., 0.5 resources), watchtower more expensive (2 resources).

### Adversarial review

**R1 — Is RPS even the right framing?** Possibly not. The cleanest asymmetric-role designs (e.g., chess pieces) aren't RPS — each piece has unique abilities that combine. RPS implies a *cycle* of counters, which is hard to design well and feels gimmicky. Proposal 2 is *not* literally RPS; it's role-asymmetric. Calling it RPS is the wrong frame. Worth correcting Sam (gently): the design problem is "add asymmetric roles," not "build an RPS cycle."

**R2 — Convergence-to-local-optima is the real risk.** The verification methodology helps but isn't proof. If MCTS at 100-iter doesn't find the depth, it's either because there isn't depth OR because MCTS isn't strong enough. We can't tell from sim alone. Playtest is the ultimate validator.

**R3 — Burden on the player.** IJ is already a complex game (perimeters, sight lines, iron-CSP, factories). Adding 3 base types means 3x more decisions per build. The simplification carrots (cheaper outposts! defensive watchtowers!) need to be obviously compelling, or players just play Forge-everything.

**R4 — Spatial purity tradeoff.** IJ's appeal may be its clean spatial reasoning. Adding asymmetric types is a *direction change* — toward wargame, away from positional game. Worth confirming this is the genre Sam wants.

**R5 — Why not the simpler proposal 5?** Because it doesn't really add tactical depth — it adds *narrative texture* ("your founders are special"). The decision space is unchanged. If the goal is actual tactical RPS, proposal 5 is too light. If the goal is just to add flavor, it's perfect. Need clarity on which.

### Open questions for Sam (tactical depth)

- **Q-T1:** Is "asymmetric base types with different roles" the right framing (proposal 2), or do you really want a literal counter-cycle RPS (proposal 1)?
- **Q-T2:** Is adding to the action space the right axis, or would *time-varying state* (events, tech unlocks, terrain that changes) be better? The latter adds depth without per-decision complexity.
- **Q-T3:** Are you comfortable accepting that sim alone can't verify "depth" — that we'd need playtest after sim verification?
- **Q-T4:** Sequence: if Sam likes both #2 (alliances) and #3 (tactical depth), which is the *first* thing to spike? My recommendation: alliances first (smaller engine change, more strategic impact on the multiplayer case the sim worst-models).

---

## Cross-cutting issues for both #2 and #3

### Sim-trust vs playtest-validation
Both alliance dynamics and tactical depth degrade the sim's reliability as a balance-testing tool — alliances because the heuristic and MCTS don't model coalition reasoning; tactical depth because more action types stretch agent strategy further from the optimum. **The sim's role shifts from "this config is balanced" to "this config is mechanically consistent and unbalanced no worse than X."** Real balance verification moves to playtest.

This is fine — the sim should be a screen, not a stamp of approval. But it means we should be *more* skeptical of sim conclusions on #2/#3 changes than we have been on parameter tuning.

### Implementation discipline
Both proposals should follow the *same* TDD + flag-default-off + bit-for-bit-preservation discipline that variants (a)/(b)/(c) used:
- Add the flag to `RuleConfig` (default off).
- Engine behavior preserved when flag is off (regression-tested by existing 396 tests).
- New behavior under flag is its own TDD'd module.
- Comparison sweep validates engine correctness + measures aggregate effect.
- Playtest validates strategic depth.

### Risk to existing balance work
If we adopt variant (c) as default AND add alliances as default, we're stacking two design changes. Each adds variance to the balance picture. Recommended sequencing: adopt-validate-then-add. So:
1. Decide on (c) (or variant adoption) first.
2. Validate at deeper grid + playtest.
3. THEN add alliances as separate flag-driven addition.
4. Re-validate.
5. Repeat for tactical depth.

The temptation to "do them all at once" should be resisted — each change masks the others' effects.

---

## Action items I'd take next (autonomy-safe)

1. **Wait for wider-grid run to finish**, then run the profile script and append data to the long-game-engagement doc.
2. **Update the handoff** with these three follow-ups + the wider-grid result.
3. **NOT implement** alliances or tactical RPS — they need Sam's explicit greenlight on the open questions (Q-A1..A4, Q-T1..T4) above.
4. **If Sam greenlights** alliances or tactical depth in a future session, follow the implementation discipline above (TDD, default-off flag, bit-for-bit preservation, then sweep + playtest).

## Uncertainties and what I'd add with more time

- The sim's reliability boundary as alliance mechanics get added — at what point does sim verdict become unreliable? Hard to know without playtest cross-checks.
- Whether IJ's design philosophy welcomes asymmetric base types or treats spatial purity as a load-bearing feature.
- The actual playtest experience of variant (c) at the 12-turn length — without humans we're guessing.
- A "minimum-viable third design lever" that isn't alliances or RPS: time-varying iron deposits (iron decays / regenerates, revealed over time). This is a randomness/event mechanic that's lighter than alliances and lighter than RPS. Worth flagging if Sam wants a third direction.

## Things I almost missed

- The engine already has most of the alliance infrastructure (coalitions, coalitionIron, victory-by-coalition). The work is the declaration mechanic + safeguards, not the math.
- The verification battery for RPS depth (the four falsification tests) is more important than the RPS design itself. Without it, "we added types" is uninformative.
- Sequencing matters — stacking multiple design changes makes their individual effects unmeasurable. Adopt sequentially.
