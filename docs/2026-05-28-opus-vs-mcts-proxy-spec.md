# Opus-as-Agent Proxy for Strategic-Depth Validation — Sized-Up Spec

**Date:** 2026-05-28 (overnight)
**Trigger:** Sam — "I won't be able to human playtest for at least two weeks, so we'll have to reason about the human play elements for now rather than empirically validate it. Perhaps we could have an Opus agent try to play against an MCTS player or something?"
**Status:** Sized-up spec. NOT a full plan or implementation. Goal: estimate cost/value so Sam can decide whether to commission this in a future session.

## Why this exists

The variant comparison + the rules-variants experiment all rely on heuristic + MCTS as the strategic-depth probes. Both are mechanically smart but **structurally incapable of human-style strategic reasoning**:
- Heuristic: greedy with perimeter-aware scoring. No lookahead.
- MCTS@100/300: lookahead but local. Cannot model long-arc strategy, alliance dynamics, or "I think you'll do X because you're afraid of Y."

Claude / Opus, by contrast, can:
- Reason about opponent intent + likely responses.
- Make a coherent strategic plan over multiple turns.
- Handle alliance / negotiation reasoning naturally.
- Notice "Y move would be strategic but Z move is what the opponent expects."

If Opus-as-agent vs MCTS produces *qualitatively different game shapes* than greedy vs MCTS, that's strong signal about whether sim findings transfer to human play.

## What an Opus-agent looks like

### Architecture
- Wrap Claude (via the Anthropic API or in-process if SDK supports) as an `Agent` (matching the existing `Agent` type: `(state, player) => { action, state }`).
- Per move: serialize game state to text, send as user message; parse model response back into an `Action` JSON.
- One model call per move.

### Required engine integration
- **State serialization**: `GameState` → text representation. Needs board layout (ASCII or coordinate dump), all player positions / iron / factories, current turn / player, recent action history. Probably ~500-2000 tokens of context.
- **Action parsing**: model's text response → `Action`. Validate against `legalActions(state)`; re-prompt on invalid (with the validation error). Could give the model the `legalActions` list explicitly to avoid invalid actions.
- **Prompt template**: a system prompt describing the rules + a per-move user prompt with current state. ~2-3k tokens of system + ~1-2k of per-move.

### Latency + cost (rough estimate)
- Per move: ~3-5k tokens prompt + ~200-500 tokens response = ~4-5k total. At Claude Opus 4.7 pricing (~$15/M input, ~$75/M output, prompt caching helping a lot), per-move cost ≈ $0.10-0.25 *without caching*, $0.02-0.05 *with caching* of the system prompt and persistent state context.
- Latency: ~3-8 seconds per move (model thinking + network).
- A 12-turn 2P MCTS-vs-Opus game = ~24-30 moves; only half are Opus moves. Opus = ~12-15 calls. Wall-clock: ~1-2 minutes per game. Cost: ~$1-3 per game uncached, ~$0.25-0.75 cached.

### Quick-pilot scale
A useful pilot: 10 games of Opus-vs-MCTS@100 on variant (c). Total ~10-20 min, ~$3-10 with caching. Affordable; bounded.

### Full-sweep scale
Replacing MCTS in the comparison harness would mean 100s of games. ~$50-200 + ~hours of wall-clock. Not feasible for routine use.

## Adversarial review

**R1 (does Opus actually play "humanly"?)**: maybe not exactly. Opus is good at strategic *reasoning* but might be:
- Over-cautious (modelers tend to avoid risk).
- Biased by training (RLHF politeness vs. competitive ruthlessness).
- Inconsistent across games (model variance).
- Hallucinate "good moves" that are bizarre.

**R2 (variance / reproducibility)**: model responses are stochastic. Determinism would require temperature=0 + reproducible-tokens. Even then, model version changes could break things. A pilot would need to be timestamped against a model version.

**R3 (signal-to-noise)**: 10 games is a small sample. The variance from agent stochasticity AND game stochasticity is likely high. Hard to draw strong conclusions. Bigger pilots cost more.

**R4 (development cost)**: building the wrapper is non-trivial. State serialization is engineering work (~4-6 hours). Action parsing robustness (handling model malformed JSON, re-prompting, etc.) another ~2-4 hours. ~1 day of effort before pilot is runnable.

**R5 (alternative cheaper proxies):**
- *Strong-MCTS at 1000+ iters*: deeper search may approximate strategic depth better than 100-iter. Cheaper (no API).
- *Hand-crafted "strategic" heuristic*: add long-term planning rules to the existing heuristic (e.g., "value perimeter completion over isolated builds"). Cheaper to build.
- *Multiple-agent ensembles*: run heuristic + MCTS + each combination, see if results diverge.
These are likely lower-effort and cheaper, but won't capture "human-style" reasoning the way Opus might.

## Recommendation

**Build a small pilot first**, not a full integration. Specifically:
- ~1 day of engineering to build the wrapper + state serialization.
- 10-game pilot of Opus-vs-MCTS@100 on variant (c).
- ~$10 estimated cost.
- Compare game shapes (median turns, iron-vic fraction, victory mix) to MCTS-vs-MCTS and MCTS-vs-heuristic data.
- If Opus games are qualitatively different — that's signal worth pursuing.
- If Opus games are similar to MCTS-vs-MCTS — Opus didn't add strategic depth the harness can measure (might still be useful as a proxy for "human-like play"; needs a different validation framework).

**Don't build full-sweep integration** unless the pilot shows strong signal. The cost/value at sweep scale is bad.

## What this spec does NOT do

- Doesn't commit to building. Sam decides.
- Doesn't size the engineering precisely — the ~1-day estimate is rough; could be 2-3 days if the serialization/parsing has edge cases.
- Doesn't pick the agent prompting strategy (chain-of-thought? plain? structured?). That's part of the engineering work.

## Open questions for Sam

1. Greenlight the 1-day pilot? Estimated $10-30 in API cost; could revisit after the alliance work ships.
2. Which prompting strategy? "Just pick an action" vs. "think through alternatives, then pick" — affects token cost ~3-5x.
3. Use Claude (Opus 4.7) specifically, or also try Sonnet/Haiku as cheaper alternatives for the pilot? Cheaper models might give signal at lower cost.
4. Priority vs. the alliance work and gate recalibration — does this come before or after they ship?
