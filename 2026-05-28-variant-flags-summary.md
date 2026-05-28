# Variant Flags Summary — Quick Reference

**Date:** 2026-05-28 (overnight).
**Purpose:** One-page reference to every `RuleConfig` flag that has been added since the rules-v10 baseline, what it does, what default behavior it changes, and which design lever it's part of. Use this when configuring sweeps, planning playtest scenarios, or auditing test state.

**Canonical rules doc remains:** `industrial-juggernaut-rules-v10.md` — the BASE rules. This doc is the SUPERSET of optional flags layered on top.

**Adoption discipline:** every flag is **default-off** so existing behavior is preserved unless explicitly enabled. Adopting a flag as default is a deliberate `defaultConfig()` change — separate from implementing the flag.

## Flag inventory

| Flag | Default | Design lever | What it does | Status |
|---|---|---|---|---|
| `victoryIronRequiresPerimeter` | `false` | Variant (a) / P3 | When true, iron counts toward the victory threshold ONLY if held inside a committed perimeter (≥4 non-colinear bases). Radiating iron still counts for resources. | ✅ implemented |
| `noIronRequiresPerimeter` | `false` | Variant (a) companion / (c) standalone | When true, `noIron` elimination only fires for players in the PERIMETER regime. Radiating players with 0 iron are NOT eliminated. **This is the load-bearing variant per the comparison data.** | ✅ implemented |
| `victoryIronHoldRounds` | `1` | Variant (b) / P2 | When > 1, iron victory requires the coalition to have held ≥`victoryThreshold` iron across N consecutive end-of-turn checks. Per-player streak; resets when below threshold. | ✅ implemented |
| `alliancesEnabled` | `false` | Alliance layer (master toggle) | When true, players can ally (mutual iron sharing + non-aggression for the alliance) and break alliances. New action shapes: `{kind: "ally", target}`, `{kind: "break-alliance", target}`. | ✅ implemented |
| `allianceVictoryDelta` | `4` | Anti-coalition safeguard (alliance layer) | When alliances are enabled, a coalition of size N must reach `victoryThreshold + (N-1) * delta` iron to win. Tunable; the [2,3,4,5] range is what we'd sweep. Effect: discourages full-table coalitions. | ✅ implemented |
| `concessionEnabled` | `false` | Concession mechanic (planned) | Will enable a `{kind: "concede"}` action that voluntarily ends the player's involvement; bases removed, no kill bounty. | ⏸ plan ready, not implemented |
| `neutralBasesIn2P` | `0` | Neutral defending bases (planned) | When > 0 AND game is 2P, that many neutral defending bases are placed at setup. Defend-only, no control disk, block sight lines. | ⏸ plan ready, not implemented |
| `terrainBlocksPerGame` | `0` | Board-terrain manipulation (planned) | When > 0, each player gets that many one-shot terrain blocks; blocked hexes can't be built on by anyone. Adds new action `{kind: "block-terrain", hex}`. | ⏸ plan ready, not implemented |
| `baseTypesEnabled` | `false` | Tactical depth — asymmetric base types (planned) | When true, bases have a `type ∈ {forge, watchtower, outpost}` with different control radius, build cost, factory generation, combat profile. Action shape extension. | ⏸ plan ready, not implemented |

## Combined-flag scenarios (intended use)

### Scenario "balanced default" (Sam-greenlit, pending final adoption call)
```ts
{ ...defaultConfig(), noIronRequiresPerimeter: true }
```
- Variant (c). 12.5-turn games under MCTS, 25% iron-vic. Multi-turn iron-denial-warfare.
- Use `mctsHealthThresholds()` (not the default greedy thresholds) when evaluating.

### Scenario "balanced + alliances"
```ts
{ ...defaultConfig(),
  noIronRequiresPerimeter: true,
  alliancesEnabled: true,
  allianceVictoryDelta: 4,
}
```
- For 3P+ games where alliance dynamics matter.
- 2P: alliances irrelevant; same as Scenario 1.

### Scenario "playtest variant"
For human play after Sam picks a playtest scenario:
- A (minimum): Scenario "balanced default" — 2P or 3P.
- B (alliances): "balanced + alliances" — 3P or 4P.
- C (tactical depth) — pending base-types implementation.

## Flag interactions to watch

- **`noIronRequiresPerimeter` + base placement rules:** a stranded radiating player who can't reach iron passes their turn forever — game progresses normally until opponent wins. The engine's existing `legalActions` line 118 fallback (emit pass when stuck) handles this. Don't touch.
- **`alliancesEnabled` + `victoryIronHoldRounds`:** the streak update in `advanceRound` uses the ALLIANCE-SCALED threshold so streak only counts "would-be-winning" turns. Verified in Phase 4 of the alliance plan.
- **`victoryIronRequiresPerimeter` + `noIronRequiresPerimeter`:** these are the two P3 flags. Variant (a) sets both; variant (c) sets only the latter. Either can be used independently. (c) alone is the recommendation per the comparison data.
- **`allianceVictoryDelta` + `victoryThreshold`:** the scaled threshold can exceed achievable iron if delta and coalition size are too high. With default `victoryThreshold: 10` + delta `4`, a 6-coalition would need 30 iron — likely unachievable on a 14-iron board. This is BY DESIGN (full-table coalitions are structurally disincentivized).

## How to use this doc

- **For sweeps:** consult to pick flag settings; `defaultConfig()` + overrides.
- **For playtest:** consult to know what variant is in play; pair with a rules card explaining the *human-visible* effects.
- **For test writing:** consult to know what behavior to TEST under each flag combination (alliance + variant (c), tactical + alliances, etc.).
- **For adoption:** flipping a flag default is a separate decision from implementing the flag. Each adoption needs explicit Sam sign-off + a test-fixture audit (some existing tests encode the old default's behavior and may need recalibration).
