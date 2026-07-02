# Balance Redesign Phase 1 — Instrument & Probes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the measurement instrument the balance redesign needs — elimination-cause + factory-source capture in the driver, diversity metrics + a parallel provisional gate in the sweep harness, the regime-persistence probe script, and the weak-agent placeRange sweep — with zero engine-rule changes.

**Architecture:** Additive instrumentation along the existing data path: `runGame` (driver) captures events it already receives from `stepRound`; `runGameEntry`/`GameEntry` carry per-game summaries; `computeMetrics` aggregates; `health.ts` gains a parallel diversity gate; `ShardLine` round-trips the new fields so parallel == sequential stays byte-identical. Probe/sweep scripts reuse `runGameEntry` so they inherit the instrumentation. Spec: `docs/superpowers/specs/2026-07-02-balance-redesign-design.md`. Evidence: `docs/sweeps/2026-07-02-balance-diagnosis/2026-07-02-elimination-decomposition.md`.

**Tech Stack:** TypeScript (strict), bun (`bun run test` = vitest — NEVER `bun test`), existing sweep harness (`src/sweep/*`), MCTS agent (`src/agent/mcts-agent.ts`).

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

## Execution Status

**Overall:** Not started.

| Phase | Status | Ship SHA(s) | Notes |
|---|---|---|---|
| A — Data pipeline (Tasks 1–3) | ⬜ Not started | — | — |
| B — Gates & report (Tasks 4–5) | ⬜ Not started | — | — |
| C — Probe & sweep scripts (Tasks 6–7) | ⬜ Not started | — | — |
| D — Probe/sweep execution + docs (Task 8) | ⬜ Not started | — | — |
| E — Ship (Task 9) | ⬜ Not started | — | — |

## Execution strategy recommendation

**Subagent-driven** (`superpowers:subagent-driven-development`) in the current session: fresh subagent per task, review between tasks. Rationale: tasks are sequential but each is fully self-contained below; the orchestrating session's context is heavy, so per-task fresh contexts avoid drift; review gates between tasks matter because Tasks 1–3 touch a determinism-pinned data path. **Model tiering (Sam's directive): implementation subagents on Sonnet; between-task reviews on Opus; the final blind adversarial PR review on Fable (Task 9 — judgment-critical, Sam-authorized gate).**

## Constraints that bind every task

- **No engine rule changes.** Nothing under `src/engine/` changes in this plan. If a task appears to require an engine edit, STOP — that is a plan bug, not a license.
- **No serialized-contract changes.** `SessionRecord`/`LogEntry` (`src/session/types.ts`) are untouched. `GameResult` (driver) and `GameEntry`/`ShardLine` (sweep) are NOT part of the client contract.
- **Goldens must stay green.** `test/engine/control-parity*.test.ts` and `test/agent/mcts-determinism.test.ts` pin behavior; this plan adds observation only. A red golden during this plan is a bug you introduced (likely PRNG misthreading — GEO-3), never a "deliberate change" to regenerate.
- **Determinism invariant:** parallel == sequential (`test/sweep/run.test.ts`) must keep passing byte-identical. `computeMetrics` MUST NOT read `result.ironOverTime` (sequential entries carry it, shard-reconstructed entries carry `[]`) — it reads only fields that `ShardLine` round-trips.
- **Pitfalls that apply here:** GEO-3 (all new tests seeded; no `Math.random` anywhere), GEO-4 (any hex-keyed map uses canonical `key(h)` strings, never object identity), testing-pitfalls §8 (structural assertions, seeded tests, never loosen an assertion to dodge nondeterminism). If any new test flakes, the fix is determinism (seeding/threading), NOT assertion weakening; if you cannot make it deterministic, STOP and raise it.
- Run tests with `bun run test` (or `bun run test -- <path>` for one file). Typecheck with `bun run typecheck`.
- **Branching & PRs (two PRs):** PR-1 (already staged on `docs/balance-redesign-spec`) carries the spec + diagnosis evidence + this plan — docs-only, CI-skipped, merged first. The implementation (Tasks 1–7) happens on `feat/balance-phase1-instrument`, created from `origin/dev` AFTER PR-1 merges (`git fetch origin dev && git worktree`-local `git checkout -b feat/balance-phase1-instrument origin/dev` — never branch implementation work off the docs branch). Task 8 ships PR-2 from that branch.

---

## Phase A — Data pipeline

**Execution Status:** ⬜ NOT STARTED

### Task 1: Driver captures elimination records and factory-source counts

**Files:**
- Modify: `src/driver/record.ts` (add `EliminationRecord`, `FactorySourceCounts`, two new `GameResult` fields)
- Modify: `src/driver/run.ts` (collect events; extend the per-turn snapshot)
- Test: `test/driver/run.test.ts`

**Context:** `stepRound` already returns `eliminated` events (`{kind:"eliminated", player, cause, bountyTo}`) and `placed` events (`{kind:"placed", piece, hex, owner}`) — `runGame` currently discards them (`src/driver/run.ts:90` takes `.state` only). `control(state, p)` is already computed per player at every turn boundary for `ironOverTime`; the factory partition reuses that same call (compute `control` ONCE per player per boundary — do not call it twice).

BEFORE starting work:
1. Invoke /superpowers:test-driven-development
2. Read docs/pitfalls/testing-pitfalls.md
Follow TDD: write failing test → implement → verify green.

- [ ] **Step 1: Write the failing tests** (append to `test/driver/run.test.ts`)

```ts
describe("runGame instrumentation", () => {
  it("records elimination events with valid shape and game-consistency (seeds 1..10)", () => {
    for (let s = 1n; s <= 10n; s++) {
      const r = runGame(opts2p(s));
      expect(Array.isArray(r.eliminations)).toBe(true);
      for (const e of r.eliminations) {
        expect(["noBases", "brokenPerimeterAt18Factories", "noIron", "emptyPerimeter"]).toContain(e.cause);
        expect(e.turn).toBeGreaterThanOrEqual(1);
        expect(e.turn).toBeLessThanOrEqual(r.turns);
        expect(r.winnerOrCoalition).not.toContain(e.player);
        if (e.bountyTo !== null) expect(e.bountyTo).not.toBe(e.player);
      }
      // 2P last-standing means the other player was eliminated: the event MUST be captured.
      if (r.victoryType === "last-standing" && r.winnerOrCoalition.length === 1) {
        expect(r.eliminations.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("captures a known elimination (big300 seed 3, 4P, heuristic agents: turn-1 noIron)", () => {
    // Deterministic fixture with committed provenance: docs/sweeps/2026-07-02-balance-diagnosis/
    // data/weak-big300-vt12.json, gameIndex 2 (4P, gameSeed(1n,2)=3n, heuristicAgent, elims [noIron],
    // ends turn 1). Guarantees the capture path is exercised — the seeds-1..10 test above may see none.
    // FALLBACK PROTOCOL if this test stays red for any reason OTHER than the missing fields: do NOT
    // weaken it — STOP, run a one-off discovery script over seeds (bun, runGame + log eliminations),
    // pin the observed (seed, cause, turn) with the data file updated, and note the deviation. A red
    // here otherwise means engine/agent behavior changed, which this plan must not do.
    const r = runGame({
      seed: 3n,
      boardSource: { kind: "generate", size: 300, ironCount: 16 },
      nPlayers: 4,
      archetypes: [ARCHS[0]!, ARCHS[1]!, ARCHS[2]!, ARCHS[0]!], // unused under agentFor
      config: { ...defaultConfig(), boardSize: 300, ironCount: 16, victoryThreshold: 12 },
      turnCap: 60,
      agentFor: () => heuristicAgent(),
    });
    expect(r.eliminations.length).toBeGreaterThanOrEqual(1);
    expect(r.eliminations[0]!.cause).toBe("noIron");
    expect(r.eliminations[0]!.turn).toBe(1);
  });

  it("records factory-source counts aligned with ironOverTime boundaries", () => {
    for (let s = 1n; s <= 6n; s++) {
      const r = runGame(opts2p(s));
      expect(r.factorySourcesOverTime.length).toBe(r.ironOverTime.length);
      for (const row of r.factorySourcesOverTime) {
        expect(row).toHaveLength(2);
        for (const c of row) {
          expect(c.own).toBeGreaterThanOrEqual(0);
          expect(c.live).toBeGreaterThanOrEqual(0);
          expect(c.orphan).toBeGreaterThanOrEqual(0);
        }
      }
      // Nothing can be orphaned in a game with zero eliminations.
      if (r.eliminations.length === 0) {
        for (const row of r.factorySourcesOverTime)
          for (const c of row) expect(c.orphan).toBe(0);
      }
    }
  });
});
```

