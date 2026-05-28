# Testing Pitfalls

Test scenario checklist for reviewing coverage of any feature. Every item on this list exists because it catches bugs that have occurred in real codebases. Items marked with **🔥 Found in this project** were discovered here specifically. Unmarked items are universal — bugs we haven't made *yet* in this project, but that have bitten other projects hard enough to be worth testing against. Do not deprioritize an unmarked item because it lacks a marker.

> **Relationship to implementation-pitfalls.md:** `implementation-pitfalls.md` specifies *what* to implement and *why*. This document specifies *how to verify* those implementations work correctly. Cross-references between the two are noted inline.

---

## How to Use This Document

**If you're writing tests:** Go to the relevant topic sections below, read the checklist items, and verify your test suite covers each one that applies. Unchecked items are gaps — either add a test or explicitly note why the item doesn't apply to this feature.

**If you're reviewing tests:** Use the checklist to audit coverage gaps. A passing test suite with missing coverage is worse than a failing test suite with complete coverage — you don't know what's actually protected.

**If you're maintaining this document:** When a real bug slips through to production or staging because of a missing test, add the check item to the appropriate section with the 🔥 marker and a one-line note about the observed failure mode. See §How to Add a Testing-Pitfall at the end.

---

## 1. Test Output Pristine

Test output MUST be clean for the suite to pass — no stray errors, warnings, or stack traces. If a test legitimately produces errors (e.g. it's verifying error handling), capture them explicitly and assert on their content. Silent error spam in test output hides real failures.

- [ ] **No unexpected stderr in passing tests.** Any stderr output from a passing test must be explicitly asserted on, or the test is lying about what it verifies.
- [ ] **No unhandled promise rejections / uncaught exceptions.** These often appear as warnings rather than test failures; configure your runner to fail on them.
- [ ] **Deprecation warnings fail the suite or are explicitly tracked.** Silently-warned deprecations become hard breaks on the next runtime upgrade.
- [ ] **Test output doesn't contain debug prints.** Debug statements that escaped into production tests are sometimes the only evidence of a half-finished implementation.

---

## 2. Skipped Tests Are Not Passing Tests

A test that's `skip`ped, `xit`'d, `pending`, or `@Ignore`d is a test that's not running. A CI job that says "100 tests passed, 5 skipped" is NOT the same as "105 tests passed."

- [ ] **No unexplained skips in the suite.** Every skipped test has a comment explaining why it's skipped and under what condition it should be re-enabled.
- [ ] **Skips with a linked issue/ticket.** A skip without follow-up context is forgotten work.
- [ ] **CI distinguishes skipped from passed in its summary.** If the report doesn't separate them, skipped failures hide.
- [ ] **Skip counts are tracked over time.** Growing skip count = eroding coverage.

---

## 3. Error Path Coverage

Silent error swallowing is one of the largest bug categories in any codebase. Every error path must be tested explicitly — not just "the happy path works."

- [ ] **Each error branch has a test that triggers it.** If a function has 5 ways to return an error, there are 5 tests covering each one.
- [ ] **Error messages are asserted, not just error presence.** `expect(err).toBeTruthy()` doesn't catch "wrong error returned"; `expect(err.message).toMatch(/expected pattern/)` does.
- [ ] **Information leakage via error codes checked.** When a handler must return the same status code regardless of whether a resource exists (anti-enumeration), test that ALL error paths return the same status — including DB errors on post-lookup queries that leak existence.
- [ ] **Error-path side effects verified.** If an error path is supposed to roll back state / release a lock / clear a cache, assert that it did.
- [ ] **Error-path resource cleanup verified.** Acquired resources (file handles, DB connections, semaphores) must be released even on error. Test with `defer`-equivalent patterns or explicit cleanup assertions.

---

## 4. Negative Property Testing

Happy-path tests prove "it works" for one input. Negative property tests prove "it doesn't break" under stress, boundaries, and adversarial input. The latter catches the bugs that ship.

- [ ] **Cleanup and eviction.** When code accumulates state (maps, caches, queues), test that stale entries are eventually cleaned up. Don't just test "it works" — test "it doesn't leak."
- [ ] **Bounded growth.** For any in-memory data structure that grows with external input, test that it has a maximum size or eviction policy. Simulate 1000+ entries and verify memory is bounded.
- [ ] **Case sensitivity where identity matters.** When a string key is used for identity (email, username, path), test that case variations are treated consistently. `Admin@Example.com` and `admin@example.com` must be the same identity — or consistently different ones.
- [ ] **Empty / null / zero inputs.** Every parameter that accepts a value should be tested with empty string, null, zero, empty array, empty map. "Did not crash" is not the same as "handled correctly."
- [ ] **Oversized inputs.** Long strings, deeply nested structures, large collections. Where are your truncation / rejection boundaries, and are they enforced?
- [ ] **Unicode / encoding edge cases.** Multi-byte chars, combining sequences, RTL text, emoji, zero-width joiners, NUL bytes. Anywhere strings cross a boundary (storage, display, comparison) needs this.

---

## 5. Concurrency & TOCTOU

If the code can be executed concurrently, test it concurrently. Single-threaded happy-path tests don't catch race conditions.

- [ ] **Multi-step flows under concurrent access.** When a flow reads state then writes state (check-then-act), test two callers racing through the same flow simultaneously. Use a barrier / sync primitive to ensure they hit the critical section at the same time — `WaitGroup` / `Promise.all` alone doesn't guarantee simultaneity.
- [ ] **"Use once" tokens consumed correctly.** Any token that should be single-use (password reset, verification code, invitation) must be tested with two concurrent consumers. Exactly one must succeed.
- [ ] **Rate-limit enforcement under concurrency.** Count-then-insert rate limits can be bypassed by concurrent requests that all read the same count before any insert. Test with burst requests.
- [ ] **Idempotency under retry/concurrency.** If an operation should be idempotent (accepting an invitation twice, retrying a failed payment), test concurrent execution — the second attempt must not produce a 500 from a constraint violation.
- [ ] **Bootstrap / first-time races.** First-user, first-org, or any "only if none exist" flow tested with concurrent attempts. Exactly one must win.

---

## 6. Boundary & Configuration Validation

Configuration errors, bad boundaries, and missing validation are a surprisingly large portion of production incidents. Test the edges.

- [ ] **Default values are tested.** What does the code do when a config value is absent? Crash? Use a default? Silently use zero? All three are possible; the right behavior needs a test.
- [ ] **Invalid config is rejected at load time.** A system that loads invalid config, then crashes on first use of it, surfaces the error too late. Test that config validation runs at load.
- [ ] **Environment-specific behavior.** If code behaves differently in dev vs. prod (feature flags, degraded modes), test both paths. Don't assume dev-tested code works in prod.
- [ ] **Feature flag flip behavior.** Test both flag-on and flag-off paths. A feature behind a flag that's never tested with the flag off can't be safely rolled back.
- [ ] **Timeout and retry boundaries.** If a caller retries 3 times with 5s timeouts, test what happens on the 4th call and on a request that takes 4.9s. The edges matter.

---

## 7. Test Infrastructure Hygiene

The test suite itself is code. It decays if not maintained. Messy test infrastructure produces flaky tests, which produce lost confidence, which produce skipped tests (see §2).

- [ ] **No shared mutable state between tests.** Each test should set up its own state and tear it down. Tests that depend on previous tests' state are order-dependent and flaky.
- [ ] **Setup / teardown covers the failure case.** If setup partially succeeds then teardown fails, the next test starts from a corrupted state. Teardown must be robust to partial-setup states.
- [ ] **Test doubles are minimal and honest.** A mock that returns fixed data is testing the mock, not the code. Use real implementations where feasible; mock only external boundaries.
- [ ] **No hardcoded time-of-day or timezone assumptions.** Tests that pass at 09:00 UTC but fail at 23:00 UTC are flaky by design. Use injected clocks for time-sensitive tests.
- [ ] **No network calls in unit tests.** A unit test that hits a real API is an integration test with a misleading name. Either mock the boundary or move it to the integration suite.

---

## 8. Engine Determinism & Geometry

The engine is a deterministic rules engine: the same `(seed, action-sequence)` must always produce the same final state. Determinism and geometry bugs hide behind happy-path tests — they only surface on replay, on regime boundaries, or on the rare on-edge geometric input. Test them directly.

- [ ] **Seed every randomized test.** Any test touching the PRNG, board generation, or combat MUST pass a fixed seed; a test that passes only sometimes is a defect — never loosen the assertion to hide it.
- [ ] **Property tests assert invariants, not example outputs.** Use fast-check for "for all legal states/actions, property P holds"; treat any counterexample as a real defect, never narrow the generator to dodge it.
- [ ] **Structural assertions over substring.** Compare hex sets by normalized sorted arrays, not stringified blobs, so a reordering or formatting change can't mask a real difference.
- [ ] **Test regime-boundary values explicitly.** Resource counts 1/2/3/4; base counts crossing 3↔4 (radiating↔perimeter switch); commitment levels 3/4/5/6; placed-factory count crossing 18 (late-game elimination activates).
- [ ] **Replay equivalence is asserted.** `(seed, action-sequence)` must reproduce an identical final state — assert structural equality of the whole game state, not just a hash.

---

## 9. Coalition & Alliance Testing

The engine declares last-standing victory when `coalitions(state).length <= 1`. This makes alliance tests SUBTLE: a 2-player game with both players in one mutual alliance has `comps.length === 1`, and **any test that disables iron-victory (e.g. by being below the scaled threshold) will see last-standing fire instead of "ongoing"** — masking the iron-victory gate logic the test was trying to verify.

- [ ] **Alliance status tests need N+1 live players.** If you're testing that an alliance of size N does NOT trigger iron-victory (e.g. because the anti-coalition delta means the threshold isn't met), include at least ONE more live player NOT in that coalition. Otherwise `comps.length === 1` collapses to last-standing and your test passes for the wrong reason.
- [ ] **Status-precedence tests should verify the COMPLETE precedence chain.** Iron > last-standing > ongoing. If you're testing iron-victory rejection, also confirm the result isn't `last-standing` — that's the alternative the engine WILL declare.
- [ ] **Test break-alliance with both rng outcomes.** The 2/3-success break is rng-dependent; tests MUST exercise both the < 2/3 and >= 2/3 branches by selecting seeds with the right first-draw float. (See `apply-break-alliance.test.ts` for the seed-search pattern.)
- [ ] **Cooldown lifecycle:** break sets cooldown; advanceRound decrements it; ally checks it. A test that exercises only one stage misses interaction bugs.

