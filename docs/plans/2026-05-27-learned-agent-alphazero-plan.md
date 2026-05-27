# Learned Agent: AlphaZero-style Self-Play — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **⛔ GATE — DO NOT START THIS PLAN YET.** This milestone is blocked pending **Milestone 1 (heuristic MCTS)** shipping AND evidence that heuristic-MCTS is insufficient for trustworthy sweeps. AlphaZero here *is* the M1 MCTS with the heuristic replaced by a learned net — it reuses M1's search loop, max^n backup, chance nodes, `Agent`/`stepRound` seams, and Elo arena. See `docs/plans/2026-05-27-stronger-agent-mcts-plan.md`; when its Overall banner reads ✅ shipped AND its gate (4) showed a strength ceiling that matters, this plan becomes pickable. If M1 clears the trustworthy bar, this milestone is correctly never built (YAGNI).

**Goal:** Train a neural policy/value net by self-play that, plugged into the M1 MCTS in place of the hand-crafted heuristic, beats heuristic-MCTS decisively and raises sweep trustworthiness — per `docs/superpowers/specs/2026-05-27-learned-agent-alphazero-design.md`.

**Architecture:** All-TypeScript AlphaGo-Zero-style gated self-play (`tfjs-node`, small net). Board→tensor encoder; spatial policy head + per-perspective value head; self-play via the M1 MCTS with net-backed eval/prior; train on a replay buffer; promote via the M1 Elo arena gate. Reuses M1 engine + MCTS + arena unchanged except a behavior-preserving `EvalProvider` seam in the MCTS.

**Tech Stack:** TypeScript (strict), Node ≥ 20, Vitest, fast-check, **`@tensorflow/tfjs-node` (training/inference — dev-time only; MUST NOT enter the engine or any Worker bundle)**. Reuses `src/engine/*`, `src/agent/*`, `src/eval/*`, `src/driver/*`.

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

**Overall:** ⏸ DEFERRED — entire milestone gated pending Milestone 1 (heuristic MCTS) shipping AND evidence it's insufficient for trustworthy sweeps. Unblocker artifact: `docs/plans/2026-05-27-stronger-agent-mcts-plan.md` (when its Overall banner reads ✅ shipped and its trustworthiness gate (4) flagged a strength ceiling). Until then, do not claim any phase below.

| Phase | Status | Ship SHA(s) | Notes |
|---|---|---|---|
| C1 — MCTS EvalProvider seam | ⬜ Not started | — | gated on M1 |
| C2 — Board encoder | ⬜ Not started | — | gated on M1 |
| C3 — Net + heads (tfjs) | ⬜ Not started | — | gated on M1 |
| C4 — Net adapter + learnedAgent | ⬜ Not started | — | gated on M1 |
| C5 — Self-play sample generation | ⬜ Not started | — | gated on M1 |
| C6 — Trainer | ⬜ Not started | — | gated on M1 |
| C7 — Training loop + gate (acceptance) | ⬜ Not started | — | gated on M1 |

### Deviations
- (none yet)

### Discoveries
- (none yet)

---

## Conventions Applied to EVERY Task

By reference (not repeated per-task):

**TDD (mandatory):**
```
BEFORE starting: invoke /superpowers:test-driven-development; read docs/pitfalls/testing-pitfalls.md.
Failing test → red → minimal implement → green.
BEFORE complete: review tests vs pitfalls; verify edge/error coverage; full suite green; npm run typecheck clean (strict).
```

**Assertion rigor (statistics + ML heavy):**
```
Tests here involve randomness (self-play, sampling) and learning (loss curves, Elo gates). If an assertion flakes, fix the SEED or add SAMPLES — never loosen a bound or a Δ-Elo gate. A failing trustworthiness/Elo gate is a real finding (net too weak, bug, or the milestone wasn't needed), not a test to soften. For "loss decreases" tests, use a fixed seed + a tiny fixed dataset (overfit-a-batch) so the assertion is deterministic. Commit subjects touching assertions: "add"/"strengthen"/"preserve"/"weaken(rationale)".
```

**End of each phase:** ≥3-round review from multiple perspectives; update Execution Status.

