# Design Spec — Learned Agent: AlphaZero-style Self-Play (Milestone 2)

**Date:** 2026-05-27
**Status:** Draft for review — **implementation gated on Milestone 1 (heuristic MCTS) shipping AND evidence it's insufficient for trustworthy sweeps.**
**Scope:** The roadmap's Phases C–D — a neural policy/value net trained by self-play, plugged into the existing MCTS in place of the hand-crafted heuristic.
**Companion docs:** `2026-05-27-agent-roadmap.md` (Part 2 §2.7/2.10/2.11), `docs/superpowers/specs/2026-05-27-stronger-agent-mcts-design.md` (Milestone 1 — the MCTS this builds on), `docs/superpowers/specs/2026-05-27-rules-engine-m1-design.md` (the engine).

## 1. Goal & Gating

Train a neural network whose **policy and value heads guide the Milestone-1 MCTS** to play more strongly than the hand-crafted heuristic — strong enough to *raise* the trustworthiness of balance sweeps beyond what heuristic-MCTS delivers.

**This milestone is explicitly gated and MUST NOT start until both hold:**
1. **Milestone 1 (heuristic MCTS) has shipped** — AlphaZero *is* that MCTS with the heuristic's `evaluate()`/`samplePolicy()` replaced by a learned net. The search loop, max^n backup, chance nodes, `Agent`/`stepRound` seams, and the Elo arena are all prerequisites it reuses, not rebuilds.
2. **Evidence that heuristic-MCTS is insufficient** — Milestone 1's gate (4) (robustness across configs / no-trivial-exploit) revealed a strength ceiling that matters for sweep conclusions. If heuristic-MCTS already clears the trustworthy bar, this milestone may never be needed (YAGNI — that's the intended outcome).

Success criterion (same family as M1, plus a bootstrapping bar): the trained agent **beats the heuristic-MCTS agent decisively** in the Elo arena, and re-running the trustworthiness gates under the learned agent does not flip any gross balance signal vs. heuristic-MCTS (i.e. it *confirms or sharpens*, never contradicts unexplainably).

## 2. Scope & Non-Goals

**In scope:** an all-TypeScript self-play training pipeline (small net via `tfjs-node`), a board-tensor encoder, policy+value heads, the self-play→train→gated-promotion loop reusing the M1 MCTS + Elo arena, and an inference adapter exposing the net as the MCTS's eval/policy (the shared `Agent` seam). 2–6 players, **no alliance reasoning** (matching M1).

**Non-goals (deferred):**
- **Alliance-aware training** — self-play under shifting coalitions is the roadmap's hardest stability risk (§2.7/2.11); v1 trains solo-play only.
- **The ONNX + Python training escalation** — built only if `tfjs-node` training throughput proves inadequate (see §8).
- **Live-game serving** — but see the deployment note (§7): the trained *policy head alone* (no search) is cheap enough to serve in a Cloudflare Worker for the eventual live game; the MCTS+net combo stays offline. Out of scope for this milestone, noted for the product roadmap.
- **Superhuman strength** — the bar is "better than heuristic-MCTS, trustworthy for sweeps," not "optimal."

## 3. Architecture

Standard **AlphaGo-Zero-style gated self-play**, all in TypeScript/Node, reusing Milestone-1 components:

```
training loop (self-play → train → arena-gate → promote)
  ├─ self-play: M1 MCTS with net-backed eval/policy  → (state, π, z) samples
  ├─ trainer: tfjs-node, small net, replay buffer
  └─ gate: M1 Elo arena (new net vs. best net) → promote if Δ-Elo clears threshold
        └─ net adapter: tfjs net ⇒ { evaluate(state), policyPrior(state) } for MCTS
             └─ board encoder: GameState ⇒ tensor (perspective-canonicalized)
                  └─ M1 engine + M1 MCTS (unchanged)
```

