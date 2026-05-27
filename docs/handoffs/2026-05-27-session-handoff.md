# Session Handoff — Industrial Juggernaut — 2026-05-27

> Checkpoint of a long autonomous session that went from design docs → a complete M1 rules engine → a stronger-agent (MCTS) build → a balance-sweep harness. The session is NOT ending; this is a durable checkpoint. Points at the canonical artifacts (specs/plans/reports) rather than duplicating them.

## Headline state
- **Branch:** `claude/document-game-design-VpqqB` (all work; the only dev branch).
- **Tip:** `b4e0eb0` (pushed). `origin/main` is at `72944bb` (PR #10). The branch is ahead of main by the post-PR-#10 sweep work (S1–S4 + plan/claim commits).
- **Tests:** 374 passing, strict `tsc` clean (at `b4e0eb0`).
- **In flight:** a background subagent is running **Sweep Phase S5** (the full balance search) — see "In-flight" below. It will add commits (`src/sweep/main.ts`, `docs/sweeps/2026-05-27-balance-report.md`, and Discoveries in the sweep plan) and may already have done so by the time you read this — `git log` / `git status` to check.
- **PRs:** #2,#5,#6,#7,#8,#9,#10 all merged to `main` with **normal merge commits** (NOT squash — see guardrails). No PR currently open.

## Canonical artifacts (the real source of truth — read these, don't trust this doc's summary over them)
- **Design docs (root):** `2026-05-18-design-critique.md`, `2026-05-18-code-representation-options.md` (all-TS-on-Cloudflare decision), `2026-05-27-agent-roadmap.md` (Part 2 = the strong-agent vision).
- **Rules:** `industrial-juggernaut-rules-v10.md` (reconciled this session: per-player factory-death clock; base-triangle rule clarified — see below).
- **Specs:** `docs/superpowers/specs/2026-05-27-rules-engine-m1-design.md`, `…-stronger-agent-mcts-design.md`, `…-learned-agent-alphazero-design.md`, `…-balance-sweep-harness-design.md`.
- **Plans (Living Documents — Execution Status banners are kept current):** `docs/plans/2026-05-27-rules-engine-m1-plan.md` (✅ done), `…-stronger-agent-mcts-plan.md` (⏸ paused at A5.1), `…-learned-agent-alphazero-plan.md` (⏸ gated), `…-balance-sweep-harness-plan.md` (S1–S4 ✅, S5 🚧).
- **Pitfalls:** `docs/pitfalls/{implementation,testing}-pitfalls.md` (GEO-1..6; GEO-6 = per-player factory clock).

## What shipped this session (pointers)
- **M1 rules engine — COMPLETE & on main** (PRs #2–#7): pure TS engine — geometry (cube/hexline/hull/sightline), board gen + iron-CSP, territory `control`, build/combat/`applyAction`/stranded/status/legalActions/turn, greedy archetype agent, driver + 1000-game acceptance. Plan: M1 plan (all phases ✅).
- **Stronger-agent (heuristic MCTS) — A1–A5.1 on main** (PR #10): perimeter-aware `evaluate` + `samplePolicy` (A1); MCTS core — max^n tree, PUCT, progressive-widening, combat chance nodes, determinized turn order, shared `stepRound`, `runMcts` (A3); `chooseActionMCTS` + IS-MCTS legality filtering (A4); Elo arena (A5.1).
- **Two root-cause engine bug fixes** (on main): (a) base placement illegal at `basesInHand===0` (legalActions self-consistency); (b) **THE big one — the 2nd base was impossible** (`isLegalBasePlacement` required a 2-base triangle from a 1-base start → no growth → factory-death). Fixed: triangle rule applies only to the perimeter-establishing 4th+ base. This was the true root cause of the whole "games degenerate" saga.
- **Authorized balance tuning** (on main): factory-death clock changed shared→per-player (threshold 8), GEO-6, rules doc reconciled. (Now known to be a *symptom-level* fix relative to the base-placement bug.)
- **Designs + plans** (on main): stronger-agent MCTS + learned-agent (AlphaZero) + balance-sweep — all specced, plans `plan-review-cycle`'d.
- **Balance-sweep harness S1–S4** (on branch, post-#10): metrics (`8e104fc`), health gate+rank (`c81f5fd`), runner w/ CRN+CIs (`5148523`), orchestrator+report+infeasibility-guard (`53de15b`).

## In-flight (background subagent — DO NOT dispatch a conflicting agent)
- **Sweep S5 — the full balance search.** Builds `src/sweep/main.ts`, runs a wide geometry grid (`boardSize {96,150,220,300} × radius {2,3,4,5} × ironCount {10,12,14,16} × threshold {8,10,12}`, two-stage), OFAT of the critique's balance variables, writes `docs/sweeps/2026-05-27-balance-report.md`, and records the outcome in the sweep plan's Discoveries. **Two possible outcomes:** (1) a healthy balanced config exists → the data-driven config that unblocks everything; (2) NO healthy config in the wide grid → a redesign-level finding to surface to Sam. When it completes: verify, push, mark S5 shipped, then act on the outcome (see Priority Queue).

## THE central open question (the whole project currently hinges on this)
**Is the game balanceable into multi-turn strategic depth?** The base-placement fix made the game *playable* but revealed it's decided at setup/turn-1 (a radius-5 base on a ~93-hex board blankets ≥10 of 14 iron; **48/200 games won AT SETUP**). No single hand-picked knob fixes it (validated). The S5 wide-grid search is the moment of truth. S4's small-grid smoke found **0/8 healthy** (only the 96-board) — inconclusive (no larger boards), but it raises the odds that larger boards are required, or that no healthy config exists (→ Sam decision).

## Deferred items (each: unblock condition + link)
- **MCTS trustworthiness gates A5.2 (robustness + exploiter) and A6 (the 4 gates).** ⏸ DEFERRED pending a **balanced game config** (so games have depth for lookahead to matter — currently MCTS@60 *loses* to greedy on the 1-turn game, and greedy self-destructs, making gate 2 unassessable). Unblocker: S5's recommended config (in `docs/sweeps/2026-05-27-balance-report.md` + sweep plan Discoveries) → adopt as `defaultConfig` (human-gated balance decision) → resume. See `docs/plans/2026-05-27-stronger-agent-mcts-plan.md` Overall banner + Discoveries.
- **Learned (AlphaZero) agent — entire milestone.** ⏸ DEFERRED pending (1) the MCTS gates resuming AND (2) evidence MCTS is *insufficient* for trustworthy sweeps (it may suffice → YAGNI exit). Double-gated behind the balanced config. See `docs/plans/2026-05-27-learned-agent-alphazero-plan.md` top banner.

## Seams (where context is silently lost)
1. **S5 (running) → its plan Discoveries.** The S5 agent edits `docs/plans/2026-05-27-balance-sweep-harness-plan.md` Discoveries; do NOT edit that plan until S5 completes (merge race). This handoff doc is separate (no conflict).
2. **S5 recommended config → MCTS gate resumption.** When S5 yields a healthy config, it is a *recommendation*; adopting it as `defaultConfig` is a SEPARATE step (a balance decision Sam authorized in spirit, but a real config change). Adoption will shift MANY test distributions (the 1000-game acceptance, etc.) — expect to update tests that encoded the old (degenerate) balance to the new behavior (correct-not-loosen). Only after adoption do A5.2/A6 become meaningful.
3. **Greedy baseline self-destructs (current balance).** Gate 2 ("MCTS beats greedy") is currently confounded: greedy walks into the factory-death self-destruct MCTS avoids. After the balanced config, re-assess whether MCTS genuinely beats a *competent* greedy — that result drives the learned-agent gate.
4. **Branch vs main divergence pattern.** After each PR merges, this session does `git reset --hard origin/main` then force-push-with-lease the branch on the NEXT push (the branch's pre-squash... no — we used merge commits; the branch fast-forwards). Current: branch ahead of main by sweep S1–S4. Next PR merges those.

## Operational guardrails accumulated this session (so a fresh agent doesn't re-learn them)
- **Merge with `--merge` (normal merge commit), NEVER squash** (Sam's instruction; matches `docs/git-strategy.md`). Preserve per-commit history.
- **All work on `claude/document-game-design-VpqqB`.** Commit + push after EVERY task (the container is ephemeral — unpushed work is lost; the stop-hook nags about it). PR + merge at phase boundaries; `git fetch origin main && git reset --hard origin/main` to resync after a merge.
- **Subagent-driven execution:** one fresh subagent per task; brief it self-contained (it has none of this context); verify its work (trust-but-verify — several left work uncommitted or hit container restarts; check `git status`/`git log` and the suite yourself); commit/push; update the plan banner. Don't dispatch two implementer subagents at once (branch race).
- **5-option/adversarial pattern for any meaningful decision** (Sam's standing instruction) — done for: candidate-action repr (MCTS), learned-agent stack/value/encoding/policy/loop, factory-clock fix, base-placement semantics, provisional-balance lever, config-health metric.
- **Work autonomously; don't prompt** — BUT surface genuine design crossroads (did so for the balance/1-turn discovery, which Sam decided as "A-to-unblock-B").
- **Board-coordinate discovery:** the seed-1n/size-96 board is a 93-hex asymmetric oval; off-board coords exist (`(0,5,-5)`,`(8,-8,0)` off; `(0,0,0)`,`(2,-2,0)`,`(4,-4,0)`,`(5,-5,0)`,`(6,-6,0)`,`(0,4,-4)` on). Use on-board coords or `mkState` unioning in fixtures.
- **Iron-CSP feasibility:** small boards can't hold much iron (max-degree-1 spacing); the sweep guards infeasible `(boardSize,ironCount)` combos.
- **`ironOverTime[0]` is post-turn-1, not setup;** `setupDecided` is computed by mirroring `runGame`'s board (post-`generateBoard` rng → `setupGame`).
- **Engine determinism:** all randomness via the seeded PCG (`src/rng/pcg.ts`); no `Math.random`. Strict tsconfig; never relax it. Hex Sets/Maps keyed by `key()` string (GEO-4); derived state recomputed not cached (GEO-5).

## Queued improvements (small, do before the next long run)
- **Sweep progress logging (Sam-requested).** The S5 run was *silent* (`main.ts` printed only the "Stage 1" header, then ran ~190 configs at 100% CPU with no per-config output), which made "stalled vs. slow" undiagnosable without inspecting the process. Add an optional `onProgress(done, total, label, metrics)` callback to `sweepGrid`/`runConfig` (backward-compatible default no-op; test it), and have `main.ts` log per-config progress (`config k/N: bs… r… → medianTurns/health`) + a per-stage heartbeat. Implement as the FIRST step after S5 completes (can't edit `main.ts` while the S5 process owns it). This makes every future sweep observable.

## Priority queue (numbered, with dependencies)
1. **When S5 completes:** verify its report + tests green; push; mark S5 shipped. THEN add the sweep progress logging (see "Queued improvements"). Then PR+merge the sweep (S1–S5) to main.
2. **Act on S5's outcome:**
   - **If a healthy config exists:** surface the recommended config + balance findings to Sam; adopt it as `defaultConfig` (update tests encoding old balance); this unblocks #3.
   - **If NONE exists:** surface the redesign-level finding to Sam (the game's geometry/economy can't produce balanced multi-turn games in the searched space) — this is a Sam decision, not an autonomous fix.
3. **(after #2 if config adopted)** Resume MCTS gates: A5.2 (robustness + exploiter), then A6 (the 4 trustworthiness gates) — now meaningful on a balanced game.
4. **(after #3)** Learned-agent gate decision: if A6 shows heuristic-MCTS *insufficient* → execute the learned-agent plan; else → YAGNI-shelve it (the intended exit).

## Continuation prompt (paste-ready for a fresh agent)
> You are continuing an autonomous build of Industrial Juggernaut on branch `claude/document-game-design-VpqqB`. Read `docs/handoffs/2026-05-27-session-handoff.md` first, then the four plans under `docs/plans/`. A background subagent was running Sweep Phase S5 (the full balance search via `src/sweep/main.ts` → `docs/sweeps/2026-05-27-balance-report.md`); check `git log`/`git status` and the sweep plan's Discoveries for its result. If S5 found a healthy balanced config, surface it + the balance findings to Sam and (per his balance authority) adopt it as `defaultConfig` (updating tests that encoded the old 1-turn balance), then resume the paused MCTS trustworthiness gates (A5.2/A6 in the stronger-agent plan). If S5 found NO healthy config in the wide grid, STOP and surface that redesign-level finding to Sam. Operate per the guardrails in the handoff (merge-commits-not-squash, commit+push per task, subagent-driven with verification, 5-option-adversarial for meaningful decisions, work autonomously but surface genuine design crossroads). Do NOT loosen any health gate or trustworthiness gate to manufacture a pass — a failing gate is a finding.

## Adversarial review log (handoff skill Phase 4)
- **Round 1 (naive fresh agent):** added the "canonical artifacts" + "read these, don't trust the summary" framing and glossary-ish guardrails so a cold agent can orient; spelled out the double-gating of the learned agent. (2 fixes)
- **Round 2 (recency-bias audit):** pulled forward mid-session items that recent work overshadowed — the two engine bug fixes, the factory-clock authorization, the merge-commit rule, the board-coordinate discovery. (4 fixes)
- **Round 3 (seam auditor):** documented the 4 seams explicitly (S5↔plan-Discoveries merge race; recommended-config↔adoption↔gate-resume; greedy-self-destruct confounding gate 2; branch/main divergence). (1 new seam added vs first draft)
- **Round 4 (operational guardrails):** confirmed all session guardrails are in the handoff AND that the durable ones (factory clock GEO-6, base rule, merge policy) live in pitfalls/rules/git-strategy, not only here. (verified)
- **Round 5 (loss-averse):** scanned for "worth capturing later" items — the iron-CSP feasibility + `ironOverTime[0]`-is-post-turn-1 findings are in the sweep plan Discoveries AND summarized here. (verified)
- **Round 6 — session-specific: "balance-confound auditor."** This session's defining character is that *agent quality and game balance are entangled* — repeated findings (greedy self-destructs, MCTS loses on 1-turn games, gate 2 unassessable) all trace to unbalanced game state, and a fresh agent could wrongly conclude "MCTS is useless" or "the agent is broken" when the real cause is balance. Added explicit framing in "THE central open question" + seam #3 + priority #2 so the next agent does NOT misattribute the gate-2 result to agent weakness before the balanced config exists. (2 fixes)
- **Final pass:** re-ran rounds 1–6; zero further material findings.