Also extend the existing `assertWellFormed` helper (same file) with:

```ts
  expect(Array.isArray(r.eliminations)).toBe(true);
  expect(r.factorySourcesOverTime).toHaveLength(r.ironOverTime.length);
```

New imports needed at the top of the test file: `import { heuristicAgent } from "../../src/agent/heuristic-agent";` (the `defaultConfig`/`ARCHS` imports already exist).

- [ ] **Step 2: Run to verify failure**

Run: `bun run test -- test/driver/run.test.ts`
Expected: FAIL — TypeScript errors / `undefined` for `r.eliminations` (the fields don't exist yet).

- [ ] **Step 3: Add the types** (`src/driver/record.ts`)

```ts
import type { BoardSource, EliminationCause, PlayerId } from "../engine/types";

/** One captured elimination: who died, why, when, and who (if anyone) collected bounty. */
export interface EliminationRecord {
  player: PlayerId;
  cause: EliminationCause;
  turn: number;
  bountyTo: PlayerId | null;
}

/** Controlled-factory partition for one player at one turn boundary (three-way source split). */
export interface FactorySourceCounts {
  /** Factories this player built themselves. */
  own: number;
  /** Factories built by a live (non-eliminated) other player. */
  live: number;
  /** Factories built by a since-eliminated player. */
  orphan: number;
}
```

`GameResult` gains two REQUIRED fields (after `ironOverTime`):

```ts
  /** Every elimination that occurred, in event order. */
  eliminations: EliminationRecord[];
  /** `factorySourcesOverTime[t][p]` = player p's controlled-factory source partition at turn boundary t (rows align 1:1 with `ironOverTime`). */
  factorySourcesOverTime: FactorySourceCounts[][];
```

- [ ] **Step 4: Capture in the driver** (`src/driver/run.ts`)

Imports: add `key` from `../geometry/cube` and the new types from `./record` (GEO-4: builder map keyed by canonical `"x,y,z"` string).

Replace the module-level `snapshot` with a combined per-boundary snapshot (one `control()` per player, both rows):

```ts
function snapshot(
  state: GameState,
  builders: Map<string, PlayerId>,
): { iron: number[]; factories: FactorySourceCounts[] } {
  const iron: number[] = [];
  const factories: FactorySourceCounts[] = [];
  for (const p of state.players) {
    if (p.eliminated) {
      iron.push(0);
      factories.push({ own: 0, live: 0, orphan: 0 });
      continue;
    }
    const ctl = control(state, p.id);
    iron.push(ctl.iron.length);
    const c: FactorySourceCounts = { own: 0, live: 0, orphan: 0 };
    for (const f of ctl.factories) {
      const b = builders.get(key(f));
      // Builder unknown -> counted as orphan. Defensive: factories only enter play via
      // applyBuild "placed" events, all captured below, so this branch is unreachable
      // unless a future setup phase seeds factories before the event loop starts.
      if (b === undefined) c.orphan++;
      else if (b === p.id) c.own++;
      else if (state.players[b]!.eliminated) c.orphan++;
      else c.live++;
    }
    factories.push(c);
  }
  return { iron, factories };
}
```

In `runGame`: declare `const eliminations: EliminationRecord[] = [];`, `const factorySourcesOverTime: FactorySourceCounts[][] = [];`, `const factoryBuilder = new Map<string, PlayerId>();`. Every `ironOverTime.push(...)` site (the turn-boundary push and the `finish` push) becomes:

```ts
const snap = snapshot(state, factoryBuilder);
ironOverTime.push(snap.iron);
factorySourcesOverTime.push(snap.factories);
```

The step call captures events instead of discarding them — **PRESERVE the existing `try/catch` around `stepRound`** (it carries the seed/turn/player/action diagnostics for illegal-action agent bugs; do not drop or restructure it). Only the body inside the `try` changes:

```ts
try {
  const stepped = stepRound(state, choice.action);
  state = stepped.state;
  for (const e of stepped.events) {
    if (e.kind === "eliminated") {
      eliminations.push({ player: e.player, cause: e.cause, turn: state.phase.turn, bountyTo: e.bountyTo });
    } else if (e.kind === "placed" && e.piece === "factory") {
      factoryBuilder.set(key(e.hex), e.owner);
    }
  }
} catch (e) {
  // existing catch body UNCHANGED (seed/turn/player/action diagnostic rethrow)
}
```

Both `finish` and the turn-cap return include `eliminations` and `factorySourcesOverTime` in the result.

- [ ] **Step 5: Fix every other `GameResult` constructor.** Run `grep -rn "ironOverTime" src/ test/ --include='*.ts'` and classify each hit as LITERAL-CONSTRUCTOR (fix) vs ROUND-TRIPS-THROUGH-runGameEntry/toShardLine (leave alone) vs comment/consumer (leave alone). The only real literal sites are: `src/sweep/big300-merge.ts` `toEntries` (its GameResult literal gains `eliminations: []`, `factorySourcesOverTime: []` for now — Task 2 replaces with round-tripped values) and `test/sweep/metrics.test.ts` `makeResult` (add `eliminations: [], factorySourcesOverTime: []` to the defaults object so all fixtures inherit). `big300-shard.ts` and `big300-verify-shard.ts` build entries via `runGameEntry`/`toShardLine` and need NO edit — do not fabricate one. If the grep finds literal sites not listed here, fix them the same way and note them under Discoveries.

- [ ] **Step 6: Run driver tests, then typecheck, then the full suite**

Run: `bun run test -- test/driver/run.test.ts` → PASS.
Run: `bun run typecheck` → clean.
Run: `bun run test` → all green (acceptance suite included — the added per-boundary cost is one factory partition per player, `control()` count unchanged).

BEFORE marking this task complete:
1. Review tests against docs/pitfalls/testing-pitfalls.md
2. Verify test coverage (error paths? edge cases? — the zero-elimination orphan invariant and the last-standing⇒eliminations coupling are the load-bearing ones)
3. Run tests and confirm green
If any test assertion races, flakes, or fails nondeterministically, the fix is deterministic seeding/threading (GEO-3) — NOT assertion removal or weakening. If determinism cannot make it pass reliably, STOP and raise it.

- [ ] **Step 7: Commit**

```bash
git add src/driver/record.ts src/driver/run.ts test/driver/run.test.ts src/sweep/big300-merge.ts test/sweep/metrics.test.ts
git commit -m "feat(driver): capture elimination records and factory-source counts in GameResult"
```

(Plus any straggler literal sites the Step-5 grep surfaced — add them to the same commit.)

### Task 2: GameEntry summaries + diversity metrics in computeMetrics

**Files:**
- Modify: `src/sweep/metrics.ts` (GameEntry + SweepMetrics + computeMetrics + `maxIronByPlayer` helper)
- Modify: `src/sweep/run.ts` (`runGameEntry` fills the new GameEntry fields)
- Test: `test/sweep/metrics.test.ts`

**Context:** `GameEntry` (`src/sweep/metrics.ts:70-87`) gains two required fields; `computeMetrics` (`:166`) gains five outputs. **Do NOT read `result.ironOverTime` inside `computeMetrics`** — shard-reconstructed entries carry `[]` there; read only `entry.maxIronByPlayer` (the determinism constraint at the top of this plan). `runGameEntry` (`src/sweep/run.ts:148-182`) has the config in scope for `victoryThreshold`.

BEFORE starting work:
1. Invoke /superpowers:test-driven-development
2. Read docs/pitfalls/testing-pitfalls.md
Follow TDD: write failing test → implement → verify green.

- [ ] **Step 1: Write the failing tests** (append to `test/sweep/metrics.test.ts`), **and convert the pre-existing inline `GameEntry` literals**. WARNING (this is the step most likely to surprise you): `metrics.test.ts` builds `GameEntry` inline as `{ result, nPlayers, setupDecided, turn1Leaders }` in roughly **40 places across all existing describe-blocks**; the two new REQUIRED fields make every one a strict-TS error. Convert them mechanically to the `entry()` helper below (`entry(X, N)` replaces `{ result: X, nPlayers: N, setupDecided: false, turn1Leaders: [0] }`; literals with non-default `setupDecided`/`turn1Leaders` keep those via an extended helper signature or explicit fields). Before finishing, run `grep -c "turn1Leaders" test/sweep/metrics.test.ts` and confirm every remaining hit is either the helper itself or an intentional explicit fixture. Do NOT delete or semantically alter any existing test — this is a mechanical fixture conversion only.

```ts
describe("diversity metrics", () => {
  it("splits victory types per player count and computes decisive-3P+ iron share", () => {
    const entries = [
      entry(iron2p(0, 3, iot2p(3)), 2),                    // 2P iron — excluded from 3P+ share
      entry(iron3(0), 3),                                   // 3P iron
      entry(lastStanding3(1), 3),                           // 3P last-standing
      entry(cap3(), 3),                                     // 3P cap-hit — not decisive
    ];
    const m = computeMetrics(entries);
    expect(m.victoryTypeByNPlayers[2]).toEqual({ iron: 1 });
    expect(m.victoryTypeByNPlayers[3]).toEqual({ iron: 1, "last-standing": 1, none: 1 });
    expect(m.ironShareDecisive3P).toBeCloseTo(0.5); // 1 iron of 2 decisive 3P+ games
  });

  it("returns null iron share when there are no decisive 3P+ games", () => {
    const m = computeMetrics([entry(iron2p(0, 3, iot2p(3)), 2)]);
    expect(m.ironShareDecisive3P).toBeNull();
  });

  it("computes iron pressure over elimination-won games from maxIronByPlayer / victoryThreshold", () => {
    const e1 = entry(lastStanding3(0), 3, { maxIronByPlayer: [9, 4, 2], victoryThreshold: 12 }); // 0.75
    const e2 = entry(lastStanding3(1), 3, { maxIronByPlayer: [3, 6, 1], victoryThreshold: 12 }); // 0.5
    const e3 = entry(iron3(0), 3, { maxIronByPlayer: [12, 2, 2], victoryThreshold: 12 });        // iron win — excluded
    const m = computeMetrics([e1, e2, e3]);
    expect(m.ironPressureMean).toBeCloseTo((0.75 + 0.5) / 2);
    expect(m.ironPressure75Fraction).toBeCloseTo(0.5); // only e1 reached 0.75
  });

  it("returns null pressure when no elimination-won games exist", () => {
    const m = computeMetrics([entry(iron2p(0, 3, iot2p(3)), 2)]);
    expect(m.ironPressureMean).toBeNull();
    expect(m.ironPressure75Fraction).toBeNull();
  });

  it("excludes all-eliminated wipeouts (empty winnerOrCoalition) from decisive share and pressure", () => {
    const wipeout = makeResult({
      winnerOrCoalition: [], turns: 6, victoryType: "last-standing", hitTurnCap: false,
      ironOverTime: [[5, 2, 1]],
    });
    const m = computeMetrics([entry(wipeout, 3), entry(iron3(0), 3)]);
    expect(m.ironShareDecisive3P).toBeCloseTo(1.0); // only the iron win is decisive
    expect(m.ironPressureMean).toBeNull();          // the wipeout is not an elimination WIN
  });

  it("aggregates elimination causes from results", () => {
    const withElims = makeResult({
      winnerOrCoalition: [0], turns: 5, victoryType: "last-standing", hitTurnCap: false,
      ironOverTime: iot2p(5),
      eliminations: [
        { player: 1, cause: "brokenPerimeterAt18Factories", turn: 4, bountyTo: 0 },
      ],
    });
    const m = computeMetrics([entry(withElims, 2)]);
    expect(m.eliminationCauses).toEqual({ brokenPerimeterAt18Factories: 1 });
  });

  it("maxIronByPlayer helper takes the per-player max over ironOverTime rows", () => {
    const r = makeResult({ ironOverTime: [[1, 5], [4, 2], [3, 3]] });
    expect(maxIronByPlayer(r, 2)).toEqual([4, 5]);
  });
});
```

Test-file import changes: widen the existing import to `import { computeMetrics, maxIronByPlayer } from "../../src/sweep/metrics";` and add `import type { GameEntry, SweepMetrics } from "../../src/sweep/metrics";` (the file currently imports only `computeMetrics` + `SweepMetrics` + `GameResult`).

Fixture helpers to add near the existing ones (adapt names to the file's existing `entry`-building pattern — if the file builds `GameEntry` inline, add a helper):

```ts
function entry(
  result: GameResult,
  nPlayers: number,
  over: Partial<Pick<GameEntry, "maxIronByPlayer" | "victoryThreshold">> = {},
): GameEntry {
  return {
    result,
    nPlayers,
    setupDecided: false,
    turn1Leaders: [0],
    maxIronByPlayer: over.maxIronByPlayer ?? maxIronByPlayer(result, nPlayers),
    victoryThreshold: over.victoryThreshold ?? 10,
  };
}
function iron3(winner: number): GameResult {
  return makeResult({ winnerOrCoalition: [winner], turns: 4, victoryType: "iron", hitTurnCap: false, ironOverTime: [[5, 2, 1]] });
}
function lastStanding3(winner: number): GameResult {
  return makeResult({ winnerOrCoalition: [winner], turns: 6, victoryType: "last-standing", hitTurnCap: false, ironOverTime: [[5, 2, 1]] });
}
function cap3(): GameResult {
  return makeResult({ winnerOrCoalition: [], turns: 60, victoryType: "none", hitTurnCap: true, ironOverTime: [[5, 2, 1]] });
}
```

- [ ] **Step 2: Run to verify failure** — `bun run test -- test/sweep/metrics.test.ts` → FAIL (missing fields/exports).

- [ ] **Step 3: Implement** (`src/sweep/metrics.ts`)

`GameEntry` gains (both REQUIRED):

```ts
  /** Per-player max controlled iron over all `ironOverTime` rows (computed by the runner; carried so sharded runs don't need ironOverTime). */
  maxIronByPlayer: number[];
  /** The config's victoryThreshold for this game (denominator for iron-pressure). */
  victoryThreshold: number;
```

Exported helper:

```ts
/** Per-player max controlled iron across all turn-boundary rows. */
export function maxIronByPlayer(result: GameResult, nPlayers: number): number[] {
  const max = new Array<number>(nPlayers).fill(0);
  for (const row of result.ironOverTime) {
    for (let p = 0; p < nPlayers && p < row.length; p++) {
      if (row[p]! > max[p]!) max[p] = row[p]!;
    }
  }
  return max;
}
```

`SweepMetrics` gains:

```ts
  /** Victory-type counts split by player count: `victoryTypeByNPlayers[n][type]`. */
  victoryTypeByNPlayers: Record<number, Record<string, number>>;
  /** Iron share of DECISIVE games at 3+ players (2P is structurally uninformative; a game is decisive iff someone actually WON — victoryType !== "none" AND winnerOrCoalition non-empty, so all-eliminated wipeouts are excluded); null when no such games. */
  ironShareDecisive3P: number | null;
  /** Mean over elimination-WON games (victoryType "last-standing" with a non-empty winner — all-eliminated wipeouts excluded) of max(maxIronByPlayer)/victoryThreshold; null when none. */
  ironPressureMean: number | null;
  /** Fraction of elimination-won games (same non-empty-winner definition) where anyone reached >= 0.75 * victoryThreshold; null when none. */
  ironPressure75Fraction: number | null;
  /** Total elimination counts by cause, aggregated from `result.eliminations`. */
  eliminationCauses: Record<string, number>;
```

In `computeMetrics`: the empty-input return gains `victoryTypeByNPlayers: {}, ironShareDecisive3P: null, ironPressureMean: null, ironPressure75Fraction: null, eliminationCauses: {}`. In the main loop add:

```ts
    // Per-player-count victory types
    const vtByN = (victoryTypeByNPlayers[e.nPlayers] ??= {});
    vtByN[result.victoryType] = (vtByN[result.victoryType] ?? 0) + 1;

    // Decisive 3P+ iron share. "Decisive" requires an actual winner: the engine's
    // degenerate all-eliminated terminal is victoryType "last-standing" with an EMPTY
    // winnerOrCoalition — a wipeout is not a won game and must not count either way.
    const hasWinner = result.winnerOrCoalition.length > 0;
    if (e.nPlayers >= 3 && result.victoryType !== "none" && hasWinner) {
      decisive3p++;
      if (result.victoryType === "iron") iron3p++;
    }

    // Iron pressure over elimination-WON games (same non-empty-winner rule).
    if (result.victoryType === "last-standing" && hasWinner) {
      const best = e.maxIronByPlayer.length > 0 ? Math.max(...e.maxIronByPlayer) : 0;
      const pressure = e.victoryThreshold > 0 ? best / e.victoryThreshold : 0;
      pressures.push(pressure);
      if (pressure >= 0.75) pressure75++;
    }

    // Elimination causes
    for (const el of result.eliminations) {
      eliminationCauses[el.cause] = (eliminationCauses[el.cause] ?? 0) + 1;
    }
```

(with `const victoryTypeByNPlayers: Record<number, Record<string, number>> = {}; let decisive3p = 0, iron3p = 0, pressure75 = 0; const pressures: number[] = []; const eliminationCauses: Record<string, number> = {};` declared with the other accumulators, and the loop destructure widened to `const e of entries` / `const result = e.result` so `e.nPlayers` etc. are reachable). Return:

```ts
    victoryTypeByNPlayers,
    ironShareDecisive3P: decisive3p > 0 ? iron3p / decisive3p : null,
    ironPressureMean:
      pressures.length > 0 ? pressures.reduce((a, b) => a + b, 0) / pressures.length : null,
    ironPressure75Fraction: pressures.length > 0 ? pressure75 / pressures.length : null,
    eliminationCauses,
```

In `src/sweep/run.ts` `runGameEntry`, the returned entry gains:

```ts
    maxIronByPlayer: maxIronByPlayer(result, nPlayers),
    victoryThreshold: config.victoryThreshold,
```

(import `maxIronByPlayer` from `./metrics`).

**In the SAME task/commit — `ShardLine` field-carry** (`src/sweep/big300-merge.ts`): this MUST NOT be deferred to a later task. The parallel==sequential invariant test compares `computeMetrics` over sequential entries vs shard-reconstructed entries; the moment `computeMetrics` consumes `maxIronByPlayer`/`victoryThreshold`/`eliminations`, the shard path must carry the real values or that test diverges (placeholder values like `victoryThreshold: 0` would silently zero the pressure metric on the shard path). `ShardLine` gains `maxIronByPlayer: number[]`, `victoryThreshold: number`, and its `result` sub-object gains `eliminations: EliminationRecord[]` and `factorySourcesOverTime: FactorySourceCounts[][]` (import both types from `../driver/record`). `toShardLine` copies them from the entry; `toEntries` restores them (`ironOverTime` remains the ONLY dropped field — update the doc comments to say so and why the rest must round-trip).

- [ ] **Step 4: Fix remaining GameEntry constructors.** `grep -rn "turn1Leaders" src/ test/ --include='*.ts'` — classify each hit LITERAL-vs-ROUND-TRIPS exactly as in Task 1 Step 5. Every `GameEntry` LITERAL gains the two fields with REAL values (no placeholders anywhere). Known literal sites beyond Step-1 fixtures: `src/sweep/big300-merge.ts` `toEntries` (covered in Step 3) and possibly `test/sweep/run.test.ts` fixtures. `big300-shard.ts`/`big300-verify-shard.ts` go through `runGameEntry`/`toShardLine` and need NO edit. Note stragglers under Discoveries.

- [ ] **Step 5: Run** — `bun run test -- test/sweep/metrics.test.ts` → PASS; `bun run typecheck` → clean; `bun run test` → green.

BEFORE marking this task complete:
1. Review tests against docs/pitfalls/testing-pitfalls.md
2. Verify coverage: null-denominator paths (no decisive 3P+, no elimination games), the 2P-exclusion boundary (a 2P iron win must NOT count toward ironShareDecisive3P), the 0.75 boundary (pressure exactly 0.75 counts)
3. Run tests and confirm green

- [ ] **Step 6: Commit**

```bash
git add src/sweep/metrics.ts src/sweep/run.ts test/sweep/metrics.test.ts src/sweep/big300-merge.ts test/sweep/run.test.ts
git commit -m "feat(sweep): diversity metrics + ShardLine field-carry — per-count victory split, iron share/pressure, elimination causes"
```

### Task 3: Pin the ShardLine round-trip explicitly (test-only)

**Files:**
- Test: `test/sweep/run.test.ts` (add a focused round-trip test; the implementation landed in Task 2)

**Context:** Task 2's field-carry is already exercised end-to-end by the pre-existing parallel==sequential invariant test, but only indirectly (through metric equality). This task pins the round-trip field-by-field so a future ShardLine edit that drops a field fails with a pointed message instead of a metrics diff. `factorySourcesOverTime` round-trips as the Phase-2 diagnostic payload (small — ≤ turnCap rows × nPlayers × 3 ints). Note: carrying it is a deliberate, documented widening of the spec's ShardLine description (spec §4 names maxIron + eliminations; the factory-source data must survive sharded re-baseline runs to serve its purpose — record this as a spec-amendment line in the PR body, not a silent deviation).

**This task is test-only and intentionally NOT TDD** (the implementation already shipped in Task 2; a "failing test first" is impossible and chasing one would be a false alarm). Read docs/pitfalls/testing-pitfalls.md before writing the test.

- [ ] **Step 1: Write the pin test** (in `test/sweep/run.test.ts`, near the existing parallel==sequential shard-merge test; this test documents and pins behavior Task 2 already shipped, so it is expected to pass on first run — see Step 2)

```ts
it("ShardLine round-trips the instrumentation fields", () => {
  const config = { ...defaultConfig(), boardSize: 96, ironCount: 14, victoryThreshold: 10 };
  const entry = runGameEntry(config, { games: 1, turnCap: 60, baseSeed: 7n }, 0);
  const line = toShardLine(0, entry, 123);
  const [back] = toEntries([line]);
  expect(back!.maxIronByPlayer).toEqual(entry.maxIronByPlayer);
  expect(back!.victoryThreshold).toEqual(entry.victoryThreshold);
  expect(back!.result.eliminations).toEqual(entry.result.eliminations);
  expect(back!.result.factorySourcesOverTime).toEqual(entry.result.factorySourcesOverTime);
  // ironOverTime is still intentionally dropped:
  expect(back!.result.ironOverTime).toEqual([]);
  // and the metrics over the round-tripped entry are identical:
  expect(computeMetrics([back!])).toEqual(computeMetrics([{ ...entry, result: { ...entry.result, ironOverTime: [] } }]));
});
```

- [ ] **Step 2: Run** — `bun run test -- test/sweep/run.test.ts` → PASS immediately (the implementation shipped in Task 2; this test is a pin, not a driver — if it FAILS, Task 2's field-carry is incomplete: fix THAT, do not adjust this test).

- [ ] **Step 3: Full suite** — `bun run test` → green.

BEFORE marking this task complete:
1. Review tests against docs/pitfalls/testing-pitfalls.md
2. Verify: the byte-identical invariant test passes WITHOUT modification beyond fixtures — if it needed loosening, you broke the determinism constraint; STOP and fix `computeMetrics` instead
3. Run tests and confirm green

- [ ] **Step 4: Commit**

```bash
git add test/sweep/run.test.ts
git commit -m "test(sweep): pin ShardLine round-trip of instrumentation fields"
```

After completing this group (Tasks 1–3):
Review the batch from multiple perspectives. Minimum 3 review rounds — (1) determinism/GEO lens: PRNG untouched, hex maps canonical-keyed, no engine edits, goldens green; (2) contract lens: SessionRecord/LogEntry untouched, parallel==sequential byte-identical, every GameResult/GameEntry constructor updated; (3) test-quality lens vs docs/pitfalls/testing-pitfalls.md: seeded, structural, no vacuous assertions. If round 3 still finds issues, keep going until clean.

---

## Phase B — Gates & report

**Execution Status:** ⬜ NOT STARTED

### Task 4: Parallel diversity gate in health.ts

**Files:**
- Modify: `src/sweep/health.ts`
- Test: `test/sweep/health.test.ts`

**Context:** The existing `defaultHealthThresholds()`/`isHealthy` stay EXACTLY as they are (do NOT touch `scoreMetrics`/`rankHealthy` either — the old gate is not loosened; spec §3). The diversity gate is a parallel, provisional redefinition candidate.

BEFORE starting work:
1. Invoke /superpowers:test-driven-development
2. Read docs/pitfalls/testing-pitfalls.md
Follow TDD: write failing test → implement → verify green.

- [ ] **Step 1: Write the failing tests** (append to `test/sweep/health.test.ts`). Reuse the file's existing SweepMetrics fixture helper if one exists (extend it with the five new metric fields); if the file builds metrics literals inline, add this helper — a baseline that PASSES both gates, overridable per test:

```ts
function fixtureMetrics(over: Partial<SweepMetrics> = {}): SweepMetrics {
  return {
    gamesPlayed: 40,
    turnsHistogram: { 8: 40 },
    medianTurns: 8,
    meanTurns: 8,
    victoryType: { iron: 20, "last-standing": 20 },
    ironVictoryFraction: 0.5,
    noWinnerFraction: 0,
    capHitFraction: 0,
    setupDecidedFraction: 0,
    seatWinBias: { maxBiasAcrossGroups: 0.1, byNPlayers: { 3: 0.1 } },
    leadVolatility: 0.4,
    victoryTypeByNPlayers: { 3: { iron: 20, "last-standing": 20 } },
    ironShareDecisive3P: 0.5,
    ironPressureMean: 0.6,
    ironPressure75Fraction: 0.3,
    eliminationCauses: {},
    ...over,
  };
}
```

```ts
describe("isDiverseHealthy", () => {
  it("passes a balanced metrics set", () => {
    const m = fixtureMetrics({ ironShareDecisive3P: 0.5, ironPressureMean: 0.6 });
    expect(isDiverseHealthy(m).pass).toBe(true);
  });
  it("fails when iron dominates (share above the band)", () => {
    const m = fixtureMetrics({ ironShareDecisive3P: 0.9 });
    const r = isDiverseHealthy(m);
    expect(r.pass).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/ironShareDecisive3P 0.9 > max/);
  });
  it("fails when elimination dominates (share below the band)", () => {
    const m = fixtureMetrics({ ironShareDecisive3P: 0.1 });
    expect(isDiverseHealthy(m).pass).toBe(false);
  });
  it("fails when iron exerts no pressure in elimination games", () => {
    const m = fixtureMetrics({ ironPressureMean: 0.2 });
    expect(isDiverseHealthy(m).pass).toBe(false);
  });
  it("band boundaries are inclusive", () => {
    expect(isDiverseHealthy(fixtureMetrics({ ironShareDecisive3P: 0.25 })).pass).toBe(true);
    expect(isDiverseHealthy(fixtureMetrics({ ironShareDecisive3P: 0.75 })).pass).toBe(true);
  });
  it("null diversity metrics are skipped (not failed)", () => {
    const m = fixtureMetrics({ ironShareDecisive3P: null, ironPressureMean: null, ironPressure75Fraction: null });
    expect(isDiverseHealthy(m).pass).toBe(true);
  });
  it("still enforces the carried-over structural criteria", () => {
    const m = fixtureMetrics({ medianTurns: 1 });
    expect(isDiverseHealthy(m).pass).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `bun run test -- test/sweep/health.test.ts` → FAIL.

- [ ] **Step 3: Implement** (`src/sweep/health.ts`)

```ts
/**
 * Thresholds for the DIVERSITY health gate — the strategic-diversity redefinition
 * candidate (both iron and elimination viable; neither marginalized). Carries the
 * structural criteria of `HealthThresholds` unchanged, but replaces the one-sided
 * `minIronVictory` floor with a two-sided band on decisive 3P+ games plus an
 * iron-pressure floor over elimination-won games. 2P victoryType is structurally
 * uninformative and is deliberately absent from the gated quantities.
 *
 * Provisional starting values — final calibration is a Phase-2 decision with
 * re-baseline data (docs/superpowers/specs/2026-07-02-balance-redesign-design.md §3).
 */
export interface DiversityHealthThresholds {
  minMedianTurns: number;
  maxMedianTurns: number;
  maxSetupDecided: number;
  maxCapHit: number;
  maxSeatBias: number;
  minLeadVolatility: number;
  minIronShareDecisive3P: number;
  maxIronShareDecisive3P: number;
  minIronPressureMean: number;
}

export function diversityHealthThresholds(): DiversityHealthThresholds {
  return {
    minMedianTurns: 3,
    maxMedianTurns: 25,
    maxSetupDecided: 0.05,
    maxCapHit: 0.02,
    maxSeatBias: 0.20,
    minLeadVolatility: 0.2,
    minIronShareDecisive3P: 0.25,
    maxIronShareDecisive3P: 0.75,
    minIronPressureMean: 0.5,
  };
}

/**
 * Diversity-gate check. Same result shape as `isHealthy`. Null diversity metrics
 * (no decisive 3P+ games / no elimination-won games in the sample) SKIP their
 * criterion rather than failing it — absence of evidence is not a violation; the
 * caller sees the sample composition via `victoryTypeByNPlayers`.
 */
export function isDiverseHealthy(
  m: SweepMetrics,
  thresholds: DiversityHealthThresholds = diversityHealthThresholds(),
): HealthResult {
  const reasons: string[] = [];
  if (m.medianTurns < thresholds.minMedianTurns)
    reasons.push(`medianTurns ${m.medianTurns} < minMedianTurns ${thresholds.minMedianTurns}`);
  if (m.medianTurns > thresholds.maxMedianTurns)
    reasons.push(`medianTurns ${m.medianTurns} > maxMedianTurns ${thresholds.maxMedianTurns}`);
  if (m.setupDecidedFraction > thresholds.maxSetupDecided)
    reasons.push(`setupDecidedFraction ${m.setupDecidedFraction} > maxSetupDecided ${thresholds.maxSetupDecided}`);
  if (m.capHitFraction > thresholds.maxCapHit)
    reasons.push(`capHitFraction ${m.capHitFraction} > maxCapHit ${thresholds.maxCapHit}`);
  if (m.seatWinBias.maxBiasAcrossGroups > thresholds.maxSeatBias)
    reasons.push(`seatWinBias.maxBiasAcrossGroups ${m.seatWinBias.maxBiasAcrossGroups} > maxSeatBias ${thresholds.maxSeatBias}`);
  if (m.leadVolatility < thresholds.minLeadVolatility)
    reasons.push(`leadVolatility ${m.leadVolatility} < minLeadVolatility ${thresholds.minLeadVolatility}`);
  if (m.ironShareDecisive3P !== null) {
    if (m.ironShareDecisive3P < thresholds.minIronShareDecisive3P)
      reasons.push(`ironShareDecisive3P ${m.ironShareDecisive3P} < min ${thresholds.minIronShareDecisive3P}`);
    if (m.ironShareDecisive3P > thresholds.maxIronShareDecisive3P)
      reasons.push(`ironShareDecisive3P ${m.ironShareDecisive3P} > max ${thresholds.maxIronShareDecisive3P}`);
  }
  if (m.ironPressureMean !== null && m.ironPressureMean < thresholds.minIronPressureMean)
    reasons.push(`ironPressureMean ${m.ironPressureMean} < minIronPressureMean ${thresholds.minIronPressureMean}`);
  return { pass: reasons.length === 0, reasons };
}
```

- [ ] **Step 4: Run** — `bun run test -- test/sweep/health.test.ts` → PASS; `bun run typecheck`; `bun run test` → green.

BEFORE marking this task complete:
1. Review tests against docs/pitfalls/testing-pitfalls.md
2. Verify: inclusive band boundaries tested; null-skip tested; the OLD gate's tests untouched and green
3. Run tests and confirm green

- [ ] **Step 5: Commit**

```bash
git add src/sweep/health.ts test/sweep/health.test.ts
git commit -m "feat(sweep): parallel diversity health gate with provisional thresholds"
```

### Task 5: Report prints both gates side by side

**Files:**
- Modify: `src/sweep/orchestrate.ts` (GridEntry gains `diversity`; `findBalancedConfig` populates it)
- Modify: `src/sweep/report.ts` (grid table gains a `Diverse` column + diversity reasons; nearest-miss sections gain a diversity line)
- Modify: `src/sweep/big300-run.ts` (print/serialize the diversity verdict beside its existing health verdict)
- Test: `test/sweep/orchestrate.test.ts`

**Context & exact scope:** `GridEntry` (defined in `orchestrate.ts`) gains a REQUIRED `diversity: HealthResult` field, populated in `findBalancedConfig`'s `gridTable.map` as `diversity: isDiverseHealthy(metrics)` alongside the existing `health:`. **`src/sweep/big300-run.ts` is ALSO in scope** (the spec says runs report both gates side by side, and big300-run is the strong-play measurement path): wherever it computes/prints/serializes its `isHealthy` verdict, add the `isDiverseHealthy` verdict next to it — same JSON/console shape, additive only, no other changes to that script. Adding the required field breaks the hand-built `GridEntry` fixtures in `test/sweep/orchestrate.test.ts` (~lines 426-437, 498-528, 533-551) — add `diversity: { pass: true, reasons: [] }` (or a fail variant where the test needs one) to each; mechanical, do not alter test semantics. `report.ts` prints `health.pass`/`health.reasons` at three anchor sites: nearest-miss blocks (~line 102), the grid-table header (~line 129), and grid rows (~line 138); `GridEntry` is destructured as `{ config, metrics, health }` at ~line 137 — widen to include `diversity`. Do NOT change ranking/candidate selection — `rankHealthy`/`scoreMetrics` and the nearest-miss ordering stay driven by the OLD gate.

BEFORE starting work:
1. Invoke /superpowers:test-driven-development
2. Read docs/pitfalls/testing-pitfalls.md
Follow TDD: write failing test → implement → verify green.

- [ ] **Step 1: Write the failing test** (in `test/sweep/orchestrate.test.ts`, following that file's existing report-assertion style — assert the rendered report string contains the new column and a diversity verdict)

```ts
it("report renders the diversity verdict cell and its failing reasons", () => {
  // Build (or reuse) a report fixture whose single grid entry has health.pass=true and
  // diversity = { pass: false, reasons: ["ironShareDecisive3P 0.9 > max 0.75"] }, then:
  expect(reportText).toContain("| Diverse |");
  const row = reportText.split("\n").find((l) => l.includes("| Yes | No |"))!; // Pass=Yes, Diverse=No — adjacent cells
  expect(row).toBeDefined();
  expect(row).toContain("diversity: ironShareDecisive3P 0.9 > max 0.75"); // appended to the reasons cell
});

it("findBalancedConfig populates the diversity verdict from the metrics", () => {
  // Reuse the file's existing findBalancedConfig fixture (the small grid it already runs);
  // this pins the WIRING, which the report test alone cannot (its fixture is hand-built):
  for (const g of result.gridTable) {
    expect(g.diversity).toEqual(isDiverseHealthy(g.metrics));
  }
});
```

(import `isDiverseHealthy` from `../../src/sweep/health` in the test file.)

- [ ] **Step 2: Run to verify failure**, **Step 3: implement** (grid header gains `| Diverse |` IMMEDIATELY AFTER `| Pass |` and BEFORE `| Failing reasons |`; each row's cells go `... | ${passStr} | ${diversity.pass ? "Yes" : "No"} | ${reasonStr} |` — the diversity cell sits between the existing Pass and Failing-reasons cells, and `reasonStr` additionally appends `; diversity: <joined reasons>` when the diversity gate fails; nearest-miss blocks print a `**Diversity gate:** pass|fail — <reasons>` line after the existing failing-criteria block). Do NOT refactor report.ts's existing formatting helpers or reorder any other columns. **Step 4: run** — targeted then full suite green.

BEFORE marking this task complete:
1. Review tests against docs/pitfalls/testing-pitfalls.md
2. Verify: candidate selection/ranking demonstrably unchanged (existing orchestrate tests untouched and green)
3. Run tests and confirm green

- [ ] **Step 5: Commit**

```bash
git add src/sweep/orchestrate.ts src/sweep/report.ts test/sweep/orchestrate.test.ts
git commit -m "feat(sweep): report diversity-gate verdict alongside the health gate"
```

After completing this group (Tasks 4–5):
Review the batch from multiple perspectives. Minimum 3 review rounds — (1) semantics: old gate byte-identical behavior, diversity gate provisional-and-parallel, null-skip correct; (2) consumer audit: every isHealthy caller enumerated, ranking unaffected; (3) test-quality vs pitfalls docs. If round 3 still finds issues, keep going until clean.

---

## Phase C — Probe & sweep scripts

**Execution Status:** ⬜ NOT STARTED

### Task 6: Regime-persistence probe script

**Files:**
- Create: `src/sweep/probe-ladder.ts`

**Context:** Analysis script (spec §9: scripts are excluded from the TDD mandate; keep logic thin by reusing the tested `runGameEntry`). Modeled on `src/sweep/big300-shard.ts` (arg parsing, JSONL append, stderr progress). Node builtins allowed here (`node-shims.d.ts` covers the sweep dir pattern).

- [ ] **Step 1: Write the script**

```ts
// ABOUTME: Regime-persistence probe — runs CRN-indexed games at a configurable board/budget and
// ABOUTME: emits per-game JSONL (eliminations, maxIron, action-free summary) for ladder comparison.

import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import process from "node:process";

import { defaultConfig } from "../engine/config";
import type { RuleConfig } from "../engine/config";
import { mctsAgent, defaultMctsParams } from "../agent/mcts-agent";
import { runGameEntry } from "./run";

function arg(name: string, dflt?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i + 1 >= process.argv.length) {
    if (dflt !== undefined) return dflt;
    throw new Error(`missing --${name}`);
  }
  return process.argv[i + 1]!;
}

// Compare mode: --compare a.jsonl b.jsonl prints an outcome diff table and exits.
const cmpIdx = process.argv.indexOf("--compare");
if (cmpIdx !== -1) {
  const [aPath, bPath] = [process.argv[cmpIdx + 1]!, process.argv[cmpIdx + 2]!];
  const load = (p: string) =>
    new Map(readFileSync(p, "utf8").trim().split("\n").map((l) => {
      const g = JSON.parse(l);
      return [g.gameIndex as number, g] as const;
    }));
  const a = load(aPath);
  const b = load(bPath);
  let flips = 0;
  let compared = 0;
  for (const [gi, ga] of a) {
    const gb = b.get(gi);
    if (!gb) continue; // rung files may cover a subset of the baseline's indexes
    compared++;
    const same =
      ga.victoryType === gb.victoryType &&
      ga.turns === gb.turns &&
      JSON.stringify(ga.winners) === JSON.stringify(gb.winners) &&
      JSON.stringify(ga.eliminations) === JSON.stringify(gb.eliminations);
    if (!same) flips++;
    console.log(
      `g${gi}: ${same ? "IDENTICAL" : "FLIPPED"} | a: ${ga.victoryType} t=${ga.turns} | b: ${gb.victoryType} t=${gb.turns}`,
    );
  }
  // Denominator MUST be games actually compared, not the baseline size — the ladder
  // rungs run only the clock-game subset, and the 3/n bound is computed from this line.
  console.log(`\n${flips} flipped of ${compared} compared`);
  process.exit(0);
}

const config: RuleConfig = {
  ...defaultConfig(),
  boardSize: Number(arg("board", "150")),
  radius: Number(arg("radius", "5")),
  ironCount: Number(arg("iron", "16")),
  victoryThreshold: Number(arg("vt", "12")),
};
const iters = Number(arg("iters", "30"));
const maxDepth = Number(arg("depth", String(defaultMctsParams().maxDepth)));
const turnCap = Number(arg("turn-cap", "15"));
const baseSeed = BigInt(arg("base-seed", "1"));
const indexes = arg("indexes").split(",").map(Number);
const outPath = arg("out");

// Rerun safety: appending to an existing rung file silently corrupts comparisons.
// Refuse to touch an existing output unless --force is passed (which deletes it first).
if (existsSync(outPath)) {
  if (process.argv.includes("--force")) rmSync(outPath);
  else throw new Error(`${outPath} exists — pass --force to overwrite, or pick a new path`);
}
mkdirSync(dirname(outPath), { recursive: true });

for (const gameIndex of indexes) {
  const t0 = Date.now();
  const entry = runGameEntry(config, {
    // `games` is not read by runGameEntry (it drives runConfigEntries' loop only) — nominal value.
    games: gameIndex + 1,
    turnCap,
    baseSeed,
    agentFactory: () => mctsAgent({ ...defaultMctsParams(), iterations: iters, maxDepth }),
  }, gameIndex);
  const elapsedMs = Date.now() - t0;
  const line = {
    gameIndex,
    nPlayers: entry.nPlayers,
    victoryType: entry.result.victoryType,
    turns: entry.result.turns,
    winners: entry.result.winnerOrCoalition,
    eliminations: entry.result.eliminations,
    maxIronByPlayer: entry.maxIronByPlayer,
    factorySourcesOverTime: entry.result.factorySourcesOverTime,
    iters,
    maxDepth,
    elapsedMs,
  };
  appendFileSync(outPath, JSON.stringify(line) + "\n", "utf8");
  console.error(
    `[ladder] g${gameIndex} (${entry.nPlayers}P, iters=${iters}, depth=${maxDepth}): ${entry.result.victoryType} t=${entry.result.turns} ${(elapsedMs / 1000).toFixed(0)}s`,
  );
}
```

- [ ] **Step 2: Smoke-run** (cheap, dense board so it resolves in seconds):

Run: `bun src/sweep/probe-ladder.ts --board 96 --iron 14 --vt 10 --indexes 0 --iters 5 --out <your-session-scratchpad>/ladder-smoke.jsonl` (write the smoke output to your session scratchpad directory, not the repo and not /tmp)
Expected: one JSONL line with `victoryType`, `eliminations`, `maxIronByPlayer` populated; stderr progress line.

- [ ] **Step 3: Typecheck + commit**

```bash
bun run typecheck
git add src/sweep/probe-ladder.ts
git commit -m "feat(sweep): regime-persistence probe-ladder script"
```

### Task 7: Weak-agent placeRange/density sweep script

**Files:**
- Create: `src/sweep/placerange-sweep.ts`

**Context:** placeRange has never been swept in any run (`src/sweep/main.ts` grid axes are boardSize/radius/ironCount/victoryThreshold; OFAT covers victoryThreshold/attackRange only). Weak agent (default `heuristicAgent` via `runConfig`'s default factory), 80 games/config, CRN baseSeed 1n, turnCap 60. Evidence-tier labeling in the output header is MANDATORY (uncontested-regime directional evidence — the two-regime finding says weak-agent results don't transfer to strong play).

- [ ] **Step 1: Write the script**

```ts
// ABOUTME: Weak-agent placeRange/density sweep — OFAT placeRange over two baselines (big300, sparse150),
// ABOUTME: reporting the diversity metrics + both gates. Uncontested-regime directional evidence ONLY.

import { writeFileSync } from "node:fs";
import { defaultConfig } from "../engine/config";
import type { RuleConfig } from "../engine/config";
import { runConfig } from "./run";
import { isHealthy, isDiverseHealthy } from "./health";

const GAMES = 80;
const TURN_CAP = 60;
const BASE_SEED = 1n;
const PLACE_RANGES = [3, 4, 5, 6, 7, 8];

const BASELINES: { name: string; config: RuleConfig }[] = [
  { name: "big300", config: { ...defaultConfig(), boardSize: 300, radius: 5, ironCount: 16, victoryThreshold: 12 } },
  { name: "sparse150", config: { ...defaultConfig(), boardSize: 150, radius: 5, ironCount: 16, victoryThreshold: 12 } },
];

const lines: string[] = [
  "# placeRange weak-agent sweep",
  "",
  "_EVIDENCE TIER: weak `heuristicAgent`, uncontested-race regime. Directional input only —",
  "weak-agent results do not transfer to strong play (two-regime finding). Generated by",
  "`src/sweep/placerange-sweep.ts`; CRN baseSeed=1, 80 games/config, turnCap=60._",
  "",
];

for (const { name, config } of BASELINES) {
  lines.push(`## ${name}`, "");
  lines.push(
    "| placeRange | medianTurns | ironShareDecisive3P | ironPressureMean | elimCauses | capHit | health | diverse |",
    "|---|---|---|---|---|---|---|---|",
  );
  for (const pr of PLACE_RANGES) {
    const m = runConfig({ ...config, placeRange: pr }, { games: GAMES, turnCap: TURN_CAP, baseSeed: BASE_SEED });
    const fmt = (x: number | null): string => (x === null ? "n/a" : x.toFixed(3));
    lines.push(
      `| ${pr} | ${m.medianTurns} | ${fmt(m.ironShareDecisive3P)} | ${fmt(m.ironPressureMean)} | ${JSON.stringify(m.eliminationCauses)} | ${m.capHitFraction.toFixed(3)} | ${isHealthy(m).pass ? "Yes" : "No"} | ${isDiverseHealthy(m).pass ? "Yes" : "No"} |`,
    );
    console.error(`[placerange] ${name} pr=${pr} done`);
  }
  lines.push("");
}

const out = "docs/sweeps/2026-07-02-balance-diagnosis/placerange-weak-sweep.md";
writeFileSync(out, lines.join("\n") + "\n", "utf8");
console.error(`wrote ${out}`);
```

- [ ] **Step 2: Smoke-run with a tiny budget** — temporarily invoke via a 2-value/8-game variant by editing constants locally? NO — do not edit-and-revert; instead run the real script once in Task 8 (it IS the run). For the smoke, just typecheck:

```bash
bun run typecheck
git add src/sweep/placerange-sweep.ts
git commit -m "feat(sweep): weak-agent placeRange/density sweep script"
```

After completing this group (Tasks 6–7):
Review the batch: (1) scripts reuse `runGameEntry`/`runConfig` (no reimplemented game loops — the tested path is the only path); (2) output paths are durable repo paths under docs/sweeps/2026-07-02-balance-diagnosis/ (ORCH-1: findings persist to files, never stdout-only); (3) stderr-only progress, stdout/files clean. Minimum 3 rounds; continue until clean.

---

## Phase D — Probe & sweep execution + documentation

**Execution Status:** ⬜ NOT STARTED

### Task 8: Run the ladder + the placeRange sweep; write the reports

**Files:**
- Create: `docs/sweeps/2026-07-02-balance-diagnosis/regime-persistence-ladder.md`
- Create: `docs/sweeps/2026-07-02-balance-diagnosis/data/ladder-*.jsonl` (one file per rung)
- Create (by script): `docs/sweeps/2026-07-02-balance-diagnosis/placerange-weak-sweep.md`
- Modify: `docs/sweeps/2026-07-02-balance-diagnosis/2026-07-02-elimination-decomposition.md` (fold the full ladder results into its "Regime scope and budget-sensitivity" section)

**Prior evidence already committed** (design pass, 2026-07-02): `data/probe-b150sparse-i{30,100,300}.jsonl` — board-150 sparse games 2–3 were move-for-move identical across the whole 30→100→300 ladder (zero decision-point flips). The full ladder here extends n (more seeds) and adds the maxDepth rung. **Consistency check is OUTCOME-EQUIVALENCE, not file equality:** those prior files came from the design-pass scratch instrumentation and use a DIFFERENT JSON schema (`eliminations[].victim` vs `player`, `maxIron` vs `maxIronByPlayer`, a `rounds` array the new script doesn't emit). For games 2–3, compare the named fields — victoryType, turns, winners, the (player, cause, turn) elimination tuples, and per-player max iron — between old and new outputs. If THOSE disagree, STOP: engine/agent behavior changed, which this plan must not do. Do not compare bytes or schemas.

**Protocol (spec §5):** all on the sparse150 config (`boardSize 150, radius 5, ironCount 16, victoryThreshold 12`), turnCap 15, baseSeed 1:

- [ ] **Step 1: Screen.** `bun src/sweep/probe-ladder.ts --indexes 0,1,2,3,4,5,6,7,8,9,10,11,12,13,14 --iters 30 --out docs/sweeps/2026-07-02-balance-diagnosis/data/ladder-i30.jsonl` (~1.5 h; run in background, serially — do NOT run rungs concurrently, the machine memory-pressure kills parallel MCTS processes; observed during the design pass).
- [ ] **Step 2: Identify clock games** — games whose eliminations include `brokenPerimeterAt18Factories` (expect ~half, but this is a hypothesis, not a promise — the design-pass screen found 2 of 4). Record the index list in the ladder report. **If the screen yields ZERO clock-regime games, STOP the ladder and report it** — the regime failed to reproduce at this config, which is itself a decision-grade finding (spec §5 decision rule: regime dissolves → re-derive the target); do not hunt for a config that produces the expected answer.
- [ ] **Step 3: Rungs.** With `DATA=docs/sweeps/2026-07-02-balance-diagnosis/data` and `<CLOCK>` = the comma-joined clock-game indexes from Step 2: `bun src/sweep/probe-ladder.ts --indexes <CLOCK> --iters 100 --out $DATA/ladder-i100.jsonl`, then the same with `--iters 300 --out $DATA/ladder-i300.jsonl`, then `--iters 100 --depth 16 --out $DATA/ladder-i100-d16.jsonl`. Overnight-scale; sequential.
- [ ] **Step 4: Compare.** `bun src/sweep/probe-ladder.ts --compare $DATA/ladder-i30.jsonl $DATA/ladder-i300.jsonl`, then i30-vs-i100 and i100-vs-i100-d16. Record flip counts per pair.
- [ ] **Step 5: Run the placeRange sweep.** `bun src/sweep/placerange-sweep.ts` (~1–2 h weak-agent compute).
- [ ] **Step 6: Write `regime-persistence-ladder.md`:** protocol, per-rung tables (game × victoryType/turns/causes/maxIron), flip counts with the rule-of-three bound (`3/n` at 95% for zero flips), the maxDepth-rung reading, and the DECISION-RULE verdict from spec §5 (persists → clock-counting lever activates for Phase 2; dissolves → re-derive target). State CIs honestly; n≈6–10 is directional, not a persist-rate estimate.
- [ ] **Step 7: Append to the decomposition doc** under "Regime scope and budget-sensitivity": the design-pass early rungs (iters=100 and iters=300 on board-150 games 2–3: move-for-move identical where measured) and the full ladder results; correct any statement the ladder contradicts (the doc currently says "results to be appended").
- [ ] **Step 8: Commit** (docs-only commits are fine mid-stream; keep data + report together):

```bash
git add docs/sweeps/2026-07-02-balance-diagnosis/
git commit -m "docs(balance): regime-persistence ladder + placeRange weak sweep results"
```

After completing this group:
Review: (1) every numeric claim in the reports reproduces from the committed JSONL; (2) evidence tiers labeled (weak-agent vs reduced-MCTS vs production-300); (3) the decision-rule verdict is stated with its statistical honesty caveats, not overclaimed. Minimum 3 rounds; continue until clean.

---

## Phase E — Ship

**Execution Status:** ⬜ NOT STARTED

### Task 9: Verify, PR, blind adversarial review, merge

- [ ] **Step 1: Full verification.** Invoke /superpowers:verification-before-completion. Run `bun run typecheck` and `bun run test` — both must be fully green with pristine output. Confirm goldens (`control-parity`, `mcts-determinism`) untouched and green.
- [ ] **Step 2: Push + PR.**

```bash
git push -u origin feat/balance-phase1-instrument   # the implementation branch (see §Branching & PRs); PR targets dev
gh pr create --base dev --title "Balance Phase 1: instrumentation, diversity metrics, probes" --body "$(cat <<'EOF'
Phase 1 of the balance-redesign program (spec: docs/superpowers/specs/2026-07-02-balance-redesign-design.md).
Driver captures elimination records + factory-source counts; sweep gains diversity metrics and a
parallel provisional gate; probe-ladder + placeRange sweep scripts; ladder + sweep results in
docs/sweeps/2026-07-02-balance-diagnosis/. No engine rule changes; no serialized-contract changes;
goldens untouched.

## Merge classification
Routine — instrumentation + metrics + analysis scripts only (no engine rules, no contracts). Per the
merge protocol in spec §8, merging after the blind adversarial review below.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Blind Fable adversarial review (Sam-authorized merge gate).** Dispatch a FRESH Fable subagent with NO session context — prompt contains only: the repo path, the PR number, and the instruction to review `git diff origin/dev...HEAD` plus the PR body adversarially for correctness bugs, contract/golden implications, determinism (GEO-3/GEO-4), test quality (docs/pitfalls/testing-pitfalls.md), and unintended behavior changes; report findings with severities. Post the review outcome as a PR comment. If it raises substantive concerns: fix and re-review, or escalate to Sam. Do NOT proceed on an unresolved substantive finding.
- [ ] **Step 4: Wait for CI green** (use a monitoring tool, not sleep+poll), then merge:

```bash
gh pr merge <N> --merge
git push origin --delete <branch>   # manual delete; --delete-branch is unreliable from a worktree
```

- [ ] **Step 5: Update this plan's banners + Execution Status table** (ship SHAs, merge SHA, deviations, discoveries) and report completion status (DONE/DONE_WITH_CONCERNS/...) to Sam with the ladder verdict headline.

---

## Self-review record (plan author)

Spec coverage: §3→Tasks 2/4/5, §4→Tasks 1/2/3, §5→Tasks 6/8, §6→Tasks 7/8, §8→Task 9, §9→TDD blocks per task. Placeholder scan: none — every code step carries complete code; Task 5's implementation is anchored to read-first sites with the exact strings to mirror (the one deliberate adapt-to-local-shape step, justified because orchestrate.ts's GridEntry construction site was not read at plan time — executor MUST read it first). Type consistency: `EliminationRecord`/`FactorySourceCounts` defined in Task 1 and consumed by name in Tasks 2/3/6; `maxIronByPlayer` helper defined Task 2, used Tasks 2/3; `isDiverseHealthy` defined Task 4, used Tasks 5/7.

---

## Plan-review-cycle record (2026-07-02)

Five rounds, terminating on a zero-finding round: R1 author self-review (8 findings — worst: ShardLine field-carry sequencing that would have broken the parallel==sequential invariant mid-plan); R2 independent cold-read, Opus (9 — worst: ~40 inline GameEntry fixture literals in metrics.test.ts left unmentioned; mis-listed literal-constructor sites); R3 author second-order pass (6 — stale references left by earlier fixes); R4 cross-model Codex, gpt high-reasoning (10 — worst: compare-mode denominator bug that would have poisoned the ladder's 3/n bound; empty-coalition wipeouts polluting the pressure/decisive metrics; false-STOP schema-equality instruction); R5 author (0). All findings fixed inline; the factorySourcesOverTime ShardLine carry is a deliberate, documented widening of spec §4 to be recorded in the PR body.