**Global do-NOT:**
- Do NOT start before the M1 gate clears (see top banner).
- Do NOT add `tfjs` (or any ML dep) to `src/engine/*`, `src/driver/*`, or anything that could land in a Cloudflare Worker bundle. ML lives under `src/learned/*` only.
- Do NOT use `Math.random` — thread the seeded PRNG (GEO-3). Do NOT relax tsconfig. Do NOT key hex Sets/Maps by identity (GEO-4).
- Do NOT change M1 MCTS *behavior* in C1 — it's a pure refactor; the heuristic-MCTS tests + the M1 trustworthiness gates MUST stay green.
- Do NOT commit replay buffers / checkpoints — gitignore `selfplay/`.

**Board-coordinate discovery** (carried): the seed-1n/size-96 board is a 93-hex asymmetric oval; use on-board coords or `mkState` unioning in fixtures.

---

## Phase C1 — MCTS EvalProvider Seam (behavior-preserving refactor)

**Execution Status:** ⬜ NOT STARTED

### Task C1.1: extract a pluggable `EvalProvider` from the M1 MCTS
**Files:** Modify `src/agent/mcts.ts`, `src/agent/heuristic.ts`; Create `src/agent/eval-provider.ts`; Tests: existing MCTS tests stay green + a new interchangeability test.
- [ ] Define `export interface EvalProvider { evaluate(state): number[]; policyPrior(state, player): Map<string, number>; samplePolicy(state, player, rng, temperature): { action; rng } }`. Make the heuristic implement it (`heuristicProvider(weights): EvalProvider`). Refactor `mcts.ts` so `runMcts`/`mctsAgent` take an `EvalProvider` instead of calling the heuristic directly. **Behavior-preserving:** all existing `mcts.test.ts` and `mcts-trustworthy.test.ts` MUST pass unchanged (run them). Add a test asserting the heuristic provider plugged through the seam reproduces the pre-refactor agent's chosen action on a fixture (determinism preserved).
- [ ] Commit `refactor: pluggable EvalProvider seam in MCTS (behavior-preserving)`.

**End of Phase C1:** ≥3-round review; confirm M1 gates still green; update Execution Status.

---

## Phase C2 — Board Encoder

**Execution Status:** ⬜ NOT STARTED

### Task C2.1: `encode(state, perspectivePlayer)` + symmetry detection
**Files:** Create `src/learned/encode.ts`; Test `test/learned/encode.test.ts`.
- [ ] TDD: `encode(state, perspectivePlayer): Float32Array` (+ a `shape` export) over the axial bounding box, off-board cells masked to 0. Channels per the spec §4.1 (iron; per-player fresh/fatigued base, factory-control, perimeter masks with `perspectivePlayer` in the self-slot and others ordered deterministically by seat; controlled-self vs controlled-opponent; factory-supply plane; turn/phase scalars). Tests: correct shape; off-board cells are 0; perspective-canonicalization (same physical position encoded from two perspectives yields the correctly-permuted self/other planes); an iron hex shows in the iron channel iff on-board.
- [ ] Also `boardSymmetries(board): Transform[]` — detect the *actual* symmetry group of the generated oval (reflections + whatever rotation is valid; do NOT assume full D6) and `applySymmetry(encoded, t)` with the matching legal-move-index permutation. Test: each detected symmetry maps on-board→on-board and preserves the iron set.
- [ ] Commit `feat: board tensor encoder + symmetry detection`.

**End of Phase C2:** ≥3-round review; update Execution Status.

---

## Phase C3 — Net + Heads (tfjs)

**Execution Status:** ⬜ NOT STARTED

### Task C3.1: small CNN with spatial policy + per-perspective value heads
**Files:** Create `src/learned/net.ts`; Test `test/learned/net.test.ts`. Add `@tensorflow/tfjs-node` to devDependencies.
- [ ] TDD: `createNet(config): Net` — a small conv trunk (a few blocks; ~100K–1M params) over the encoded grid; **policy head** = per-hex factory/base placement logit planes + coarse attack (per-target plane + commitment scalar) + pass logit; **value head** = single scalar (perspective win-prob, sigmoid). `forward(net, batchedEncoded): { policyLogits, value }`. Tests: output shapes match (policy plane dims = board bbox; value ∈ [0,1]); a `maskPolicy(logits, legalMask)` helper zeroes illegal entries and renormalizes (test illegal moves get ~0 probability). Keep the net SMALL (assert param count < ~2M to prevent bloat).
- [ ] **Shared action↔policy-index mapping (load-bearing — both C4 masking and C5 policy targets MUST agree, or training silently learns garbage):** define `actionToPolicyIndex(action, board): number` and `legalPolicyMask(state, player): Float32Array` here (or in `encode.ts`), with a round-trip/consistency test — every action `legalActions` can emit maps to a distinct in-range policy index, and the mask marks exactly those indices legal. C4 (masking) and C5 (the MCTS-visit policy target π) both import these. Without one shared mapping the policy target and the net's output space diverge undetectably.
- [ ] **Determinism caveat:** assert net determinism on the **CPU tfjs backend** with fixed seeded init. Where tfjs does not guarantee bitwise determinism for an op, assert float-tolerance equality (numerical reality, NOT assertion-weakening) — document any such spot.
- [ ] Commit `feat: tfjs policy/value net + shared action↔policy-index mapping`.

