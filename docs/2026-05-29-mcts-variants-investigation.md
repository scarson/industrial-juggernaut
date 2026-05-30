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
- v4 (preserveSoftmaxPrior): infrastructure committed (9bbe9ac), sweep queued.

## Files

- Sweep: `src/sweep/mcts-variants-quick.ts` (v2), `src/sweep/mcts-variants-depth1.ts` (v3).
- AgentSpec: extended in `src/sweep/agent-spec.ts` with `candidateMode`, `temperature`, `cPuct`, `maxDepth`, `evalOpts` knobs.
- Heuristic eval: `src/agent/heuristic.ts` — `EvalOpts` interface + prng-aware / iron-share terms threaded through `evaluate` AND `samplePolicy` (the latter is what made v2's evalOpts at least influence candidate scoring, even if not leaf value).
- MCTS plumbing: `src/agent/mcts.ts` — `MctsCoreParams.evalOpts` threaded to `leafValue` + `fixedCandidates` + PW `samplePolicy` call.
