# Balance Redesign — Design Spec (diagnose-then-fix)

_2026-07-02. Design pass for the iron-victory/elimination imbalance surfaced by the big300 MCTS re-run. Diagnosis evidence: `docs/sweeps/2026-07-02-balance-diagnosis/2026-07-02-elimination-decomposition.md` (the instrumented 19-game decomposition, probes, and the 2-round adversarial review record). Handoff context: `docs/handoffs/2026-07-02-balance-redesign-handoff.md`. Approved direction: Sam selected the diagnose-then-fix scoping (2026-07-02) and authorized the merge protocol in §8._

## 1. Problem statement (re-derived, replacing the handoff's)

The handoff framed the problem as "elimination outcompetes iron victory on big300 under strong play." The instrumented decomposition shows the measured phenomenon is narrower and different: **under reduced-budget MCTS, big300 games are zero-combat factory-clock death marches** — 79% of eliminations are `brokenPerimeterAt18Factories` deaths of radiating players who never chose to enter the perimeter regime, who die counting factories they largely didn't build, while nobody gets within reach of the 12-iron threshold. Neither intended strategy (iron race under contestation, or combat-driven elimination) was actually being played, so **iron-vs-elimination balance in Sam's intended sense has not yet been measured.**

Two prior framings are refuted for this regime (see the decomposition doc): the combat/bounty "snowball" (zero attacks; killBounty fired on 18/43 eliminations but the granted bases sat unused; token-return and combatTable never fired — untested, not disproven) and "iron is geometrically unreachable" (two legally-placeable radius-5 disks cover ≥12/16 iron on all 19 boards).

**Goal (unchanged, from Sam):** strategic diversity — both iron victory and elimination viable win paths under strong play; neither marginalized. The current health gate cannot express this goal: `minIronVictory: 0.5` is a one-sided pro-iron floor (a 100%-iron config passes perfectly), and 2P victoryType is structurally uninformative.

## 2. Design overview — three decision-gated phases