**End of Phase C3:** ≥3-round review; update Execution Status.

---

## Phase C4 — Net Adapter + learnedAgent

**Execution Status:** ⬜ NOT STARTED

### Task C4.1: net ⇒ `EvalProvider`; `learnedAgent(net) ⇒ Agent`
**Files:** Create `src/learned/adapter.ts`; Test `test/learned/adapter.test.ts`. Depends on C1 (seam), C2 (encode), C3 (net).
- [ ] TDD: `netProvider(net): EvalProvider` — `evaluate(state)` returns an N-vector by encoding+forward from each player's perspective (one scalar each); `policyPrior(state, player)` runs forward, masks to legal moves (mapping policy planes → legal action keys via the same candidate scheme the M1 PW uses), returns a normalized distribution; `samplePolicy` samples a complete legal action using the net prior (analogous to heuristic `samplePolicy`). `learnedAgent(net, mctsParams): Agent` = `mctsAgent` with `netProvider(net)`. Tests: `evaluate` returns length-N finite vector; `policyPrior` is a legal-masked distribution summing ~1; `learnedAgent`'s action is `applyAction`-acceptable across fixtures; deterministic given fixed net + seed.
- [ ] Commit `feat: net adapter (EvalProvider) + learnedAgent`.

**End of Phase C4:** ≥3-round review; update Execution Status.

---

## Phase C5 — Self-Play Sample Generation

**Execution Status:** ⬜ NOT STARTED

