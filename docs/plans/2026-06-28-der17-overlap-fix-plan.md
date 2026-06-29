# DER #17 — Overlapping-Iron Fix (Option A: `control()` Exclusivity) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the DER #17 exploit — a radiating player must not count iron/factories that sit inside a non-ally opponent's valid perimeter — by making `control()` enforce the rules' "no longer available to adjacent radiating players" exclusivity, and re-validate the balance ripple.

**Architecture:** One semantics change in `src/engine/control.ts`: for a RADIATING player (no valid perimeter), filter controlled `iron` and `factories` to drop any hex inside a non-ally player's valid perimeter hull. Territory (`hexes`) is left unchanged — only resource *ownership* shifts, not reach. The function stays pure and uncached (GEO-5 preserved — it just reads more of `state`). The fix ripples automatically through every `control()` consumer (victory via `status`/`coalitionIron`, build budget via `resourceCount`/`buildBudget`, eliminations, the agents, the snapshot in `run.ts`). The work is the ripple repair + re-validation, not the one function.

**Tech Stack:** TypeScript (strict), Vitest (`bun run test` — never `bun test`), bun-only local env. Geometry helpers in `src/geometry/hull.ts` (`convexHull`, `hexInHull`, `hullArea`) and `src/geometry/cube.ts` (`distance`, `key`).

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

**Overall:** 3/3 phases shipped on branch `claude/zen-kepler-11d22b` (off `origin/dev`). Suite 386 → 395, all green. Exploit closed (heuristic overlap-assisted wins 41 → 0). PR pending.

| Phase | Status | Ship SHA(s) | Notes |
|---|---|---|---|
| 1 — Close the exploit (`control()` + tests) | ✅ Shipped | `eaf9ca24`, `457be6a7`, `e2ba2047` | control() fix + 9 tests |
| 2 — Repair rippled scenario tests | ✅ Shipped | `283e032e` | replay-edges seeds 285→299, 67→990 (regime preserved) |
| 3 — Oracle refactor + re-validation gate | ✅ Shipped | `a0313690` + docs commit | der17-measure decoupled; suite green; distribution documented |

**Phase ordering (hard dependency):** Phase 1 → Phase 2 → Phase 3, sequential. Phase 2's replacement
seeds can only be found against the *fixed* engine (Phase 1 landed in the working tree). Phase 3's
re-validation gate asserts the *whole* suite is green, which requires Phase 2's re-seeds. Do NOT run
these phases in parallel or out of order. All three touch different files, so within-phase there are
no cross-file conflicts.

---

## Background & spec

The investigation, verdict, and fix design are in
[`docs/plans/2026-06-28-der17-overlap-balance-findings.md`](2026-06-28-der17-overlap-balance-findings.md)
(the findings doc — read it first; it is the design source of truth for this change). Reproduction
script: [`scripts/der17-measure.ts`](../../scripts/der17-measure.ts).

**Decision (Sam, pre-authorized):** Option A — fix `control()` itself. This is a deliberate,
planned `control()`-semantics change, not a hot patch. The code/rules-doc divergence here IS a
real, measured bug (the engine is becoming authoritative for human play, and the double-count
rewards a strategy the rules explicitly forbid), so the fix aligns the engine with validated
design intent. This is the documented exception to "code is the source of truth": code wins by
default, but here a measured contradiction with design intent is the thing being corrected.

### What the exploit is (confirmed on current `dev`, 2026-06-28)

`bun scripts/der17-measure.ts 500 --heuristic` on current `dev` reproduces:
**41/363 played-out iron wins (11.29%) are overlap-assisted false victories** — in every one the
winner is a *radiating* player that blanketed the board's iron with radius-5 disks and claimed a
turn-1 iron victory on iron sitting inside opponents' *perimeters*. Under the rules that iron
belongs to the perimetered opponents; the rightful leader (a perimetered player at 8–9 exclusive
iron) would win a few turns later. Greedy self-play is completely immune (0%) — its scoring drives
players to perimeter, so greedy winners' iron is genuinely theirs. The bug is agent-dependent: it
bites the diverse `samplePolicy` heuristic, not greedy.

### Recon already performed (this planning session)

A throwaway spike of the exact fix was applied to `control.ts`, the full suite + typecheck were run,
then reverted. Findings (these make the tasks below concrete rather than "run and see"):

- **Typecheck:** clean.
- **Full suite with the fix: exactly 2 failures**, both in
  [`test/session/replay-edges.test.ts`](../../test/session/replay-edges.test.ts) — and both are
  **scenario-guard** assertions, not the replay-identity assertions:
  - `seed=285, 4p` "bounty/stranding timing" — the guard `events.some(baseDestroyed||baseReplaced)`
    + `events.some(eliminated)` no longer both hold at seed 285 (the shifted heuristic trajectory no
    longer produces that scenario at that seed).
  - `seed=67, 3p` "≥2 commitment levels" — the guard `commitLevels.size >= 2` no longer holds at
    seed 67.
  - The `replay.state == rec.finalState` / `boundaryHashes` identity checks are unaffected. The
    record/replay machinery is correct; only the hand-picked seeds drifted. Tests at seed 256
    (mid-turn elimination) and seed 2 (perimeter crossing) still pass.
- **No acceptance/distribution test broke.** `test/acceptance/play-many.test.ts` uses greedy
  archetypes (immune). `test/eval/distribution.test.ts` uses the heuristic agent but asserts only
  *structural* invariants (fields present, `emptyWinner + realWinner == games`, turns ≥ 1) and
  *logs* the distribution numbers rather than pinning them — so it is robust to the shift by design.
