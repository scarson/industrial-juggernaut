# Web Client Foundation Implementation Plan (Phase 1a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the dependency-root engine work and CI gate that everything else in the web-client effort builds on — public API barrel, deterministic init, three engine correctness fixes, the human-choice setup phase, and a minimal CI pipeline on `dev` — all with zero Cloudflare runtime.

**Architecture:** Pure-TS engine changes (TDD against the existing vitest suite), additive where possible. The one structural change (a setup phase) is designed to be structurally identical to the current `setupGame` for the agent/simulator path, so no existing fixtures break. A new `src/index.ts` barrel exposes the public surface a future Worker/client imports. CI runs typecheck + vitest + build under bun.

**Tech Stack:** TypeScript (strict ESM), vitest + fast-check, bun (local + CI), GitHub Actions. No runtime dependencies in the engine.

---

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

---

## Execution Status

**Overall:** Phase 1 ✅ (Task 1.1; Task 1.2 ⏳ Sam) · Phase 2 ✅ · Phase 3 ✅ (gate `baseCount===1` — see Deviations) · Phase 4 ✅ (merged) · Phase 5 🚧 in progress (highest ripple) · Phases 6–7 pending.

| Phase | Status | Ship SHA(s) | Notes |
|---|---|---|---|
| 1 — CI gate + dev protection | ✅ Task 1.1 SHIPPED (PR [#11](https://github.com/scarson/industrial-juggernaut/pull/11) merged); Task 1.2 ⏳ Sam | `6763ba8f` (merge `55210819`) | dev branch-protection command prepared+verified, awaiting Sam (admin) — see Phase 1 banner |
| 2 — Attack validation fixes | ✅ SHIPPED (PR [#12](https://github.com/scarson/industrial-juggernaut/pull/12) merged `0e4d601a`) | `66aff888` | dup-attacker + self-defender guards; 316 tests green |
| 3 — Bootstrap factory-only | ✅ SHIPPED (PR [#13](https://github.com/scarson/industrial-juggernaut/pull/13) merged `d20887a6`) | `e5141074` (+ `de2abfef` pitfalls) | gate `baseCount===1` (NOT `<4`); 320 tests green; GEO-7 added |
| 4 — Type move + representativeDefender + RNG codec | ✅ SHIPPED (PR [#14](https://github.com/scarson/industrial-juggernaut/pull/14) merged `86257f6f`) | `b85bc53e` `a955875e` `c1b02e42` | BoardSource move, defender extract, RNG codec; 329 green |
| 5 — Human-choice setup phase | 🚧 In progress (branch `feat/setup-phase`) | — | highest-ripple phase |
| 6 — Public API barrel | ⬜ Not started | — | depends on 2–5 |
| 7 — Engine-vs-rulebook fidelity audit | ⬜ Not started | — | parallelizable; gates the later client plan |

### Discoveries

- **Cloudflare "Workers Builds" check fails on every commit (expected, non-blocking).** The repo has a Cloudflare Workers Builds Git integration (account `0387b81a…`, service `industrial-juggernaut`) that auto-builds on each push and FAILS because there is no deployable Worker / `wrangler` config yet (all Cloudflare runtime is deferred to the DO-host plan). This is external to GitHub Actions and is NOT the `check` job. **It does not gate merges:** `dev` is unprotected, and the Task 1.2 protection requires ONLY the `check` context (not "Workers Builds"). Every foundation PR will show this one red ✗ alongside a green `check` — that is normal until the DO-host plan adds the Worker (which should make it pass) or it is disabled in the interim. Merge gate for this plan = the `check` job is green.
- **Gitflow is mid-cutover (transient state, execution-critical).** The `dev` and `main` branches exist on origin (`dev` is the integration branch holding all design work; local `main` mirrors `origin/main`), BUT the GitHub default branch is still `main`, there is no branch protection yet, and `docs/git-strategy.md` + `CLAUDE.md`/`AGENTS.md` still describe the OLD single-branch "main-only, no commits to local main, PRs to main" flow. **An executor MUST branch off `dev` and target PRs at `dev`** (per this plan and the File ownership table) — do NOT follow the stale `git-strategy.md` main-only instructions until the cutover lands. The full cutover (default-branch flip to `dev`, branch protection on both, the deploy/promote pipeline, `PROMOTE_TOKEN`, and the `git-strategy.md`/CLAUDE.md/AGENTS.md rewrites) is Task 1.2 (dev protection only) + the deferred DO-host plan (everything else, because it needs a deployable Worker). Source: web-client design spec §6 (atomic-cutover finding).
- **Baseline assumption:** the engine has ~314 passing tests; this plan's TDD builds on that green baseline. The executor MUST confirm `bun run test` is clean on `dev` before starting Phase 2. (Confirmed: 314 green on `dev` before Phase 2.)
- **CODE > rules doc as source of truth (execution-critical; reframes Phase 7).** Sam (2026-06-13): `industrial-juggernaut-rules-v10.md` is the ORIGINAL starting point and predates thousands of rounds of self-play/balance iteration that drove design changes; it was NOT kept in sync. **The engine code + its simulation-validated tests are the source of truth, not the rules doc.** This surfaced in Phase 3 (see Deviations): the rules-doc reading of the bootstrap gate (`<4 bases`) regressed two validated agent tests. **Implication for Phase 7:** the "engine-vs-rulebook fidelity audit" is INVERTED — most code/rules-doc discrepancies are stale-doc, to be catalogued as Digital Edition Rulings (intentional divergences) or rules-doc-update items, NOT engine bugs. Only flag a true bug where the code violates clear *design intent* (balance/correctness), not merely the printed rules. Captured in pitfalls GEO-7 + user memory `code-over-rules-doc-source-of-truth`.

### Deviations

- **Phase 3 — bootstrap gate narrowed to `baseCount === 1`** (from the plan's and spec §5-item-5's `baseCount < 4`, and beyond the planner override's literal `floor(rc/2)===0`). The plan's gate `floor(rc/2)===0 && baseCount<4 && iron>=1 && factories===0` regressed two PRE-EXISTING agent tests (`test/agent/score.test.ts`, `test/agent/heuristic-policy.test.ts`) that pin a multi-base player at resource count 1 building a perimeter-forming 4th base — validated engine behavior. Per Sam's source-of-truth ruling (code > rules doc, see Discoveries), the correct gate is the FOUNDING single-base state: `floor(rc/2)===0 && baseCount===1 && iron>=1 && factories===0`. This keeps all existing tests green with zero changes to them, passes the 3 new bootstrap tests, and adds a direct regression guard plus pitfalls GEO-7. The plan's claim "existing acceptance/agent tests confirm radiating play is intact" was the falsified assumption that surfaced this.

---

## Execution discipline (BINDS EVERY TASK BELOW)

Every task in this plan inherits this block. Each task's final step says "apply the Execution Discipline block" — that means all of the following:

**BEFORE starting any task:**
1. Invoke `superpowers:test-driven-development`.
2. Read `docs/pitfalls/testing-pitfalls.md` and `docs/pitfalls/implementation-pitfalls.md` (the GEO-1..6 entries bind all engine work).
3. Follow TDD: write the failing test → run it red → write minimal code → run it green → refactor green.

**TDD scope (resolves the apparent contradiction with Phase 1/7):** steps 1 and 3 apply to PRODUCTION-CODE tasks — anything editing `src/` (Phases 2–6). Config/docs tasks are NOT TDD per CLAUDE.md scope: **Phase 1** (CI workflow + branch protection) and **Phase 7** (fidelity audit) have no red-green cycle; their "complete" gate is the explicit verification the task names (CI green on a real PR; the audit completion condition). Step 2 (read pitfalls) applies to every task regardless.

**Engine purity invariants (MUST hold for every engine change):**
- No `Math.random()` anywhere; all randomness threads `RngState` per GEO-3.
- No Node-only APIs (`fs`, `process`, `node:*`), no new runtime dependencies — the engine bundles into a Worker and the browser unchanged.
- Hex collections keyed by canonical `key(hex)` strings, never object identity (GEO-4).
- Perimeter/control recomputed at point of use, never cached (GEO-5).
- Nothing in `src/engine`, `src/rng`, `src/board`, `src/index.ts` may import from `src/agent` or `src/driver` at VALUE level (only `import type`), or it drags the agent stack into the future Worker bundle.

**Test discipline (testing-pitfalls.md):**
- Run the suite with `bun run test` — NEVER `bun test` (bun's native runner ignores `vitest.config.ts`).
- Seed every randomized test with a fixed seed (§8). A test that passes only sometimes is a defect — fix the cause, NEVER loosen the assertion to hide it. If an assertion races/flakes, the fix is deterministic synchronization or seeding, not assertion removal. Commit subjects touching assertions state what happened to them.
- Structural assertions over substring: compare hex sets as normalized sorted arrays, game states by structural equality (§8).
- Cover error paths explicitly and assert on the error message text, not just that it threw (§3).

**BEFORE marking any task complete:**
1. Review the new tests against `docs/pitfalls/testing-pitfalls.md` (error paths? edge cases? regime boundaries?).
2. Run `bun run typecheck` and `bun run test`; confirm both green with pristine output (no stray stderr/warnings — testing-pitfalls §1).
3. Commit with an honest, scoped message.

**After completing each PHASE:** review the batch from at least 3 perspectives (correctness, determinism/GEO, test rigor). If round 3 still finds issues, keep going until clean. Update this plan's Execution Status banner + table per the Living Document Contract.

**Worktree/branch:** all work on branches off `dev` (`fix/*`, `feat/*`, `chore/*`) in worktrees under `.claude/worktrees/<slug>`, never on local `main` or `dev` directly. PRs target `dev`.

---

## Test fixture conventions (use these, do not invent)

Every engine test below builds its `GameState` with the existing helper `mkState(opts: MkStateOpts)` from `test/helpers/state.ts`. Read it and the pattern file `test/engine/apply-attack.test.ts` before writing any test. Key facts:

- `mkState({ board: 96, basesP0?: Hex[], basesP1?: Hex[], …basesP5?, iron?: Hex[], factories?: Hex[], config? })`. Hexes are built with `hex(x,y,z)` from `src/geometry/cube` (import `key` too for set assertions).
- It generates the board from a FIXED `seed(1n)` at the given `size`, sets `rngState = seed(1n)`, `phase = { turn: 1, order: [0..n-1], indexInOrder: 0 }` (player 0 moves first), and `basesInHand = 12 − (bases placed for that player)`.
- Player count = highest declared `basesP*` index + 1, floored at 2 (so declaring only `basesP0` still yields an opponent `p1` with no bases / no perimeter).
- **On-board coordinate caveat (carried from `apply-attack.test.ts`):** every BASE hex you pass must be a real coordinate on the seed-1n/size-96 board, or placement/control logic silently misbehaves. `mkState` auto-appends provided `iron` hexes to the board if missing, but does NOT do this for base hexes. Reuse the verified coordinates in `apply-attack.test.ts` (e.g. `hex(2,-2,0)`, `hex(0,-1,1)`, the `ATTACKERS6` set) where possible; if you need new on-board hexes, verify them against `generateBoard(seed(1n), {size:96, ironCount:14}).board.hexes` first.
- **Control/bootstrap fixtures:** to make a player control N iron, pass `iron` hexes within `config.radius` (5) of one of their bases (a `<4`-base player radiates a radius-5 disk). To make a player bootstrap-only, give them 1 base, 1 controlled iron, 0 factories (so `floor(rc/2)===0`). To make them radiating-but-not-bootstrap, give 2 controlled iron (so `floor(2/2)===1`).
- **Golden-capture for refactor-safety tests (Tasks 4.2, 5.1, 5.2):** these assert a refactor leaves behavior unchanged, so the expected value is a snapshot of the CURRENT code. Step 0 of each such task: on a branch off the up-to-date `dev`, run the current function on the fixed input and paste its literal output as the expected constant — BEFORE writing any new code. This golden-capture precedes the red-green cycle (it is the one place "record current behavior" legitimately comes first). Use a fixed-seed, NON-bootstrap state for the Task 4.2 `legalActions` snapshot so it isolates the defender refactor from Phase 3's bootstrap suppression.

## File ownership & execution order (prevents merge conflicts)

Tasks are NOT all independent — several share files. Execute phases in numeric order; within the shared-file set below, the earlier task MUST land (merge to `dev`) before the later one starts, so each branches from an up-to-date `dev`:

| File | Tasks that modify it | Required order |
|---|---|---|
| `.github/workflows/ci.yml` | 1.1 | — (new file) |
| `src/engine/apply.ts` | 2.1 (applyOneAttack), 3.1 (applyBuild) | 2.1 → 3.1 |
| `src/engine/legal.ts` | 3.1 (build emission), 4.2 (representativeDefender) | 3.1 → 4.2 |
| `src/engine/build.ts` | 3.1 | — |
| `src/engine/types.ts` | 4.1 (BoardSource), 5.2 (Phase comments) | 4.1 → 5.2 |
| `src/driver/record.ts` | 4.1 | — |
| `src/rng/codec.ts` | 4.3 | — (new file) |
| `src/engine/turn.ts` | 5.1, 5.2 | 5.1 → 5.2 |
| `src/engine/init.ts` | 5.3 | — (new file) |
| `src/driver/run.ts` | 5.4 (optional) | after 5.3 |
| `src/index.ts` | 6.1 | after 2–5 |
| `docs/**` (DER / pitfalls) | 7.1 | — |

Test files are per-task (`test/engine/setup-phase.test.ts` is shared by 5.1 and 5.2, which are already sequenced 5.1 → 5.2; no other test file is cross-task). **Safe to parallelize** (file-disjoint from everything above and each other): 4.3 (new `src/rng/codec.ts`) and 7.1 (docs only). Task 4.1 touches `types.ts`, which 5.2 also edits — they're already ordered (Phase 4 before Phase 5), so no conflict, but 4.1 is NOT free to run after 5.2. Everything else: sequential. The earlier "phases 2/3/4 are independent" framing was wrong — 2/3 share `apply.ts` and 3/4.2 share `legal.ts`.

---

## Phase 1 — CI gate + dev branch protection

**Execution Status:** ✅ Task 1.1 SHIPPED — `6763ba8f` in PR [#11](https://github.com/scarson/industrial-juggernaut/pull/11) (merged to `dev` `55210819`); the `check` job ran green. Task 1.2 (dev branch protection) ⏳ awaiting Sam — verified command in Task 1.2 below.

CI is config, not production code (TDD does not apply per CLAUDE.md scope), but the workflow MUST be verified green on a real PR before the phase is complete.

### Task 1.1: Add the CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the workflow**

```yaml
name: CI
on:
  push:
    branches: [dev, main]
  pull_request:
    branches: [dev, main]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
      - run: bun run typecheck
      - run: bun run test
      - run: bun run build
```

- [ ] **Step 2: Verify the scripts exist**

Run: `grep -E '"(typecheck|test|build)"' package.json`
Expected: all three scripts present (`typecheck`, `test`, `build`). They are (`tsc --noEmit`, `vitest run`, `tsc -p tsconfig.json`).

- [ ] **Step 3: Commit and open a PR to `dev`**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: typecheck + vitest + build gate on dev/main"
```

- [ ] **Step 4: Verify CI runs green on the PR**

Watch the `check` job on the PR (monitoring tool / `gh pr checks --watch`). Expected: green. Any red is the agent's responsibility to fix (it indicates a pre-existing break the gate just surfaced — investigate, do not disable steps).

- [ ] **Step 5: Apply the Execution Discipline block.**

### Task 1.2: Enable dev branch protection (requires repo admin)

**This is a GitHub settings change, not code.** The `gh api` calls require admin on the personal repo `scarson/industrial-juggernaut`. The snippet below is a STARTING POINT — verify the current GitHub branch-protection / ruleset API shape for personal repos first (the classic `branches/*/protection` endpoint and the newer rulesets API differ, and personal-repo support has changed over time). The executing agent SHOULD prepare the command, confirm its shape, and ask Sam to run it (or run it if the agent has admin-scoped auth).

- [ ] **Step 1: Require the `check` status on `dev`**

```bash
gh api -X PUT repos/scarson/industrial-juggernaut/branches/dev/protection \
  -F required_status_checks.strict=true \
  -F 'required_status_checks.checks[][context]=check' \
  -F enforce_admins=false \
  -F required_pull_request_reviews= \
  -F restrictions=
```

**VERIFIED COMMAND (run by Sam — admin). Prefer this over the `-F` form above:** the classic-protection PUT requires all four top-level keys present and nullable, and `restrictions` MUST be `null` on a user (non-org) repo — `-F restrictions=` sends an empty string, not null, and is rejected. A JSON body via stdin sends proper nulls:

```bash
gh api -X PUT repos/scarson/industrial-juggernaut/branches/dev/protection \
  --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "checks": [{ "context": "check" }] },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null
}
JSON
```

Notes (verified during Phase 1 execution):
- The required status-check context is **`check`** (the job key in workflow `CI`; confirmed from PR #11's run, which surfaced the check as `check`). It deliberately does NOT require the external Cloudflare **"Workers Builds"** check, which fails until a Worker exists (see Discoveries).
- `enforce_admins: false` keeps an admin/break-glass bypass.
- `strict: true` requires a PR branch be up to date with `dev` before merging — fine for sequential single-merger execution.
- Confirmed: the executing agent's token is admin on the repo, but per this plan Sam runs the protection change (the agent prepares + hands off, does not mutate protection).
- Fallback if the classic endpoint is rejected: a repository ruleset (`POST repos/scarson/industrial-juggernaut/rulesets`) with a `required_status_checks` rule on `dev` requiring context `check`. Record whichever was used in the plan's Deviations.

- [ ] **Step 2: Note the deferral of `main` protection + deploy pipeline.**

`main` branch protection, `PROMOTE_TOKEN`, the deploy/promote workflows, `wrangler.jsonc`, and the GitHub default-branch flip to `dev` are DEFERRED to the DO-host plan (the first plan that produces a deployable Worker). Add a Deviations/Discoveries note here pointing at that future plan so the deferral is visible.

- [ ] **Step 3: Apply the Execution Discipline block** (the protection change has no tests; the "complete" gate is: protection visibly active on `dev` and the deferral noted).

---

## Phase 2 — Attack validation fixes (`applyOneAttack`)

**Execution Status:** ✅ SHIPPED — `66aff888` on branch `fix/attack-validation`. Both guards added (`/distinct/i`, `/defender cannot be the target/i`); +2 tests, full suite **316 green**, typecheck clean; independent review APPROVED (confirmed `legalActions` already dedupes attackers and excludes target-as-defender, so no legal action regresses). Minor: test action literals use an explicit `: Action` annotation rather than `as const` (`as const` makes `attacks` a readonly tuple incompatible with the mutable `AttackDecl[]`; behavior identical). Merged via PR [#12](https://github.com/scarson/industrial-juggernaut/pull/12) → `dev` `0e4d601a`.

Two fixes in the same function (`applyOneAttack`, `src/engine/apply.ts`). Do them as one task to avoid same-file churn. Both close holes the future server-authoritative validation relies on (spec §3 Validation; both empirically reproduced in round-1 review).

### Task 2.1: Reject duplicate attacker hexes and self-defending targets

**Files:**
- Modify: `src/engine/apply.ts` (`applyOneAttack`, ~lines 148–185)
- Test: `test/engine/` (add to the existing attack/apply test file; create `test/engine/apply-attack-validation.test.ts` if none fits)

- [ ] **Step 1: Write the failing tests**

```ts
import { hex } from "../../src/geometry/cube";
import { mkState } from "../helpers/state";
import { applyAction } from "../../src/engine/apply";

// All coordinates verified on-board for the seed-1n/size-96 board in apply-attack.test.ts.
const TARGET = hex(2, -2, 0);
const DEFENDER = hex(0, -1, 1);

test("applyAction(attack) rejects duplicate attacker hexes (the six-copies auto-win exploit)", () => {
  // p0 has ONE fresh base; submitting it 6× would (pre-fix) read as commit-6 → auto-win.
  const state = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [TARGET, DEFENDER] });
  const dup = { kind: "attack", attacks: [{ target: TARGET, attackers: [hex(0,0,0), hex(0,0,0), hex(0,0,0), hex(0,0,0), hex(0,0,0), hex(0,0,0)], defender: DEFENDER }] } as const;
  expect(() => applyAction(state, dup)).toThrow(/distinct/i);
});

test("applyAction(attack) rejects the target base as its own defender", () => {
  // 3 distinct fresh attackers in range of TARGET; opponent has only the target base.
  const state = mkState({ board: 96, basesP0: [hex(0,0,0), hex(-1,1,0), hex(0,1,-1)], basesP1: [TARGET] });
  const selfDefend = { kind: "attack", attacks: [{ target: TARGET, attackers: [hex(0,0,0), hex(-1,1,0), hex(0,1,-1)], defender: TARGET }] } as const;
  expect(() => applyAction(state, selfDefend)).toThrow(/defender cannot be the target/i);
});
```

These reuse the exact on-board coordinates the existing `test/engine/apply-attack.test.ts` verified. `mkState` seats p0/p1 bases, sets `rngState = seed(1n)`, and makes player 0 the mover.

- [ ] **Step 2: Run to verify they fail**

Run: `bun run test -- apply-attack-validation`
Expected: FAIL — the duplicate-attacker case currently auto-wins (no throw); the self-defender case currently passes validation (no throw).

- [ ] **Step 3: Add the two checks in `applyOneAttack`**

After the attacker-count check (current ~line 153, before the `attackers.map`):

```ts
  const attackerKeys = new Set(attackers.map((h) => key(h)));
  if (attackerKeys.size !== attackers.length) {
    throw new Error("applyAction(attack): attacker hexes must be distinct");
  }
```

At the start of the defender section (current ~line 171, before `const defenderBase = ...`):

```ts
  if (key(defender) === key(target)) {
    throw new Error("applyAction(attack): defender cannot be the target base itself");
  }
```

- [ ] **Step 4: Run to verify green**

Run: `bun run test -- apply-attack-validation` → PASS. Then full `bun run test` → all green (these are pure additions; no existing legal action produces duplicates or self-defenders, so `legalActions` regression tests stay green).

- [ ] **Step 5: Commit**

```bash
git add src/engine/apply.ts test/engine/apply-attack-validation.test.ts
git commit -m "fix(engine): reject duplicate attackers and self-defending target in applyOneAttack"
```

- [ ] **Step 6: Apply the Execution Discipline block.**

---

## Phase 3 — Bootstrap is factory-only (budget from the bootstrap term)

**Execution Status:** ✅ SHIPPED — `e5141074` (engine + tests) + `de2abfef` (pitfalls GEO-7) on branch `fix/bootstrap-factory-only`. **Gate is `floor(rc/2)===0 && baseCount===1 && iron>=1 && factories===0`** — narrowed from `baseCount<4` during execution (see top-of-plan Deviations + Discoveries: the `<4` gate regressed two validated agent tests; code is source of truth over the rules doc). 320 tests green (3 new bootstrap tests + 1 multi-base regression guard; the 2 agent tests stay green untouched), typecheck clean. Merged via PR [#13](https://github.com/scarson/industrial-juggernaut/pull/13) → `dev` `d20887a6`. (Phase 4 then merged via PR [#14](https://github.com/scarson/industrial-juggernaut/pull/14) → `dev` `86257f6f`.)

**Deviation from spec §5 item 5 wording — read this.** The spec (and the round-2 finder) described the bootstrap gate as "baseCount < 4 && iron >= 1 && factories === 0". That is WRONG: it would suppress the legal radiating-phase 2nd/3rd base placement whenever a sub-4-base player controls iron and has no factory yet (the common early game). The correct gate ALSO requires `floor(resourceCount / 2) === 0` — i.e. the build budget comes ONLY from the bootstrap `+1` term. At `rc >= 2` the player has real budget and a base build is legal radiating play. Record this in the plan's Deviations.

### Task 3.1: `isBootstrapOnly` predicate + factory-only enforcement

> **SHIPPED DEVIATION (read before using the Step 3 code below):** the embedded Step-3 `isBootstrapOnly` uses `baseCount < PERIMETER_BASE_COUNT`, but what SHIPPED is `baseCount === 1` (the founding single base). The `<4` form regressed two validated agent tests; see top-of-plan Deviations + Discoveries and the as-built code in `src/engine/build.ts` (pitfalls GEO-7). The factory-only enforcement in `apply.ts`/`legal.ts` (Steps 4–5) shipped as written.

**Files:**
- Modify: `src/engine/build.ts` (add `isBootstrapOnly`, ~after `buildBudget` at line 71)
- Modify: `src/engine/legal.ts` (build emission, lines 59–67)
- Modify: `src/engine/apply.ts` (`applyBuild`, after the type check ~line 42)
- Test: `test/engine/bootstrap-factory-only.test.ts`

- [ ] **Step 1: Write the failing tests (including the radiating-phase regression guard)**

```ts
import { hex } from "../../src/geometry/cube";
import { mkState } from "../helpers/state";
import { legalActions } from "../../src/engine/legal";
import { applyAction } from "../../src/engine/apply";

// Base at origin; mkState auto-adds provided iron hexes to the board, so they are
// guaranteed on-board and within radius 5 of the base → controlled iron.
const BUILD_HEX = hex(-1, 1, 0); // empty, on-board, within placeRange of origin, not iron

test("bootstrap-only player (rc=1): legalActions offers a factory but no base", () => {
  // p0: 1 base, 1 controlled iron, 0 factories → floor(1/2)=0 → bootstrap-only.
  const state = mkState({ board: 96, basesP0: [hex(0, 0, 0)], iron: [hex(1, 0, -1)] });
  const acts = legalActions(state);
  expect(acts.some(a => a.kind === "build" && a.pieces[0]!.type === "factory")).toBe(true);
  expect(acts.some(a => a.kind === "build" && a.pieces[0]!.type === "base")).toBe(false);
});

test("bootstrap-only player: applyAction(build base) throws factory-only", () => {
  const state = mkState({ board: 96, basesP0: [hex(0, 0, 0)], iron: [hex(1, 0, -1)] });
  expect(() => applyAction(state, { kind: "build", pieces: [{ type: "base", hex: BUILD_HEX }] }))
    .toThrow(/factory-only/i);
});

// REGRESSION GUARD: do NOT suppress legal radiating base placement at rc>=2.
test("radiating player (rc=2, <4 bases, 0 factories): base build stays legal", () => {
  // p0: 1 base, 2 controlled iron, 0 factories → floor(2/2)=1 → NOT bootstrap-only.
  const state = mkState({ board: 96, basesP0: [hex(0, 0, 0)], iron: [hex(1, 0, -1), hex(0, 1, -1)] });
  const acts = legalActions(state);
  expect(acts.some(a => a.kind === "build" && a.pieces[0]!.type === "base")).toBe(true);
  expect(() => applyAction(state, { kind: "build", pieces: [{ type: "base", hex: BUILD_HEX }] })).not.toThrow();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun run test -- bootstrap-factory-only`
Expected: FAIL — currently `legalActions` emits a base build in the rc=1 bootstrap case and `applyBuild` accepts it. (The regression-guard test should already PASS — it asserts current-correct behavior we must not break.)

- [ ] **Step 3: Add `isBootstrapOnly` to `build.ts`**

```ts
/**
 * True when the player's ENTIRE build budget comes from the bootstrap +1 term
 * (i.e. `floor(resourceCount / 2) === 0`) while still pre-perimeter with iron
 * and no factories. In this state the rulebook grants exactly one FACTORY — a
 * base is not buildable. At `rc >= 2` the player has real budget and normal
 * radiating base placement applies, so this returns false.
 */
export function isBootstrapOnly(state: GameState, player: PlayerId): boolean {
  const ctl = control(state, player);
  const rc = ctl.iron.length + ctl.factories.length;
  const baseCount = basesOf(state, player).length;
  return (
    Math.floor(rc / 2) === 0 &&
    baseCount < PERIMETER_BASE_COUNT &&
    ctl.iron.length >= 1 &&
    ctl.factories.length === 0
  );
}
```

(`basesOf`, `control`, `PERIMETER_BASE_COUNT` are already in scope in `build.ts`.)

- [ ] **Step 4: Suppress base emission in `legal.ts`**

In the build block (lines 59–67), compute the flag once and gate the base build:

```ts
  if (buildBudget(state, player) >= 1) {
    const bootstrapOnly = isBootstrapOnly(state, player);
    for (const h of state.board.hexes) {
      if (isLegalFactoryPlacement(state, player, h)) {
        actions.push({ kind: "build", pieces: [{ type: "factory", hex: h }] });
      }
      if (!bootstrapOnly && isLegalBasePlacement(state, player, h)) {
        actions.push({ kind: "build", pieces: [{ type: "base", hex: h }] });
      }
    }
  }
```

Add `isBootstrapOnly` to the existing `./build` import in `legal.ts`.

- [ ] **Step 5: Enforce in `applyBuild` (`apply.ts`)**

After the same-type check (current ~line 42), before the budget check:

```ts
  if (type === "base" && isBootstrapOnly(state, player)) {
    throw new Error("applyAction(build): bootstrap budget is factory-only; cannot build a base");
  }
```

Add `isBootstrapOnly` to the existing `./build` import in `apply.ts`.

- [ ] **Step 6: Run to verify green**

Run: `bun run test -- bootstrap-factory-only` → PASS (all three). Then full `bun run test` → all green (the regression guard plus existing acceptance/agent tests confirm radiating play is intact).

- [ ] **Step 7: Commit**

```bash
git add src/engine/build.ts src/engine/legal.ts src/engine/apply.ts test/engine/bootstrap-factory-only.test.ts
git commit -m "fix(engine): bootstrap budget is factory-only (gate on floor(rc/2)===0, not baseCount)"
```

- [ ] **Step 8: Apply the Execution Discipline block.**

---

## Phase 4 — Type move + representativeDefender + RNG codec

**Execution Status:** ✅ SHIPPED — 4.1 `b85bc53e` (BoardSource→engine types, driver re-exports), 4.2 `a955875e` (extract `representativeDefender`, behavior-preserving), 4.3 `c1b02e42` (RNG codec) + `39f6827c` (review nits) on branch `refactor/engine-types-defender-codec`. 329 tests green, typecheck clean; independent review APPROVED (behavior-preservation of the defender extraction confirmed character-identical; on-board fixtures + genuine equal-distance tie verified; codec round-trips uint64 > 2^53). PR backfilled at Phase 5.

Three independent low-ripple additions. Different files → safe to do in any order.

### Task 4.1: Move `BoardSource` into engine types

**Files:**
- Modify: `src/engine/types.ts` (add `BoardSource`)
- Modify: `src/driver/record.ts` (replace local def with a re-export, lines 27–29)
- Test: `test/driver/` (existing record/driver tests must stay green; add a type-presence smoke if helpful)

- [ ] **Step 1: Add `BoardSource` to `src/engine/types.ts`** (it already defines `BoardDefinition`):

```ts
// Where a game's board comes from: procedurally generated, or a fixed definition.
export type BoardSource =
  | { kind: "generate"; size: number; ironCount: number }
  | { kind: "fixed"; def: BoardDefinition };
```

- [ ] **Step 2: Re-export from `src/driver/record.ts`**

Delete the local `export type BoardSource = ...` (lines 27–29). `record.ts` USES `BoardSource` in `RunOptions.boardSource`, so it needs BOTH a local binding AND a re-export — a bare `export type { BoardSource } from "../engine/types"` alone does NOT create a local binding and `RunOptions` would fail to compile (this is the trap). Update the existing type import to include `BoardSource`, and add the re-export:

```ts
// existing import line gains BoardSource:
import type { BoardDefinition, BoardSource, PlayerId } from "../engine/types";
// and add, so external consumers can still import it from driver/record:
export type { BoardSource } from "../engine/types";
```

- [ ] **Step 3: Run typecheck + tests**

Run: `bun run typecheck && bun run test`
Expected: green. `record.ts`'s `RunOptions` and `runGame` consume `BoardSource` by name; the re-export keeps them working. This removes the tripwire where a wire-format module importing `BoardSource` would otherwise reach into `driver/` (which has a runtime import chain to `agent/`).

- [ ] **Step 4: Commit**

```bash
git add src/engine/types.ts src/driver/record.ts
git commit -m "refactor(engine): move BoardSource into engine types; driver re-exports"
```

- [ ] **Step 5: Apply the Execution Discipline block.**

### Task 4.2: Extract and export `representativeDefender`

**Files:**
- Modify: `src/engine/legal.ts` (extract the nearest-eligible-defender logic, lines 95–108; refactor `legalActions` to call it)
- Test: `test/engine/representative-defender.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("representativeDefender picks the nearest eligible defender, tie by key; null when none", () => {
  // opponent has two fresh in-range bases D1 (nearer) and D2; target T is excluded.
  expect(representativeDefender(state, T, opponentId)).toEqual(D1.hex);
  // when the only candidate is the target itself or all are fatigued/out of range:
  expect(representativeDefender(stateNoEligible, T2, opponentId)).toBeNull();
});

test("legalActions still emits the same attack actions after the refactor", () => {
  // snapshot the current legalActions output for a fixed state BEFORE refactor,
  // assert structural equality (sorted) after.
  expect(sortActions(legalActions(fixedState))).toEqual(EXPECTED_SNAPSHOT);
});
```

Capture `EXPECTED_SNAPSHOT` from the current `legalActions(fixedState)` before refactoring (this is a refactor-safety pin, not new behavior).

- [ ] **Step 2: Run to verify the new-symbol test fails**

Run: `bun run test -- representative-defender`
Expected: FAIL — `representativeDefender` is not exported yet.

- [ ] **Step 3: Add `representativeDefender` to `legal.ts`**

```ts
/**
 * The engine's deterministic representative defender for an attack on `target`
 * owned by `defenderOwner`: the nearest fresh in-range base (distance asc, tie by
 * ascending canonical key), EXCLUDING the target itself. Null when no eligible
 * defender exists (target is then not attackable this round). Shared by
 * legalActions and the future server-side defender policy / timeout auto-pick.
 */
export function representativeDefender(
  state: GameState,
  target: Hex,
  defenderOwner: PlayerId,
): Hex | null {
  const range = state.config.attackRange;
  const eligible = state.bases
    .filter(
      (b) =>
        b.owner === defenderOwner &&
        b.state === "fresh" &&
        key(b.hex) !== key(target) &&
        distance(b.hex, target) <= range,
    )
    .slice()
    .sort((a, b) => {
      const da = distance(a.hex, target);
      const db = distance(b.hex, target);
      if (da !== db) return da - db;
      return key(a.hex) < key(b.hex) ? -1 : key(a.hex) > key(b.hex) ? 1 : 0;
    });
  return eligible.length ? eligible[0]!.hex : null;
}
```

- [ ] **Step 4: Refactor `legalActions` to use it**

Replace the inline `eligibleDefenders` block (lines 98–108) with:

```ts
    const defender = representativeDefender(state, t, opponent);
    if (defender === null) continue;
```

- [ ] **Step 5: Run to verify green**

Run: `bun run test -- representative-defender` → PASS. Then full `bun run test` → all green (the snapshot pin proves `legalActions` is unchanged behavior).

- [ ] **Step 6: Commit**

```bash
git add src/engine/legal.ts test/engine/representative-defender.test.ts
git commit -m "refactor(engine): extract representativeDefender; legalActions reuses it"
```

- [ ] **Step 7: Apply the Execution Discipline block.**

### Task 4.3: bigint↔decimal RNG codec

**Files:**
- Create: `src/rng/codec.ts`
- Test: `test/rng/codec.test.ts`

- [ ] **Step 1: Write the failing property test**

```ts
import * as fc from "fast-check";
import { encodeRng, decodeRng } from "../../src/rng/codec";

test("encode/decode round-trips uint64 RngState bit-exactly (incl. > 2^53)", () => {
  fc.assert(fc.property(fc.bigUintN(64), fc.bigUintN(64), (s, inc) => {
    const r = { state: s, inc };
    const round = decodeRng(encodeRng(r));
    return round.state === r.state && round.inc === r.inc;
  }));
});

test("encoded form survives JSON.stringify/parse (the whole point)", () => {
  const r = { state: 18446744073709551557n, inc: 12345678901234567890n }; // both > 2^53
  const back = decodeRng(JSON.parse(JSON.stringify(encodeRng(r))));
  expect(back.state).toBe(r.state);
  expect(back.inc).toBe(r.inc);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run test -- codec`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the codec**

```ts
// ABOUTME: JSON-safe encoding for the PCG32 RngState bigints (spec §3).
// ABOUTME: Decimal strings; all consumers MUST use BigInt() — never Number()/parseFloat() (precision loss > 2^53).

import type { RngState } from "./pcg";

export type EncodedRng = { state: string; inc: string };

/** RngState → JSON-safe decimal strings (JSON.stringify throws on bigint directly). */
export function encodeRng(r: RngState): EncodedRng {
  return { state: r.state.toString(), inc: r.inc.toString() };
}

/** Decimal strings → RngState. Uses BigInt(); NEVER Number() (would lose precision > 2^53). */
export function decodeRng(e: EncodedRng): RngState {
  return { state: BigInt(e.state), inc: BigInt(e.inc) };
}
```

- [ ] **Step 4: Run to verify green**

Run: `bun run test -- codec` → PASS. Full `bun run test` → green.

- [ ] **Step 5: Commit**

```bash
git add src/rng/codec.ts test/rng/codec.test.ts
git commit -m "feat(rng): bigint<->decimal RngState codec for JSON wire/storage"
```

- [ ] **Step 6: Apply the Execution Discipline block.**

---

## Phase 5 — Human-choice setup phase

**Execution Status:** ⬜ NOT STARTED

**Execution Status:** 🚧 IN PROGRESS — branch `feat/setup-phase` (off `dev` `86257f6f`).

**Highest-ripple phase. The design that keeps it safe:** the setup phase is built so the agent/simulator path (`setupGame`) produces a STRUCTURALLY IDENTICAL state to today (deep `toEqual`, not byte-level serialization). That requires three invariants: (1) placement order during setup is deterministic id-order and consumes NO rng; (2) `representativeFirstBase` reproduces the exact angle-spaced hexes the current `setupGame` seats — its occupied-skip never triggers in all-agent setup because the ideal indices are distinct; (3) the turn-1 order is drawn by the SAME `shuffle(rng, allIds)` call at the SAME rng point (after board-gen, no intervening draws). With all three, an all-agent game via the new init is identical to the old one and no fixtures break.

### Task 5.1: Outer-ring helper + `representativeFirstBase` + `setupPhaseState`

**Files:**
- Modify: `src/engine/turn.ts` (add `outerRingSorted`, `representativeFirstBase`, `setupPhaseState`; extract the seating math from `setupGame` lines 81–96)
- Test: `test/engine/setup-phase.test.ts`

`setupPhaseState` lands HERE (not 5.2) because 5.1's tests need it to build an empty (no-bases) setup state, and `representativeFirstBase`'s occupied-skip can only be tested against such a state.

- [ ] **Step 1: Write the failing tests**

```ts
import { setupPhaseState, representativeFirstBase } from "../../src/engine/turn";
import { generateBoard } from "../../src/board/generate";
import { ringDepthFromEdge } from "../../src/board/shape";
import { seed } from "../../src/rng/pcg";
import { defaultConfig } from "../../src/engine/config";
import { key } from "../../src/geometry/cube";

const board = generateBoard(seed(1n), { size: 96, ironCount: 14 }).board;

// Exact seating equality is pinned in Task 5.2 (structural toEqual vs the golden
// setupGame). Here we test the mapping shape + the occupied-skip fallback only.
test.each([2, 4, 6])("representativeFirstBase: %i distinct deterministic outer-ring picks on an empty setup state", (n) => {
  const s = setupPhaseState(seed(1n), board, n, defaultConfig());
  const picks = Array.from({ length: n }, (_, id) => representativeFirstBase(s, id));
  // all outer-ring:
  for (const h of picks) expect(ringDepthFromEdge(h, board.hexes)).toBe(0);
  // all distinct (so all-agent setup never collides → structural identity holds):
  expect(new Set(picks.map(key)).size).toBe(n);
  // deterministic:
  for (let id = 0; id < n; id++) expect(representativeFirstBase(s, id)).toEqual(picks[id]);
});

test("representativeFirstBase skips an occupied ideal hex (mixed-setup fallback)", () => {
  const n = 4;
  let s = setupPhaseState(seed(1n), board, n, defaultConfig());
  const ideal1 = representativeFirstBase(s, 1);
  // simulate a human (player 0) having taken player 1's ideal hex:
  s = { ...s, bases: [{ owner: 0, hex: ideal1, state: "fresh", order: 0 }] };
  const pick1 = representativeFirstBase(s, 1);
  expect(key(pick1)).not.toBe(key(ideal1));            // skipped the occupied ideal
  expect(ringDepthFromEdge(pick1, board.hexes)).toBe(0); // still an outer-ring hex
});
```

- [ ] **Step 2: Run → FAIL** (`setupPhaseState`/`representativeFirstBase` not exported). `bun run test -- setup-phase`.

- [ ] **Step 3: Add the helpers in `turn.ts`**

```ts
/** Outer-ring hexes (ringDepthFromEdge === 0), sorted by projected angle then key. */
function outerRingSorted(board: Board): Hex[] {
  return board.hexes
    .filter((h) => ringDepthFromEdge(h, board.hexes) === 0)
    .sort((a, b) => {
      const angA = hexAngle(a);
      const angB = hexAngle(b);
      if (angA !== angB) return angA - angB;
      return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
    });
}

/**
 * The deterministic auto-pick first base for `player`. Computes the ideal evenly
 * spaced index (the current setupGame seating math), then scans forward (wrapping)
 * for the first UNOCCUPIED outer-ring hex. In all-agent setup the ideal indices
 * are distinct, so the ideal hex is always free → this returns it unchanged,
 * preserving structural identity with the old setupGame. The skip only triggers
 * in MIXED setup, when a human has taken a hex an agent's ideal would land on.
 */
export function representativeFirstBase(state: GameState, player: PlayerId): Hex {
  const outer = outerRingSorted(state.board);
  const occupied = new Set(state.bases.map((b) => key(b.hex)));
  const ideal = Math.floor((player * outer.length) / state.players.length);
  for (let i = 0; i < outer.length; i++) {
    const h = outer[(ideal + i) % outer.length]!;
    if (!occupied.has(key(h))) return h;
  }
  return outer[ideal]!; // unreachable while outer-ring count >= player count
}

/** The pre-placement setup-phase state: turn 0, id-order placement, no bases yet. */
export function setupPhaseState(rng: RngState, board: Board, nPlayers: number, config: RuleConfig): GameState {
  const players: Player[] = [];
  for (let id = 0; id < nPlayers; id++) {
    players.push({ id, basesInHand: config.baseLimit, alliance: [id], eliminated: false });
  }
  return {
    board, bases: [], factories: [], players,
    phase: { turn: 0, order: players.map((p) => p.id), indexInOrder: 0 },
    factorySupply: config.factorySupply, config, rngState: rng,
  };
}
```

- [ ] **Step 4: Run → PASS.** Full `bun run test` green (these are pure additions; nothing existing imports them yet).

- [ ] **Step 5: Commit**

```bash
git add src/engine/turn.ts test/engine/setup-phase.test.ts
git commit -m "feat(engine): outerRingSorted + occupied-skip representativeFirstBase + setupPhaseState"
```

- [ ] **Step 6: Apply the Execution Discipline block.**

### Task 5.2: `placeFirstBase`, `legalFirstBaseHexes`, and `setupGame` re-expression

**Files:**
- Modify: `src/engine/turn.ts` (add `placeFirstBase`, `legalFirstBaseHexes`; re-express `setupGame`) and `src/engine/types.ts` (update the `Phase` comments for the turn-0 setup convention)
- Test: `test/engine/setup-phase.test.ts` (extend)

(`setupPhaseState` was added in Task 5.1.) Convention: `phase.turn === 0` denotes the setup phase. `phase.order` is the placement order (`[0..n-1]`), `phase.indexInOrder` is the next placer; `bases` grows as placements happen; players start with `basesInHand === baseLimit` (full) and `placeFirstBase` decrements.

- [ ] **Step 0 (golden capture, per the Test fixture conventions):** before changing `setupGame`, record its current output as the golden constant — for EACH of n=2,4,6: `EXPECTED_SETUP[n] = structuredClone(setupGame(seed(1n), board, n, defaultConfig()))`. Paste the literal results into the test.

- [ ] **Step 1: Write the failing tests**

```ts
test.each([2, 4, 6])("re-expressed setupGame is structurally identical to the golden snapshot (%i players)", (n) => {
  // deep equality (toEqual), not byte-level serialization — same shape/values as the old setupGame.
  expect(setupGame(seed(1n), board, n, defaultConfig())).toEqual(EXPECTED_SETUP[n]);
});

test("mixed setup: a human taking another seat's ideal hex still completes legally", () => {
  // Drive setup manually: player 0 (human) deliberately takes player 1's ideal hex;
  // remaining seats auto-pick via representativeFirstBase (which skips occupied).
  let s = setupPhaseState(seed(1n), board, 4, defaultConfig());
  const stolen = representativeFirstBase(s, 1);            // player 1's ideal
  s = placeFirstBase(s, 0, stolen);                        // player 0 takes it (it's outer-ring + unoccupied)
  for (let i = 1; i < 4; i++) {
    const p = s.phase.order[s.phase.indexInOrder]!;
    s = placeFirstBase(s, p, representativeFirstBase(s, p)); // must NOT throw "occupied"
  }
  expect(s.phase.turn).toBe(1);
  expect(s.bases).toHaveLength(4);
  expect(new Set(s.bases.map((b) => key(b.hex))).size).toBe(4); // no two seats share a hex
});

test("placeFirstBase: only the current placer, only an unoccupied outer-ring hex", () => {
  const s0 = setupPhaseState(fixedRng, board, n, config);
  expect(s0.phase.turn).toBe(0);
  expect(() => placeFirstBase(s0, /*wrong player*/ 1, validOuterHex)).toThrow(/not this player/i);
  expect(() => placeFirstBase(s0, 0, interiorHex)).toThrow(/outermost-ring/i);
  const s1 = placeFirstBase(s0, 0, validOuterHex);
  expect(() => placeFirstBase(s1, 1, validOuterHex)).toThrow(/occupied/i); // same hex now taken
});

test("placing the last first base transitions to turn 1 with a drawn order", () => {
  let s = setupPhaseState(fixedRng, board, n, config);
  for (let i = 0; i < n; i++) {
    const p = s.phase.order[s.phase.indexInOrder]!;
    s = placeFirstBase(s, p, representativeFirstBase(s, p));
  }
  expect(s.phase.turn).toBe(1);
  expect(s.phase.indexInOrder).toBe(0);
  expect(s.bases).toHaveLength(n);
});

test("legalFirstBaseHexes lists exactly the unoccupied outer-ring hexes", () => {
  const s0 = setupPhaseState(fixedRng, board, n, config);
  const hexes = legalFirstBaseHexes(s0);
  expect(sortKeys(hexes)).toEqual(sortKeys(unoccupiedOuterRing(board)));
});
```

- [ ] **Step 2: Run → FAIL** (`setupPhaseState`/`placeFirstBase`/`legalFirstBaseHexes` missing; the structurally identical test fails until `setupGame` is re-expressed).

- [ ] **Step 3: Implement** (`setupPhaseState` already exists from Task 5.1)

```ts
/** Unoccupied outermost-ring hexes — the legal first-base placements during setup. */
export function legalFirstBaseHexes(state: GameState): Hex[] {
  const occupied = new Set(state.bases.map((b) => key(b.hex)));
  return outerRingSorted(state.board).filter((h) => !occupied.has(key(h)));
}

/**
 * Place `player`'s first base during the setup phase (turn 0). Validates: setup
 * phase active, `player` is the current placer, `hex` is an unoccupied outermost-
 * ring hex. On the LAST placement, draws the turn-1 order and transitions to turn 1.
 * Consumes NO rng for placement; the turn-1 draw is the SAME shuffle(rng, allIds)
 * the old setupGame used, at the same rng point.
 */
export function placeFirstBase(state: GameState, player: PlayerId, hex: Hex): GameState {
  if (state.phase.turn !== 0) throw new Error("placeFirstBase: not in setup phase");
  const placer = state.phase.order[state.phase.indexInOrder];
  if (placer !== player) throw new Error("placeFirstBase: not this player's setup turn");
  // On-board check FIRST: ringDepthFromEdge assumes h is a board hex; an off-board
  // hex must be rejected before any geometry runs on it.
  if (!state.board.hexes.some((h) => key(h) === key(hex))) throw new Error("placeFirstBase: hex is not on the board");
  if (ringDepthFromEdge(hex, state.board.hexes) !== 0) throw new Error("placeFirstBase: hex must be an outermost-ring hex");
  if (state.bases.some((b) => key(b.hex) === key(hex))) throw new Error("placeFirstBase: hex is already occupied");

  const bases = [...state.bases, { owner: player, hex, state: "fresh" as const, order: player }];
  const players = state.players.map((p) => (p.id === player ? { ...p, basesInHand: p.basesInHand - 1 } : p));
  const nextIdx = state.phase.indexInOrder + 1;

  if (nextIdx < state.phase.order.length) {
    return { ...state, bases, players, phase: { ...state.phase, indexInOrder: nextIdx } };
  }
  const allIds = players.map((p) => p.id);
  const { result: order, rng } = shuffle(state.rngState, allIds);
  return { ...state, bases, players, rngState: rng, phase: { turn: 1, order, indexInOrder: 0 } };
}
```

Re-express `setupGame` as init-plus-auto-place (preserving its signature and exact output):

```ts
export function setupGame(rng: RngState, board: Board, nPlayers: number, config: RuleConfig): GameState {
  let state = setupPhaseState(rng, board, nPlayers, config);
  for (let i = 0; i < nPlayers; i++) {
    const p = state.phase.order[state.phase.indexInOrder]!;
    state = placeFirstBase(state, p, representativeFirstBase(state, p));
  }
  return state;
}
```

- [ ] **Step 3b: Update the `Phase` comments in `src/engine/types.ts`**

The `turn === 0` setup convention makes the current comments false (CLAUDE.md requires evergreen, accurate comments). Update them:

```ts
export type Phase = {
  turn: number; // 0 = setup phase (placing first bases); >=1 = play (full cycles completed + 1)
  order: PlayerId[]; // setup: placement order; play: this turn's round order
  indexInOrder: number; // whose round/placement it is
};
```

- [ ] **Step 4: Run → PASS** (all setup-phase tests incl. the structural-equality snapshots). Then full `bun run test` → ALL green. This is the load-bearing check: if any agent/eval/acceptance test breaks, the structural-identity invariant was violated — STOP and diagnose (do not loosen the test).

- [ ] **Step 5: Commit**

```bash
git add src/engine/turn.ts src/engine/types.ts test/engine/setup-phase.test.ts
git commit -m "feat(engine): human-choice setup phase (placeFirstBase/legalFirstBaseHexes); setupGame re-expressed, structurally identical"
```

- [ ] **Step 6: Apply the Execution Discipline block.**

### Task 5.3: `initGame` (single shared init for client + harness)

**Files:**
- Create: `src/engine/init.ts`
- Test: `test/engine/init.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("initGame produces a setup-phase state; auto-placing all bases equals runGame's seeded setup", () => {
  const s = initGame({ seed: 7n, boardSource: { kind: "generate", size: 96, ironCount: 14 }, nPlayers: 4, config: defaultConfig() });
  expect(s.phase.turn).toBe(0);
  // auto-place via representativeFirstBase and assert structural equality with the driver's internal init:
  let auto = s;
  for (let i = 0; i < 4; i++) { const p = auto.phase.order[auto.phase.indexInOrder]!; auto = placeFirstBase(auto, p, representativeFirstBase(auto, p)); }
  // viaDriver replicates run.ts:38-53 init exactly (seed → generateBoard threading rng → setupGame):
  const rng0 = seed(7n);
  const g = generateBoard(rng0, { size: 96, ironCount: 14 });
  const viaDriver = setupGame(g.rng, g.board, 4, defaultConfig());
  expect(auto).toEqual(viaDriver);
});

test("initGame surfaces born-terminal games (status victory at setup) for the caller to check", () => {
  // initGame returns setup-phase state; the caller runs status() after setup completes.
  // Assert status() on the auto-placed state matches runGame's st0 check for a known born-terminal seed/config, if one exists; otherwise assert status===ongoing for a normal seed.
});
```

- [ ] **Step 2: Run → FAIL** (`initGame` missing). `bun run test -- init`.

- [ ] **Step 3: Implement `src/engine/init.ts`**

```ts
// ABOUTME: initGame — the single shared game-init (board source + setup-phase state) for client and harness.
// ABOUTME: Threads rng per GEO-3 (board-gen advances rng before setup). Pure; no Node APIs, no agent/driver imports.

import { generateBoard } from "../board/generate";
import { loadBoard } from "../board/load";
import { seed } from "../rng/pcg";
import { setupPhaseState } from "./turn";
import type { RuleConfig } from "./config";
import type { Board, BoardSource, GameState } from "./types";

export function initGame(opts: {
  seed: bigint;
  boardSource: BoardSource;
  nPlayers: number;
  config: RuleConfig;
}): GameState {
  let rng = seed(opts.seed);
  let board: Board;
  if (opts.boardSource.kind === "generate") {
    const g = generateBoard(rng, { size: opts.boardSource.size, ironCount: opts.boardSource.ironCount });
    board = g.board;
    rng = g.rng;
  } else {
    board = loadBoard(opts.boardSource.def);
  }
  return setupPhaseState(rng, board, opts.nPlayers, opts.config);
}
```

(Note: this matches `run.ts` lines 38–53 exactly for the board-source/rng-threading, so the auto-placed result equals the driver's `setupGame` path. The born-terminal `status()` check stays a caller responsibility, mirroring `run.ts` lines 70–75 — document this in the function doc.)

- [ ] **Step 4: Run → PASS.** Full `bun run test` green.

- [ ] **Step 5: Commit**

```bash
git add src/engine/init.ts test/engine/init.test.ts
git commit -m "feat(engine): initGame shared init (board source + setup-phase state)"
```

- [ ] **Step 6: Apply the Execution Discipline block.**

### Task 5.4 (OPTIONAL refactor): runGame uses initGame

**Files:** Modify `src/driver/run.ts` (lines 38–53) to call `initGame` + auto-place, removing the duplicated init. Only do this if it keeps every driver/eval/acceptance test structurally identical green. If it perturbs anything, SKIP and note in Deviations — the duplication is acceptable; correctness parity is not negotiable.

- [ ] Apply the Execution Discipline block; commit only if fully green.

---

## Phase 6 — Public API barrel

**Execution Status:** ⬜ NOT STARTED

Depends on Phases 2–5 (so all new symbols exist). Creates the surface a future Worker/client imports, per spec §5 item 1.

### Task 6.1: Populate `src/index.ts`

**Files:**
- Modify: `src/index.ts` (currently `export {};`)
- Test: `test/index-barrel.test.ts`

- [ ] **Step 1: Write the failing smoke test**

```ts
import * as IJ from "../src/index";

test("barrel exports the public engine API", () => {
  for (const name of [
    "initGame","setupGame","applyAction","stepRound","applyEliminations","removeEncircledStrandedBases",
    "advanceRound","currentPlayer","legalActions","status","buildBudget","control",
    "generateBoard","loadBoard","representativeDefender","representativeFirstBase",
    "placeFirstBase","legalFirstBaseHexes","seed","nextUint32","nextFloat","encodeRng","decodeRng","defaultConfig",
  ]) {
    expect(typeof (IJ as any)[name]).toBe("function");
  }
});
```

- [ ] **Step 2: Run → FAIL.** `bun run test -- index-barrel`.

- [ ] **Step 3: Write the barrel** (re-export from each module; types via `export type`):

```ts
// ABOUTME: Public API barrel for the rules engine — the surface a Worker/client imports.
// ABOUTME: Re-exports only; value exports must never pull in src/agent or src/driver.

export { initGame } from "./engine/init";
export { setupGame, currentPlayer, advanceRound, representativeFirstBase, placeFirstBase, legalFirstBaseHexes } from "./engine/turn";
export { applyAction } from "./engine/apply";
export { stepRound } from "./engine/round";
export { legalActions, representativeDefender } from "./engine/legal";
export { buildBudget } from "./engine/build";
export { status, applyEliminations } from "./engine/status";
export { removeEncircledStrandedBases } from "./engine/stranded";
export { control } from "./engine/control";
export { generateBoard } from "./board/generate";
export { loadBoard } from "./board/load";
export { seed, nextUint32, nextFloat } from "./rng/pcg";
export { encodeRng, decodeRng } from "./rng/codec";
export { defaultConfig } from "./engine/config";
export type { RuleConfig, KillBounty } from "./engine/config";
export type {
  Hex, PlayerId, PieceKind, BaseState, Base, Factory, Board, BoardDefinition, BoardSource,
  Player, Phase, GameState, Action, AttackDecl, GameEvent, EliminationCause, RngState,
} from "./engine/types";
export type { EncodedRng } from "./rng/codec";
```

This is the spec §5-item-1 surface plus the setup-phase additions the client needs (`initGame`, `placeFirstBase`, `legalFirstBaseHexes`) and `stepRound` (the canonical round body the future session reuses). Internal predicates (`isBootstrapOnly`, `isLegalBasePlacement`, `isLegalFactoryPlacement`, `farthestBases`, `coalitions`, `coalitionIron`, `resourceCount`, `strandedBases`, `nextInt`) are deliberately NOT public — the client derives hints from `legalActions`/`legalFirstBaseHexes`, not these. The wider engine stays importable by deep path for the harness; the barrel is the minimal external surface.

- [ ] **Step 4: Verify exact symbol names against the modules**

Run: `grep -rnE '^export (function|const|type|interface)' src/engine src/rng src/board | grep -E 'applyEliminations|removeEncircledStrandedBases|defaultConfig|representativeDefender|representativeFirstBase|placeFirstBase|legalFirstBaseHexes|stepRound|initGame'`
Confirm each re-exported name matches its module's actual export. Fix any mismatch (these were enumerated at plan time, but verify — the barrel must `bun run typecheck` clean).

- [ ] **Step 5: Run → PASS.** `bun run test -- index-barrel`, then `bun run typecheck && bun run test` → all green.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts test/index-barrel.test.ts
git commit -m "feat(engine): public API barrel (src/index.ts)"
```

- [ ] **Step 7: Apply the Execution Discipline block.**

---

## Phase 7 — Engine-vs-rulebook fidelity audit (§5 item 9)

**Execution Status:** ⬜ NOT STARTED

Parallelizable; not a code-fix task (no TDD cycle). **Completion condition:** read all of `industrial-juggernaut-rules-v10.md` against `src/engine/**`; every discrepancy becomes either a numbered fix (its own task/PR) or a numbered entry in the spec's Digital Edition Rulings section (`docs/superpowers/specs/2026-06-12-web-client-design.md`); the audit is done when no unresolved discrepancy remains AND Sam has signed off on any new rulings. This gates the LATER client plan (which treats the engine as the authority for human play), not this foundation plan.

### Task 7.1: Run the fidelity audit

**Files:**
- Modify: `docs/superpowers/specs/2026-06-12-web-client-design.md` (Digital Edition Rulings — append new entries) and/or `docs/pitfalls/implementation-pitfalls.md` (new GEO-/rules entries)
- Create: `docs/plans/` follow-up notes if discrepancies need their own fix tasks

- [ ] **Step 1:** Read `industrial-juggernaut-rules-v10.md` section by section against the matching engine module. Known-divergence anchors to confirm are already-ruled (not new findings): convex-hull territory (DER #1), stranded-base model (DER #2), destroy-only maxed capture (DER #3), no-eligible-defender unattackable (DER #4), voluntary-pass illegal (DER #5), first-base free outer-ring choice (DER #6), per-player factory clock + 4th-base triangle (DER #7).
- [ ] **Step 2:** For each NEW discrepancy: classify as bug-to-fix (open a fix task) or intended-digital-ruling (append a DER entry with rationale). The bootstrap factory-only gate (Phase 3) is already captured — reference it.
- [ ] **Step 3:** Record the audit result as a Discoveries subsection in this plan and (if rulings were added) get Sam's sign-off before marking complete.
- [ ] **Step 4: Apply the Execution Discipline block** (documentation task: "complete" = completion condition met + Sam sign-off on any new rulings).

---

## Self-review (planner, completed at write time)

- **Spec coverage:** §5 items 1–9 each map to a task (barrel→6.1; initGame→5.3; dup-attacker→2.1; defender≠target→2.1; bootstrap→3.1; representativeDefender→4.2; BoardSource move→4.1; setup phase→5.1/5.2; fidelity audit→7.1). §6 minimal-CI + dev protection→1.1/1.2 (deploy pipeline explicitly deferred). §7 testing discipline→the Execution Discipline block + per-task TDD. RNG codec (§3) → 4.3.
- **Deviations recorded:** (a) bootstrap gate corrected to require `floor(rc/2)===0` (Phase 3 header); (b) setup phase designed structurally identical to preserve fixtures (Phase 5 header); (c) `main` protection / deploy pipeline / `wrangler.jsonc` / default-branch flip deferred to the DO-host plan (Task 1.2).
- **Type/name consistency:** all re-exported symbols verified against `grep ^export` at plan time; Task 6.1 Step 4 re-verifies before the barrel ships.
- **No placeholders in code steps:** test fixtures use the real `mkState` helper with verified on-board coordinates (see Test fixture conventions).

## Plan review cycle record (`plan-review-cycle`)

Minimum 3 rounds, alternating author self-review with an independent cross-model reviewer, run until a round landed 0 substantive findings.

- **Round 1 — author (Claude/Opus):** 6 findings, all fixed. Test-fixture context gap (no named helper) → added the Test fixture conventions block naming `mkState`; wrong parallelization guidance → added the File ownership & execution order table (2/3 share `apply.ts`, 3/4.2 share `legal.ts`); golden-capture not an explicit step for refactor-safety tests; `placeFirstBase` validation order (on-board before ring-depth); barrel drifted to a superset → trimmed to the spec §5-item-1 surface + setup additions.
- **Round 2 — codex (OpenAI, cross-model, read-only):** 3 P0 + 7 P1 + 3 P2, all applied. P0s: `BoardSource` re-export wouldn't compile (needs import + re-export); Task 5.1 test used `setupPhaseState` before it was defined → moved `setupPhaseState` into 5.1; `representativeFirstBase` ignored occupied hexes (breaks mixed human/agent setup) → added an occupied-skip that preserves all-agent structural identity. P1s: completed the file-ownership table, added the `types.ts` Phase-comment update, wrote out the `viaDriver` parity code, made Phase 2/3 fixtures concrete, added a mixed-setup collision test, resolved the Phase-1 TDD-scope contradiction. P2s: "byte-identical"→"structurally identical", softened the branch-protection command claim, added 2P/6P seating coverage. **Codex independently confirmed both planner overrides are correct** (bootstrap gate `floor(rc/2)===0`; the all-agent structural-equivalence core) and that the Phase 2 fix placements and Phase 6 barrel names are right.
- **Round 3 — author (Claude/Opus):** 1 finding (4 stale "byte-identical" mentions the round-2 reword missed) — fixed.
- **Round 4 — author (Claude/Opus):** 0 substantive findings. Single-definition checks pass (`setupPhaseState`, `representativeFirstBase` defined once each), no placeholder comments remain, imports reference real modules. Cycle complete.

The independent cross-provider round (Round 2, codex) is where the highest-impact findings came from — the three P0s were all author blind spots. That is the alternation mechanism working as intended.
