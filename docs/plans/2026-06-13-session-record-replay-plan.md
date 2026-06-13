# Session Record & Replay Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, deterministic **session log layer** for Industrial Juggernaut — the `SessionRecord` wire format, the round-by-round log state machine, an all-agent **record** driver, and a **replay** procedure that reconstructs a recorded game bit-exactly — all TDD'd in plain bun/vitest with **zero Cloudflare/infra dependencies**.

**Architecture:** A new `src/session/` module sits *on top of* the engine barrel (`src/index.ts`). It defines the JSON interchange shapes (spec §3 `SessionRecord`/`LogEntry`), a deterministic `stateHash`, and two halves of one invariant: `recordGame` plays an all-agent game and emits a `LogEntry[]` carrying each entry's `rngBeforeApply` (the post-agent-selection, pre-apply RNG state); `replayLog` installs each entry's `rngBeforeApply` and re-runs the engine to reproduce the identical terminal state and per-boundary `stateHash`. The session never invokes the engine's atomic multi-decl `applyAttack` — it composes **per declaration** (`applyAction → applyEliminations(actingPlayer) → removeEncircledStrandedBases`), the documented digital ruling. This is **plan 1 of the DO-host effort**: it is the infra-free core the Durable Object host (plan 2) and the §6 production cutover (plan 3) build on, and it directly powers §4's Phase-1 all-agent viewer (record → replay → step).

**Tech Stack:** TypeScript (strict ESM, ESNext/Bundler), vitest + fast-check under bun. No runtime dependencies. Imports the engine via deep paths (`src/engine/**`, `src/rng/**`, `src/board/**`, `src/agent/**` for the record driver only).

---

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

**Overall:** Not started.

| Phase | Status | Ship SHA(s) | Notes |
|---|---|---|---|
| 1 — Wire-format types + SessionRecord/LogEntry codec | ⬜ Not started | — | — |
| 2 — `stateHash` (deterministic divergence checksum) | ⬜ Not started | — | — |
| 3 — `applyEntry` round state machine | ⬜ Not started | — | depends on 1 |
| 4 — `recordGame` all-agent record driver | ⬜ Not started | — | depends on 1,3 |
| 5 — `replayLog` + §7 replay-equivalence property tests | ⬜ Not started | — | depends on 2,3,4 — highest-value phase |
| 6 — Session validation (defense in depth) | ⬜ Not started | — | depends on 1 |

### Discoveries

- **This is plan 1 of a 4-plan DO-host arc; scope boundary is deliberate.** Spec §3 says "the DO is a thin host (sockets, storage, one alarm) around a pure `GameSession` module — TDD'd in plain vitest, no workerd." Per the `writing-plans` Scope Check (one plan per subsystem, each producing testable software on its own) the §3+§6+§7 work is split:
  - **Plan 1 (this plan):** the wire format + the deterministic record/replay core + session validation. Infra-free; bun/vitest. Delivers §4's all-agent-viewer backend and the replay foundation.
  - **Plan 2 (follow-on):** the interactive `GameSession` reducer — human commands (`build`/`attack`/`endRound`/`pass`/`placeFirstBase` with `expectedLogIndex`), pending-decision/defender-substitution, seat-claim, resync payloads, wire-event broadcast shapes (§3 Wire protocol + Pending decisions). Still pure (no workerd). Builds directly on this plan's `applyEntry`/`replayLog`/validation.
  - **Plan 3 (follow-on):** the Durable Object host — storage layout (header/log/snapshot/pending rows, atomic multi-key `put`), recovery (snapshot+tail, `replayVersion` mismatch), critical-section ordering (await-storage-before-broadcast), WebSocket hibernation, the defender-timeout alarm, the Worker shell + `wrangler.jsonc` + `@cloudflare/vitest-pool-workers` tests + `deploy-staging.yml` + the `replayVersion` CI guard (§3 Storage/Recovery, §7 DO-host tests).
  - **Plan 4 (follow-on):** the §6 production cutover — `promote.yml`, `PROMOTE_TOKEN`, `main` branch protection, default-branch flip to `dev`, the `git-strategy.md`/CLAUDE.md/AGENTS.md rewrites, the replay-compat golden-corpus gate, the staging e2e smoke. (Needs a staging-validated Worker, i.e. plan 3.)
- **Engine API is final and barrel-exposed** (`src/index.ts`, foundation plan complete): `initGame`, `setupPhaseState`, `representativeFirstBase`, `placeFirstBase`, `legalFirstBaseHexes`, `applyAction`, `applyEliminations`, `removeEncircledStrandedBases`, `advanceRound`, `currentPlayer`, `status`, `legalActions`, `representativeDefender`, `buildBudget`, `control`, `generateBoard`, `loadBoard`, `seed`, `nextUint32`, `nextFloat`, `encodeRng`, `decodeRng`, `defaultConfig`, and all engine types incl. `BoardSource`, `RngState`, `EncodedRng`. **`advanceRound` now throws on a turn-0 (setup) state** (foundation Phase 5 hardening) — setup placements use `placeFirstBase`, which itself transitions turn 0→1 on the last placement; never call `advanceRound` during setup.
- **The RNG codec already exists** (`src/rng/codec.ts`: `encodeRng`/`decodeRng`, `EncodedRng = {state:string;inc:string}`). All bigint↔string conversion in this plan MUST go through it — never `Number()` (precision loss > 2^53; testing-pitfalls §8 + foundation GEO/codec work).
- **`stepRound(state, action)` IS the canonical single-decl composition** (`src/engine/round.ts:23`): `applyAction → applyEliminations(actingPlayer) → removeEncircledStrandedBases`. For the all-agent path (single-declaration actions only, true of greedy/heuristic), the session composition equals `stepRound`. The plan deliberately re-expresses the composition per-entry in `applyEntry` rather than calling `stepRound`, because (a) `applyEntry` must thread `rngBeforeApply` and drive `advanceRound`/`status` per the log state machine, and (b) the interactive session (plan 2) needs the per-declaration form for human multi-attack chains. §7 pins to the per-declaration composition, NOT to `stepRound` equivalence (spec §3).

---

## Execution discipline (BINDS EVERY TASK BELOW)

Every task inherits this block. Each task's final step says "apply the Execution Discipline block" — that means all of the following.

**BEFORE starting any task:**
1. Invoke `superpowers:test-driven-development`.
2. Read `docs/pitfalls/testing-pitfalls.md` and `docs/pitfalls/implementation-pitfalls.md` (GEO-1..7 bind any engine-adjacent reasoning; §8 testing-pitfalls binds determinism/replay tests).
3. Follow TDD: write the failing test → run it red → write minimal code → run it green → refactor green.

**TDD scope:** every task here is PRODUCTION code under `src/session/` — all are TDD (no exceptions in this plan; there is no config/docs-only task).

**Session purity invariants (MUST hold for every `src/session/` file):**
- No `Math.random()`; all randomness comes from the engine's threaded `RngState` (GEO-3). The session installs recorded `rngBeforeApply` and re-runs engine functions; it never draws on its own except via the agent closures in `recordGame`.
- No Node-only APIs (`fs`, `process`, `node:*`), no new runtime dependencies. This module must bundle into a Worker (plan 3) and the browser (the all-agent viewer) unchanged.
- All `RngState` bigint↔string conversion goes through `encodeRng`/`decodeRng` (`src/rng/codec.ts`); never `Number()` / `parseFloat()` / `JSON.stringify` a raw bigint. (The ONE exception is the session `seed` — a plain `bigint`, not an `RngState`: it encodes via `seed.toString()` and decodes via `BigInt(str)`, the same precision-safe pattern, just not through the RngState codec. Every per-entry `rngBeforeApply` DOES go through the codec.)
- Hex/state collections keyed by the engine's canonical `key(hex)` string, never object identity (GEO-4).
- `src/session/**` MUST NOT import `src/driver/**`. It MAY import `src/engine/**`, `src/rng/**`, `src/board/**`, `src/geometry/**`, and (in `recordGame` only) `src/agent/**`.