- **`scripts/der17-measure.ts` self-aborts once the fix lands.** Its detector is layered directly on
  production `control()`; once `control()` excludes the overlap iron the detector observes no gap
  (`p0 controls iron=false, der=0, std=0=excl`), the self-test FAILS, and the script `process.exit(1)`
  before measuring. The script is a **pre-fix-only oracle** as written. Phase 3 decouples its detector
  from production `control()` so it stays a valid pre/post oracle. (This is the tautological-coupling
  trap: a measurement that shares its mechanism with the thing it measures can't witness the fix.)

The narrow ripple (2 scenario seeds) is real, not a missed-coverage illusion: the spike exercised the
heuristic path (replay-edges uses it and *did* shift), greedy is genuinely immune, and the distribution
test's robustness is structural. Still — the re-validation gate (Phase 3) re-runs everything and records
the before/after distribution, because "the story is suspiciously clean" warrants confirmation, not trust.

---

## Design decision (settled by Sam, 2026-06-28: iron + factories)

**Subtract resources (iron AND factories), keep territory (`hexes`) unchanged.** This is the
findings-doc-preferred "resource-only" fix (where "resource" = iron + factories, as opposed to
"territory" = the controlled hex set). Rationale:

- The rule speaks of interior *resources* ("iron … no longer available"); the radiating disk still
  physically *reaches* those hexes (line-of-sight, attack reachability), it just can't *harvest*
  them. Leaving `hexes` whole is the more faithful, narrower change.
- `resourceCount = iron + factories` drives `buildBudget` and `isBootstrapOnly`. Subtracting iron
  but NOT factories would recreate the exact "theirs for economy, not victory" inconsistency the
  findings doc rejected in Option B. Symmetric treatment keeps `control()` internally coherent.

**Subtracting factories has THREE downstream consequences. All are judged intended/faithful and are
pinned by tests in Task 1.3 — do not silently drop them:**

1. **GEO-6 factory-death clock** (`applyEliminations`, `ctl.factories.length >= threshold` for
   `<4`-base players). A radiating player whose factories sit inside opponent perimeters now counts
   *fewer* factories → is *less* likely to die by the clock. This is the one consequence that
   *removes a penalty* — the strongest argument for iron-only. Counter-argument (why we still
   subtract factories): the clock models "industry **you control** without territory"; factories you
   don't own shouldn't advance your own death clock any more than they should fund your budget. The
   recon spike showed no death-clock test broke and the acceptance distribution held, so the
   empirical effect is negligible (a radiating player accumulating ≥8 factories all inside opponents'
   hulls is a geometric/economic corner case).
2. **`noIron` elimination** becomes slightly more aggressive: a radiating player whose *entire*
   controlled-iron set sits inside non-ally perimeters now has `ctl.iron.length === 0` → eligible
   for `noIron` elimination (or `emptyPerimeter` self-destruct when it is the acting player). This is
   faithful (it controls no iron of its own) and is the intended correction.
3. **`isBootstrapOnly` / `buildBudget` flip** (surfaced by the codex review round, 2026-06-28). For a
   *single-base* radiating player with one legitimate iron AND one "borrowed" factory inside an
   opponent's perimeter: pre-fix `rc = iron(1) + factories(1) = 2`, `floor(2/2)=1 ≠ 0` →
   `isBootstrapOnly = false` (can build a base). Post-fix the borrowed factory is subtracted →
   `factories = 0`, `rc = 1`, `floor(1/2)=0`, `baseCount===1`, `iron>=1`, `factories===0` →
   `isBootstrapOnly = TRUE` (factory-only). This *changes the legal action space* (the founding
   player can no longer place a base on that budget). It is faithful — a founding single-base player
   whose true resource count is 1 *is* bootstrap-only (GEO-7) — and it is exactly the
   "theirs-for-economy" inconsistency that iron-only would leave open: iron-only would keep funding
   the player's budget from a factory it does not own. **This is the decisive reason to subtract both.**

(Iron-only was the considered alternative — mechanically just dropping the `factories` filter line
and Task 1.3's build/clock tests — but it was NOT chosen; see the binding decision immediately below.)

### Decision (settled by Sam, 2026-06-28): iron + factories

**Sam chose iron + factories** (subtract both). This is binding for execution: Task 1.1 filters BOTH
`iron` and `factories`; Task 1.3 includes all five ripple tests (the factory-clock and bootstrap
tests are NOT skipped). The cross-model (codex) review confirmed the code is sound either way and
flagged that subtracting factories changes the death-clock, `noIron`, and `isBootstrapOnly` behavior
(documented above as intended) — Sam accepted those consequences for
`resourceCount`/`buildBudget`/`isBootstrapOnly` coherence. The iron-only "SKIP" notes elsewhere in
this plan are therefore inactive; ignore them.

---

## File map

- **Modify:** `src/engine/control.ts` — the exclusivity filter (Phase 1, Task 1.1).
- **Modify:** `test/engine/control.test.ts` — new unit tests (Phase 1, Task 1.1).
- **Modify:** `test/engine/status.test.ts` — victory-closure + elimination-ripple tests (Phase 1, Tasks 1.2, 1.3).
- **Modify:** `test/engine/turn.test.ts` — 2-player iron-weighted turn-order ripple test (Phase 1, Task 1.3). `src/engine/turn.ts:194–209` reads `control().iron.length` for the 2-live-player first-player draw — a real consumer of the fix.
- **Modify:** `test/engine/build.test.ts` — `buildBudget`/`isBootstrapOnly` ripple tests (Phase 1, Task 1.3). `src/engine/build.ts` reads `control().iron`/`.factories` for budget + bootstrap gating.
- **Modify:** `test/session/replay-edges.test.ts` — re-seed the two drifted scenario tests (Phase 2, Task 2.1).
- **Modify:** `scripts/der17-measure.ts` — decouple the detector from production `control()` (Phase 3, Task 3.1).
- **Modify:** `docs/pitfalls/implementation-pitfalls.md` — new GEO entry for the exclusivity rule (Phase 3, Task 3.2).
- **Modify:** `docs/plans/2026-06-28-der17-overlap-balance-findings.md` — append the fix outcome + before/after numbers (Phase 3, Task 3.2).
- **Memory:** add a project memory recording the fix + the oracle-decoupling lesson (Phase 3, Task 3.2).

---

## Phase 1 — Close the exploit (`control()` + TDD tests)

**Execution Status:** ✅ SHIPPED at `eaf9ca24` (1.1 control() fix + tests), `457be6a7` (1.2 victory closure), `e2ba2047` (1.3 ripple tests) on 2026-06-28 (branch `claude/zen-kepler-11d22b`). All control tests + 9 new tests green; recon prediction held (pre-fix 2 of 3 control tests fail, ally guard green).

Why this matters (review provenance): subagent-proofing + TDD mandate come from
`/writing-plans-enhanced` Steps 3–4.

### Task 1.1: `control()` exclusivity for radiating players

**Files:**
- Modify: `src/engine/control.ts` (the `control()` function body, lines ~57–60)
- Test: `test/engine/control.test.ts`

**BEFORE starting work:**
1. Invoke `superpowers:test-driven-development`.
2. Read `docs/pitfalls/testing-pitfalls.md`.
3. Re-read `src/engine/control.ts` in full (it is ~67 lines) and the GEO-5/GEO-6/GEO-7 entries in
   `docs/pitfalls/implementation-pitfalls.md`. Confirm the function still recomputes everything per
   call (no caching) after your change.

Follow TDD: write failing tests → implement → verify green.

- [ ] **Step 1: Write the failing tests.** Append to `test/engine/control.test.ts` (inside the
  existing `describe("control", …)` block). The geometry below is the validated self-test fixture
  from `scripts/der17-measure.ts` (a hull around the origin enclosing iron at `(0,0,0)`, with a
  radiating base at `(5,0,-5)`, distance 5 ≤ radius 5):

```typescript
  // DER #17: a radiating player does NOT command iron that sits inside a non-ally
  // opponent's valid perimeter — the perimetered player claims it exclusively.
  it("radiating player excludes iron inside a non-ally opponent's perimeter (DER #17)", () => {
    const ironHex = hex(0, 0, 0);
    const p1Bases = [hex(2, -2, 0), hex(-2, 2, 0), hex(2, 0, -2), hex(-2, 0, 2)]; // hull enclosing origin
    const p0Base = hex(5, 0, -5); // dist 5 to origin (<= radius 5), outside p1's hull
    const s = mkState({ board: 96, basesP0: [p0Base], basesP1: p1Bases, iron: [ironHex] });
    // Territory is unchanged: p0's disk still reaches the iron hex.
    expect(control(s, 0).hexes.has(key(ironHex))).toBe(true);
    // But the iron is NOT p0's — it sits inside perimetered p1's hull.
    expect(control(s, 0).iron.map(key)).not.toContain(key(ironHex));
    // The perimetered owner keeps it.
    expect(control(s, 1).iron.map(key)).toContain(key(ironHex));
  });

  it("ally perimeter does NOT subtract a radiating member's iron (coalition keeps it)", () => {
    const ironHex = hex(0, 0, 0);
    const p1Bases = [hex(2, -2, 0), hex(-2, 2, 0), hex(2, 0, -2), hex(-2, 0, 2)];
    const p0Base = hex(5, 0, -5);
    const base = mkState({ board: 96, basesP0: [p0Base], basesP1: p1Bases, iron: [ironHex] });
    // Make p0 and p1 mutual allies (alliance includes self by convention). Build
    // immutably — do NOT assign s.players[i].alliance in place (matches the
    // `withAlliance` pattern in test/engine/status.test.ts; avoids readonly-field churn).
    const s = {
      ...base,
      players: base.players.map((p) =>
        p.id === 0 ? { ...p, alliance: [0, 1] } : p.id === 1 ? { ...p, alliance: [1, 0] } : p,
      ),
    };
    // Radiating p0 keeps the iron because the perimeter belongs to an ally.
    expect(control(s, 0).iron.map(key)).toContain(key(ironHex));
  });

  it("factories inside a non-ally opponent's perimeter are excluded for a radiating player", () => {
    const facHex = hex(0, 0, 0);
    const p1Bases = [hex(2, -2, 0), hex(-2, 2, 0), hex(2, 0, -2), hex(-2, 0, 2)];
    const p0Base = hex(5, 0, -5);
    const s = mkState({ board: 96, basesP0: [p0Base], basesP1: p1Bases, factories: [facHex] });
    expect(control(s, 0).factories.map(key)).not.toContain(key(facHex));
    expect(control(s, 1).factories.map(key)).toContain(key(facHex));
  });
```

  Note: the existing test "two still-radiating players both control a shared overlap iron"
  (radiating↔radiating) MUST still pass unchanged — the fix only subtracts iron inside a
  *perimeter*, never radiating-vs-radiating overlap. Do NOT modify it.

- [ ] **Step 2: Run the tests to verify they fail.**

  Run: `bun run test -- test/engine/control.test.ts`
  Expected: exactly TWO of the new tests FAIL — "radiating player excludes iron inside a non-ally
  opponent's perimeter" (the `not.toContain` assertion) and "factories inside a non-ally opponent's
  perimeter are excluded" — because current `control()` still includes that overlap iron/factory. The
  "ally perimeter does NOT subtract" test PASSES pre-fix (current `control()` includes the iron, so
  the `toContain` holds both before and after — it is a green regression guard that the fix does NOT
  over-subtract ally perimeters). The pre-existing radiating↔radiating and perimeter tests also PASS.

- [ ] **Step 3: Implement the fix.** In `src/engine/control.ts`, change the final resource
  computation from:

```typescript
  const iron = state.board.iron.filter((h) => hexes.has(key(h)));
  const factories = state.factories.filter((f) => hexes.has(key(f.hex))).map((f) => f.hex);

  return { hexes, iron, factories };
```

  to:

```typescript
  let iron = state.board.iron.filter((h) => hexes.has(key(h)));
  let factories = state.factories.filter((f) => hexes.has(key(f.hex))).map((f) => f.hex);

  // EXCLUSIVITY (DER #17): a RADIATING player does not command resources that sit
  // inside a non-ally opponent's valid perimeter — the perimeter claims its interior
  // iron/factories ("no longer available to adjacent radiating players", rules v10).
  // Perimetered players keep their whole hull interior; ally perimeters never subtract
  // (the coalition keeps the resource via the ally — coalitionIron unions). Only the
  // resource lists shrink; `hexes` (territory/reach) is unchanged. Recomputed every
  // call, never cached (GEO-5) — this just reads other players' bases.
  if (!perimeter) {
    const allies = state.players[player]!.alliance;
    const oppHulls: Hex[][] = [];
    for (const q of state.players) {
      if (q.eliminated || allies.includes(q.id)) continue;
      const qBases = state.bases.filter((b) => b.owner === q.id);
      if (qBases.length < PERIMETER_BASE_COUNT) continue;
      const qHull = convexHull(qBases.map((b) => b.hex));
      if (hullArea(qHull) > 0) oppHulls.push(qHull);
    }
    if (oppHulls.length > 0) {
      iron = iron.filter((h) => !oppHulls.some((hl) => hexInHull(h, hl)));
      factories = factories.filter((h) => !oppHulls.some((hl) => hexInHull(h, hl)));
    }
  }

  return { hexes, iron, factories };
```

  Do NOT:
  - Remove the excluded hexes from `hexes` (territory stays whole — that is the deliberate
    resource-only scope; removing them would change reach/attack semantics).
  - Cache any hull (GEO-5). Recompute per call.
  - Add an `else`/perimeter branch — perimetered players already claim their hull interior; they are
    never subtractees.

- [ ] **Step 4: Run the tests to verify they pass.**

  Run: `bun run test -- test/engine/control.test.ts`
  Expected: all `control` tests PASS (the three new + the four pre-existing).

- [ ] **Step 5: Typecheck.**

  Run: `bun run typecheck`
  Expected: clean (no errors). `q.eliminated`, `state.players[player]!.alliance`, and the
  `hex` imports already exist in `control.ts`'s scope or `Hex`/`convexHull`/`hullArea`/`hexInHull`
  imports — confirm none are missing.

**BEFORE marking this task complete:**
1. Review the new tests against `docs/pitfalls/testing-pitfalls.md` (no mocked behavior; real
   `control()`; assertions are on real output).
2. Verify coverage: radiating-excludes-opponent-perimeter, ally-perimeter-does-not-subtract,
   factory-exclusion, and (pre-existing, unchanged) radiating↔radiating-shared + perimeter-interior.
3. Run `bun run test -- test/engine/control.test.ts` and confirm green.

- [ ] **Step 6: Commit.**

```bash
git add src/engine/control.ts test/engine/control.test.ts
git commit -m "fix(engine): radiating control() excludes iron/factories inside a non-ally perimeter (DER #17)"
```

### Task 1.2: Victory-closure integration test (`status.ts`)

**Files:**
- Test: `test/engine/status.test.ts`

This proves the *exploit* (not just the unit behavior) is closed: a radiating blanketer covering iron
inside opponents' perimeters does NOT reach the iron-victory threshold via `coalitionIron`, while a
legitimate perimetered owner's iron count is intact.

**Dependency:** Task 1.1 MUST be complete (the `control.ts` change is in the working tree). This is
an integration guard layered on the already-implemented unit fix, so it PASSES on first run — that is
expected. Write it test-first anyway and prove (by the documented counterfactual below, not by
reverting) that it would have failed pre-fix.

**BEFORE starting work:** invoke `superpowers:test-driven-development`; read
`docs/pitfalls/testing-pitfalls.md`.

- [ ] **Step 1: Read** `test/engine/status.test.ts` to match its imports/style. It already imports
  `status`, `coalitionIron`, `mkState`, `defaultConfig`, `hex`, `key`. Append the new test inside the
  existing `describe` for victory, or add a focused `describe("DER #17 victory exclusivity", …)`.

- [ ] **Step 2: Write the closure test.** This fixture makes the *victory flip* explicit and
  non-vacuous by lowering `victoryThreshold` to 1: a single iron hex at the origin, enclosed by
  perimetered `p1`'s hull, with radiating `p0` reaching it from outside (distance 5 ≤ radius 5 — the
  validated `der17-measure` self-test geometry). Pre-fix both control it (tie at 1 ≥ threshold 1) and
  the lowest-id tiebreak hands the *false* victory to radiating `p0`; post-fix `p0` is excluded (0),
  so perimetered `p1` rightfully wins.

```typescript
  it("radiating blanketer wins no false iron victory; perimetered owner wins instead (DER #17)", () => {
    const ironHex = hex(0, 0, 0);
    const p1Bases = [hex(2, -2, 0), hex(-2, 2, 0), hex(2, 0, -2), hex(-2, 0, 2)]; // hull encloses origin
    const p0Base = hex(5, 0, -5); // radiating, dist 5 to origin (<= radius 5), outside p1's hull
    const s = mkState({
      board: 96,
      basesP0: [p0Base],
      basesP1: p1Bases,
      iron: [ironHex],
      config: { ...defaultConfig(), victoryThreshold: 1 },
    });
    // Counterfactual (pre-fix): p0's raw disk covers the iron, so coalitionIron(p0) would be 1 >= 1,
    // tying p1 and winning the iron victory on the lowest-id tiebreak — a FALSE victory.
    // Post-fix: the iron sits inside non-ally p1's perimeter, so p0 commands 0 of it.
    expect(coalitionIron(s, [0])).toBe(0);
    expect(coalitionIron(s, [1])).toBe(1);
    const st = status(s);
    expect(st.kind).toBe("victory");
    expect(st.kind === "victory" && st.reason).toBe("iron");
    expect(st.kind === "victory" && st.players).toEqual([1]); // perimetered owner, not radiating p0
  });
```

- [ ] **Step 3: Run the test.**

  Run: `bun run test -- test/engine/status.test.ts`
  Expected: PASS, and ALL pre-existing status tests still PASS (the threshold override is local to this
  fixture; no shared state).

**BEFORE marking this task complete:**
1. Review against `docs/pitfalls/testing-pitfalls.md` — the test asserts structural/semantic outcomes
   (`coalitionIron` counts, `status` winner), not log text; the counterfactual comment documents why
   it bites pre-fix.
2. Run `bun run test -- test/engine/status.test.ts` and confirm green.

- [ ] **Step 4: Commit.**

```bash
git add test/engine/status.test.ts
git commit -m "test(engine): DER #17 — radiating blanketer wins no false iron victory on perimeter-interior iron"
```

### Task 1.3: Ripple-coverage tests (turn order, eliminations, build budget)

**Files:**
- Modify: `test/engine/turn.test.ts`
- Modify: `test/engine/status.test.ts`
- Modify: `test/engine/build.test.ts`

**Dependency:** Task 1.1 complete. These pin the *downstream* behavior changes the design section
calls intended — without them, the existing suite silently passes through real semantic shifts (the
codex review round, 2026-06-28, flagged all three as unpinned). Each test is constructed so it would
have asserted the OPPOSITE pre-fix (documented in a counterfactual comment). **If Sam chose iron-only
in "Open decision for Sam," SKIP the two factory-subtraction tests (1.3-B-clock and 1.3-C-bootstrap)
and note the deviation; keep 1.3-A and 1.3-B-noIron and 1.3-C-budget.**

The shared geometry for these fixtures (reused from the validated self-test): perimetered `p1` hull
`[hex(2,-2,0), hex(-2,2,0), hex(2,0,-2), hex(-2,0,2)]` encloses the origin; radiating `p0` base at
`hex(5,0,-5)` (distance 5 ≤ radius 5) reaches the origin from outside the hull. A "legit" iron/factory
for p0 that is NOT inside p1's hull: `hex(5,-5,0)` (cube distance 5 from p0's base, well outside p1's
small hull). Confirm each `expect` by running; if any geometry assertion is off, fix the hex, not the
assertion.

