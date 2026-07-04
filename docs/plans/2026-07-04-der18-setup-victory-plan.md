# Plan — DER #18: no victory during the setup phase

**Goal:** Implement legs 1–2 of the merged adjudication ruling so a game can no longer be won during the setup (first-base placement) phase, and the designer instrument warns when a config is instant-winnable. Leg 3 (default-knob change) stays on the balance-redesign track.

**Architecture:** A one-line turn-0 guard at the top of `status()` (`src/engine/status.ts`) suppresses every victory resolution while `phase.turn === 0`; the setup→play transition (final placement advances to turn 1) is the first moment a victory resolves, reusing the DER #14 tie-break already in `status()`. Because all four setup-victory enforcement points consume `status()`, this is coherent at zero per-site edits. `src/engine` is in the replay closure, so this forces a `REPLAY_VERSION` recompute. A frontend degeneracy predicate warns in `NewGame` when a single first-base control disk can cover ≥ the iron-victory threshold.

**Tech Stack:** TypeScript rules engine (`src/`), Vitest (root project + `web/` client project), bun-only (`bun run test`, `bun run test:client`, `bun run typecheck`), Cloudflare Workers/DO host (`src/host/`), Vite+React SPA (`web/`).

**Design source:** `docs/superpowers/specs/2026-07-04-der18-setup-victory-implementation-design.md`. **Ruling (authoritative):** `docs/plans/2026-07-03-setup-iron-victory-adjudication.md` §Ruling.

## Living Document Contract

This plan is a living document. Every executing agent MUST update it as
execution progresses, not only at completion.

- **On phase claim:** the executor MUST flip the banner to 🚧 IN PROGRESS
  with a claim timestamp (ISO 8601 UTC) and the active branch name. The
  banner MUST NOT include an expected-completion estimate — agents cannot
  reliably estimate their own wall-clock, and a fabricated duration
  becomes a stale anchor that misleads future readers. Followers
  encountering a 🚧 banner determine liveness by observable signals (PR
  existence, recent branch commits), not by arithmetic on expected times.
  See Step 5's stale-claim reclaim protocol.
- **On phase ship:** the executor MUST update that phase's **Execution
  Status** banner with the shipped commit SHA(s) and date. If a PR is
  open, the PR number and URL MUST appear in the top-of-plan Execution
  Status table.
- **On phase defer:** the executor MUST update the banner with ⏸ status
  AND a prose description of the unblock condition + a link to the
  likely-unblocker artifact (plan page, task, or PR whose own Execution
  Status banner will signal completion). Prose + link is durable across
  paraphrases and scope edits; exact-string coordination between agents
  is not.
- **On PR merge:** the executor MUST record the merge SHA in the banner
  + the top-of-plan Execution Status table.
- **On deviation from the written plan** (scope edits, structural
  refactors, dropped tasks, reordered phases): the executor MUST
  inline-document the deviation in the affected task AND summarize it
  in the top-of-plan Execution Status as a "Deviations" subsection.
  Deviation state MUST NOT live only in PR notes or status reports.
- **On discovery** (pre-existing drift surfaced during execution, new
  bugs found, architectural issues noted): the executor MUST add a
  "Discoveries" subsection at the top of the plan with pointers to the
  files/lines affected. Follow-up dispatches read this subsection to
  avoid duplicate discovery work.

The plan SHOULD reflect reality at the end of every session that touches
it. Anything worth putting in a status report to the user is worth
putting in the plan.

Rationale: `/writing-plans-enhanced` Step 5. Writing at ship time is
cheap; reconstruction by downstream readers is expensive, compounds
across dispatches, and fails silently when state is split across PR
notes and commit messages.

## Execution Status

**Overall:** Phase 1 🚧 IN PROGRESS (branch `fix/der18-setup-victory`, claimed 2026-07-04). PR #68 (this plan) merged, so the plan is approved; Phase-1 merge authority (the `REPLAY_VERSION` bump) is still Sam's to confirm — Phase 1 executes to an open PR and STOPs for Sam at merge.

