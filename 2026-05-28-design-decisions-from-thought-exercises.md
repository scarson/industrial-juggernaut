# Design Decisions from the Overnight Thought Exercises

**Date:** 2026-05-28 (overnight)
**Source artifacts:** `2026-05-28-long-game-engagement-and-randomness.md` and `2026-05-28-design-followups-alliances-and-tactical-depth.md` — the two thought exercises that generated the open questions Sam answered in chat.
**Status:** AUTHORITATIVE record of Sam's directional decisions. When the chat transcript is gone, this is the canonical reference. Use this, not the open-questions sections of the source docs.

## Scope and play-feel

### Target play-time band: family-night to moderate-weight (60–120 min). 2–3-hour heavy-strategy is rejected.
Variant (c)'s 12-turn games are acceptable ONLY if they fit in that band wall-clock. The endgame doesn't yet have enough going on to justify a heavy time investment — interesting endgame ROI is itself a design problem, not a given. The profile-turn-complexity script measurement (in flight) will tell us where 12-turn variant-(c) games actually land on wall-clock.

### Concession mechanic is in scope, but asset handling is unresolved.
A concession mechanic shortens long games and respects player time. The open sub-question is what happens to a conceding player's iron, bases, and factories in 3–6P games:
- Become neutral / removed from play (clean but loses tactical value).
- Become spoils distributed somehow (e.g., to the player who pressured them most — like an enhanced kill-bounty).
- Become claimable territory (any player can move on it).
- Stay where they are but neutral / defending-only (continues to influence the board passively).
This is a design decision Sam hasn't made yet; I'll spec the alternatives.

### Randomness preference: system-style (mechanical-variance) over event-style, but cautiously.
Few turns means variance has little room to smooth out — a player who feels they "lost because the dice/bag turned" after a 2-hour investment won't want to play again. So:
- Yes: tighten or expand existing system randomness carefully (e.g., combat-table noise on 6-attacks, bag-of-tokens for resource yield).
- No: event-card decks that introduce big swings late.
- Maybe: hidden information at setup (objectives) — adds variability without swings, but bigger design lift.
- New idea Sam raised: semi-randomly-placed **neutral / NPC defending bases in 2P** — simulates the multiplayer "third pressure" without committing to NPC alliances. Defends only (no attacks). Placement rules to ensure they're not adjacent to player starting positions. Possibly symmetric. I'll spec this.

### Playtest unavailable for 2+ weeks; need a proxy.
Sam suggests Claude (Opus) playing against MCTS as a strategic-depth proxy. Real value: human-like strategic reasoning that current agents miss. Real cost: API call per move = ~24–30 calls per game, latency + dollar cost. Mark as a sized-up follow-up: a small spike (a few games) is feasible and informative; large sweeps are not. Worth doing after the in-flight work settles.

## Alliances (when greenlit for implementation)

### Strength: MEDIUM.
Iron sharing for victory + non-aggression. NOT light (non-aggression only — too weak to be a meaningful mechanic). NOT heavy (full territory sharing — too entangled). This is what the engine's coalitions / coalitionIron infrastructure already supports; the work is the declaration mechanic + breaking mechanic + safeguards.