**BEFORE starting work:** invoke `superpowers:test-driven-development`; read
`docs/pitfalls/testing-pitfalls.md` and the GEO-6/GEO-7 entries in `implementation-pitfalls.md`.

- [ ] **Step A — turn-order ripple (`test/engine/turn.test.ts`).** `src/engine/turn.ts:194–209`: for
  exactly 2 live players the rollover first-player draw is iron-weighted (`wa = control(a).iron.length`,
  `wb = control(b).iron.length`). When `wa === 0 && total > 0`, the drawn `value < wa` is impossible,
  so `b` is seated first *deterministically* (RNG-independent). `advanceRound` triggers this draw at
  rollover (when `indexInOrder` is the last slot) and does NOT run eliminations, so a weight-0 player
  stays in the draw. Add (import `mkState` from `../helpers/state` and `seed` from
  `../../src/rng/pcg` — `seed`, `hex`, `advanceRound` are already imported):

```typescript
  it("DER #17: 2-player iron-weighted draw seats the perimetered owner first when the radiator's only iron is borrowed", () => {
    const ironHex = hex(0, 0, 0);
    const p1Bases = [hex(2, -2, 0), hex(-2, 2, 0), hex(2, 0, -2), hex(-2, 0, 2)]; // hull encloses origin
    const base = mkState({ board: 96, basesP0: [hex(5, 0, -5)], basesP1: p1Bases, iron: [ironHex] });
    // Sit at the end of the turn so advanceRound rolls over and redraws the order.
    const s = { ...base, phase: { ...base.phase, indexInOrder: base.phase.order.length - 1 } };
    // p0 radiating controls 0 iron post-fix (origin sits inside p1's perimeter); p1 controls 1.
    // wa=0, wb=1 => first slot is p1 for EVERY seed. Counterfactual: pre-fix wa=1 (tie), so some
    // seed would have seated p0 first.
    for (const sd of [0n, 1n, 2n, 7n, 99n]) {
      const next = advanceRound({ ...s, rngState: seed(sd) });
      expect(next.phase.order[0]).toBe(1);
    }
  });
```

  Do NOT export new internals from `turn.ts`. Do NOT weaken to "p1 sometimes first" — the weight-0
  case is deterministic; if your fixture isn't deterministic, the fixture is wrong (p0 still controls
  some iron).

