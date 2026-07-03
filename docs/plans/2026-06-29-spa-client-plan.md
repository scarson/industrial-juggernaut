# Industrial Juggernaut — Web Client (SPA) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the React/Vite web client that makes Industrial Juggernaut playable in a browser — the SVG hex board, the designer-instrument new-game screen, the all-agent watch viewer, the rules-reference, the action composers + HUD, and the WebSocket client that talks the wire protocol.

**Architecture:** A `web/` Vite + React SPA served by the Worker as static assets from `./dist/client`. The entire interactive UI talks to one seam — the **`GameDriver`** interface (submit a command; subscribe to an authoritative event stream) — shaped against the **wire protocol's** semantics (async, replaceable state, rejectable commands, server-pushed prompts). Three driver implementations of increasing dependency back it: a **fake driver** (component tests, now), a **LocalReducerDriver** (wraps the sibling DO-host plan's pure Part A reducer in-browser → hotseat + offline vs-agents; no DO), and a **SocketDriver** (wire/DO transport → online play). The board, designer instrument, all-agent viewer, and rules-reference are pure presentation/logic over the **already-shipped** engine + session core, so they front-load against today's code; interactive play gates on the reducer (Part A), live play on the DO host (Part B).

**Tech Stack:** TypeScript (strict, the repo's existing tsconfig extended), React 18, Vite 6, Zustand (state), Radix UI primitives (headless a11y chrome only — dialog/slider/tooltip/popover/tabs/drawer), custom SVG (board, tokens, glyphs — no raster art in v1), Vitest 4 + jsdom + `@testing-library/react` (component/logic tests; the engine + wire are already covered by the node suite). bun-only dev machine (`bun run test`, never `bun test`).

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

**Overall:** In progress. 0/5 phases shipped. The DO-host track (Deliverable 1) is COMPLETE — Part A reducer + Part B host + staging Worker are all on `dev` — so the P3.10 (Part A) and P4 (Part B) gates are already OPEN; phases still execute in order.

| Phase | Status | Ship SHA(s) | Notes |
|---|---|---|---|
| P0 — Foundation + visual system | 🚧 In progress | — | claimed 2026-07-03T05:34:32Z, branch `feat/web-p0-foundation` |
| P1 — SVG hex board renderer | ⬜ Not started | — | shipped-code-only |
| P2 — Designer instrument + all-agent viewer + rules-reference | ⬜ Not started | — | shipped-code-only |
| P3 — Interactive play UI + LocalReducerDriver | ⬜ Not started | — | components now (fake driver); real driver gated on DO-host **Part A** |
| P4 — SocketDriver / live play | ⬜ Not started | — | gated on DO-host **Part B** + `src/wire` |

### Deviations
- _(none yet)_

### Discoveries
- _(none yet)_

---

## Context & authoritative sources

- **Authoritative design (what the client contains):** `docs/superpowers/specs/2026-06-12-web-client-design.md` **§4** (client) is the spec for screens/components; **§1/§2** for scope/topology (Worker serves the SPA via static assets from `./dist/client`; `/api/*` → Worker; WS at `/api/games/:id/ws`); **§5** lists engine scope (all shipped); the **Digital Edition Rulings #1–#17** constrain what the board renders and the rules-reference teaches. **Alliances are Phase 3 — not in this plan.**
- **Authoritative design (how it looks/feels):** `docs/superpowers/specs/2026-06-13-game-client-ui-brief.md` — the Sam-confirmed committed blend (board = warm parchment "Atlas-table"; chrome/rail = dark-iron "War-room"), layout (board hero, left-weighted; slim top bar; one collapsible right rail; composers contextual next to the board), the candidate palette + CVD-safe player shapes, every Phase-1 key state, the interaction model. `PRODUCT.md` (register, users, brand personality, the four anti-references, accessibility constraints) and `DESIGN.md` (visual-system **seed** — `[to be resolved]` placeholders; real tokens land via `/impeccable document` after the first client code) are mandated reading before any UI work.
- **The wire contract this client codes against:** `docs/plans/2026-06-29-do-host-wire-protocol-plan.md` Part A — **A1** defines `src/wire/protocol.ts` (`ClientCommand`/`ServerMessage` unions, `EncodedState`, `EncodedPending`, `WIRE_ERROR_CODES`, `PROTOCOL_VERSION`, `RoomOptions`) and `src/wire/codec.ts` (`encodeState`/`decodeState`/`encodePending`/`decodePending`); **A4.1** computes `EncodedPending.eligibleDefenders`; **A6** is the resync payload + version handshake. **`src/wire` does not exist as code yet** — it lands when the DO-host plan's Part A executes. Only the SocketDriver (P4) imports it.
- **What this client consumes (do NOT modify — `src/engine/**`, `src/agent/**`, `src/driver/**`, `src/session/**`, `src/host/**`, `src/wire/**`):**
  - The **agent-free engine barrel `src/index.ts`** (shipped, PR #20): `initGame`, `setupGame`, `placeFirstBase`, `legalFirstBaseHexes`, `legalActions`, `representativeDefender`, `representativeFirstBase`, `applyAction`, `advanceRound`, `currentPlayer`, `status`, `applyEliminations`, `removeEncircledStrandedBases`, `control`, `buildBudget`, `generateBoard`, `loadBoard`, the `rng` primitives + `encodeRng`/`decodeRng`, `defaultConfig`, and the engine types (`GameState`, `Hex`, `Base`, `Factory`, `Board`, `BoardSource`, `BoardDefinition`, `Player`, `Phase`, `Action`, `AttackDecl`, `GameEvent`, `EliminationCause`, `RngState`, `RuleConfig`).
  - The **session core `src/session/*`** (shipped): the **agent-free** pieces `applyEntry` (`round.ts`), `replayLog` (`replay.ts`), `stateHash` (`hash.ts`), the codecs (`codec.ts`), the validation predicates (`validation.ts`), and the types (`types.ts`: `SessionRecord`, `LogEntry`, `EncodedLogEntry`, `SessionHeader`, `SeatConfig`, `Piece`); and the **agent-ful** `recordGame` (`record.ts`, pulls `src/agent`). **`src/session/index.ts` re-exports `recordGame`, so importing the barrel pulls agents** — see Bundle architecture for the deep-import rule.
- **Verified facts (checked against the code 2026-06-29; these moved the design):**
  - **Combat odds need no engine export.** `combatTable: {3: 0.75, 4: 5/6, 5: 8/9, 6: 1}` lives in `RuleConfig` (`src/engine/config.ts:15`) = `GameState.config`. The attack composer reads `state.config.combatTable[commitment]` (the exact DER #8 bag ratios). No barrel addition.
  - **`recordGame(header, {turnCap})` returns** `{header, log: LogEntry[], boundaryHashes, events, finalState, hitTurnCap}` (`src/session/record.ts:30`). "Generate + step" = generate the `log`, then replay entry-by-entry via `applyEntry` from `initGame`. It value-imports `src/agent` → must be code-split / in a Web Worker.
  - **`control(state, player): {hexes: Set<string>, iron: Hex[], factories: Hex[]}`** (`src/engine/control.ts`), radiating disk vs convex-hull interior, **derived every call, never cached on the model (GEO-5)**. Territory + HUD render from this.
  - **`RuleConfig` knob surface** (the designer instrument): `radius, placeRange, attackRange, baseLimit, autoWinAt6, killBounty, factorySupply, ironCount, boardSize, victoryThreshold, brokenPerimeterDeathAtFactories, allowPass, combatTable`.
  - **`Hex = {x, y, z}`** cube coords, invariant `x+y+z=0`. `Base = {owner, hex, state: "fresh"|"fatigued", order}`. `Factory = {hex}`. `Phase = {turn, order: PlayerId[], indexInOrder}` (`turn===0` = setup placement). `factorySupply` = remaining of 36.
- **Branch flow (the repo docs `CLAUDE.md`/`AGENTS.md`/`docs/git-strategy.md` are STALE — they describe a `main`-only flow; ignore until the production-cutover plan rewrites them):** branch off `origin/dev`, PR `--base dev`, merge on green `check` CI. Default branch is `dev` (flipped); `dev` is protected (required `check`, strict). You cannot `git checkout dev` (checked out in the main worktree) — `git worktree add .claude/worktrees/<slug> -b <type>/<slug> origin/dev`. Push with an explicit refspec (`git push origin HEAD:refs/heads/<branch>`), `--force-with-lease` only. Merge `gh pr merge <N> --merge` (NOT `--delete-branch` — it errors locally; delete the remote branch manually after). Never `--squash`/`--rebase`. **bun-only:** `bun run test` (vitest), never `bun test`; `wrangler` via `bunx`; never deploy locally.

## Plan altitude (read before executing a task)

This is a frontend plan; its tasks are specified at the altitude that is honest and useful, which differs by code kind:

- **Pure logic, contracts, scripts, and the tests of logic** (the `GameDriver` contract, the `DriverCommand`↔`ClientCommand` mapping, cube→pixel projection, territory/highlight selectors, the optimistic-preview function, the event-copy map, the bundle-guard, the CVD/AA token gate, the Zustand store reducers) get **exact code or exact signatures + concrete test cases**. These are deterministic; specify them fully.
- **Presentational SVG/React components** (the board, composers, HUD panels, the designer instrument, the viewer, the rules screen) get **exact file paths, exact prop/interface contracts, exact structural/behavioral test assertions, and pointers to the `/impeccable` references** — NOT fabricated pixel-literal JSX. Visual correctness is verified in the browser (Claude Preview / `bun run` dev server), not in jsdom. Writing literal JSX here would be invented precision the executor would (correctly) ignore; the prop contract + behavior spec + reference is the real interface.

When a task says "structure-tested," it means: assert the rendered DOM/SVG structure, ARIA, data attributes, and event wiring in jsdom — not visual geometry (jsdom does not lay out SVG).

## Architectural decisions locked with Sam (2026-06-29)

Resolved in brainstorming + two adversarial self-review rounds. Do NOT relitigate during execution.

1. **Front-load the no-DO parts; gate the rest on the sibling track.** P0–P2 (foundation/visual system, board renderer, designer instrument + all-agent viewer + rules-reference) build against **today's shipped** engine + session — no DO, no reducer, no `src/wire`. Interactive play (P3) gates on the DO-host plan's **Part A** (the pure reducer). Live play (P4) gates on **Part B** (DO host) + `src/wire`. _(Brainstorm Q1.)_
2. **All-agent viewer = generate + step, agents code-split + off main thread.** The viewer runs fresh all-agent games via `recordGame` in a **Web Worker** (agents never touch the main thread or main bundle), then steps the recorded `log` on the pure engine (play/pause/step). Agent-free `replayLog` of an **imported `SessionRecord`** runs in the same viewer. _(Brainstorm Q2.)_
3. **Custom SVG board/tokens + headless a11y primitives for chrome only.** Custom SVG throughout the board/tokens/glyphs + a thin hand-rolled token/design system; **Radix UI** (headless, unstyled) for interactive chrome — dialog, slider, tooltip, popover, tabs, drawer — to get keyboard/focus/ARIA right without imposing visual style or risking the "generic SaaS" anti-reference. _(Brainstorm Q3.)_
4. **The `GameDriver` contract is shaped against the wire semantics, with client-owned types.** The interface assumes async submit, an authoritative event stream that can **replace** state wholesale (resync), **reject** commands, and **push** prompts/roster from the server. The client defines its own `DriverCommand`/`DriverEvent`/`DriverPending` domain types (so P0–P3 never import `src/wire`); the **SocketDriver is the only module that imports `src/wire`**, mapping `DriverCommand → ClientCommand` and `ServerMessage → DriverEvent` behind one typed seam. Local drivers are degenerate (synchronous, never reject/resync). _(Self-review F1+F2.)_
5. **Interactive play routes through the reducer — no separate hotseat driver on raw `applyEntry`.** A hotseat driver built directly on `applyEntry` would have to reimplement the **round state machine** (one-action-per-round, attack-chain auto-close, `status()`-once-per-round, per-decl composition) — the exact kernel the DO-host plan builds canonically in Part A, which it explicitly designed to "back a future client-local sandbox." So the interactive `GameDriver` has two real impls — **LocalReducerDriver** (Part A reducer in-browser; hotseat + offline vs-agents) and **SocketDriver** (Part B). P3's *components* are built/TDD'd now against a **fake driver**; only the real `LocalReducerDriver` waits on Part A. _(Self-review G10. **Note:** this moved "hotseat-local" out of the shipped-code front-load — it now gates on Part A, which is pure, network-free, and the first half of the sibling track.)_
6. **Optimistic preview is deterministic-only.** Preview build/placement/budget consequences via `applyAction` (advisory, never merged into authoritative state). **Never pre-resolve combat** locally (RNG-driven; the authoritative draw is the reducer's/server's) — the attack composer shows **odds** before the draw, then awaits the authoritative `applied` event + `GameEvent`s to play the combat choreography. _(Self-review G1.)_
7. **State via Zustand** — an authoritative slice (decoded `GameState`, `logLength`, seat roster, pending, connection status), an ephemeral optimistic-preview slice, and a composer/UI slice. (Zero-dep fallback: React context + `useReducer`; not chosen — the authoritative/preview split + cross-component reads favor a small external store.) **Protocol/replay versions are NOT store state** — they are the client's build-time constants (`PROTOCOL_VERSION`, `REPLAY_VERSION`); the SocketDriver compares the server's `resync` versions against them internally and emits `connection:"reload-required"` on mismatch (R4). The `DriverEvent` stream carries no versions.
8. **SPA lives in top-level `web/`** with its own `web/tsconfig.json` (extends the root, adds `lib: [DOM]` + `jsx: react-jsx`, does NOT relax it) and its own Vitest project (jsdom env). Two build outputs: engine `tsc → dist/` (unchanged), SPA `vite → dist/client` (matches `wrangler.jsonc` `assets.directory`). The SPA test project **preserves** the engine's `test/**/*.test.ts` node glob the sweep track depends on, and targets **Vitest 4** (the DO-host track's 2→4 bump).
9. **Expected `## Barrel additions`: TWO** (both pure, agent-free; neither pulls `src/agent`/`src/driver`):
   - **`strandedBases(state, player): Base[]`** (`src/engine/stranded.ts:63`, currently unexported — only `removeEncircledStrandedBases` is) — the spec requires stranded bases **visually marked** (§4) and there is **NO `GameEvent` for a surviving-but-stranded base** (only `baseDestroyed` on encirclement+removal — codex P1), so the client derives stranding via this predicate (P1.2).
   - **`isBootstrapOnly(state, player): boolean`** (`src/engine/build.ts:86`, currently unexported — only `buildBudget` is) — the BuildComposer (P3.4) must show "first build must be a factory" in the founding-base bootstrap state; deriving the gate client-side is a **GEO-7 hazard** (the `baseCount===1` vs `<4` distinction is subtle and regression-prone), so export the engine predicate rather than reimplement it (R4).
   Combat odds are in `config`; `eligibleDefenders` is reducer-provided in the prompt; territory renders from `control().hexes`. _Contingency:_ a crisp convex-hull **outline** stroke would also add `convexHull`/`hexInHull` — avoided by rendering controlled-hex cells.

### Asserted Section-7 defaults (override on review, but these are the plan's working decisions)

- **Breakpoints:** board always wins space; the right rail collapses to a toggle below ~1100px; below ~768px is "check-in not broken" (read board + compact HUD; composing is gated behind an "open on a larger screen to play" notice — no full mobile compose flow in v1).
- **Defender-timeout UI:** the Phase-1 prompt reads the wire's `EncodedPending.deadlineEpochMs` (null locally → no countdown); when non-null (Phase-2 rooms, toggle on) it renders a countdown + an "I'm still thinking" (`extendDecision`) button. No separate placeholder — the optional field IS the seam.
- **6-player CVD shapes:** circle / square / triangle / diamond / pentagon / six-point, gated by a **build-time CVD-sim + AA contrast check** (P0); shapes/colors are not "final" until it passes.
- **Alliances:** no alliance UI or seams (closed `formatVersion 1` `LogEntry` union). The only existing terminal state rendered is **coalition victory** (`gameOver.winners: PlayerId[]` may be plural) — no negotiation surface.
- **`/impeccable document` re-run:** a required step after the first SPA code lands (P0 close-out), to replace the `DESIGN.md` seed with extracted tokens + the component sidecar.

## Spec-confirmed scope boundaries (assert; do not expand)

- **In scope (Phase 1 per spec):** home/new-game designer instrument, game screen, minimal all-agent viewer (play/pause/step), rules-reference (DER-merged). **Out of scope here:** join-room UX (Phase 2), polished replay viewer (Phase 3), save/resume surfacing (Phase 3), alliances (Phase 3), the abuse/identity floor (Phase 2), the production cutover.
- **Alliances are Phase 3.** No alliance UI, no alliance wire shapes. The `LogEntry` union is closed for `formatVersion 1`.
- **The DO host + wire protocol are a separate, already-merged-as-a-plan track** (`2026-06-29-do-host-wire-protocol-plan.md`, PR #24 to `dev`), **not yet executed.** This client neither writes nor modifies `src/wire`/`src/session` interactive reducer/`src/host` — it consumes them.
- **Production cutover, promote pipeline, branch-protection on `main`, the `git-strategy.md`/`CLAUDE.md`/`AGENTS.md` rewrites** are a separate Sam-gated plan. Do NOT touch those three docs.

## Deferred / Sam-gated (flags, not work in this plan)

- **Live play (P4)** is written here but **cannot execute until DO-host Part B ships a staging-validated Worker + `src/wire`.** P4's banner stays ⏸ DEFERRED with a link to the DO-host plan's Part B Execution Status until then.
- **Interactive play real driver (P3 LocalReducerDriver)** cannot execute until DO-host **Part A** ships (`src/session` interactive reducer + `agent-binding`). P3's *component* tasks (fake driver) are not gated; the `LocalReducerDriver` task is.
- **`/impeccable document` token extraction** — runs after P0's first code; replaces the `DESIGN.md` seed. A required plan step, but the token *values* it extracts are design-iteration output, not pre-specified here.
- **Production cutover** — not this plan.

## Merge classification & pre-authorization (per PR)

Every PR body MUST carry a `## Merge classification` heading with exactly one of `Routine — auto-merge on green CI`, `Review — <trigger>`, or `Escalate — <concern>`.

- **This plan-document PR:** `Routine` — a plan doc that lands no source code. It cites the spec + UI brief and asserts zero engine/wire shape changes. (This **plan-doc PR itself adds no barrel exports**; the later implementation PRs add **two** — `strandedBases` (P1.2) and `isBootstrapOnly` (P3.4), per decision #9. `## Shared-config changes`: shapes only here, applied by later PRs.)
- **P0–P2 implementation PRs** (pure frontend over shipped read-only engine APIs): `Routine` for component/logic PRs; **`Review — shared build/CI config`** for any PR touching `package.json`/`vitest.config.ts`/`tsconfig*`/`.github/workflows/ci.yml`/`wrangler.jsonc`/`bun.lock` (Sam eyes the build/CI wiring + the first Worker-assets coordination).
- **P3 PRs:** `Routine` for components + the fake driver + store + composers; the **`LocalReducerDriver`** is `Routine` (consumes the reducer's public surface) UNLESS it needs a barrel/reducer-surface change (then `Review`).
- **P4 PRs:** the **SocketDriver** handles **seat tokens / socket auth / reconnect / resync / version handshake** — this is **session management → always `Review` (Sam merges)**, never pre-authorized. The `claimSeat`/token-handling parts especially.
- For Routine PRs you investigate and fix CI failures yourself (≤3 attempts per failure before escalating); you merge your own Routine PR on green.

## Coordination headings (two parallel tracks share config)

A separate **DO-host track** (`src/wire`/`src/session` reducer/`src/host` + the workers test pool + the Vitest 2→4 bump) and a **sweep track** (`src/sweep`/`test/sweep`/`docs/sweeps`, adds no runtime deps) may touch shared config concurrently. Reconcile at `dev`-integration.

- **This plan's actual shared-config surface is small:** `package.json` (deps + scripts, **append-only**), `.github/workflows/ci.yml` (append SPA steps to the existing `check` job), and `bun.lock` (regenerated). It **does NOT touch** the root `vitest.config.ts`, root `tsconfig*.json`, or `wrangler.jsonc` — the SPA gets its **own** `web/vitest.config.ts` + `web/tsconfig.json`, and `wrangler.jsonc` is DO-host-owned (coordination-only, below).
- **`## Shared-config changes`** — any PR editing `package.json`, `.github/workflows/ci.yml`, or `bun.lock` MUST carry this heading listing the exact edits. **The node test glob `test/**/*.test.ts` (sweep-track dependency) is untouched** — the SPA tests run from a *separate* `web/vitest.config.ts`, never by retargeting the node glob. The **Vitest 2→4 bump** is DO-host B1's (it owns the node-suite fallout); this plan does not bump vitest (see P0.1).
- **`## Barrel additions`** — if any task needs an engine symbol not exported from `src/index.ts`, add the export on this branch and flag it here. **Expected: TWO — `strandedBases` (P1.2, stranded marks) and `isBootstrapOnly` (P3.4, bootstrap explanation) — both pure, agent-free; see decision #9.** Any addition MUST NOT pull `src/agent`/`src/driver` into the value graph.
- **`wrangler.jsonc` (coordination-only — this plan does NOT edit it)** — the DO-host plan's B1 **owns** and creates it, and already sets `assets.directory: "./dist/client"`. This plan's only obligation is that the SPA build outputs to `dist/client`. The DO-host deploy workflow generates a placeholder `dist/client` until the SPA build replaces it.

---

## Execution Discipline (apply to EVERY task)

Each task below ends with **"Apply the Execution Discipline block."** That means all of the following. Defined once (DRY), referenced per task; mandatory. Rationale: `/writing-plans-enhanced` Steps 3 & 5.

**BEFORE starting a code task** (anything editing `web/src/**` logic/components):
1. Invoke `superpowers:test-driven-development`.
2. Read `docs/pitfalls/testing-pitfalls.md` and `docs/pitfalls/implementation-pitfalls.md`.
3. Follow TDD: write a failing test → run it, confirm it fails for the stated reason → write the minimal code → run it, confirm green → refactor while green.

**TDD scope (by code-kind, per CLAUDE.md):** Production logic/components under `web/src/**` are red-green-refactor. **NOT** TDD: `web/vite.config.ts`, `web/tsconfig.json`, `package.json`, root `vitest.config.ts`, `.github/workflows/**`, `wrangler.jsonc`, `web/index.html`, CSS token files, and `docs/**`. Those gate on the explicit verification each task names (typecheck/build/lint green; the CVD/AA gate; the bundle-guard; a browser smoke). The **visual system** (palette/typography/motion) is verified by the CVD/AA gate script + browser review, not by component unit tests. Step 2 (read pitfalls) applies to every task.

**BEFORE marking a task complete:**
1. Review the new tests against `docs/pitfalls/testing-pitfalls.md` — every error branch triggered? Error *codes/messages* asserted (not just "it threw")? Regime boundaries (resource counts 1/2/3/4, base counts 3↔4, commitment 3/4/5/6, 2P↔3+P turn order) where relevant? **Structural assertions over substring** (compare hex sets as normalized sorted arrays, never stringified blobs)? **Seeds fixed** on any randomized fixture?
2. Run `bun run typecheck` (root) **and** the SPA typecheck (`bunx tsc -p web/tsconfig.json --noEmit` once P0 wires it) **and** the relevant `bun run test` (SPA project) — output MUST be pristine (no stray stderr, no debug prints, no unhandled rejections, no React `act(...)` warnings).
3. Commit with an honest, scoped message. Every new source file starts with a 2-line `// ABOUTME:` comment. Never `git add -A` without a preceding `git status` + explicit paths. Never skip pre-commit hooks.

**Assertion rigor under pressure (MANDATORY for every async / timing / driver / socket / worker task — P3 drivers, P4 socket, the viewer Web Worker):**
> If any test assertion races, flakes, or fails nondeterministically, the fix is **deterministic synchronization** (await a real signal — a resolved driver event, a `MessageChannel` round-trip, `@testing-library` `findBy*`/`waitFor` on an observable DOM state, a fake-timer tick) — **NOT** assertion removal or weakening. If synchronization cannot make the assertion pass reliably, **STOP and raise to Sam.** Prefer **mechanism** assertions over **symptom** assertions: assert "the store's authoritative state advanced to logIndex N after the `applied` event" (mechanism), not "no error was thrown" (symptom). A commit touching test assertions MUST state in its subject what happened to them (`add`/`strengthen`/`preserve`/`weaken` + rationale) — never disguise a weakening as a "flake fix."

**After completing each PHASE:**
> Review the phase from **at least 3 perspectives** (e.g. spec/brief-faithfulness, bundle-discipline + a11y correctness, subagent-readiness of the remaining phases). If round 3 still finds issues, keep going until a clean pass. Update this plan's Execution Status banner + table, and record any Deviations/Discoveries per the Living Document Contract.

**Pitfall awareness (read at execution time):** `docs/pitfalls/implementation-pitfalls.md` **GEO-1** (floating-point in hull/point-in-polygon — epsilon `1e-9`, on-edge = inside; relevant to any client geometry predicate), **GEO-2** (cube rounding — only if a pixel→hex inverse is added; the plan avoids it via SVG element hit-testing), **GEO-4** (hex collections keyed by canonical `"x,y,z"` strings, never object identity — relevant everywhere the client keys a Set/Map by hex), **GEO-5** (`control`/perimeter derived every call, never stored — the client memoizes on the **immutable `GameState` reference**, which is caching a pure function keyed by immutable input, NOT storing derived state on the model), **GEO-8** (radiating `control()` excludes iron/factories inside a non-ally opponent's perimeter — DER #17; the client renders `control()`/`controlOf` output, which already enforces this, so HUD/resource/tooltip rendering MUST trust those values and never re-sum board iron/factories itself or assume pre-GEO-8 double-counting). The client must not regress these.

---

## The `GameDriver` contract (architectural keystone — P3/P4 build against it; P0 defines it)

Defined in `web/src/game/driver.ts`. **Client-owned domain types** (NOT `src/wire`). The interface is shaped against the wire's semantics so the SocketDriver (P4) is a transport swap, not a UI rework.

```ts
// web/src/game/driver.ts
import type { Hex, PlayerId, AttackDecl, GameEvent, GameState } from "<engine-client barrel>";
import type { LogEntry, Piece, SeatConfig } from "<engine-client barrel>";

/** What the player asks the authoritative game to do. Transport fields
 *  (expectedLogIndex, seat tokens, hello/claimSeat/resync) are NOT here —
 *  the SocketDriver adds them when mapping to the wire ClientCommand. */
export type DriverCommand =
  | { type: "placeFirstBase"; hex: Hex }
  | { type: "build"; pieces: Piece[] }
  | { type: "attack"; decl: AttackDecl }
  | { type: "endRound" }
  | { type: "pass" }
  | { type: "resolveDecision"; decisionId: string; defender: Hex }
  | { type: "extendDecision"; decisionId: string };

/** The wire form of a pending defender decision, domain-shaped. */
export type DriverPending = {
  decisionId: string;
  round: number;
  declaringPlayer: PlayerId;
  promptedSeat: number;
  target: Hex;
  eligibleDefenders: Hex[];     // reducer/server-computed — the client renders, never derives
  deadlineEpochMs: number | null; // null when the room's defender timeout is OFF
};

export type SeatRosterEntry = { seat: number; claimed: boolean; kind: SeatConfig["kind"] };

export type DriverErrorCode =
  // envelope/transport (socket only)
  | "STALE_INDEX" | "NOT_YOUR_TURN" | "DECISION_PENDING" | "ALREADY_RESOLVED"
  | "SEAT_TAKEN" | "GAME_OVER" | "FROZEN"
  // setup placement
  | "NOT_IN_SETUP" | "HEX_OFF_BOARD" | "HEX_NOT_OUTER" | "HEX_OCCUPIED" | "INVALID_ATTACKERS"
  // session validation (→ rule explanations)
  | "PASS_NOT_FORCED" | "ATTACK_NOT_SINGLE_DECL" | "DUP_ATTACKERS"
  | "DEFENDER_IS_TARGET" | "DEFENDER_INELIGIBLE" | "NO_ELIGIBLE_DEFENDER"
  | "MIXED_PIECE_TYPES" | "DUP_PIECES";

/** The authoritative event stream. The driver emits `sync` first, then
 *  `applied`/`turnRollover`/`prompt`/`gameOver`/`rejected`/`connection`. */
export type DriverEvent =
  | { type: "sync"; snapshot: GameState; logLength: number; pending: DriverPending | null; seats: SeatRosterEntry[] }
  | { type: "applied"; entry: LogEntry; events: GameEvent[]; logIndex: number }
  | { type: "turnRollover"; order: PlayerId[]; ironWeights: number[] | null }
  | { type: "prompt"; pending: DriverPending }
  | { type: "gameOver"; winners: PlayerId[]; cause: string }   // winners:[] = no-winner termination
  | { type: "rejected"; code: DriverErrorCode; message: string; currentLogIndex: number | null }
  | { type: "connection"; status: ConnectionStatus };

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "closed" | "reload-required";

export interface GameDriver {
  /** Subscribe to the authoritative stream. The driver pushes a `sync` event
   *  to a new subscriber (or on requestSync). Returns an unsubscribe fn. */
  subscribe(handler: (e: DriverEvent) => void): () => void;
  /** Submit a command. Resolves when the driver has ACCEPTED it for processing
   *  (queued/sent) — NOT when applied. The authoritative result arrives as an
   *  `applied` or `rejected` event. The UI MUST NOT treat resolution as apply. */
  submit(cmd: DriverCommand): Promise<void>;
  /** Force a fresh `sync` (on mount, manual resync, post-reconnect). */
  requestSync(): void;
  /** Seats this client may act for. Local drivers: all human seats (hotseat
   *  shares the screen). SocketDriver: the claimed seat(s). The UI gates
   *  composers on `currentPlayer(state) ∈ controllableSeats()`. */
  controllableSeats(): number[];
  /** Tear down (close sockets / dispose reducer + worker). */
  dispose(): void;
}
```

**Why this shape (do NOT collapse it):** every hard property of the network case is in the interface from day one — `submit` is async and its resolution is NOT the apply (so the UI is forced to wait for `applied`, making optimistic-preview-never-authoritative structural); `sync` REPLACES state wholesale (resync); `rejected` exists (so the UI handles `STALE_INDEX`/`NOT_YOUR_TURN` from the start); `prompt`/roster are pushed (so defender prompts aren't pull-modeled). The fake driver and LocalReducerDriver implement these degenerately (synchronous, never `rejected`/re-`sync` except on explicit `requestSync`). The SocketDriver is then a faithful transport: map `DriverCommand → ClientCommand` (stamping `expectedLogIndex` from the tracked `logLength`), map `ServerMessage → DriverEvent` (`resync → sync`, `error → rejected`, `reload → connection:"reload-required"`).

## Bundle architecture + the guard (load-bearing)

**The core/entry chunk MUST NOT contain `src/agent`.** Three rules enforce it:

1. **Engine imports go through one client-side barrel** `web/src/engine-client/barrel.ts`, which re-exports the agent-free engine API from `src/index.ts` **and** the agent-free session pieces from their **deep modules** — `applyEntry` from `src/session/round`, `replayLog` from `src/session/replay`, `stateHash` from `src/session/hash`, the codecs from `src/session/codec`, the validation predicates from `src/session/validation`, and types from `src/session/types`. It **never** imports `src/session/index` (which re-exports `recordGame` → `src/agent`). Every non-driver module imports engine/session symbols from this barrel only.
2. **Agents are reached only through dynamic boundaries.** `recordGame` (the viewer's generation) runs in a **Web Worker** (`web/src/viewer/generate.worker.ts`) — a separate Vite bundle by construction, off the main thread. The **LocalReducerDriver** (which transitively pulls `src/agent` via the reducer's `agent-binding`) is loaded via **dynamic `import()`** → its own lazy chunk. `src/wire` is value-imported **only** by the SocketDriver (also dynamically imported); everywhere else `src/wire` is `import type` (erased at build).
3. **CI bundle-guard via a build-time Rollup plugin** (NOT a manifest read). Vite's `manifest.json` lists entry→file + imports but **NOT each chunk's full module membership**, so a manifest-only guard can pass while agents are still bundled (codex P1). Instead, a small Vite/Rollup plugin's `generateBundle(_, bundle)` hook walks every output chunk's authoritative **`chunk.modules`** map, classifies chunks as **eager** (the entry chunk + its static-import closure) vs **lazy** (dynamic-import chunks + worker bundles — where agents are allowed), and writes a `{chunkFile: {isEntry, dynamicallyImported, moduleIds[]}}` map to `dist/client/.bundle-modules.json`. `web/scripts/check-bundle.ts` reads that artifact and **fails if any eager chunk's `moduleIds` include a path matching `/src\/agent\//`**. This is the mechanical proof the brief calls "bundle discipline is load-bearing."

## File structure (what each new file owns)

All paths under `web/` unless noted. Colocated `*.test.ts(x)` next to the unit under test.

| File | Responsibility | Phase |
|---|---|---|
| `web/index.html`, `web/vite.config.ts`, `web/tsconfig.json` | Vite entry, build (→ `../dist/client`), worker + manifest config; SPA tsconfig extending root + DOM/jsx. | P0 |
| `web/src/main.tsx`, `src/app/App.tsx`, `src/app/routes.tsx` | App entry; shell (top bar + collapsible rail + routed outlet); routes home/game/viewer/rules. | P0 |
| `src/app/shell/TopBar.tsx`, `RightRail.tsx`, `useBreakpoint.ts` | Slim top bar (wordmark, turn/phase chip, seed/config readout, Instruments button); collapsible rail; responsive rules. | P0 |
| `src/design/tokens.css`, `tokens.ts`, `typography.css`, `motion.ts` | OKLCH palette custom-properties + typed accessors; serif/sans/mono trio + Cartouche/Table/Parchment/Brass rule classes; motion tokens + reduced-motion helpers. | P0 |
| `src/design/cvd-check.test.ts` | The AA-contrast + CVD-sim gate over the token values (deutan/protan/tritan separability of the 6 player colors; body text ≥4.5:1). | P0 |
| `src/identity/player-identity.ts` (+ test), `shapes.tsx` | `playerIdentity(id): {colorVar, shape, pattern}` — the CVD-safe color+shape+pattern set; SVG shape primitives (circle/square/triangle/diamond/pentagon/six-point). | P0 |
| `src/engine-client/barrel.ts` | The single client import point for agent-free engine + deep session symbols (see Bundle architecture rule 1). | P0 |
| `src/engine-client/selectors.ts` (+ test) | Memoized derived selectors keyed on the immutable `GameState` reference: `controlOf(state, player)`, `budgetOf`, `currentSeat`, `factoriesPlaced`, etc. (GEO-5-safe memoization). | P1 |
| `src/board/projection.ts` (+ test) | Pure cube→pixel layout (axial/pixel math; GEO-2 if any inverse; GEO-4 keys); board extent → viewBox. | P1 |
| `src/board/Board.tsx`, `Hex.tsx`, `Base.tsx`, `Factory.tsx`, `IronGlyph.tsx` | The SVG board + cell/glyph components (fresh/fatigued base states, stranded marks, per-player identity). | P1 |
| `src/board/territory.ts` (+ test) | Pure: `territoryFills(state)` from `control().hexes` for all players (both regimes) + `overlapZones(state)` (set-intersection of controlled hexes, GEO-4 keys). | P1 |
| `src/board/highlight.ts` (+ test) | Pure: legal-target sets from `legalActions`/`legalFirstBaseHexes` (build hexes, attack targets, placement hexes). | P1 |
| `src/board/tooltip.ts`, hit-testing in `Hex.tsx` | Hover → control/iron/occupant tooltip data; click via SVG element `data-hex` targeting (no pixel→hex inverse). | P1 |
| `src/designer/NewGame.tsx`, `config-form.ts` (+ test), `board-source.ts` (+ test), `presets.ts` | The designer instrument: grouped/validated `RuleConfig` knobs + provenance; board source generate|fixed-JSON (schema-validated as untrusted); `current-playtest-config` preset; fork-with-config. | P2 |
| `src/viewer/AgentViewer.tsx`, `generate.worker.ts`, `generate-client.ts`, `stepper.ts` (+ test) | All-agent viewer: Web-Worker `recordGame` generation; worker handle + message protocol; pure `applyEntry`-based incremental stepper (play/pause/step); agent-free `replayLog` of imported records. | P2 |
| `src/rules/RulesReference.tsx`, `rules-content.ts`, `error-explanations.ts` (+ test) | v10 text + DER callouts merged inline; `DriverErrorCode → rule one-liner` map (the teaching surface). | P2 |
| `src/game/driver.ts` | The `GameDriver` interface + `DriverCommand`/`DriverEvent`/`DriverPending`/`DriverErrorCode` types. | P0 (types) / P3 (consumers) |
| `src/game/fake-driver.ts` (+ test) | In-memory scripted driver for component tests (emits queued events; deterministic). | P3 |
| `src/game/store.ts` (+ test) | Zustand store: authoritative slice (state/logLength/roster/pending/connection/versions), preview slice, UI slice; subscribes to a `GameDriver`. | P3 |
| `src/game/local-reducer-driver.ts` (+ test) | Wraps DO-host Part A's `applyCommand` + agent-drive in-browser (hotseat + offline vs-agents); dynamic-import chunk (pulls agents). **Gated on Part A.** | P3 |
| `src/game/socket-driver.ts` (+ test) | Wraps `src/wire`/the DO over WebSocket; the ONLY `src/wire` value-importer; `DriverCommand↔ClientCommand` + `ServerMessage↔DriverEvent` mapping; connect/keepalive/reconnect/resync/handshake. **Gated on Part B.** | P4 |
| `src/composers/*` (+ tests) | BuildComposer, AttackComposer, DefenderPrompt, ChainContinuePrompt, ForcedPassNotice, SetupPlacement, TurnOrderCeremony. | P3 |
| `src/composers/preview.ts` (+ test) | Pure deterministic optimistic preview via `applyAction` (build/placement/budget only; never attack resolution). | P3 |
| `src/hud/*` (+ tests) | Hud, ResourcePanel, FactoryGauge (X/36), TurnOrderTokens, EventLog (virtualized), `event-copy.ts` (`GameEvent` → string: all 6 kinds + 4 elimination causes + bounty). | P3 |
| `src/game/choreography/*` | Combat reveal, elimination, victory set pieces + `prefers-reduced-motion` alternatives; honest numbers in mono. | P3 |
| `web/vite-plugin-bundle-guard.ts` | Rollup plugin: `generateBundle` writes the authoritative chunk→modules map (`dist/client/.bundle-modules.json`). | P0.2 |
| `web/scripts/check-bundle.ts` | CI bundle-guard: reads `.bundle-modules.json`, fails if `src/agent` is in an eager chunk. | P0 (script) / wired in CI by P0 |
| **Shared config** | `package.json` (deps+scripts), `.github/workflows/ci.yml` (append to `check`), `bun.lock` (flag `## Shared-config changes`). Root `vitest.config.ts`/`tsconfig`, `wrangler.jsonc` NOT touched. | P0 |

## File ownership & execution order (prevents conflicts)

Execute phases in order. Within a shared file, the earlier task MUST merge to `dev` before the later starts (each branches from fresh `origin/dev`).

| File | Tasks that create/modify it | Required order |
|---|---|---|
| Shared config (`package.json`, `ci.yml` `check` job, `bun.lock`) | P0.1 (scaffold) | first; coordinate with DO-host B1 + sweep |
| `web/src/game/driver.ts` | P0 (types), P3 (no change — consumers only) | P0 defines; P3+ import |
| `web/src/engine-client/barrel.ts` | P0 (create), P1 (add selectors re-export) | P0 → P1 |
| `web/src/board/*` | P1 | after P0 |
| `web/src/designer/*`, `src/viewer/*`, `src/rules/*` | P2 | after P1 (designer/viewer render the board) |
| `web/src/game/store.ts`, `fake-driver.ts`, `src/composers/*`, `src/hud/*` | P3 | after P1 (board) + P0 (driver types) |
| `web/src/game/local-reducer-driver.ts` | P3 | after DO-host **Part A** merges |
| `web/src/game/socket-driver.ts` | P4 | after DO-host **Part B** merges |

---

# PHASE P0 — Foundation + visual system

**Execution Status:** 🚧 IN PROGRESS — claimed 2026-07-03T05:34:32Z on branch `feat/web-p0-foundation`

Stands up `web/` (Vite + React + TS), the build/test/CI wiring (minimizing shared-config collision — own `web/vitest.config.ts`, append steps to the existing `check` job, never restructure the root `vitest.config.ts`/`tsconfig.json` the DO-host track edits), the bundle-guard, the OKLCH visual-token system with its AA + CVD gate, the CVD-safe player identity, the `GameDriver` types, the engine-client barrel, and the app shell. All shipped-code-only; no DO/reducer/`src/wire` dependency. **`## Shared-config changes` on every config-touching PR.**

> **Read first (CLAUDE.md mandate for UI work):** `PRODUCT.md` (register, users, anti-references, accessibility) and `DESIGN.md` (the visual-system seed + the named rules: Table / Parchment-Belongs-to-the-Board / Brass Budget / Cartouche). The candidate palette + shapes are in the UI brief §3.

### Task P0.1: Scaffold `web/` + build/test/CI wiring (config — NOT TDD)

**Files:**
- Create: `web/index.html`, `web/vite.config.ts`, `web/tsconfig.json`, `web/vitest.config.ts`, `web/vitest.setup.ts`, `web/src/main.tsx`, `web/src/app/App.tsx`
- Modify: `package.json` (deps + scripts — append-only), `.github/workflows/ci.yml` (append steps to `check`), `bun.lock` (regenerated). **Does NOT touch `wrangler.jsonc` (DO-host-owned) or `vitest` version (DO-host bump).**

- [ ] **Step 1: Add dependencies to `package.json`** (append to `devDependencies` — see the vitest note below; do NOT add or bump `vitest` here):

```jsonc
// devDependencies additions:
"react": "^18.3.0", "react-dom": "^18.3.0",
"@types/react": "^18.3.0", "@types/react-dom": "^18.3.0",
"@vitejs/plugin-react": "^4.3.0", "vite": "^6.0.0",
"jsdom": "^25.0.0",
"@testing-library/react": "^16.0.0",
"@testing-library/jest-dom": "^6.5.0",
"@testing-library/user-event": "^14.5.0",
"zustand": "^5.0.0",
"@radix-ui/react-dialog": "^1.1.0", "@radix-ui/react-slider": "^1.2.0",
"@radix-ui/react-tooltip": "^1.1.0", "@radix-ui/react-popover": "^1.1.0",
"@radix-ui/react-tabs": "^1.1.0"
```

> **Do NOT add/bump `vitest` here.** The `vitest` version is the **DO-host B1 shared 2→4 bump** (it can break the existing 395-test node suite — major-version fallout B1 owns). This plan's SPA config uses the stable `defineConfig`/`test` API that works across v2–v4. If B1 has not landed, the SPA suite runs on the **current vitest 2** — fine; when B1 bumps to 4, the SPA suite is **re-verified green** (B1 owns cross-suite fallout). Coordinate; do NOT independently pin a conflicting `vitest`.

Add `scripts` (append): `"typecheck:client": "tsc -p web/tsconfig.json --noEmit"`, `"build:client": "vite build -c web/vite.config.ts"`, `"test:client": "vitest run -c web/vitest.config.ts"`, `"dev:client": "vite -c web/vite.config.ts"`, `"check:bundle": "tsx web/scripts/check-bundle.ts"`.

- [ ] **Step 2: `web/vite.config.ts`** — build to `../dist/client`, enable React + ES workers. (The agent-bundle guard is the **plugin** added in P0.2 — `bundleGuard()` — NOT the manifest; `manifest: true` is kept only as a build asset-map, not as the guard's source.)

```ts
// ABOUTME: Vite config for the Industrial Juggernaut SPA; builds to ../dist/client (Worker assets dir).
// ABOUTME: React plugin; ES-format workers; the bundle-guard plugin (added in P0.2) emits .bundle-modules.json.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// import { bundleGuard } from "./vite-plugin-bundle-guard"; // added in P0.2

export default defineConfig({
  root: import.meta.dirname,                       // the web/ dir
  build: { outDir: "../dist/client", emptyOutDir: true, manifest: true },
  worker: { format: "es" },
  plugins: [react() /*, bundleGuard() — wired in P0.2 */],
});
```

- [ ] **Step 3: `web/tsconfig.json`** — extend the root, ADD DOM + jsx, do NOT relax strictness:

```jsonc
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["vite/client", "@testing-library/jest-dom"],
    "noEmit": true
  },
  "include": ["src", "vitest.setup.ts", "scripts"]
}
```

- [ ] **Step 4: `web/vitest.config.ts`** (separate from root — leaves the node glob untouched) + `web/vitest.setup.ts`:

```ts
// ABOUTME: SPA test project — jsdom env, colocated web/src tests; SEPARATE from the root node suite.
// ABOUTME: Keeps the engine's test/**/*.test.ts glob untouched (sweep track depends on it).
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  test: {
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    root: import.meta.dirname,
  },
});
```
```ts
// web/vitest.setup.ts
// ABOUTME: Vitest setup for the SPA project — registers jest-dom matchers.
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 5: `web/index.html` + `web/src/main.tsx` + a placeholder `web/src/app/App.tsx`** — minimal mount (`createRoot`), a single `<div id="root">`, `App` renders a "Industrial Juggernaut" wordmark placeholder (replaced in P0.7).

- [ ] **Step 6: `wrangler.jsonc` — coordination note ONLY (do NOT create or edit it here).** The DO-host plan's **B1 owns `wrangler.jsonc`** and already sets `assets.directory: "./dist/client"` (per the DO-host plan). This plan's only obligation is that the SPA build **outputs to `dist/client`** (Step 2). You do NOT need wrangler for any SPA work — `bun run dev:client` (Vite) serves locally; wrangler is **deploy-only** (DO-host/CI territory). Creating a stub `wrangler.jsonc` here would collide with B1's full config — so don't. (This is why `wrangler.jsonc` is **not** in this plan's `## Shared-config changes` surface — it's coordination-only.)

- [ ] **Step 7: `.github/workflows/ci.yml`** — append four steps to the existing `check` job, after `bun run build` (flag `## Shared-config changes`; coordinate with DO-host B8):
```yaml
      - run: bun run typecheck:client
      - run: bun run test:client
      - run: bun run build:client
      - run: bun run check:bundle
```

- [ ] **Step 8: `bun install`** to update `bun.lock`. Run: `bun install`. Expected: lockfile updated; no errors. **Commit `bun.lock` together with `package.json`** — CI's `bun install --frozen-lockfile` (the existing `check` job) fails if the lockfile doesn't match `package.json`.

- [ ] **Step 9: Verify** — `bun run typecheck` (engine, unaffected) → green; `bun run typecheck:client` → green; `bun run dev:client` smoke (loads the wordmark in a browser); `bun run build:client` → emits `dist/client/` + `dist/client/.vite/manifest.json`. **No TDD** (config). Commit (`## Shared-config changes` listing every edited file + the exact keys).

- [ ] **Apply the Execution Discipline block.**

### Task P0.2: Bundle-guard plugin + script (logic — TDD against a fixture module-map)

**Files:** Create `web/vite-plugin-bundle-guard.ts` (the Rollup plugin), `web/scripts/check-bundle.ts` (+ `check-bundle.test.ts`); wire the plugin into `web/vite.config.ts` (P0.1 Step 2).

Per Bundle architecture rule 3 — the plugin emits the **authoritative** chunk→modules map; the script asserts on it (a manifest read is NOT sufficient).

- [ ] **Step 1: Failing test** — `check-bundle.test.ts`: feed `assertNoAgentsInEager(moduleMap)` two **in-memory module-map fixtures** (the shape the plugin writes — `{file: {isEntry, dynamicallyImported, moduleIds[]}}`): (a) an eager (entry / non-dynamic) chunk whose `moduleIds` are all non-agent → returns ok; (b) an eager chunk whose `moduleIds` include `…/src/agent/greedy.ts` → throws `Error` whose message names the offending module **and** chunk. Assert the message (not just "threw"). Also assert an agent module in a `dynamicallyImported: true` chunk is **allowed** (returns ok). Run `bun run test:client` → FAIL.
- [ ] **Step 2: Implement** (i) `web/vite-plugin-bundle-guard.ts` — a Vite plugin whose `generateBundle(_, bundle)` walks `Object.values(bundle)`, and for each `type === "chunk"` records `{isEntry: chunk.isEntry, dynamicallyImported: chunk.isDynamicEntry, moduleIds: Object.keys(chunk.modules)}`, then `this.emitFile({type:"asset", fileName:".bundle-modules.json", source: JSON.stringify(map)})`; (ii) `assertNoAgentsInEager(moduleMap)` (pure) — eager = chunks reachable from an `isEntry` chunk via static imports (treat `isEntry || !dynamicallyImported` as eager for v1; the worker bundle is a separate Rollup output, not in this map); throw on any `/src\/agent\//` module in an eager chunk; (iii) the CLI wrapper reads `dist/client/.bundle-modules.json` and calls it.
- [ ] **Step 3:** Run `bun run test:client` → PASS. Run `bun run build:client && bun run check:bundle` on the (currently agent-free) build → exits 0 (and `.bundle-modules.json` exists). **Step 4: Commit.** **Apply the Execution Discipline block.**

> **Pitfall (testing-pitfalls §6):** test the guard's FAILURE path (the eager-chunk-with-agent fixture) AND the allow path (agent in a dynamic chunk) — a guard that never fails, or that fails on the legitimate lazy chunk, is worthless. Assert the thrown message names the module + chunk.

### Task P0.3: OKLCH design tokens + typography + motion (CSS/config — gate on P0.4 + browser)

**Files:** Create `web/src/design/tokens.css`, `tokens.ts`, `typography.css`, `motion.ts`

Convert the UI-brief candidate hex to **OKLCH** custom properties: walnut chrome `#241910`/`#2f2114`; parchment board `#d8c39c`–`#e6d8b8`; brass `#b78d3c`; player set oxide-red `#c0492f`, cobalt `#2f6f9f`, violet `#6f4a86` + three more (extended to 6, finalized by P0.4's CVD gate); ink (warm-black) for text/linework. Encode the named rules as utility classes: **Table** (chrome = walnut/iron, carries 30–60%), **Parchment-Belongs-to-the-Board** (parchment ONLY on the board — never an app-chrome tint), **Brass Budget** (brass ≤10% of any screen), **Cartouche** (display serif ONLY at game moments — never UI labels/buttons/data). `tokens.ts` exposes typed accessors (`color(name)`, scales). Typography: a vintage engraved serif (display), a warm humanist sans (body), a monospace (numbers/telemetry) — chosen at implementation, loaded self-hosted; the Cartouche Rule enforced by class scoping. `motion.ts`: 150–250ms feedback tokens + a `prefersReducedMotion()` helper.

- [ ] This task ships CSS/TS token definitions; **no component unit test** (verified by P0.4's gate + browser review). Step: define the tokens, document the OKLCH values + their source hex inline, wire `tokens.css` into `main.tsx`. Verify `bun run typecheck:client` green + a browser smoke shows the palette on a swatch page. Commit. **Apply the Execution Discipline block** (TDD N/A — token definitions; the gate is P0.4).

### Task P0.4: AA contrast + CVD-separability gate (logic — TDD)

**Files:** Create `web/src/design/cvd-check.ts` + `web/src/design/cvd-check.test.ts`

The gate that makes the palette "final" (UI brief §10; PRODUCT.md accessibility). Pure functions over the token OKLCH values.

- [ ] **Step 1: Failing test** asserting: (a) `contrastRatio(ink, parchment) >= 4.5` and body text on chrome ≥ 4.5:1 (WCAG 2.1 AA); (b) for the 6 player colors, `cvdSeparable(colors)` returns true — every pair stays distinguishable (ΔE above a threshold) under **deuteranopia, protanopia, and tritanopia** simulation. Use fixed, documented thresholds. Run `bun run test:client` → FAIL.
- [ ] **Step 2: Implement** `contrastRatio` (WCAG relative-luminance formula) + `cvdSeparable` (apply a standard CVD simulation matrix per type, then a perceptual-distance check). Pure; no I/O. If the candidate 6 colors fail, adjust the 3 extension colors (NOT the 3 brief-committed ones) until they pass — record the final values in `tokens.css`.
- [ ] **Step 3:** Run `bun run test:client` → PASS (palette finalized). **Step 4: Commit.** **Apply the Execution Discipline block.**

> This is a regime-boundary discipline (testing-pitfalls §8 spirit): the gate must FAIL for a known-bad palette (add a fixture of two too-close colors and assert `cvdSeparable` rejects it) — proving the check has teeth.

### Task P0.5: CVD-safe player identity (logic + presentational — TDD the mapping)

**Files:** Create `web/src/identity/player-identity.ts` (+ test), `web/src/identity/shapes.tsx`

- [ ] **Step 1: Failing test** — `playerIdentity(id: PlayerId)` returns `{ colorVar, shape, pattern }` for ids 0–5; assert all 6 shapes are distinct (`circle/square/triangle/diamond/pentagon/six-point`), all 6 colorVars distinct, and the mapping is total + stable (id 0 always oxide-red/circle, etc.). Run → FAIL.
- [ ] **Step 2: Implement** the mapping (color from P0.4's finalized set; shape from the 6-set; pattern as a third redundant channel — e.g. fill texture — for max CVD safety per PRODUCT.md "never color alone"). `shapes.tsx` renders each shape as a pure SVG primitive sized to a hex.
- [ ] **Step 3:** PASS. **Step 4:** structure-test `shapes.tsx` renders the right `<polygon>`/`<circle>` per shape (jsdom). **Step 5: Commit.** **Apply the Execution Discipline block.**

### Task P0.6: `GameDriver` types + engine-client barrel (types/module — smoke + bundle rule)

**Files:** Create `web/src/game/driver.ts` (the contract — verbatim from "The `GameDriver` contract" section), `web/src/engine-client/barrel.ts` (+ a `barrel.test.ts`)

- [ ] **Step 1:** Create `driver.ts` exactly as specified in the contract section (types + interface). Create `barrel.ts` per Bundle architecture rule 1 (re-export agent-free engine from `src/index.ts` + agent-free session pieces from deep modules; NEVER `src/session/index`).
- [ ] **Step 2: Failing test** `barrel.test.ts` — import `applyEntry`, `replayLog`, `stateHash`, `legalActions`, `control`, `initGame`, `defaultConfig` from the barrel and assert they are functions; a `DriverCommand`/`DriverEvent` type-presence smoke (like the wire protocol smoke). Run → FAIL (barrel missing).
- [ ] **Step 3:** Implement the barrel. PASS. The agent-absence is proven by P0.2's guard at build, not this test.
- [ ] **Step 4: Commit.** **Apply the Execution Discipline block.**

> **Bundle rule (do NOT violate):** `barrel.ts` MUST import `applyEntry` from `../../../src/session/round` (deep), NOT from `../../../src/session/index` (which pulls `recordGame` → `src/agent`). A regression here is caught by P0.2's guard.

### Task P0.7: App shell + routing + responsive breakpoints (components — structure-tested)

**Files:** Create `web/src/app/App.tsx` (replace placeholder), `routes.tsx`, `web/src/app/shell/TopBar.tsx`, `RightRail.tsx`, `useBreakpoint.ts`

Layout per UI brief §5: board-hero left-weighted; slim top bar (≤44px: wordmark, turn/phase chip, seed/config mono readout, **Instruments** button); ONE collapsible right rail; routes home (`/`), game (`/game`), viewer (`/viewer`), rules (`/rules`). Breakpoints (asserted defaults): rail collapses to a toggle < ~1100px; < ~768px = check-in (compact HUD, composing gated). Use Radix where a primitive fits (the rail drawer, dialogs).

- [ ] **Step 1: Failing tests** (jsdom structure): the shell renders a `<header>` with the wordmark + an Instruments button; `useBreakpoint` returns `"wide"|"narrow"|"compact"` for given `matchMedia` widths (mock `matchMedia`); the rail is present at `wide`, collapsed (toggle button, `aria-expanded`) at `narrow`. Routing renders the right screen per path. Run → FAIL.
- [ ] **Step 2: Implement** the shell + `useBreakpoint` (a `matchMedia` hook) + routing (a tiny client router or `react-router` — **decide one**: use a minimal hash/path router to avoid a dep unless `react-router` is already warranted; the plan asserts a minimal in-house router, ~30 lines, since there are 4 static routes). **Step 3:** PASS. **Step 4: Commit.**
- [ ] **Apply the Execution Discipline block.**

> **a11y:** the Instruments button + rail toggle are keyboard-focusable with correct `aria-expanded`; the rail is a Radix-or-equivalent disclosure. Verified in jsdom (focus/ARIA) + browser.

### Phase P0 close-out

- [ ] **`/impeccable document` re-run:** now that the first SPA code + tokens exist, run `/impeccable document` to replace the `DESIGN.md` seed `[to be resolved]` placeholders with the **extracted OKLCH tokens + a component sidecar**. Commit the DESIGN.md update (`docs`, Routine).
- [ ] **Phase review (≥3 perspectives):** (1) brief-faithfulness — Table/Parchment/Brass/Cartouche rules encoded + the palette passes the CVD/AA gate; (2) bundle discipline — `check:bundle` green, no `src/agent` in the entry chunk, the engine-client barrel deep-imports session; (3) subagent-readiness — P1 can render against the shipped engine using `barrel.ts` + `player-identity` + tokens. Update the Execution Status banner + table. Record Deviations/Discoveries.

---

# PHASE P1 — SVG hex board renderer

**Execution Status:** ⬜ NOT STARTED

A pure-presentation SVG board over `GameState`: projection, the landmass, iron/factory/base glyphs, fresh/fatigued + stranded marks, **both territory regimes** + overlap zones, and legal-target highlighting from engine hints. No interaction logic (P3 wires `onHexClick`/`onHexHover` via the driver); no DO/reducer. **Test split (per Plan altitude + G3):** the math (`projection`, `territory`, `highlight`, `selectors`) is pure-function TDD; the SVG components are structure/ARIA-tested in jsdom; visual correctness is verified in the browser against a **real recorded game state** (generate one with `recordGame` in a test fixture or a dev page).

> **Geometry pitfalls (read before P1.1):** **GEO-4** — key every hex Set/Map by the canonical `"x,y,z"` string, never object identity. **GEO-2** — cube rounding is only needed for a pixel→hex *inverse*; this phase deliberately does hit-testing via SVG element `data-hex` attributes (P1.6), so no inverse + no GEO-2 exposure. **GEO-1** — no client-side point-in-polygon (territory renders controlled *cells*, not a re-derived hull), so no epsilon exposure. **GEO-5** — `control()` is recomputed every call and never stored on the model; P1.2 memoizes it on the immutable state reference (a pure-function cache keyed by immutable input — allowed; NOT model-stored derived state).

### Task P1.1: Cube→pixel projection (pure — TDD)

**Files:** Create `web/src/board/projection.ts` (+ `projection.test.ts`)

- [ ] **Step 1: Failing test** — pin a **flat-top** layout: `hexToPixel({x,y,z}, size)` returns `{px, py}` with `px = size * 1.5 * x`, `py = size * SQRT3 * (z + x/2)` (document the formula + axial mapping `q=x, r=z`); assert exact values for the origin `{0,0,0}` → `{0,0}` and a known neighbor. `boardViewBox(board, size)` returns `{minX,minY,width,height}` covering all `board.hexes` padded by one hex radius. Assert the viewBox bounds for a small fixed board. Fixed inputs (no RNG). Run `bun run test:client` → FAIL.
- [ ] **Step 2: Implement** `hexToPixel`, `hexCorners(center, size)` (6 corner points for the `<polygon>`), `boardViewBox`. Pure; `SQRT3 = Math.sqrt(3)`. Key any internal hex collection by `hexKey({x,y,z}) = \`${x},${y},${z}\`` (GEO-4).
- [ ] **Step 3:** PASS. **Step 4: Commit** (`feat(web): cube→pixel hex projection`). **Apply the Execution Discipline block.**

### Task P1.2: Memoized engine selectors (logic — TDD)

**Files:** Create `web/src/engine-client/selectors.ts` (+ test); modify `web/src/engine-client/barrel.ts` to re-export them; **modify `src/index.ts`** to export `strandedBases` (`## Barrel additions` — see decision #9; pure, agent-free).

- [ ] **Step 1: Failing test** — `controlOf(state, player)` returns the same `Control` object on a second call with the **same state reference** (identity-equal, proving memoization) and a fresh one for a different state; `controlOf` equals `control(state, player)` (correctness). `currentSeat(state)` = `currentPlayer(state)`; `factoriesPlaced(state) = 36 - state.factorySupply`; `budgetOf(state, player)` = `buildBudget(state, player)` (used by P3.4's budget meter). `strandedHexKeys(state): Set<string>` unions `strandedBases(state, p)` over non-eliminated players → canonical `hexKey`s (assert against a fixed state with a known stranded base; structural set compare). Use a real `initGame` fixture (fixed seed). Run → FAIL.
- [ ] **Step 2: Implement** — first add `export { strandedBases } from "./engine/stranded";` to `src/index.ts` (the one barrel addition); then a `WeakMap<GameState, Map<PlayerId, Control>>` memo for `controlOf`, `strandedHexKeys` (also memoizable on state identity), and thin pass-throughs for the rest. **GEO-5 note in code:** "memoized on the immutable GameState reference — a pure-function cache, NOT derived state stored on the model; the engine never sees this cache."
- [ ] **Step 3:** PASS. **Step 4: Commit** (note `## Barrel additions: strandedBases` in the PR body — pure engine export, does not pull agents). **Apply the Execution Discipline block.**

### Task P1.3: Board + cell + piece components (presentational — structure-tested)

**Files:** Create `web/src/board/Board.tsx`, `Hex.tsx`, `Base.tsx`, `Factory.tsx`, `IronGlyph.tsx`, and `web/src/board/highlight.ts` **with the `HighlightSets` TYPE only** (`export type HighlightSets = { buildHexes: Set<string>; attackTargets: Set<string>; placementHexes: Set<string> }`) — `Board.tsx` imports it; P1.5 adds the `highlightSets` function to this same file. (Resolves the forward-ref so `Board.tsx` typechecks before P1.5 — R4.)

**Prop contract (the interface P3 wires against):**
```ts
type BoardProps = {
  state: GameState;
  highlights?: HighlightSets;          // type lives in board/highlight.ts; P1.3 Step 1 creates that file with the TYPE only, P1.5 adds the function
  selection?: { attackers?: Hex[]; target?: Hex; pieces?: Hex[] };  // composer-in-progress (P3)
  strandedHexes?: Set<string>;         // canonical hexKeys to mark stranded (P3 derives from the event stream; P1 just renders)
  onHexClick?: (hex: Hex) => void;
  onHexHover?: (hex: Hex | null) => void;
};
```
Renders one `<svg viewBox={boardViewBox(...)}>` containing: the landmass (`Hex` per `board.hexes`, each `<polygon data-hex="x,y,z">` with the parchment fill + ink linework), `IronGlyph` per `board.iron`, `Factory` per `state.factories`, `Base` per `state.bases` (uses `playerIdentity(owner)` → color+shape+pattern; `state==="fatigued"` renders the dimmed/rotated variant; a base that is stranded — see P1 note — gets a stranded mark). Cartouche serif is NOT used here (board labels are sans/mono).

- [ ] **Step 1: Failing structure tests** (jsdom): for a fixed `initGame` state, `Board` renders `board.hexes.length` `<polygon data-hex>` elements; one `Base` per `state.bases` with the owner's shape; `data-state="fatigued"` on a fatigued base fixture; iron + factory glyphs counts match. Click a hex → `onHexClick` fires with the parsed `{x,y,z}`. Run → FAIL.
- [ ] **Step 2: Implement** the components. `Hex` parses its own `data-hex` on click → `onHexClick`. **Step 3:** PASS.
- [ ] **Step 4:** Browser smoke — render a real recorded mid-game state; eyeball the landmass, bases (all 6 identities), factories, iron. **Step 5: Commit.** **Apply the Execution Discipline block.**

> **Stranded marks (decision — use the engine predicate; the event stream is NOT the source):** `Board` renders a stranded treatment for exactly the hexes in its `strandedHexes` prop (canonical keys). The source is the engine predicate **`strandedBases(state, player): Base[]`** (the `## Barrel addition` from decision #9) — **NOT** the `GameEvent` stream: the engine emits no event for a base that *survives* a round while stranded (only `baseDestroyed` on encirclement+removal), so an event-derived approach would silently miss most stranded bases (codex P1). Add a selector `strandedHexKeys(state): Set<string>` to `engine-client/selectors.ts` (P1.2, memoized on state identity) that unions `strandedBases(state, p)` over non-eliminated players; the game screen / viewer pass it as `strandedHexes`. In P1's own tests, pass `strandedHexes` explicitly as a fixture (the predicate itself is engine-tested). Do NOT reimplement the stranding graph client-side (GEO-5/GEO-1).

### Task P1.4: Territory fills + overlap zones (pure — TDD)

**Files:** Create `web/src/board/territory.ts` (+ test)

- [ ] **Step 1: Failing test** — `territoryFills(state)` returns, for each board hex, the set of controlling players (from `controlOf(state, p).hexes` for all non-eliminated `p`), keyed by `hexKey` (GEO-4). For a fixed state: a radiating player (<4 bases) yields a radius-disk fill; a perimetered player (≥4 bases, hull area >0) yields the hull-interior fill; assert specific hexes. `overlapZones(state)` returns hexes controlled by ≥2 players (set-intersection on canonical keys); assert a known shared hex. Compare hex sets as **normalized sorted arrays** (testing-pitfalls §8), never stringified blobs. Run → FAIL.
- [ ] **Step 2: Implement** using `controlOf` (P1.2) — both regimes fall out of `control().hexes` automatically; the client never computes a hull. Overlap = keys present in ≥2 players' sets.
- [ ] **Step 3:** PASS — include a **regime-boundary** case (a player at exactly 3↔4 bases) proving the fill switches regime. **Step 4: Commit.** **Apply the Execution Discipline block.**

### Task P1.5: Legal-target highlighting (pure — TDD)

**Files:** Modify `web/src/board/highlight.ts` (add the `highlightSets` function — the `HighlightSets` **type** was already created in P1.3) (+ test)

- [ ] **Step 1: Failing test** — `highlightSets(state): HighlightSets` (the type already exists in `board/highlight.ts` from P1.3; here add the function): `buildHexes`/`attackTargets` extracted from `legalActions(state)` (build actions' piece hexes; attack actions' `decl.target`); `placementHexes` from `legalFirstBaseHexes(state)` when `state.phase.turn===0`, else empty (each `Set<string>` of `hexKey`s). Assert against a fixed setup-phase state and a fixed play-phase state. Run → FAIL.
- [ ] **Step 2: Implement.** Note `legalActions` enumerates **representatives** — the highlight is "hexes that appear in some legal action," which is exactly what the UI highlights (the composer refines commitment/attackers). **Step 3:** PASS. **Step 4: Commit.** **Apply the Execution Discipline block.**

### Task P1.6: Hover tooltip + SVG hit-testing (logic + component)

**Files:** Create `web/src/board/tooltip.ts` (+ test); wire hover into `Hex.tsx`

- [ ] **Step 1: Failing test** — `tooltipData(state, hex)` returns `{ controlledBy: PlayerId | null, isIron: boolean, occupant: "base"|"factory"|null }` for a given hex (uses `controlOf` + `board.iron` membership via `hexKey` + `bases`/`factories` lookup). Assert for an iron hex inside one player's territory, an empty hex, an occupied base hex. Run → FAIL.
- [ ] **Step 2: Implement** `tooltipData` (pure); `Hex.tsx` fires `onHexHover(hex)` on pointer-enter / `onHexHover(null)` on leave. **Hit-testing is SVG-element-based** (each hex is its own `<polygon>` with `data-hex`) — NO pixel→hex inverse, NO GEO-2. **Step 3:** PASS + a jsdom test that hover fires the callback with the right hex. **Step 4: Commit.** **Apply the Execution Discipline block.**

### Phase P1 close-out

- [ ] **Browser verification:** a dev page renders a real recorded game (early radiating state + a late perimetered state) — territory regimes, overlap zones, all 6 player identities, fresh/fatigued, iron/factories, legal highlights all read correctly and legibly (Into-the-Breach clarity benchmark; the board is the brightest object). Capture a screenshot for the PR.
- [ ] **Phase review (≥3 perspectives):** (1) geometry-pitfall compliance (GEO-1/2/4/5 — no inverse, canonical keys, memo-on-identity); (2) brief-faithfulness (board is the hero, parchment only on the board, legibility); (3) subagent-readiness (P2 designer/viewer + P3 composers can mount `Board` against its prop contract). Update banner + table; record Deviations/Discoveries.

---

# PHASE P2 — Designer instrument + all-agent viewer + rules-reference

**Execution Status:** ⬜ NOT STARTED

The three shipped-code-only screens that complete the front-loaded client: the **new-game designer instrument** (full `RuleConfig` knob set + board source + seats + seed + fork), the **all-agent watch viewer** (generate via `recordGame` in a Web Worker, step on the pure engine; agent-free `replayLog` of imported records), and the **rules-reference** (v10 + DER callouts + the error-code→rule-explanation map). No DO/reducer. **Bundle discipline is load-bearing here:** the viewer is the first place agents enter the client — they MUST live in the Web Worker bundle (P2.6), proven by P0.2's `check:bundle`.

### Task P2.1: `RuleConfig` knob form model + validation (logic — TDD)

**Files:** Create `web/src/designer/config-form.ts` (+ test)

The knob surface (verified): `radius, placeRange, attackRange, baseLimit, autoWinAt6, killBounty, factorySupply, ironCount, boardSize, victoryThreshold, brokenPerimeterDeathAtFactories, allowPass, combatTable`.

- [ ] **Step 1: Failing test** — `configGroups()` returns the knobs grouped (e.g. "Board", "Economy", "Combat", "Victory", "Liveness") covering **all** `RuleConfig` keys (assert the union of grouped keys === `Object.keys(defaultConfig())`); `validateConfig(cfg)` returns structured errors for out-of-range values (e.g. `ironCount < 1`, `boardSize` outside 96–300, `victoryThreshold < 1`) and `[]` for `defaultConfig()`; `provenance(cfg)` marks each knob `"default" | "tuned"` by deep-comparing to `defaultConfig()`. Run → FAIL.
- [ ] **Step 2: Implement.** Validation ranges documented inline (cite DER #16 for `boardSize` oval tolerance). `provenance` enables the "default vs hand-tuned" badge per the spec.
- [ ] **Step 3:** PASS — include boundary cases (ironCount 0/1; boardSize 95/96/300/301). **Step 4: Commit.** **Apply the Execution Discipline block.**

### Task P2.2: Board source — generate | fixed-JSON (untrusted) (logic — TDD)

**Files:** Create `web/src/designer/board-source.ts` (+ test)

- [ ] **Step 1: Failing test** — `parseBoardSource(input)` for `{kind:"generate", size, ironCount}` validates ranges; for `{kind:"fixed", def}` it validates the pasted `BoardDefinition` JSON as **untrusted**: `hexes` is a non-empty array of `{x,y,z}` each satisfying `x+y+z===0`; `iron` is a non-empty subset of `hexes` (membership by `hexKey`, GEO-4); returns `{ok, source}` or `{ok:false, errors:[friendly strings]}`. Assert: a valid generate source; a fixed def with a bad invariant (`x+y+z!==0`) → friendly error naming the offending hex; iron not in hexes → friendly error; non-JSON → "couldn't parse JSON" not a stack trace. Run → FAIL.
- [ ] **Step 2: Implement** the validator (pure; does NOT call `loadBoard` — it pre-validates so the friendly error precedes any engine throw). Note: the live path (P4) re-validates server-side (defense in depth); this is the client's friendly-error gate.
- [ ] **Step 3:** PASS. **Step 4: Commit.** **Apply the Execution Discipline block.**

> **Pitfall (testing-pitfalls §4 — oversized/malformed input):** test empty arrays, a 10k-hex paste, NUL/unicode in the JSON, duplicate hexes. Untrusted input gets the full negative-property treatment.

### Task P2.3: Presets + provenance (logic — TDD light)

**Files:** Create `web/src/designer/presets.ts` (+ test)

- [ ] **Step 1: Failing test** — `presets()` includes `current-playtest-config` whose value **deep-equals `defaultConfig()`** initially (the spec's "stored in one place so sweep-derived adoption is a one-line change"); `applyPreset(name)` returns that config. Run → FAIL.
- [ ] **Step 2: Implement** — a single source-of-truth preset record + a doc comment marking it the one-line swap point for sweep-derived adoption. **Step 3:** PASS. **Step 4: Commit.** **Apply the Execution Discipline block.**

### Task P2.4: New-game designer instrument (component — structure-tested)

**Files:** Create `web/src/designer/NewGame.tsx`

Assembles: preset selector → grouped knob controls (Radix sliders/inputs; provenance badges; validation messages) → board-source picker (generate inputs | fixed-JSON textarea with `parseBoardSource` errors) → per-seat human/agent assignment (`SeatConfig` from `src/session/types.ts`: `{kind:"human"}` | `{kind:"agent", agent:"greedy", archetype}` | `{kind:"agent", agent:"heuristic"}`; the greedy `Archetype` values are `"aggressive" | "economic" | "expansionist"` from `src/agent/archetypes.ts`) → explicit seed input → a **"balance under active development"** note → a primary **Start** action (brass, per the Brass Budget Rule) → produces a `SessionHeader`-shaped config object. A **fork** entry point accepts a current config and pre-fills (UI brief §7).

- [ ] **Step 1: Failing structure tests** (jsdom): renders a control per `RuleConfig` group; selecting a preset fills the knobs; an invalid ironCount shows the validation message + disables Start; pasting bad board JSON shows the friendly error; a seat toggled to "agent: greedy" exposes the archetype picker; Start with a valid form calls `onStart(header)` with the assembled `{seed, config, boardSource, seats}`. Run → FAIL.
- [ ] **Step 2: Implement** against P2.1–P2.3 + `player-identity` + tokens. The instrument wears the War-room lane (mono numbers, precise linework) — NOT a SaaS form (anti-reference). **Step 3:** PASS. **Step 4:** browser smoke. **Step 5: Commit.** **Apply the Execution Discipline block.**

> **Cartouche Rule:** knob labels/inputs/numbers are sans/mono — the display serif never appears in this form (DESIGN.md). A settings panel in the serif is a defect.

### Task P2.5: Viewer frame builder (pure — TDD)

**Files:** Create `web/src/viewer/stepper.ts` (+ test)

- [ ] **Step 1: Failing test** — `buildFrames(header, log)` folds `applyEntry` from `initGame({ seed: header.seed, boardSource: header.boardSource, nPlayers: header.seats.length, config: header.config })` over `log` (the shipped `initGame` takes `{seed, boardSource, nPlayers, config}` — NOT `initGame(header)`; mirror `src/session/replay.ts`'s call — codex P2), returning `Frame[] = { state: GameState, events: GameEvent[], logIndex: number }[]`. **Convention (pinned — R4): `frames.length === log.length + 1`**; `frames[0]` is the raw `initGame` state (setup phase, before any entry; `logIndex: -1`, `events: []`), and `frames[i+1]` is the state after applying `log[i]` (`logIndex: i`). For a fixed `recordGame` output: assert `frames.length === log.length + 1` and that the **final frame's `stateHash` equals the recorded `boundaryHashes` tail** (replay fidelity — reuse `stateHash` from the barrel). Assert structural state equality at a mid-game frame. Run → FAIL.
- [ ] **Step 2: Implement** the fold (agent-free — uses `applyEntry`, NOT `recordGame`). This is the play/pause/step substrate: the viewer indexes `frames`; back-stepping is just decrementing the index (states precomputed). **Step 3:** PASS. **Step 4: Commit.** **Apply the Execution Discipline block.**

> **Determinism (testing-pitfalls §8):** seed the fixture; assert replay equivalence by **structural state equality + `stateHash`**, never a substring of a stringified state.

### Task P2.6: Generation Web Worker (logic — TDD the client; worker is thin)

**Files:** Create `web/src/viewer/generate.worker.ts`, `web/src/viewer/generate-client.ts` (+ test)

- [ ] **Step 1: Failing test** — `generate-client.ts` exports `generateGame(req, workerFactory)` returning a Promise; with an **injected fake worker** (a `workerFactory` that returns an object with `postMessage`/`onmessage`), assert: posting `{header, turnCap}` and the fake replying `{log, finalState, ...}` resolves the promise with that payload; an error reply rejects with the message. (The injected-factory seam makes this testable without a real Worker.) Run → FAIL.
- [ ] **Step 2: Implement** `generate.worker.ts` (thin: `onmessage = ({header, turnCap}) => postMessage(recordGame(header, {turnCap}))` — encode bigints via the codec before posting, since `postMessage` structured-clone handles bigint but the viewer wants the decoded form; **decision:** post the decoded `RecordResult` directly — structured clone preserves bigint `rngState` natively, so no codec needed across the worker boundary) and `generate-client.ts` (default `workerFactory` constructs `new Worker(new URL("./generate.worker.ts", import.meta.url), {type:"module"})`). **This is the ONLY main-app path to `recordGame`/agents — it lives in the worker bundle.** **Step 3:** PASS. **Step 4:** `bun run build:client && bun run check:bundle` → green (agents in the worker chunk, NOT the entry chunk). **Step 5: Commit.** **Apply the Execution Discipline block.**

> **Bundle discipline (load-bearing):** `recordGame` MUST be imported ONLY inside `generate.worker.ts`. If `generate-client.ts` (main thread) imports `recordGame`, agents leak into the entry chunk and `check:bundle` fails. That failure is the guard working — do NOT suppress it.

### Task P2.7: All-agent viewer screen (component — structure-tested)

**Files:** Create `web/src/hud/event-copy.ts` (+ `event-copy.test.ts`), `web/src/hud/EventLog.tsx`, `web/src/viewer/AgentViewer.tsx`, `web/src/viewer/import-record.ts` (+ test)

> **Ordering note:** `event-copy.ts` + `EventLog.tsx` are built **here** (the viewer is their first consumer; P3.8's HUD reuses them — they are NOT re-created in P3). This keeps the viewer's event narration from depending on a later phase.

Renders the P1 `Board` over the current frame + transport controls: generate (config from a mini new-game form or a passed `SessionHeader` → `generateGame` → `buildFrames` → play/pause/step/scrub), AND **import a `SessionRecord`** (file/paste → **validate as untrusted** → decode via the session codec → `buildFrames` via agent-free `replayLog`/`applyEntry`, no worker, no agents). Play advances frames on a timer (respecting reduced-motion / a speed control); the `EventLog` narrates the current frame's events.

- [ ] **Step 1 (event-copy, logic TDD): Failing test** `event-copy.test.ts` — `eventLine(e: GameEvent): string` covers **all 6 `GameEvent` kinds** (`placed`, `combat`, `baseDestroyed`, `baseReplaced`, `eliminated`, `victory`) AND **all 4 `EliminationCause`s** (`noBases`, `brokenPerimeterAt18Factories`, `noIron`, `emptyPerimeter`) with bounty phrasing when `bountyTo != null`. Iterate a fixture of every kind/cause; assert each yields a non-empty, non-placeholder, human line (`combat` includes committed count + win/loss; `eliminated` names the cause + bounty target). Run → FAIL. Implement (boil-the-lake: every kind + cause). PASS.
- [ ] **Step 2 (import validation, logic TDD): Failing test** `import-record.ts` — `parseSessionRecord(text): {ok, record} | {ok:false, errors}` validates a pasted `SessionRecord` as **untrusted** (parse JSON → check `formatVersion`/`seed`/`config`/`boardSource`/`seats`/`log` shape → decode via the session codec) and returns **friendly errors** (not a stack trace) on malformed input (bad JSON, missing fields, undecodable bigint). Assert: a valid record decodes; a truncated/garbage record yields a friendly error. Run → FAIL. Implement. PASS.
- [ ] **Step 3 (viewer, structure tests):** with an injected fake `generateGame` returning a fixed `RecordResult`, the viewer builds frames and the Board shows frame 0; step advances to frame 1; play/pause toggles; importing a fixed `SessionRecord` JSON renders its frames **without** invoking `generateGame` (agent-free path); a malformed import shows the friendly error. `EventLog` is **virtualized** (render a 1000-event fixture → bounded DOM nodes; testing-pitfalls §4). Run → FAIL. Implement. **Step 4:** PASS. **Step 5:** browser smoke — generate a real 3-agent game, step it; import a record; import garbage → friendly error. **Step 6: Commit.** **Apply the Execution Discipline block.**

### Task P2.8: Rules-reference + error-explanation map (content + logic — TDD the map)

**Files:** Create `web/src/rules/error-explanations.ts` (+ test), `web/src/rules/rules-content.ts`, `web/src/rules/RulesReference.tsx`

- [ ] **Step 1: Failing test** (`error-explanations.test.ts`) — `explainError(code: DriverErrorCode): string` returns a one-sentence rule explanation for **every** `DriverErrorCode` (exhaustive — iterate the union via a const array and assert each maps to a non-empty, non-placeholder string); assert specific mappings (e.g. `DUP_ATTACKERS` → the no-duplicate-attacker rule; `NO_ELIGIBLE_DEFENDER` → DER #4; `PASS_NOT_FORCED` → DER #5). Run → FAIL.
- [ ] **Step 2: Implement** `error-explanations.ts` (the teaching surface — codes → rule one-liners, citing DERs where relevant). `rules-content.ts` structures the rules doc at **repo root `industrial-juggernaut-rules-v10.md`** with **DER #1–#17 callouts merged inline at the relevant sections** (never raw v10 — it teaches rules the engine diverges from; DER #1 convex-hull flagged prominently). **DER sources:** #1–#7 are in `docs/superpowers/specs/2026-06-12-web-client-design.md` ("Digital Edition Rulings" section); #8–#17 in `docs/plans/2026-06-13-fidelity-audit-findings.md` (also listed #8–#17 in the spec). `RulesReference.tsx` renders it (display serif permitted for section cartouches per the Cartouche Rule; body in sans).
- [ ] **Step 3:** PASS (exhaustive map). **Step 4:** structure-test `RulesReference` renders the DER #1 callout. **Step 5: Commit.** **Apply the Execution Discipline block.**

> **Boil-the-lake (completeness):** every `DriverErrorCode` AND every Digital Edition Ruling #1–#17 gets a rendered callout/explanation. A code with no explanation is a teaching-surface gap — the test enforces exhaustiveness.

### Phase P2 close-out

- [ ] **Browser verification:** start-a-game form produces a valid header; the viewer generates + steps a real all-agent game and imports a record; the rules screen renders with DER callouts. Screenshot for the PR.
- [ ] **Phase review (≥3 perspectives):** (1) bundle discipline — `check:bundle` green with the viewer present (agents only in the worker chunk); (2) spec/brief-faithfulness — designer instrument wears the War-room lane, no SaaS-dashboard feel, rules-reference is DER-merged not raw v10; (3) subagent-readiness — P3 can reuse `Board`/`EventLog`/the config form. Update banner + table; record Deviations/Discoveries.

---

# PHASE P3 — Interactive play UI + LocalReducerDriver

**Execution Status:** ⬜ NOT STARTED

The interactive game: the composers, prompts, HUD, event log, choreography, the Zustand store, and the **LocalReducerDriver** that makes hotseat + offline vs-agents playable on the pure reducer. **All components + the store build NOW against a fake `GameDriver`** (P3.1) — only the real `LocalReducerDriver` (P3.10) gates on the DO-host plan's Part A. Every component talks to the store; the store talks to a `GameDriver`; nothing talks to a transport directly.

> **The authoritative-state rule (do NOT violate):** the store tracks authoritative state by **folding `applied` entries through `applyEntry`** (agent-free, deterministic — the client re-applies the server's entry locally) and **replacing** state wholesale on `sync`. Optimistic preview (P3.3) is a SEPARATE, ephemeral slice, advisory only, cleared on every authoritative event, and **NEVER covers combat** (RNG-driven — odds shown, real draw awaited). This is decision #6 made structural.

### Task P3.1: Fake driver (logic — TDD)

**Files:** Create `web/src/game/fake-driver.ts` (+ test)

- [ ] **Step 1: Failing test** — `makeFakeDriver(opts)` implements `GameDriver` as a **strictly scripted** double that runs **NO game rules** (a `DriverCommand` has no `player`/`rngBeforeApply`, and the round state machine is Part A's job — so the fake MUST NOT call `applyEntry`/`applyAction`, codex P1): `subscribe` registers a handler and immediately emits a `sync` event from a provided initial `GameState` + roster; `submit(cmd)` records the command and emits the **next scripted `DriverEvent`(s)** the test queued (a prepared `applied`/`rejected`/`prompt`/`turnRollover`), then resolves; `pushEvent(e)` injects an event out-of-band; `controllableSeats()` returns the configured seats; `submitted()` exposes recorded commands for assertions. Assert subscribe→sync, submit→(scripted) `applied`, a scripted `rejected`, and that the driver mutated NO game state on its own. Run → FAIL.
- [ ] **Step 2: Implement** the scripted driver (deterministic, in-memory, **no rules, no agents, no `applyEntry`**). It is the boundary double for every P3 component + the store. **Step 3:** PASS. **Step 4: Commit.** **Apply the Execution Discipline block.**

> **Honest test double (testing-pitfalls §7):** the fake driver is a *boundary* double for component/store tests (the component is the unit under test; the driver is its boundary) — NOT a stand-in for real game logic. The real drivers (LocalReducerDriver, SocketDriver) get their own tests against the real reducer/transport. Do NOT assert game-rule outcomes through the fake driver.

### Task P3.2: Zustand store (logic — TDD)

**Files:** Create `web/src/game/store.ts` (+ test)

**Shape:** `{ authoritative: { state: GameState | null, logLength, roster, pending, connection }, preview: { state: GameState | null, source: DriverCommand | null }, ui: { openComposer, selection, hover } }` + actions. (No version fields — versions are the SocketDriver's build-constant comparison, decision #7.) `connectDriver(driver)` subscribes and dispatches events.

- [ ] **Step 1: Failing tests** — driving the store from a fake driver: `sync` sets authoritative state + `logLength` + clears preview; `applied` **with a continuous `logIndex`** folds the entry via `applyEntry` → state advances, `logLength` increments, preview cleared; `turnRollover` updates the order; `prompt` sets `pending` (only surfaced if `controllableSeats` includes `promptedSeat`); `gameOver` sets terminal; `rejected` with `STALE_INDEX` triggers `requestSync`; `connection` updates status. **Log-index guard (codex P1):** an `applied` whose `logIndex !== authoritative.logLength` (the expected next index — duplicate or out-of-order socket event) **does NOT fold** — it triggers `requestSync` and leaves state untouched. Assert both: an in-order `applied` advances state to match `applyEntry(prev, entry).state` (mechanism); a stale/ahead `applied` mutates nothing and calls `requestSync`. Run → FAIL.
- [ ] **Step 2: Implement** the store + `connectDriver`. The `applied` reducer (i) checks `logIndex === logLength` else `requestSync`, (ii) folds via `applyEntry` from the engine-client barrel (agent-free — deterministic because `applyEntry` installs `entry.rngBeforeApply` before applying). `setPreview(cmd)`/`clearPreview` manage the preview slice. **Step 3:** PASS. **Step 4: Commit.** **Apply the Execution Discipline block** (incl. the assertion-rigor block — this is async/event-driven).

### Task P3.3: Deterministic optimistic preview (logic — TDD)

**Files:** Create `web/src/composers/preview.ts` (+ test)

- [ ] **Step 1: Failing test** — `previewCommand(state, player, cmd: DriverCommand): { state: GameState; combat?: true }` produces a deterministic preview: `build`/`pass` via `applyAction(state, {kind:"build", pieces} | {kind:"pass"}).state`; `placeFirstBase` via **`placeFirstBase(state, player, hex)`** — a placement is **NOT** an engine `Action` (`Action = build|attack|pass`), so it MUST route through `placeFirstBase`, not `applyAction` (codex P1); `attack` returns the input state UNCHANGED + `{combat:true}` (NEVER pre-resolves the draw); `endRound`/`resolveDecision`/`extendDecision` return the input state unchanged (no preview). Assert: a build preview shows the new factory + decremented budget; a placement preview shows the new base; an attack preview leaves `state.rngState` and `state.bases` identical. Run → FAIL.
- [ ] **Step 2: Implement.** **Step 3:** PASS — explicitly assert the attack path consumes no RNG (`rngState` identical). **Step 4: Commit.** **Apply the Execution Discipline block.**

> **Decision #6 / G1 (load-bearing):** preview MUST NOT call `applyAction` on an attack for display — that consumes RNG and computes a local outcome that may diverge from the authoritative draw. Attacks show `config.combatTable[commitment]` odds; the real result arrives via the authoritative `applied` event's `GameEvent`s (P3.9 choreography).

### Task P3.4: Build composer (component — structure-tested)

**Files:** Create `web/src/composers/BuildComposer.tsx`

Piece-type commit (factory | base), a **budget meter** from `buildBudget(state, player)` (`budgetOf` selector, P1.2), bootstrap explained via **`isBootstrapOnly(state, player)`** (the barrel addition, decision #9 — show "first build must be a factory" when true; **do NOT reimplement the GEO-7 `baseCount===1` gate client-side**), legal build hexes highlighted (P1.5 — already excludes base builds in bootstrap), optimistic preview (P3.3) as pieces are placed, a **Commit** action → `driver.submit({type:"build", pieces})`.

- [ ] **Step 1: Failing structure tests** (jsdom, against the fake driver + a fixed state): renders the budget meter with the right remaining budget; in bootstrap state the base option is disabled + the bootstrap explanation shows; placing a factory updates the preview (board reflects it); Commit submits the `build` command. Run → FAIL. **Step 2: Implement.** **Step 3:** PASS. **Step 4: Commit.** **Apply the Execution Discipline block.**

### Task P3.5: Attack composer (component — structure-tested)

**Files:** Create `web/src/composers/AttackComposer.tsx`

Flow: select target (legal targets highlighted) → select attackers (3–6 fresh in-range bases) → commitment pips/slider (Radix slider) → **public odds shown before the draw** (`config.combatTable[commitment]` → 75/83/89/auto) → Commit → `driver.submit({type:"attack", decl})`. The `decl.defender` field is a PROPOSAL (`representativeDefender(state, target, defenderOwner)` as the default; the server/reducer substitutes a human defender's choice via the prompt). NO local combat resolution.

> **No-eligible-defender targets are unattackable (DER #4 / `representativeDefender` returns `Hex | null`):** `AttackDecl.defender` is `Hex` (non-nullable), and `representativeDefender` returns **`null`** when a target has no fresh in-range defender. Such targets are **not legal** — `legalActions` does not emit an attack for them, so the P1.5 `attackTargets` highlight already excludes them; the composer **greys them out with the reason** (spec §3) and never reaches Commit with a `null` proposal. Defense in depth: if a selected target's `representativeDefender` is `null`, block Commit + show the DER #4 explanation — do NOT submit `defender: null`.

- [ ] **Step 1: Failing structure tests**: selecting a target highlights eligible attackers; the commitment slider 3→4→5→6 updates the displayed odds to 75%→83%→89%→auto (read from `combatTable`, not hardcoded); Commit submits the `attack` decl with the chosen target/attackers/commitment + the default `representativeDefender` proposal; the composer never mutates board state on Commit (awaits `applied`). Run → FAIL. **Step 2: Implement.** **Step 3:** PASS — assert odds come from `state.config.combatTable` (change the config's `combatTable` in a fixture and assert the display follows). **Step 4: Commit.** **Apply the Execution Discipline block.**

> **Honest tension (PRODUCT.md #5):** the real odds are always visible in the mono face before the draw; the composer shows truth, not drama. Commitment 6 reads "auto" (DER #8 — `combatTable[6]===1`).

### Task P3.6: Defender prompt + chain-continue + forced-pass (components — structure-tested)

**Files:** Create `web/src/composers/DefenderPrompt.tsx`, `ChainContinuePrompt.tsx`, `ForcedPassNotice.tsx`

- **DefenderPrompt:** shown when `pending` targets a seat this client controls; renders the `eligibleDefenders` (reducer-provided — the client renders, never derives) as choices on the board + a one-line rule explanation; choosing → `driver.submit({type:"resolveDecision", decisionId, defender})`. When `pending.deadlineEpochMs != null` (Phase-2 rooms), shows a countdown + an **"I'm still thinking"** button → `extendDecision`. Locally (timeout off) no countdown.
- **ChainContinuePrompt:** after an attack lands and ≥3 fresh in-range attackers remain + a legal attack exists, offers "attack again" vs a **"done attacking"** button → `driver.submit({type:"endRound"})`. (The reducer auto-closes when <3 remain / no legal attack — the prompt reflects that.)
- **ForcedPassNotice:** when the only legal action is pass (`legalActions` yields only pass / `!config.allowPass` forced-pass detection), shows the auto-notice + rule one-liner (DER #5).

- [ ] **Step 1: Failing structure tests** (fake driver): a prompt for a controllable seat renders the eligible defenders + rule line; selecting submits `resolveDecision`; a non-controllable-seat prompt does NOT show choices (waiting state); `deadlineEpochMs` set → countdown + extend button (→ `extendDecision`); chain-continue "done" submits `endRound`; forced-pass shows the notice. Run → FAIL. **Step 2: Implement** (Radix dialog/popover for the prompt; rule one-liners from `error-explanations`/DER text). **Step 3:** PASS. **Step 4: Commit.** **Apply the Execution Discipline block.**

### Task P3.7: Setup placement + turn-order ceremony (components — structure-tested)

**Files:** Create `web/src/composers/SetupPlacement.tsx`, `TurnOrderCeremony.tsx`

- **SetupPlacement:** when `state.phase.turn===0` and it's a controllable human's placement slot, highlights `placementHexes` (P1.5, from `legalFirstBaseHexes`) and a click → `driver.submit({type:"placeFirstBase", hex})`. Shows the drawn placement order + whose turn (DER #6: free choice on the outer ring).
- **TurnOrderCeremony:** on a `turnRollover` driver event, animates the new `order`; at 2 players shows the **iron weighting** (`ironWeights` from the event — DER #12) with reduced-motion alternative. **Note:** the store's authoritative state already holds the new order (folded via `applyEntry`→`advanceRound`); `turnRollover` drives the **ceremony display only** and carries the `ironWeights` that `applyEntry` does not expose — do NOT treat `turnRollover` as the source of truth for game state.

- [ ] **Step 1: Failing structure tests** (fake driver): in setup, a controllable seat sees highlighted outer-ring hexes; clicking submits `placeFirstBase`; after the last placement the ceremony shows turn-1 order; a 2P `turnRollover` with `ironWeights` renders the weighting. Run → FAIL. **Step 2: Implement.** **Step 3:** PASS. **Step 4: Commit.** **Apply the Execution Discipline block.**

### Task P3.8: HUD panels (components — structure-tested; reuses P2.7's `EventLog`/`event-copy`)

**Files:** Create `web/src/hud/Hud.tsx`, `ResourcePanel.tsx`, `FactoryGauge.tsx`, `TurnOrderTokens.tsx`. **Reuse** `web/src/hud/EventLog.tsx` + `event-copy.ts` (built in **P2.7** — do NOT re-create them).

- [ ] **Step 1: Failing structure tests:** `ResourcePanel` shows per-player resources from `controlOf` (iron/factories/bases, shape-tagged identity); `FactoryGauge` shows `factoriesPlaced(state)`/36; `TurnOrderTokens` shows `phase.order` shape-tagged; `Hud` composes them + the reused `EventLog` in the right rail. Structure tests against a fixed state. Run → FAIL. **Step 2: Implement.** **Step 3:** PASS. **Step 4: Commit.** **Apply the Execution Discipline block.**

> **Cross-task dependency:** `EventLog.tsx` + `event-copy.ts` are **P2.7-owned, P3.8-consumed**. If P2.7 has not completed (out-of-order execution), build them per the P2.7 spec first.

### Task P3.9: Choreography — combat / elimination / victory (components — structure + reduced-motion)

**Files:** Create `web/src/game/choreography/CombatReveal.tsx`, `Elimination.tsx`, `Victory.tsx`

Earned choreography (DESIGN.md): combat reveal (driven by the authoritative `combat` `GameEvent` — committed count + `attackerWon`, honest numbers in mono), elimination (cause + bounty), victory (coalition-aware — `gameOver.winners` may be plural). **Every set piece has a `prefers-reduced-motion` alternative** (instant state + a static summary).

- [ ] **Step 1: Failing structure tests**: a `combat` event renders the reveal with the real committed count + outcome; reduced-motion (mock `matchMedia`) renders the static alternative (no animation classes); a plural-winners `gameOver` renders a coalition victory. Run → FAIL. **Step 2: Implement** (animations gated behind `motion.ts` + reduced-motion). **Step 3:** PASS. **Step 4:** browser smoke of each set piece. **Step 5: Commit.** **Apply the Execution Discipline block.**

> **Drama is earned, never ambient (PRODUCT.md/DESIGN.md):** choreography fires only on combat/elimination/victory; 150–250ms feedback elsewhere. The real numbers stay visible during the drama (honest tension).

### Task P3.10: LocalReducerDriver — ⏸ GATED ON DO-host Part A

**Execution Status:** ⏸ DEFERRED pending the DO-host plan's **Part A** (the pure `src/session` interactive reducer — `openSession`/`applyCommand`/agent-drive + `src/session/agent-binding.ts`) shipping. See `docs/plans/2026-06-29-do-host-wire-protocol-plan.md` Phase A1–A6 Execution Status banners. Follow-up dispatch verifies by reading that plan's Part A banner (✅ SHIPPED), not by grepping.

**Files:** Create `web/src/game/local-reducer-driver.ts` (+ test)

`makeLocalReducerDriver(header)` implements `GameDriver` by wrapping Part A's reducer **in-browser** (pure TS, no DO/network): hold the reducer `SessionState`; `submit(cmd)` maps `DriverCommand → ` the reducer's command shape, calls `applyCommand(state, command, agentForSeat)`, and translates the returned `Effects` → `DriverEvent`s (`effects.broadcast` → `applied`/`turnRollover`/`gameOver`; `effects.toSeat` → `prompt`; `effects.reply` error → `rejected`); ignores `persist`/`alarm` (no storage/timeout locally — defender timeout OFF). After a human command, the reducer's agent-drive advances agent seats (emitting `applied` per entry). `controllableSeats()` = all human seats (hotseat). **Loaded via dynamic `import()`** (pulls `src/agent` via `agent-binding` → its own lazy chunk).

> **Part-A-API assumption to VERIFY at execution (R4):** this driver assumes Part A's `Effects.broadcast` emits a `turnRollover` carrying `ironWeights` (DO-host A6.3) — `applyEntry`/`advanceRound` alone do NOT expose iron weights, so the ceremony depends on the reducer surfacing them. When Part A ships, confirm the exact `Effects` broadcast shape (read the shipped `src/session` reducer) and adapt the mapping rather than assuming it. The `TurnOrderCeremony` (P3.7) degrades gracefully (order-only, no weights) if `ironWeights` is absent.

- [ ] **Step 1 (when Part A ships): Failing test** — drive a real 2-human hotseat through setup → a build round → an attack with a human defender (prompt → resolveDecision) → end; assert the `DriverEvent` stream matches the reducer's `Effects` (a real, non-tautological check against the reducer). Add a human-vs-greedy game asserting agent-drive emits agent `applied` events. Seed fixed. Run → FAIL.
- [ ] **Step 2: Implement** against Part A's documented API (DO-host A2/A3/A4 signatures + the `Effects` contract). **Step 3:** PASS. **Step 4:** `bun run build:client && check:bundle` — confirm agents are in the LocalReducerDriver lazy chunk, NOT the entry chunk. **Step 5: Commit** (`## Merge classification: Routine` unless it needs a reducer-surface change). **Apply the Execution Discipline block** (incl. assertion-rigor — concurrency/agent-drive).

> **Why this driver and not a hotseat-on-`applyEntry` driver (decision #5 / G10):** the round state machine (one-action-per-round, attack-chain auto-close, `status()`-once, per-decl composition) is the reducer's job — reimplementing it here would duplicate Part A and risk drift. The DO-host plan explicitly designed Part A to back this client-local sandbox.

### Task P3.11: Game screen — assemble board + composers + HUD + driver/store (component)

**Files:** Create `web/src/app/GameScreen.tsx`

Wires it together: a `GameDriver` (fake in tests; LocalReducerDriver in the running app once P3.10 ships) → `connectDriver(store)` → renders `Board` (P1) with composer-driven `highlights`/`selection`/`onHexClick`, the contextual composer (Build/Attack/Defender/ChainContinue/ForcedPass/SetupPlacement chosen by phase + `currentPlayer ∈ controllableSeats`), the right-rail HUD + event log, the turn-order ceremony, and choreography. Composers appear **contextually next to the board**, never as permanent panels (UI brief §5).

- [ ] **Step 1: Failing integration-ish structure test** (fake driver scripted through a short game): setup placement → build → attack → the right composer shows at each phase; the HUD/event log update on `applied`; a defender prompt surfaces for a controllable seat. Run → FAIL. **Step 2: Implement** the orchestration (which composer for the current phase/state). **Step 3:** PASS. **Step 4: Commit.** **Apply the Execution Discipline block.**

### Phase P3 close-out

- [ ] **Browser verification (fake driver path):** a scripted/fake-driven game exercises every key state (setup, build, attack+odds, defender prompt, chain-continue, forced-pass, combat reveal, elimination, victory, turn-order ceremony) with reduced-motion toggled. Screenshot set for the PR.
- [ ] **LocalReducerDriver gate:** if Part A has shipped, complete P3.10 + a real end-to-end hotseat in the browser; else leave P3.10 ⏸ with the banner pointing at the DO-host Part A status, and ship P3.1–P3.9 + P3.11 (fake-driver-validated) as the phase deliverable.
- [ ] **Phase review (≥3 perspectives):** (1) authoritative-state rule held (fold-`applyEntry` + replace-on-`sync`; preview never authoritative, never combat); (2) a11y — composers/prompts keyboard-reachable (Radix), board decisions reachable via the legal-action path (G4); (3) bundle discipline — agents only in the LocalReducerDriver lazy chunk. Update banner + table; record Deviations/Discoveries.

---

# PHASE P4 — SocketDriver / live play

**Execution Status:** ⏸ DEFERRED pending the DO-host plan's **Part B** (the `GameRoom` Durable Object + Worker + a staging-validated deploy) AND **`src/wire`** (Part A1) shipping. See `docs/plans/2026-06-29-do-host-wire-protocol-plan.md` Part B Execution Status. Follow-up dispatch verifies by reading that plan's Part B banner (✅ SHIPPED + staging Worker), not by grepping.

The transport swap: a `SocketDriver` implementing the **same `GameDriver` contract** P3 already builds against, over a WebSocket to the DO, mapping `DriverCommand ↔ ClientCommand` and `ServerMessage ↔ DriverEvent`. **This is the ONLY module that imports `src/wire`** (value-imports the codecs; loaded via dynamic `import()`). **Session-management → every P4 PR is `Review — socket-auth / session management` (Sam merges); never pre-authorized.**

> **Why P4 is a swap, not a rework:** the `GameDriver` contract was shaped against these exact semantics from day one (async submit, `sync`-replaces-state, `rejected`, server-pushed `prompt`/roster). P0–P3 already handle them via the fake + reducer drivers. P4 implements the transport.

### Task P4.1: Command/event mapping seam (logic — TDD)

**Files:** Create `web/src/game/wire-map.ts` (+ test) — the single typed seam between client domain types and `src/wire`

- [ ] **Step 1: Failing test** — `toClientCommand(cmd: DriverCommand, logLength: number): ClientCommand` stamps `expectedLogIndex = logLength` on mutating commands (`placeFirstBase`/`build`/`attack`/`endRound`/`pass`/`resolveDecision`), carries `decisionId` on `resolveDecision`/`extendDecision`, and never invents transport the client shouldn't send; `toDriverEvent(msg: ServerMessage): DriverEvent` maps `applied→applied` (decode `EncodedLogEntry` via the session codec), `resync→sync` (decode `EncodedState` via `src/wire` `decodeState`; `EncodedPending→DriverPending`), `error→rejected` (map `WireErrorCode→DriverErrorCode`), `reload→connection:"reload-required"`, `prompt→prompt`, `turnRollover→turnRollover`, `gameOver→gameOver`. Assert each mapping on fixtures; assert the `WireErrorCode→DriverErrorCode` map is **total** over `WIRE_ERROR_CODES`. Run → FAIL.
- [ ] **Step 2: Implement** the bidirectional map (the drift guard — one test pins it). **Step 3:** PASS. **Step 4: Commit** (`Review` — touches the wire contract surface). **Apply the Execution Discipline block.**

### Task P4.2: SocketDriver — connect, claim, keepalive, handshake (logic — TDD with a fake WebSocket)

**Files:** Create `web/src/game/socket-driver.ts` (+ test, using an injected `WebSocket` factory so it's testable without a network — testing-pitfalls §7 "mock only the boundary")

- [ ] **Step 1: Failing test** (injected fake socket) — the driver opens the socket at **`GET /api/games/:id/ws?seat=N&token=<seatToken>`** (the seat token rides as a **query param** — browser `WebSocket` cannot set request headers; DO-host B2.2); on connect it sends `hello{protocolVersion, replayVersion}`; on `open` it sends `claimSeat{requestId, seat}` (a roster ack — the socket already authenticated at the upgrade; no raw token in the message) and starts an app-level keepalive (`ws.send("ping")` on a fake-timer ~25s interval — assert the send fires on tick); a server `reload` → emits `connection:"reload-required"` (does NOT auto-`location.reload` in the unit — that side effect is wired in P4.5 with the loop guard); `submit` maps via `wire-map` and sends the `ClientCommand`; incoming `ServerMessage`s are mapped to `DriverEvent`s and pushed to subscribers. Use **fake timers** for the keepalive (deterministic — no real 25s wait). Run → FAIL.
- [ ] **Step 2: Implement.** Version constants: `PROTOCOL_VERSION` from `src/wire/protocol`; **`REPLAY_VERSION`** (the exact symbol — DO-host B1.3 exports `export const REPLAY_VERSION`/`AGENT_VERSION`) from `src/host/version.ts`, which that plan documents as **plain browser-safe string constants** (no Worker-API usage — typechecks under either tsconfig), so the client may import it directly (the one `src/host` import the client makes; constant-only). `hello.replayVersion = REPLAY_VERSION`. `controllableSeats()` = the claimed seat(s). **Step 3:** PASS. **Step 4: Commit** (`Review`). **Apply the Execution Discipline block** (incl. assertion-rigor — timing/keepalive: use fake timers + observable sends, never `sleep`).

### Task P4.3: Reconnect + resync + optimistic-concurrency (logic — TDD)

**Files:** Modify `web/src/game/socket-driver.ts` (+ tests)

- [ ] **Step 1: Failing test** — on socket `close` the driver emits `connection:"reconnecting"` and reconnects with backoff (fake timers); on reconnect it sends a `resync` request; the server's `resync` → `sync` event (store replaces state); a `rejected{STALE_INDEX, currentLogIndex}` → the driver requests a resync (assert) and the store recovers; the driver tracks `logLength` from `applied`/`sync` and stamps `expectedLogIndex` correctly across a reconnect. Run → FAIL.
- [ ] **Step 2: Implement** the reconnect/backoff + resync + index tracking. **Step 3:** PASS. **Step 4: Commit** (`Review`). **Apply the Execution Discipline block** (assertion-rigor — reconnect races: synchronize on observable driver events/fake-timer ticks, never weaken).

> **Spec §3 (resync is authoritative):** optimistic preview is advisory and never applied to authoritative state; the resync snapshot is ground truth. A lost-ack retry is rejected by `expectedLogIndex` (mismatch-and-resync), not double-applied.

### Task P4.4: Version-mismatch hard reload + loop guard (logic — TDD)

**Files:** Create `web/src/game/reload-guard.ts` (+ test); wire into P4.5

- [ ] **Step 1: Failing test** — `handleReload(reloadFn, store)` calls `reloadFn` (injected — not the real `location.reload`) at most once and sets a session marker so a second `reload-required` within the same load does NOT loop (cached-assets-vs-redeployed-DO: after one reload, content-hashed Workers static assets are fresh; a second immediate reload signals a deeper mismatch → surface a friendly "please refresh" notice instead of looping). Assert single-reload + the loop guard. Run → FAIL.
- [ ] **Step 2: Implement** (a `sessionStorage` marker guards the loop). **Step 3:** PASS. **Step 4: Commit** (`Review`). **Apply the Execution Discipline block.**

### Task P4.5: Live game wiring — room create/connect + GameScreen integration (component — gated on Part B)

**Files:** Create `web/src/game/rooms.ts` (POST `/api/games` create → `{roomId, seatTokens}`; the share link IS the room capability — Phase-1 issues all tokens to the creator), modify `web/src/app/GameScreen.tsx` / routing to use a `SocketDriver` for live games

- [ ] **Step 1: Failing test** — `createRoom(req: CreateRoomRequest, fetchFn)` POSTs `/api/games` with the **designer-instrument config** `{ seats, config, boardSource, seed, roomOptions }` — **NOT** a `SessionRecord`/header. The host validates this body as **untrusted** and **stamps `formatVersion`/`replayVersion` itself** (the client must NOT send trusted versions — DO-host plan B2.2, line ~1525). It returns `{roomId, seatTokens}` (injected `fetch`). The live `GameScreen` opens a `SocketDriver` with `{roomId, seat, token}` (token from `seatTokens`) and connects (injected socket). Assert the POST body carries exactly the designer config (no client-supplied `formatVersion`/`replayVersion`) + that the GameScreen drives the same store/composers as the fake-driver path (the transport swap). Run → FAIL.
- [ ] **Step 2: Implement** (dynamic-`import()` the SocketDriver so `src/wire` stays out of the entry chunk). Wire `reload-guard` to the real `location.reload`. **Step 3:** PASS. **Step 4:** **E2E against the staging Worker** (real WS, real DO — the canonical no-mock test): create a room, claim a seat, play one scripted round. **Step 5: Commit** (`Review`). **Apply the Execution Discipline block.**

> **Join-room UX (cross-device seat claiming via share links) is Phase 2 — NOT in this plan.** Phase 1 issues all seat tokens to the creator; the SocketDriver connects with them. Do NOT build the stranger-opens-a-link join flow here.

### Phase P4 close-out

- [ ] **Gate check:** P4 executes only after the DO-host Part B staging Worker exists. Until then this phase stays ⏸; P0–P3 are the shipped client.
- [ ] **Browser + staging E2E:** a full live game (creator + agents over the DO) plays end-to-end on staging; reconnect (kill the socket) resyncs cleanly; a simulated version bump triggers exactly one reload. Screenshot/recording for the PR.
- [ ] **Phase review (≥3 perspectives):** (1) the transport swap held (no UI rework — same store/composers); (2) session-management correctness (token handling, reconnect/resync, handshake — Review-class, Sam merges); (3) bundle discipline (`src/wire` only in the dynamically-imported SocketDriver). Update banner + table; record Deviations/Discoveries.

---

## Test strategy (consolidated)

- **TDD by code-kind (CLAUDE.md):** logic/state/components under `web/src/**` are red-green-refactor; `vite.config`/`tsconfig`/CI/CSS-tokens/`wrangler.jsonc`/docs are not (they gate on typecheck/build/the CVD-AA gate/the bundle-guard/browser smoke). The engine + `src/wire` + the Part A reducer are already covered by their own suites — this plan does not re-test them; it tests the **client's** logic + the **driver mappings** + **component behavior**.
- **The SVG-in-jsdom split (G3):** geometry/territory/highlight/selectors/store/preview/event-copy/mappings are pure-function or store TDD with concrete inputs; SVG/React components are structure/ARIA-tested in jsdom (DOM nodes, `data-hex`, `aria-*`, event wiring — NOT visual layout); **visual correctness is browser-verified** (dev server / Claude Preview) against real recorded states, with screenshots on each phase PR.
- **Determinism (testing-pitfalls §8):** every randomized fixture passes a fixed seed; replay/frame assertions use **structural state equality + `stateHash`**, never stringified blobs; regime boundaries (resource 1/2/3/4, bases 3↔4, commitment 3/4/5/6, 2P↔3+P order) are tested where the client renders or branches on them.
- **Negative/bounded (testing-pitfalls §4):** untrusted board JSON (empty/oversized/unicode/dup), the virtualized event log under 1000+ events (bounded DOM), the bundle-guard's failure path, the CVD gate's known-bad-palette rejection.
- **Async rigor (testing-pitfalls §5 + the Execution Discipline assertion-rigor block):** drivers/socket/worker/keepalive/reconnect tested with **injected boundaries + fake timers + observable-state assertions** — never `sleep`, never weakened assertions disguised as flake fixes.
- **E2E (no mocks):** the staging-Worker live game (P4.5) is the canonical end-to-end test — real Worker, real WebSocket, real DO.

## Visual system specifics (the brief made concrete)

- **Palette:** OKLCH from the UI-brief candidate hex (P0.3), finalized by the AA+CVD gate (P0.4). The four named rules (Table / Parchment-Belongs-to-the-Board / Brass Budget ≤10% / Cartouche) are utility-class-enforced.
- **Typography trio:** display serif (game moments only — Cartouche Rule), humanist sans (UI work), monospace (numbers/telemetry/odds/seeds). Self-hosted; the serif never appears in labels/inputs/data.
- **Player identity:** color + shape + pattern, 6-set, CVD-verified (P0.5).
- **Motion:** 150–250ms feedback; earned choreography on combat/elimination/victory; **every animation has a `prefers-reduced-motion` alternative** (P3.9).
- **`/impeccable document` (required, P0 close-out):** after the first SPA code lands, run it to replace the `DESIGN.md` seed `[to be resolved]` placeholders with the extracted OKLCH tokens + the component sidecar. The token *values* are design-iteration output (P0.3/P0.4), not pre-specified here.

## Spec / brief coverage map (writing-plans self-review)

| Spec §4 / UI-brief requirement | Task(s) |
|---|---|
| Home/new-game designer instrument (RuleConfig knobs, preset, provenance, board source, seats, seed, fork) | P2.1–P2.4 |
| Game screen — SVG hex board (96–300 hexes) | P1.1, P1.3 |
| Both territory regimes (radius-union + convex-hull, DER #1) + overlap zones | P1.4 |
| Stranded-base marks; fresh/fatigued states | P1.3 |
| CVD-safe player identity (shape/pattern redundancy) | P0.5 |
| Legal-target highlighting from engine hints | P1.5 |
| Build composer (piece-type, budget meter, bootstrap explained) | P3.4 |
| Attack composer (target→attackers→commitment, public odds before the draw) | P3.5 |
| Defender prompt + chain-continue (`endRound`) + forced-pass, with rule one-liners | P3.6 |
| Turn-order draw ceremony (2P iron weighting) from `turnRollover` | P3.7 |
| Setup phase (first-base placement) | P3.7 |
| HUD (per-player resources, 36-factory gauge, turn tokens, eliminations/bounties) | P3.8 |
| Event log narrating `GameEvent`s (virtualized) | P2.7 (built) + P3.8 (reused in HUD) |
| Minimal all-agent viewer (play/pause/step, client-side pure engine) | P2.5–P2.7 |
| Rules-reference (v10 + DER callouts; error-code → rule explanations) | P2.8 |
| WebSocket client (connect, `ws.send("ping")` ~25s, reconnect+resync, version-handshake hard-reload, optimistic-never-authoritative) | P4.1–P4.5 |
| State management | P3.2 |
| Bundle architecture (agent-free core + code-split agents) | P0.2, P2.6, P3.10 |
| Visual system (palette/typography/motion + CVD/AA + `/impeccable document`) | P0.3–P0.5, P3.9, P0 close-out |
| Choreography (combat/elimination/victory + reduced-motion) | P3.9 |
| Shared-config edits (Vite/React deps, SPA test project, CI job, `dist/client`/wrangler coordination) | P0.1 |

## Review record

- **Brainstorm (2026-06-29):** resolved the three architecture forks (front-load no-DO parts; all-agent viewer = generate+step code-split; custom SVG + Radix headless chrome) + asserted the Section-7 defaults (breakpoints, defender-timeout-via-wire-field, CVD shape gate, no alliance seams, `/impeccable document`).
- **Self-review round 1 (F1–F7):** `GameDriver` shaped against wire semantics (F1); client-owned driver types + SocketDriver mapping seam (F2); `eligibleDefenders` is reducer-provided not client-computed (F3, → zero barrel additions); front-load boundary named (F4); `control()` memoized on state identity (F5); generation off-main-thread in a Web Worker (F6); coordination notes (F7). Corrected: combat odds live in `config` (no barrel addition).
- **Self-review round 2 (G1–G10):** dropped the hotseat-on-`applyEntry` driver — interactive play routes through Part A's reducer (G10, the largest change; moves "hotseat-local" to gate on Part A); optimistic preview is deterministic-only, never combat (G1); SVG test-split strategy (G3); board a11y via the legal-action path (G4); untrusted board-JSON validation (G6); concrete bundle-guard mechanism (G7); event-copy boil-the-lake (G9). Dissolved: turnRollover synthesis (reducer emits it), version-reload (content-hashed assets + loop guard).
- **plan-review-cycle (per `/writing-plans-enhanced` Step 4):**
  - **Round 1 (runner, 8 findings):** vitest-bump ownership (don't unilaterally bump — DO-host owns it); `wrangler.jsonc` reduced to coordination-only (no collision); `bun.lock`/frozen-lockfile; `strandedHexes` board prop; context paths (rules-v10, DER sources, archetypes); **EventLog/event-copy moved to P2.7** (fixed a backward dependency from P3.8); untrusted imported-record validation; turnRollover-vs-state clarification.
  - **Round 2 (codex `gpt-5`-class, cross-model, 7 P1 + 3 P2):** the manifest-based **bundle guard was unreliable** → switched to a `generateBundle` Rollup plugin inspecting `chunk.modules`; **`strandedBases` is not barrel-exported and has no `GameEvent`** → one barrel addition + a selector (corrects R1/F3's "zero barrel additions"); **fake driver must be strictly scripted** (can't `applyEntry` a `DriverCommand`); **store needs a log-index continuity guard** (out-of-order/duplicate → resync); **optimistic preview placement** must use `placeFirstBase`, not `applyAction` (placement is not an `Action`); **create-room POSTs designer config**, not a `SessionRecord` (host stamps versions); `initGame({seed,boardSource,nPlayers,config})` signature; `REPLAY_VERSION` symbol + browser-safe import; GEO-8 added to the pitfall checklist. _Codex confirmed as non-issues: the GameDriver seam, combat-odds-via-config, reducer-provided eligibleDefenders, deterministic-only preview, structured-clone of bigint through a module Worker._
  - **Round 3 (runner, 3 second-order):** `strandedBases` barrel addition + `strandedHexKeys` selector given an explicit home in P1.2; guard-plugin file added to the file-structure table; this review record.
  - **Round 4 (independent cold-read subagent, 4 P1 + 4 P2):** it verified every named engine/session/wire symbol against the shipped code + the DO-host plan and confirmed all R2 fixes clean. New: **store carried `protocol/replayVersion` with no `DriverEvent` source** → versions are build constants, SocketDriver-internal, dropped from the store; **`isBootstrapOnly` is not barrel-exported** → second barrel addition (avoids a GEO-7-prone client reimplementation); **`representativeDefender` returns `Hex | null`** → AttackComposer greys out no-eligible-defender targets (DER #4), never submits `defender: null`; **`HighlightSets` forward-ref** → the type is now created in P1.3, the function added in P1.5; plus `budgetOf` in P1.2, the line-145 barrel-claim tightened, the P3.10 `turnRollover` Part-A assumption flagged, and the P2.5 frame-count convention pinned (`log.length + 1`).
  - **Round 5 (runner, 0 findings):** verified the R4 fixes introduced no contradictions (no dangling store-version refs; barrel count consistent at two; `isBootstrapOnly`/`HighlightSets` threaded). **Cycle complete — terminated at a zero-finding round per `/plan-review-cycle`.**
