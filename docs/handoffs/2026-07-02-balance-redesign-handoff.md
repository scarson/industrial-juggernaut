# Handoff — Balance Redesign (iron-victory / elimination imbalance): fresh start for the design pass

**Purpose.** Hand off the **start** of the balance-redesign design pass to a fresh session (a Claude Fable session, at Sam's request). The design work had barely begun in the prior session — two framing questions were answered, then paused. This doc gives you the problem, the evidence, the constraints, the current repo state, and the prior session's *exploratory* thinking.

> **READ THIS FIRST — the one rule that overrides the rest of this doc.** The prior session (Opus) did a lot of investigation and then started sketching a solution direction (a "snowball" diagnosis, a token-return lever, three approaches). **That sketch is INPUT TO CHALLENGE, not a route to execute.** Sam explicitly wants you to **step back and take your own big-picture look first** — re-derive the problem from the evidence and the mechanics yourself, question the framing, and consider levers/reframings the prior session may have missed — *before* you adopt or reject any of the prior thinking. If you find yourself opening the brainstorm by "continuing approach A," stop: that's the failure mode this handoff is written to prevent. Form your own diagnosis first, then reconcile with Sam's provisional direction (below) and the prior notes.

---

## 1. The problem to design against

On the large board (`big300` = `{ boardSize:300, radius:5, ironCount:16, victoryThreshold:12 }` over `defaultConfig()`) under **strong (MCTS) play**, the game resolves by **eliminating opponents**, not by the intended **iron-threshold victory**. Measured (n=19, reduced-budget MCTS): 13 wins by last-standing vs 6 by iron; `ironVictoryFraction ≈ 0.32` against a health-gate of 0.50. Under the weak heuristic agent this doesn't show — games end at turn 1 before combat/elimination dynamics fire — so the imbalance is a **strong-play** phenomenon.

This is the "re-aimed redesign target" that fell out of the balance-sweep effort: the game's *stalemate* failure (cap-hit) turned out to be fixed by strong play, but a *different* failure (elimination dominates iron-victory) took its place. The design question is how to make the game healthier here.

**Do not take the above framing as settled.** It's the prior session's characterization. Part of your big-picture pass is to decide whether "elimination dominates iron-victory on big boards under strong play" is even the right problem statement, or a symptom of something else (or whether the health criterion itself is miscalibrated).

## 2. Evidence base (read these; don't trust my summaries)

- **Balance-sweep report** — `docs/sweeps/2026-05-27-balance-report.md`. 0/176 configs healthy under the weak agent; the "two-regime" finding (small-board turn-1 loss is *intrinsic geometry*; large-board cap-hit is *agent-sensitive*).
- **big300 MCTS re-run** — `docs/sweeps/mcts-big300/2026-06-30-big300-mcts-rerun.md`. Cap-hit fixed by strong play (0/19); iron-victory now the binding failure (~0.32). Methodology deviations (iters=30, turnCap=15, n=19) documented there — full-strength MCTS was infeasible.
- **Base-economy lever** — `docs/plans/2026-06-13-fidelity-audit-findings.md`, the 2026-07-02 addendum. Defeated (non-eliminating) bases are permanently lost, never returned to hand — snowbally/anti-comeback. Sam logged it as a *design-lever candidate* for this redesign, with an A/B (credit-back vs current) as the eventual test, gated on MCTS perf. Includes measured base-economy tables.
- **Balance-sweep plan** — `docs/plans/2026-05-27-balance-sweep-harness-plan.md`. The harness (metrics → health gate → CRN runner → orchestrator → report) you'll reuse to measure any redesign. Its health thresholds (`defaultHealthThresholds()` in `src/sweep/health.ts`) are *starting values* — the iron-fraction one is exactly what Sam wants re-examined.
- **Project memory** (auto-loaded; `~/.claude/.../memory/`): `balance-sweep-two-regime-finding`, `mcts-perf-control-allocation-bound`, `base-economy-no-onboard-cap`. These carry the load-bearing findings in compressed form.

## 3. The mechanics you're redesigning (ground truth = the code)

Per this project's convention, **the engine code + its sim-validated tests are the source of truth, not the rules doc** (`industrial-juggernaut-rules-v10.md` is a stale starting point). Read the code:

- **Victory / terminal state** — `src/engine/status.ts`. Three win conditions: **iron victory** (a coalition controls ≥ `victoryThreshold` distinct iron hexes — checked *first*), **last-standing** (one coalition remains), and **auto-win-at-6-bases** (`autoWinAt6`). `control()` (`src/engine/control.ts`) computes controlled iron/factories/hexes (radiating disk-union < 4 bases; convex-hull interior at 4+).
- **Elimination** — `applyEliminations` in `status.ts`. Causes: `noBases`, `brokenPerimeterAt≥8-factories` (per-player, <4 bases), `noIron`; `emptyPerimeter` self-destruct. **Kill bounty**: `full`→+12 / `half`→+6 / `none`→0 bases to the killer's hand. Eliminated players' bases removed + hand zeroed.
- **Base economy** — `src/engine/apply.ts` (capture `baseReplaced`, destroy `baseDestroyed`) + `src/engine/stranded.ts` (encircled-stranded removal). Defeated non-eliminating bases leave the board but are **not** credited back to hand. See the fidelity-audit addendum for the exact invariant.
- **The config levers** — `src/engine/config.ts` `RuleConfig` / `defaultConfig()`: `radius`, `placeRange`, `attackRange`, `baseLimit`, `combatTable`, `autoWinAt6`, `killBounty`, `factorySupply`, `ironCount`, `boardSize`, `victoryThreshold`, `brokenPerimeterDeathAtFactories`, `allowPass`. Only the *numeric* subset is sweepable via `NumericRuleConfigKey` in `src/sweep/run.ts`.

## 4. Sam's provisional direction (from the prior brainstorm — honor as leanings, not orders)

Sam answered two framing questions before pausing. Treat these as Sam's stated preferences to reconcile with — you may propose reframing them if your big-picture pass warrants, but don't silently override them:

- **Goal = strategic diversity.** Both iron-victory AND elimination should be viable win paths under strong play; neither marginalized. The 0.50 `ironVictoryFraction` gate is therefore a *proxy to re-examine*, not a literal target.
- **Scope = targeted rule change(s) + config tuning.** Bounded engine-rule changes are on the table where they're the root cause (Sam had base-economy + bounty in mind), paired with config tuning — not open-ended multi-lever sprawl, and not config-only (the sweep already showed config-only finds no healthy region).
- **Approach = UNDECIDED.** Sam *dismissed* the approach-selection question. This is precisely where you take over — with your own analysis, not by picking from the prior session's menu.

## 5. Prior session's exploratory thinking — INPUT TO CHALLENGE

Presented so you don't have to re-derive from scratch, and so you can see (and stress-test) where a first pass landed. **None of this is decided. Challenge all of it.**

- **Diagnosis floated:** elimination-dominance is a *snowball* — kill bounty (+12) funds more attacks, and permanent base loss compounds early leads, so elimination becomes the reliable path; iron-threshold is hard on a big board because controlling the threshold demands near-total territory. *(Is "snowball" right? Is it the whole story? Could the iron *condition* itself — threshold-count of a spread resource on a large board — be the deeper issue? Is elimination-dominance actually unhealthy, or is the gate wrong?)*
- **Levers surfaced:** (1) base-economy token-return; (2) soften kill bounty; (3) lower/scale `victoryThreshold` or iron reachability; (4) `combatTable` decisiveness; (5) `autoWinAt6`. *(What's missing from this list? Iron distribution/clustering? Board/`radius` geometry? A different victory condition entirely? Asymmetric fixes?)*
- **Three approaches drafted:** A = defuse the snowball (token-return + softened bounty, with a "keep iron reachable" guard); B = iron-side reachability (scale threshold); C = combined. *(These are one person's cut of the space. Yours may differ.)*
- **A tension the prior session flagged as likely robust (grounded in the two-regime finding):** strong play fixed cap-hit *by ending games decisively*. So a redesign that lets losers recover indefinitely (e.g. aggressive token-return with no decisive iron end) *might* re-introduce cap-hit stalemates — a design probably needs to open the second path *while preserving a decisive end*. Verify this actually holds under whatever framing you land on, rather than assuming it.
- **Validation idea:** the prior session assumed a reduced-budget MCTS A/B (current rules vs modified) on the same CRN seeds — iron-vs-elimination split + game length + a comeback metric — since full-strength MCTS is infeasible at sweep scale (§6). Its design is yours; a cheaper "strong-ish" proxy (e.g. an elimination-aware heuristic agent that surfaces the iron-vs-eliminate choice without full MCTS cost) is worth weighing against it, since it could enable a full sweep instead of a bounded A/B.

## 6. Hard constraints (these bind any design)

- **Full-strength MCTS is infeasible at sweep scale.** ~55s/move on big-board 6P at 300 iters; a single capped game is hours. See `mcts-perf-control-allocation-bound` memory + `docs/sweeps/mcts-big300/...`. `control()` is allocation-bound (not cheaply optimizable). So any strong-play validation is **reduced-budget + bounded-N + directional**, not a tight statistical gate-pass. Design your validation around this from the start.
- **Behavior guards will fire on any rule change (by design).** `test/engine/control-parity.test.ts` (1269-state hash golden) and `test/agent/mcts-determinism.test.ts` (golden `runMcts` rootStats) PIN current engine behavior. A rule change that alters outcomes WILL fail them — that's the "this is a deliberate change, not a regression" gate. You regenerate those goldens *deliberately*, with justification, as part of shipping a rule change. Don't treat a red parity test as a bug to route around.
- **Serialized contracts.** Avoid changing `SessionRecord` / `LogEntry` / config *shape* — a concurrent client-track agent depends on them (see §8). Config *value* and rule *behavior* changes are fine; contract *shape* changes are a coordination event.

## 7. Repo state & guardrails

- **Branch:** work off `origin/dev` (tip `15a11f4e` at handoff), PR to `dev`. The GitHub default branch is now `dev`, but `docs/git-strategy.md` / `CLAUDE.md` still carry stale `main`-centric language — **trap**: follow branch-off-dev / PR-to-dev regardless; the doc rewrite is a deferred Sam-gated cutover item.
- **Worktrees** at `.claude/worktrees/<slug>` (gitignored). `dev` is checked out elsewhere; can't `git checkout dev` from a worktree. Merge `gh pr merge --merge` then delete the remote branch manually (`--delete-branch` unreliable from a worktree). Rebase (never GUI-merge) to update out-of-date PRs; `--force-with-lease`.
- **bun-only:** `bun run test` (vitest), NEVER `bun test`; `bun run typecheck` (strict). Docs-only PRs skip CI (`check` job) per PR #33.
- **Merge classification** on every PR (`Routine`/`Review`/`Escalate`). Engine-rule changes to victory/economy are **Review** (data-integrity / core-contract) — Sam merges those. `dev` protection requires the `check` job green, no required human reviewer.
- **TDD** for `src/` production code; not for docs/config. **Engine purity:** nothing in `engine`/`rng`/`board`/`index` value-imports `agent`/`driver`.

## 8. Seams (where context is silently lost)

1. **Concurrent client-track agent.** A separate agent is executing the DO-host + SPA plans (`docs/plans/2026-06-29-do-host-wire-protocol-plan.md`, `...spa-client-plan.md`), consuming the engine. Your redesign changes engine *rules*. Coordination: (a) a rule change may require the client to regenerate outcome-dependent test fixtures — flag rule changes that alter game outcomes; (b) do NOT change serialized contracts (§6); (c) both tracks may add pure exports to `src/index.ts` — coordinate via a `## Barrel additions` PR heading; (d) don't modify the client's `src/server`/`web/`; they don't modify `src/engine`.
2. **Parity/determinism goldens as the deliberate-change gate.** (§6) — the redesign's rule change makes these red on purpose; regenerating them *is* part of the change, with justification in the PR.
3. **Validation ↔ MCTS-perf gate.** The A/B validation is bounded by MCTS infeasibility (§6). Any claim of "improves the balance under strong play" is directional at reduced budget — state that honestly; don't imply a tight gate-pass you can't afford.
4. **Health-gate re-examination.** Sam's goal re-frames the 0.50 `ironVictoryFraction` gate as a proxy. If you change what "healthy" means, that's a change to `src/sweep/health.ts` `defaultHealthThresholds()` — a deliberate, documented decision, not a silent tweak (the plan's assertion-rigor rule forbids loosening a gate to manufacture a pass; re-defining the *goal* is different and legitimate, but must be explicit and Sam-approved).

## 9. State of the paused brainstorm

The prior session invoked `superpowers:brainstorming` and created tasks (in that session's tracker): explore context ✅, clarify intent (2 of N questions answered: goal + scope) 🚧, propose approaches (drafted, not chosen), present design (not started). **The fresh session restarts the brainstorm** — re-run your own context-exploration and your own framing before questioning Sam further, rather than resuming mid-question-list. Nothing is committed from the brainstorm (no spec written); this handoff is the only artifact.

## 10. Continuation prompt (paste-ready for the fresh session)

> You're picking up the **balance-redesign design pass** for Industrial Juggernaut — the iron-victory/elimination imbalance on large boards under strong play. Read the handoff at `docs/handoffs/2026-07-02-balance-redesign-handoff.md` in full, and the evidence it points to (the two sweep reports, the fidelity-audit base-economy addendum, and the three project-memory findings on balance/MCTS-perf).
>
> **Start by forming your OWN big-picture understanding of the problem — do not begin by continuing the prior session's approaches.** The handoff's §5 documents a prior (Opus) session's exploratory diagnosis (a "snowball" story), lever list, and three draft approaches. Treat all of it as *input to challenge*, not a plan: re-derive the problem from the evidence and the engine mechanics yourself (`src/engine/status.ts`, `apply.ts`, `control.ts`, `config.ts`, `stranded.ts`), and explicitly ask what the prior pass may have gotten wrong or missed — including whether the problem statement, the lever set, and the 0.50 iron-fraction health criterion are even the right frame. Only after you have your own view should you reconcile it with Sam's provisional direction (§4: goal = strategic diversity; scope = targeted rule + config tuning) and with the prior notes.
>
> Honor the hard constraints (§6): full-strength MCTS is infeasible at sweep scale, so design a reduced-budget/directional validation; the control-parity + mcts-determinism goldens pin behavior and will red-flag any rule change by design; don't change serialized contracts (a concurrent client-track agent depends on them — §8). Work off `origin/dev`, PR to `dev` (the git-strategy docs are stale on `main`-language — §7).
>
> Use `superpowers:brainstorming` to run the design collaboratively with Sam — but lead with your own independent problem analysis and, if it differs from the prior framing, say so and why. The deliverable is a design spec (`docs/superpowers/specs/`) → then an implementation plan. This is Review-class engine work; Sam merges rule changes.

---

## Adversarial review record

- **Round 1 (naive fresh agent):** added `big300`'s exact config inline in §1 (was referenced by name only).
- **Round 2 (recency-bias):** confirmed the doc leads with problem→evidence→mechanics and places the prior session's thinking last (§5) and flagged — ordering fights over-representation of recent solutioning. No change.
- **Round 3 (seam auditor):** §8 covers the four seams (client-track parallel, parity-goldens-red-by-design, validation↔MCTS-perf gate, health-gate re-examination). No change.
- **Round 4 (operational guardrails):** §7 persists branch/worktree/bun/merge-class/TDD/purity + docs-only-CI-skip. No change.
- **Round 5 (loss-averse):** verified the approaches, the cap-hit tension, Sam's two answered questions + the dismissed approach question, and the validation idea are all captured, not left in transcript. No change.
- **Round 6 (session-specific — OVER-ANCHORING AUDITOR):** the defining risk here is the doc steering Fable down the prior session's routes despite the stated intent. Two over-steers found + softened: the cap-hit tension was asserted as "keep regardless of framing" → reframed to "verify it holds under your framing"; the validation idea was "likely the only feasible shape" → reframed to "yours to design; weigh a cheaper proxy." The anti-anchoring framing is reinforced at §0, §1, §4, §5 (with per-item challenge prompts), §9, and the continuation prompt.
- **Final pass:** clean across all rounds.

---

*Handoff authored by the prior (Opus) session, 2026-07-02, at `dev`@`15a11f4e`. The balance-sweep harness, MCTS perf fixes (1+3), control-parity battery, and big300 MCTS re-run are all merged to `dev` (PRs #25/#27/#28/#29). No balance-redesign code exists yet — this is a clean design-pass start.*