- **Phase 1 (this spec's implementation scope):** instrumentation + diversity metrics + gate machinery with provisional thresholds + the regime-persistence probe + a parallel cheap weak-agent config track. No engine rule changes.
- **Phase 2 (decision point with Sam):** re-baseline under the improved instrument; select levers against pre-stated triggers.
- **Phase 3 (separate spec/plan per selected lever):** targeted rule change(s) + config tuning, CRN-paired A/B validation, deliberate golden regeneration.

Rationale for the shape: the two load-bearing unknowns — (i) is the factory-clock regime a low-budget-search artifact? (ii) which factory sources drive the clock? — are exactly what Phase 1 measures, and every candidate rule change's justification depends on their answers. Committing rule changes first would tune rules around an unvalidated instrument (the round-1 scope review flagged the earlier five-workstream Phase 1 as inverted diagnose-then-fix; this version is the corrected, minimal form).

## 3. Phase 1a — diversity metrics and gate machinery

New `SweepMetrics` reporting (pure additions to `src/sweep/metrics.ts`, computed from `GameEntry`):

- Per-player-count victory-type breakdown (promoting the ad hoc `big300-run.ts` table into the metrics contract).
- `ironShareDecisive3P`: iron fraction of decisive games at 3+ players (the diversity-relevant denominator).
- `ironPressure`: for each elimination-won game, max over players/turn-boundaries of controlledIron ÷ victoryThreshold (from existing `GameResult.ironOverTime`); reported as mean + the fraction of elimination games where anyone reached 0.75×threshold. Measures whether iron exerts strategic pressure even when it doesn't win.
- Elimination-cause mix (requires Phase 1b).

Gate machinery (Sam's call 2026-07-02, leaning approve+gate; refined per this spec): implement a `diversityHealthThresholds()` variant alongside `defaultHealthThresholds()` — iron-share band `[0.25, 0.75]` on decisive 3P+ games, `ironPressure` floor (provisional 0.5), 2P excluded from victory-type gating — with **thresholds explicitly marked provisional; final numbers are a Phase-2 decision with re-baseline data.** Runs report both gates side by side. Note: gating-now does NOT save expensive runs (per-game data persists, so any gate can be re-applied retroactively; strong-agent runs are read manually) — the value is avoiding a second churn cycle and getting side-by-side verdicts from day one. The old gate is not loosened or removed (the balance-sweep plan's assertion-rigor rule); the new gate is a parallel, Sam-visible redefinition candidate.

## 4. Phase 1b — instrumentation (contract-safe)

- `GameResult` gains `eliminations: { player, cause, turn, bountyTo }[]` — the driver currently discards the `eliminated` events `stepRound` already emits. `GameResult` is not part of the serialized `SessionRecord`, so no client-contract impact; engine behavior untouched, so `control-parity` and `mcts-determinism` goldens stay green.
- Persisted shard lines (`big300-merge.ts` `ShardLine`) gain per-player `maxIron` and the elimination list (small; full `ironOverTime` stays dropped for size).
- **Three-way factory-source split** (sweep-side diagnostic): for each player-round, decompose controlled factories into own-built / live-opponents' / dead-players' orphans. This resolves the 20/34 clock deaths whose factory attribution the decomposition could not discriminate. (Two-way own/others is insufficient — round-2 finding.)
- TDD applies throughout (production `src/` code).

## 5. Phase 1c — regime-persistence probe (the linchpin)

**Question:** is the factory-clock death march robust to search budget, or an artifact of iters=30?

**Protocol:** on the sparse board-150 class (16 iron, vt 12 — reproduces the clock regime at ~5.5 min/game at iters=30; dense default-class boards do NOT exhibit the regime and cannot test this):
1. Screen 12–15 CRN seeds at iters=30 (~1.5 h) → identify clock-regime games (expect ~half).
2. CRN-paired iteration ladder on all clock games (expected n≈6–10): 30 → 100 → **300** (= production sweep-agent strength, `defaultMctsParams()`; `defaultMctsCoreParams()`'s 1000 is unused by gameplay paths). maxDepth held fixed.
3. One maxDepth rung (depth 16 at iters=100) on the same games — the horizon axis is otherwise unhedged at every budget.

**Cost:** ~45–90 min/game at iters=300 → the full ladder is one to two overnights on the dev machine. Feasible one-off; not "cheap" — stated per the round-2 costing correction.

**Power honesty (Sam's question, answered):** (a) *General/directional signal:* if all n≈8–10 clock games persist unchanged at 300, the 95% upper bound on the flip rate is ≈3/n ≈ 30–38% (rule of three) — combined with the move-level evidence (at iters=100, zero of ~70 CRN-paired decision points flipped across two games; each rung's first iterations are shared by construction, so this is a paired dose-response), that is decision-grade for "not a 30-iteration artifact." Any game that flips is directly and individually informative about what stronger search does instead. (b) *Actual statistical power:* distinguishing persist-rate 0.9 from 0.5 at 80% power needs n≈12–14; a ±0.15 CI on the persist rate needs n≈40 (~40 machine-hours — out of budget). We take (a) and say so, per the handoff's reduced-budget/directional validation doctrine. Early result already in hand: **iters=100 = move-for-move identical to iters=30 on both probed games; the iters=300 rung was running at spec-writing time** — result to be appended to the decomposition doc.

**Decision rule:** regime persists at 300 → the factory clock is agent-robust at production strength; the clock-counting rule change becomes the lead Phase-3 candidate (with the 1b source-split naming the fix shape). Regime dissolves → re-derive the target from what the stronger baseline shows before any rule surgery.

## 6. Phase 1d — parallel cheap track (weak agent)

`placeRange` sweep (a pure config value never swept in ANY run) plus vt/ironCount density-axis refinement, through the existing harness with the new metrics. Zero MCTS cost; runnable immediately. **Evidence tier explicitly labeled:** characterizes the uncontested-race regime (weak agent), directional input to Phase 2 only — the two-regime finding says weak-agent results don't transfer to strong play.

## 7. Phase 2 — re-baseline and decision point

Re-baseline set: big300 + **the board-96 shipping default** (no rule change may regress it; big300 is a sweep near-miss coordinate, not a designed game mode) + 1–2 sparse neighbors, under the improved instrument, at the budget Phase 1c validates. Then a decision session with Sam. Pre-stated lever triggers:

| Lever | Class | Trigger |
|---|---|---|
| Factory-clock counting rule (own-built / exclusively-controlled) or threshold | Engine rule | Clock deaths persist at production budget AND 1b source-split confirms not-own-built dominance |
| Board-gen iron-reachability constraint / iron-aware seating | Board-gen rule | Sparse geometries remain design targets (defect is 0% on default board) |
| vt/ironCount ratio, placeRange | Config values | Informed by 1d + strong-agent spot-checks |
| Agent search/eval/aggression-archetype work | Agent (measurement-enabling only) | Needed to express a strategy under test; **explicit stopping rule: agent work is a means to measurement, never a deliverable of this effort** |
| Health-gate final thresholds | Sweep semantics | Phase-2 decision with data (per §3) |
| Bounty / token-return / combatTable[6] | Engine rule | Deferred unless a combat-expressing baseline shows combat matters |

**Statistics doctrine for Phase 2:** iron-share band decisions at n≈40/config carry ±0.15 — screens large violations only; `ironPressure` means are decidable at n≈13–19 elimination games (±0.11–0.14); per-player-count victoryType gates are diagnostic-only at feasible n. State CIs with every verdict; no gate-pass claims beyond what n supports.

## 8. Mechanics, contracts, and merge protocol

- Branch off `origin/dev`, PR to `dev` (git-strategy docs are stale on main-language; follow the handoff).
- No serialized-contract shape changes (`SessionRecord`/`LogEntry` untouched by Phase 1; any future additive RuleConfig field is a flagged judgment call for Sam). No `src/index.ts` barrel changes expected; if any, use the `## Barrel additions` PR heading (client-track coordination).
- Goldens: Phase 1 touches no engine behavior → parity/determinism goldens stay green (any red golden in Phase 1 is a bug, not a deliberate change). Phase 3 rule changes make them red **by design**; regeneration is deliberate and justified in the PR.
- **Merge protocol (Sam, 2026-07-02):** PRs in this effort may auto-merge after a **blind Fable-subagent adversarial PR review** — a fresh reviewer with no access to this session's framing, seeing only the diff/PR/repo, checking correctness, contract/golden implications, and unintended behavior changes. Substantive concerns → fix or escalate to Sam. Review outcome recorded in the PR thread. Anything alarming still escalates (Rule #1 unaffected).

## 9. Testing

- Phase 1 instrumentation: TDD (failing test first) for the `GameResult.eliminations` capture (drive a scripted game with a known elimination; assert cause/turn/bountyTo), the metrics additions (fixture `GameEntry[]` → expected metrics), the gate variant (threshold-boundary cases), and the ShardLine round-trip (parallel == sequential invariant must keep holding — extend the existing run-test).
- Probe scripts (1c/1d) are analysis scripts, not production code — excluded from TDD scope, but their outputs land in `docs/sweeps/` with methods documented.

---

## Appendix — reasoning record (per the thinking-documentation discipline)

**Why this design and not the prior session's approaches.** Approaches A (defuse snowball: token-return + softened bounty), B (iron-side threshold scaling), C (combined) all presuppose mechanisms the decomposition shows never fired (no combat, no captures, bounty inert) or mismeasure the goal (one-sided iron gate). They are not rejected as future levers — B's density axes live on in 1d/Phase 2 — but none can be justified before the instrument exists. The "config-only finds no healthy region" premise also only holds for weak play; strong-play config space is unexplored (round-1 confirmed the re-run tested exactly one config).

**Considered and ruled out (for Phase 1):**
- *Fix the agent first (relax the −1e6 iron-drop prune):* retracted — probes showed the prune does not cause the tiny-footprint behavior (policy proposes bases; the search overrides). Agent work is now trigger-gated with a stopping rule to avoid the "fix the agent forever" regress.
- *Fix the two "obvious" rule degeneracies immediately (setup lottery, factory-clock counting):* rejected as Phase-1 scope — the lottery is sparse-geometry-specific (0% on the default board) and the clock's dominance is budget-suspect until 1c reports; both remain top Phase-2/3 candidates with explicit triggers.
- *Full health-gate replacement in Phase 1:* softened to parallel gate machinery with provisional thresholds — gating-now saves no expensive runs (retroactive re-gating is free on persisted data), but machinery-now avoids churn. Final numbers need re-baseline data to calibrate against.
- *Mixed-archetype (Tier-2) matchup matrices in Phase 1:* deferred — requires an aggression archetype that doesn't exist (`HeuristicWeights` has no denial feature; `heuristicAgent`'s weights param is dead code), i.e., agent work that is trigger-gated.

**Retracted claims (kept visible so they aren't re-derived):** the prune-suppression mechanism; the orphan-factory "death cascade" as dominant (replaced by the three-way attribution); the +12-windfall advantage; "iron needs near-total territory" (my own initial geometric intuition — measurement reversed it); "all clock victims were iron-starved" (a reviewer claim — refuted; victims held 4–11 iron).

**What I'm still uncertain about:** whether the clock regime survives iters=300 (probe running at spec time); live-vs-orphan attribution for ~20/34 clock deaths (1b resolves); whether maxDepth independently reshapes the regime (1c rung); anything about play stronger than production budget (out of reach; all claims stay directional); whether Sam wants big300-class sparse boards as a real game mode at all (a Phase-2 design question that changes the setup-lottery lever's priority).

**What I'd add with more time:** a cheaper strong-ish proxy agent (the handoff's suggestion) — an elimination/denial-aware heuristic would enable full sweeps under contestation; deliberately kept out of Phase 1 as agent-work-regress risk, reconsidered at Phase 2 if 1c shows budget-sensitivity.

**Review provenance:** 2-round adversarial review (7 reviewers: 5 Opus lenses, 2 Sonnet fact-checks), 31 findings, 29 accepted, 1 rejected-with-evidence, 1 upheld-rejection independently verified. Full record in the decomposition doc's review section; per-round findings preserved in the session transcript.