- [ ] **Step B — elimination ripple (`test/engine/status.test.ts`), two cases via `applyEliminations`:**

  - **B-noIron:** p0 radiating, single base `hex(5,0,-5)`, its only iron at the origin inside p1's
    perimeter; p1 perimetered. `applyEliminations(s, null)` → p0 is eliminated with cause `"noIron"`
    (post-fix p0 controls 0 iron). Assert the event exists with that cause.

```typescript
    const ironHex = hex(0, 0, 0);
    const p1Bases = [hex(2, -2, 0), hex(-2, 2, 0), hex(2, 0, -2), hex(-2, 0, 2)];
    const s = mkState({ board: 96, basesP0: [hex(5, 0, -5)], basesP1: p1Bases, iron: [ironHex] });
    // Counterfactual: pre-fix p0 controlled the origin iron (1) and survived; post-fix it controls 0.
    const { events } = applyEliminations(s, null);
    expect(events.some((e) => e.kind === "eliminated" && e.player === 0 && e.cause === "noIron")).toBe(true);
```

  - **B-clock (SKIP if iron-only chosen):** p0 radiating single base, a *legit* iron at `hex(5,-5,0)`
    (outside p1's hull) AND a factory at the origin (inside p1's hull); `brokenPerimeterDeathAtFactories`
    lowered to 1 via config. Post-fix p0's controlled factories = 0 (< 1) and it has 1 legit iron, so it
    is NOT eliminated by the factory-death clock. Counterfactual: pre-fix factories = 1 ≥ 1 with
    `baseCount < 4` → eliminated `brokenPerimeterAt18Factories`.