---

## 10. Agent Robustness Under New Action Shapes

When the action space expands (new variant flags adding `ally`, `break-alliance`, `block-terrain`, etc.), agents that switch on `action.kind` must handle the new shapes — even if they ignore them strategically. The TypeScript compiler catches some via exhaustive-switch errors, but only when the switches return a value. Switches that *don't* return (e.g., side-effect-only branches) silently fall through.

- [ ] **After adding a new Action kind, audit every switch on `action.kind` for completeness.** Search: `grep -rn 'switch (action.kind)' src/`. Add explicit branches even if the branch is `throw "not yet implemented"` (Phase-1-stub style) — that flushes coverage gaps at runtime instead of as silent fall-through.
- [ ] **Agents must not return `undefined` action.** `samplePolicy` / `chooseActionMCTS` MUST throw a CLEAR error when they would otherwise return undefined (see `mcts-agent.ts` `mostVisited` fallback). The obscure `Cannot read properties of undefined (reading 'action')` crash that surfaced in the rules-variants experiment was exactly this gap.
- [ ] **Smoke-test agents under new flag combinations.** A simple `runGame` with each new flag enabled, run to completion, asserts the agents don't crash on the expanded action space. Cheap, high-value.

---

## How to Add a Testing-Pitfall

When a bug reaches production (or staging, or late integration testing) because a test was missing:

1. **Identify the topic section** the missing test belongs in. If none of sections 1-7 fit, add a new numbered topic section.
2. **Write the check item** as a `- [ ]` checkbox. Lead with a bolded imperative ("**X is tested.**"), then one sentence explaining what the check covers and why.
3. **Mark with the 🔥 marker** if the bug was found in this project's own history: `**🔥 Found in [context]:** one-line note about the observed failure mode`.
4. **Cross-reference implementation-pitfalls.md** if there's a corresponding implementation entry.
5. **Resist the urge to be clever.** "Tests X under condition Y" is better than a novel testing philosophy. These are pass/fail checklist items, not essays.

The test suite is the enforcement mechanism for this document. If you add a check item and don't write the corresponding test, you've documented a gap, not closed one. Close it.