The net **replaces the heuristic's two roles** in the M1 MCTS: leaf `evaluate` (→ value head) and the action prior driving progressive-widening candidate sampling (→ policy head). Everything else in the MCTS is unchanged.

## 4. Components

### 4.1 Board encoder (`src/learned/encode.ts`)
`encode(state, perspectivePlayer): Tensor` — maps a `GameState` to a fixed-shape tensor over the axial bounding box of the board, with off-board cells masked. Channels: iron; per-player fresh-base / fatigued-base / factory-control / perimeter-mask planes; a controlled-by-self vs controlled-by-opponent split; central factory-supply scalar broadcast to a plane; turn/phase scalars. **Perspective-canonicalized:** the encoding places the `perspectivePlayer` in the "self" slots and other players in remaining slots (ordered deterministically by seat), so one net evaluates any player's view. Symmetry augmentation: apply the board's symmetry group (the oval's reflections + whatever rotational symmetry the generated shape admits — likely 2-fold + reflection, NOT full D6; detect and use what's valid) to multiply training data.

### 4.2 Net + heads (`src/learned/net.ts`)
A small CNN over the encoded grid (~100K–1M params; a few conv blocks — *not* a deep ResNet; the board is tiny). Two heads:
- **Policy head — spatial move-plane** (the proven AlphaZero representation): per-hex logits for factory-placement and base-placement, plus a small set of global logits for attack (coarse: per-target-hex plane + a commitment-level scalar) and pass. **Masked to legal moves**, softmax-normalized. The per-hex priors feed the M1 MCTS's PW candidate sampling (the net's policy steers which complete actions get sampled, replacing `samplePolicy`'s heuristic weighting).
- **Value head — per-perspective scalar win-probability** for the `perspectivePlayer`. The MCTS obtains the N-vector by encoding+evaluating from each player's perspective (one scalar per player). (Solo-play, no coalitions in v1.)

### 4.3 Net adapter (`src/learned/adapter.ts`)
Wraps a loaded net as the interface the M1 MCTS expects: `netEval(state): number[]` (N-vector via per-perspective value calls) and `netPolicyPrior(state, player): Map<actionKey, number>` (legal-masked policy). **The M1 MCTS hardwired the heuristic's `evaluate`/`samplePolicy`; this milestone's first task refactors it to accept a pluggable `EvalProvider` interface** (`{ evaluate(state): number[]; policyPrior(state, player): ...; samplePolicy(state, player, rng): ... }`) that BOTH the heuristic and this net adapter implement — a behavior-preserving refactor (the heuristic-MCTS must stay green). The heuristic and the net are then interchangeable behind that seam. `learnedAgent(netHandle, mctsParams)` returns the shared `Agent` closure.

### 4.4 Self-play (`src/learned/selfplay.ts`)
Generate games with the current net guiding the M1 MCTS (reusing `runMcts`/`stepRound`). Each move records `(encodedState, π = MCTS root visit distribution, perspective)`; at game end, label every sample with the per-player outcome `z ∈ {0,1}`. Deterministic per seed; parallelizable across Node worker threads / processes (the throughput lever — CPU-bound, see §7). Writes samples to a replay buffer (on disk, e.g. NDJSON/binary under a gitignored `selfplay/` dir).

### 4.5 Trainer (`src/learned/train.ts`)
`tfjs-node` training: sample minibatches from the replay buffer; loss = policy cross-entropy (vs π) + value MSE (vs z) + L2 reg; Adam. Checkpoints to disk. Small net → seconds-to-minutes/epoch on CPU or the 3070.

