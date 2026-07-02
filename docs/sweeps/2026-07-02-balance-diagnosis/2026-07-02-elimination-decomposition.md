# big300 elimination decomposition — what "elimination dominance" under strong play actually is

_Generated 2026-07-02 (balance-redesign design pass). Survived a 2-round, 7-reviewer adversarial review; the review record and retracted claims are documented at the bottom — read them before extending the causal conclusions. Data in `./data/`._

## Why this exists

The big300 MCTS re-run (`docs/sweeps/mcts-big300/2026-06-30-big300-mcts-rerun.md`) found `ironVictoryFraction ≈ 0.32` (13 last-standing vs 6 iron, n=19) and framed the redesign target as "elimination outcompetes iron victory under strong play". But the persisted data recorded only victory *types* — not how eliminations happened, how close anyone got to the iron threshold, or whether combat occurred. This decomposition reproduced all 19 games byte-exact from the CRN seeds (`gameSeed(1n, gameIndex)`, fresh `mctsAgent({...defaultMctsParams(), iterations: 30})` per seat, turnCap 15 — identical to `src/sweep/big300-shard.ts`) with an instrumented copy of the `runGame` loop capturing elimination events, per-round per-player iron/base/hand trajectories, and action labels. Reproduction fidelity: **19/19 games match the recorded victoryType, turns, and winners.**

## Headline results

| | Count | Detail |
|---|---|---|
| **Combat events** | **0** | Zero attacks across all 19 games. Action mix: 265 factory builds, 92 base builds, 9 passes. |
| **Eliminations** | 43 | `brokenPerimeterAt18Factories` **34 (79%)** · `noIron` 5 · `emptyPerimeter` 4 · `noBases` **0** |
| Turn-≤1 deaths | 7 | All on boards that seeded a player whose iron-blind outer-ring seat controlled zero iron |
| Perimeter regime | 3 of 73 players | Max-bases distribution: 1×19, 2×26, 3×25, 4×2, 7×1 |
| Iron threshold reached in the 13 elimination games | **0** | Best-anyone mean 8.1/12; the iron leaders in g4 (10/12) and g14 (11/12) died of the factory clock |
| The 6 iron wins | 12–13 iron, turns 2–4 (one t=7) | Fast radiating races from iron-rich seats |

**The measured big300 "elimination dominance" is a zero-combat factory-clock death march.** Players sit at 1–3 bases (radiating), must act every round (`allowPass: false`), build factories for build budget, and are eliminated when they cross ≥8 *controlled* factories while under 4 bases (`brokenPerimeterDeathAtFactories`). "Last-standing" mostly means *last to trip the clock*: in g4 the winner had the least iron progress (4/12) while the iron leader (10/12) died of the clock on the final turn.

Key measured properties of the clock deaths:

- **Victims died mid-iron-accumulation, not iron-starved:** at their last-alive snapshot the 34 clock victims held 4–11 controlled iron (mode 4–7, mean 6.3). (This range is not a snapshot-timing artifact: every death-triggering action was a factory build by a <4-base actor, so no opponent perimeter existed and no DER-#17 subtraction could collapse the victim's iron between snapshot and death check.)
- **The clock's count is substantially not the victim's own building:** 25/34 victims had built fewer than 8 factories themselves. Radiating control counts any factory in one's disks with no owner filter (`control()`; DER #17 subtracts only inside opponents' *perimeters*, which almost nobody forms). Attribution of the excess is three-way: live-opponent overlap counting is the only possible source in 5/34 and necessary in ~10/34; for ~20/34 it is entangled between live-opponents' factories and dead players' orphans (this data cannot discriminate — the Phase-1 instrument's three-way source split will); 9/34 built ≥8 themselves.
- 21/34 clock deaths awarded no bounty. **killBounty fired on 18/43 eliminations overall but was strategically inert:** granted bases sat unused (iron accumulation is build-budget-gated, not hand-gated; last-standing winners ended with 5–34 unused bases in hand).
- **Refuted hypothesis — "label substitution":** last-standing wins were not near-miss iron strategies relabeled by the per-action elimination check; nobody was near 12 in any elimination game.

## What this refutes and what it defers

- **Refuted for this regime:** the "snowball" framing (bounty funds attacks; permanent base loss compounds). There were no attacks, no captures, no destroyed bases; the token-return/base-economy lever (fidelity-audit addendum) and `combatTable` never fired. **These levers are untested here, not disproven** — deferred pending a baseline in which combat actually occurs.
- **Refuted:** "iron victory demands near-total territory." On all 19 boards, a pair of legally-placeable radius-5 disks covers ≥12 of 16 iron (mean 14.3) — iron is radiating-reachable with 2–3 bases (13 of 38 weak-agent iron wins were 3-base radiating wins). The unconstrained minimal hull over 12 iron covers 14.6–27.8% of the board (mean 20.3%) — a lower bound not validated against placement legality.
- **Structural (agent-independent) facts that survive:** combat cannot deliver the final elimination blow (a lone base is unattackable — attacks need a distinct fresh same-owner defender; the coup de grâce is always starvation or a clock); the clock counts factories the victim didn't build; the setup lottery (below); `autoWinAt6` is outcome-inert under the default `combatTable[6]=1` (`nextFloat ∈ [0,1)` so a 6-commit always wins; the real lever is `combatTable[6] < 1`) but flipping the flag shifts the PRNG stream and breaks CRN comparability.

## Setup lottery (sparse-geometry-specific)

First-base seating is evenly-spaced outer-ring and iron-blind (`representativeFirstBase`); iron is CSP-placed at depth ≥2. On big300, ~8.8% of outer-ring hexes have zero iron within radius 5; **7 of the 19 boards seeded a 0-iron seat** whose only legal action is pass (budget 0; bootstrap requires ≥1 iron) — these map exactly to the 7 turn-≤1 deaths. `setupDecidedFraction` counts only setup iron *victory*, so setup *death* is invisible to the health gate. **Scope: the default 96-hex config has 0% dead outer-ring hexes (0/640 over 20 boards)** — this is a sparse-geometry board-gen artifact, not a universal rules defect.

## Regime scope and budget-sensitivity (probes)

- **Dense boards do not exhibit the clock regime:** board-96-class games end turn-1 by iron with zero eliminations. The regime requires sparse geometry (games surviving past ~turn 5).
- **Sparse board-150 (16 iron, vt 12) reproduces the regime** (clock cascades, zero combat, leaders stalling at 10–11/12) at ~5.5 min/game at iters=30 — the affordable testbed for dose-response.
- **Iteration dose-response (CRN-paired, same boards):** at **iters=100**, both probed clock-regime games were **move-for-move identical** to iters=30 (every elimination, turn, and iron value unchanged) while genuinely running the larger search (2–4× wall time; the agent advances game RNG by exactly one step per move regardless of budget, so identical trajectories mean the most-visited action never flipped at any of ~70 decision points). iters=300 (production sweep-agent strength — `defaultMctsParams()` uses 300; `defaultMctsCoreParams()`'s 1000 is not used by any gameplay path) run in progress at time of writing; results to be appended.
- **Unhedged axis:** `maxDepth = 8` player-actions (~1.3–2 turns of lookahead in 4–6P) is shared by every budget tested; multi-turn iron terminals are beyond the search horizon at all rungs. A maxDepth rung is part of the Phase-1 probe protocol.

## Evidence-quality register

n=19, one config, one budget. The 19/40 sample is informatively censored on duration (the early stop dropped long-running games), so **0.316 is an optimistic (upper-leaning) estimate of the true iron fraction** and capHit 0/19 carries the same optimism. Wilson CI for 6/19 = [0.15, 0.54] — the 0.50 gate failure is directional, not CI-decided. The aggregate is player-count-skewed: iron wins are structurally absent in 2P (killing the sole opponent always registers last-standing) — excluding 2P the fraction is 0.40 (6/15). Per-player-count buckets are anecdote-grade (n=3–5).

## Adversarial review record (2 rounds, 7 reviewers — summary)

**Round 1** (3× Opus lenses: causal-inference, statistics/generalization, design-scope; 1× Sonnet code fact-check — 24 findings, 22 accepted, 1 rejected with evidence):

- **Retracted (critical):** the claim that the −1e6 iron-drop penalty in `scoreMove` suppresses perimeter formation in MCTS candidate generation. Probes: `samplePolicy` proposed base-builds 200/200 at recorded 2-base states, greedy picks the base, `evaluate()` prefers the base — MCTS@30 still chose factories; the weak agent with the identical policy forms 6–29-base perimeters (median ~10). The tiny-footprint behavior comes from the reduced-budget search itself (~2–3 visits/root action; maxDepth-8 horizon; max^n backup), not candidate suppression. The prune bites only iron-dropping cliff placements (position-dependent; at one probed 3-base state all 35 legal 4th placements grew iron).
- **Replaced:** "dead players' orphaned factories cascade" → the victim-built-vs-controlled gap (25/34 built <8) with the three-way attribution above; first clock deaths occur before anyone has died. Adjacent-turn death clustering is equally consistent with synchronized independent clock-crossing.
- **Corrected:** +12 windfall causally inert; setup lottery scoped to sparse geometry; censoring direction (0.316 optimistic); 3→4-base control cliff (demo: a legal 4th base collapsing control 113 hexes/3 iron → 9/1) is real but position-dependent and **not on iron's critical path**; sundry numeric fixes.
- **Rejected with evidence:** "all 34 clock victims also had 0 iron at death (label-ordering artifact)" — the 0s were this instrumentation hard-zeroing eliminated players; last-alive snapshots show 4–11 iron. Round 2 independently verified the rejection (no DER-#17 path could collapse the victims' iron between snapshot and death check).

**Round 2** (2× fresh Opus lenses: overcorrection/consistency, decision-quality; 1× Sonnet fact-check — 7 findings, all accepted): "largely live-opponents' factories" overclaim → three-way quantified attribution; "killBounty never fired" contradiction → fired-18/43-but-inert; the probe protocol re-scoped from "cheap on affordable boards" (ill-posed — dense boards don't show the regime) to a costed iteration ladder on regime-exhibiting sparse boards; cheap config levers (placeRange — never swept in any run — and density axes) unblocked into a parallel weak-agent track; production agent strength corrected to 300 iterations; weak-agent perimeter range corrected to 6–29 bases.

## Data files (`./data/`)

- `big300-mcts-i30-decomposition.jsonl` — the 19 instrumented games (eliminations, combat counts, per-round iron/bases/hand, action labels, per-player capture/destroy counts, maxIron).
- `probe-b150sparse-i30.jsonl` / `probe-b150sparse-i100.jsonl` — sparse board-150 regime + dose-response probes.
- `weak-big300-vt{8,10,12,14}.json` — weak-agent threshold dose-response (40 CRN games each; vt=8 → 32/40 turn-≤1 wins; vt=14 → 5/40 turn-1 but 64 noIron eliminations + 3 cap-hits).
- `iron-hull-geometry.json` — per-board minimal 12-iron hull fractions and single/pair disk coverage.

Reproduction method: deterministic from `(baseSeed=1n, gameIndex)` per `src/sweep/run.ts` `gameSeed` + `runGameEntry`'s construction; the instrumented loop mirrors `src/driver/run.ts` `runGame` exactly (verified by the 19/19 fidelity match). The scratch scripts are superseded by the Phase-1 instrumentation planned in the design spec (`docs/superpowers/specs/2026-07-02-balance-redesign-design.md`).
