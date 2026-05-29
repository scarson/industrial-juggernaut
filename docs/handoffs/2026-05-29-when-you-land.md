# When You Land — Quick Checklist

> Triage doc. 5 minutes of reading to orient before deciding on next moves.

## First 30 seconds

1. Check `git log --oneline -20` to see what's landed.
2. Check `ps aux | grep tsx | head` — if any sweeps still running, they'll finish on their own.
3. Read `docs/2026-05-29-README.md` for the index.

## First 5 minutes

Read in order:
1. `docs/handoffs/2026-05-29-final-synthesis.md` — the morning-read doc (5 lines + recommendations).
2. `docs/2026-05-29-key-findings-and-answers.md` — Q&A on the 10 critical questions.
3. `docs/2026-05-29-results-aggregate.md` — all sweep tables in one place.

## First 30 minutes

If you want to dig deeper:
- `docs/2026-05-29-design-implications-from-mechanical-3p.md` — 6 design options laid out.
- `docs/2026-05-29-agent-zoo.md` — reference of all agents implemented.
- Specific reports in `docs/2026-05-29-*.md`.

## Decision points

These are the open decisions waiting for your input:

### A. Adopt variant (c) as default?
- The branch has NOT flipped `defaultConfig().noIronRequiresPerimeter = true`. Still Sam-gated.
- Engine is bit-for-bit identical at the default.
- Once you decide, the change is 1 line + updating tests that encoded the old behavior.

### B. Tactical Depth — keep building?
- Engine + heuristic Phases 1-6 are SHIPPED (231/231 engine tests green).
- `baseTypesEnabled = false` by default — zero behavior change.
- Phase 7 (formal comparison sweep) is partially done via Track D.
- Decision: ship Phase 7's "4-test falsification battery" or stop here?

### C. (c)'s 2-turn nature
- E grid confirms (c) is structurally 2-turn (no longer-but-resolving regime in 18-cell axis search).
- L confirms even strong-vs-strong gameplay ends turn 2 in 4P.
- Options:
  - Accept fast-paced 2-turn games as a feature.
  - Add a rule mechanic (hidden info, stochastic elements, trade) to extend.

### D. MCTS structural fixes?
- MCTS@500 = 10.4% on (c) 2P. Marginal recovery.
- B2 (MCTS@1000) + mcts2000 (MCTS@2000) sweeps queued — final answers coming.
- Likely conclusion: MCTS-with-heuristic-leaf is bottlenecked. Fixes would be:
  - PRNG-aware leaf eval.
  - Broader PW candidate diversity ("force-include low-immediate-score T1 candidates").
  - Shallow alpha-beta at root.

### E. What about playtest with humans?
- The CLI (`src/cli/play.ts`) is operational.
- A human + the heuristic on (c) 2P should be a fair fight given the brief.
- Would be useful before committing to the next big design layer.

## What I'd recommend (autonomous opinion)

**Highest leverage:** A + B.
- Flip variant (c) to default (it's the load-bearing balance fix).
- Decide on Tactical Depth — if the engine shows it shifts gameplay (Track D), ship Phase 7.

**Lower priority:** D, E.

**Defer:** C (creative redesign — needs Sam-led design session).

## Container state

The container is running the master-chain orchestrator + several waiting chains:
- master-chain: R → C1 → C2 → L → D → V → AB → B3 → B2 → done.
- chain-arch: waits, then archetype sweep.
- chain-lookahead3: waits, then lookahead3 sweep.
- chain-5p6p: waits, then 5P+6P sweep.
- chain-mcts2000: waits, then MCTS@2000 sweep.
- chain-final-tests: waits for all sweeps to finish, then runs full test suite.

Any of these may have hung mid-stream (BAL-2 push races, etc.) and need a kill. The `scripts/2026-05-29-status-check.sh` script gives a snapshot.

## Key engineering work to NOT lose

Pushed and on remote:
- `src/agent/lookahead2-multi.ts` — the key strategic agent.
- `src/agent/lookaheadN.ts` — generalized depth.
- `src/agent/random.ts` — skill floor reference.
- `src/engine/{types, config, control, build, combat, apply, legal}.ts` — Tactical Depth Phases 1-5.
- `src/agent/heuristic.ts` — subtype-aware build composition (Phase 6).
- 6 new test files (24 new tests).
- 12+ sweep scripts in `src/sweep/`.

Branch `claude/document-game-design-VpqqB` is the canonical state.

## If something feels wrong

- Run `npx vitest run test/engine` — should show 231/231 green.
- Run `npx tsc --noEmit` — should produce no output.
- Check `docs/handoffs/2026-05-29-flight-packet.md` for the latest progress + open decisions.
- Worst case: revert to `origin/main` and selectively cherry-pick the agent files + Tactical Depth phases you want.

---

*Written 2026-05-29 mid-flight. May need editing once final sweeps land.*