### 4.6 Training loop + gate (`src/learned/loop.ts`)
Orchestrates: self-play (current best net) → train candidate → **Elo-arena gate** (candidate vs best over seeded matches via M1's `roundRobin`) → promote candidate to best iff Δ-Elo ≥ threshold → repeat. Gated promotion (not always-latest) for stability. Logs Elo trajectory; stops when Δ-Elo plateaus or a target vs heuristic-MCTS is met.

## 5. Data Flow

`loop` → `selfplay` (M1 MCTS + `adapter`(bestNet) + `encode`) → replay buffer → `train` (tfjs) → candidate net → `gate` (M1 `roundRobin`: candidate vs best) → promote → loop. At any point, `learnedAgent(bestNet)` is a drop-in `Agent` usable by the sweep harness or arena.

## 6. Module Layout
```
src/learned/encode.ts     # GameState ⇒ tensor (+ symmetry augmentation)
src/learned/net.ts        # tfjs model: conv trunk + policy/value heads
src/learned/adapter.ts    # net ⇒ MCTS eval/prior; learnedAgent(net) ⇒ Agent
src/learned/selfplay.ts   # generate (state, π, z) samples via M1 MCTS
src/learned/train.ts      # tfjs training step / checkpointing
src/learned/loop.ts       # self-play → train → arena-gate → promote
test/learned/*.test.ts
selfplay/                  # gitignored: replay buffers, checkpoints
```
Reuses unchanged: `src/engine/*`, `src/agent/mcts.ts` (+ its eval/prior seam), `src/eval/arena.ts`, `src/driver/*`. New runtime dep: `@tensorflow/tfjs-node` (dev/training only — NOT pulled into the engine or any Worker bundle).

## 7. Hardware & Deployment Notes

- **Training is offline.** Bottleneck is **CPU self-play throughput** (single-threaded Node MCTS+engine per game), not GPU — the net is tiny. A consumer GPU (e.g. an RTX 3070) makes training instant and accelerates batched inference, but the lever for wall-clock is **CPU core parallelism** across self-play workers. A home machine suffices (hours-to-days); no cloud GPU farm. If self-play volume balloons, scale CPU cores (a many-core box), not GPU. `tfjs-node` (CPU) is a viable fallback if `tfjs-node-gpu`'s CUDA setup fights.
- **Never on Cloudflare Workers for training/self-play or MCTS-at-play** (CPU caps, no GPU, no long-running processes).
- **Policy-only inference CAN run on a Worker** (one forward pass/move, no search) — a cheap in-product opponent for the eventual live game (bundle weights as ONNX/WASM or hand-rolled TS; load from R2/KV if large). Weaker than MCTS+net, fine for live play. **Out of scope here; noted for the product.**

## 8. Risks & Escalations
- **N-player training stability** — solo-play (no alliances) keeps it close to standard AlphaZero; alliances deferred precisely because self-play under shifting coalitions is unstable (§2.11).
- **tfjs throughput** — if training/inference in tfjs is too slow, escalate to **ONNX inference in TS + offline PyTorch training** (the throughput-friendly seam: per-iteration handoff, not per-eval). Documented fallback; not built unless measured necessary.
- **Self-play cost** — the dominant cost; mitigated by worker-thread parallelism and modest MCTS budgets during generation.
- **It may be unnecessary** — if M1 heuristic-MCTS clears the trustworthy bar, this milestone is correctly never built.

## 9. Testing Strategy
- **Encoder:** round-trip/shape tests; off-board masking; perspective-canonicalization (same position from two perspectives yields correctly-permuted planes); symmetry augmentation preserves legal-move correspondence.
- **Net:** forward-pass shape; legal-move masking zeroes illegal policy entries; deterministic given fixed weights+seed.
- **Adapter:** `netEval` returns an N-vector summing sensibly; `netPolicyPrior` is a legal-masked distribution; `learnedAgent` returns an `Agent` whose actions `applyAction` accepts.
- **Self-play:** a generated sample has matching `(state, π, z)` shapes; deterministic per seed; π matches MCTS visit distribution.
- **Trainer:** loss decreases on a tiny synthetic dataset (overfit-a-batch sanity); checkpoint round-trips.
- **Loop/gate (acceptance):** over a SHORT training run (few iterations, small net), the gated loop runs end-to-end, Elo is non-decreasing across promotions, and the final net **beats heuristic-MCTS** in the arena by the target margin. (Slow — generous timeouts; deterministic seeds; per the assertion-rigor convention, never weaken the Δ-Elo gate — if it won't pass, that's a finding.)

## 10. Design Reasoning & Alternatives Considered

**Learning/execution stack — 5 options (full discussion 2026-05-27):** (1) Python-net + TS-engine over IPC — *rejected*, per-NN-eval IPC across millions of calls is throughput-fatal; (2) **all-TS tfjs-node — chosen primary**, no IPC, single language, reuses the TS MCTS, adequate for a tiny net; (3) ONNX-inference-in-TS + offline-PyTorch-training — *escalation*, splits at the coarse per-iteration seam, best for serious scale; (4) pure-TS hand-rolled net — *rejected*, reinventing autograd, toy-only; (5) port/compile engine to Python — *rejected*, reimplementation risks divergence from the tested TS source-of-truth (a correctness hazard). Decisive lens: self-play calls engine+net millions of times, so the hot-path boundary cost dominates → keep engine and net co-located in-process (2 or 3); pick the simpler TS-pure option (2) for a tiny, evidence-gated net, escalate to (3) on measured need.

**Value/objective target — 5 options:** (1) scalar from acting-player perspective — *rejected*, only correct for 2-player zero-sum, breaks for N>2 (the classic N-player mistake); (2) **per-perspective scalar win-prob, N-vector assembled by evaluating each perspective — chosen** (clean, permutation-robust via canonicalization, integrates with max^n); (3) expected-rank/placement vector — added complexity without benefit for a binary-win game; (4) win-prob + margin two-head — speculative; (5) learned opponent model — research-grade, deferred.

**Board encoding — 5 options:** (1) flat MLP feature vector — *rejected*, discards the spatial/perimeter geometry that's central; (2) GNN over hex adjacency — principled but heavy/unusual tooling; (3) **masked 2D-CNN over the axial bounding box — chosen**, tfjs-native, spatial, simple; (4) hexagonal convolutions — principled but niche libraries; (5) set-of-pieces transformer — overkill for ~93 cells. Symmetry augmentation uses the *actual* symmetry of the generated oval (likely reflection + 2-fold, not full D6 — detect, don't assume).