```typescript
    const legitIron = hex(5, -5, 0);   // outside p1's hull, dist 5 from p0 base
    const borrowedFac = hex(0, 0, 0);  // inside p1's hull
    const p1Bases = [hex(2, -2, 0), hex(-2, 2, 0), hex(2, 0, -2), hex(-2, 0, 2)];
    const s = mkState({
      board: 96, basesP0: [hex(5, 0, -5)], basesP1: p1Bases,
      iron: [legitIron], factories: [borrowedFac],
      config: { ...defaultConfig(), brokenPerimeterDeathAtFactories: 1 },
    });
    const { events } = applyEliminations(s, null);
    expect(events.some((e) => e.kind === "eliminated" && e.player === 0)).toBe(false);
```

    Confirm `applyEliminations` and `defaultConfig` are imported in `status.test.ts` (they are).

- [ ] **Step C — build-budget ripple (`test/engine/build.test.ts`), two cases:**

  - **C-budget:** p0 single base, only iron inside p1's perimeter → post-fix `buildBudget(s,0) === 0`
    (no budget from borrowed iron). Counterfactual: pre-fix iron 1 → bootstrap budget 1.

```typescript
    const p1Bases = [hex(2, -2, 0), hex(-2, 2, 0), hex(2, 0, -2), hex(-2, 0, 2)];
    const s = mkState({ board: 96, basesP0: [hex(5, 0, -5)], basesP1: p1Bases, iron: [hex(0, 0, 0)] });
    expect(buildBudget(s, 0)).toBe(0);
```

  - **C-bootstrap (SKIP if iron-only chosen):** p0 single base, a legit iron at `hex(5,-5,0)` AND a
    borrowed factory at the origin inside p1's perimeter → post-fix `isBootstrapOnly(s,0) === true` (the
    flip codex surfaced: factories drop to 0, so a founding single-base player at true rc=1 is
    factory-only). Counterfactual: pre-fix factories 1 → rc 2 → `floor(2/2)=1 ≠ 0` → `isBootstrapOnly` false.

```typescript
    const p1Bases = [hex(2, -2, 0), hex(-2, 2, 0), hex(2, 0, -2), hex(-2, 0, 2)];
    const s = mkState({
      board: 96, basesP0: [hex(5, 0, -5)], basesP1: p1Bases,
      iron: [hex(5, -5, 0)], factories: [hex(0, 0, 0)],
    });
    expect(isBootstrapOnly(s, 0)).toBe(true);
```

    Confirm `isBootstrapOnly` is imported in `build.test.ts` (add it to the existing
    `import { buildBudget, … }` from `../../src/engine/build` if absent).

- [ ] **Step D — run the three files.**

  Run: `bun run test -- test/engine/turn.test.ts test/engine/status.test.ts test/engine/build.test.ts`
  Expected: all pass (existing + new). If any pre-existing test in these files now FAILS, STOP — it was
  not in the recon (which saw 0 failures in these files) and needs investigation, not a blanket update.

