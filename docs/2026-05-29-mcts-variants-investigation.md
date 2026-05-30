# MCTS Variants Investigation — 2026-05-29

> Sam asked: "Test different fix approaches with MCTS@50 to see if we quickly identify one or more that play more like Opus." This doc tracks the v2 sweep, the failure pattern, and the v3 follow-up.

## v2 — config knobs + eval-opts variants

11 variants tested vs heuristic on (c) 2P, 16 games each, baseSeed 36000. Full report at `docs/2026-05-29-mcts-variants-quick.md`. Data at `docs/sweeps/data/2026-05-29-mcts-variants-quick.jsonl`.

| Variant | Win rate |
| --- | ---: |
| baseline (PW, T=1, cPuct default, maxDepth 8) | 0.0% |
| fixed-candidates (greedy always in set) | 0.0% |
| temp-0.1 (PW close to argmax) | 0.0% |
| temp-0.01 (PW pure argmax) | 0.0% |
| depth-2 (maxDepth=2, matches Opus's 2-ply) | 0.0% |
| depth-2+fixed | 0.0% |
| low-cpuct (cPuct=0.5) | 0.0% |
| prng-aware (PRNG-peek eval) | 0.0% |
| iron-share (tabletop-valid eval) | 0.0% |
| prng-aware+fixed | 0.0% |
| prng-aware-strong (weight=20) | 0.0% |

**All 11 variants scored exactly 0.0% over 16 games each. None deviated.**

## Why all variants failed — the terminal-leaf bypass

(c) 2P games end at turn 2 (median). MCTS's search loop is:

```typescript
if (status(curState).kind === "victory" || depth >= params.maxDepth) {
  leafVec = leafValue(curState, params);
  break;
}
```

And `leafValue` at a TERMINAL state returns the hard win/loss vector WITHOUT calling `evaluate()`:

```typescript
if (st.kind === "victory") {
  const winners = new Set<PlayerId>(st.players);
  return state.players.map((p) => (winners.has(p.id) ? 1 : 0));
}
// Non-terminal path: softmax over evaluate(state, params.evalOpts)
```

So for (c) 2P with maxDepth ≥ 2, MCTS rollouts ALWAYS hit terminal at depth ≤ 2. The `evalOpts` (prng-aware, iron-share) only bias the NON-TERMINAL softmax — which never fires in this regime.

The prng-aware and iron-share bonuses DID influence the PW candidate scoring (samplePolicy's typeValue computation) — they just couldn't influence the leaf value, which dominates Q.

## v3 — maxDepth=1 variants

To test whether eval-opts can help WHEN they actually fire, v3 caps maxDepth=1. After one ply of advance, the state is almost never terminal (turn 1 hasn't reached the iron threshold), so `leafValue` takes the non-terminal softmax path and `evalOpts` directly bias the value.

9 variants in `src/sweep/mcts-variants-depth1.ts`:
- d1-baseline (no opts)
- d1-prng-aware
- d1-prng-aware-strong (weight=20)
- d1-iron-share
- d1-iron-share-strong (weight=20)
- d1-fixed
- d1-fixed+prng-aware
- d1-fixed+iron-share
- d1-temp-0.01+prng-aware

v3 is queued via `/tmp/chain-v3-then-rest.sh` to run after mcts2000 finishes.

## Deeper structural hypothesis (if v3 also fails)

If v3 ALSO shows uniform 0%, the bottleneck is not the leaf eval — it's the PW prior-equalization in `expandNode`:

```typescript
// Normalize PW priors to an equal share over the opened set
if (node.edges.length > 0) {
  const share = 1 / node.edges.length;
  for (const edge of node.edges) edge.prior = share;
}
```

This DESTROYS samplePolicy's softmax distribution information. The PW process samples ~15 candidates with the heuristic's preferences, then throws away the relative probabilities. PUCT's U term is `cPuct * prior * sqrt(N) / (1 + childN)` — with equal priors, U doesn't differentiate.

At 50 iterations across ~15 candidates, each edge gets ~3 visits. Q values can't differentiate either. Result: `mostVisited` picks essentially at random (tie-break by lex-smallest actionKey).

**Fix candidate (not yet implemented):** thread typeValues through `samplePolicy` → `expandNode` and set `prior = softmax(typeValue / temperature)` over the opened set, preserving the heuristic's relative ranking.

## v3 result — 9 variants, none break out

Full report at `docs/2026-05-29-mcts-variants-depth1.md`.

| Variant | Win rate |
| --- | ---: |
| d1-baseline | 0.0% |
| d1-prng-aware (weight=5 & weight=20) | 0.0% |
| d1-iron-share (weight=5 & weight=20) | 0.0% |
| d1-fixed | 6.3% (1/16) |
| d1-fixed+prng-aware | 6.3% |
| d1-fixed+iron-share | 6.3% |
| d1-temp-0.01+prng-aware | 6.3% |

The eval-opts (prng-aware, iron-share) move the win rate by 0pp. The ONLY lift comes from `candidateMode=fixed` or near-equivalent (`temp-0.01` which makes softmax saturate). All four "fixed-equivalent" variants land at exactly 6.3% (1 win out of 16) — within noise but consistent.

**Structural hypothesis confirmed:** PW candidate generation is the bottleneck, not the leaf eval. With ~15 PW candidates each getting ~3 visits at 50 iterations, PUCT can't differentiate. Fixed mode helps slightly by reducing candidates to ~3 (so each gets ~17 visits), but the uniform 1/k prior still discards heuristic ranking.

## v4 — preserveSoftmaxPrior (test queued)

Built `preserveSoftmaxPrior` flag in `expandNode` (committed in 9bbe9ac). When true, PW priors become `softmax(typeValue/temperature)` over the opened set instead of uniform `1/k` — preserving the heuristic's relative ranking through PUCT's U term.

v4 sweep at `src/sweep/mcts-variants-preserve-prior.ts` tests 8 variants combining the flag with maxDepth, temperature, and eval-opts knobs. Queued after recal + 5p6p via `/tmp/chain-v4-after-recal-5p6p.sh`.

## Status

- v2: complete, all 0.0%. Report committed.
- v3: complete, PW = 0%, fixed = 6.3% (within noise). Report committed.
- v4 (preserveSoftmaxPrior @50/@100): complete, all 0%. Report committed (`docs/2026-05-29-mcts-variants-preserve-prior.md`).
- v5a (preserveSoftmaxPrior @500): complete, all 4 variants at 6.3%. Report committed (`docs/2026-05-29-mcts-preserve-500.md`). Recovered manually after a container restart killed the script before final-report generation.
- v5b (rootBootstrap=lookahead2 hybrid): complete, all 6 variants at exactly **12.5%** (2/16). Report committed (`docs/2026-05-29-mcts-hybrid-bootstrap.md`).

## Final conclusion (Sam decision: accept and move on)

After **37 variants across 5 sweeps**, the picture is clear:

| Sweep | Variants | Best | Headline |
|---|---:|---:|---|
| v2 (config knobs + eval-opts) | 11 | 0.0% | No config knob moves the needle |
| v3 (maxDepth=1 + eval-opts) | 9 | 6.3% | maxDepth=1 lets evalOpts fire but doesn't help |
| v4 (preserveSoftmaxPrior @50/@100) | 11 | 0.0% | Prior fix doesn't help at low budget |
| v5a (preserveSoftmaxPrior @500) | 4 | 6.3% | Prior fix doesn't help at higher budget either |
| v5b (lookahead2 root bootstrap) | 6 | **12.5%** | First reproducible lift but still within noise band |

**MCTS@50-500 fundamentally cannot match the heuristic in (c) 2P with any of the levers we control.** The v5b hybrid bootstrap shows a small (2x baseline, within ±25pp CI at n=16) reproducible lift — but still nowhere near lookahead2's 80% ceiling.

The remaining structural candidates that we did NOT test:
- **Hybrid (i)** — replace MCTS's leaf eval with lookahead2's 1-ply evaluation at every leaf. Expensive per iteration (would have to drop iteration count) but in principle could close the gap.
- **Hybrid (iii)** — MCTS visit-count filter then lookahead2 decider. Requires MCTS visits to be informative, which v2-v5b suggest they aren't.
- **Search-rng / game-rng mismatch fix** — would violate the architectural separation.

**v5b also rules out cheap bootstrap as a lookahead2-substitute.** Three iteration budgets (50/100/500), two prior strategies (with/without preserveSoftmaxPrior), and three temperature/depth knobs all landed at exactly 12.5%. The lookahead2 root prior moves outcomes but caps at the same noise floor. If anything closes the gap, it's not "lookahead2 at the decision point only" — it'd have to be "lookahead2 at every leaf" (hybrid i) which is much more expensive.

**Per Sam (2026-05-30): accept that MCTS isn't going to bridge the gap. Use lookahead2 as the strong agent for (c) 2P. Pivot to the 3P/4P mechanical-game research questions** (already largely answered by Tracks C1/C2/V/AB but worth a synthesis).

## Code shipped (preserved on branch claude/document-game-design-VpqqB)

- `src/agent/heuristic.ts` — `EvalOpts` (prng-aware, iron-share); `samplePolicy` now returns `typeValue` alongside `action`+`rng`.
- `src/agent/mcts.ts` — `MctsCoreParams.evalOpts` + `preserveSoftmaxPrior` + `rootBootstrap`; `expandNode` softmax-prior path; `runMcts` root-bootstrap cache.
- `src/agent/lookahead2.ts` — `scoreActionLookahead2` exported wrapper for hybrid bootstrap.
- `src/sweep/agent-spec.ts` — All new knobs surfaced.
- 5 sweep scripts: `mcts-variants-quick.ts`, `mcts-variants-depth1.ts`, `mcts-variants-preserve-prior.ts`, `mcts-variants-preserve-500.ts`, `mcts-preserve-500-recover.ts`, `mcts-hybrid-bootstrap.ts`.

All knobs default to off — no existing-caller behavior change.

## Files

- Sweep: `src/sweep/mcts-variants-quick.ts` (v2), `src/sweep/mcts-variants-depth1.ts` (v3).
- AgentSpec: extended in `src/sweep/agent-spec.ts` with `candidateMode`, `temperature`, `cPuct`, `maxDepth`, `evalOpts` knobs.
- Heuristic eval: `src/agent/heuristic.ts` — `EvalOpts` interface + prng-aware / iron-share terms threaded through `evaluate` AND `samplePolicy` (the latter is what made v2's evalOpts at least influence candidate scoring, even if not leaf value).
- MCTS plumbing: `src/agent/mcts.ts` — `MctsCoreParams.evalOpts` threaded to `leafValue` + `fixedCandidates` + PW `samplePolicy` call.
