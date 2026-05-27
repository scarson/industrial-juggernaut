# Overnight Autonomous Plan — 2026-05-27 → 28

**Context:** Sam is asleep (~8h). I work autonomously, surface no questions (can't), and leave a clear morning state. This is both the brainstorm Sam asked for (≥5 ideas, multi-perspective, ≥3× adversarial review) and my execution checklist.

**Hard exclusions while unattended (Sam-gated — do NOT do these autonomously):**
- Change `defaultConfig` (balance adoption is Sam's call).
- Implement any rules-mechanic change (e.g. perimeter-gated iron) — spec only.
- Merge anything to `main` (no review available).
- Large engine refactors.

## Brainstorm (8 ideas)
1. **Run MCTS trustworthiness gates A5.2/A6** on the candidate config — the milestone the balanced config unblocks.
2. **Denser, multi-seed confirmation sweep** around `b96/r2/vt12` — the healthy cell is a narrow, marginal island; confirm robustness across seeds + finer grid at 600 games.
3. **Investigate all-MCTS "turn-1 last-standing"** — legitimate iron-denial/elimination under strong play, or an engine bug? If a bug, it taints the balance analysis. Foundational.
4. **Spec (not build) the P3 perimeter-gated-iron experiment** — only if the config fails under MCTS; Sam-gated → spec only.
5. **Adversarial bug-hunt + harden the new parallel infra** — determinism is load-bearing; a latent IPC/concurrency bug silently corrupts every overnight run.
6. **Compile a decision package** for Sam's morning + update the handoff.
7. **Finish parallelism** — `findBalancedConfigParallel`, wire `calibrate`/`main` to a pool (all sweeps 4×).
8. ~~Learned/AlphaZero agent~~ — dropped: double-gated, training-heavy, wrong for unattended time.

## Adversarial review
- **R1 (wasteful/wrong-premised):** #8 dropped. #4 contingent on verdict + spec-only. #6 is end-synthesis. #1 depends on verdict (meaningless on a collapsed config).
- **R2 (deps/ordering/asleep):** Only ONE heavy compute job at a time (4 cores) → the night is a *sequential pipeline*. Work *branches on the revalidation verdict*. **#5 must precede big compute** — buggy infra ⇒ garbage numbers.
- **R3 (autonomy risk; bad work > no work):** Enforce the hard exclusions; #4 → written spec. **#3 could be an engine bug that also taints the greedy result** → foundational, verdict-independent, do early + time-boxed. Keep commits clean; nothing merged; morning summary.

## Execution pipeline
1. **Now (verdict-independent):** harden parallel infra (#5) + time-boxed investigate turn-1 elimination (#3).
2. **Read revalidation verdict → branch:**
   - **Holds under MCTS:** finish grid parallelism (#7) → multi-seed/denser confirmation sweep (#2) → A5.2/A6 gates on the candidate (#1).
   - **Fails/collapses:** deepen #3; measure health-under-MCTS across configs; spec P3 (#4); flag that the health gate's `ironVictory ≥ 0.5` may be wrong if strong play is legitimately elimination-driven (Sam discussion).
3. **Always end:** decision package (#6) + updated handoff; clean commits on `claude/document-game-design-VpqqB`; nothing merged.

## Running log (updated through the night)
- (start) Plan written. Revalidation in flight (Part A, all-MCTS, slow 4P games). Beginning #5 + #3.
