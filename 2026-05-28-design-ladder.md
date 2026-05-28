# Industrial Juggernaut — Design Ladder

**Date:** 2026-05-28 (overnight).
**Purpose:** One-page bird's-eye view of every design lever in play, ordered by sequencing intent. Read this to see where the project stands and what's stacked behind it. Companion to (not replacement for) the per-lever spec/plan docs.
**Maintenance:** update this when a lever ships, gets greenlit, or gets parked. Status flags mirror the per-plan banners.

## Status legend
- ✅ Shipped (engine implemented + tested; may not be default).
- 🚧 In-flight (currently being implemented or measured).
- ⏸ Ready (plan written, awaiting Sam's go).
- ⬜ Spec'd (design doc only; no plan yet).
- 🪑 Parked (idea on file; no spec yet).

## The ladder (top = adopted; bottom = furthest from adoption)

### 1. ✅ Variant (c) — `noIronRequiresPerimeter: true` — SHIPPED (engine), AWAITING `defaultConfig` flip
- **What:** Iron-denial elimination requires the victim to have a committed perimeter (≥4 non-colinear bases). Radiating players with 0 iron are NOT eliminated by `noIron`.
- **Why:** Tonight's comparison experiment showed this is the load-bearing fix for the MCTS-collapse problem. Iron-vic recovers from 0 → 25%; median turns 1 → 12.5.
- **Sam's call:** YES, adopt with **recalibrated gates** (✅ implemented as `mctsHealthThresholds()`).
- **Pending:** flip the flag in `defaultConfig()`. Final test-suite implications need a small audit (tests that encode the old behavior may need recalibration to the new norm — "correct, don't loosen").
- **Companion docs:** `2026-05-28-rules-variants-synthesis.md`, `docs/2026-05-28-gate-recalibration-for-c.md`.

### 2. ✅ MCTS@300 stress test on (c) — COMPLETE; heuristic is near-optimal
- **What:** Diagnosed whether the variant-(c) gate-2 failure (MCTS@100 lost h2h to heuristic) was search-depth or structural. 12 health games + 16 h2h at MCTS 300 iterations.
- **Result:** `docs/2026-05-28-mcts-300-on-c.md`. MCTS@300 vs heuristic h2h = **6.3% vs 93.8%** — IDENTICAL to MCTS@100 (Δ -0.0pp). All-MCTS@300 health: 16.7% iron-vic, median 12 turns.
- **Definitive verdict:** **the perimeter-aware heuristic is genuinely near-optimal on the (c) regime.** Adding search depth doesn't help. This is a STRUCTURAL finding, not a search-budget tuning question.
- **Implications:**
  - A6 gate-2 ("MCTS beats greedy ≥ 0.70") in its current form is the wrong instrument for the (c)-modified game. The heuristic is the strong agent.
  - The stronger-agent MCTS plan (`docs/plans/2026-05-27-stronger-agent-mcts-plan.md`) is now waiting on a Sam decision: re-anchor gate-2 to a weaker baseline / build alliance-aware policy / re-think gate-2 entirely. See plan's 2026-05-28 update.
  - Alliance dynamics (3+P) might still reveal an MCTS-vs-heuristic gap — the 2P h2h doesn't exercise the coalition-reasoning axis. Worth probing after the alliance Phase 7 sweep.

### 3. ⏸ Alliance layer — `alliancesEnabled` + `allianceVictoryDelta` — ENGINE SHIPPED (Phases 1-6), PHASE 7 SWEEP QUEUED
- **What:** Medium-strength alliances (iron sharing + non-aggression). `ally` action (basesInHand cost 1). `break-alliance` action (weighted 2/3 success, cooldown either way). Anti-coalition victory threshold scales by `allianceVictoryDelta` × `(coalitionSize − 1)`.
- **Status:** Phases 1-6 implemented + TDD'd (196 engine tests green). Phase 7 comparison sweep script ready (`src/sweep/compare-alliance-deltas.ts`); not launched (queued behind MCTS@300 to avoid concurrent heavy-compute).
- **Companion:** `docs/plans/2026-05-28-alliance-layer-plan.md`, `docs/2026-05-28-design-followups-alliances-and-tactical-depth.md`.

### 4. ⏸ Tactical depth — asymmetric base types (Forge/Watchtower/Outpost) — PLAN READY
- **What:** Three asymmetric base types differing in control radius, build cost, and combat profile. Forge generates factories (current default behavior); Watchtower has +1 defense and large radius; Outpost is cheap with small radius.
- **Status:** plan written (`docs/plans/2026-05-28-tactical-depth-asymmetric-bases-plan.md`). Awaits Sam's "implement now" greenlight per the serial adopt-validate-then-add discipline (after alliances are validated).
- **Risk:** Sam flagged the "complexity without depth" concern; the plan's Phase 7 includes a 4-test falsification battery (multi-strategy convergence / context-dependence / counter-strategy / per-decision impact).

### 5. ⏸ Neutral defending bases for 2P — PLAN READY
- **What:** 4 semi-randomly placed neutral defending bases in 2P games. No control, no attack initiation, block sight lines.
- **Status:** plan written (`docs/plans/2026-05-28-neutral-bases-2p-plan.md`).
- **Independence:** can ship in parallel with alliance + tactical depth; doesn't depend on them.
- **Motivation:** Sam's preferred alternative to NPC alliances in 2P. Injects positional uncertainty without adding strategic complexity.

### 6. ⏸ Board-terrain manipulation (Block) — PLAN READY
- **What:** Each player gets N blocks per game; blocking a non-iron, off-own-placeRange hex prevents anyone from placing a base there.
- **Status:** plan written (`docs/plans/2026-05-28-terrain-events-block-plan.md`).
- **Caveat:** Sam said "take that as 'board terrain manipulation, generally'" — this is the simplest flavor. Other flavors (decay/regen, hidden hexes, random events, scorched-earth) parked for later.

### 7. ⏸ Concession mechanic — PLAN READY
- **What:** Player can voluntarily concede on their turn. Bases removed; no kill bounty. Game ends if last-standing falls out.
- **Status:** plan written (`docs/plans/2026-05-28-concession-mechanic-plan.md`).
- **Open question:** loss-criterion gate (only legal when you have <X% of leader's iron)? Recommended: unconditional v1.

### 8. ⏸ Gate recalibration for MCTS regime — IMPLEMENTED but not USED by default
- **What:** `mctsHealthThresholds()` factory with relaxed numbers + `maxLeadVolatility` upper bound.
- **Status:** implemented and tested (`src/sweep/health.ts`). NOT used by default; sweep callers can opt in.
- **Use case:** any sweep that evaluates under MCTS should use this; the `defaultHealthThresholds()` stays for greedy evaluation.

### 9. 🪑 Opus-as-agent proxy — SIZED-UP SPEC
- **What:** Wrap Claude/Opus as an `Agent` via the Anthropic API; play it against MCTS as a strategic-depth proxy until human playtest is available.
- **Status:** sized spec only (`docs/2026-05-28-opus-vs-mcts-proxy-spec.md`). Estimated 1 day engineering + ~$10-30 pilot cost.
- **Sam's call:** worth a small pilot, not a full integration. No greenlight to start yet.

### 10. 🪑 Alliance-aware heuristic + MCTS policy — NO PLAN
- **What:** Current heuristic and MCTS don't reason strategically about ally/break-alliance actions. To make alliances strategically meaningful in sim, agents need coalition-aware scoring.
- **Status:** known limitation; documented in alliance plan's Phase 7 caveats.
- **Trigger:** if alliance comparison data (Phase 7) shows alliances are a dead mechanic, this is what to address.

### 11. 🪑 v2 alliance break-mechanic — neutral-EV-with-iron-transfer — NO PLAN
- **What:** Sam mentioned the coin-flip-with-iron-steal variant as an alternative. Currently only the weighted-with-cooldown variant is implemented.
- **Trigger:** if alliance sweep shows current break mechanic is too punishing or too lenient, this variant becomes interesting.

### 12. 🪑 Tactical-depth alternatives — RPS cycle (proposal 1), resource-typed (proposal 4) — RULED OUT
- **What:** Earlier brainstorm options from the spec, ruled out by Sam ("asymmetric role types, not RPS").
- **Status:** documented in spec; do not pursue without re-greenlight.

### 13. 🪑 Random/event-style randomness — NO SPEC YET
- **What:** Sam said "leans system-style, not event-style" for variance. Concrete options: combat-table noise expansion (`6: 0.95` instead of `1`), bag-of-tokens for resource yield, decay/regen of iron.
- **Status:** open design space; not specced or planned. Would compete for slot with other levers.
- **Triggered by:** if all the above levers don't restore strategic richness, this becomes the next direction.

### 14. 🪑 Learned (AlphaZero) agent — PLAN EXISTS but TRIPLE-GATED
- **What:** Self-play neural-network agent. Plan in `docs/plans/2026-05-27-learned-agent-alphazero-plan.md`.
- **Status:** ⏸ paused, double-gated behind balanced config + MCTS-trustworthiness gates. Now triple-gated since variant (c) needs adoption + validation first.

## Cross-cutting issues

- **Sim trust degrades with each design layer added.** Heuristic + MCTS were calibrated against the M1 engine; each new mechanic (alliances, types, terrain, concession) moves the agents further from optimum. Use the sim to verify mechanical correctness; rely on playtest for strategic-richness verification. This is reinforced after each ship.
- **Default-off discipline:** every new lever ships with a default-off flag. Existing 396-test suite must remain green after each commit. Adoption (flipping a default) is a separate, deliberate step.
- **Adopt-validate-then-add:** Sam's serial sequencing. Don't stack design changes; each gets adopted, validated, then the next layer goes on top. Stacking masks individual effects.

## What's *not* on the ladder

- Engine rewrites or major refactors.
- UI development (deferred until later; CLI-only for sim work).
- Multi-player matchmaking, networking, persistence — out of M1 scope entirely.
- The original setupDecided / radius-5 baseline — that's the *starting* state, not a design lever.