**BEFORE marking this task complete:**
1. Each new test has a counterfactual comment proving it bites pre-fix (non-vacuous).
2. Assertions are structural/semantic (elimination cause, budget integer, boolean), not log text.
3. Run the three files; confirm green. Confirm no pre-existing test in them regressed.

- [ ] **Step E — commit.**

```bash
git add test/engine/turn.test.ts test/engine/status.test.ts test/engine/build.test.ts
git commit -m "test(engine): pin DER #17 ripple — turn-order weight, noIron/factory-clock eliminations, build budget/bootstrap"
```

**After completing Phase 1:** Review the batch (Tasks 1.1–1.3) from multiple perspectives. Minimum
3 review rounds: (a) does the fix match the findings-doc design (resource-only on `iron`+`factories`,
ally-aware, GEO-5-pure, `hexes` untouched)? (b) are the tests non-vacuous (each with a pre-fix
counterfactual) and do they cover the ally + factory + radiating↔radiating + turn-order + elimination
+ budget/bootstrap cases? (c) does anything in the fix change `hexes` or cache a hull? If round 3
still finds issues, keep going until clean. Then flip this phase's banner to ✅ SHIPPED with the
commit SHAs.

---

## Phase 2 — Repair the rippled scenario tests

**Execution Status:** ✅ SHIPPED at `283e032e` on 2026-06-28. Re-seeded bounty/stranding 285→299 (4p) and ≥2-commitment-levels 67→990 (3p, observed levels {3,4,5}); regime guards + replay-identity assertions preserved, not weakened. All 4 replay-edges tests green. (Seed 256 was the first bounty/stranding hit but is already used by the mid-turn-elimination test, so 299 was chosen.)

The recon identified the *exact* two tests that break and *why*: the balance shift moves which seeds
exhibit which regime. The fix is to re-seed each test to a seed that exhibits the *same* targeted
regime under the *fixed* engine — preserving the test's purpose (replay equivalence at that regime
boundary). This is "update the test to reflect corrected behavior and verify the new expectation is
right," NOT "make it pass." Do NOT weaken or delete the regime guard — the guard exists to prevent
silent no-op replay tests, and that protection MUST survive.

### Task 2.1: Re-seed the two drifted replay-edges scenario tests

**Files:**
- Modify: `test/session/replay-edges.test.ts`

**BEFORE starting work:** read `test/session/replay-edges.test.ts` in full and
`docs/pitfalls/testing-pitfalls.md`. Note the two passing tests (seed 256 mid-turn elimination, seed 2
perimeter crossing) must remain untouched and green.

- [ ] **Step 1: Confirm the two failures** (with the Phase-1 fix in place).

  Run: `bun run test -- test/session/replay-edges.test.ts`
  Expected: FAIL on "bounty/stranding timing (seed=285, 4p)" (regime guard at line ~33–34) and
  "≥2 commitment levels in attacks (seed=67, 3p)" (regime guard at line ~71). The mid-turn-elimination
  and perimeter-crossing tests PASS.

- [ ] **Step 2: Find a replacement seed for the bounty/stranding test.** Create a tiny throwaway probe
  **at `scripts/_probe.ts`** (in `scripts/` so the `../src/...` and `../test/...` relative imports
  resolve exactly as they do in `scripts/der17-measure.ts` — a scratchpad-dir file would NOT resolve
  these imports). Run it, record the seed, then `rm scripts/_probe.ts` — do NOT commit it. It scans
  `seed = 0n..400n` with `recordGame(heuristicHeader(4, { seed }), { turnCap: 400 })` for the first
  seed whose events satisfy BOTH `events.some(e => e.kind === "baseDestroyed" || e.kind ===
  "baseReplaced")` AND `events.some(e => e.kind === "eliminated")`. Pattern:

```typescript
// scripts/_probe.ts (throwaway — delete after, do not commit)
import { recordGame } from "../src/session/record";
import { heuristicHeader } from "../test/session/helpers";
for (let s = 0n; s <= 400n; s++) {
  const rec = recordGame(heuristicHeader(4, { seed: s }), { turnCap: 400 });
  const destroyed = rec.events.some(e => e.kind === "baseDestroyed" || e.kind === "baseReplaced");
  const elim = rec.events.some(e => e.kind === "eliminated");
  if (destroyed && elim) { console.log("bounty/stranding seed:", s.toString()); break; }
}
```

  Run it with `bun scripts/_probe.ts`. Record the seed it prints. If NO seed in `0n..400n` satisfies
  the condition (the loop prints nothing), widen the range to `0n..2000n` and re-run; if still nothing,
  STOP and report — do not relax the regime guard to make a weaker seed fit. (With the heuristic agent
  and these regimes, a match well under 400 is expected.)

- [ ] **Step 3: Find a replacement seed for the ≥2-commitment-levels test.** Same `scripts/_probe.ts`
  approach (run, record, delete, do not commit), 3p, turnCap 200, condition: distinct `attack`-entry
  commitment levels (`decl.attackers.length`) ≥ 2:

```typescript
// scripts/_probe.ts (throwaway — delete after, do not commit)
import { recordGame } from "../src/session/record";
import { heuristicHeader } from "../test/session/helpers";
for (let s = 0n; s <= 400n; s++) {
  const rec = recordGame(heuristicHeader(3, { seed: s }), { turnCap: 200 });
  const levels = new Set(rec.log.filter(e => e.kind === "attack").map(e => (e as any).decl.attackers.length));
  if (levels.size >= 2) { console.log("commitment-levels seed:", s.toString(), [...levels]); break; }
}
```

- [ ] **Step 4: Update the two seeds in `test/session/replay-edges.test.ts`.** Replace `285n` → the
  bounty/stranding seed and `67n` → the commitment-levels seed found above. Update each test's
  docstring comment to the new seed number and keep the regime description accurate. Do NOT change
  the guard assertions or the replay-identity assertions. If the test title embeds the old seed
  (e.g. "(seed=285, 4p)"), update the title too.

- [ ] **Step 5: Run the full replay-edges file.**

  Run: `bun run test -- test/session/replay-edges.test.ts`
  Expected: all 4 tests PASS — both re-seeded tests now satisfy their regime guard AND the replay
  identity (`replay.state == rec.finalState`, `boundaryHashes` equal).

**BEFORE marking this task complete:**
1. Verify the regime guard still asserts the regime (you re-seeded, you did NOT weaken). The commit
   subject MUST say the seeds were re-pointed to preserve the regime, not that assertions were relaxed.