**Test discipline (testing-pitfalls.md):**
- Run the suite with `bun run test` — NEVER `bun test` (bun's native runner ignores `vitest.config.ts`). Targeted: `bun run test -- <pattern>`. Typecheck: `bun run typecheck`.
- Vitest globals are OFF — every test file imports what it uses: `import { test, expect } from "vitest";` (`describe`/`it` optional; the file must import them).
- Seed every randomized test with a fixed seed (§8). A property test that fails is a real defect — fix the cause, NEVER narrow the generator or loosen the assertion to hide it.
- **Replay/determinism assertions: if a test races, flakes, or fails nondeterministically, the fix is the underlying determinism bug (a missed `rngBeforeApply` install, a non-canonical hash), NEVER weakening the assertion.** Compare game states by structural `toEqual` and hex sets by sorted canonical keys, never by stringified blobs (§8). The commit subject for any change touching test assertions states what happened to them.
- Cover error paths explicitly and assert on the error MESSAGE text (regex), not just that it threw (§3).
- 2-line `// ABOUTME:` header on every new file.

**BEFORE marking any task complete:**
1. Review the new tests against `docs/pitfalls/testing-pitfalls.md` (error paths? edge cases? regime boundaries 3↔4 bases / commitment 3/4/5/6? §8 replay equivalence?).
2. Run `bun run typecheck` and `bun run test`; confirm both green with pristine output (no stray stderr/warnings — §1).
3. Commit with an honest, scoped message (exact messages given per task).

**After completing each PHASE:** review the batch from at least 3 perspectives (correctness, determinism/replay-faithfulness, test rigor). If round 3 still finds issues, keep going until clean. Update this plan's Execution Status banner + table per the Living Document Contract.

**Worktree/branch:** all work on a branch off `dev` (`feat/*` in worktrees under `.claude/worktrees/<slug>`), never on local `main` or `dev` directly. PRs target `dev`. Merge gate = the GitHub Actions `check` job green (the Cloudflare "Workers Builds" check fails until plan 3 adds a Worker — known external noise, does not gate; see the foundation plan's Discoveries).

---

## Test fixture conventions (use these, do not invent)

- A reusable session-test header builder lives in `test/session/helpers.ts` (created in Task 1.1). It returns a `{ seed, config, boardSource, seats }` header for N all-agent (greedy) seats on a generated board, defaulting to `seed(1n)`-equivalent (`seed: 1n`), `defaultConfig()`, `{ kind: "generate", size: 96, ironCount: 14 }`. Reuse it everywhere instead of re-spelling the header.
- The engine's deterministic board is `generateBoard(seed(1n), { size: 96, ironCount: 14 })` (93 hexes, 14 iron). `mkState` from `test/helpers/state.ts` and the verified on-board coordinates in `test/engine/apply-attack.test.ts` are available if a hand-built `GameState` is needed.
- **A short all-agent game is the workhorse fixture.** `recordGame` (Task 4.1) with greedy seats and a small `turnCap` produces a real `SessionRecord` for the replay/codec tests. Prefer recording a game over hand-authoring a `LogEntry[]` — hand-authored `rngBeforeApply` values are almost always wrong and make the test lie.
- Greedy agents are deterministic for a fixed seed; `seed: 1n` + a fixed turnCap yields a stable log. If a fixture game hits the turn cap without terminating, pick a different seed that produces a real victory (mirror the search in `test/driver/run.test.ts` "reaches a real terminal victory").

## File ownership & execution order (prevents merge conflicts)

Execute phases in numeric order. Within shared-file sets, the earlier task MUST land (merge to `dev`) before the later starts, so each branches from an up-to-date `dev`:

| File | Tasks that create/modify it | Required order |
|---|---|---|
| `src/session/types.ts` | 1.1 (create) | — |
| `src/session/codec.ts` | 1.2 (create) | after 1.1 |
| `test/session/helpers.ts` | 1.1 (create) | — |
| `src/session/hash.ts` | 2.1 (create) | — (independent; parallel-safe with Phase 1) |
| `src/session/round.ts` | 3.1 (create `applyEntry`) | after 1.1 |
| `src/session/record.ts` | 4.1 (create `recordGame`) | after 3.1 |
| `src/session/replay.ts` | 5.1 (create `replayLog`) | after 3.1, 2.1 |
| `src/session/validation.ts` | 6.1 (create) | after 1.1 |
| `src/session/index.ts` (session barrel) | 6.2 (create — NOT `src/index.ts`) | after 1–6 |

**Safe to parallelize** (file-disjoint): Phase 2 (`hash.ts`) is independent of Phase 1 and may run anytime after `src/session/types.ts` is unnecessary for it (it only needs `GameState` from the engine). Everything else is sequential through the `types.ts → round.ts → record.ts → replay.ts` chain.

---

## Phase 1 — Wire-format types + `SessionRecord`/`LogEntry` codec

**Execution Status:** ⬜ NOT STARTED

The JSON interchange shapes (spec §3) and the bigint↔string codec that makes them JSON-safe. `SessionRecord` is the canonical pre-authorized artifact named in §6 — its field list is exact and MUST NOT drift.

### Task 1.1: Session types + the test header helper

**Files:**
- Create: `src/session/types.ts`
- Create: `test/session/helpers.ts`
- Test: `test/session/types.test.ts`

- [ ] **Step 1: Write the failing test** (`test/session/types.test.ts`) — a type-presence + shape smoke that pins the closed `LogEntry` union and the exact `SessionRecord` field list:

```ts
// ABOUTME: Pins the closed LogEntry union and the exact SessionRecord field list (spec §3).
// ABOUTME: A type+shape smoke — fails typecheck if a kind is dropped or a field renamed.
import { test, expect } from "vitest";
import { seed } from "../../src/rng/pcg";
import { hex } from "../../src/geometry/cube";
import type { LogEntry, SessionRecord, SeatConfig } from "../../src/session/types";

test("SessionRecord carries exactly the spec §3 fields", () => {
  const rec: SessionRecord = {
    formatVersion: 1,
    replayVersion: "test",
    seed: "1",
    config: { } as any, // RuleConfig — shape pinned by the engine, not here
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    seats: [{ kind: "human" }, { kind: "agent", agent: "heuristic" }],
    log: [],
  };
  expect(Object.keys(rec).sort()).toEqual(
    ["boardSource", "config", "formatVersion", "log", "replayVersion", "seats", "seed"],
  );
});

test("LogEntry union covers all six v1 kinds, each carrying player + rngBeforeApply", () => {
  const r = seed(1n);
  const entries: LogEntry[] = [
    { player: 0, kind: "placeFirstBase", hex: hex(0, 0, 0), rngBeforeApply: r },
    { player: 0, kind: "build", pieces: [{ type: "factory", hex: hex(0, 0, 0) }], rngBeforeApply: r },
    { player: 1, kind: "attack", decl: { target: hex(1, -1, 0), attackers: [hex(0,0,0)], defender: hex(2,-2,0) }, rngBeforeApply: r },
    { player: 1, kind: "endRound", rngBeforeApply: r },
    { player: 0, kind: "pass", rngBeforeApply: r },
    { player: 1, kind: "roundSkipped", rngBeforeApply: r },
  ];
  expect(entries.map((e) => e.kind).sort()).toEqual(
    ["attack", "build", "endRound", "pass", "placeFirstBase", "roundSkipped"],
  );
  for (const e of entries) { expect(typeof e.player).toBe("number"); expect(typeof e.rngBeforeApply.state).toBe("bigint"); }
});

const SEATS_OK: SeatConfig[] = [{ kind: "human" }, { kind: "agent", agent: "greedy", archetype: "economic" }, { kind: "agent", agent: "heuristic" }];
test("SeatConfig admits human, greedy(+archetype), heuristic", () => { expect(SEATS_OK).toHaveLength(3); });
```

Run `bun run typecheck` → FAIL (`src/session/types.ts` does not exist).

- [ ] **Step 2: Create `src/session/types.ts`:**

```ts
// ABOUTME: Wire-format types for the session log — SessionRecord, the closed LogEntry union, SeatConfig (spec §3).
// ABOUTME: SessionRecord is the JSON interchange shape (seed + rngBeforeApply are decimal strings in the encoded form).

import type { Archetype } from "../agent/archetypes";
import type { RuleConfig } from "../engine/config"; // RuleConfig lives in config, NOT re-exported by engine/types
import type {
  AttackDecl, BoardSource, Hex, PieceKind, PlayerId, RngState,
} from "../engine/types";

/** A single build piece (mirrors the engine's build-action piece shape). */
export type Piece = { type: PieceKind; hex: Hex };

/** How a seat is driven. Humans submit commands; agents auto-play. */
export type SeatConfig =
  | { kind: "human" }
  | { kind: "agent"; agent: "greedy"; archetype: Archetype }
  | { kind: "agent"; agent: "heuristic" };

/**
 * The closed v1 log union. `rngBeforeApply` is the RngState to install BEFORE
 * applying this entry's rules (post-agent-selection / naturally-threaded for
 * humans). `allianceOp` is intentionally absent — it lands with the Phase 3
 * alliance design as a formatVersion bump (spec §3, the union is closed per
 * version).
 */
export type LogEntry =
  | { player: PlayerId; kind: "placeFirstBase"; hex: Hex; rngBeforeApply: RngState }
  | { player: PlayerId; kind: "build"; pieces: Piece[]; rngBeforeApply: RngState }
  | { player: PlayerId; kind: "attack"; decl: AttackDecl; rngBeforeApply: RngState }
  | { player: PlayerId; kind: "endRound"; rngBeforeApply: RngState }
  | { player: PlayerId; kind: "pass"; rngBeforeApply: RngState }
  | { player: PlayerId; kind: "roundSkipped"; rngBeforeApply: RngState };

export type LogEntryKind = LogEntry["kind"];

/**
 * The save-export / replay-download / wire-snapshot shape (spec §3). The
 * canonical pre-authorized artifact named in §6 — this exact field list. `seed`
 * and each entry's `rngBeforeApply` are decimal strings in the ENCODED form (see
 * `codec.ts`); this in-memory shape keeps `seed` as a decimal string too, so the
 * record round-trips through JSON without a separate encoded type for the header.
 */
export type SessionRecord = {
  formatVersion: number;
  replayVersion: string;
  seed: string; // bigint → decimal string (codec)
  config: RuleConfig;
  boardSource: BoardSource;
  seats: SeatConfig[];
  log: EncodedLogEntry[];
};

/** A LogEntry with its bigint rngBeforeApply encoded to decimal strings (JSON-safe). */
export type EncodedLogEntry =
  | { player: PlayerId; kind: "placeFirstBase"; hex: Hex; rngBeforeApply: import("../rng/codec").EncodedRng }
  | { player: PlayerId; kind: "build"; pieces: Piece[]; rngBeforeApply: import("../rng/codec").EncodedRng }
  | { player: PlayerId; kind: "attack"; decl: AttackDecl; rngBeforeApply: import("../rng/codec").EncodedRng }
  | { player: PlayerId; kind: "endRound"; rngBeforeApply: import("../rng/codec").EncodedRng }
  | { player: PlayerId; kind: "pass"; rngBeforeApply: import("../rng/codec").EncodedRng }
  | { player: PlayerId; kind: "roundSkipped"; rngBeforeApply: import("../rng/codec").EncodedRng };

/** The decoded header (everything in a SessionRecord except the log), with seed as bigint. */
export type SessionHeader = {
  formatVersion: number;
  replayVersion: string;
  seed: bigint;
  config: RuleConfig;
  boardSource: BoardSource;
  seats: SeatConfig[];
};
```

> **Note:** the inline `import("../rng/codec").EncodedRng` keeps `types.ts` from a value-level dependency cycle; if the executor prefers a top-level `import type { EncodedRng } from "../rng/codec";` that is equivalent — use whichever keeps `bun run typecheck` clean and matches surrounding style.

- [ ] **Step 3: Create `test/session/helpers.ts`** (the reusable header builder; not a test file itself — a helper):

```ts
// ABOUTME: Shared session-test fixtures — an all-agent (greedy) header builder over the seed-1n board.
// ABOUTME: Reused by codec/record/replay/validation tests so the header is spelled once.
import type { SeatConfig, SessionHeader } from "../../src/session/types";
import { defaultConfig } from "../../src/engine/config";

function headerWith(seats: SeatConfig[], seed: bigint): SessionHeader {
  return {
    formatVersion: 1,
    replayVersion: "test",
    seed,
    config: defaultConfig(),
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    seats,
  };
}

/** An N-seat all-greedy header on the deterministic seed-1n generated board. */
export function greedyHeader(nPlayers: number, opts?: { seed?: bigint }): SessionHeader {
  return headerWith(
    Array.from({ length: nPlayers }, () => ({ kind: "agent" as const, agent: "greedy" as const, archetype: "economic" as const })),
    opts?.seed ?? 1n,
  );
}

/** An N-seat all-HEURISTIC header — exercises the variable-draw policy RNG path. */
export function heuristicHeader(nPlayers: number, opts?: { seed?: bigint }): SessionHeader {
  return headerWith(
    Array.from({ length: nPlayers }, () => ({ kind: "agent" as const, agent: "heuristic" as const })),
    opts?.seed ?? 1n,
  );
}
```

> `"economic"` is a real `Archetype` (`src/agent/archetypes.ts` defines `Archetype = "aggressive" | "economic" | "expansionist"`). `SeatConfig`'s greedy variant types `archetype: Archetype`, so `"economic" as const` typechecks without `as any`.

- [ ] **Step 4: Run** `bun run typecheck && bun run test -- session/types` → green. Full `bun run test` → green (pure additions). Pristine output.

- [ ] **Step 5: Commit**

```bash
git add src/session/types.ts test/session/helpers.ts test/session/types.test.ts
git commit -m "feat(session): wire-format types — SessionRecord, closed LogEntry union, SeatConfig"
```

- [ ] **Step 6: Apply the Execution Discipline block.**

### Task 1.2: `SessionRecord`/`LogEntry` codec

**Files:**
- Create: `src/session/codec.ts`
- Test: `test/session/codec.test.ts`

The codec converts between the in-memory working form (`SessionHeader` with bigint `seed`, `LogEntry[]` with bigint `rngBeforeApply`) and the JSON `SessionRecord` (decimal strings), using the existing `src/rng/codec.ts`.

- [ ] **Step 1: Write the failing property test** (`test/session/codec.test.ts`):

```ts
// ABOUTME: Round-trip tests for the SessionRecord codec — bigint seed + per-entry rngBeforeApply survive JSON.
// ABOUTME: Bit-exact for uint64 values > 2^53; all conversion goes through the RNG codec (never Number()).
import { test, expect } from "vitest";
import * as fc from "fast-check";
import { encodeRecord, decodeRecord, encodeEntry, decodeEntry } from "../../src/session/codec";
import { hex } from "../../src/geometry/cube";
import { greedyHeader } from "./helpers";
import type { LogEntry } from "../../src/session/types";

test("a LogEntry round-trips through encode/decode and JSON, bit-exactly (incl. > 2^53)", () => {
  fc.assert(fc.property(fc.bigUintN(64), fc.bigUintN(64), (s, inc) => {
    const e: LogEntry = { player: 1, kind: "attack",
      decl: { target: hex(1,-1,0), attackers: [hex(0,0,0)], defender: hex(2,-2,0) },
      rngBeforeApply: { state: s, inc } };
    const back = decodeEntry(JSON.parse(JSON.stringify(encodeEntry(e))));
    return back.kind === "attack" && back.rngBeforeApply.state === s && back.rngBeforeApply.inc === inc;
  }));
});

test("a full SessionRecord round-trips (header bigint seed + log) through JSON", () => {
  const header = greedyHeader(2, { seed: 18446744073709551557n }); // seed > 2^53
  const log: LogEntry[] = [
    { player: 0, kind: "pass", rngBeforeApply: { state: 18189450024704157456n, inc: 109n } },
    { player: 1, kind: "endRound", rngBeforeApply: { state: 1n, inc: 109n } },
  ];
  const rec = encodeRecord(header, log);
  const round = JSON.parse(JSON.stringify(rec));
  const { header: h2, log: l2 } = decodeRecord(round);
  expect(h2.seed).toBe(header.seed);
  expect(h2).toEqual(header);
  expect(l2).toEqual(log);
  expect(typeof rec.seed).toBe("string"); // encoded form is a string
});
```

Run `bun run test -- session/codec` → FAIL (module missing).

- [ ] **Step 2: Create `src/session/codec.ts`:**

```ts
// ABOUTME: SessionRecord/LogEntry codec — bigint seed + per-entry rngBeforeApply <-> JSON decimal strings.
// ABOUTME: All bigint conversion delegates to src/rng/codec (BigInt(), never Number()); spec §3.

import { encodeRng, decodeRng } from "../rng/codec";
import type { EncodedLogEntry, LogEntry, SessionHeader, SessionRecord } from "./types";

export function encodeEntry(e: LogEntry): EncodedLogEntry {
  const r = encodeRng(e.rngBeforeApply);
  switch (e.kind) {
    case "placeFirstBase": return { player: e.player, kind: e.kind, hex: e.hex, rngBeforeApply: r };
    case "build":          return { player: e.player, kind: e.kind, pieces: e.pieces, rngBeforeApply: r };
    case "attack":         return { player: e.player, kind: e.kind, decl: e.decl, rngBeforeApply: r };
    case "endRound":       return { player: e.player, kind: e.kind, rngBeforeApply: r };
    case "pass":           return { player: e.player, kind: e.kind, rngBeforeApply: r };
    case "roundSkipped":   return { player: e.player, kind: e.kind, rngBeforeApply: r };
  }
}

export function decodeEntry(e: EncodedLogEntry): LogEntry {
  const r = decodeRng(e.rngBeforeApply);
  switch (e.kind) {
    case "placeFirstBase": return { player: e.player, kind: e.kind, hex: e.hex, rngBeforeApply: r };
    case "build":          return { player: e.player, kind: e.kind, pieces: e.pieces, rngBeforeApply: r };
    case "attack":         return { player: e.player, kind: e.kind, decl: e.decl, rngBeforeApply: r };
    case "endRound":       return { player: e.player, kind: e.kind, rngBeforeApply: r };
    case "pass":           return { player: e.player, kind: e.kind, rngBeforeApply: r };
    case "roundSkipped":   return { player: e.player, kind: e.kind, rngBeforeApply: r };
  }
}

export function encodeRecord(header: SessionHeader, log: LogEntry[]): SessionRecord {
  return {
    formatVersion: header.formatVersion,
    replayVersion: header.replayVersion,
    seed: header.seed.toString(),
    config: header.config,
    boardSource: header.boardSource,
    seats: header.seats,
    log: log.map(encodeEntry),
  };
}

export function decodeRecord(rec: SessionRecord): { header: SessionHeader; log: LogEntry[] } {
  return {
    header: {
      formatVersion: rec.formatVersion,
      replayVersion: rec.replayVersion,
      seed: BigInt(rec.seed),
      config: rec.config,
      boardSource: rec.boardSource,
      seats: rec.seats,
    },
    log: rec.log.map(decodeEntry),
  };
}
```

- [ ] **Step 3: Run** `bun run test -- session/codec` → PASS. Full `bun run test` + `bun run typecheck` → green.

- [ ] **Step 4: Commit**

```bash
git add src/session/codec.ts test/session/codec.test.ts
git commit -m "feat(session): SessionRecord/LogEntry codec (bigint seed + rngBeforeApply <-> JSON strings)"
```

- [ ] **Step 5: Apply the Execution Discipline block.**

---

## Phase 2 — `stateHash` (deterministic divergence checksum)

**Execution Status:** ⬜ NOT STARTED

The per-boundary checksum the snapshot stores and replay validates against (spec §3 "Snapshot … `stateHash` is the divergence checksum"). MUST be deterministic across machines and stable across runs for a given state; two structurally-equal states MUST hash equal, and any meaningful difference (a base moved, an rng tick, a fatigue flip) MUST hash differently.

### Task 2.1: `stateHash`

**Files:**
- Create: `src/session/hash.ts`
- Test: `test/session/hash.test.ts`

- [ ] **Step 1: Write the failing test** (`test/session/hash.test.ts`):

```ts
// ABOUTME: Tests for stateHash — deterministic, structural, divergence-sensitive checksum of GameState.
// ABOUTME: Equal states hash equal; any base/fatigue/rng/factory/phase difference hashes differently.
import { test, expect } from "vitest";
import { stateHash } from "../../src/session/hash";
import { initGame } from "../../src/engine/init";
import { placeFirstBase, representativeFirstBase, advanceRound } from "../../src/engine/turn";
import { defaultConfig } from "../../src/engine/config";

function setupPlayed(seed: bigint) {
  let s = initGame({ seed, boardSource: { kind: "generate", size: 96, ironCount: 14 }, nPlayers: 4, config: defaultConfig() });
  for (let i = 0; i < 4; i++) { const p = s.phase.order[s.phase.indexInOrder]!; s = placeFirstBase(s, p, representativeFirstBase(s, p)); }
  return s;
}

test("equal states hash equal; the hash is a stable non-empty string", () => {
  const a = setupPlayed(7n), b = setupPlayed(7n);
  expect(stateHash(a)).toBe(stateHash(b));
  expect(typeof stateHash(a)).toBe("string");
  expect(stateHash(a).length).toBeGreaterThan(0);
});

test("advancing a round changes the hash (rng + phase moved)", () => {
  const a = setupPlayed(7n);
  expect(stateHash(advanceRound(a))).not.toBe(stateHash(a));
});

test("a different seed (different board + seating) hashes differently", () => {
  expect(stateHash(setupPlayed(7n))).not.toBe(stateHash(setupPlayed(8n)));
});

test("hash is insensitive to bases array ORDER but sensitive to membership", () => {
  const a = setupPlayed(7n);
  const reordered = { ...a, bases: [...a.bases].reverse() };
  expect(stateHash(reordered)).toBe(stateHash(a)); // structural, order-independent
  const moved = { ...a, bases: a.bases.map((bb, i) => i === 0 ? { ...bb, state: bb.state === "fresh" ? "fatigued" : "fresh" } : bb) };
  expect(stateHash(moved)).not.toBe(stateHash(a)); // a fatigue flip is a real difference
});
```

Run `bun run test -- session/hash` → FAIL (module missing).

- [ ] **Step 2: Create `src/session/hash.ts`** — canonicalize the state into an order-independent string, then FNV-1a it:

```ts
// ABOUTME: stateHash — a deterministic, structural, order-independent checksum of GameState (spec §3 divergence guard).
// ABOUTME: Canonicalizes bases/factories/players/phase/factorySupply/rngState (bigints via toString), then FNV-1a.

import { key } from "../geometry/cube";
import type { GameState } from "../engine/types";

/** Canonical, order-independent serialization of the divergence-relevant state. */
function canonicalize(s: GameState): string {
  const bases = s.bases
    .map((b) => `${b.owner}@${key(b.hex)}:${b.state}:${b.order}`)
    .sort()
    .join("|");
  const factories = s.factories.map((f) => key(f.hex)).sort().join("|");
  const players = [...s.players]
    .sort((a, b) => a.id - b.id)
    .map((p) => `${p.id}:${p.basesInHand}:${p.eliminated ? 1 : 0}:[${[...p.alliance].sort((x, y) => x - y).join(",")}]`)
    .join("|");
  const phase = `${s.phase.turn}/${s.phase.indexInOrder}/[${s.phase.order.join(",")}]`;
  const rng = `${s.rngState.state.toString()}:${s.rngState.inc.toString()}`;
  // board + config are header-fixed for a session; excluded — divergence is about evolving state.
  return `B:${bases};F:${factories};P:${players};PH:${phase};FS:${s.factorySupply};R:${rng}`;
}

/** FNV-1a (64-bit) over the canonical string, returned as a hex string. */
export function stateHash(s: GameState): string {
  const str = canonicalize(s);
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = (1n << 64n) - 1n;
  for (let i = 0; i < str.length; i++) {
    h = (h ^ BigInt(str.charCodeAt(i))) & mask;
    h = (h * prime) & mask;
  }
  return h.toString(16).padStart(16, "0");
}
```

> **Design note (do NOT change without cause):** `bases` is sorted by `owner@key` so array order does not affect the hash (the engine appends bases in placement/capture order, which is replay-irrelevant for divergence). `phase.order` IS included un-sorted because round order is semantically meaningful (it drives whose turn it is). `board`/`config` are excluded — they are header-fixed per session, so two states in the same session that differ only by board would be a bug elsewhere, not a divergence this checksum guards. If a future need requires board/config sensitivity, add them explicitly rather than relying on this hash.

- [ ] **Step 3: Run** `bun run test -- session/hash` → PASS. Full `bun run test` + typecheck → green.

- [ ] **Step 4: Commit**

```bash
git add src/session/hash.ts test/session/hash.test.ts
git commit -m "feat(session): deterministic structural stateHash (FNV-1a over canonicalized state)"
```

- [ ] **Step 5: Apply the Execution Discipline block.**

---

## Phase 3 — `applyEntry` round state machine

**Execution Status:** ⬜ NOT STARTED

The heart of replay: one function that, given a state and a `LogEntry`, installs the entry's `rngBeforeApply` and runs exactly the right engine steps for that kind — the per-declaration canonical composition for actions, `advanceRound` for round-closing kinds, with `status()` consulted once at the close. **This is the single source of truth both `recordGame` and `replayLog` route through** (record calls it to advance live state; replay calls it to reconstruct), so the two halves cannot drift.

> **Assumption (documented, not enforced here):** `applyEntry` uses `entry.player` as the acting player for the composition's `applyEliminations(entry.player)` and trusts that `entry.player === currentPlayer(state)`. For logs produced by `recordGame` (and, later, by the command-validated interactive session) this always holds — the producer stamps the current player. `applyEntry` does NOT defensively re-derive or assert it, because the command-eligibility validation that guards against a forged/out-of-turn `entry.player` belongs to the interactive `GameSession`/DO layer (plan 2/3), not this pure reconstruction primitive. (Codex round-2 P2: a corrupt EXTERNAL log could exploit this; closing that is plan 2/3's validation job, called out here so it isn't lost.)

### Task 3.1: `applyEntry`

**Files:**
- Create: `src/session/round.ts`
- Test: `test/session/round.test.ts`

**Semantics by kind** (install `entry.rngBeforeApply` into `state.rngState` first, always):

| kind | engine steps | closes round? |
|---|---|---|
| `placeFirstBase` | `placeFirstBase(state, player, hex)` | no (setup; the last placement transitions turn 0→1 internally) |
| `build` | `applyAction(build) → applyEliminations(player) → removeEncircledStrandedBases` → then `status()`; if not victory, `advanceRound` | yes |
| `attack` | `applyAction(attack) → applyEliminations(player) → removeEncircledStrandedBases` | no (chain continues) |
| `pass` | `applyAction(pass) → applyEliminations(player) → removeEncircledStrandedBases` → then `status()`; if not victory, `advanceRound` | yes |
| `endRound` | `status()`; if not victory, `advanceRound` (no `applyAction` — the chain's battles already applied per-attack) | yes |
| `roundSkipped` | `status()`; if not victory, `advanceRound` (eliminated seat's empty slot) | yes |

`applyEntry` returns the new state, the engine events produced, whether it closed a round (`advanced`), and the terminal status if the round-closing `status()` found a victory (so the round-closing `advanceRound` is SKIPPED — you never advance past a finished game). **Who honors `terminal`:** `recordGame` honors it by stopping (it won't generate entries past a victory). `replayLog` does NOT consult `status`/`terminal` to stop — it faithfully applies the FULL recorded log, which already ends at the terminal entry (because `recordGame` stopped there), so it reaches the same terminal state. The recorded log is the authority on where the game ended; for a well-formed `SessionRecord` the two paths agree. (`applyEntry` still SKIPS `advanceRound` when it computes a victory, so even an over-long external log won't advance past a finished game — but generating such a log is out of scope here.)

- [ ] **Step 1: Write the failing tests** (`test/session/round.test.ts`). Use `recordGame` is NOT available yet, so drive setup by hand and craft a couple of entries whose `rngBeforeApply` is the live threaded state (so they are correct by construction):

```ts
// ABOUTME: Tests for applyEntry — the per-kind log state machine (install rngBeforeApply, compose, advance).
// ABOUTME: Pins that pass/build self-close (advanceRound), attack does not, and a captured live entry replays exactly.
import { test, expect } from "vitest";
import { applyEntry } from "../../src/session/round";
import { initGame } from "../../src/engine/init";
import { placeFirstBase, representativeFirstBase, currentPlayer } from "../../src/engine/turn";
import { legalActions } from "../../src/engine/legal";
import { defaultConfig } from "../../src/engine/config";
import type { LogEntry } from "../../src/session/types";

function setupPlayed(seed: bigint, n = 4) {
  let s = initGame({ seed, boardSource: { kind: "generate", size: 96, ironCount: 14 }, nPlayers: n, config: defaultConfig() });
  for (let i = 0; i < n; i++) { const p = s.phase.order[s.phase.indexInOrder]!; s = placeFirstBase(s, p, representativeFirstBase(s, p)); }
  return s;
}

test("a pass entry self-closes the round (turn advances) and threads rng faithfully", () => {
  const s = setupPlayed(7n);
  const p = currentPlayer(s);
  const entry: LogEntry = { player: p, kind: "pass", rngBeforeApply: s.rngState };
  const out = applyEntry(s, entry);
  expect(out.advanced).toBe(true);
  expect(out.terminal).toBeNull();
  // turn/order advanced — a pass closes the round.
  expect(out.state.phase.indexInOrder !== s.phase.indexInOrder || out.state.phase.turn !== s.phase.turn).toBe(true);
});

test("placeFirstBase entries do not advanceRound (setup), and the engine handles the turn 0->1 transition", () => {
  let s = initGame({ seed: 7n, boardSource: { kind: "generate", size: 96, ironCount: 14 }, nPlayers: 2, config: defaultConfig() });
  expect(s.phase.turn).toBe(0);
  const p0 = s.phase.order[s.phase.indexInOrder]!;
  const e0: LogEntry = { player: p0, kind: "placeFirstBase", hex: representativeFirstBase(s, p0), rngBeforeApply: s.rngState };
  const o0 = applyEntry(s, e0);
  expect(o0.advanced).toBe(false);
  expect(o0.state.phase.turn).toBe(0); // still setup after the first of two
  const p1 = o0.state.phase.order[o0.state.phase.indexInOrder]!;
  const e1: LogEntry = { player: p1, kind: "placeFirstBase", hex: representativeFirstBase(o0.state, p1), rngBeforeApply: o0.state.rngState };
  const o1 = applyEntry(o0.state, e1);
  expect(o1.state.phase.turn).toBe(1); // last placement transitions to play
});

test("applyEntry installs rngBeforeApply before applying (a different installed rng yields a different result)", () => {
  // Build a fixture where the acting player has a legal pass and a legal build/attack via legalActions.
  const s = setupPlayed(11n);
  const p = currentPlayer(s);
  const acts = legalActions(s);
  // A pass is always available when stuck; assert applyEntry consumed the installed rng for the advanceRound draw.
  const entry: LogEntry = { player: p, kind: "pass", rngBeforeApply: s.rngState };
  const a = applyEntry(s, entry);
  const entry2: LogEntry = { player: p, kind: "pass", rngBeforeApply: { state: s.rngState.state ^ 0xffffffffn, inc: s.rngState.inc } };
  const b = applyEntry(s, entry2);
  // Different installed rng -> the drawn turn order (or its rng) differs.
  expect(a.state.rngState).not.toEqual(b.state.rngState);
});
```

Run `bun run test -- session/round` → FAIL (module missing).

- [ ] **Step 2: Create `src/session/round.ts`:**

```ts
// ABOUTME: applyEntry — the per-kind session-log state machine (install rngBeforeApply, compose per declaration, advance).
// ABOUTME: The single composition both recordGame and replayLog route through, so live and replay cannot drift (spec §3).

import { applyAction } from "../engine/apply";
import { applyEliminations, status } from "../engine/status";
import { removeEncircledStrandedBases } from "../engine/stranded";
import { advanceRound, placeFirstBase } from "../engine/turn";
import type { Action, GameEvent, GameState, PlayerId } from "../engine/types";
import type { LogEntry } from "./types";

export type ApplyEntryResult = {
  state: GameState;
  events: GameEvent[];
  advanced: boolean; // did this entry close a round (call advanceRound)?
  terminal: ReturnType<typeof status> | null; // set when the round-closing status() found a victory
};

/** The per-declaration canonical composition: applyAction -> applyEliminations(actor) -> removeStranded. */
function compose(state: GameState, player: PlayerId, action: Action): { state: GameState; events: GameEvent[] } {
  const applied = applyAction(state, action);
  const elim = applyEliminations(applied.state, player);
  const stranded = removeEncircledStrandedBases(elim.state);
  return { state: stranded.state, events: [...applied.events, ...elim.events, ...stranded.events] };
}

/** Install rngBeforeApply, run the kind's engine steps, and report whether the round closed + any terminal status. */
export function applyEntry(state: GameState, entry: LogEntry): ApplyEntryResult {
  const installed: GameState = { ...state, rngState: entry.rngBeforeApply };

  if (entry.kind === "placeFirstBase") {
    const next = placeFirstBase(installed, entry.player, entry.hex);
    return { state: next, events: [], advanced: false, terminal: null };
  }

  // For build/attack/pass, run the canonical composition.
  let composed = installed;
  let events: GameEvent[] = [];
  if (entry.kind === "build") {
    const r = compose(installed, entry.player, { kind: "build", pieces: entry.pieces });
    composed = r.state; events = r.events;
  } else if (entry.kind === "attack") {
    const r = compose(installed, entry.player, { kind: "attack", attacks: [entry.decl] });
    composed = r.state; events = r.events;
  } else if (entry.kind === "pass") {
    const r = compose(installed, entry.player, { kind: "pass" });
    composed = r.state; events = r.events;
  }
  // endRound / roundSkipped: no composition (battles already applied / eliminated slot).

  // attack does not close the round — the chain continues.
  if (entry.kind === "attack") {
    return { state: composed, events, advanced: false, terminal: null };
  }

  // Round-closing kinds: status() once, before advanceRound (rules: victory "at end of round").
  const st = status(composed);
  if (st.kind === "victory") {
    return { state: composed, events, advanced: true, terminal: st };
  }
  return { state: advanceRound(composed), events, advanced: true, terminal: null };
}
```

- [ ] **Step 3: Run** `bun run test -- session/round` → PASS. Full `bun run test` + typecheck → green.

- [ ] **Step 4: Commit**

```bash
git add src/session/round.ts test/session/round.test.ts
git commit -m "feat(session): applyEntry round state machine (per-kind compose + advanceRound + status)"
```

- [ ] **Step 5: Apply the Execution Discipline block.**

---

## Phase 4 — `recordGame` all-agent record driver

**Execution Status:** ⬜ NOT STARTED

Plays an all-agent game and emits the `LogEntry[]` (each carrying the correct `rngBeforeApply`) plus the live per-boundary `stateHash[]` — the producer half of the replay invariant, and §4's all-agent-viewer backend. **The `rngBeforeApply` capture is load-bearing:** for an agent action, the agent closure returns `{action, state}` where `state.rngState` is the *post-selection, pre-apply* state; that is exactly `rngBeforeApply`. For the auto-appended `endRound` that closes an attack round, `rngBeforeApply` is the state's rng *after* the attack's composition (the state `advanceRound` will draw from).

### Task 4.1: `recordGame`

**Files:**
- Create: `src/session/record.ts`
- Test: `test/session/record.test.ts`

**Algorithm:**
1. `initGame` → turn-0 setup state.
2. **Setup loop** (`while state.phase.turn === 0`): the current placer (all agents here) auto-picks via `representativeFirstBase`; capture `rngBeforeApply = state.rngState` (placement consumes no rng; the last placement's `placeFirstBase` draws the turn-1 order from this state); apply via `applyEntry`; push a `placeFirstBase` entry; record a boundary hash only when `applyEntry` reports `advanced` (it never does in setup).
3. **Born-terminal check:** if `status(state).kind === "victory"`, finalize.
4. **Play loop** (bounded by `turnCap`):
   - If the current seat is eliminated: capture `rngBeforeApply = state.rngState`; `applyEntry({kind:"roundSkipped"})`; push it; if it advanced, push `stateHash(state)`; honor `terminal`.
   - Else: run the seat's agent closure → `{action, choiceState}`; `rngBeforeApply = choiceState.rngState`. Map the action to log entries:
     - `build`: one `build` entry (`applyEntry` self-closes). Push entry; push boundary hash.
     - `pass`: one `pass` entry (self-closes). Push entry; push boundary hash.
     - `attack`: the v1 agent emits a single-declaration attack (`action.attacks[0]`). Push one `attack` entry (does not close). Then **auto-close**: push an `endRound` entry whose `rngBeforeApply` is the post-attack state's rng; `applyEntry` it (advances). Push boundary hash. (If the agent ever returns a multi-decl attack, that violates the v1 single-declaration constraint — throw a clear error; do NOT silently fold it.)
   - After each round-closing entry, consult `terminal`/`status` to stop on victory; stop on `turnCap` exceeded.
5. Return `{ header, log, boundaryHashes, finalState, hitTurnCap }`.

**Agent closure construction:** map each `SeatConfig` to an `Agent`. `greedy` → `greedyAgent(archetype)` (`src/agent/agent.ts`). `heuristic` → read `src/agent/heuristic-agent.ts` for its factory and use it. `human` seats are NOT supported in `recordGame` — throw a clear error if a human seat is present (interactive play is plan 2).

- [ ] **Step 1: Write the failing tests** (`test/session/record.test.ts`):

```ts
// ABOUTME: Tests for recordGame — plays an all-agent game, emits a faithful LogEntry[] + per-boundary stateHash[].
// ABOUTME: Pins setup logging for every seat, single-decl attack + auto endRound, determinism, and self-closing kinds.
import { test, expect } from "vitest";
import { recordGame } from "../../src/session/record";
import { greedyHeader } from "./helpers";

test("recordGame logs a placeFirstBase entry for every seat during setup", () => {
  const out = recordGame(greedyHeader(4), { turnCap: 200 });
  const setupEntries = out.log.filter((e) => e.kind === "placeFirstBase");
  expect(setupEntries).toHaveLength(4);
  expect(new Set(setupEntries.map((e) => e.player)).size).toBe(4); // one per seat
});

test("recordGame is deterministic: same header+turnCap yields an identical log and hashes", () => {
  const a = recordGame(greedyHeader(4), { turnCap: 200 });
  const b = recordGame(greedyHeader(4), { turnCap: 200 });
  expect(a.log).toEqual(b.log);
  expect(a.boundaryHashes).toEqual(b.boundaryHashes);
  expect(a.finalState).toEqual(b.finalState);
});

test("every attack entry is immediately followed by an endRound entry (single-decl auto-close)", () => {
  const out = recordGame(greedyHeader(4), { turnCap: 200 });
  for (let i = 0; i < out.log.length; i++) {
    if (out.log[i]!.kind === "attack") {
      expect(out.log[i + 1]?.kind).toBe("endRound");
    }
  }
});

test("recordGame reaches a real terminal victory for a chosen seed (not turn-capped)", () => {
  // search a few seeds for a decisive game (mirror test/driver/run.test.ts)
  let found = null as ReturnType<typeof recordGame> | null;
  for (const s of [1n, 2n, 3n, 7n, 11n]) {
    const out = recordGame(greedyHeader(4, { seed: s }), { turnCap: 300 });
    if (!out.hitTurnCap) { found = out; break; }
  }
  expect(found).not.toBeNull();
  expect(found!.hitTurnCap).toBe(false);
  // boundary hashes: one per round-closing entry.
  const closers = found!.log.filter((e) => e.kind === "build" || e.kind === "pass" || e.kind === "endRound" || e.kind === "roundSkipped").length;
  expect(found!.boundaryHashes).toHaveLength(closers);
});

test("recordGame rejects a human seat (interactive play is plan 2)", () => {
  const header = greedyHeader(2);
  (header.seats as any)[0] = { kind: "human" };
  expect(() => recordGame(header, { turnCap: 50 })).toThrow(/human seat/i);
});
```

> **CRITICAL — break the record↔replay tautology (codex round-2 finding).** `recordGame` and `replayLog` both route through `applyEntry`, so a wrong `applyEntry` (e.g. capturing PRE-agent-selection rng) could make record and replay agree while BOTH diverge from live engine semantics. The replay-equivalence tests alone would not catch it. Add TWO cross-checks against the **trusted live driver** in this same test file:

```ts
import { runGame } from "../../src/driver/run.ts"; // NOTE: test-only import of the driver — allowed in TESTS, never from src/session/**
import { stepRound } from "../../src/engine/round";
import { status } from "../../src/engine/status";
import { advanceRound, currentPlayer, placeFirstBase, representativeFirstBase } from "../../src/engine/turn";
import { initGame } from "../../src/engine/init";
import { greedyAgent } from "../../src/agent/agent";
import { defaultConfig } from "../../src/engine/config";

// (1) Trusted-code cross-check: recordGame must reach the SAME game OUTCOME as runGame
// (src/driver/run.ts) for the same seed/agents. A wrong rng capture changes combat -> a
// different game -> a different winner/turn-count, which this catches via battle-tested code.
test("recordGame's outcome matches runGame (same seed/agents) — trusted-driver cross-check", () => {
  for (const s of [1n, 2n, 3n, 7n, 11n]) {
    const rec = recordGame(greedyHeader(4, { seed: s }), { turnCap: 300 });
    const gr = runGame({ seed: s, boardSource: { kind: "generate", size: 96, ironCount: 14 }, nPlayers: 4,
      archetypes: ["economic", "economic", "economic", "economic"], config: defaultConfig(), turnCap: 300 });
    expect(rec.finalState.phase.turn).toBe(gr.turns);
    expect(rec.hitTurnCap).toBe(gr.hitTurnCap);
    const st = status(rec.finalState);
    if (gr.victoryType !== "none") {
      expect(st.kind).toBe("victory");
      expect([...(st as any).players].sort()).toEqual([...gr.winnerOrCoalition].sort());
    }
  }
});

// (2) Rigorous full-state pin: recordGame's finalState must DEEP-EQUAL a stepRound-driven
// reference that mirrors src/driver/run.ts's loop exactly (read run.ts:37-128 and match it).
// This proves applyEntry's per-declaration composition == the live stepRound composition.
function referenceFinalState(seed: bigint, n: number, turnCap: number) {
  const agents = Array.from({ length: n }, () => greedyAgent("economic"));
  let state = initGame({ seed, boardSource: { kind: "generate", size: 96, ironCount: 14 }, nPlayers: n, config: defaultConfig() });
  for (let i = 0; i < n; i++) { const p = state.phase.order[state.phase.indexInOrder]!; state = placeFirstBase(state, p, representativeFirstBase(state, p)); }
  if (status(state).kind === "victory") return state;
  for (;;) {
    const p = currentPlayer(state);
    if (!state.players[p]!.eliminated) {
      const choice = agents[p]!(state, p);
      state = stepRound(choice.state, choice.action).state; // post-selection rng is carried in choice.state
    }
    if (status(state).kind === "victory") return state;
    state = advanceRound(state);
    if (state.phase.turn > turnCap) return state;
  }
}

test("recordGame.finalState deep-equals a stepRound-driven live reference (full-state tautology break)", () => {
  for (const s of [1n, 2n, 3n, 7n, 11n]) {
    expect(recordGame(greedyHeader(4, { seed: s }), { turnCap: 300 }).finalState).toEqual(referenceFinalState(s, 4, 300));
  }
});
```

> If either cross-check fails, `applyEntry`'s composition (or the `rngBeforeApply` capture) diverges from the live driver — STOP and fix `applyEntry`/`recordGame`, do NOT adjust the reference to match. The reference deliberately uses the BATTLE-TESTED `stepRound`/`runGame`; if it and `recordGame` disagree, the new session code is the suspect. (The `referenceFinalState` loop MUST mirror `src/driver/run.ts:37-128`; read that file and match its status/advance ordering exactly — a wrong reference makes a false cross-check.)

Run `bun run test -- session/record` → FAIL (module missing).

- [ ] **Step 2: Implement `src/session/record.ts`.** Compose `applyEntry` (Phase 3), the engine `initGame`/`status`/`currentPlayer`/`representativeFirstBase`, and the agent closures. The exact structure:

```ts
// ABOUTME: recordGame — plays an all-agent game, emitting a faithful LogEntry[] + per-boundary stateHash[].
// ABOUTME: rngBeforeApply for agent actions is the agent closure's post-selection state; spec §3 replay model.

import { initGame } from "../engine/init";
import { status } from "../engine/status";
import { currentPlayer, representativeFirstBase } from "../engine/turn";
import { greedyAgent, type Agent } from "../agent/agent";
import { heuristicAgent } from "../agent/heuristic-agent";
import { applyEntry } from "./round";
import { stateHash } from "./hash";
import type { GameEvent, GameState } from "../engine/types";
import type { LogEntry, SeatConfig, SessionHeader } from "./types";

function agentForSeat(seat: SeatConfig): Agent {
  if (seat.kind === "human") throw new Error("recordGame: human seat unsupported (interactive play is plan 2)");
  if (seat.agent === "greedy") return greedyAgent(seat.archetype);
  if (seat.agent === "heuristic") return heuristicAgent();
  throw new Error(`recordGame: unsupported agent ${(seat as any).agent}`);
}

export type RecordResult = {
  header: SessionHeader;
  log: LogEntry[];
  boundaryHashes: string[];
  events: GameEvent[]; // all engine events across the game, in order (for §7 edge tests + the all-agent viewer narration)
  finalState: GameState;
  hitTurnCap: boolean;
};

export function recordGame(header: SessionHeader, opts: { turnCap: number }): RecordResult {
  const agents = header.seats.map(agentForSeat);
  let state = initGame({ seed: header.seed, boardSource: header.boardSource, nPlayers: header.seats.length, config: header.config });
  const log: LogEntry[] = [];
  const boundaryHashes: string[] = [];
  const events: GameEvent[] = [];
  const finalize = (hitTurnCap: boolean): RecordResult => ({ header, log, boundaryHashes, events, finalState: state, hitTurnCap });
  // Apply one entry: thread state, push the entry + its events, record a boundary hash on close.
  const step = (entry: LogEntry): ReturnType<typeof applyEntry> => {
    const out = applyEntry(state, entry);
    state = out.state; log.push(entry); events.push(...out.events);
    if (out.advanced) boundaryHashes.push(stateHash(state));
    return out;
  };

  // Setup: log a placeFirstBase for every seat in placement order (no boundary — setup never advances a round).
  while (state.phase.turn === 0) {
    const p = state.phase.order[state.phase.indexInOrder]!;
    step({ player: p, kind: "placeFirstBase", hex: representativeFirstBase(state, p), rngBeforeApply: state.rngState });
  }

  if (status(state).kind === "victory") return finalize(false); // born-terminal

  for (;;) {
    const p = currentPlayer(state);
    if (state.players[p]!.eliminated) {
      if (step({ player: p, kind: "roundSkipped", rngBeforeApply: state.rngState }).terminal) return finalize(false);
    } else {
      const choice = agents[p]!(state, p);
      const rng = choice.state.rngState; // post-selection, pre-apply
      const action = choice.action;
      if (action.kind === "build") {
        if (step({ player: p, kind: "build", pieces: action.pieces.map((x) => ({ type: x.type, hex: x.hex })), rngBeforeApply: rng }).terminal) return finalize(false);
      } else if (action.kind === "pass") {
        if (step({ player: p, kind: "pass", rngBeforeApply: rng }).terminal) return finalize(false);
      } else { // attack — single decl + auto endRound
        if (action.attacks.length !== 1) throw new Error("recordGame: v1 agents must emit single-declaration attacks");
        step({ player: p, kind: "attack", decl: action.attacks[0]!, rngBeforeApply: rng }); // does not close the round
        if (step({ player: p, kind: "endRound", rngBeforeApply: state.rngState }).terminal) return finalize(false);
      }
    }
    if (state.phase.turn > opts.turnCap) return finalize(true);
  }
}
```

> **Executor note:** the `currentPlayer`/`status`/turn-cap mechanics mirror `src/driver/run.ts` — read it (lines 37–128) to match the exact termination/snapshot timing. The difference is that `recordGame` logs entries via `applyEntry` (per-declaration composition) instead of `stepRound`, per the Discoveries note. The two MUST agree on terminal states for the same seed (Phase 5 proves it via the property test; if they disagree, the per-declaration composition diverged from `stepRound` for a single-decl action, which is a bug — STOP and diagnose).

- [ ] **Step 3: Run** `bun run test -- session/record` → PASS. Full `bun run test` + typecheck → green.

- [ ] **Step 4: Commit**

```bash
git add src/session/record.ts test/session/record.test.ts
git commit -m "feat(session): recordGame all-agent driver (faithful log + per-boundary stateHash)"
```

- [ ] **Step 5: Apply the Execution Discipline block.**

---

## Phase 5 — `replayLog` + §7 replay-equivalence property tests

**Execution Status:** ⬜ NOT STARTED — **highest-value phase.**

The consumer half: re-run a recorded log via `applyEntry` and prove it reconstructs the identical terminal state and per-boundary `stateHash`. This phase is the spec §7 centerpiece ("replay equivalence over random agent games").

### Task 5.1: `replayLog` + property tests

**Files:**
- Create: `src/session/replay.ts`
- Test: `test/session/replay.test.ts`

`replayLog(header, log)` re-derives the game purely from the header + log: `initGame` → fold `applyEntry` over the log → collect a boundary hash whenever an entry `advanced`. It does NOT consult `status` to terminate (it faithfully applies the recorded log; the recorded log already stops at the right place). It returns `{ state, boundaryHashes }`.

- [ ] **Step 1: Write the failing tests** (`test/session/replay.test.ts`):

```ts
// ABOUTME: Replay-equivalence property tests (spec §7): record -> replay reproduces terminal state + every boundary hash.
// ABOUTME: Also pins SessionRecord codec round-trip survives replay, and advanceRound-count equality.
import { test, expect } from "vitest";
import * as fc from "fast-check";
import { recordGame } from "../../src/session/record";
import { replayLog } from "../../src/session/replay";
import { encodeRecord, decodeRecord } from "../../src/session/codec";
import { greedyHeader, heuristicHeader } from "./helpers";

test("record -> replay reproduces the terminal state and every boundary hash (fixed seeds)", () => {
  for (const s of [1n, 2n, 3n, 7n, 11n]) {
    const rec = recordGame(greedyHeader(4, { seed: s }), { turnCap: 300 });
    const replay = replayLog(rec.header, rec.log);
    expect(replay.state).toEqual(rec.finalState);              // structural terminal equality
    expect(replay.boundaryHashes).toEqual(rec.boundaryHashes); // every round boundary matches
  }
});

test("PROPERTY: over random seeds and player counts, replay == record", () => {
  fc.assert(fc.property(fc.bigUintN(32), fc.integer({ min: 2, max: 6 }), (sLow, n) => {
    const rec = recordGame(greedyHeader(n, { seed: sLow + 1n }), { turnCap: 120 });
    const replay = replayLog(rec.header, rec.log);
    // fast-check treats a thrown assertion as a counterexample — assert inside the property.
    expect(replay.state).toEqual(rec.finalState);
    expect(replay.boundaryHashes).toEqual(rec.boundaryHashes);
  }), { numRuns: 50 });
});

test("advanceRound is driven the same number of times on replay (boundary count == record)", () => {
  const rec = recordGame(greedyHeader(4, { seed: 7n }), { turnCap: 300 });
  const replay = replayLog(rec.header, rec.log);
  expect(replay.boundaryHashes.length).toBe(rec.boundaryHashes.length);
});

test("a SessionRecord that round-trips through JSON replays identically", () => {
  const rec = recordGame(greedyHeader(4, { seed: 7n }), { turnCap: 300 });
  const json = JSON.parse(JSON.stringify(encodeRecord(rec.header, rec.log)));
  const { header, log } = decodeRecord(json);
  const replay = replayLog(header, log);
  expect(replay.state).toEqual(rec.finalState);
  expect(replay.boundaryHashes).toEqual(rec.boundaryHashes);
});

// HEURISTIC seats consume a VARIABLE number of policy draws during selection (samplePolicy),
// a riskier rngBeforeApply path than greedy — pin replay equivalence on it too (codex round-2).
test("record -> replay reproduces heuristic-seat games (variable-draw policy RNG path)", () => {
  for (const s of [1n, 4n, 9n]) {
    const rec = recordGame(heuristicHeader(4, { seed: s }), { turnCap: 150 });
    const replay = replayLog(rec.header, rec.log);
    expect(replay.state).toEqual(rec.finalState);
    expect(replay.boundaryHashes).toEqual(rec.boundaryHashes);
  }
});
```

> **A property counterexample is a REAL replay-divergence bug** — fix the cause (a wrong `rngBeforeApply` capture, a kind mishandled in `applyEntry`, a non-canonical `stateHash`), NEVER shrink the generator to dodge a counterexample. The property test uses greedy seats (the fast agent path), so 50 short games run in seconds; the **5 fixed-seed games in the first test are the non-negotiable correctness floor** (deterministic, always run), and the property test adds breadth. `numRuns` MAY be tuned for CI wall-clock (keep ≥ 30) but MUST NOT be lowered *to make a failing run pass* — a failure is a bug, not a budget problem.

Run `bun run test -- session/replay` → FAIL (module missing).

- [ ] **Step 2: Create `src/session/replay.ts`:**

```ts
// ABOUTME: replayLog — reconstructs a recorded game purely from header + log via applyEntry (spec §3/§7).
// ABOUTME: Installs each entry's rngBeforeApply; collects a boundary stateHash whenever an entry closes a round.

import { initGame } from "../engine/init";
import { applyEntry } from "./round";
import { stateHash } from "./hash";
import type { GameState } from "../engine/types";
import type { LogEntry, SessionHeader } from "./types";

export function replayLog(header: SessionHeader, log: LogEntry[]): { state: GameState; boundaryHashes: string[] } {
  let state = initGame({ seed: header.seed, boardSource: header.boardSource, nPlayers: header.seats.length, config: header.config });
  const boundaryHashes: string[] = [];
  for (const entry of log) {
    const out = applyEntry(state, entry);
    state = out.state;
    if (out.advanced) boundaryHashes.push(stateHash(state));
  }
  return { state, boundaryHashes };
}
```

- [ ] **Step 3: Run** `bun run test -- session/replay` → PASS (all, including the property test at `numRuns: 50`). Full `bun run test` + typecheck → green. If the property test finds a counterexample, STOP and diagnose the determinism bug per the discipline block.

- [ ] **Step 4: Commit**

```bash
git add src/session/replay.ts test/session/replay.test.ts
git commit -m "feat(session): replayLog + replay-equivalence property tests (record == replay, every boundary)"
```

- [ ] **Step 5: Apply the Execution Discipline block.**

### Task 5.2: Edge-case replay coverage (mid-turn elimination, regime boundaries)

**Files:**
- Test: `test/session/replay-edges.test.ts` (new)

§7 calls out specific regimes that the random property test may under-sample. Add targeted record→replay tests that deliberately reach them, asserting `replay.state.toEqual(rec.finalState)` and `boundaryHashes` equality for each:

- [ ] **Step 1: Write tests that force the regimes.** Search a handful of seeds until `rec` exhibits the regime, **assert the regime actually occurred** (so the test can't silently pass without exercising it), THEN assert `replayLog(rec.header, rec.log).state.toEqual(rec.finalState)` and the boundary-hash equality. Detection signals (use `rec.events` — added to `RecordResult` — and `rec.log`):
  - **Mid-turn elimination:** `expect(rec.events.some(e => e.kind === "eliminated")).toBe(true)` (and typically a `roundSkipped` entry appears after). Then replay-identical.
  - **Bounty/stranding timing:** `expect(rec.events.some(e => e.kind === "baseReplaced" || e.kind === "baseDestroyed")).toBe(true)` AND an `eliminated` event present (the per-declaration composition's elimination/stranding/bounty order is the thing under test). Then replay-identical.
  - **Regime boundary 3↔4 bases:** some player reaches ≥4 bases (radiating→perimeter). Detect by replaying with a per-step base-count snapshot, or simply `expect(rec.finalState.bases.filter(b => b.owner === SOME_P).length >= 4).toBe(true)` for a seed where a player perimetered. Then replay-identical.
  - **Commitment levels:** LOG-derivable (no events needed) — `const commits = rec.log.filter(e => e.kind === "attack").map(e => (e as any).decl.attackers.length); expect(new Set(commits).size).toBeGreaterThanOrEqual(2);`. Then replay-identical. If no seed in your search reaches the regime, widen the search (more seeds / players), do not delete the test. **Do NOT add or modify engine code to force a regime** — only search seeds (and, if truly necessary, hand-build a `GameState` via `mkState` and feed it through `recordGame`-style stepping). The engine is frozen for this plan; a regime that is genuinely unreachable is a finding to raise, not to engineer around.

- [ ] **Step 2: Run** `bun run test -- session/replay-edges` → green. Full `bun run test` + typecheck → green.

- [ ] **Step 3: Commit**

```bash
git add test/session/replay-edges.test.ts
git commit -m "test(session): replay equivalence at mid-turn elimination + regime boundaries (§7)"
```

- [ ] **Step 4: Apply the Execution Discipline block.**

---

## Phase 6 — Session validation (defense in depth) + barrel

**Execution Status:** ⬜ NOT STARTED

The named session-layer checks from spec §3 "Validation (defense in depth)". These back the §5 engine fixes and will be consumed by the interactive `GameSession` (plan 2) and the DO (plan 3). They operate on a `GameState` + a proposed action/entry; they NEVER membership-test against `legalActions` (representatives ≠ the legal space) — but **derived existence/eligibility checks are sanctioned and required**.

### Task 6.1: session validation predicates (defense in depth)

**Files:**
- Create: `src/session/validation.ts`
- Test: `test/session/validation.test.ts`

Implement the spec §3 Validation checks as small pure predicates returning either `null` (ok) or a structured `{ code, message }` error. Reuse engine helpers (`legalActions` for forced-pass detection ONLY, `representativeDefender` for defender eligibility, `distance`/`key` for the base/hex checks). This task covers the **state-level predicates** (checks 1, 3, 4-both-facets, 5); check 2 (single-declaration / `attacks:[]` rejection) is the interactive command parser's job in plan 2 — out of scope here.

The state-level checks:
1. **`pass`** accepted only when `config.allowPass` OR `legalActions(state)` yields only `pass` (forced-pass).
3. Attack declaration has **no duplicate attacker hexes** (Set on `key(hex)`) and `key(defender) !== key(target)`.
4. **Two facets (spec §3 line 170 — "Defender eligibility non-empty at declaration; substituted defender re-validated"):**
   - (4a) the target is attackable at all — `representativeDefender(state, target, defenderOwner) !== null` (the no-eligible-defender target is unattackable this round; used to grey targets out BEFORE a defender is proposed).
   - (4b) the **submitted/substituted defender is re-validated** — `decl.defender` must be a base that is owned by `defenderOwner`, `state === "fresh"`, within `config.attackRange` of `decl.target`, and `!== decl.target`. (Mirrors the engine's defender checks at `src/engine/apply.ts:175-185` as a session-layer pre-check — defense in depth, so a bad proposed/substituted defender returns a structured error instead of an unstructured engine throw.)
5. **Build pieces** are a duplicate-free set (`key(hex)`) of one piece `type`.

- [ ] **Step 1: Write the failing tests** (`test/session/validation.test.ts`) — drive each check with `mkState` fixtures using verified on-board coords (read `test/engine/apply-attack.test.ts` for them), asserting on the error `code`/`message` regex:

```ts
// ABOUTME: Tests for session validation — the §3 defense-in-depth checks (forced-pass, single-decl, dup/defender, build set).
// ABOUTME: Asserts on structured error codes; reuses verified on-board coordinates from apply-attack fixtures.
import { test, expect } from "vitest";
import { validatePass, validateTargetAttackable, validateAttackDecl, validateBuildPieces } from "../../src/session/validation";
import { hex } from "../../src/geometry/cube";
import { mkState } from "../helpers/state";
import { defaultConfig } from "../../src/engine/config";

test("pass rejected when allowPass is false and a non-pass action exists", () => {
  // a player with budget + a legal build => pass is not forced.
  const s = mkState({ board: 96, basesP0: [hex(0,0,0)], iron: [hex(1,0,-1), hex(0,1,-1)] }); // rc=2 -> base/factory legal
  const err = validatePass(s);
  expect(err).not.toBeNull();
  expect(err!.code).toBe("PASS_NOT_FORCED");
});

test("attack decl with duplicate attackers is rejected", () => {
  const s = mkState({ board: 96, basesP0: [hex(0,0,0)], basesP1: [hex(2,-2,0), hex(0,-1,1)] });
  const err = validateAttackDecl(s, 1, { target: hex(2,-2,0), attackers: [hex(0,0,0), hex(0,0,0)], defender: hex(0,-1,1) });
  expect(err?.code).toBe("DUP_ATTACKERS");
});

test("attack decl with defender === target is rejected", () => {
  const s = mkState({ board: 96, basesP0: [hex(0,0,0),hex(-1,1,0),hex(0,1,-1)], basesP1: [hex(2,-2,0)] });
  const err = validateAttackDecl(s, 1, { target: hex(2,-2,0), attackers: [hex(0,0,0),hex(-1,1,0),hex(0,1,-1)], defender: hex(2,-2,0) });
  expect(err?.code).toBe("DEFENDER_IS_TARGET");
});

test("build pieces of mixed type or duplicate hex are rejected; a clean single-type set passes", () => {
  const s = mkState({ board: 96, basesP0: [hex(0,0,0)], iron: [hex(1,0,-1), hex(0,1,-1)] });
  expect(validateBuildPieces([{ type: "factory", hex: hex(-1,1,0) }, { type: "base", hex: hex(0,-1,1) }])?.code).toBe("MIXED_PIECE_TYPES");
  expect(validateBuildPieces([{ type: "factory", hex: hex(-1,1,0) }, { type: "factory", hex: hex(-1,1,0) }])?.code).toBe("DUP_PIECES");
  expect(validateBuildPieces([{ type: "factory", hex: hex(-1,1,0) }])).toBeNull();
});
```

> Run the fixtures first; if any coordinate is off-board or a regime doesn't hold (e.g. `validatePass` needs a state where `legalActions` yields more than pass), adjust the fixture using verified coords — do NOT loosen the assertion. **Add two more tests:**
> - check 4a: target is the opponent's ONLY base (so `representativeDefender(state, target, defenderOwner)` is `null`) → `expect(validateTargetAttackable(state, hex(2,-2,0), 1)?.code).toBe("NO_ELIGIBLE_DEFENDER")`.
> - check 4b: a submitted defender that is FATIGUED or out-of-range → `expect(validateAttackDecl(state, 1, declWithBadDefender)?.code).toBe("DEFENDER_INELIGIBLE")`. Build a fixture where the opponent (p1) has a target base plus a real but fatigued/out-of-range defender base; set `decl.defender` to that base. (To fatigue a base in `mkState`, mutate `state.bases[idx].state = "fatigued"` as the existing engine tests do; verify the coord is on-board.)

Run `bun run test -- session/validation` → FAIL (module missing).

- [ ] **Step 2: Implement `src/session/validation.ts`.** Export a `SessionError = { code: string; message: string }` type and FOUR pure predicates, each returning `SessionError | null`. Messages MUST be human-readable (they surface as rule explanations per §4).
> - `validatePass(state): SessionError | null` — check 1. Returns `PASS_NOT_FORCED` when `!state.config.allowPass` AND `legalActions(state)` contains an action whose `kind !== "pass"`. (`legalActions` is used here ONLY for forced-pass detection — the one sanctioned `legalActions` use; never for membership-testing a submitted action.)
> - `validateTargetAttackable(state, target: Hex, defenderOwner: PlayerId): SessionError | null` — check 4a. Returns `NO_ELIGIBLE_DEFENDER` when `representativeDefender(state, target, defenderOwner) === null` (target unattackable this round; the client greys it out).
> - `validateAttackDecl(state, defenderOwner: PlayerId, decl: AttackDecl): SessionError | null` — checks 3 + 4b on a COMPLETE proposed declaration, first failing check wins: `DUP_ATTACKERS` (Set on `key(hex)` over `decl.attackers`), `DEFENDER_IS_TARGET` (`key(decl.defender) === key(decl.target)`), then `DEFENDER_INELIGIBLE` — the submitted `decl.defender` must be a base that is owned by `defenderOwner`, `state === "fresh"`, and within `state.config.attackRange` (`distance`) of `decl.target` (re-validate the substituted defender; mirrors `src/engine/apply.ts:175-185`).
> - `validateBuildPieces(pieces: Piece[]): SessionError | null` — check 5: `MIXED_PIECE_TYPES` (more than one distinct `type`), `DUP_PIECES` (duplicate `key(hex)`). Budget is the engine's job at apply time, not here.
>
> Exact codes: `PASS_NOT_FORCED`, `NO_ELIGIBLE_DEFENDER`, `DUP_ATTACKERS`, `DEFENDER_IS_TARGET`, `DEFENDER_INELIGIBLE`, `MIXED_PIECE_TYPES`, `DUP_PIECES`. (Check 2's single-declaration / `attacks:[]` rejection — code `ATTACK_NOT_SINGLE_DECL` — lives in the command parser of the interactive `GameSession`, plan 2; it is named here for traceability to spec §3 but is explicitly OUT of scope for this task. Do NOT add an `attacks[]` param to any predicate here.)

- [ ] **Step 3: Run** `bun run test -- session/validation` → PASS. Full `bun run test` + typecheck → green.

- [ ] **Step 4: Commit**

```bash
git add src/session/validation.ts test/session/validation.test.ts
git commit -m "feat(session): defense-in-depth validation predicates (forced-pass, target-attackable, attack-decl re-validation, build set)"
```

- [ ] **Step 5: Apply the Execution Discipline block.**

### Task 6.2: Create the session barrel `src/session/index.ts`

**Files:**
- Create: `src/session/index.ts`
- Test: `test/session/barrel.test.ts` (new)

**Why a SEPARATE barrel (do NOT add these to `src/index.ts`):** foundation Phase 6 made the engine barrel `src/index.ts` deliberately **agent-free** (a documented purity property — its consumers include the client's engine-only hint-highlighting and the lean Worker engine surface). `recordGame` imports `src/agent/**` (greedy/heuristic), so adding it to `src/index.ts` would drag the agent stack into every engine-barrel import. The session surface therefore gets its OWN barrel, `src/session/index.ts`. Consumers split cleanly: engine-only consumers import `src/index.ts` (agent-free); the all-agent viewer and the DO/server (which legitimately run agents via the agent-drive invariant) import `src/session/index.ts`. **Do NOT touch `src/index.ts` in this task** — leave its agent-free purity intact.

- [ ] **Step 1: Write the failing smoke test** (`test/session/barrel.test.ts`):

```ts
// ABOUTME: Smoke test for the session barrel — value exports present and callable.
import { test, expect } from "vitest";
import * as S from "../../src/session/index";
test("session barrel exposes record/replay/codec/hash/validation", () => {
  for (const name of ["recordGame","replayLog","applyEntry","stateHash","encodeRecord","decodeRecord","encodeEntry","decodeEntry","validatePass","validateTargetAttackable","validateAttackDecl","validateBuildPieces"]) {
    expect(typeof (S as any)[name]).toBe("function");
  }
});
```

Run `bun run test -- session/barrel` → FAIL.

- [ ] **Step 2: Create `src/session/index.ts`:**

```ts
// ABOUTME: Public session barrel — record/replay/codec/hash/validation surface for the DO host + all-agent viewer.
// ABOUTME: Distinct from the engine barrel src/index.ts (which stays agent-free); recordGame pulls in src/agent.
export { recordGame } from "./record";
export { replayLog } from "./replay";
export { applyEntry } from "./round";
export { stateHash } from "./hash";
export { encodeRecord, decodeRecord, encodeEntry, decodeEntry } from "./codec";
export { validatePass, validateTargetAttackable, validateAttackDecl, validateBuildPieces } from "./validation";
export type { SessionError } from "./validation";
export type { SessionRecord, EncodedLogEntry, LogEntry, SessionHeader, SeatConfig, Piece, LogEntryKind } from "./types";
export type { RecordResult } from "./record";
export type { ApplyEntryResult } from "./round";
```

- [ ] **Step 3: Run** `bun run test -- session/barrel` → PASS. `bun run typecheck && bun run build && bun run test` → all green. **Verify `src/index.ts` is unchanged** (`git diff src/index.ts` empty) — the engine barrel stays agent-free.

- [ ] **Step 4: Commit**

```bash
git add src/session/index.ts test/session/barrel.test.ts
git commit -m "feat(session): session barrel (src/session/index.ts) — record/replay/codec/hash/validation"
```

- [ ] **Step 5: Apply the Execution Discipline block.**

---

## Self-review (planner, completed at write time)

- **Spec coverage (§3 + §7 record/replay slice):** `SessionRecord` shape → 1.1; codec → 1.2; `stateHash` → 2.1; `LogEntry` union + the per-kind replay/round state machine (rngBeforeApply install, per-declaration composition, advanceRound driving, status-once-per-round) → 3.1; setup-phase `placeFirstBase` logging for all seats + agent auto-pick → 4.1; the canonical per-declaration composition (NOT `stepRound`/`applyAttack`) → 3.1/4.1; replay equivalence property tests (terminal state, advanceRound-count, per-boundary stateHash) → 5.1; mid-turn elimination + bounty/stranding timing + regime boundaries → 5.2; bigint codec >2^53 → 1.2; defense-in-depth validation 1–5 → 6.1; barrel surface → 6.2. **Deliberately deferred to plan 2/3/4** (noted in Discoveries): interactive `GameSession` reducer (human commands, `expectedLogIndex`, pending/defender substitution, seat-claim, resync, wire events), the DO host (storage/recovery/hibernation/alarm/Worker/wrangler/vitest-pool-workers/deploy-staging/replayVersion guard), and the §6 production cutover.
- **Scope split rationale:** spec §3's own "thin DO host around a pure GameSession (plain vitest, no workerd)" + the writing-plans Scope Check. Plan 1 is fully testable with zero infra and delivers §4's all-agent-viewer backend.
- **No placeholders in code steps:** every code step shows complete code with real API names baked in — `archetype: "economic"` (verified against `src/agent/archetypes.ts`), `heuristicAgent()` (verified against `src/agent/heuristic-agent.ts`), and the real engine signatures (`removeEncircledStrandedBases(state) → {state,events}`, `Agent = (state,player) => {action,state}`). The fast-check property test in 5.1 is a real assertion-inside-property at `numRuns: 50`; it fails red because the module is missing, not via a trick.
- **Type/name consistency:** `rngBeforeApply: RngState` (in-memory) vs `EncodedRng` (JSON) consistent across types/codec; `applyEntry`'s `{state, events, advanced, terminal}` consumed identically by `recordGame` and `replayLog`; `SessionHeader` (bigint seed) vs `SessionRecord` (string seed) consistent across codec.
- **Determinism guardrails:** every replay/property test compares by structural `toEqual` and forbids assertion-weakening; `rngBeforeApply` capture is pinned to the agent closure's post-selection state with an inline load-bearing note; `applyEntry` is the single composition both halves route through, so they cannot drift.

## Plan review cycle record (`plan-review-cycle`)

_To be appended by the `plan-review-cycle` run before this plan is committed._