### Task C5.1: generate `(state, π, z)` samples via M1 MCTS + net
**Files:** Create `src/learned/selfplay.ts`; Test `test/learned/selfplay.test.ts`. Add `selfplay/` to `.gitignore`.
- [ ] TDD: `selfPlayGame(net, opts): Sample[]` plays one game with `learnedAgent`/the M1 MCTS, recording per move `{ encoded, perspective, policyTarget: π }` where **π is the MCTS root visit distribution mapped through the SHARED `actionToPolicyIndex` from C3** (so the target lives in exactly the net's policy-output index space — do NOT invent a separate indexing); at game end labels each sample with per-player outcome `z ∈ {0,1}` from `status`. Tests: a sample's `encoded` shape matches the encoder; `π` sums to ~1 over legal indices and matches the MCTS root visit counts mapped via `actionToPolicyIndex`; `z` matches the game result; deterministic per seed. `generateSamples(net, n, rng)` batches games; worker-thread parallelization is an OPTIONAL flag — correctness first, single-threaded.
- [ ] Commit `feat: self-play sample generation`.

**End of Phase C5:** ≥3-round review; update Execution Status.

---

## Phase C6 — Trainer

**Execution Status:** ⬜ NOT STARTED

### Task C6.1: tfjs training step + checkpointing + replay buffer
**Files:** Create `src/learned/train.ts`, `src/learned/replay.ts`; Tests `test/learned/train.test.ts`, `test/learned/replay.test.ts`.
- [ ] TDD: `replay` = an append/sample buffer persisted to disk under `selfplay/` (NDJSON or binary); test round-trip + bounded size (eviction). `trainStep(net, batch): {policyLoss, valueLoss}` — loss = policy cross-entropy(π) + value MSE(z) + L2; Adam. **Symmetry augmentation:** when sampling a training batch, optionally apply `boardSymmetries`/`applySymmetry` from C2 to each sample (transforming BOTH the encoded tensor AND the policy target π via the matching policy-index permutation, so they stay aligned) — test that an augmented sample's π still corresponds to the same physical moves. **Overfit-a-batch sanity test:** on a tiny fixed synthetic dataset with a fixed seed (CPU backend, per C3's determinism caveat), total loss strictly decreases over K steps (deterministic; per assertion-rigor, do NOT loosen — if it doesn't decrease, the net/loss wiring is wrong). `saveCheckpoint`/`loadCheckpoint` round-trip the weights (assert identical forward output after reload).
- [ ] Commit `feat: tfjs trainer + replay buffer + checkpointing`.

**End of Phase C6:** ≥3-round review; update Execution Status.

---

## Phase C7 — Training Loop + Gate (Acceptance)

**Execution Status:** ⬜ NOT STARTED

### Task C7.1: gated self-play→train→promote loop
**Files:** Create `src/learned/loop.ts`; Test `test/learned/loop.test.ts`. Depends on C4/C5/C6 + `src/eval/arena.ts`.
- [ ] TDD: `trainingLoop(opts): { bestNet, eloTrajectory }` — iterate: self-play with `bestNet` → `trainStep`s on the replay buffer → candidate net → **Elo-arena gate** (`roundRobin([learnedAgent(candidate), learnedAgent(best)])`) → promote candidate iff Δ-Elo ≥ threshold → repeat to a config'd iteration cap. Test (SHORT run, tiny net, few iters, fixed seed, generous timeout): the loop runs end-to-end without error; `eloTrajectory` is non-decreasing across promotions; checkpoints persist. Keep it deterministic; do NOT weaken to force green.
- [ ] Commit `feat: gated AlphaZero training loop`.

### Task C7.2: acceptance — learned agent beats heuristic-MCTS
**Files:** Test `test/acceptance/learned-beats-heuristic.test.ts`; a checkpoint-pointer file (path in `selfplay/`, gitignored).
- [ ] **The acceptance run is OFFLINE, not in-CI** — a real training run can be hours; CI cannot reproduce it. Pattern: the executor runs `trainingLoop` offline to produce a best-net checkpoint, records the run (iterations, final Elo vs heuristic, wall-clock) in this plan's Execution Status / a `docs/` note, then the test **loads that checkpoint if present and SKIPS with a clear message if absent** (so CI stays green without a multi-hour artifact, and the gate is meaningful when run against a real checkpoint). `heuristicMctsAgent` = `mctsAgent(heuristicProvider(defaultHeuristicWeights()), defaultMctsParams())` (the M1 agent through the C1 seam).
- [ ] When a checkpoint IS present, assert `roundRobin([learnedAgent(checkpoint), heuristicMctsAgent])` → learned win-rate ≥ the target margin (set from the M1 arena baseline), AND re-run the M1 trustworthiness gross-signal checks under the learned agent and assert no signal flips unexplainably vs heuristic-MCTS. If the learned agent does NOT beat heuristic-MCTS, that is a REAL finding — STOP and report (training inadequate / net too small / milestone wasn't needed); do NOT loosen the gate. Responses (spec §8): more self-play, bigger net, escalate to ONNX+PyTorch, or conclude heuristic-MCTS suffices and shelve this milestone.
- [ ] Commit `test: learned-vs-heuristic acceptance (offline checkpoint, CI-skips-if-absent)`.

**End of Phase C7:** ≥3-round review; update Execution Status; mark Overall complete.

---

## Self-Review (writing-plans step, completed at authoring time)

**Spec coverage:** EvalProvider seam (§4.3)→C1; encoder + symmetry (§4.1)→C2; net + heads (§4.2)→C3; adapter + learnedAgent (§4.3)→C4; self-play samples (§4.4)→C5; trainer + replay (§4.5)→C6; loop + gate + acceptance (§4.6, §1 success)→C7. Stack=tfjs primary (§10) with ONNX+Python escalation referenced in C7.2's failure response. Workers deployment (§7) is a noted non-goal, not a task. Every spec section maps to a task or an explicit non-goal.

**Placeholder scan:** no TBD; behaviors specify concrete properties. The whole plan is gated (top banner + Overall ⏸) — that's an explicit, prose+link defer, not vagueness.

**Type consistency:** `EvalProvider` (C1) implemented by both `heuristicProvider` (C1) and `netProvider` (C4); `Agent` (from M1) returned by `learnedAgent` (C4); `Sample{encoded,π,z,perspective}` produced by C5 and consumed by C6; `encode` shape (C2) consumed by C3/C4/C5; `roundRobin`/arena (M1 A5) consumed by C7. The `tfjs` dependency is confined to `src/learned/*` per the do-NOT boundary.