| Phase | Status | Ship SHA(s) | Notes |
|---|---|---|---|
| 1 — Engine: turn-0 guard + version bump + test remediation | 🚧 In progress (`fix/der18-setup-victory`) | — | Review-class (version bump, winner semantics); STOP for Sam at merge |
| 2 — Designer degeneracy warning | 🚧 In progress (`fix/der18-designer-warning`) | — | Routine, frontend, independent of Phase 1 (branched off `origin/dev`) |

### Deviations

- **Task 1.4 test (a) runs at `victoryThreshold: 5`, not the default 10** (commit `56426ae3`). On the default 96/14/radius-5 board a 2P *agent drive* never resolves a boundary iron victory at threshold 10: `representativeFirstBase` lands on a ~5–6-iron hex and two non-allied singletons don't union iron (verified: seeds 1–60 stay ongoing at the 2P boundary). Lowering the threshold to 5 makes seat 0 provably ≥threshold *during setup* — which is a STRONGER test of the DER #18 suppression (the guard demonstrably holds while a qualifier exists) than the design's original "second placement covers ≥10" premise. The suppression mechanism is threshold-independent, so this is faithful. See the Discoveries note on why threshold 10 is unreachable by a 2P drive yet the default is still degenerate.

### Discoveries

**Task 1.1 — old-timing test audit (confirmed 2026-07-04, branch `fix/der18-setup-victory`).** Re-grepped for drift per Task 1.1 (`reason:`/`cause:`, bare `GAME_OVER`/`last-standing`, and `test/session/` for `freshSession`/`openSession` + `eliminated`). No drift from the plan-review's known set.

- **Confirmed breaker set (guard-driven; to re-express in Task 1.3):**
  - `test/version.test.ts` — expected; fixed by the Task 1.2 `REPLAY_VERSION` recompute, not by test edits.
  - `test/session/agent-drive.test.ts` — the "mid-setup victory" describe block. SCENARIO RESTRUCTURE (invert the turn-0/`placementsBefore`/`needsDrive` invariants to the boundary), not an assertion move.
  - `test/session/apply-command-envelope.test.ts` — the "GAME_OVER: a mutating command after victory is rejected" test. Mechanical fix: build the eliminated-player terminal state on top of the file's `completeSetup(s)` helper so it sits at turn ≥1.