2. Confirm the two previously-passing tests (256, 2) are byte-for-byte unchanged and still green.
3. Run `bun run test -- test/session/replay-edges.test.ts` — all green.

- [ ] **Step 6: Commit.**

```bash
git add test/session/replay-edges.test.ts
git commit -m "test(session): re-seed DER #17-drifted replay-edges scenarios (regime preserved, not weakened)"
```

**After completing Phase 2:** 3-round review — (a) are the new seeds genuinely exhibiting the regime
(not a guard that now trivially passes)? (b) are the two untouched tests still untouched? (c) does the
commit message truthfully describe a re-seed, not an assertion relaxation? Flip the banner to ✅ SHIPPED.

---

## Phase 3 — Oracle refactor + re-validation gate

**Execution Status:** ✅ SHIPPED — Task 3.1 (oracle decouple) at `a0313690`; Task 3.2 (docs + memory + banners) in the same docs commit, on 2026-06-28. der17-measure self-test PASSES post-fix; heuristic overlap-assisted wins 41 → 0, greedy 0; full suite 386 → 395 green; distribution shift documented in the findings doc; pitfall GEO-8 added.

### Task 3.1: Make `der17-measure.ts` a valid pre/post-fix oracle

**Files:**
- Modify: `scripts/der17-measure.ts`

This is a SCRIPT — TDD does not apply (CLAUDE.md scope: scripts excluded). The deliverable is a
self-test that PASSES post-fix and a closure statistic.

**The problem (from recon):** the script's detector (`overlapSnapshot`, `derSubtractableSnapshot`,
`exclusiveIronCount`'s std reference, `winnerIron`'s `stdSet`, and `selfTest`) reads
`control(state, p).iron` as the "standard/overlapping" baseline. Once `control()` enforces
exclusivity, that baseline already excludes the overlap, so the detector sees no gap and `selfTest()`
aborts the script. The detector must measure the gap between the **pre-fix radiating disk** and the
exclusive rule — independent of production `control()`.

- [ ] **Step 1: Add an independent raw-radiating-iron helper** near `validHull` in the script:

```typescript
/**
 * The PRE-FIX radiating-disk iron for player p, computed independently of production
 * control() so the detector can witness the overlap gap even after control() enforces
 * exclusivity. Perimetered players are unaffected by the DER #17 fix, so for them this
 * equals control().iron; for radiating players it is the raw radius-disk iron with NO
 * exclusion (what control() returned BEFORE the fix).
 */
function rawRadiatingIron(state: GameState, p: PlayerId): Hex[] {
  if (validHull(state, p)) return control(state, p).iron; // perimetered: unchanged by the fix
  const bases = state.bases.filter((b) => b.owner === p);
  const r = state.config.radius;
  return state.board.iron.filter((h) => bases.some((b) => distance(b.hex, h) <= r));
}
```

  Add `distance` to the existing `import { key } from "../src/geometry/cube"` line:
  `import { distance, key } from "../src/geometry/cube";`

- [ ] **Step 2: Route the detector's "standard/overlap" reads through `rawRadiatingIron`.** Replace
  `control(state, p).iron` with `rawRadiatingIron(state, p)` in exactly these places (the std/overlap
  baseline — NOT the exclusive computations, which stay as the rule):
  - `overlapSnapshot`: the `control(pl.id).iron` loop building `owners`.
  - `derSubtractableSnapshot`: the `control(state, pl.id).iron` loop.
  - `exclusiveIronCount`: the `const stdIron = control(state, p).iron;` line.
  - `winnerIron`: change the `for (const h of control(state, m).iron)` loop to iterate
    `rawRadiatingIron(state, m)`. Then `stdSet` = raw, and `exclSet` (the existing `if (myHull ||
    !oppHulls.some(...))` membership test, kept verbatim) = raw filtered by the exclusive rule — so
    std and excl derive from the same independent raw source, and the metric is decoupled from
    production `control()`.
  - `selfTest`: `p0Ctl` and `std0` must use `rawRadiatingIron(st, 0)` so the detector sees the
    overlap; `excl0` stays `exclusiveIronCount`. The `derSubtractableSnapshot` call already routes
    through the helper via the change above.

  Do NOT change the `--inspect` block's winner/perimeter reporting (it is descriptive, not a gate),
  except where it computes "of N controlled iron, M inside an opponent's perimeter" — leave it using
  production `control()` so it reports the POST-fix engine reality.

- [ ] **Step 3: Verify the self-test passes WITH the Phase-1 fix in place.**

  Run: `bun scripts/der17-measure.ts 1 --heuristic`
  Expected: `[self-test] … => PASS (detector fires)` — the detector now witnesses the overlap via the
  raw helper even though production `control()` excludes it. (If it still FAILs, a std reference was
  missed in Step 2.)

- [ ] **Step 4: Run the closure measurement.**

  Run: `bun scripts/der17-measure.ts 500 --heuristic`
  Expected: self-test PASS; **OVERLAP-ASSISTED wins drop to ~0** (target 0, the findings doc's 41
  false victories closed) because `status()` (using fixed `control()`) no longer awards radiating
  blanketers the iron victory. The "EXACT DER bug condition" boundary count (raw radiating iron inside
  opponent perimeters) MAY remain non-zero — that measures *raw* overlap, which still physically
  exists; what matters is that it no longer converts to a *win*. Record the exact output.

  Also run greedy for completeness: `bun scripts/der17-measure.ts 1000` → expect overlap-assisted
  wins still 0 (greedy was always immune) and self-test PASS.

- [ ] **Step 5: Commit.**

```bash
git add scripts/der17-measure.ts
git commit -m "test(script): decouple der17-measure detector from control() so it validates the fix (oracle, not tautology)"
```

### Task 3.2: Re-validation gate + documentation + memory

**Files:**
- Modify: `docs/pitfalls/implementation-pitfalls.md`
- Modify: `docs/plans/2026-06-28-der17-overlap-balance-findings.md`
- Memory: `/Users/sam/.claude/projects/-Users-sam-Code-industrial-juggernaut/memory/`

- [ ] **Step 1: Full suite green.**

  Run: `bun run test`
  Expected: all tests pass. Baseline was 386 tests; this plan ADDS tests and changes 2 seeds (no
  removals): Task 1.1 +3 (control), Task 1.2 +1 (status victory), Task 1.3 +5 with iron+factories
  (turn-order, noIron, factory-clock, budget, bootstrap) or +3 with iron-only (drop factory-clock +
  bootstrap) → ~394 (or ~392 iron-only). Treat the exact count as informational, not a gate; the gate
  is "all green." If anything beyond the already-handled replay-edges tests fails, STOP — it was not in
  the recon and needs investigation (do not blanket-update).