**Policy-head representation — 5 options:** (1) flat enumerated action softmax — *impossible*, combinatorial space; (2) autoregressive per-piece head — powerful but complex sequence-training within one move; (3) policy over heuristic-`samplePolicy` candidates — *rejected*, couples the learned net to the heuristic it's meant to surpass; (4) **spatial move-plane (per-hex placement logits + coarse attack/pass logits), legal-masked — chosen** (the proven AlphaZero representation, CNN-native, feeds the M1 MCTS's PW candidate sampling, trains against MCTS visit-count targets); (5) pointer/attention over legal actions — flexible but heavier. The spatial map + MCTS-visit-count policy target is the standard, lowest-risk path.

**Training-loop variant — 5 options:** (1) AlphaZero always-latest — can be unstable without a gate; (2) **AlphaGo-Zero gated promotion via the Elo arena — chosen** (reuses M1's arena, stable for a small project); (3) population-based training — heavy; (4) expert iteration — similar to (2) without the net-vs-net gate; (5) one-shot behavioral cloning from MCTS — *rejected*, caps strength at heuristic-MCTS (no bootstrapping past the teacher).

### What I'm still uncertain about
- Whether this milestone is needed at all (gated on M1 results — the intended YAGNI exit).
- Whether `tfjs-node` throughput suffices, or we escalate to ONNX+Python.
- The actual symmetry group of the generated board (affects augmentation) — measure it.
- Self-play volume to beat heuristic-MCTS — unknown until run; the gate, not a fixed count, decides done.

### What I'd add with more time
- Information-set handling for hidden future turn-order draws in self-play (currently determinized, inherited from M1 MCTS).
- A transposition table / net-eval cache keyed by the canonical encoded state.
- Alliance-aware self-play (the deferred hard part).