- **Audit-only (plan-review verified PASS under the guard — do NOT restructure):** `test/session/drive-vs-recordgame.test.ts`, `test/session/record.test.ts`, `test/session/part-a-integration.test.ts`, `test/session/place-first-base-command.test.ts`. These contain `GAME_OVER`/`last-standing`/`eliminated` strings but assert on post-setup states, so they stay green.
- **Empirical confirmation (Task 1.2 guard run, `0e78ecb5`):** `bun run test` → 2168 passed, **3 failed across exactly 2 files** — no drift, matches the prediction:
  - `test/session/agent-drive.test.ts` — **2** tests in the "mid-setup victory" block fail: the *drive path* test (line 679: `placementsBefore` reaches 3, not < 3 — the drive now places all 4 seats before resolving) and the *command path* test (line 736: zero `gameOver` in the human's mid-setup placement broadcast). The third test in that block (2p non-victory placement) stays GREEN. Task 1.3 must re-express BOTH failing tests + rewrite the block's obsolete header comment (lines 626-636).
  - `test/session/apply-command-envelope.test.ts` — the "GAME_OVER after victory" test (line 150: got `SETUP_PLACEMENT_REQUIRED`, expected `GAME_OVER`).
  - `test/version.test.ts` — already green (fixed by the Task 1.2 `REPLAY_VERSION` recompute `dadb040bd8d6546e` → `29568541c4550281`).
  - Audit-only set confirmed green under the guard (no restructure needed).

**Coverage-distribution finding (controller probe, 2026-07-04) — reconciles the "instant-win" premise with the outer-ring restriction; load-bearing for Phase 2.** First bases are OUTER-RING-restricted (`placeFirstBase` validates `ringDepthFromEdge === 0`, `src/engine/turn.ts:117`); the design's "single radius-5 disk covers ≥10 of 14 iron" and the ruling's "DER #6 free placement" language describe the free-placement *analysis* regime, not the shipped setup command. Probing the default config (96/14/radius5) over ALL 32 outer-ring hexes: **max single-base iron coverage is 10–11, with 1–3 hexes ≥10 on every seed tested (1,2,3,4,7,42).**
  - So the instant-win IS reachable via the shipped engine — a player who *chooses* a max-coverage ring hex wins during setup — but `representativeFirstBase` (what a drive picks) usually lands on a ~5–6-iron hex, which is why a 2P drive never clinches at threshold 10 (the Task 1.4 (a) deviation) yet a 4P drive occasionally does (some seat lands on a degenerate hex). This validates DER #18's necessity: the bug is a real, human-reachable setup victory.
  - **Phase 2 consequence:** the degeneracy predicate must enumerate `legalFirstBaseHexes` (outer-ring) and take the **MAX** coverage — which is exactly 10 = `victoryThreshold` on most default seeds → the warning fires. The `≥` comparison (not `>`) is load-bearing since max often EQUALS threshold. Clean-config test cases (threshold ≥12, radius ≤4, size ≥120) must push the max strictly below 10–11; the Phase 2 implementer MUST verify each clean case empirically rather than assume.

## Merge authority (decide before executing Phase 1)

Phase 1 carries a `REPLAY_VERSION` bump (replay-compat blast radius) and changes winner semantics. The `balance-redesign-merge-authorization` memory covers the balance effort's PRs after a blind Fable-tier adversarial review; DER #18 is the *fidelity* leg, adjacent to but distinct from balance-knob tuning. **Default in this plan:** treat Phase 1 as Review-class, run the blind adversarial gate, and STOP for Sam before merge unless he confirms the balance authority extends to this version-bumping change. Phase 2 (frontend) is Routine.

---

## Phase 1 — Engine: turn-0 guard, version bump, test remediation

**Execution Status:** 🚧 IN PROGRESS — branch `fix/der18-setup-victory`, claimed 2026-07-04. Tasks 1.1–1.4 COMPLETE; full root suite GREEN (2176 passed), typecheck clean. Commits: 1.2 guard+version `0e78ecb5`, 1.3 test re-expression `ff080e9e`, 1.4 new semantics tests `56426ae3`. Remaining: close-out review rounds + blind adversarial gate → open PR → STOP for Sam (merge authority). See Discoveries + Deviations.

**Why this matters:** the Living Document Contract (above) comes from `/writing-plans-enhanced` Step 5 — keep the banners current so a follow-up dispatch reads state instead of reconstructing it.

### Task 1.1 — Enumerate the tests that encode the old mid-setup-victory timing

**Files:** none modified (audit only). Produce a list, recorded in the plan's Discoveries subsection.

The semantic change moves *when* a victory resolves. Some existing tests assert the OLD timing (a mid-setup placement / setup-state produces a victory or `GAME_OVER`); those must be re-expressed in Task 1.3, not deleted. **First, know the full set — and the plan-review already ran this empirically, so the breaker set is KNOWN. Confirm it, don't rediscover it cold.**

- **The guard breaks exactly these (plan-review verified 2026-07-04 by applying the guard + running `bun run test`):**
  - `test/version.test.ts` — expected; fixed by the Task 1.2 version recompute, not by test edits.
  - `test/session/agent-drive.test.ts` — the two tests in the "mid-setup victory" describe block. **This is a SCENARIO RESTRUCTURE, not an assertion move** (see Task 1.3).
  - `test/session/apply-command-envelope.test.ts` — the "GAME_OVER: a mutating command after victory is rejected" test (~line 130). **This is a LAST-STANDING GAME_OVER-guard test, NOT an iron-timing test** — it builds its victory from `freshSession()` (= `openSession()` = a turn-0 setup state) with a player marked eliminated, expecting last-standing `GAME_OVER`; under the guard `status()` returns `ongoing` at turn 0 → the reply is `SETUP_PLACEMENT_REQUIRED`. Its fix (Task 1.3) is to build the eliminated-player state on top of the file's existing `completeSetup(s)` helper (~line 35) so it sits at turn ≥1.
- **Audit-only (verified PASS under the guard — no edits): `drive-vs-recordgame.test.ts`, `record.test.ts`, `part-a-integration.test.ts`, `place-first-base-command.test.ts`.** The design scout listed these as candidates; the empirical run cleared them. Re-verify (they should still pass), but do NOT restructure them.
- **Re-run the grep to catch any drift since 2026-07-04** — the engine uses **`reason: "iron"`** (not `cause:`) and the breaking envelope test is a *last-standing* victory with no iron string, so grep BOTH `reason:`/`cause:` AND the bare `GAME_OVER` / `last-standing` strings, AND `test/session/` for `freshSession`/`openSession` + `eliminated` + `GAME_OVER`. If the grep surfaces a file not in the known set above, add it to Discoveries and treat it in Task 1.3.

**BEFORE marking this task complete:** record the confirmed breaker set + audit-only set in the plan's **Discoveries** subsection, so Task 1.3 is deliberate. The known set is small (2 files to edit); the value of this task is confirming nothing drifted.

### Task 1.2 — The turn-0 guard + `REPLAY_VERSION` recompute (TDD)

**Files:** `src/engine/status.ts` (the guard), `src/host/version.ts` (recomputed `REPLAY_VERSION`), plus a new engine test.

BEFORE starting work:
1. Invoke `/superpowers:test-driven-development`.
2. Read `docs/pitfalls/testing-pitfalls.md` and `docs/pitfalls/implementation-pitfalls.md`.
Follow TDD: write failing test → implement → verify green.

- **Step 1 (failing test):** a new test in `test/engine/` (mirror the existing `status()` test file's style): construct a `GameState` in setup (`phase.turn === 0`) where one player's radius-`controlRadius` control disk covers ≥ `victoryThreshold` irons, and assert `status(state).kind === "ongoing"`. Then construct the SAME board state but with `phase.turn === 1` and assert `status(state).kind === "victory"` with that player. Run → the first assertion FAILS against current code (status resolves the victory at turn 0).
- **Step 2 (implement):** add as the FIRST statement in `status()` (`src/engine/status.ts:97`): `if (state.phase.turn === 0) return { kind: "ongoing" };` with the evergreen comment from the design doc (DER #18 rationale). Do NOT touch the four enforcement points — they consume `status()` and inherit the behavior.
- **Step 3 (version recompute):** run `bun scripts/compute-replay-version.ts`; update `src/host/version.ts` `REPLAY_VERSION` to the printed hash (leave `AGENT_VERSION` unless it also changed). Run `test/version.test.ts` — it MUST pass (it asserts `version.ts` matches the computed closure hash). **Do NOT hand-edit the hash to any other value; use exactly what the script prints.**
- **Step 4:** the new test passes; `bun run typecheck` clean.

**BEFORE marking this task complete:**
1. Review the new test against `docs/pitfalls/testing-pitfalls.md`.
2. Verify it covers both directions (turn-0 ongoing AND turn-1 resolves) so the guard can't be a no-op that always returns ongoing.
3. Run `test/version.test.ts` + the new test green. Do NOT run the full suite yet — Task 1.3 fixes the tests the guard breaks.

### Task 1.3 — Re-express the tests that encoded the old timing

**Files:** exactly the tests enumerated in Task 1.1 that assert the old mid-setup-victory timing.

BEFORE starting work: invoke `/superpowers:test-driven-development`; read `docs/pitfalls/testing-pitfalls.md`.

This is the delicate task. The two confirmed breakers (from Task 1.1) have DISTINCT fixes — they are not the same "move the assertion" mechanic:

- **`test/session/apply-command-envelope.test.ts` (~line 130, "GAME_OVER: a mutating command after victory is rejected") — mechanical fix.** It's a GAME_OVER-guard test, not an iron-timing test: it builds a terminal state from `freshSession()` (turn-0 setup) + a player marked eliminated, then asserts a mutating command is rejected with `GAME_OVER`. Under the guard a turn-0 state is `ongoing`, so the rejection is `SETUP_PLACEMENT_REQUIRED`. **Fix:** build the eliminated-player terminal state on top of the file's existing `completeSetup(s)` helper (~line 35) so it sits at turn ≥1 — then `status()` returns the last-standing victory and the `GAME_OVER` rejection assertion is preserved verbatim. Coverage (a post-victory mutating command is rejected) is unchanged; only the setup-vs-play staging of the terminal state moves.
- **`test/session/agent-drive.test.ts` (the "mid-setup victory" describe block, ~lines 638-760) — SCENARIO RESTRUCTURE, not an assertion move.** This block is structurally built on the OLD first-clinch semantics: it asserts `phase.turn === 0` as a drive-loop invariant, `placementsBefore < 3` ("decided before all 4 seats placed"), terminal at `advanced: false` mid-setup, and `needsDrive(s) === false` mid-setup. DER #18 makes that scenario **vacuous** (the block's own comment says so). **A faithful fix INVERTS those invariants** — the new scenario is "all seats place; the `gameOver` fires at the setup→play transition (turn 1), never before." Do NOT delete the `phase.turn`/`placementsBefore`/`needsDrive` assertions to make the block pass — re-express them to the new invariant (turn advances to 1 at the final placement; the victory is observed there). A subagent that weakens or removes these invariants instead of inverting them is the exact anti-pattern this task forbids — if the inversion isn't obvious, STOP and raise it.
- **Audit-only (re-verify PASS, do NOT restructure):** `drive-vs-recordgame.test.ts`, `record.test.ts`, `part-a-integration.test.ts`, `place-first-base-command.test.ts`. The plan-review confirmed these pass under the guard. If any unexpectedly fails, treat it as a new Discovery and re-express (do not weaken).
- **Global rule:** do NOT delete a victory / `GAME_OVER` assertion; move or invert it. A test that ends with fewer terminal assertions than it started with is a coverage regression — if you cannot re-express one, STOP and raise it (it may be pinning the deliberately-changed winner-flip, in which case the correct new assertion is the flipped winner, documented).

**BEFORE marking this task complete:**
1. `bun run test` (full root suite) green.
2. For EVERY touched test, the commit message states what happened to its assertions — "re-express (preserve)", never a bare "fix". A subject like "update tests" that hides an assertion drop is forbidden.
3. Confirm no test lost a victory/`gameOver` assertion without an equivalent one landing at the boundary. If a subagent is tempted to weaken an assertion to make a test pass, that is the exact anti-pattern this task forbids — STOP and raise to the dispatching agent.

### Task 1.4 — New behavior tests (pin the ruling's semantics)

**Files:** new/extended tests under `test/engine/` and `test/session/`.

BEFORE starting work: invoke `/superpowers:test-driven-development`; read `docs/pitfalls/testing-pitfalls.md`.

Write tests (red→green) pinning the ruling's decided behavior:
- **(a)** A full 2P drive (both seats place first bases; the second placement covers ≥ threshold irons): exactly ONE `gameOver`, emitted at the setup→play transition, none mid-setup.
- **(b)** A 4P drive with agent seats interleaved: exactly one `gameOver` at the transition, no mid-setup victory, no stall (the drive completes — this pins the four-enforcement-point coherence).
- **(c)** Multiple qualifiers at the boundary → DER #14 tie-break (most iron, then lowest id) — construct a transition state where two players both exceed the threshold with different iron counts and assert the higher-iron winner; and an equal-iron case asserting the lower-id winner.
- **(d)** The deliberate winner-flip, documented as such: seed 4 default config, seat 0 clinches 10 iron at `(1,3,-4)`, seat 1 answers 11 iron at `(2,2,-4)` → the boundary resolves to seat 1 (NOT seat 0, which would have won under the old first-clinch). Name the test so the semantic change is unmistakable.

**BEFORE marking this task complete:**
1. Review against `docs/pitfalls/testing-pitfalls.md` — especially determinism (fixed seeds, structural state equality / `stateHash`, not stringified blobs).
2. If any drive-timing assertion races or flakes, the fix is deterministic synchronization, NOT assertion weakening. Prefer mechanism assertions (observe the single `gameOver` at the transition) over symptom assertions. If synchronization cannot make it reliable, STOP and raise — do not ship a weaker test.
3. `bun run test` green.

### Phase 1 close-out

After completing Tasks 1.1–1.4:
- Review the batch from multiple perspectives. **Minimum 3 review rounds** (spec-faithfulness to the ruling; test-remediation integrity — no coverage lost; version-bump correctness + old-room freeze reasoning). If round 3 still finds issues, keep going until clean.
- Run the **blind adversarial merge gate** (a fresh subagent tasked to find a blocker — this track's load-bearing gate): focus on the test remediation (did any assertion silently weaken/drop?), the version-bump handling, and whether the guard is genuinely coherent with all four enforcement points (drive a live session in the probe).
- **STOP for Sam** on the merge-authority decision (top of plan) — do not merge Phase 1 without his confirmation that the balance authority covers the `REPLAY_VERSION` bump, or his own merge. Open the PR (`Review — engine fidelity / replay-version bump`); update this phase's banner + the top table + Deviations/Discoveries.

---

## Phase 2 — Designer degeneracy warning

**Execution Status:** 🚧 IN PROGRESS — branch `fix/der18-designer-warning` (off `origin/dev`), claimed 2026-07-04. Tasks 2.1–2.2 COMPLETE. Routine; targets auto-merge on green CI after a blind review. (Plan-doc edits on this branch are localized to the Phase 2 row + this section to avoid conflicts with the Phase 1 branch's edits; Phase 1 state lives on [#71](https://github.com/scarson/industrial-juggernaut/pull/71).)

- **Task 2.1** (`9f84bee5`): pure predicate `isSetupInstantWinnable(config, boardSource, seed)` in `web/src/designer/degeneracy.ts` — max single-base iron coverage over `legalFirstBaseHexes` (outer-ring) `≥ config.victoryThreshold`. Distance-based, cross-checked against the engine's `control()` (both = 10 on the default max hex). 4/4 tests green.
- **Task 2.2** (`29346903`): wired into `NewGame.tsx` (memoized on `[config.radius, config.victoryThreshold, boardResult, seedResult]` — no per-keystroke board gen), note constant `SETUP_DEGENERACY_NOTE` in `presets.ts`, component test (present at degenerate default / absent when threshold raised). Also fixed the predicate seed param `number`→`bigint` (a `Number(bigint)` downcast would have generated a different board than the game for large seeds). Advisory only — `canStart`/`canStartOnline` untouched.
- **Verification:** full client suite 629 green, `typecheck:client` clean, `build:client && check:bundle` OK (no `src/agent`/`src/wire` in eager chunks). **Live-browser (controller):** note appears at the degenerate default, CLEARS when threshold→12 or radius→4, and REAPPEARS when threshold→10 (raise-then-lower re-render cycle, pitfall WEB-3); renders with the hairline-frame `NOTE_STYLE` (1px border all around, no side-stripe — pitfall WEB-1) matching the balance-note.
- **Author 3-lens review** (predicate-vs-engine-semantics / memoization boundary / brand hairline-frame) — all clear. **Blind adversarial round (fresh opus subagent) — NO BLOCKER FOUND:** independently probed `control()` vs the predicate's distance count over every outer-ring hex across many seeds/configs (0 mismatches), confirmed the `≥` boundary (max 10, so threshold 10→true / 11→false), verified the memo deps cover exactly the predicate's inputs (no stale/over-eager), the seed-type fix has no lossy downcast, and the `NewGame` diff is purely additive (`canStart` untouched); suite/typecheck/bundle all green. (Ran on opus — Fable 5 unavailable, monthly spend limit.)

Independent of Phase 1 (pure frontend; no engine or version-bump dependency). May execute before, after, or in parallel with Phase 1 on its own branch.

### Task 2.1 — The degeneracy predicate (pure function, TDD)

**Files:** a new pure module under `web/src/designer/` (e.g. `degeneracy.ts`) + its test.

BEFORE starting work: invoke `/superpowers:test-driven-development`; read `docs/pitfalls/testing-pitfalls.md`.

- **RuleConfig field names (plan-review-corrected — these are the REAL fields, not the UI labels):** the iron-victory threshold is **`config.victoryThreshold`** (`src/engine/config.ts:10`; labeled "Iron hexes to win" in the form) and the control radius is **`config.radius`** (`config.ts:6`; labeled "Control radius"). Writing `config.ironHexesToWin` / `config.controlRadius` is a hard `bun run typecheck:client` failure — those properties don't exist on `RuleConfig`.
- A pure function `isSetupInstantWinnable(config, boardSource, seed): boolean` (name to taste): generate the board via the client engine barrel (`generateBoard`/`initGame` — reuse the exact path the viewer/designer already use so no new barrel export is needed; verify against `web/src/engine-client/barrel.ts`), enumerate `legalFirstBaseHexes`, and return true iff `max over those hexes of (count of irons within that hex's radius-config.radius control disk) ≥ config.victoryThreshold`. (Semantics are faithful to the engine: at the setup→play boundary each player is a singleton coalition with one base, so `coalitionIron` = the irons in one radiating disk, and no DER #17 perimeter subtraction applies with ≤1 base each.)
- **Step 1 (failing tests):** assert `true` for the degenerate default (generate 96 / ironCount 14 / `radius` 5 / `victoryThreshold` 10, a fixed seed) and `false` for clean configs (`victoryThreshold` ≥ 12, OR boardSize ≥ 120, OR `radius` ≤ 4 — one test each). Run → FAIL (function doesn't exist).
- **Step 2 (implement)** using only pure barrel exports (`generateBoard`/`legalFirstBaseHexes`/`control`/`distance` — all confirmed exported from `web/src/engine-client/barrel.ts`; NO `src/agent`, so the bundle guard is unaffected). **Step 3:** green.

**BEFORE marking this task complete:** review against testing-pitfalls (deterministic seeds); confirm the predicate uses only pure exports (grep the imports — no `src/agent`); `bun run test:client` + `bun run typecheck:client` green; `bun run build:client && bun run check:bundle` still OK.

### Task 2.2 — Wire the warning into `NewGame` (memoized) + component test

**Files:** `web/src/designer/NewGame.tsx` (memoized call + note render), possibly `web/src/designer/presets.ts` (the note constant, sibling to `BALANCE_IN_PROGRESS_NOTE`).

BEFORE starting work: invoke `/superpowers:test-driven-development`; read `docs/pitfalls/testing-pitfalls.md`.

- `useMemo` the predicate on exactly the config fields that determine reachability (`boardSize`, `ironCount`, `radius`, `victoryThreshold`, `seed`, `boardSource` — using the real `RuleConfig` field names, per Task 2.1) so it does NOT run per keystroke on unrelated fields; the board generation is the dominant cost. When true, render an advisory note (own `data-testid`) beside the existing `balance-note` render slot (`NewGame.tsx:169-170`, the `data-testid="balance-note"` / `NOTE_STYLE` region — NOT lines 127-128, which are handler code): *"With these settings a single first base can win instantly — raise the board size or the iron-victory threshold, or lower the control radius."* Match the existing hairline-frame `NOTE_STYLE` treatment (no side-stripe — DESIGN.md / pitfall WEB-3).
- **Step 1 (failing test):** a component test asserting the note renders for the degenerate default config and is ABSENT for a clean config. Run → FAIL. **Step 2:** implement. **Step 3:** green.

**BEFORE marking this task complete:** review against testing-pitfalls; the note is advisory only (never blocks Start); `bun run test:client` + `bun run typecheck:client` green; a browser pass confirms the note appears/clears as the config crosses the degeneracy boundary (drive a state transition — the note is a re-render-driven element; static jsdom tests miss re-render defects, pitfall WEB-3).

### Phase 2 close-out

Review from ≥3 perspectives (predicate correctness vs the engine's real control/iron semantics; the memoization boundary; brand — the note wears the hairline-frame treatment, not a side-stripe). Blind adversarial round. Routine-class → merge under overnight authority after a converged blind round; update the banner + top table.