- [ ] **Step 2: Capture the before/after distribution.** The `distribution.test.ts` heuristic run
  logs `byVictoryType / emptyWinner / realWinner / ironVictories / capHits` and the turns histogram.
  Capture the numbers from a current run:

  Run: `bun run test -- test/eval/distribution.test.ts 2>&1 | grep "\[distribution\]"`
  Compare against the pre-fix baseline (re-run on `origin/dev` if not recorded, or note it was not
  separately captured). Record both in the findings doc (Step 4). The shift is expected to be modest
  (the bug is heuristic-turn-1-specific); the point is to *document* it, not to hit a target.

- [ ] **Step 3: Add a pitfalls entry.** In `docs/pitfalls/implementation-pitfalls.md`, add a new
  entry (next GEO-N number, after GEO-7) titled something like "Radiating Control Excludes Non-Ally
  Perimeter Interior (DER #17)". Cover: the rule ("interior resources no longer available to
  radiating neighbors"), the scope (iron + factories, NOT `hexes`; ally perimeters never subtract;
  GEO-5 preserved), the two flagged interactions (GEO-6 death clock weakening; more-aggressive
  `noIron` for fully-borrowed radiators), and a one-line review-checklist bullet. Match the voice of
  the existing GEO-6/GEO-7 entries (The Flaw / Why It Matters / The Fix / The Lesson where it fits).
  Also add the checklist bullet to the "Review Checklist" section.

- [ ] **Step 4: Append the fix outcome to the findings doc.** In
  `docs/plans/2026-06-28-der17-overlap-balance-findings.md`, add a short "## Resolution (2026-06-28)"
  section: Option A shipped, link to this plan and the merged PR, the before/after overlap-assisted
  win statistic (41 → ~0), the before/after distribution numbers from Step 2, and the
  oracle-decoupling note (the script now uses an independent raw baseline). Keep the original
  investigation text intact (it is the historical record).

- [ ] **Step 5: Write a project memory.** Memory dir:
  `/Users/sam/.claude/projects/-Users-sam-Code-industrial-juggernaut/memory/`. Create a new file
  `der17-control-exclusivity.md` with this exact frontmatter shape (matching the existing memory
  files in that dir):

```markdown
---
name: der17-control-exclusivity
description: DER #17 closed — radiating control() excludes iron/factories inside non-ally perimeters; oracle-decoupling lesson
metadata:
  type: project
---

DER #17 closed via `control()` resource-exclusivity (Option A): a radiating player no longer counts
iron/factories inside a non-ally opponent's valid perimeter. Reusable lesson — **oracle-decoupling**:
a measurement script whose detector is layered on the production function it measures will self-abort
once the function is fixed; give the detector an independent baseline so it validates both pre- and
post-fix states. See [[tautological-mutual-consistency-tests]] and [[code-over-rules-doc-source-of-truth]].
```

  Then add one line to `/Users/sam/.claude/projects/-Users-sam-Code-industrial-juggernaut/memory/MEMORY.md`:
  `- [DER #17 control exclusivity](der17-control-exclusivity.md) — radiating control() drops borrowed perimeter iron/factories; oracle-decoupling lesson`.
  This memory dir is under `~/.claude/`, NOT in the repo — write it but do NOT `git add` it. If the
  dir is unavailable in the executing environment, skip this step and note the deviation in the plan.

- [ ] **Step 6: Commit.**

```bash
git add docs/pitfalls/implementation-pitfalls.md docs/plans/2026-06-28-der17-overlap-balance-findings.md
git commit -m "docs: record DER #17 resolution — control() exclusivity, before/after distribution, oracle-decoupling lesson"
```

  (Commit the memory files separately if the memory dir is outside the repo; it is under
  `~/.claude/`, so it is NOT part of this repo's git — write it but do not `git add` it.)

**After completing Phase 3:** Final 3-round review — (a) is the suite fully green with no
unexplained changes? (b) does the documented distribution shift match what shipped? (c) is the
oracle self-test genuinely passing post-fix (not silently skipped)? Flip the banner to ✅ SHIPPED.

---

## Integration & PR

- [ ] **Branch:** all work is on a branch off `origin/dev` (this worktree's
  `claude/zen-kepler-11d22b`, already at `origin/dev` HEAD — or a fresh `fix/der17-overlap` cut from
  `origin/dev`). `dev` is checked out in the main worktree, so do NOT `git checkout dev` here.
- [ ] **Final gate:** `bun run test` green; `bun run typecheck` clean.
- [ ] **PR to `dev`** with a `## Merge classification` heading. Suggested classification:
  **Review — data-integrity / architecture** (this changes a core engine contract — `control()`
  semantics — that feeds victory, economy, and the agents; it is a deliberate balance change). Include
  in the PR body: the before/after overlap-assisted-win statistic, the distribution shift, the list of
  rippled tests and how each was resolved (re-seed, not weaken), and the settled design decision
  (resource-only iron+factories) with the flagged GEO-6/`noIron` interactions.
- [ ] **Merge on green `check`.** The red Cloudflare "Workers Builds" check is expected noise, not a
  gate. Merge with `gh pr merge <N> --merge` (NOT `--squash`/`--rebase`), then delete the branch
  manually (`--delete-branch` errors locally in this setup).

---

## Self-review (writing-plans Step: run by the author before review cycle)

- **Spec coverage:** findings-doc Option A (control fix) → Task 1.1; victory-closure proof → Task 1.2;
  ripple repair → Task 2.1; re-validation (`der17-measure` → ~0, acceptance/distribution, documented
  shift) → Phase 3. ✅ All findings-doc deliverables mapped.
- **Placeholder scan:** every code/seed step shows the actual code or the exact probe to derive the
  value; the two replacement seeds are derived by a specified probe rather than hardcoded (they depend
  on the fixed engine, so they cannot be known until Phase 1 lands — the probe is the concrete
  procedure). No "TBD"/"handle edge cases"/"add validation" placeholders.
- **Type consistency:** `control()` returns `{ hexes, iron, factories }` throughout; `rawRadiatingIron`
  returns `Hex[]`; helper/field names match `control.ts` and the script.
- **Open design question** (resource-only iron+factories vs iron-only): settled as iron+factories with
  the counter-argument documented; routed to the codex/review round + Sam, not silently decided.