### Anti-gang-up safeguard: anti-coalition victory threshold, TUNABLE.
The bigger your coalition, the higher the iron threshold needed to win. Each additional coalition member adds `allianceVictoryDelta` iron to the threshold. Sam wants this knob to be tunable (don't hard-code +4). Initial sweep should explore [2, 3, 4, 5] to find a sweet spot.

### Breaking an alliance: a coin-flip risky bet, with reentry constraint.
Two acceptable shapes for the break mechanic:
- **Neutral EV:** flip; on win, steal an iron from the betrayed player; on loss, lose an iron to them.
- **Positive EV with cooldown:** weighted roll (e.g., 1–2 fail / 3–6 succeed); but on a successful betrayal, the betraying player is locked out of new alliances for the next turn.
Both shapes try to avoid the "table-flipping drama" of repeated cheap betrayals while preserving betrayal as a real (sometimes-worth-it) tactical option. Sam left the exact mechanism open for me to think through — the design intent is "risky bet with consequences" not "free swap."

### Implementation scope: flags only, no UI.
There's no UI for anything in the project today. Flags + CLI is sufficient for the sim work. CLI may be useful if it makes test-harness scenarios easier to invoke; otherwise skip.

### NPC alliances in 2P: SKIP.
In favor of the neutral-defending-bases idea (see Scope section).

## Tactical depth (when greenlit for implementation)

### Asymmetric role types, NOT literal RPS cycles.
Three (or so) base types with different roles — e.g., Forge / Watchtower / Outpost — differentiated by control radius, build cost, and combat profile. Not a Heavy-beats-Light cycle. Engine cost: moderate (Base gains a `type` field; control/combat branch on type).

### Also in scope: mid-game events / board-terrain manipulation.
Sam raised this as a concrete example: "each player blocks a non-iron tile from future placement eligibility." Take broadly as **board-terrain manipulation generally**. Possible flavors:
- One-time-use "block" or "claim" actions per player per game.
- Event timer (every N turns, all players can place a block).
- Random terrain events (a tile becomes "rubble" — built bases lose function).
Spec these as a separate design lever from troop types; they may pair well or substitute.

### Verification methodology for "depth, not just complexity":
Sim + adversarial Opus review can do first-pass verification when informed by sim data. I'm explicitly authorized to instrument the sim however needed. The four falsification tests from the original spec stand:
1. Multi-strategy convergence test (each pure mix vs others; mixed strategies vs pures).
2. Context-dependence test (different mixes win in different board geometries).
3. Counter-strategy test (MCTS adapts mix in response to opponent's commitment).
4. Per-decision impact (how often the type choice changes the outcome).

## Sequencing

### Serial: variant (c) → validate → alliances → validate → tactical depth → validate.
Don't stack design changes. Each gets adopted, validated (sim + eventual playtest), and then the next layer goes on top. The temptation to "do them all at once" loses the ability to attribute effects.

## Variant (c) status

### Adopt (c) — but recalibrate gates for the (c) regime.
The 7-gate health was tuned against greedy self-play. Variant (c) deliberately widens the greedy-vs-MCTS gap (median 2 under greedy, median 12.5 under MCTS). The gate's `medianTurns ≥ 3` minimum was calibrated against greedy's distribution — applying it to (c) is the wrong instrument. Don't let it veto (c). The gates remain useful as a rough measure; just don't treat them as oracle.

**Implication:** I'll spec proposed new gate thresholds for the (c) regime (probably: relax medianTurns minimum since (c) deliberately produces short greedy games; consider tightening lead volatility upper bound since (c) gives high-volatility multi-turn games). This is a proposal for Sam, not a unilateral adoption.

### MCTS@300 stress test on (c) — run it.
To diagnose why MCTS-vs-heuristic h2h shows MCTS losing 0–6% under variants (a)/(c). Two hypotheses: heuristic is genuinely near-optimal on the (c) game, OR MCTS@100 is just too weak. MCTS@300 (3× search) on (c)'s best cell will tell us which.

## Stranded-radiating-player engine fix (my call)

### Decision: NO ENGINE CHANGE NEEDED — the engine already handles it.
Discovered while implementing: `legalActions` (`src/engine/legal.ts:118`) already emits a synthetic `pass` action when no build/attack actions are legal AND `allowPass` is otherwise false. A stranded radiating player (1 base, 0 iron, no perimeter, spared from `noIron` by the flag) has `buildBudget = 0` (no bootstrap without iron), no legal attacks (need ≥3 bases), so `legalActions` returns `[{kind: "pass"}]`. The agent picks pass, turn cleanly passes to the next player, game progresses.

**What the original MCTS-crash I observed actually was:** a *different* edge case — maxed-out player (`basesInHand = 0`) with build placements that `legalActions` considers legal but the heuristic's composition rejects, plus no attacks, plus `allowPass = false` so `legalActions` doesn't emit pass (other actions exist). My earlier `mostVisited` robustness fix (`src/agent/mcts-agent.ts`) handles this — it falls back to `legalActions[0]` when MCTS surfaces zero candidates.

Added a regression test (`test/engine/status.test.ts` — "variant (c) stranded radiating player passes through the existing legalActions pass fallback") locking the load-bearing engine behavior so a future refactor can't silently break it.

The original synthesis doc's framing of "stranded player → MCTS crash" conflated two distinct failure modes; this entry corrects the record.

## Cross-cutting

### Don't over-index on the 7-gate health as oracle.
The gates are semi-arbitrary, useful as a rough measure, but should not veto promising directions. Variant (c) is a case in point — it fails gates the original threshold-setting didn't anticipate, but it's solving the real problem (agent-relative collapse).

### Plain-English referents in chat.
Sam can't remember question codes (B2, etc.) on mobile and won't chase reference docs to look them up. I'll refer to things by what they ARE — "the coin-flip alliance-break", "the anti-coalition victory threshold", "the stranded-player engine fix" — not by code.

## What's actionable autonomously tonight (in priority order)

1. **Stranded-player engine fix** — TDD'd implicit-pass at `legalActions` level.
2. **Wait for wider-grid run** to finish (in flight).
3. **Run the legal-action-space profile** (already coded, queued).
4. **Run MCTS@300 stress test on (c)** — adapt the explore-c-variant script.
5. **Refine alliance spec** with the coin-flip-break mechanic and tunable anti-coalition delta.
6. **Spec the gate recalibration** with proposed numerical thresholds tuned for the (c) regime.
7. **Spec the new design ideas** (concession + asset handling, neutral defending bases in 2P, board-terrain manipulation events) at a level that's actionable when Sam greenlights them.
8. **Sketch the Opus-vs-MCTS proxy** sized as a sized-up follow-up (estimate per-game cost / latency, propose a minimal version).
9. **Update the handoff** comprehensively for Sam's morning.

Items 1–4 are concrete code work; 5–8 are doc work; 9 is the wrap-up.
