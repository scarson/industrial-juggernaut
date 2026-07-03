# DO-Host + Wire-Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Industrial Juggernaut multi-actor games playable online by building the interactive session layer (spec §3): a pure `GameSession` reducer, a thin `GameRoom` Durable Object host, the Worker shell + `wrangler.jsonc`, and the staging-deploy pipeline.

**Architecture:** Two layers, one plan, merged incrementally. **Part A** is a pure, plain-vitest `GameSession` reducer (`src/session`, `src/wire`) that turns a client command + the acting seat into `{ nextState, effects }` — owning the round state machine, `expectedLogIndex` optimistic concurrency, durable pending defender decisions, seat-claim CAS, agent-drive (through an **injected** `agentForSeat`), and resync-payload construction. It performs no I/O. **Part B** is a thin `GameRoom` Durable Object (`src/host`) that *performs* the reducer's effects: SQLite-backed KV storage with one atomic multi-key `put`, the `validate → apply → await storage.put → broadcast` critical section, WebSocket Hibernation, recovery (snapshot + log tail), and an opt-in defender-timeout alarm — plus the Worker shell, `wrangler.jsonc`, `@cloudflare/vitest-pool-workers` tests, and `deploy-staging.yml`.

**Tech Stack:** TypeScript (ESM, `strict`), Cloudflare Workers + Durable Objects (SQLite storage class via the KV `storage.put/get` API, WebSocket Hibernation API, one storage alarm), `wrangler` (already a devDependency), `@cloudflare/vitest-pool-workers`, `vitest`, `bun` (local dev/test), Node (CI). Consumes the shipped pure engine barrel `src/index.ts` and the session core `src/session` (`applyEntry`, `recordGame`, `replayLog`, validation predicates, codec, hash).

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

**Overall:** PART A FULLY MERGED to dev 2026-07-02 (PRs #35, #36, #37, #40, #43, #42 — #43 supersedes the auto-closed #41). Part B started 2026-07-02.

| Phase | Status | Ship SHA(s) | Notes |
|---|---|---|---|
| A1 — Wire protocol types + codecs | ✅ Merged | cf57bbea, 08557106, a9a758c0 → merge 251a5af0 | PR #35 (Routine, auto-merged on green `check`) |
| A2 — Reducer skeleton + agent-drive seam | ✅ Merged | fa0b32af…3414c6a5 → merge 28c5759e | PR #36 (Routine, auto-merged); see Deviations (A2.3, A2.4) |
| A3 — Command processing / round state machine | ✅ Merged | 9d56776d…73a3212c → merge a8cbb5e2 | PR #37 (Routine, auto-merged); see Deviations (A3, A3.2) + Discoveries (setup guard) |
| A4 — Pending decisions + write-lock | ✅ Merged | 13 commits → merge 86a0f7d5 | PR #40 (Review, Sam-authorized merge); see Deviations (A4) + Discoveries |
| A5 — Seat-claim CAS + multi-tab | ✅ Merged | incl. backstop + seatClaimed broadcast → merge 0eb97adf | PR #43 (Review, Sam-authorized; supersedes #41, auto-closed by the base-branch deletion — see the stacked-PR trap memory) |
| A6 — Resync, handshake, events, malformed-traffic shapes | ✅ Merged | incl. the mid-setup gameOver fix 519c1cb3 → merge 61f7132a | PR #42 (Routine, auto-merged post-rebase) |
| B1 — Shared-config scaffolding | ✅ Shipped | 9dd81593, 01f5e252, e4126b6e, f5ac197c, c95ad8cb | branch `feat/host-config`; **PR pending — Review-class, Sam merges**; vitest 4.1.9 across 1970 tests (2 migration points); safe-before-B8 verified |
| B2 — Worker shell + room addressing | ✅ Shipped | c1f2de5f, 7ac0e334, a1de3906 | branch `feat/host-worker` stacked on PR #44; **PR pending — Review-class, Sam merges**; first deployable Worker (dry-run passes); adversarial hardening round (5 exploit classes killed) |
| B3 — GameRoom DO: storage + critical section + recovery | ✅ Shipped | ccd9d54c, 73d9e09f, 299b3eed, cf12da9f | branch `feat/host-gameroom` stacked on PR #45; **PR pending — Review-class, Sam merges**; flagship op-order test + crash-consistency gate (freeze-path throw variants fixed) |
| B4 — Hibernation | ⬜ Not started | — | — |
| B5 — Defender-timeout alarm (opt-in) | ⬜ Not started | — | — |
| B6 — Socket attribution + malformed-traffic enforcement | ⬜ Not started | — | — |
| B7 — vitest-pool-workers DO test suite | ⬜ Not started | — | — |
| B8 — deploy-staging.yml + version guards + CI pool job | ⬜ Not started | — | — |
| B9 — DO/wire pitfalls documentation | ⬜ Not started | — | — |

### Deviations
- **A4 (2026-07-02): three items.** (1) `extendDefender` returns a `{ next, effects } | { error }` union (mirrors `resolveDefender`) so it can internally re-validate the prompted seat — the plan's defense-in-depth mandate; the command layer validates too (two genuine layers). (2) `extendDefender` no-ops (`NO_EFFECTS`) in a timeout-OFF room — plan gap found in review (an unconditional re-arm would stamp a deadline onto a null-deadline pending in the default config). (3) A4.5 uses fixed-seed for-loops over `[1n,2n,3n,7n,11n]` per mix rather than the plan's illustrative `fc.property` pattern — same coverage intent, deterministic, runtime-bounded.
- **A3 (2026-07-02): per-plan confirmations + additive wire-catalog growth.** `endRound` deferred to A4 as the plan's A3.4 mandates (no A3 handler; routes to the default). `resyncPayload` introduced early in A3.1 with the locked 3-arg signature (per the plan's own note; A6 fills the seat-filtered pending). **Seven additive WIRE_ERROR_CODES entries** (not in the plan's reviewed catalog): `BUILD_EMPTY`, `BUILD_BOOTSTRAP_FACTORY_ONLY`, `BUILD_OVER_BUDGET`, `BUILD_ILLEGAL_FACTORY`, `BUILD_NO_BASES_IN_HAND`, `BUILD_ILLEGAL_BASE` (one per client-explainable apply-time build failure — the plan said "catch and map to a structured error" without naming codes) + `SETUP_PLACEMENT_REQUIRED` (the setup-guard fix, see Discoveries). Additive only; no existing code renamed/removed; `formatVersion`/`SessionRecord`/`LogEntry` untouched.
- **A3.2 (2026-07-02): unknown-throw policy decided (plan gap) — unrecognized throws inside command handlers RETHROW; they never map to a wire error.** The plan enumerates the known engine validation messages per handler but is silent on unrecognized throws. Decision: known validation messages → structured codes (the teaching surface); anything else is a reducer/engine bug and propagates loudly to the host (the DO discard-and-restart model handles it). `MALFORMED` stays reserved for transport-layer malformed traffic per the WIRE_ERROR_CODES catalog grouping. Applies to all A3/A4 handlers. **Flagged for Sam's veto in the Phase A3 PR.**
- **A2.4 (2026-07-02): two deviations from the plan's `agent-drive.ts` code block.** (1) The unused `encodeState` import was removed (pre-authorized by the plan's own note; only `encodeEntry` is used). (2) The plan's `if (terminal)` guard is `if (terminal !== null && terminal.kind === "victory")` in code — the plan's snippet would not typecheck because `applyEntry.terminal` carries the full `Status | null` union while `.players`/`.reason` are victory-only. Runtime-identical (round.ts only ever assigns a victory status to `terminal`); the plan snippet was wrong, the code is right.
- **A2.3 (2026-07-02): `src/session/record.ts` DRY-refactored** to import `agentForSeat` from the new `src/session/agent-binding.ts`, deleting its inline copy (the plan's optional Step 4, taken per the duplication rule). Semantics preserved (verified against `git show 80489f96:src/session/record.ts`; the human-seat throw message is now `agentForSeat: a human seat has no agent`, still matching record.test.ts's `/human seat/i`). record.ts net −10/+2; no other restructuring.

### Discoveries
- **⚠️ B3/B7 obligation (B2 hardening round, 2026-07-02): the failing-init path is untestable pre-B3 and MUST be covered once real init exists** — `worker.ts`'s create flow now returns 500 (and hands out NO tokens) when the DO init responds non-ok/non-501, but the B2 stub can only answer 501, so the 500 path has no test yet. B3/B7 MUST add: a failing DO init (storage error) → create returns 500, no `{roomId, seatTokens}` leak. Also B3 removes the now-dead 501 tolerance (the contract comment in worker.ts marks it).
- **`seatClaimed` broadcasts on the claim transition (Sam-directed, PR #41 review, 2026-07-02; commit 7a1906bb).** The protocol has no refresh cycle (resyncs fire only on connect/STALE_INDEX/explicit request), so without a broadcast an idle lobby client never sees a seat fill. Gated on the `claimed` false→true transition (re-acks and multi-tab acks stay quiet). **SPA-plan note:** the claiming socket receives `seatClaimed` TWICE (reply + broadcast) — clients must apply it as idempotent roster state, never count events.
- **Agent-seat auth boundary — RESOLVED (Sam, 2026-07-02), three binding requirements.** As planned, a socket holding an agent seat's token could bind (B6.2 checks only the digest) and send mutating commands on that agent's turn (the envelope checks turn ownership, not seat kind). Resolution, defense in depth: (1) **B2.2 MUST mint seat tokens for HUMAN seats only** (deviation from the plan's "mint for each seat" — no agent-seat capability exists to leak); (2) **the WS upgrade (B6.2/B2) MUST refuse to bind a socket to an agent seat** regardless of token validity; (3) **the reducer envelope rejects mutating commands from an agent-kind acting seat** (NOT_YOUR_TURN, "Agent seats are host-driven" — shipped on the A5 branch; `driveOneStep` bypasses `applyCommand`, so host-side agent drive is unaffected). Layers 1–2 land in Part B; layer 3 is the reducer backstop.
- **~~⚠️ B3 no-gameOver-broadcast obligation~~ RESOLVED AT THE REDUCER LAYER (Sam-directed adversarial re-review of PR #40's attention items, 2026-07-02; commit 519c1cb3 on `feat/session-resync`):** `commitEntries` now detects a setup-placement batch whose post-state is a victory (`status()` check, bounded to placement batches — ≤6 per game; play-phase victories already surface through closing entries) and emits `gameOver` + sets `terminal` itself. The host-layer patch originally planned for B3 was rejected adversarially: it would split gameOver-emission across two layers and a future client-local sandbox reusing the reducer would silently miss it. **B3 needs NO terminal-after-drive special case** — the drive loop's existing `terminal` handling covers mid-setup victories. Also resolved from the same review: the attack handler's `MALFORMED` for no-base-at-target is CONFIRMED correct (a stale client view implies a stale `expectedLogIndex`, and STALE_INDEX fires before the target lookup; a base cannot vanish without a log entry — the reachability argument is now a code comment in session.ts).
- **Mid-setup-victory semantics differ between recordGame and the interactive drive (A4.5, 2026-07-02) — benign, reconciled.** `recordGame` places EVERY seat's first base unconditionally before checking victory; the interactive drive stops the instant `status()` reports victory (in 4p, an iron victory can be decided after 2 of 4 placements). Verified NOT a composition defect: the drive log is a bit-exact PREFIX of recordGame's, the dropped tail is purely `placeFirstBase` entries, and `applyCommand` itself rejects post-victory mutating commands with `GAME_OVER` — so the interactive semantics are self-consistent and the drive is the faithful one for hosted play. The A4.5 cross-check asserts exact-prefix + tail-is-placeFirstBase for this case, full deep-equality otherwise (`test/session/drive-vs-recordgame.test.ts`). **Also (vacuity trap):** default `victoryThreshold: 10` ends all-agent games in 1–2 rounds with ZERO attacks; the cross-check uses `victoryThreshold: 20` headers (shared bit-identically by both sides) to legitimately produce attack-rich games (hundreds of attack entries compared).
- **Synthetic-board test trap (A4.2, 2026-07-02): a synthetic `GameState` with `board.iron: []` gets both players silently ELIMINATED the moment an entry routes through `applyEntry`/`applyEliminations`** — the unconditional `noIron` elimination kills any player with ≥1 base and zero controlled iron, and DER-17 perimeter exclusion can strip a radiating player's iron once hulls grow past the 4-base threshold. Fix pattern (used in `test/session/auto-close.test.ts`): place iron directly ON base hexes (controlled regardless of perimeter mode), and give perimeter players a real 4-base hull where DER-17 matters. Verify combat-outcome robustness across ~10 seeds. A4.3+ tests building post-attack states MUST follow this pattern.
- **A4.1→A4.3 seam (quality review 2026-07-02): `resolveDefender` currently finalizes its atomic put with `[attack]` only** (`src/session/pending.ts` — commitEntries + tombstone merge). The plan's one-atomic-resolution rule requires the human-defender resolution path to land `[attack, endRound-if-auto-close]` + tombstone in ONE put. **A4.3 MUST refactor resolveDefender** to compose the auto-close entry into the same commitEntries call (e.g. compute `autoCloseIfNoAttack` on the post-attack throwaway state inside/around resolveDefender) rather than issuing a second put or duplicating the tombstone merge. Deferred deliberately from A4.1 (auto-close doesn't exist until A4.2).
- **Setup-phase envelope gap (plan gap, found by A3.3 spec review 2026-07-02): nothing rejected play-phase commands during setup, and a well-formed `pass` could CRASH the reducer.** Repro: 3+ player game, ≥2 seats placed (≥2 live coalitions), the current unplaced placer sends `pass` → `legalActions()` returns the stuck-fallback pass-only set → `validatePass` treats it as forced → applyEntry eliminates the passer (noBases) → status ongoing → `advanceRound` throws "cannot advance during the setup phase" uncaught. 2-player tests masked it (setup elimination collapses to victory first). Fix: envelope guard — during `phase.turn === 0` every mutating command except `placeFirstBase` is rejected with the new `SETUP_PLACEMENT_REQUIRED` code (additive catalog entry). The A3.1/A4 guard chain is otherwise unchanged.
- **Generated boards contain `-0` cube coordinates** (found 2026-07-02 while strengthening the A1.2 codec test with a real-JSON round-trip). `JSON.stringify` canonicalizes `-0` → `0`, so a state that crosses the wire differs from the server's in-memory state under `Object.is`-style comparison. Verified **inert** for engine semantics: hex identity is `key()`'s template-literal string (`src/geometry/cube.ts:15`, GEO-4) and `String(-0) === "0"`; numeric comparisons use `===` (`-0 === 0`); `stateHash` canonicalizes through `key()` + template literals. Wire fidelity is therefore asserted via `stateHash` equality (the protocol's own divergence detector), not deep equality. **SPA-plan relevance:** client code must never compare server-decoded state to locally-generated state with `Object.is`-style deep equality (e.g. vitest `toEqual`) — use `stateHash` or key-canonical comparisons.

---

## Context & authoritative sources

- **Authoritative design:** `docs/superpowers/specs/2026-06-12-web-client-design.md` §3 (session model & wire format) is the source of truth for everything here. §5 enumerates the engine work (all shipped). §6 is the gitflow/CI/promote design (the production cutover is a *separate, Sam-gated plan* — see "Deferred / Sam-gated"). §7 is the testing strategy. The Digital Edition Rulings (#1–#17) constrain engine semantics.
- **What this plan consumes (do NOT modify):** the engine barrel `src/index.ts` (agent-free public API) and the session core `src/session/*` (`applyEntry`, `recordGame`, `replayLog`, `stateHash`, the codecs, and the `validatePass`/`validateTargetAttackable`/`validateAttackDecl`/`validateBuildPieces` predicates), shipped in PR #20. This plan *extends* `src/session` with new files and *adds* `src/wire` + `src/host`; it does not rewrite the shipped record/replay core.
- **Import discipline (deep vs barrel):** new files under **`src/session`** follow the EXISTING `src/session` pattern — they may deep-import engine internals (`../engine/legal`, `../geometry/cube`, etc.), exactly as the shipped `validation.ts`/`round.ts` do (they are the session core, not a downstream consumer). New files under **`src/host`** and the wire-importing client consume the PUBLIC barrels (`../index` for engine symbols, `../session/index` for session symbols), NOT deep engine paths — the host is a downstream consumer and the barrel is its contract. `src/wire` is types-only and imports only `import type` (kept light for the client). (Codex P2-17.)
- **Branch flow (the repo docs are STALE on this):** branch off `origin/dev`, PR to `dev`, merge on green `check`. `docs/git-strategy.md` + `CLAUDE.md` + `AGENTS.md` still describe a `main`-only flow — ignore that until the production-cutover plan rewrites them. **Never branch off `main`; never PR to `main`.** Git mechanics: you cannot `git checkout dev` (it's checked out in the main worktree) — cut branches from `origin/dev`; merge with `gh pr merge <N> --merge` then delete the branch manually (`--delete-branch` errors locally). `--force-with-lease` only.
- **bun-only machine:** `bun run test` (vitest), **never `bun test`** (its native runner ignores `vitest.config.ts`). `wrangler` via `bunx`. **Never run `wrangler deploy` locally** — all deploys are from CI.

## Architectural decisions locked with Sam (2026-06-29)

These were resolved in brainstorming; do NOT relitigate them during execution.

1. **One plan, two internal parts** (this document). Part A (pure reducer, plain vitest) lands and merges before Part B (DO host, vitest-pool-workers).
2. **Agent-drive via an injected `agentForSeat`.** The reducer's agent-drive loop takes `agentForSeat: (seat: SeatConfig) => Agent` as a parameter and stays **agent-free** at the module level (unit-testable with a fake agent). A single ~10-line binding (`src/session/agent-binding.ts`) maps `SeatConfig → Agent` using the real greedy/heuristic agents; the DO entrypoint and `recordGame`-style callers import *that*. **The Worker bundle does transitively include `src/agent`** (via the binding) — this is necessary and accepted for DO-hosted vs-agents games. The load-bearing purity guarantees are: (a) `src/index.ts` (engine barrel) stays agent-free so the browser/client bundle never pulls agents; (b) the thin `src/host` glue never *directly* `import`s `src/agent` — it goes through the agent-free reducer + the one binding module. See pitfall **DO-PURITY-1** (added in B9).
3. **Directory naming:** the interactive reducer extends `src/session/`; wire-protocol types live in a dedicated `src/wire/`; the DO + Worker + `wrangler.jsonc` live in `src/host/`.
4. **Defender timeout is OFF by default** and opt-in per room (Sam's redesign). A pending defender decision holds the room's write-lock until the human answers; the liveness recovery for a vanished player is the **room creator handing that seat to an agent** (spec §3 "Stalled acting player"). When a room enables the toggle, the DO arms a resettable alarm (**default interval 120 s** when enabled — Sam, 2026-06-29) and the prompted human gets an **"I'm still thinking"** (`extendDecision`) button that re-arms it; only expiry *without* extension auto-picks `representativeDefender`. The toggle + interval live in a **host-layer `RoomOptions`** record, outside `RuleConfig` and outside the pre-authorized `SessionRecord` shape. Replay is unaffected (the log records the final substituted `AttackDecl` regardless of who chose it). **Spec §3 "Timeouts" paragraph updated to match (Sam approved 2026-06-29).**

## Spec-confirmed scope boundaries (assert; do not expand)

- **Alliances are Phase 3.** The `LogEntry` union is **closed for `formatVersion` 1** — no `allianceOp`, no alliance wire shapes, no alliance UI in this plan (spec §3 "NOT in formatVersion 1").
- **All-agent "watch" is client-side replay-only** and belongs to the *SPA plan* (deliverable 2), not this plan. `recordGame`/`replayLog` already back it; nothing here.
- **Maxed-out capture is destroy-only** (DER #3); no `captureResolution` work here.
- This plan ends at a **staging-validated Worker**. The production cutover (`promote.yml`, `PROMOTE_TOKEN`, `main` protection, default-branch flip, the three doc rewrites, the golden-corpus replay-compat gate, the blocking staging e2e smoke) is a **separate Sam-gated plan**.

## Deferred / Sam-gated (flags, not work in this plan)

- **Production cutover** — the entire §6 promote pipeline. Separate plan; Review-class; Sam merges. **Cannot start until Part B ships a staging-validated Worker.** The admin prerequisites that DON'T need the Worker are broken out step-by-step below.
- **Staging e2e smoke as a *blocking* promotion gate** — defaults to blocking, but its binding decision lives in the cutover plan (where `promote.yml` lives). This plan ships `deploy-staging.yml` (push-to-`dev` → staging deploy) but not the promotion gate.
- **Abuse & identity floor** (rate limiting, Turnstile, room TTL/GC) — Phase 2; never pre-authorized.

### Production cutover — admin prerequisites (verified 2026-06-29; Sam runs these)

Repo verified **public**; `dev`/`main` currently **unprotected**; no rulesets; the required CI check context is **`check`** (the classic `PUT .../branches/{branch}/protection` endpoint is the right API — a personal public repo can't use org-only push `restrictions`, so protection = required checks + `enforce_admins:false`, and the `PROMOTE_TOKEN` admin PAT bypasses to fast-forward `main`).

**Do now (independent of the Worker):**
1. **`dev` branch protection** (protects the active branch; required CI on PRs):
   ```bash
   gh api -X PUT repos/scarson/industrial-juggernaut/branches/dev/protection --input - <<'JSON'
   { "required_status_checks": { "strict": true, "checks": [{ "context": "check" }] },
     "enforce_admins": false, "required_pull_request_reviews": null, "restrictions": null }
   JSON
   ```
   (If the API rejects `checks`, use the legacy `"required_status_checks": {"strict": true, "contexts": ["check"]}`.)
2. **Default-branch flip to `dev`** — `gh repo edit scarson/industrial-juggernaut --default-branch dev`. Fixes the "main-trap" (new PRs default to `dev`). Independent of prod-deploy safety. The three process docs stay stale until the cutover rewrite — so prioritize that rewrite after this flip.

**NOT needed now — and possibly not at all: `PROMOTE_TOKEN`.** The PAT is NOT inherent to dev→main Cloudflare deploys; it is forced ONLY by spec §6's *specific* choice to auto-promote via a **workflow that fast-forwards `dev → protected main`** — which trips (a) `GITHUB_TOKEN` can't push to a protected branch on a personal repo, and (b) a `GITHUB_TOKEN` push doesn't trigger the deploy workflow. **The simpler, common pattern needs no PAT:** a `deploy.yml` on `push: branches: [main]` running `wrangler deploy`, with `dev → main` promotion as a normal PR merge (the merge is the deploy trigger; nothing in a workflow pushes to protected `main`). Sam's `twin-cities-tee-times` project deploys dev→main to Cloudflare this way with no PAT. **Decision deferred to the cutover plan; default to the no-PAT deploy-on-push pattern unless a linear `main == dev` history is explicitly wanted.** Do NOT provision a `PROMOTE_TOKEN` now.

**Comes with the cutover plan (needs the staging Worker + is CODE, not a manual step):** the chosen promote design (`promote.yml` fast-forward+PAT **or** `deploy.yml`-on-push + PR-merge — the latter preferred), `main` branch protection (its shape follows the promote design), prod deploy, the golden-corpus replay-compat gate, the staging e2e smoke, and the `git-strategy.md`/`CLAUDE.md`/`AGENTS.md` rewrites (gated on the cutover plan + Sam's explicit prod-cutover approval — do NOT edit those three before then). That plan lands as ONE Review-class PR. **This supersedes spec §6's PROMOTE_TOKEN/fast-forward assumption — the cutover plan re-decides the promote mechanism (revisit spec §6 there).**

## Merge classification & pre-authorization (per PR)

Every PR body MUST carry a `## Merge classification` heading with exactly one of `Routine — auto-merge on green CI`, `Review — <trigger>`, or `Escalate — <concern>`.

- **Pre-authorized → Routine:** a PR implementing the spec §3 `SessionRecord`/`LogEntry` shapes or the spec §5 enumerated engine items qualifies as Routine **when it cites the spec section and asserts zero shape deviation.** Most Part A reducer/wire PRs that consume the already-shipped session types are Routine.
- **Never pre-authorized → always Review (Sam merges):** **seat-token / seat-claim / join-code / socket-auth code** (A5, and the seat-auth parts of B2/B6) — this is session-management/Domain. The **abuse floor** (Phase 2). Anything that **alters the replay behavior of existing logs** (none here should — flag loudly if a change would).
- **Shared-config PRs** (B1, B8) touch CI/build config: classify `Review — shared build/CI config + first Worker deploy surface` so Sam eyes the `wrangler.jsonc` and CI wiring.
- For Routine PRs you investigate and fix CI failures yourself (≤3 attempts per failure before escalating); you merge your own Routine PR on green.

## Coordination headings (parallel sweep track)

A separate balance-sweep agent owns `src/sweep/*`, `test/sweep/*`, `docs/sweeps/*` (never touched here). Two coordination surfaces with that track:

- **`## Shared-config changes`** — any PR that edits `package.json`, `vitest.config.ts`, `tsconfig*.json`, `.github/workflows/ci.yml`, or `bun.lock` MUST carry this heading listing the exact edits. Edits are **append-only** where possible; the node test glob `test/**/*.test.ts` (which matches the sweep's `test/sweep/*`) MUST be preserved.
- **`## Barrel additions`** — if any task needs an engine symbol not currently exported from `src/index.ts`, add the export on this branch and flag it here. *Expected: none* (the reducer/host consume existing exports — see each task's imports). Any added export MUST NOT pull `src/agent`/`src/driver` into the value graph.

---

## Execution Discipline (apply to EVERY task)

Each task below ends with **"Apply the Execution Discipline block."** That means all of the following. This block is defined once (DRY) and referenced per task; it is mandatory, not optional. Rationale: `/writing-plans-enhanced` Steps 3 & 5.

**BEFORE starting a production-code task** (anything editing `src/`):
1. Invoke `superpowers:test-driven-development`.
2. Read `docs/pitfalls/testing-pitfalls.md` and `docs/pitfalls/implementation-pitfalls.md`.
3. Follow TDD: write a failing test → run it, confirm it fails for the stated reason → write the minimal code → run it, confirm green → refactor while green.

**TDD scope:** Production logic in `src/` (all of Part A; `src/host/**` in Part B) is red-green-refactor. **NOT** TDD: `wrangler.jsonc`, `package.json`, `tsconfig*.json`, `vitest.config.ts`, `.github/workflows/**`, and `docs/**` (B1, B8, B9, and config sub-steps). Those gate on the explicit verification each task names (typecheck/test green; a real deploy; the doc completeness check). Step 2 (read pitfalls) applies to every task.

**BEFORE marking a task complete:**
1. Review the new tests against `docs/pitfalls/testing-pitfalls.md` — every error branch triggered by a test? Error *messages/codes* asserted (not just "it threw")? Regime boundaries (resource counts 1/2/3/4, base counts 3↔4, commitment 3/4/5/6) where relevant? Structural assertions over substring? Seeds fixed on randomized tests?
2. Run `bun run typecheck` and the relevant `bun run test` (Part A) — output MUST be pristine (no stray stderr, no debug prints, no unhandled rejections). For Part B host tests, run the workers pool project (B7 wires the command).
3. Commit with an honest, scoped message (templates inline per task).

**Assertion rigor under pressure (MANDATORY for every concurrency / timing / cross-socket / alarm task — A4, A5, B3, B5, B6, B7):**
> If any test assertion races, flakes, or fails nondeterministically, the fix is **deterministic synchronization** (await the awaited storage write; drive the alarm explicitly via `runDurableObjectAlarm`; sequence socket sends through the input gate) — **NOT** assertion removal or weakening. If synchronization cannot make the assertion pass reliably, **STOP and raise to Sam.** Do not ship a weaker test. Prefer **mechanism** assertions over **symptom** assertions: assert "the stored `log:N` exists *before* any broadcast was observed" (mechanism), not merely "no error was thrown" (symptom). A commit touching test assertions MUST say in its subject what happened to them (`add`/`strengthen`/`preserve`/`weaken` + rationale) — never disguise a weakening as a "CI timing fix."

**After completing each PHASE (a logical group of tasks):**
> Review the phase from **at least 3 perspectives** (e.g. spec-faithfulness, concurrency/atomicity correctness, subagent-readiness of the remaining phases). If round 3 still finds issues, keep going until a clean pass. Update this plan's Execution Status banner + table, and record any Deviations/Discoveries per the Living Document Contract.

**Pitfall awareness (read at plan-execution time, not after):** the engine pitfalls `docs/pitfalls/implementation-pitfalls.md` GEO-1…GEO-8 + ORCH-1 are cited inline where relevant. GEO-3 (PRNG threading), GEO-5 (`control`/perimeter never cached), GEO-7 (bootstrap = founding single base), and GEO-8 (DER #17 control exclusivity) govern any code that touches engine state; this plan must not regress them. Part B adds new `DO-*` pitfalls (B9).

---

## File structure (what each new file owns)

**Part A — `src/wire` (protocol contract) + `src/session` (pure reducer):**

| File | Responsibility |
|---|---|
| `src/wire/protocol.ts` | The wire contract types: `ClientCommand` union, `ServerMessage` union, the structured error-code catalog (`WireErrorCode`), `RoomOptions`, `SeatRosterEntry`, `ProtocolVersions`. No logic. |
| `src/wire/codec.ts` | `encodeState`/`decodeState` (`GameState` ↔ JSON-safe `EncodedState`, `rngState` bigints → decimal strings via the rng codec); `encodePending`/`decodePending`. Reuses `src/session/codec` for log entries. |
| `src/session/agent-binding.ts` | `agentForSeat(seat: SeatConfig): Agent` — the one module that value-imports `src/agent`. |
| `src/session/session-types.ts` | The shared reducer types: `SessionState`, `Pending`, `SeatRuntime`, `Effects`, `PersistOp`, `AlarmIntent`. **Types only, no logic** — the single import home that keeps `session.ts`/`pending.ts`/`seats.ts`/`agent-drive.ts` free of runtime import cycles. |
| `src/session/session.ts` | `openSession`, the `applyCommand` round state machine, `resyncPayload`. The reducer core (imports types from `session-types.ts`). |
| `src/session/pending.ts` | Pending-decision flow: open (defender proposal → human pending + write-lock), `resolveDecision` (substitute validated human choice), `extendDecision`, the no-eligible-defender guard. |
| `src/session/agent-drive.ts` | `driveAgents(state, agentForSeat)` — drives agent seats forward (logging each) until a human seat / pending decision / game end; inserts `roundSkipped` for eliminated seats. |
| `src/session/seats.ts` | Seat-claim CAS (`claimSeat`), multi-tab seat runtime, 128-bit token handling (token *digest* comparison). |
| `src/session/index.ts` | **Modify:** add the new public exports (agent-ful barrel — already not engine-pure). |

**Part B — `src/host` (DO + Worker) + config:**

| File | Responsibility |
|---|---|
| `src/host/worker.ts` | The Worker `fetch` entry: assets routing, `/api/*` room routes, WS upgrade, `idFromName` dispatch, room-ID generation. |
| `src/host/game-room.ts` | The `GameRoom` Durable Object: storage layout, atomic multi-key `put`, the critical section, recovery (snapshot + tail), hibernation handlers, the alarm. |
| `src/host/storage.ts` | The storage-key layout + (de)serialization helpers (header/`log:NNNNNN`/snapshot/pending) wrapping `ctx.storage`. |
| `src/host/version.ts` | `replayVersion`/`agentVersion` constants (generated) + the version-handshake check. |
| `wrangler.jsonc` | Worker + DO + assets + staging-env config. |
| `scripts/compute-replay-version.ts` | Hashes `src/engine` + `src/rng` + `src/board`; used by the CI guard. |
| `.github/workflows/deploy-staging.yml` | Push-to-`dev` → `wrangler deploy --env staging`. |

**Shared config (flag `## Shared-config changes`):** `package.json`, `vitest.config.ts`, `tsconfig*.json`, `.github/workflows/ci.yml`, `bun.lock`.

## File ownership & execution order (prevents conflicts)

Execute phases in order. Within a shared file, the earlier task MUST merge to `dev` before the later one starts (each branches from fresh `origin/dev`).

| File | Tasks that create/modify it | Required order |
|---|---|---|
| `src/wire/protocol.ts` | A1 | — (new) |
| `src/wire/codec.ts` | A1 | — (new) |
| `src/session/session-types.ts` | A2 (types), A4 (extend `Pending`), A5 (extend `SeatRuntime`) | A2 → A4/A5 (type-only additions; sequential) |
| `src/session/session.ts` | A2 (skeleton), A3 (applyCommand), A4 (pending wiring), A6 (resync) | A2 → A3 → A4 → A6 |
| `src/session/agent-binding.ts` | A2 | — (new) |
| `src/session/agent-drive.ts` | A2 | — (new) |
| `src/session/pending.ts` | A4 | — (new) |
| `src/session/seats.ts` | A5 | — (new) |
| `src/session/index.ts` | A1, A2, A4, A5, A6 (export additions) | sequential per phase |
| `src/session/record.ts` | A2 (optional DRY refactor to use `agent-binding`) | — |
| `package.json`, `vitest.config.ts`, `tsconfig*.json` | B1 | — |
| `wrangler.jsonc` | B1 | — (new) |
| `src/host/version.ts`, `scripts/compute-replay-version.ts` | B1 (create + initial value), B8 (CI `--check` guard) | B1 → B8 |
| `src/host/*` (worker/game-room/storage/ids) | B2, B3, B4, B5, B6 | B2 → B3 → B4 → B5 → B6 |
| `.github/workflows/ci.yml` | B8 | — |
| `.github/workflows/deploy-staging.yml` | B8 | — (new) |
| `docs/pitfalls/implementation-pitfalls.md` | B9 | — |

`src/session/index.ts` is appended by several Part-A phases; since phases are sequential (each branches from fresh `dev`), that's safe — but never run two Part-A phases concurrently.

---

# PART A — Pure `GameSession` reducer + wire protocol

Part A is pure TypeScript on plain vitest — **no workerd, no Cloudflare imports**. It is fully testable with `bun run test`. The reducer is a set of pure functions over an in-memory `SessionState`; every state-changing call returns `{ next: SessionState, effects: Effects }`, where `Effects` describes what the host must persist, broadcast, and schedule. The host (Part B) performs the effects; the reducer performs no I/O. This is what makes "the DO is a thin host around a pure module" real and keeps the critical-section ordering (Part B) the host's only job.

**The `Effects` contract (defined in A2, used throughout Part A):**

```ts
// What the host must do after a reducer call. The reducer NEVER does I/O.
export type Effects = {
  // The single atomic multi-key storage write (Part B does ONE storage.put with this
  // map, plus any `clear` below, in one transaction). null = no storage change
  // (e.g. a rejected command).
  persist: PersistOp | null;
  // Messages to send to EVERY socket in the room (e.g. `applied`, `turnRollover`).
  broadcast: ServerMessage[];
  // Messages to send only to the originating socket (e.g. `error`, `resync`, `seatClaimed`).
  reply: ServerMessage[];
  // Messages to send to every socket bound to a specific seat (e.g. a defender `prompt`).
  toSeat: { seat: number; message: ServerMessage }[];
  // The defender-timeout alarm intent (Part B realizes it; null = no change).
  alarm: AlarmIntent | null;
};

export type PersistOp = {
  // The keys written in ONE atomic multi-key storage.put (Cloudflare guarantees a single
  // put({...}) of up to 128 pairs is all-or-nothing). Keys: `log:NNNNNN`, `snapshot`, `pending`.
  // To CLEAR a pending decision, write the PENDING_KEY with the tombstone sentinel in this SAME
  // put (NOT a separate delete) — this keeps the spec's "single multi-key put (the pending set/
  // clear together)" literally, avoids mixing put+delete, and is atomic by construction.
  put: Record<string, unknown>;
};

/** Tombstone value written to PENDING_KEY to clear a decision in the same atomic put as the
 *  resolving log entry. The storage layer + rehydrate treat a tombstone (or absent) pending as null. */
export const PENDING_TOMBSTONE = { cleared: true } as const;

export type AlarmIntent =
  | { action: "set"; atEpochMs: number }   // arm/re-arm the defender-timeout alarm
  | { action: "clear" };                    // cancel it (decision resolved)
```

> **Design note (do NOT collapse this):** the reducer returns *intents*; the host executes them. A subagent might be tempted to give the reducer a storage handle "for simplicity" — do NOT. The reducer's purity is what allows plain-vitest testing of every concurrency/recovery scenario without workerd, and what keeps the host thin enough to reason about the critical section. Keep all `ctx.storage`/`ws.send` calls in `src/host`.

---

## Phase A1 — Wire protocol types + codecs

**Execution Status:** ✅ SHIPPED 2026-07-02 — commits cf57bbea (A1.1), 08557106 (A1.2), + a codec-test strengthening commit (real-JSON wire-path round-trip, `-0` discovery — see Discoveries). Two-stage reviewed (spec + quality) per task. Phase review done from 3 perspectives: contract completeness vs spec §3 (verbatim, verified), bigint precision per spec §7 (>2^53 seed, `toBe` identity, real-JSON path), client-importability (type-only imports verified; codec's sole value import is the rng codec).

Defines the client↔server contract and the JSON-safe codecs. Pure types + bigint-aware (de)serialization. This is the protocol the SPA client (deliverable 2) will import, so it lives in its own `src/wire` directory, importable without pulling in the reducer or the engine's value graph.

### Task A1.1: Wire protocol types

**Files:**
- Create: `src/wire/protocol.ts`
- Test: `test/wire/protocol.test.ts`

- [x] **Step 1: Write the failing test** (`test/wire/protocol.test.ts`) — a type-presence + discriminant smoke pinning the command/message unions and the error-code catalog. It compiles the unions and asserts exhaustive discriminants.

```ts
// ABOUTME: Type-presence + discriminant smoke for the wire protocol contract.
// ABOUTME: Pins the ClientCommand/ServerMessage unions and the WireErrorCode catalog (spec §3).
import { test, expect } from "vitest";
import type { ClientCommand, ServerMessage } from "../../src/wire/protocol";
import { WIRE_ERROR_CODES, PROTOCOL_VERSION } from "../../src/wire/protocol";

test("every ClientCommand kind is reachable via the type discriminant", () => {
  // A value of each kind type-checks (compile-time guarantee surfaced at runtime).
  const cmds: ClientCommand["type"][] = [
    "hello", "claimSeat", "placeFirstBase", "build", "attack",
    "endRound", "pass", "resolveDecision", "extendDecision", "resync",
  ];
  expect(new Set(cmds).size).toBe(cmds.length);
});

test("WIRE_ERROR_CODES contains the session-layer codes used by validation + envelope", () => {
  for (const c of [
    "STALE_INDEX", "DECISION_PENDING", "ALREADY_RESOLVED", "NOT_YOUR_TURN",
    "SEAT_TAKEN", "BAD_SEAT_TOKEN", "MALFORMED", "UNKNOWN_TYPE", "OVERSIZED",
    "VERSION_MISMATCH",
    // session validation codes (re-exported for the client's rule-explanation map):
    "PASS_NOT_FORCED", "ATTACK_NOT_SINGLE_DECL", "DUP_ATTACKERS",
    "DEFENDER_IS_TARGET", "DEFENDER_INELIGIBLE", "NO_ELIGIBLE_DEFENDER",
    "MIXED_PIECE_TYPES", "DUP_PIECES",
  ]) {
    expect(WIRE_ERROR_CODES).toContain(c);
  }
});

test("PROTOCOL_VERSION is a positive integer", () => {
  expect(Number.isInteger(PROTOCOL_VERSION) && PROTOCOL_VERSION > 0).toBe(true);
});
```

Run `bun run typecheck` → FAIL (`src/wire/protocol.ts` does not exist).

- [x] **Step 2: Create `src/wire/protocol.ts`** with the full contract. Import engine types with `import type` only (no value imports — keeps `src/wire` light for the client).

```ts
// ABOUTME: The Industrial Juggernaut wire protocol — client commands, server messages, error codes.
// ABOUTME: Pure types shared by the DO host (src/host) and the SPA client; no value imports (spec §3).

import type { Hex, PlayerId, AttackDecl, GameEvent, GameState } from "../engine/types";
import type { EncodedRng } from "../rng/codec";
import type { Piece, SeatConfig, EncodedLogEntry } from "../session/types";

/** Bumped when the wire contract changes incompatibly (cached SPA vs redeployed DO). */
export const PROTOCOL_VERSION = 1;

/** Host-layer per-room options (NOT RuleConfig, NOT in SessionRecord). Spec §3 + Sam 2026-06-29. */
export type RoomOptions = {
  /** Defender-timeout liveness. OFF by default — see plan "Architectural decisions" #4. */
  defenderTimeout: { enabled: boolean; seconds: number };
};

export const DEFAULT_ROOM_OPTIONS: RoomOptions = {
  defenderTimeout: { enabled: false, seconds: 120 },
};

/** Client → server. Every *mutating* game command carries `expectedLogIndex`. */
export type ClientCommand =
  | { type: "hello"; protocolVersion: number; replayVersion: string }
  | { type: "claimSeat"; requestId: string; seat: number }  // roster ack; the socket already authenticated at the WS upgrade (no raw token here)
  | { type: "placeFirstBase"; expectedLogIndex: number; hex: Hex }
  | { type: "build"; expectedLogIndex: number; pieces: Piece[] }
  | { type: "attack"; expectedLogIndex: number; decl: AttackDecl }
  | { type: "endRound"; expectedLogIndex: number }
  | { type: "pass"; expectedLogIndex: number }
  | { type: "resolveDecision"; expectedLogIndex: number; decisionId: string; defender: Hex }
  | { type: "extendDecision"; decisionId: string }
  | { type: "resync" };

/** The JSON-safe materialized snapshot of engine state (rngState bigints → decimal strings). */
export type EncodedState = {
  game: Omit<GameState, "rngState">;  // everything but rngState is already JSON-safe (numbers/strings/arrays)
  rngState: EncodedRng;               // rngState bigints carried separately, encoded
};

/** The wire form of a pending defender decision (for prompt + resync). */
export type EncodedPending = {
  decisionId: string;
  kind: "defenderChoice";
  round: number;
  declaringPlayer: PlayerId;
  promptedSeat: number;
  target: Hex;                         // the base under attack (from the proposed decl)
  eligibleDefenders: Hex[];            // fresh, in-range, owned-by-prompted-seat (client renders choices)
  deadlineEpochMs: number | null;      // null when the room's defender timeout is OFF
};

export type SeatRosterEntry = { seat: number; claimed: boolean; kind: SeatConfig["kind"] };

/** Server → client. */
export type ServerMessage =
  | { type: "applied"; entry: EncodedLogEntry; events: GameEvent[]; logIndex: number }
  | { type: "turnRollover"; order: PlayerId[]; ironWeights: number[] | null }
  | { type: "gameOver"; winners: PlayerId[]; cause: string }  // winners: [] = no-winner termination
  | { type: "prompt"; pending: EncodedPending }
  | {
      type: "resync";
      snapshot: EncodedState;
      logLength: number;
      pending: EncodedPending | null;
      seats: SeatRosterEntry[];
      protocolVersion: number;
      replayVersion: string;
      reason: string | null;           // e.g. "STALE_INDEX" when a command was rejected
    }
  | { type: "seatClaimed"; seat: number; requestId: string }  // confirmation; the client already holds its token (POST /api/games)
  | { type: "error"; code: WireErrorCode; message: string; currentLogIndex: number | null }
  | { type: "reload" };                // version mismatch → client hard-reloads

export const WIRE_ERROR_CODES = [
  // envelope / transport
  "STALE_INDEX", "DECISION_PENDING", "ALREADY_RESOLVED", "NOT_YOUR_TURN",
  "SEAT_TAKEN", "BAD_SEAT_TOKEN", "MALFORMED", "UNKNOWN_TYPE", "OVERSIZED",
  "VERSION_MISMATCH", "ROOM_NOT_INITIALIZED", "GAME_OVER", "FROZEN",
  // setup placement (distinct codes feed the teaching surface — do NOT collapse to MALFORMED)
  "NOT_IN_SETUP", "HEX_OFF_BOARD", "HEX_NOT_OUTER", "HEX_OCCUPIED", "INVALID_ATTACKERS",
  // session validation (re-exported so the client maps codes → rule explanations)
  "PASS_NOT_FORCED", "ATTACK_NOT_SINGLE_DECL", "DUP_ATTACKERS",
  "DEFENDER_IS_TARGET", "DEFENDER_INELIGIBLE", "NO_ELIGIBLE_DEFENDER",
  "MIXED_PIECE_TYPES", "DUP_PIECES",
] as const;
export type WireErrorCode = (typeof WIRE_ERROR_CODES)[number];
```

- [x] **Step 3: Run** `bun run typecheck && bun run test -- wire/protocol` → green. Full `bun run test` → green (pure additions). Pristine output.

- [x] **Step 4: Commit**

```bash
git add src/wire/protocol.ts test/wire/protocol.test.ts
git commit -m "feat(wire): protocol contract — ClientCommand/ServerMessage unions + error-code catalog"
```

- [x] **Step 5: Apply the Execution Discipline block.**

### Task A1.2: State + pending codecs (bigint-safe)

**Files:**
- Create: `src/wire/codec.ts`
- Test: `test/wire/codec.test.ts`

**Why:** `GameState.rngState` is `{state: bigint, inc: bigint}` and `JSON.stringify` throws on bigint (spec §3). The resync snapshot crosses the wire as JSON, so the materialized state needs a codec that round-trips bigints **bit-exactly** via the shared rng codec (`BigInt()`, never `Number()`). Pitfall: the bigint↔decimal precision contract (spec §7) — uint64 values above 2^53 must survive.

- [x] **Step 1: Write the failing test** (`test/wire/codec.test.ts`) — round-trip a real `initGame` state (which has a non-trivial `rngState`) and a `pending` record; assert structural + bit-exact equality. Use the session test helper for a real header.

```ts
// ABOUTME: Round-trip tests for the wire state/pending codecs (bigint bit-exactness).
import { test, expect } from "vitest";
import { initGame, defaultConfig } from "../../src/index";
import { encodeState, decodeState, encodePending, decodePending } from "../../src/wire/codec";
import type { EncodedPending } from "../../src/wire/protocol";

test("encodeState→decodeState round-trips rngState bigints bit-exactly", () => {
  const state = initGame({ seed: 12345678901234567890n, boardSource: { kind: "generate", size: 96, ironCount: 14 }, nPlayers: 3, config: defaultConfig() });
  const round = decodeState(encodeState(state));
  expect(round.rngState.state).toBe(state.rngState.state); // bigint ===, no precision loss
  expect(round.rngState.inc).toBe(state.rngState.inc);
  expect(round.bases).toEqual(state.bases);
  expect(round.phase).toEqual(state.phase);
});

test("encodePending/decodePending round-trip the wire pending shape", () => {
  const p: EncodedPending = {
    decisionId: "d1", kind: "defenderChoice", round: 3, declaringPlayer: 0,
    promptedSeat: 1, target: { x: 0, y: 0, z: 0 },           // engine Hex is {x,y,z} cube coords
    eligibleDefenders: [{ x: 1, y: -1, z: 0 }], deadlineEpochMs: null,
  };
  expect(decodePending(encodePending(p))).toEqual(p);
});
```

> **No forward reference:** the A1 codec operates ONLY on wire types (`EncodedState`, `EncodedPending`), both defined in `src/wire/protocol.ts` (A1). The storage-side `Pending` type (A4, `session-types.ts`) is NEVER imported by `src/wire/codec.ts` — the `Pending → EncodedPending` projection (`toWirePending`, A4.1, defined below) lives in the session layer, not the wire codec. A1 has no dependency on A4.

- [x] **Step 2: Run** `bun run test -- wire/codec` → FAIL (`src/wire/codec.ts` missing).

- [x] **Step 3: Create `src/wire/codec.ts`.** Encode the whole `GameState` by replacing `rngState` with its `EncodedRng`; everything else in `GameState` is JSON-safe (numbers, strings, arrays of plain objects). Decode reverses it. Use `encodeRng`/`decodeRng` from `src/rng/codec` (the shared, `BigInt()`-only codec).

```ts
// ABOUTME: Wire codecs — GameState/pending ↔ JSON-safe forms (rngState bigints via the rng codec).
// ABOUTME: All bigint conversion delegates to src/rng/codec (BigInt(), never Number()); spec §3/§7.
import { encodeRng, decodeRng } from "../rng/codec";
import type { GameState } from "../engine/types";
import type { EncodedState, EncodedPending } from "./protocol";

export function encodeState(s: GameState): EncodedState {
  const { rngState, ...game } = s;
  return { game, rngState: encodeRng(rngState) };
}

export function decodeState(e: EncodedState): GameState {
  return { ...e.game, rngState: decodeRng(e.rngState) };
}

// encodePending/decodePending: the wire `EncodedPending` is already JSON-safe (no bigints —
// the proposed decl's rngBeforeApply lives in STORAGE, not on the wire prompt). These are
// identity-shaped passthroughs that exist for a single typed seam + future evolution.
export function encodePending(p: EncodedPending): EncodedPending { return p; }
export function decodePending(e: EncodedPending): EncodedPending { return e; }
```

> **Do NOT** put `rngBeforeApply` on the wire `EncodedPending` — the RNG-to-install-on-resolution is a **storage-only** crash-recovery field (spec §3 pending payload), never sent to clients. The wire prompt carries only what the client renders (target + eligible defenders + deadline).

- [x] **Step 4: Run** `bun run test -- wire/codec` → PASS. Full `bun run test` → green.

- [x] **Step 5: Commit**

```bash
git add src/wire/codec.ts test/wire/codec.test.ts
git commit -m "feat(wire): state + pending codecs — bigint-safe GameState round-trip"
```

- [x] **Step 6: Apply the Execution Discipline block.**

**After Phase A1:** review from 3+ perspectives (wire-contract completeness vs spec §3; bigint precision per spec §7; client-importability — no value imports leaked). Update the Execution Status banner + table.

---

## Phase A2 — Reducer skeleton + agent-drive seam

**Execution Status:** ✅ SHIPPED 2026-07-02 — commits fa0b32af (A2.1), 80489f96 (A2.2), 6cd7ea46 (A2.3 + record.ts DRY refactor), 99c35ca4 + 85dc724a (A2.4 + rng-seam test strengthening after quality review), 3414c6a5 (A2.5). Two-stage reviewed per task (A2.4 quality gate ran on Opus; its rng-seam finding was fixed with a mutation-check proof). Phase review: recordGame-composition faithfulness verified path-by-path (A2.4 review); storage-raw/wire-encoded split verified (raw entries + snapshot in put, encodeEntry on broadcast); agent-purity invariant verified by grep (only agent-binding.ts value-imports src/agent). gameOver-path test coverage is intentionally deferred to A4.5's cross-check — A4 executor MUST NOT skip it.

Establishes the in-memory `SessionState`, the `Effects` plumbing, the injected `agentForSeat` seam, and the agent-drive loop for **non-attack** rounds (setup placement, eliminated-seat `roundSkipped`, agent `build`/`pass`). Tested with a **fake agent** to exercise the loop mechanics in isolation. Agent **attack** rounds are added in A4 (they route through the pending-decision flow). This is the architectural decision #2 (injection) made concrete.

### Task A2.1: Shared reducer types

**Files:**
- Create: `src/session/session-types.ts`
- Test: `test/session/session-types.test.ts` (type-presence smoke)

- [x] **Step 1: Write the failing test** — a smoke that constructs a `SessionState` from a real header + `DEFAULT_ROOM_OPTIONS` and asserts the initial shape.

```ts
// ABOUTME: Type-presence + initial-shape smoke for the reducer's shared types.
import { test, expect } from "vitest";
import { DEFAULT_ROOM_OPTIONS } from "../../src/wire/protocol";
import { NO_EFFECTS, type SessionState } from "../../src/session/session-types";

test("NO_EFFECTS is the empty effects value", () => {
  expect(NO_EFFECTS).toEqual({ persist: null, broadcast: [], reply: [], toSeat: [], alarm: null });
});
test("DEFAULT_ROOM_OPTIONS has defender timeout OFF", () => {
  expect(DEFAULT_ROOM_OPTIONS.defenderTimeout.enabled).toBe(false);
});
```

Run `bun run typecheck` → FAIL (`session-types.ts` missing).

- [x] **Step 2: Create `src/session/session-types.ts`** exactly as specified in the plan's "File structure" + the `Effects` contract in the Part A intro. Full content:

```ts
// ABOUTME: Shared types for the interactive GameSession reducer (state, pending, seats, effects).
// ABOUTME: Types only — the single import home that keeps the reducer modules free of import cycles.
import type { GameState, PlayerId, AttackDecl, RngState } from "../engine/types";
import type { SessionHeader, SeatConfig } from "./types";
import type { RoomOptions, ServerMessage } from "../wire/protocol";

/** A durable pending defender decision (spec §3 "Pending decisions"). Storage-only fields never hit the wire. */
export type Pending = {
  decisionId: string;
  kind: "defenderChoice";
  round: number;                 // state.game.phase.turn at open
  declaringPlayer: PlayerId;     // the attacker
  promptedSeat: number;          // the defending seat (== defender-owner PlayerId)
  proposed: AttackDecl;          // target + proposed attackers; the defender field is replaced on resolution
  preDecisionLogLength: number;  // log length when the decision opened (crash-recovery contract)
  rngBeforeApply: RngState;      // RNG to install when the resolved attack entry is applied
  deadlineEpochMs: number | null;// null when the room's defender timeout is OFF
};

/** Per-seat runtime auth state. In Phase 1 each seat's token is minted at room creation and its digest bound
 *  here; a seat token admits many concurrent sockets (multi-tab). Cross-device claiming of UNBOUND seats and the
 *  one-winner CAS are Phase 2 (the `SEAT_TAKEN` path). */
export type SeatRuntime = {
  seat: number;
  config: SeatConfig;
  authorizedDigest: string | null;  // SHA-256 digest of the seat's minted token (set at room init); null pre-init
  claimed: boolean;                 // a socket has presented the matching token (Phase 1 = authenticate, not own)
  lastRequestId: string | null;     // idempotency: a re-claim with the same requestId returns the same result
};

export type SessionState = {
  header: SessionHeader;
  roomOptions: RoomOptions;
  game: GameState;
  logLength: number;
  pending: Pending | null;
  seats: SeatRuntime[];
  // Set to the attacker when a human attack leaves the round OPEN (chain continues); cleared on any round
  // close. `endRound` is legal ONLY for `chainAttacker === actingSeat` — guards against a human sending
  // `endRound` at round start to illegally skip their turn (voluntary pass is illegal, DER #5). Maintained in A4.
  chainAttacker: PlayerId | null;
};

/** Injected per-command context — all reducer non-determinism (time, ids) comes through here, so the reducer
 *  stays pure/deterministic. The HOST populates every field on every call (handlers read only what they need).
 *  NO token/digest here: socket→seat authentication happens at the WS UPGRADE (B2.2/B6.2), not via a command. */
export type CommandCtx = {
  actingSeat: number;   // the authenticated seat the socket is bound to (from serializeAttachment)
  nowEpochMs: number;   // injected current time (reducer is pure — no Date.now()); used for pending deadlines
  decisionId: string;   // host-pre-generated (crypto.getRandomValues) id for any pending this command opens
};

// One atomic multi-key storage.put. Clear a pending decision by writing PENDING_KEY = PENDING_TOMBSTONE
// in this SAME put (no separate delete) — atomic by construction, matches spec §3's "single multi-key put".
export type PersistOp = { put: Record<string, unknown> };
/** Tombstone written to PENDING_KEY to clear a decision atomically with the resolving entry. */
export const PENDING_TOMBSTONE = { cleared: true } as const;
export type AlarmIntent = { action: "set"; atEpochMs: number } | { action: "clear" };
export type Effects = {
  persist: PersistOp | null;
  broadcast: ServerMessage[];
  reply: ServerMessage[];
  toSeat: { seat: number; message: ServerMessage }[];
  alarm: AlarmIntent | null;
};
export const NO_EFFECTS: Effects = { persist: null, broadcast: [], reply: [], toSeat: [], alarm: null };
```

- [x] **Step 3: Run** `bun run typecheck && bun run test -- session/session-types` → green. Full suite green.
- [x] **Step 4: Commit** — `git commit -m "feat(session): shared reducer types — SessionState, Pending, SeatRuntime, Effects"`
- [x] **Step 5: Apply the Execution Discipline block.**

### Task A2.2: `openSession` + storage-key helpers

**Files:**
- Create: `src/session/session.ts`
- Create: `src/session/keys.ts` (the `log:NNNNNN`/`snapshot`/`pending`/`header` key layout — shared by reducer + host)
- Test: `test/session/open-session.test.ts`

**Why a shared `keys.ts`:** the reducer builds the `PersistOp.put` map keyed by storage keys, and the host (B3) reads/writes those same keys. One module owns the layout so they cannot drift.

- [x] **Step 1: Write the failing test** — `openSession` produces a setup-phase state (turn 0), `logLength: 0`, no pending, unclaimed seats; key helpers zero-pad.

```ts
// ABOUTME: openSession + storage-key layout tests.
import { test, expect } from "vitest";
import { defaultConfig } from "../../src/index";
import { openSession } from "../../src/session/session";
import { logKey } from "../../src/session/keys";
import { DEFAULT_ROOM_OPTIONS } from "../../src/wire/protocol";

const header = {
  formatVersion: 1, replayVersion: "test", seed: 42n, config: defaultConfig(),
  boardSource: { kind: "generate" as const, size: 96, ironCount: 14 },
  seats: [{ kind: "human" as const }, { kind: "agent" as const, agent: "heuristic" as const }],
};

test("openSession starts in setup phase with empty log and unclaimed seats", () => {
  const s = openSession(header, DEFAULT_ROOM_OPTIONS);
  expect(s.game.phase.turn).toBe(0);
  expect(s.logLength).toBe(0);
  expect(s.pending).toBeNull();
  expect(s.seats.map((x) => x.authorizedDigest)).toEqual([null, null]);
  expect(s.seats.every((x) => x.claimed === false)).toBe(true);
});
test("logKey zero-pads to 6 digits", () => {
  expect(logKey(1)).toBe("log:000001");
  expect(logKey(123456)).toBe("log:123456");
});
```

- [x] **Step 2: Run** → FAIL.
- [x] **Step 3: Create `src/session/keys.ts`:**

```ts
// ABOUTME: Durable storage key layout for a GameRoom — header / log:NNNNNN / snapshot / pending.
// ABOUTME: Shared by the reducer (PersistOp keys) and the DO host (storage reads), so they cannot drift.
export const HEADER_KEY = "header";
export const SNAPSHOT_KEY = "snapshot";
export const PENDING_KEY = "pending";
export const ROOM_OPTIONS_KEY = "roomOptions";
export const INITIALIZED_KEY = "initialized";
/** Zero-padded so lexical key order == numeric log order under storage.list({prefix:"log:"}). */
export function logKey(index: number): string { return `log:${String(index).padStart(6, "0")}`; }
```

> 6 digits caps at 999,999 log entries — far beyond any real game (a long 6-player game is hundreds of entries). If a game ever approached the cap that would itself be a defect; do NOT widen speculatively (YAGNI).

- [x] **Step 4: Create `src/session/session.ts`** with `openSession` (the `applyCommand`/`resyncPayload` functions are added in A3/A6):

```ts
// ABOUTME: The interactive GameSession reducer core — openSession, applyCommand (A3), resyncPayload (A6).
// ABOUTME: Pure: every state-changing call returns { next, effects }; the host performs the effects.
import { initGame } from "../engine/init";
import type { SessionHeader } from "./types";
import type { RoomOptions } from "../wire/protocol";
import type { SessionState } from "./session-types";

export function openSession(header: SessionHeader, roomOptions: RoomOptions): SessionState {
  const game = initGame({
    seed: header.seed, boardSource: header.boardSource,
    nPlayers: header.seats.length, config: header.config,
  });
  return {
    header, roomOptions, game, logLength: 0, pending: null, chainAttacker: null,
    seats: header.seats.map((config, seat) => ({ seat, config, authorizedDigest: null, claimed: false, lastRequestId: null })),
  };
}
```
> The Worker (B2.2) sets each seat's `authorizedDigest` at room init (from the minted seat tokens) via the DO init request; `openSession` starts them `null` (pre-init). `roomOptions` is also persisted at init and reloaded on rehydrate (B3.1/B3.3) — the defender-timeout toggle MUST survive eviction, never silently revert to OFF.

- [x] **Step 5: Run** `bun run test -- session/open-session` → PASS. Full suite green.
- [x] **Step 6: Commit** — `git commit -m "feat(session): openSession + storage-key layout"`
- [x] **Step 7: Apply the Execution Discipline block.**

### Task A2.3: `agentForSeat` binding (the one agent-importing module)

**Files:**
- Create: `src/session/agent-binding.ts`
- Modify (optional DRY): `src/session/record.ts` to import `agentForSeat` instead of its inline copy
- Test: `test/session/agent-binding.test.ts`

**Why:** architectural decision #2. This is the SINGLE module that value-imports `src/agent`. The reducer's drive loop takes `agentForSeat` as a parameter and never imports `src/agent` itself; the DO entrypoint imports this binding. Mirror `record.ts`'s existing inline `agentForSeat` (see `src/session/record.ts:14-19`).

- [x] **Step 1: Write the failing test** — the binding returns a greedy agent for a greedy seat, heuristic for heuristic, and throws on a human seat.

```ts
// ABOUTME: agentForSeat binding tests — maps SeatConfig to the real engine agents.
import { test, expect } from "vitest";
import { agentForSeat } from "../../src/session/agent-binding";

test("agentForSeat returns a callable for agent seats and throws on human", () => {
  expect(typeof agentForSeat({ kind: "agent", agent: "heuristic" })).toBe("function");
  // Archetype is "aggressive" | "economic" | "expansionist" (src/agent/archetypes.ts) — NOT "balanced".
  expect(typeof agentForSeat({ kind: "agent", agent: "greedy", archetype: "aggressive" })).toBe("function");
  expect(() => agentForSeat({ kind: "human" })).toThrow(/human seat has no agent/i);
});
```

- [x] **Step 2: Run** → FAIL.
- [x] **Step 3: Create `src/session/agent-binding.ts`:**

```ts
// ABOUTME: The one module that value-imports src/agent — maps a SeatConfig to its driving Agent.
// ABOUTME: The reducer takes this as an injected parameter; the DO host imports it (Worker bundles agents).
import { greedyAgent, type Agent } from "../agent/agent";
import { heuristicAgent } from "../agent/heuristic-agent";
import type { SeatConfig } from "./types";

export function agentForSeat(seat: SeatConfig): Agent {
  if (seat.kind === "human") throw new Error("agentForSeat: a human seat has no agent");
  if (seat.agent === "greedy") return greedyAgent(seat.archetype);
  if (seat.agent === "heuristic") return heuristicAgent();
  throw new Error(`agentForSeat: unsupported agent ${(seat as { agent?: string }).agent}`);
}
```

- [x] **Step 4 (optional DRY):** refactor `src/session/record.ts` to `import { agentForSeat } from "./agent-binding"` and delete its inline `agentForSeat`. If you do, run the full session suite to confirm `recordGame` still passes (this touches shipped plan-1 code — record the refactor as a **Deviation**). If skipping, note it; duplication of a 4-line function is tolerable.
- [x] **Step 5: Run** `bun run test -- session/agent-binding` → PASS. Full suite green.
- [x] **Step 6: Commit** — `git commit -m "feat(session): agentForSeat binding — the sole agent-importing module"`
- [x] **Step 7: Apply the Execution Discipline block.**

### Task A2.4: Agent-drive loop (non-attack rounds)

**Files:**
- Create: `src/session/agent-drive.ts`
- Test: `test/session/agent-drive.test.ts`

**Why:** the agent-drive invariant (spec §3): after any wake/applied event, while the current actor is an agent (or an eliminated seat) and no decision is pending and the game is live, drive one round forward, logging each. Each agent **round** is one atomic event (B3 persists it). Attack rounds are deferred to A4. **Test with a FAKE agent** (`(state, player) => ({ action: { kind: "build", pieces: [...] }, state })` or a `pass` agent) — this isolates the loop from real agent attack behavior and is the payoff of the injection seam.

- [x] **Step 1: Write the failing test.** Build a 2-seat all-"agent" session, place via setup-drive with a fake first-base picker, then drive with a fake pass-agent; assert each step appends exactly one `log:N`, that `needsDrive` flips false at a human seat, and that a closed round emits a `snapshot` key + a `turnRollover` broadcast.

```ts
// ABOUTME: Agent-drive loop tests with a FAKE agent (isolates loop mechanics from real agent policy).
import { test, expect } from "vitest";
import { defaultConfig } from "../../src/index";
import { openSession } from "../../src/session/session";
import { needsDrive, driveOneStep } from "../../src/session/agent-drive";
import { DEFAULT_ROOM_OPTIONS } from "../../src/wire/protocol";
import { logKey, SNAPSHOT_KEY } from "../../src/session/keys";
import type { Agent } from "../../src/agent/agent";

// A fake agent that always passes (when legal) — exercises the loop, not real policy.
const passAgent: Agent = (state, _p) => ({ action: { kind: "pass" }, state });

test("driveOneStep appends one log entry per agent round and closes rounds with a snapshot", () => {
  const header = {
    formatVersion: 1, replayVersion: "t", seed: 7n, config: { ...defaultConfig(), allowPass: true },
    boardSource: { kind: "generate" as const, size: 96, ironCount: 14 },
    seats: [{ kind: "agent" as const, agent: "heuristic" as const }, { kind: "human" as const }],
  };
  let s = openSession(header, DEFAULT_ROOM_OPTIONS);
  // Setup: drive agent-seat placements; the human seat (seat 1) stops the drive.
  // (Test drives until needsDrive is false; asserts log growth + snapshot on a closed round.)
  // ... see full assertions: each driveOneStep returns { next, effects, advanced };
  //     effects.persist.put has exactly one log:N key for non-attack rounds,
  //     plus SNAPSHOT_KEY when advanced===true (a round closed).
});
```

> The executor writes the full assertions; the contract above is exact. **The engine does NOT enforce `allowPass`** — `applyAction` accepts an unconditional `pass` (spec §0: "`applyAction` is not a complete rules oracle ... accepts unconditional `pass`"). So `applyEntry` will NOT reject the fake pass-agent's entry. Use `config.allowPass: true` anyway so the *game itself* is legitimate (voluntary pass is illegal under DER #5; a fake pass-agent in an `allowPass:false` game would produce a rules-illegal trajectory and confuse the test's intent). Agent-driven entries are **trusted** (not validated) — the reducer validates `pass` only on the *human-command* path (`validatePass`), exactly as `recordGame` trusts its agents. Setup placement does NOT consult the injected agent — it uses `representativeFirstBase` directly (matching `recordGame`). **Do NOT** route setup placement through the injected agent.

- [x] **Step 2: Run** → FAIL.
- [x] **Step 3: Create `src/session/agent-drive.ts`:**

```ts
// ABOUTME: Agent-drive loop — advances agent/eliminated rounds (logging each) until a human seat / pending / end.
// ABOUTME: Pure; takes agentForSeat injected. Attack rounds land in A4. Mirrors recordGame's composition.
import { applyEntry } from "./round";
import { stateHash } from "./hash";
import { encodeEntry } from "./codec";
import { encodeState } from "../wire/codec";
import { status } from "../engine/status";
import { currentPlayer, representativeFirstBase } from "../engine/turn";
import type { Agent } from "../agent/agent";   // import type only — no value import of src/agent here
import type { PlayerId } from "../engine/types";
import type { LogEntry, SeatConfig } from "./types";
import type { ServerMessage } from "../wire/protocol";  // for the broadcast array (P1: was missing)
import { logKey, SNAPSHOT_KEY } from "./keys";
import { NO_EFFECTS, type Effects, type SessionState } from "./session-types";

/** The seat whose turn/placement it currently is (setup: the placer; play: the current player). Exported — A3 imports it. */
export function currentActor(s: SessionState): PlayerId {
  return s.game.phase.turn === 0 ? s.game.phase.order[s.game.phase.indexInOrder]! : currentPlayer(s.game);
}

/** True when the host should call driveOneStep (agent/eliminated actor, no pending, game live). */
export function needsDrive(s: SessionState): boolean {
  if (s.pending !== null) return false;
  if (status(s.game).kind === "victory") return false;
  const p = currentActor(s);
  if (s.game.phase.turn !== 0 && s.game.players[p]!.eliminated) return true;
  return s.header.seats[p]!.kind === "agent";
}

export type DriveResult = { next: SessionState; effects: Effects; advanced: boolean; terminal: ReturnType<typeof status> | null };
// terminal (when non-null) is a status() victory: { kind:"victory"; players: PlayerId[]; reason:"iron"|"last-standing" }.
// The gameOver message maps winners = terminal.players, cause = terminal.reason (no helper needed).

/** Advance exactly one agent/eliminated/setup round; return the entry(ies) to persist + broadcast. */
export function driveOneStep(s: SessionState, agentForSeat: (seat: SeatConfig) => Agent): DriveResult {
  const p = currentActor(s);
  // SETUP: agent auto-places via representativeFirstBase (NOT via the injected agent).
  if (s.game.phase.turn === 0) {
    const entry: LogEntry = { player: p, kind: "placeFirstBase", hex: representativeFirstBase(s.game, p), rngBeforeApply: s.game.rngState };
    return commitEntries(s, [entry]); // placeFirstBase never closes a round → no snapshot
  }
  // PLAY, eliminated seat: roundSkipped.
  if (s.game.players[p]!.eliminated) {
    return commitEntries(s, [{ player: p, kind: "roundSkipped", rngBeforeApply: s.game.rngState }]);
  }
  // PLAY, agent seat: select + map to entries.
  const choice = agentForSeat(s.header.seats[p]!)(s.game, p);
  const rng = choice.state.rngState; // post-selection, pre-apply
  const a = choice.action;
  if (a.kind === "build") return commitEntries(s, [{ player: p, kind: "build", pieces: a.pieces.map((x) => ({ type: x.type, hex: x.hex })), rngBeforeApply: rng }]);
  if (a.kind === "pass") return commitEntries(s, [{ player: p, kind: "pass", rngBeforeApply: rng }]);
  // a.kind === "attack": deferred to A4 (agent-attacks-human opens a pending; else attack+endRound).
  throw new Error("driveOneStep: agent attack rounds are implemented in Phase A4");
}

/** Apply a round's entries through applyEntry, threading state; build the atomic PersistOp + broadcasts.
 *  EXPORTED — the SHARED builder reused by A3 (human build/pass/endRound) and A4 (attack), so the
 *  applyEntry→{persist,broadcast,snapshot} logic exists in exactly one place (DRY). */
export function commitEntries(s: SessionState, entries: LogEntry[]): DriveResult {
  let game = s.game;
  let logLength = s.logLength;
  let advanced = false;
  let terminal: ReturnType<typeof status> | null = null;
  const put: Record<string, unknown> = {};
  const broadcast: ServerMessage[] = [];
  for (const entry of entries) {
    const out = applyEntry(game, entry);
    put[logKey(logLength)] = entry;                 // RAW entry (bigints store natively in DO storage)
    broadcast.push({ type: "applied", entry: encodeEntry(entry), events: out.events, logIndex: logLength });
    game = out.state;
    logLength += 1;
    if (out.advanced) advanced = true;
    if (out.terminal) terminal = out.terminal;       // a victory-closing round: applyEntry did NOT advanceRound
  }
  if (advanced) {
    // Snapshot holds post-composition state (post-advanceRound for a normal close; the victory state for a
    // terminal close, where applyEntry deliberately skips advanceRound — round.ts).
    put[SNAPSHOT_KEY] = { state: game, logIndex: logLength - 1, stateHash: stateHash(game), replayVersion: s.header.replayVersion };
    if (terminal) {
      // Game over: there is NO next turn — do NOT broadcast turnRollover (game.phase.order is the final round's order).
      // status() victory shape (src/engine/status.ts): { kind:"victory"; players: PlayerId[]; reason:"iron"|"last-standing" }.
      // `players` is the winning coalition (EMPTY [] for an all-eliminated/no-winner board, DER-N7 / status.ts:116).
      broadcast.push({ type: "gameOver", winners: terminal.players, cause: terminal.reason });
    } else {
      broadcast.push({ type: "turnRollover", order: game.phase.order, ironWeights: null }); // ironWeights filled in A6
    }
  }
  const next: SessionState = { ...s, game, logLength };
  const effects: Effects = { ...NO_EFFECTS, persist: { put }, broadcast };
  return { next, effects, advanced, terminal };
}
```

> **`DriveResult` now carries `terminal`:** `type DriveResult = { next: SessionState; effects: Effects; advanced: boolean; terminal: ReturnType<typeof status> | null }`. The host (B3) checks `terminal` to stop the drive loop and `applyCommand` callers surface game-over. **`gameOver` is a new `ServerMessage`** (added to the union in A1 — see the A1.1 fix) carrying the `status()` victory result; without it a win is never communicated to any client (`applyEntry`'s `out.events` does NOT contain a victory event — `status()` returns a `Status`, not a `GameEvent`).
> **Note on `turnRollover.ironWeights`:** A6 fills the 2-player iron-weight array; A2 ships `null`. Do NOT block A2 on it. `import { status } from "../engine/status"` (already imported in `agent-drive.ts`).
> **Note on snapshot storage:** the snapshot stores the RAW `GameState` (`state: game`) — DO storage uses structured clone, so `rngState` bigints persist natively (CF research: SQLite-backed DO storage round-trips bigint without JSON). The wire `applied`/`resync` messages use `encodeEntry`/`encodeState` (JSON-safe). Storage = raw; wire = encoded. Pitfall **DO-CODEC-1** (B9).

- [x] **Step 4: Run** `bun run test -- session/agent-drive` → PASS. Full suite green.
- [x] **Step 5: Commit** — `git commit -m "feat(session): agent-drive loop for non-attack rounds (fake-agent tested)"`
- [x] **Step 6: Apply the Execution Discipline block.**

### Task A2.5: Export the A2 surface

**Files:**
- Modify: `src/session/index.ts` (add exports)

- [x] **Step 1:** add to `src/session/index.ts`:

```ts
export { openSession } from "./session";
export { needsDrive, driveOneStep } from "./agent-drive";
export { agentForSeat } from "./agent-binding";
export * from "./keys";
export type { SessionState, Pending, SeatRuntime, Effects, PersistOp, AlarmIntent, CommandCtx } from "./session-types";
export { PENDING_TOMBSTONE } from "./session-types";
```

> `src/session/index.ts` is already the agent-ful barrel (it exports `recordGame`). Adding `agentForSeat` (which imports `src/agent`) is consistent. **Do NOT** add any of these to `src/index.ts` (the engine barrel must stay agent-free — foundation Phase 6 purity).

- [x] **Step 2: Run** `bun run typecheck && bun run test` → green.
- [x] **Step 3: Commit** — `git commit -m "feat(session): export the A2 reducer surface"`
- [x] **Step 4: Apply the Execution Discipline block.**

**After Phase A2:** review from 3+ perspectives (drive-loop faithfulness to `recordGame`'s composition; the storage-raw/wire-encoded split; injection seam keeps `agent-drive.ts` value-import-free of `src/agent`). Update Execution Status.

---

## Phase A3 — Command processing: non-attack round state machine + envelope

**Execution Status:** ✅ SHIPPED 2026-07-02 — commits 9d56776d + 23fd65e1 (A3.1 envelope + carve-out marker), e5072d62 + cf349440 (A3.2 placeFirstBase + rethrow policy), e1f38df5 + 3bcdb279 (A3.3 build/pass + SETUP_PLACEMENT_REQUIRED crash fix), 73a3212c (A3.5 exports). Two-stage reviewed per task; the A3.3 spec review found a real setup-phase crash (see Discoveries) fixed with failing-first TDD and re-reviewed to green (re-review independently verified the repro dead against a pre-fix worktree). Phase review perspectives: envelope correctness (every mutating path index-guarded, verified in review), engine-throw mapping (pairwise collision audit clean), A4 dependencies flagged (carve-out markers on BOTH guards; endRound deferred per plan).

`applyCommand` for the **non-attack** human commands — `build`, `pass`, `placeFirstBase` — plus the command envelope: `expectedLogIndex` optimistic concurrency, the **out-of-turn / forged-`player` guard** (plan-1 deferred this to here), and the deferred plan-1 **check-2** (`ATTACK_NOT_SINGLE_DECL` lives in the attack path, A4 — named here for traceability). The `attack`, `endRound`, `resolveDecision`, and `extendDecision` commands all land in A4 (`endRound` because its legality depends on `chainAttacker`, which the attack machinery sets).

### Task A3.1: `applyCommand` envelope + turn guard

**Files:**
- Modify: `src/session/session.ts` (add `applyCommand`)
- Test: `test/session/apply-command-envelope.test.ts`

**Behavior (current → desired):** the reducer currently only opens sessions; add `applyCommand(state, command, actingSeat) → { next, effects }` that, for any mutating command:
1. Rejects with `STALE_INDEX` (a `resync` reply) when `command.expectedLogIndex !== state.logLength`. This makes a lost-ack retry **safe** (mismatch-and-resync, not double-apply). Spec §3 envelope.
2. Rejects with `DECISION_PENDING` (error reply) when `state.pending !== null` and the command is not the matching `resolveDecision`/`extendDecision` (global write-lock; A4 adds the matching-answer carve-out — A3 rejects all mutating commands while pending).
3. Rejects with `NOT_YOUR_TURN` when `actingSeat !== currentActor(state)`. This is the **forged/out-of-turn `player` guard** plan-1 deferred (the DO authenticates the socket→seat; the reducer trusts `actingSeat` from the host but verifies it owns the turn).
4. Rejects with `GAME_OVER` when `status(state.game).kind === "victory"`, and `FROZEN` is reserved for the B3 divergence-freeze (A3 need not emit it).

`actingSeat` is the authenticated seat the host passes (from `serializeAttachment`); the reducer never trusts a `player` field in the command payload — it derives the actor from the turn + the authenticated seat.

- [x] **Step 1: Write the failing tests** — one per rejection path, asserting the exact `code` and that no `persist` happened.

```ts
// ABOUTME: applyCommand envelope tests — STALE_INDEX, NOT_YOUR_TURN, DECISION_PENDING, GAME_OVER.
import { test, expect } from "vitest";
import { defaultConfig } from "../../src/index";
import { openSession, applyCommand } from "../../src/session/session";
import { DEFAULT_ROOM_OPTIONS } from "../../src/wire/protocol";

const header = { /* 2-human header, allowPass:false */ } as any;

// CommandCtx test helper — the host always supplies all fields; tests pass fixed values.
const mkCtx = (actingSeat: number): CommandCtx => ({ actingSeat, nowEpochMs: 1_000_000, decisionId: "test-decision" });

test("stale expectedLogIndex is rejected with STALE_INDEX and no persist", () => {
  const s = openSession(header, DEFAULT_ROOM_OPTIONS);
  const { next, effects } = applyCommand(s, { type: "pass", expectedLogIndex: 99 }, mkCtx(0));
  expect(effects.persist).toBeNull();
  expect(effects.reply.some((m) => m.type === "resync" && m.reason === "STALE_INDEX")).toBe(true);
  expect(next).toBe(s); // unchanged
});
// + NOT_YOUR_TURN (acting seat != current actor), DECISION_PENDING (manually set s.pending), GAME_OVER.
```

- [x] **Step 2: Run** → FAIL.
- [x] **Step 3: Implement the envelope guard** in `applyCommand` (dispatch on `command.type` after the guards; the per-kind handlers come in Steps that follow). Reuse `currentActor` (export it from `agent-drive.ts` or lift it into `session-types`-adjacent helper — pick one and be consistent; recommended: export `currentActor` from `agent-drive.ts` and import it here).

Define these small helpers (in `src/session/session.ts`) — they are referenced by every command handler, so a subagent MUST have them spelled out:

```ts
// in src/session/session.ts
import { currentActor } from "./agent-drive";   // exported in A2.4
import { status } from "../engine/status";
import { NO_EFFECTS, type Effects, type SessionState, type CommandCtx } from "./session-types";
import type { ClientCommand, ServerMessage, WireErrorCode } from "../wire/protocol";

// Mutating = appends a log entry / changes authoritative state. resolveDecision is mutating (it applies the
// attack); extendDecision is NOT (it only re-arms the alarm), so it is exempt from the envelope guards and the
// write-lock. hello/claimSeat/resync are also non-mutating.
const MUTATING_TYPES: ReadonlySet<ClientCommand["type"]> = new Set(["placeFirstBase","build","attack","endRound","pass","resolveDecision"]);
function isMutating(c: ClientCommand): boolean { return MUTATING_TYPES.has(c.type); }
function errorMessage(code: WireErrorCode, message: string, currentLogIndex: number | null = null): ServerMessage {
  return { type: "error", code, message, currentLogIndex };
}
function errorEffects(s: SessionState, code: WireErrorCode, message: string): Effects {
  return { ...NO_EFFECTS, reply: [errorMessage(code, message, s.logLength)] };
}
// resyncEffects builds a full resync reply via resyncPayload (A6). Until A6 lands, A3 calls a minimal
// resyncPayload(s, requestingSeat, reason) — A6 is the canonical home; A3 calls it (do NOT write a second copy).
function resyncEffects(s: SessionState, requestingSeat: number, reason: string): Effects {
  return { ...NO_EFFECTS, reply: [resyncPayload(s, requestingSeat, reason)] };
}

export function applyCommand(s: SessionState, c: ClientCommand, ctx: CommandCtx): { next: SessionState; effects: Effects } {
  const keep = (effects: Effects) => ({ next: s, effects });   // rejected/no-op commands leave state unchanged
  if (isMutating(c)) {
    if (status(s.game).kind === "victory") return keep(errorEffects(s, "GAME_OVER", "The game is over."));
    if (s.pending !== null /* && not the matching answer — carve-out added in A4.3 */) return keep(errorEffects(s, "DECISION_PENDING", "A decision is pending."));
    if ("expectedLogIndex" in c && c.expectedLogIndex !== s.logLength) return keep(resyncEffects(s, ctx.actingSeat, "STALE_INDEX"));
    if (ctx.actingSeat !== currentActor(s)) return keep(errorEffects(s, "NOT_YOUR_TURN", "It is not your turn."));
  }
  switch (c.type) { /* placeFirstBase / build / pass / endRound — Tasks A3.2-A3.4; attack/resolve/extend — A4 */ default: return keep(errorEffects(s, "UNKNOWN_TYPE", `Unknown command ${(c as { type?: string }).type}`)); }
}
```

> **`resyncPayload` — A3 introduces it with the FINAL signature; A6 fills the body.** A3 defines `export function resyncPayload(s: SessionState, requestingSeat: number, reason: string | null): ServerMessage` in `session.ts` with the **locked 3-arg signature** (never a 2-arg variant) and a minimal body (snapshot + logLength + roster + versions + reason; `pending: null` — A3 creates no pending). A6.1 fills in the seat-filtered pending. There is exactly ONE `resyncPayload`, defined once in A3, extended in A6 — never two copies. Record in the A3 Deviation note that it was introduced early.
> **`ctx` is `CommandCtx` throughout** (defined in `session-types.ts`, A2.1 — `{ actingSeat, nowEpochMs, decisionId }`). A3 reads only `ctx.actingSeat`; A4 also reads `nowEpochMs`/`decisionId`. The host populates all fields every call; tests build it via `mkCtx`. No `tokenDigest` (auth is at the WS upgrade, not a command).

- [x] **Step 4: Run** → PASS. Full suite green.
- [x] **Step 5: Commit** — `git commit -m "feat(session): applyCommand envelope — STALE_INDEX/NOT_YOUR_TURN/DECISION_PENDING/GAME_OVER guards"`
- [x] **Step 6: Apply the Execution Discipline block.** This task touches optimistic-concurrency logic → the **assertion-rigor** rule applies (assert the *mechanism*: `next === s` and `persist === null` on every rejection, not just "no throw").

### Task A3.2: `placeFirstBase` command

**Files:**
- Modify: `src/session/session.ts`
- Test: `test/session/place-first-base-command.test.ts`

**Behavior:** in setup (turn 0), a human seat places via `{ type: "placeFirstBase", expectedLogIndex, hex }`. Validate via the engine `placeFirstBase` (it throws on non-outermost/occupied/wrong-placer — catch and map to a structured error reply rather than letting it throw). On success, build the `placeFirstBase` log entry (`rngBeforeApply = game.rngState`), apply via `applyEntry`, persist `{log:N}` (no snapshot — setup never closes a round), broadcast `applied`.

- [x] **Step 1: Write the failing test** — a human places a legal outer-ring hex → one `log:000000`, `applied` broadcast, `logLength` 1, still turn 0 (until the last placer). An illegal hex → structured error reply, no persist. Use `legalFirstBaseHexes` (engine barrel) in the test to pick a legal hex.

- [x] **Step 2-5:** implement; the handler wraps the engine `placeFirstBase` in try/catch, mapping each distinct thrown message to a specific code (the teaching surface maps codes→explanations, so do NOT collapse them): "not in setup phase" → `NOT_IN_SETUP`; **"not this player's setup turn" → `NOT_YOUR_TURN`** (it's an out-of-turn error, not malformed input); "hex is not on the board" → `HEX_OFF_BOARD`; "hex must be an outermost-ring hex" → `HEX_NOT_OUTER`; "hex is already occupied" → `HEX_OCCUPIED`. Prefer matching the engine's thrown `message` text (read `src/engine/turn.ts` `placeFirstBase` for the exact strings) over re-deriving the checks. Commit `feat(session): placeFirstBase command`.
- [x] **Apply the Execution Discipline block.**

### Task A3.3: `build` and `pass` commands

**Files:**
- Modify: `src/session/session.ts`
- Test: `test/session/build-pass-command.test.ts`

**Behavior:** `build` validates pieces via `validateBuildPieces` (plan-1: MIXED_PIECE_TYPES / DUP_PIECES) → builds a `build` entry → `applyEntry` (self-closes the round → snapshot + turnRollover). `pass` validates via `validatePass` (plan-1: PASS_NOT_FORCED unless `allowPass` or forced) → `pass` entry → `applyEntry` (self-closes). Budget is the engine's job at apply time (a budget overrun throws in `applyEntry`'s `applyAction` — catch and map to a structured error; do NOT pre-check budget in the reducer, per plan-1 validation note "budget checked by the engine at entry").

- [x] **Step 1: Write the failing tests** — legal build → snapshot + turnRollover broadcast; mixed-type build → `MIXED_PIECE_TYPES`, no persist; non-forced pass with `allowPass:false` → `PASS_NOT_FORCED`; forced pass (no legal action) → accepted. Cite GEO-7 in a comment near any bootstrap-adjacent assertion (a founding single-base player's legal builds are factory-only — but that's the engine's concern; the reducer just forwards).
- [x] **Step 2-5:** implement; reuse `commitEntries` (exported from `agent-drive.ts`, A2.4) — the single shared `applyEntry`→`{persist,broadcast,snapshot}` builder. Do NOT write a second copy. Commit `feat(session): build + pass commands`.
- [x] **Apply the Execution Discipline block.**

### Task A3.4: `endRound` command (chain close)

**Files:**
- Modify: `src/session/session.ts`
- Test: `test/session/end-round-command.test.ts`

**⚠️ `endRound` is DEFERRED to A4 — do NOT implement or export it in A3.** Its validity depends on `chainAttacker` (the attacker mid-chain), which is only set by the `attack` machinery in A4. If A3 shipped a happy-path `endRound`, a human could send `endRound` at round start to illegally skip their turn (voluntary pass is illegal, DER #5). So A3's `applyCommand` `switch` routes `endRound` to the default (`UNKNOWN_TYPE`/no-op) until A4 adds the real handler with the guard `chainAttacker === ctx.actingSeat`. A3 wires only `build`/`pass`/`placeFirstBase`. This task is a placeholder noting the deferral.

- [x] **No A3 work** — endRound lands in A4 (Task A4.3a below). Record in the A3 Deviation note that endRound was deferred to A4.

### Task A3.5: Export the A3 surface

**Files:** Modify `src/session/index.ts` — `export { applyCommand } from "./session";`. Run typecheck + full suite. Commit. Apply the Execution Discipline block.

**After Phase A3:** review from 3+ perspectives (envelope correctness — every mutating path index-guarded; engine-throw mapping to structured errors; the A4 dependencies for attack/auto-close clearly flagged). Update Execution Status.

---

## Phase A4 — Attack handling + pending defender decisions

**Execution Status:** ✅ SHIPPED 2026-07-02 on branch `feat/session-pending-attack` — commits: cb8d5b90 + 78196836 (A4.1 pending module + review fixes: extendDefender timeout-OFF no-op, third drift surface), e52039af + 089b6da1 (A4.2 auto-close + precondition JSDoc), 10a4a589 (synthetic-board pitfall doc, Sam-requested), d5597151 + 673471b1 + 42d62302 + 2884c326 (A4.3 attack command + carve-out + atomic composition + extendDefender defense-in-depth + ABOUTME refresh), 6ba2a25a + 318bd0d5 (A4.4 agent attacks + chainAttacker clear-on-close), 3cd6791 (A4.5 cross-check), a09f6e37 (A4.6 exports). **Phase review (plan's 5 perspectives, covered across the adversarial review cycle):** defender-substitution incl. agent-attacks-human ✓ (A4.4 review verified the legalActions no-op equivalence); atomic append+tombstone-clear in ONE put ✓ (mechanism-asserted throughout; A4.3 adversarial gate proved wedged-room impossibility + throwaway-apply purity + the airtight RNG window); recordGame cross-check exercises attacks ✓ (non-vacuity hard-asserted, hundreds of attack entries); auto-close is a sanctioned existence check ✓; attacker pre-validation precedes the write-lock ✓. Two review-found defects fixed with failing-first TDD (stale chainAttacker on drive close paths; null-pending resolveDecision crash). See Deviations (A4) + Discoveries (B3 gameOver obligation, mid-setup-victory semantics, synthetic-board trap, A4.1→A4.3 seam).

**⚠️ Review-class (Sam merges): the pending write-lock + atomic defender resolution is a data-integrity core (Domain trigger). Classify `Review — pending write-lock + atomic attack resolution (data-integrity)`.**

The crux. Adds the `attack` command (human attacker), the agent attack branch in `driveOneStep`, defender proposal/substitution, the durable pending-decision flow with the global write-lock, `resolveDecision`/`extendDecision`, the no-eligible-defender guard, attack-round auto-close, and the opt-in defender-timeout alarm *intent*. Validated end-to-end by a **`recordGame` cross-check** (a reducer driving an all-agent game must produce the same log as `recordGame` — a non-tautological check against independently-trusted code, per the plan-1 lesson on tautological mutual-consistency tests).

> **`CommandCtx` is already defined in `session-types.ts` (A2.1)** — `{ actingSeat, nowEpochMs, decisionId }`. A3's `applyCommand` already takes it; A4 simply READS `ctx.nowEpochMs` (pending deadlines) and `ctx.decisionId` (the id for a pending this command opens). No signature change, no `tokenDigest` (socket→seat auth happens at the WS upgrade — B2.2/B6.2 — not via a command; the reducer never sees a token). The host populates all fields every call; tests pass fixed values via `mkCtx`. **GEO-3 (PRNG threading):** the engine RNG threads through `applyEntry` only; `decisionId` and seat tokens use the host's `crypto.getRandomValues` (NOT the engine PCG32) — identity, not game randomness.

**`toWirePending` (the storage `Pending` → wire `EncodedPending` projection) — define it in `src/session/pending.ts` (A4); it is referenced by `openDefenderDecision`, the alarm path, and `resyncPayload` (A6):**

```ts
import type { EncodedPending } from "../wire/protocol";
import type { Pending } from "./session-types";
import type { Hex } from "../engine/types";   // for the eligible: Hex[] param (P1: was missing)
/** Project a storage Pending to its wire shape — OMITS the storage-only crash-recovery fields
 *  (proposed.attackers, preDecisionLogLength, rngBeforeApply) and ADDS the client-rendered eligible set. */
export function toWirePending(p: Pending, eligible: Hex[]): EncodedPending {
  return {
    decisionId: p.decisionId, kind: p.kind, round: p.round, declaringPlayer: p.declaringPlayer,
    promptedSeat: p.promptedSeat, target: p.proposed.target, eligibleDefenders: eligible,
    deadlineEpochMs: p.deadlineEpochMs,
  };
}
```

### Task A4.1: Pending module — open / resolve / extend / eligible-defenders

**Files:**
- Create: `src/session/pending.ts`
- Test: `test/session/pending.test.ts`

**Contracts (all pure):**

```ts
// eligibleDefenders: the DERIVED set the client renders (sanctioned existence/eligibility check, spec §3).
// Fresh, owned-by-defenderOwner, within attackRange of target, != target. Uses geometry/cube (as validation.ts does).
// CALL IT WITH EXPLICIT ARGS at every site, e.g. eligibleDefenders(s.game, pending.proposed.target, pending.promptedSeat).
export function eligibleDefenders(game: GameState, target: Hex, defenderOwner: PlayerId): Hex[];

// validateAttackers: the ATTACKER-side pre-check (defense-in-depth backing the engine's apply-time enforcement).
// MUST run BEFORE openDefenderDecision acquires the write-lock — otherwise a bad attack opens a pending that can
// never resolve (applyEntry throws at apply), wedging the room (the alarm retries forever). Checks: attackers
// length in [MIN_ATTACKERS, MAX_ATTACKERS], all distinct (DUP_ATTACKERS), all owned by `attacker`, all "fresh",
// all within config.attackRange of `target`. Returns INVALID_ATTACKERS / DUP_ATTACKERS, or null.
//
// COMMITMENT CONSTANTS: there is NO exported config/engine constant for the 3..6 range — the values are private
// in src/engine/apply.ts / src/engine/legal.ts. Define LOCAL `const MIN_ATTACKERS = 3, MAX_ATTACKERS = 6;` in
// validation, after CONFIRMING those two engine files still use 3 (min) and 6 (auto-win) — the combat table
// (DER #8: 3→3/4, 4→5/6, 5→8/9, 6→auto) pins them. If the engine ever exports them, switch to the export.
export function validateAttackers(game: GameState, attacker: PlayerId, target: Hex, attackers: Hex[]): SessionError | null;

// openDefenderDecision: builds the Pending + the prompt message + the alarm intent. Does NOT apply the attack.
// PRECONDITION: validateAttackers + validateTargetAttackable already passed (the caller guarantees this).
// Called when the defending seat is HUMAN. The alarm is set ONLY when roomOptions.defenderTimeout.enabled.
export function openDefenderDecision(
  s: SessionState, proposed: AttackDecl, defenderOwner: PlayerId, ctx: CommandCtx,
): { pending: Pending; effects: Effects };

// resolveDefender: validate the chosen defender, build the final attack entry (install pending.rngBeforeApply),
// apply it, and return the entries to persist (clearing pending atomically). Then apply attack-round auto-close.
export function resolveDefender(
  s: SessionState, pending: Pending, chosenDefender: Hex,
): { next: SessionState; effects: Effects } | { error: SessionError };

// extendDefender: re-arm the deadline (only meaningful when the timeout is enabled). Persists the updated
// pending deadline + sets the alarm.
export function extendDefender(s: SessionState, pending: Pending, ctx: CommandCtx): { next: SessionState; effects: Effects };
```

**`openDefenderDecision` detail:** `deadlineEpochMs = s.roomOptions.defenderTimeout.enabled ? ctx.nowEpochMs + s.roomOptions.defenderTimeout.seconds*1000 : null`. The `Pending` carries the storage-only crash-recovery fields (`proposed`, `preDecisionLogLength = s.logLength`, `rngBeforeApply = s.game.rngState`). `effects.persist = { put: { [PENDING_KEY]: pending } }`; `effects.toSeat = [{ seat: defenderOwner, message: { type:"prompt", pending: toWirePending(pending, eligibleDefenders(s.game, proposed.target, defenderOwner)) } }]`; `effects.alarm = deadlineEpochMs ? { action:"set", atEpochMs: deadlineEpochMs } : null`. **No log entry** (the attack is not applied until resolution).

**`resolveDefender` detail:** validate via `validateAttackDecl(s.game, pending.promptedSeat, { ...pending.proposed, defender: chosenDefender })` (plan-1; returns DUP_ATTACKERS / DEFENDER_IS_TARGET / DEFENDER_INELIGIBLE). On ok, `finalDecl = { ...pending.proposed, defender: chosenDefender }`; `entry = { player: pending.declaringPlayer, kind:"attack", decl: finalDecl, rngBeforeApply: pending.rngBeforeApply }`; apply via `commitEntries(s, [entry])` (attack does not close → no snapshot); **clear the pending atomically by adding `[PENDING_KEY]: PENDING_TOMBSTONE` to that same `persist.put`** (the resolving append + the pending-clear in ONE atomic put — no delete); broadcast `applied`; `alarm: { action:"clear" }`; then run **auto-close** (below). The substituted defender is logged (spec §3). (Note: `commitEntries` builds `persist.put` with `log:N`; `resolveDefender` merges `[PENDING_KEY]: PENDING_TOMBSTONE` into it before returning — keep it a single `put`.)

- [x] **Step 1: Write failing tests** — (a) `eligibleDefenders` returns the correct fresh/in-range set; (b) **drift guard (prevents P0-7 duplication bug):** for many random states, `representativeDefender(game, target, owner)` is `null` ⟺ `eligibleDefenders(game, target, owner)` is empty, AND when non-null it is a MEMBER of `eligibleDefenders` — so the client's greyed-out set and the engine's auto-pick can never disagree; (c) `validateAttackers` rejects too-few/duplicate/fatigued/out-of-range attackers and accepts a legal set; (d) `openDefenderDecision` with timeout OFF → `alarm:null`, `deadlineEpochMs:null`; with timeout ON → alarm set, `deadline = now+seconds*1000`; (e) `resolveDefender` with an ineligible choice → `{error: DEFENDER_INELIGIBLE}`, no persist; (f) `resolveDefender` with a valid choice → one `attack` `log:N` entry **and** `[PENDING_KEY]: PENDING_TOMBSTONE` in the SAME `persist.put` (atomic clear), `alarm:clear`. **Assertion-rigor rule applies** (timing/alarm task): assert the *mechanism* — the resolving `log:N` and the pending tombstone are in ONE `persist.put`, not two separate effects.
- [x] **Step 2-5:** implement; commit `feat(session): pending defender decisions — open/resolve/extend + eligible defenders`.
- [x] **Apply the Execution Discipline block.**

### Task A4.2: Attack-round auto-close

**Files:**
- Modify: `src/session/session.ts` (a shared `autoCloseIfNoAttack` helper) or `src/session/pending.ts`
- Test: `test/session/auto-close.test.ts`

**Behavior (spec §3 endRound authorship):** after an attack entry applies and the round is still open, the session auto-appends `endRound` when **no legal attack remains** for the actor. Detection is the **sanctioned existence check**: `legalActions(game).every(a => a.kind !== "attack")` (an existence check over the actor's legal space — NOT membership testing of a specific action, which spec §3 forbids). When auto-closing, append `endRound` (`rngBeforeApply = game.rngState`) → `applyEntry` (closes → snapshot + turnRollover). This covers "fewer than 3 fresh in-range attackers remain" (you can't form an attack without ≥3 fresh in-range attackers, so no attack appears in `legalActions`).

```ts
// Returns the additional endRound entry + advanced flag, or null (round stays open for a human to continue).
function autoCloseIfNoAttack(game: GameState, actor: PlayerId): LogEntry | null {
  const hasAttack = legalActions(game).some((a) => a.kind === "attack");
  return hasAttack ? null : { player: actor, kind: "endRound", rngBeforeApply: game.rngState };
}
```

> **One atomic resolution (applies to all three attack-apply paths — A4.3 human-vs-agent-defender, A4.4 agent attack, and `resolveDefender`):** apply the attack to a throwaway post-state to evaluate `autoCloseIfNoAttack`, then build the entry list (`[attack]` or `[attack, endRound]`) and run a SINGLE `commitEntries(s, entries)` — so the attack and its auto-close `endRound` (and the boundary snapshot) land in ONE atomic `persist.put`. `resolveDefender` additionally merges `[PENDING_KEY]: PENDING_TOMBSTONE` into that same `put`. Agents take one attack per round, so the agent path is ALWAYS `[attack, endRound]` (matching `recordGame`); the human path is `[attack]` when a legal attack remains (chain continues) or `[attack, endRound]` when it doesn't.

- [x] **Step 1-5:** failing test (an attack that exhausts the attacker's legal attacks auto-closes; one that leaves a legal attack stays open) → implement → commit `feat(session): attack-round auto-close on no-legal-attack`.
- [x] **Apply the Execution Discipline block.**

### Task A4.3: The `attack` command (human attacker) + write-lock carve-out

**Files:**
- Modify: `src/session/session.ts`
- Test: `test/session/attack-command.test.ts`

**Behavior (order matters — attacker validation MUST precede acquiring the write-lock, P0-4):**
1. (No `ATTACK_NOT_SINGLE_DECL` here — the wire `attack` command carries exactly one `decl` by shape, so "exactly one declaration" is structurally guaranteed. `ATTACK_NOT_SINGLE_DECL` is reserved for the AGENT path, A4.4, where `action.attacks.length !== 1`. Attacker *count* validity is step 3.)
2. Find the target base → `defenderOwner = base.owner` (no base at target → `MALFORMED`).
3. **`validateAttackers(game, ctx.actingSeat, target, decl.attackers)`** → reject (no persist) on a bad attacker set (`INVALID_ATTACKERS` / `DUP_ATTACKERS`). **This MUST run before step 5's `openDefenderDecision`** — opening a pending with invalid attackers wedges the room (the deferred apply throws forever).
4. `validateTargetAttackable(game, target, defenderOwner)` → `NO_ELIGIBLE_DEFENDER` if none (client greys it).
5. If `seats[defenderOwner].kind === "human"` → `openDefenderDecision(...)` (write-lock; prompt; alarm if enabled). **No log entry** (attackers already validated in step 3).
6. Else (agent/auto defender) → `defender = representativeDefender(game, target, defenderOwner)`; `finalDecl = {...decl, defender}`; validate via `validateAttackDecl`; apply via `commitEntries(s,[entry])` (`rngBeforeApply = game.rngState`); then `autoCloseIfNoAttack` (append `endRound` if no legal attack remains). One atomic `persist.put` (`log:N` + optionally `endRound` + `snapshot`); broadcast.

Also extend the A3.1 write-lock guard: while `s.pending !== null`, accept ONLY `resolveDecision`/`extendDecision` that (i) carry `decisionId === s.pending.decisionId` (else for a *mutating* command → `DECISION_PENDING`; a `resolveDecision` with a stale `decisionId` → `ALREADY_RESOLVED`) **AND (ii) come from the prompted seat: `ctx.actingSeat === s.pending.promptedSeat`** (else `NOT_YOUR_TURN` — only the prompted defender may resolve or extend their own decision; without this, any room socket knowing the `decisionId` could answer for the defender or reset the liveness clock forever). Wire `resolveDecision`→`resolveDefender`, `extendDecision`→`extendDefender`. `extendDefender` re-validates `ctx.actingSeat === pending.promptedSeat` internally too (defense in depth) before re-arming.

**`chainAttacker` maintenance + the `endRound` command (deferred here from A3.4):**
- When a human `attack` applies and does **NOT** auto-close (a legal attack remains, chain continues), set `next.chainAttacker = ctx.actingSeat`. When ANY round closes (`commitEntries` returns `advanced`, via auto-close, build, pass, endRound, roundSkipped) set `next.chainAttacker = null`. (Agent attack rounds always auto-close, so they never leave `chainAttacker` set.)
- The `endRound` command handler: **reject `endRound` unless `s.chainAttacker === ctx.actingSeat`** (`NOT_YOUR_TURN` — endRound is legal only to close YOUR open attack chain; this is the guard that stops a round-start `endRound` from illegally skipping a turn). On the guard passing, `commitEntries(s, [{ player: ctx.actingSeat, kind: "endRound", rngBeforeApply: s.game.rngState }])` (closes the round → snapshot + turnRollover/gameOver), which also clears `chainAttacker`.

- [x] **Step 1: Write failing tests** — human-attacker vs agent-defender applies immediately (one `attack` entry, possibly auto-closed); human-attacker vs human-defender opens a pending (no log entry, prompt to the defender seat, write-lock blocks a concurrent `build` with `DECISION_PENDING`); a too-few/duplicate/out-of-range attacker set → `INVALID_ATTACKERS`/`DUP_ATTACKERS` (from `validateAttackers`) with NO write-lock acquired; unattackable target → `NO_ELIGIBLE_DEFENDER`; a `resolveDecision` with a stale `decisionId` → `ALREADY_RESOLVED`; `endRound` at round start (no open chain) → `NOT_YOUR_TURN`. **Assertion-rigor rule applies.**
- [x] **Step 2-5:** implement; commit `feat(session): attack command — defender proposal, substitution, write-lock`.
- [x] **Apply the Execution Discipline block.**

### Task A4.4: Agent attack branch in `driveOneStep`

**Files:**
- Modify: `src/session/agent-drive.ts` (remove the A2 "attack is A4" throw; add the branch)
- Test: extend `test/session/agent-drive.test.ts`

**Behavior:** when an agent returns an `attack` action (single decl, per v1 constraint — throw `ATTACK_NOT_SINGLE_DECL`-style error if `attacks.length !== 1`, mirroring `recordGame`): determine `defenderOwner` from the target. If the defending seat is **human** → `openDefenderDecision` and STOP driving (pending set → `needsDrive` returns false; the human is prompted — this is the agent-attacks-human case). If agent/auto → substitute `representativeDefender`, apply the `attack` entry, then **always** append `endRound` (agents take one attack per round in v1, matching `recordGame`). One atomic agent round.

- [x] **Step 1: Write failing tests** — an all-agent game driven purely by `driveOneStep` reaches a terminal state; an agent attacking a human seat opens a pending and halts the drive.
- [x] **Step 2-5:** implement; commit `feat(session): agent attack rounds in driveOneStep`.
- [x] **Apply the Execution Discipline block.**

### Task A4.5: The `recordGame` cross-check (non-tautological)

**Files:**
- Test: `test/session/drive-vs-recordgame.test.ts`

**Why (load-bearing, per the plan-1 lesson):** the reducer and `recordGame` are *independent* implementations of the same all-agent semantics (the reducer adds the interactive envelope; `recordGame` is the trusted plan-1 path). Driving an all-agent session purely through `openSession` + `driveOneStep` until terminal MUST produce a `log` and per-boundary `stateHash` sequence **identical** to `recordGame` for the same header. This catches a wrong drive composition that a reducer-vs-replay check (which shares `applyEntry`) could not.

- [x] **Step 1: Write the test** — for several seeds and seat mixes (all-greedy, all-heuristic, mixed), run `recordGame(header, {turnCap})` and a reducer-drive loop with the **real** `agentForSeat`; assert the reducer's accumulated log equals `recordGame`'s `log` and the boundary hashes match. Use `fc.assert(fc.property(...))` over seeds with `numRuns` tuned for runtime (mirror plan-1's property-test budget).

```ts
// ABOUTME: Reducer-drive == recordGame for all-agent games (non-tautological: independent implementations).
import { test, expect } from "vitest";
import { recordGame } from "../../src/session/record";
import { openSession } from "../../src/session/session";
import { needsDrive, driveOneStep } from "../../src/session/agent-drive";
import { agentForSeat } from "../../src/session/agent-binding";
import { stateHash } from "../../src/session/hash";
// for each seed: build header; const rg = recordGame(header,{turnCap:200});
// drive: let s = openSession(header, DEFAULT_ROOM_OPTIONS); const log=[]; const hashes=[];
//   while (needsDrive(s) ...) { const {next,effects,advanced}=driveOneStep(s,agentForSeat);
//     for each log:N in effects.persist.put push entry; if advanced push stateHash(next.game); s=next; }
// expect(log).toEqual(rg.log); expect(hashes).toEqual(rg.boundaryHashes);
```

> **Reconcile the turn cap + terminal handling** so both stop at the same point (born-terminal, victory, turnCap). If the reducer drive and `recordGame` diverge, that is a REAL defect in the drive composition — investigate via `superpowers:systematic-debugging`; do NOT loosen the assertion to a hash-only or length-only check (assertion-rigor rule). This test is the single highest-value correctness anchor in Part A.
>
> **Also assert the `gameOver` mechanism:** for a seed whose game reaches a victory (not the turnCap), the reducer drive emits **exactly one `gameOver`** broadcast at the terminal round and **no `turnRollover`** at that round (the victory round does not `advanceRound`). This is the only place a win is communicated — without the assertion, the P0-2/P0-3 regression (silent victory) could come back.

- [x] **Step 2-4:** run (expect green once A4.4 is correct); commit `test(session): reducer-drive equals recordGame for all-agent games`.
- [x] **Apply the Execution Discipline block.**

### Task A4.6: Export the A4 surface

Modify `src/session/index.ts` — export `eligibleDefenders` and the pending helpers if the host needs them (the host calls `applyCommand`/`driveOneStep`, not the internals — export only what `src/host` imports; likely just the already-exported `applyCommand`/`driveOneStep` plus the `Pending` type). Typecheck + full suite. Commit. Apply the Execution Discipline block.

**After Phase A4:** review from 3+ perspectives (defender-substitution faithfulness incl. agent-attacks-human; the atomic append+clear-pending in ONE `persist.put` via the tombstone; the `recordGame` cross-check actually exercises attacks; auto-close uses a sanctioned existence check not membership testing; attacker pre-validation precedes the write-lock). **Review-class — Sam merges** (data-integrity core). Update Execution Status.

---

## Phase A5 — Seat-claim CAS + multi-tab

**Execution Status:** ✅ SHIPPED 2026-07-02 on branch `feat/session-seats` (stacked on PR #40's branch) — commits 82d5e9af (A5.1 claimSeat roster ack: bounds→own-seat→idempotency ordering, MALFORMED on out-of-range, ephemeral effects contract mechanism-asserted) + 356e551d (A5.2 seatRoster helper consumed by resyncPayload + barrel exports). Two-stage reviewed (Opus quality gate on the Domain surface): the forced error-shape duplication verified as a genuine import cycle; no abuse surface (ephemeral state only, zero amplification); the agent-seat-socket boundary question recorded in Discoveries for B6. Phase review perspectives: CAS-correctness under retry/duplicate ✓ (idempotency identity-asserted), token digests never touch the reducer ✓ (grep-verified — auth lives at the Part-B upgrade), idempotency keyed on requestId ✓.

**⚠️ Review-class (Sam merges): this is seat-token / socket-auth code — a Domain trigger, never pre-authorized.** The PR body MUST classify `Review — seat-token/seat-claim auth (session management Domain trigger)`.

Seat-claim is a single-event check-and-set: one winner per seat, idempotent per `requestId`, tokens admit multiple concurrent sockets (multi-tab), and duplicate submissions are arbitrated by `expectedLogIndex`/`decisionId` (already handled in A3/A4). The reducer owns the CAS *logic*; the DO (B6) owns socket→seat attribution and token-digest comparison on each message.

### Task A5.1: `claimSeat` CAS + token digest

**Files:**
- Create: `src/session/seats.ts`
- Test: `test/session/seats.test.ts`
- (`SeatRuntime` already has `authorizedDigest` / `claimed` / `lastRequestId` from A2.1 — do NOT add another digest field.)

**Auth model (resolves the two-flows contradiction): the socket authenticates at the WS UPGRADE, not via `claimSeat`.** The upgrade carries the seat token; the DO (B2.2/B6.2) computes its digest, compares to the seat's `authorizedDigest` (bound at room init), and on success binds the socket to that seat via `serializeAttachment({seat, ...})`. So by the time ANY command (including `claimSeat`) arrives, `ctx.actingSeat` is already the authenticated seat. `claimSeat` is therefore a lightweight **roster ack**, not an authentication step — the reducer never sees a token or digest.

**Behavior:**
- `claimSeat(s, { seat, requestId }, ctx) → { next, effects }`:
  - **Verify the ack targets the socket's own seat:** if `ctx.actingSeat !== seat` → `NOT_YOUR_TURN` error reply, no change (a socket may only claim the seat it authenticated as).
  - **Idempotency per `requestId`:** if `s.seats[seat].lastRequestId === requestId`, return the same `seatClaimed{seat, requestId}` reply, no change.
  - **On success:** set `claimed: true`, `lastRequestId: requestId` (in-memory `next` only); reply `seatClaimed{seat, requestId}`. Multi-tab: a second socket on the same seat (same authenticated seat) acks the same seat — also success.
  - **`effects.persist = null`** — seat runtime (`claimed`/`lastRequestId`) is **ephemeral** UI/roster state, NOT persisted. The durable auth fact is the seat's `authorizedDigest`, which lives in the room **header bundle** (written once at init, B3.1) and is restored on rehydrate. `claimed` is re-derived as "false" on wake (sockets reconnect and re-ack); `lastRequestId` resets (re-acking is naturally idempotent). This is why `SEAT_TAKEN` does NOT exist in Phase 1 — there is one valid token per seat, bound at init; the one-winner CAS over UNBOUND seats is **Phase 2** (cross-device join).
  - `claimSeat` is **not** a mutating game command (no log entry, no `expectedLogIndex`) — exempt from the A3.1 envelope guards, allowed even while a decision is pending.

- [x] **Step 1: Write failing tests** — `claimSeat` for the socket's own `ctx.actingSeat` → `seatClaimed`, `claimed:true`, `effects.persist === null`; a `claimSeat` for a different seat → `NOT_YOUR_TURN`, no change; the same `requestId` re-claim is idempotent; a second ack on the same seat also succeeds (multi-tab). **Testing-pitfall §5 note:** `claimSeat` is a pure sync function — a "concurrent race" here is two sequential calls; assert the deterministic property (idempotent re-ack, wrong-seat rejected). The DO-level concurrency property (input gate serializes racing acks, multi-tab fan-out) is tested in **B7** under `runInDurableObject`.
- [x] **Step 2-5:** implement; commit `feat(session): seat-claim CAS + token-digest (multi-tab)`.
- [x] **Apply the Execution Discipline block.**

### Task A5.2: Export the A5 surface + seat roster

**Files:** Modify `src/session/index.ts` — export `claimSeat` and a `seatRoster(s): SeatRosterEntry[]` helper (used by resync, A6). Typecheck + full suite. Commit `feat(session): export seat-claim surface`. Apply the Execution Discipline block.

**After Phase A5:** review from 3+ perspectives (CAS correctness under retry/duplicate; token digest never leaks the raw token; idempotency keyed on `requestId`). **Review-class — Sam merges.** Update Execution Status.

---

## Phase A6 — Resync, version handshake, events, malformed-traffic shapes

**Execution Status:** ✅ SHIPPED 2026-07-02 on branch `feat/session-resync` — commits d50d1a3f + 491c984c (A6.1 seat-private resync + extend→resync deadline pin), e90614c3 (A6.2 hello handshake), 4ed0bda4 (A6.3 2-player ironWeights at the single commitEntries emission point, GEO-5/GEO-8 cited), 86750f58 (A6.4 transport error constructors — unwired until B6.2 consumes them, by design), 3648fb0c (A6.5 the Part-A acceptance: mixed human+agent real-board game, human-vs-human pending resolved end-to-end via resolveDecision, raw log replays via replayLog to the byte-identical state). Phase review perspectives: resync privacy — no prompt leak; every resyncPayload caller passes the authenticated seat and the wire resync command structurally carries no seat field ✓; handshake reload vs the B3.3 storage-mismatch mechanism distinguished in comments ✓; the integration smoke exercises a human-defended attack on a REAL generated board ✓. **PART A COMPLETE — the pure reducer is a mergeable, independently usable interactive session core.**

Consolidates the resync payload (used on join/reconnect/index-mismatch), the `hello` version handshake, the `turnRollover` 2-player iron-weight fill, and the structured shapes for malformed traffic (the *enforcement* — count-limit + close — is the DO's job in B6; A6 defines the error messages + the handshake logic).

### Task A6.1: `resyncPayload` + `seatRoster`

**Files:**
- Modify: `src/session/session.ts` (consolidate the A3 minimal `resyncReply` into one `resyncPayload`)
- Test: `test/session/resync.test.ts`

**Behavior (single locked signature — `resyncPayload(s, requestingSeat, reason)`; A3 introduced it, A6 is its canonical home):**

```ts
export function resyncPayload(s: SessionState, requestingSeat: number, reason: string | null): ServerMessage {
  // The defender prompt is PRIVATE — include it ONLY in the prompted seat's resync, never another seat's.
  const showPending = s.pending !== null && s.pending.promptedSeat === requestingSeat;
  return {
    type: "resync",
    snapshot: encodeState(s.game),
    logLength: s.logLength,
    pending: showPending ? toWirePending(s.pending!, eligibleDefenders(s.game, s.pending!.proposed.target, s.pending!.promptedSeat)) : null,
    seats: seatRoster(s),
    protocolVersion: PROTOCOL_VERSION,
    replayVersion: s.header.replayVersion,
    reason,
  };
}
```

Spec §3 resync payload. The `requestingSeat` argument is what makes the prompt seat-private; every caller (A3 STALE_INDEX reject, A6.2 handshake, the host's reconnect path) passes the authenticated seat.

- [x] **Step 1: Write failing tests** — resync after some moves carries the right `logLength` + a decodable snapshot (`decodeState` round-trips); a pending defender prompt appears in the *prompted* seat's resync but NOT another seat's. **Assertion-rigor:** assert the prompt is omitted for non-prompted seats (a privacy/mechanism assertion).
- [x] **Step 2-5:** implement; replace A3's minimal `resyncReply`; commit `feat(session): resyncPayload + seat roster`.
- [x] **Apply the Execution Discipline block.**

### Task A6.2: `hello` version handshake

**Files:**
- Modify: `src/session/session.ts`
- Test: `test/session/handshake.test.ts`

**Behavior:** `handleHello(s, { protocolVersion, replayVersion })` → if `protocolVersion !== PROTOCOL_VERSION` OR `replayVersion !== s.header.replayVersion` → reply `{type:"reload"}` (the client hard-reloads — cached SPA vs redeployed DO, spec §3 version handshake). Else reply a `resync`. **Note:** a `replayVersion` mismatch at the *handshake* (client bundle vs room) means the client's cached assets are stale → reload. This is distinct from the DO's *storage* `replayVersion`-mismatch handling (B3), which is about an old log under new engine semantics.

- [x] **Step 1-5:** failing test (matching versions → resync; mismatched → reload) → implement → commit `feat(session): hello version handshake`.
- [x] **Apply the Execution Discipline block.**

### Task A6.3: `turnRollover` iron weights (2-player)

**Files:**
- Modify: `src/session/agent-drive.ts` + `src/session/session.ts` (fill `ironWeights` where `turnRollover` is emitted)
- Test: `test/session/turn-rollover.test.ts`

**Behavior:** at a round boundary in a 2-player game, the turn-order draw is iron-proportional (DER #12). The `turnRollover` event carries `order` + `ironWeights` for the HUD draw ceremony. **`ironWeights` is indexed by `PlayerId`** — `ironWeights[pid] = control(game, pid).iron.length` for each player id (so the client aligns a weight to each player; document this indexing in the type comment). Compute from `control` (GEO-5: recomputed at point of use, never cached; GEO-8/DER-17: `control` already excludes non-ally perimeter interior — use it as-is). For 3+ players, `ironWeights: null` (the 3+ order rule is not iron-weighted — DER #13). This is broadcast-only (replay-derivable), never logged.

- [x] **Step 1-5:** failing test (2P rollover carries non-null `ironWeights` summing-consistent with `control`; 3P carries null) → implement → commit `feat(session): turnRollover iron weights for 2-player draw`.
- [x] **Apply the Execution Discipline block.** Cite GEO-5 + GEO-8 in a comment near the `control` call.

### Task A6.4: Malformed-traffic error shapes

**Files:**
- Modify: `src/wire/protocol.ts` (already has the codes) + a small `src/session/errors.ts` mapping helper if useful
- Test: `test/session/malformed.test.ts`

**Behavior:** define the canonical structured-error constructors the DO uses for `MALFORMED` (bad JSON / schema), `UNKNOWN_TYPE` (unknown command `type`), `OVERSIZED` (payload over the cap). The *enforcement* (count-limit-before-close, the size cap value) is B6; A6 provides the message shapes so host + client agree. Keep it tiny — these are constructors returning `{type:"error", code, message, currentLogIndex}`.

- [x] **Step 1-5:** failing test (the constructors produce the documented shapes) → implement → commit `feat(session): malformed-traffic error shapes`.
- [x] **Apply the Execution Discipline block.**

### Task A6.5: Final Part-A barrel + a Part-A integration smoke

**Files:**
- Modify: `src/session/index.ts`
- Test: `test/session/part-a-integration.test.ts`

**Behavior:** a single end-to-end-ish test in plain vitest that plays a short **mixed human+agent** game purely through the reducer functions: open → setup placements (mix of `placeFirstBase` commands + agent drive) → a few rounds incl. a human-attacks-human pending resolved by `resolveDecision` → assert the final state via `replayLog` over the accumulated log equals the reducer's `game`. **Accumulate the RAW `LogEntry[]` from each `effects.persist.put`'s `log:N` values** (these are stored raw — bigints intact), NOT from the encoded `applied` broadcasts (those are `EncodedLogEntry`, and re-decoding them would just re-test the codec). Then `replayLog(header, rawLog).state` should structurally equal the reducer's final `game`. This IS a legitimate check — `replayLog` is independent of the interactive command path; it shares only `applyEntry`, already proven correct via the A4.5 `recordGame` cross-check. This is the Part-A acceptance test.

- [x] **Step 1-5:** write the integration test → ensure green → commit `test(session): Part-A mixed human+agent integration smoke`.
- [x] **Apply the Execution Discipline block.**

**After Phase A6 (end of Part A):** review from 3+ perspectives (resync privacy — no prompt leak; handshake reload vs storage-mismatch distinction; the integration smoke exercises a human-defended attack). **Part A is now a complete, pure, vitest-tested interactive session reducer — mergeable and usable independently (it also backs a future client-local sandbox).** Update Execution Status; the top-of-plan table should show A1–A6 shipped before Part B starts.

---

# PART B — `GameRoom` Durable Object host + Worker + staging deploy

Part B is the thin host that *performs* the reducer's effects on Cloudflare. It runs on `workerd`; its tests run under Node in CI via `@cloudflare/vitest-pool-workers`. **All platform syntax below was verified against current Cloudflare docs (2026-06-29).** Three corrections to earlier assumptions are baked in: (1) storage value cap is **2 MB** for SQLite-backed DOs (not 128 KiB — that's the legacy KV backend); (2) bigints store **natively** via structured clone, so DO storage keeps raw `GameState`/`LogEntry` (no codec) while the wire uses the codec; (3) the `await put → broadcast` ordering is justified by **persist-first** (never expose client-visible state that isn't durably committed), not by any (uncitable) claim about output-gate coverage of hibernation `ws.send()`.

> **Purity reminder (architectural decision #2):** `src/host/**` MUST NOT *directly* `import` `src/agent` or `src/driver` at value level. It drives agent seats by importing `agentForSeat` from `src/session/agent-binding.ts` (the one sanctioned binding) and passing it into `driveOneStep`. The Worker bundle transitively includes `src/agent` (necessary for vs-agents) — that is fine; what's guarded is that the engine barrel `src/index.ts` stays agent-free for the client bundle. Pitfall **DO-PURITY-1** (B9).

## Phase B1 — Shared-config scaffolding

**Execution Status:** ✅ SHIPPED 2026-07-02 on branch `feat/host-config` — commits 9dd81593 (B1.1 wrangler.jsonc) + c95ad8cb (committed placeholder-assets generator, no-clobber), 01f5e252 + e4126b6e (B1.2: vitest 2.1.9→4.1.9 + pool 0.18.0 + workers-types; projects config with the node glob `test/**/*.test.ts` preserved and `test/host/**` carved out; tsconfig.host.json with `"files": []`; .gitignore covers worker-configuration.d.ts), f5ac197c (B1.3: REPLAY_VERSION=3ac0b788dbcc353d / AGENT_VERSION=d1c2fe210dc2bb5d, 26/8-file closures, --check discrimination-proven; additive node-shims extension — flagged to the sweep track). **B1.1 verification used `bunx wrangler types` (config-shape pass; both dry-runs fail only on the expected missing worker.ts entry, per this task's own carve-out).** Only two vitest-4 migration points across 1970 tests, both call-site-only (3-arg it() form; testTimeout 120s — verified STRICTER than vitest 2's unenforced sync-body timeouts). Phase review verdicts (Opus blast-radius gate): SAFE to merge before B8 (empty host project never instantiates the workerd pool — verified against the installed pool + workerd install path for fresh CI); `src/session/types.ts` correctly OMITTED from the replay closure (pure type exports, fully erased; behavior-affecting LogEntry changes necessarily edit the gated codec.ts/round.ts); B7 intel recorded: `cloudflareTest()` plugin form, helpers import from `cloudflare:test`.

**⚠️ Classify the PR `Review — shared build/CI config + first Worker surface` (Sam eyes the wrangler config + the vitest version bump).** Carries the **`## Shared-config changes`** heading.

Stands up the Worker config + the workers test pool **without breaking the existing node suite** (the sweep track's `test/sweep/*` must keep running). Config-only — **not TDD**; the gate is "typecheck + full suite green + `bunx wrangler deploy --dry-run` succeeds."

### Task B1.1: `wrangler.jsonc`

**Files:**
- Create: `wrangler.jsonc`

- [x] **Step 1: Create `wrangler.jsonc`** (verified against the wrangler 4.x `config-schema.json` + current docs). **`durable_objects` is NON-INHERITABLE — it is repeated in `env.staging` on purpose; do NOT "DRY" it away.** `migrations` is top-level only (envs inherit + track their own apply-state). `run_worker_first` is an `assets` sub-field. `/api/*` deep-matches `/api/games/:id/ws`.

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "industrial-juggernaut",
  "main": "./src/host/worker.ts",
  "compatibility_date": "2026-06-29",
  // No compatibility_flags: the host uses only Workers + WebCrypto APIs, no node:* imports.
  "observability": { "enabled": true, "head_sampling_rate": 1 },
  "assets": {
    "directory": "./dist/client",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "durable_objects": {
    "bindings": [{ "name": "GAME_ROOM", "class_name": "GameRoom" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["GameRoom"] }],
  "env": {
    "staging": {
      "name": "industrial-juggernaut-staging",
      // NON-INHERITABLE — must repeat verbatim:
      "durable_objects": {
        "bindings": [{ "name": "GAME_ROOM", "class_name": "GameRoom" }]
      }
      // assets, observability, compatibility_date, main inherit. migrations is top-level.
    }
  }
}
```

> **The `dist/client` assets dir does not exist yet** (it's the SPA plan's output, deliverable 2) and `dist/` is gitignored, so do NOT try to commit a placeholder into it (it won't commit, and force-adding into a gitignored build dir is a smell). Instead, the assets dir is **generated at dry-run/deploy time**: add a tiny `scripts/ensure-placeholder-assets.ts` (or a `mkdir -p dist/client && printf '<!doctype html><title>Industrial Juggernaut (staging)</title>' > dist/client/index.html` shell step) that the deploy workflow (B8.2) runs **before** `wrangler deploy`, and that you run locally before `wrangler deploy --dry-run`. The real SPA build replaces this when deliverable 2 lands. **Do NOT** build a real SPA here (out of scope). `new_sqlite_classes` is **irreversible** after first deploy — that's why it's pinned at `v1`.

- [x] **Step 2: Verify** `bunx wrangler deploy --dry-run` (and `--dry-run --env staging`) succeeds (no deploy — dry run only; **never** a real local deploy). Expected: it validates config + bundles. If it complains about the missing DO class (`GameRoom` not yet implemented), that's expected until B3 — re-run the dry-run after B3, and for B1 accept a config-validation pass via `bunx wrangler types` (which validates the binding shape). State which check you used.
- [x] **Step 3: Commit** — `git commit -m "chore(host): wrangler.jsonc — Worker + GameRoom DO + assets + staging env"`

### Task B1.2: vitest workers pool (preserve the node suite)

**Files:**
- Modify: `package.json` (append devDeps + scripts)
- Modify: `vitest.config.ts` (→ projects shape)
- Modify: `tsconfig.json` (exclude host) + Create `tsconfig.host.json`

- [x] **Step 1: Bump to the LATEST vitest + the matching pool, then verify the pool's config API — do this BEFORE writing any config.** The repo is pinned at **`vitest ^2.0.0`**; the workers pool needs vitest 4.x. **Decision (Sam, 2026-06-29): bump to the latest vitest (4.x) and the latest `@cloudflare/vitest-pool-workers` — NO fallback to an older vitest/pool.** Steps:
  1. **Bump:** `bun add -d vitest@latest @cloudflare/vitest-pool-workers@latest` (pin the resolved versions). This is a **two-major vitest bump (2 → 4) across all ~386 existing tests** (engine + session + sweep) — expect breakage and treat fixing it as IN-SCOPE remediation, not a blocker.
  2. **Run the FULL suite** (`bun run test`) immediately. **Fix every broken test** as the remediation path — migrate to the vitest-4 API (config shape, deprecated matchers, `vi` API changes) while **preserving each test's assertions** (a vitest-4 migration must keep coverage; fix the call site, do NOT weaken the assertion — assertion-rigor rule). Flag the bump + the fixes in the PR (`## Shared-config changes`) so the sweep track isn't surprised it shares the dependency.
  3. **Verify the pool's config API against the INSTALLED version** (it changed across releases: older `defineWorkersConfig` + `poolOptions.workers`; newer a `cloudflareTest()` Vite plugin in `plugins:[]`). Read the installed package's README/`dist` exports and use whichever it exposes — Step 3 below shows the plugin form; if the installed version differs, use its form (and verify the B7 helper import paths, `cloudflare:test` vs `cloudflare:workers`). Record the installed versions + API as a Deviation.

- [x] **Step 2: Append to `package.json`** (append-only to `devDependencies` + `scripts`; `wrangler` is already present):

```jsonc
// devDependencies (add):
"@cloudflare/vitest-pool-workers": "^0.16.20",
"vitest": "^4.1.0",            // bump only if currently < 4.1.0; see Step 1
// scripts (add; keep existing "test"):
"test:host": "vitest run --project host",
"test:node": "vitest run --project node"
```

`bun run test` (existing `vitest run`) runs BOTH projects after the config change below.

- [x] **Step 3: Convert `vitest.config.ts`** to the projects shape. **Current verified API:** the `cloudflareTest()` *Vite plugin* from `@cloudflare/vitest-pool-workers` (NOT the old `defineWorkersConfig`/`poolOptions.workers`; `vitest.workspace.ts` is deprecated). The node project preserves `test/**/*.test.ts` (sweep depends on it) and excludes `test/host/**` so host tests don't double-run.

```ts
// ABOUTME: Vitest config — a plain-node project (engine/session/wire/sweep) + a workerd pool project (DO host).
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        // PRESERVE the existing node glob (sweep track depends on test/sweep/* matching here).
        test: { name: "node", include: ["test/**/*.test.ts"], exclude: ["test/host/**"] },
      },
      {
        plugins: [cloudflareTest({ main: "./src/host/worker.ts", wrangler: { configPath: "./wrangler.jsonc" } })],
        test: { name: "host", include: ["test/host/**/*.test.ts"] },
      },
    ],
  },
});
```

> The workers project must NOT set a custom `environment`/`runner` (the plugin owns the runtime). `main` is required so `runInDurableObject` can reach the real `GameRoom` instance (CF research). Until B2/B3 create `src/host/worker.ts`, the host project has no tests (B7 adds them) — that's fine; an empty project is a no-op.

- [x] **Step 4: Worker-scoped tsconfig.** Modify `tsconfig.json` to `"exclude": ["src/host", "test/host", ...existing]` (keeps the engine/session/wire typecheck Workers-types-free, proving they don't use Worker globals). Create `tsconfig.host.json`:

```jsonc
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": ["@cloudflare/workers-types"]   // or the generated worker-configuration.d.ts (bunx wrangler types)
  },
  "include": ["src/host", "test/host"]
}
```

Update the `typecheck` script to run both: `"typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.host.json --noEmit"`. Add `@cloudflare/workers-types` to devDeps (or run `bunx wrangler types` to generate `worker-configuration.d.ts` and reference it). **Do NOT** add Workers types to the root tsconfig (project convention: don't relax the root; the host tsconfig extends it).

- [x] **Step 5: Verify** `bun run typecheck` (both projects) + `bun run test` (both projects; host project empty for now) → green. `bun.lock` will change (new devDeps) — expected; commit it.
- [x] **Step 6: Commit** — `git commit -m "chore(test): vitest workers pool project + Worker tsconfig (node suite preserved)"`

### Task B1.3: `version.ts` + the replay-version script (created EARLY — B2 depends on it)

**Files:**
- Create: `scripts/compute-replay-version.ts`
- Create: `src/host/version.ts`
- Test: `test/version.test.ts` — **placed in `test/` (the NODE project), NOT `test/host/`** (it imports plain string constants + the hash script; no workerd needed, and the node project runs faster).

**Why here (not B8):** `worker.ts` (B2.2) stamps `header.replayVersion` from `src/host/version.ts`, so the constant must EXIST before B2 (codex P1-12 cross-task ordering). B1 creates the script + the committed constants; B8 only adds the CI `--check` guard step + the deploy workflow.

- [x] **Step 1:** write `scripts/compute-replay-version.ts` hashing the full replay closure (see B8.1 for the exact file set: `engine`+`rng`+`board`+`geometry`+`session/round.ts`+`session/hash.ts`+`session/codec.ts`+`session/replay.ts`) → a stable hex digest; `AGENT_VERSION` = hash of `src/agent/**`. Support a `--check` flag (compare to the committed constant, exit non-zero on mismatch).
- [x] **Step 2:** run it once; write the computed values into `src/host/version.ts` as `export const REPLAY_VERSION = "<hash>"; export const AGENT_VERSION = "<hash>";` (+ the 2-line ABOUTME). `version.ts` has no Worker-API usage — it's plain string constants (typechecks under either tsconfig).
- [x] **Step 3:** `test/version.test.ts` (node project) asserts `REPLAY_VERSION === computeReplayVersion()` and `AGENT_VERSION === computeAgentVersion()` (so an unbumped closure change fails the test AND the B8 `--check`). Commit `feat(host): replayVersion/agentVersion constants + compute script`.
- [x] **Apply the Execution Discipline block.**

**After Phase B1:** review from 3+ perspectives (node glob preserved for sweep; vitest bump impact assessed; root typecheck stays Workers-types-free; the replay-closure file set is complete). **`## Shared-config changes`** must list every edited file. Update Execution Status.

## Phase B2 — Worker shell + room addressing

**Execution Status:** ✅ SHIPPED 2026-07-02 on branch `feat/host-worker` — commits c1f2de5f (B2.1: Crockford ids/tokens/digest, FIPS-vector-pinned; FIRST workerd-pool tests — the pool RUNS UNDER BUN locally, the plan's anticipated DX gap did not materialize), 7ac0e334 (B2.2: Worker fetch, 19-case validation table, HUMAN-ONLY token minting per the auth resolution, reject-unknown-top-level-keys proves host stamping, GameRoom 501 stub; `bunx wrangler deploy --dry-run` PASSES — the first deployable-shaped Worker), a1de3906 (adversarial hardening: integer/finite gates on all 9 numeric config keys + combatTable [0,1]; fixed-board coord gates |c|≤1024 before loadBoard; 256KB body cap with declared+actual-length gates; MAX_FIXED_HEXES 1200; init-status check — 500 + no tokens on a failed init; Object.hasOwn vs prototype-walking `in`; 12 exploit regressions failing-first). DO-PURITY-1 verified by bundle inspection (zero src/agent refs). Host suite 61 tests; full suite 2031. Phase review: adversarial gate round-1 findings all killed and verified dead by code-path tracing in round-2. Carried forward: the init-500 test obligation (Discoveries ⚠️ B3/B7); the engine-level loadBoard coordinate gap chipped for the balance track.

**⚠️ Review-class: the room-creation route mints seat tokens (socket-auth surface). Classify `Review — room creation + seat-token minting (session-management Domain trigger)`.**

The Worker `fetch` entry: assets are served by the assets binding; `/api/*` is routed to the Worker (`run_worker_first`). Routes: `POST /api/games` (create room → mint room id + seat tokens), `GET /api/games/:id/ws` (WebSocket upgrade → DO). Room IDs are **≥96-bit crypto-random base32 via `crypto.getRandomValues`** (NOT the engine PCG32 — pitfall DO-ID-1). The DO uses `idFromName(roomId)`. An `initialized` storage flag distinguishes create from join (uninitialized rooms reject joins).

### Task B2.1: ID + token generation

**Files:**
- Create: `src/host/ids.ts`
- Test: `test/host/ids.test.ts` (runs in the workers pool — `crypto` is available)

**Behavior:** `newRoomId(): string` → ≥96-bit identifier from `crypto.getRandomValues(new Uint8Array(12))`, encoded with a **pinned, URL-safe base32 alphabet** (Crockford base32 — `0-9A-HJKMNP-TV-Z`, no padding, case-insensitive; share links must stay stable and copy-paste-safe). `newSeatToken(): string` → 128-bit token from 16 random bytes in the same alphabet. `tokenDigest(token: string): Promise<string>` → hex SHA-256 via `crypto.subtle.digest("SHA-256", ...)`. Pin the alphabet as a module constant so room IDs are reproducible across encode/decode. **GEO-3 reminder:** these use WebCrypto, NEVER the engine PCG32 — room/seat identity is not game randomness and must not consume or depend on the engine RNG stream.

- [x] **Step 1-5:** failing test (ids are the right length/charset; digests are stable + 64 hex chars; two `newRoomId` calls differ) → implement → commit `feat(host): crypto-random room ids + seat tokens + digest`.
- [x] **Apply the Execution Discipline block.** (Tests live in `test/host/**` → workers pool.)

### Task B2.2: Worker `fetch` + routing

**Files:**
- Create: `src/host/worker.ts`
- Test: `test/host/worker.test.ts`

**Behavior:** export `default { fetch }` + `export { GameRoom }` (the DO class, created in B3 — for B2 export a minimal stub so the Worker compiles + `wrangler deploy --dry-run` passes; B3 fills it). `fetch`:
- `POST /api/games` → `roomId = newRoomId()`; mint seat tokens for each seat (Phase-1: all issued to the creator); `stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(roomId))`; call `stub.fetch(initRequest)` to initialize the room (header + roomOptions + seat token digests + set `initialized`); return `{ roomId, seatTokens }`. **The request body carries the designer-instrument config** (seats, RuleConfig, boardSource, seed, roomOptions) — **schema-validate it as untrusted input** before constructing the header. Explicit checks (each failure → a friendly 400 with the offending field, spec §8): `seats.length` in `[2,6]`; each seat is one of `{kind:"human"}` / `{kind:"agent",agent:"greedy",archetype}` / `{kind:"agent",agent:"heuristic"}`; `boardSource.kind` in `{"generate","fixed"}` and, for generate, `size` in the supported range (e.g. `[96,300]`) + `ironCount` a positive integer, for fixed a `loadBoard`-validatable `def` (catch `loadBoard`'s throw → 400); `seed` a decimal string parseable by `BigInt()` (catch → 400); `config` either omitted (→ `defaultConfig()`) or a `RuleConfig`-shaped object (validate the known numeric/boolean keys; reject unknown keys to avoid silently dropping a typo); `roomOptions.defenderTimeout` `{enabled:boolean, seconds:positive int}` (→ `DEFAULT_ROOM_OPTIONS` if omitted). Do NOT trust client-supplied `replayVersion`/`formatVersion` — the host stamps those from `src/host/version.ts` + the constant `1`.
- `GET /api/games/:id/ws?seat=N&token=<seatToken>` with `Upgrade: websocket` → `stub.fetch(request)` (forward to the DO; the DO does the `WebSocketPair` + auth). Reject non-upgrade or unknown room. **Auth transport (P1):** the seat token rides as a **query parameter** (browser `WebSocket` cannot set arbitrary request headers). The DO validates it at accept (B4/B6.2: `tokenDigest(token) === seat.authorizedDigest`) BEFORE `acceptWebSocket`; on mismatch it closes with code `1008` / a 4xx and never accepts. **Accepted leakage tradeoff (v1):** the token sits in the WS URL (TLS-encrypted in transit, but visible in server access logs / browser history). This is acceptable for v1 because the share link is already the room capability and tokens are per-game, single-use-ish, and revocable by ending the game; **do NOT log the query string** (DO-AUTH-1). Phase 2's join UX can swap to a prior HTTP claim that exchanges the token for a short-lived upgrade capability — note that as the Phase-2 hardening.
- everything else under `/api/*` → 404 (assets handle non-`/api` paths via SPA fallback).

- [x] **Step 1: Write failing tests** (workers pool, using `SELF.fetch` or the worker handler) — `POST /api/games` returns a roomId + seatTokens; a malformed config body → 400; a WS upgrade to a created room returns 101; a WS upgrade to an unknown/uninitialized room → 404/rejected. **Schema-validate the create body** (reject unknown board sources, out-of-range player counts).
- [x] **Step 2-5:** implement; commit `feat(host): Worker fetch — room create + ws upgrade routing`.
- [x] **Apply the Execution Discipline block.** Review-class.

**After Phase B2:** review from 3+ perspectives (untrusted-input validation on create; crypto-random ids not PCG32; the `initialized` create-vs-join flag). Update Execution Status.

## Phase B3 — `GameRoom` DO: storage layout + critical section + recovery

**Execution Status:** ✅ SHIPPED 2026-07-02 on branch `feat/host-gameroom` — commits ccd9d54c (B3.1 storage: atomic persistEvent, snapshot/tail, bigints-native proven; `Snapshot` type hoisted to session-types as the single shared shape; FROZEN_KEY added to keys.ts), 73d9e09f (B3.2 critical section: persist→alarm→send order proven by recorded-op-order tests — put strictly before its send, put(PENDING)

**⚠️ Review-class (Sam merges): atomic storage + the persist-first critical section + recovery is the data-integrity core of the host. Classify `Review — DO storage atomicity + critical-section + recovery (data-integrity)`.**

The heart of Part B. The DO holds the in-memory `SessionState` (a cache, rebuilt on any wake from storage), performs the reducer's `Effects`, and owns the critical section + recovery. **Storage is the single source of truth.**

### Task B3.1: Storage layer

**Files:**
- Create: `src/host/storage.ts`
- Test: `test/host/storage.test.ts`

**Behavior:** thin helpers over `ctx.storage` using the `src/session/keys.ts` layout. Stores **raw** objects (structured clone — bigints persist natively; NO codec on the storage path).
- `writeHeader(ctx, { header, roomOptions, authorizedDigests, initialized: true })` (one atomic put at room init), `readInitialized(ctx)`, `readHeaderBundle(ctx)`, `readPending(ctx)` (maps a `PENDING_TOMBSTONE` or absent value → `null`), `readFrozen(ctx)`.
- `persistEvent(ctx, op: PersistOp): Promise<void>` → **`await ctx.storage.put(op.put)`** — ONE atomic multi-key put (CF research: a single `put({...})` of ≤128 keys is all-or-nothing; our events write at most ~4 keys: `log:N`, optional `log:N+1`, `snapshot`, `pending`). The pending **clear** is already encoded as `[PENDING_KEY]: PENDING_TOMBSTONE` inside `op.put` (B3 keystone — see PersistOp), so there is **no separate `delete`** and nothing to make non-atomic. The 2 MB SQLite-backed per-row cap (NOT 128 KiB — that's the legacy KV backend; DO-STORAGE-1) is far above any row (a snapshot is ~3–9 KB).
- `loadSnapshotAndTail(ctx): { snapshot, tail: LogEntry[] }` — `get(SNAPSHOT_KEY)` + `list({prefix:"log:", start: logKey(snapshot.logIndex+1)})` for the tail (lexical key order == numeric order via zero-padding).

- [x] **Step 1: Write failing tests** (workers pool, `runInDurableObject` to reach a real `ctx.storage`) — round-trip a header (bigint seed survives raw via structured clone, no codec); `persistEvent` of an op whose `put` contains both `log:N` and `[PENDING_KEY]: PENDING_TOMBSTONE` lands BOTH (and `readPending` then returns `null`); `loadSnapshotAndTail` returns the post-snapshot entries in order. **Assertion-rigor:** assert atomicity by the *mechanism* — after the `persistEvent`, `readPending(ctx) === null` AND `get(logKey(N))` is present (both from the one put), not "no error."
- [x] **Step 2-5:** implement; commit `feat(host): DO storage layer — atomic persistEvent + snapshot/tail load`.
- [x] **Apply the Execution Discipline block.** Concurrency/atomicity → assertion-rigor rule.

### Task B3.2: The DO + critical section

**Files:**
- Create: `src/host/game-room.ts`
- Test: `test/host/critical-section.test.ts`

**Behavior:** the `GameRoom extends DurableObject`. Holds `private session: SessionState | null` (cache). On each mutating message:

```
validate → apply (reducer, sync) → AWAIT storage transaction → broadcast → (drive agents in a loop)
```

The handler (`handleCommand`), exactly:
1. Rehydrate `this.session` from storage if null (B3.3 recovery — itself ends by driving agents).
2. (Caller `webSocketMessage`, B4, already authenticated → `actingSeat` from `ws.deserializeAttachment()`, and built `ctx`.)
3. `const { next, effects } = applyCommand(this.session, command, ctx)` — **synchronous, pure, no await.**
4. If `effects.persist`: `await persistEvent(this.ctx.storage, effects.persist)`. `this.session = next`. **Then realize `effects.alarm`** (`await ctx.storage.setAlarm/deleteAlarm`) **BEFORE** sending `effects.reply`/`effects.toSeat`/`effects.broadcast`. Order: **persist → arm/clear alarm → send.** (Codex P1-15: arming the timeout before the defender prompt is sent prevents a stall if `setAlarm` fails after the prompt goes out; combined with the rehydrate re-arm in B3.3, a missed `setAlarm` self-heals on the next wake.) **Every broadcast strictly follows its awaited persist** (persist-first).
5. `await this.driveAgents()` — the shared loop: `while (!this.frozen && needsDrive(this.session)) { const r = driveOneStep(this.session, agentForSeat); await persistEvent(this.ctx.storage, r.effects.persist); this.session = r.next; this.broadcast(r.effects.broadcast); if (r.terminal) break; }`. **Each agent round is its own persist→broadcast pair, in that order.** A frozen room (B3.3 divergence) drives nothing.

> **Concurrency invariant (precise — replaces the imprecise "only await"):** the handler issues SEVERAL awaited storage writes (the human event, then one per agent round). The guarantee is **per-event**: every `broadcast` is emitted *after* the `await persistEvent` of the entry(ies) it announces — never before. There is **no non-storage await** anywhere in `handleCommand`/`driveAgents` (no `fetch`, no timers, no `subtle.digest` — those happen in `webSocketMessage` *before* calling `handleCommand`). The DO **input gate** guarantees no *other* incoming event (`webSocketMessage`/`alarm`/`fetch`) is delivered while any of these awaits is outstanding, so the whole handler runs to completion atomically w.r.t. other events — the multiple awaits do not admit interleaving. (If a future change must hold the gate across a non-storage await, wrap the section in `this.ctx.blockConcurrencyWhile(...)`; v1 needs no such await, so it is not used.) Never `allowConcurrency`/`allowUnconfirmed` on these writes.

> **Ordering rationale (corrected):** the broadcast happens **after** the awaited `persistEvent` because **client-visible state must never precede a durably-committed write** (persist-first). We make the ordering explicit rather than relying on undocumented output-gate coverage of the hibernation `ws.send()` path. On a storage failure the platform discards the in-flight DO and restarts from storage (output gate); a client that missed a broadcast self-heals on reconnect/resync. **Never** `allowConcurrency`/`allowUnconfirmed` on game writes (CF research: both opt out of the gates that make this safe). Pitfall **DO-ORDER-1** (B9).

> **Testable seam (resolves the B3-needs-B4 ordering):** the critical-section logic lives in a method `async handleCommand(command: ClientCommand, ctx: CommandCtx): Promise<void>` on the DO (the authenticated seat is `ctx.actingSeat` — no separate param) — it does NOT read a WebSocket. B4's `webSocketMessage(ws, msg)` is the thin wrapper that reads the authenticated seat (`ws.deserializeAttachment().seat`; auth happened at the upgrade), parses, builds `ctx: CommandCtx` (`{ actingSeat: seat, nowEpochMs: Date.now(), decisionId: <crypto id> }`), and calls `handleCommand`. This lets B3.2 test the whole critical section via `runInDurableObject(stub, (inst) => inst.handleCommand(cmd, mkCtx(0)))` — no WebSocket needed until B4. The send helpers (`broadcast`/`toSeat`/`reply`) are also methods (B6.1) the DO calls; B3.2 can spy on them.

- [x] **Step 1: Write the failing test** — the load-bearing **"broadcast never precedes the awaited storage write"** check, asserted by **recorded operation order** (NOT timestamps — a clock comparison would race). Via `runInDurableObject`, wrap `ctx.storage.put` and the socket `send` so each appends a tagged marker to one shared ordered array (e.g. `ops.push({op:"put", keys})` / `ops.push({op:"send", type})`); drive a mutating command; then assert the array shows the `put` containing `log:N` at an index **strictly before** the `send` of the `applied` message for that `logIndex`. **Mechanism assertion (observed ordering), never a symptom assertion ("no error").** If it races, fix with deterministic synchronization (await fences), NEVER by weakening.
- [x] **Step 2-5:** implement the DO + critical section; commit `feat(host): GameRoom critical section — validate/apply/await-put/broadcast`.
- [x] **Apply the Execution Discipline block.** Concurrency → assertion-rigor rule (this is THE task it most protects).

### Task B3.3: Recovery — snapshot + tail + replayVersion mismatch

**Files:**
- Modify: `src/host/game-room.ts`
- Test: `test/host/recovery.test.ts`

**Behavior:** `rehydrate()` (called on every wake path when `this.session === null`):
1. Load the header bundle (header + roomOptions + per-seat `authorizedDigest` + `initialized` + `frozen`). Seat runtime `claimed`/`lastRequestId` are NOT stored (ephemeral — P1-9); they reset on wake.
2. Build the session **cheaply** (the steady-state, `replayVersion`-match path): start from `openSession(header, roomOptions)`, then if a snapshot exists install `snapshot.state` as `game` and `logLength = snapshot.logIndex + 1`, then apply the **post-snapshot tail** (`loadSnapshotAndTail`) via `applyEntry` from `snapshot.logIndex + 1` (the snapshot holds the post-`advanceRound` state, so the tail applies with no extra `advanceRound`). If no snapshot yet (early game), replay the whole log from `openSession`. Reload `pending` (a tombstone or absent value → `null`). Rebuild seat runtime: `authorizedDigest` from the header bundle, `claimed: false`, `lastRequestId: null` (sockets re-ack on reconnect). **Derive `chainAttacker` from the log** (it is not persisted): an `attack` entry does NOT close the round, so `chainAttacker = (the LAST applied log entry is kind === "attack") ? thatEntry.player : null` — this exactly reconstructs an open attack chain across eviction, so a reconnecting attacker can still send `endRound`. **If `pending` is non-null and `pending.deadlineEpochMs !== null`, re-arm the timeout alarm: `await ctx.storage.setAlarm(pending.deadlineEpochMs)`** (self-heals a `setAlarm` that failed before eviction; idempotent — overwrites the single alarm slot; P1-15).
3. **`replayVersion` mismatch** (`snapshot.replayVersion !== REPLAY_VERSION`) — rare; the B8 CI guard normally prevents an engine change without a version bump. Per spec §3, **no migration — continue play under the new engine from the snapshot state**, but ONLY when we can prove no divergence. **There is exactly ONE stored hash (the snapshot's); the post-snapshot tail has NO stored per-entry hash**, so the tail cannot be validated under new semantics. Therefore:
   - Re-replay `log[0 .. snapshot.logIndex]` from `openSession` under the CURRENT engine, compute `stateHash`, compare to `snapshot.stateHash`.
   - **If the snapshot hash DIVERGES → freeze** (the already-played game replays differently under the new engine).
   - **If the snapshot hash matches but the post-snapshot TAIL is non-empty → freeze anyway** — an open attack chain past the snapshot would be re-interpreted under the new engine with no hash to catch a silent change. (Codex P1-7: snapshots are only at round boundaries, so a mid-chain tail is unverifiable.)
   - **Only if the snapshot matches AND the tail is empty → continue** under the new engine.
   - Freeze = persist a `frozen` flag; every mutating command → `FROZEN` error; resync + the replay viewer still work, labeled "recorded under engine v<snapshot.replayVersion>". Never silently re-replay old entries under new semantics. (This whole branch is the expensive path, taken ONLY on a version mismatch — which the CI guard makes rare.)
4. **Re-run the agent-drive loop (the agent-drive invariant — this is what self-heals after a deploy/eviction):** after rehydrating, call `this.driveAgents()` — `while (needsDrive(this.session) && !frozen) { const r = driveOneStep(this.session, agentForSeat); await persistEvent(this.ctx.storage, r.effects.persist); this.session = r.next; this.broadcast(r.effects.broadcast); if (r.terminal) break; }`. Without this, a room that crashed mid-agent-turn would wake and stall until a human message. `driveAgents()` is a shared method called after rehydrate AND after every applied command (B3.2 step 7) AND after the alarm resolves (B5).

> **Determinism (GEO-3):** recovery re-runs `applyEntry`, which installs each entry's `rngBeforeApply` before applying — reproducing combat/turn draws exactly without re-executing agent policies. This is the locked replay model (do NOT "use the preceding entry's post-state"). Agent re-drive after recovery is deterministic (the agent draws from the restored `game.rngState`), so re-driving produces the same entries — making the post-crash agent-drive idempotent.

- [x] **Step 1: Write failing tests** (workers pool + `evictDurableObject`) — (a) write some rounds, force eviction, send a new message → the DO rehydrates and continues correctly (state matches a fresh `replayLog` over the stored log); (b) **agent-drive self-heal:** a vs-agents room evicted while it is an agent's turn → on the next wake (e.g. a reconnect `fetch`) the DO drives the agent rounds forward without a human message; (c) a stored snapshot whose `replayVersion` matches → cheap path (no full re-replay); (d) a stored snapshot with a mismatched `replayVersion` whose snapshot-boundary re-replay hashes-equal → continues; (e) a snapshot whose re-replay **diverges** → room freezes (mutating command → `FROZEN`). **Assertion-rigor:** assert the freeze *mechanism* (a mutating command after divergence returns `FROZEN`) and the self-heal *mechanism* (agent log entries appear after a no-command wake), not just "no crash."
- [x] **Step 2-5:** implement; commit `feat(host): recovery — snapshot+tail, replayVersion-mismatch freeze-on-divergence`.
- [x] **Apply the Execution Discipline block.**

**After Phase B3:** review from 3+ perspectives (the single-await critical section; atomic persist incl. pending-clear; recovery determinism + the freeze path; persist-first rationale stated correctly). Update Execution Status.

## Phase B4 — Hibernation

**Execution Status:** ⬜ NOT STARTED

WebSocket Hibernation so idle rooms cost nothing and survive eviction. **Verified API:** `ctx.acceptWebSocket(server, tags?)`, class-level `webSocketMessage/Close/Error`, `ws.serializeAttachment/deserializeAttachment` (16 KiB cap), `ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping","pong"))`, `ctx.getWebSockets(tag?)`. **`setTimeout`/`setInterval` are forbidden** (they prevent hibernation AND die on eviction — use the alarm, B5).

### Task B4.1: Upgrade + hibernation handlers + auto-response

**Files:**
- Modify: `src/host/game-room.ts`
- Test: `test/host/hibernation.test.ts`

**Behavior:**
- In the DO `fetch` (WS upgrade): `const {0:client,1:server} = new WebSocketPair(); this.ctx.acceptWebSocket(server, [seatTag]); return new Response(null,{status:101, webSocket: client})`. Tag the socket by seat (`seat:<n>`) so `getWebSockets("seat:<n>")` finds a seat's sockets (multi-tab).
- `ws.serializeAttachment({ seat, malformedCount: 0 })` at accept time, AFTER the upgrade-time token check passed (B6.2) — `seat` is the authenticated identity, `malformedCount` is the per-socket abuse counter that must survive hibernation (≤16 KiB cap, trivially under). `deserializeAttachment()` on each `webSocketMessage` recovers `seat` → `ctx.actingSeat` (no re-auth needed; the upgrade already validated the token). Do NOT store the raw token in the attachment (DO-AUTH-1).
- `this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping","pong"))` in the constructor — the client's app-level `ws.send("ping")` (~25 s; the client cannot emit protocol pings) is answered **without waking the DO** (no billable duration).
- `webSocketMessage(ws, message)`: the critical-section entry (B3.2). `webSocketClose`/`webSocketError`: mark the socket gone (presence is advisory; B6). **Lazy rehydrate** (`if (!this.session) await this.rehydrate()`) at the top of every wake path (`webSocketMessage`, `alarm`, `fetch`).

- [ ] **Step 1: Write failing tests** (workers pool + `evictDurableObject(stub, { webSockets: "hibernate" })`) — open a WS, send a command, **force hibernation**, send another command on the same socket → it still round-trips (the DO rehydrated session + the socket survived); an app-level `"ping"` gets `"pong"` without invoking `webSocketMessage` (assert the auto-response, e.g. the message handler counter did not increment). Note the **Windows + SQLite-DO limitation (workerd#6110)** — these tests are skipped on win32 in the official fixture; **Linux CI is fine** (our CI is Linux). Mark the skip + reason if developing on macOS/Windows locally.
- [ ] **Step 2-5:** implement; commit `feat(host): WebSocket hibernation — accept/handlers/auto-response/serializeAttachment`.
- [ ] **Apply the Execution Discipline block.** Concurrency/wake → assertion-rigor rule.

**After Phase B4:** review from 3+ perspectives (no `setTimeout`/`setInterval` anywhere; lazy-rehydrate on every wake path; auto-response doesn't wake; attachment carries seat+digest only, never the raw token). Update Execution Status.

## Phase B5 — Defender-timeout alarm (opt-in)

**Execution Status:** ⬜ NOT STARTED

The single alarm consumer in v1: the **opt-in** defender timeout (architectural decision #4 — OFF by default). Armed only when `roomOptions.defenderTimeout.enabled` and a pending decision is open. The `extendDecision` ("I'm still thinking") path re-arms it. The Phase-2 `alarmQueue` multiplex hook is **documented** (not built) so the Phase-2 GC subagent has a target.

### Task B5.1: The alarm handler (idempotent)

**Files:**
- Modify: `src/host/game-room.ts`
- Test: `test/host/alarm.test.ts`

**Behavior:** the `alarm(alarmInfo?)` handler (a bare `setAlarm(atEpochMs)` carries NO decision id — so identity/recency is checked via the stored `pending`, not the alarm):
1. Lazy-rehydrate (`if (!this.session) await this.rehydrate()`).
2. **No-op if `pending` is absent/tombstone** (the decision was already resolved — the "fire-after-answer" case; the answer's atomic put cleared it).
3. **Recency guard (handles `extendDecision` + at-least-once retries):** if `pending.deadlineEpochMs !== null && Date.now() < pending.deadlineEpochMs`, the live deadline is in the FUTURE — this alarm is stale (it was for a deadline that `extendDecision` pushed later, or an early retry). **Re-arm `await ctx.storage.setAlarm(pending.deadlineEpochMs)` and return** (do NOT resolve). The alarm handler MAY call `Date.now()` (it is host code, not the pure reducer). [If `deadlineEpochMs === null` the timeout is off and no alarm should exist — defensively no-op.]
4. Else (`Date.now() >= pending.deadlineEpochMs`): resolve. `const def = representativeDefender(this.session.game, pending.proposed.target, pending.promptedSeat);` — **guard the `Hex | null` return: if `def === null`** (can't happen under the write-lock, which froze the board since `validateTargetAttackable` passed at open — but defense in depth) **do NOT call `resolveDefender(null)`**; instead **freeze the room** (persist the `frozen` flag, same mechanism as B3.3 divergence; mutating commands → `FROZEN`) and `deleteAlarm()` so the alarm does not retry-loop — leaving `pending` intact for post-mortem. If non-null, `resolveDefender(this.session, pending, def)` → the single atomic put (resolving `attack` + `PENDING_TOMBSTONE`) → broadcast (B3 tail) → `driveAgents()`.

**At-least-once + idempotency (CF research):** alarms retry on uncaught exception with **exponential backoff (2 s start, ≤6 retries)**. The handler MUST be idempotent: because the resolving `log:N` append **and** the pending-clear (`[PENDING_KEY]: PENDING_TOMBSTONE`) land in ONE atomic `put` (B3.1), a retry after a mid-handler failure re-reads `pending` (still the live record — the prior attempt didn't commit) and re-resolves identically; once committed, `readPending` returns `null` (tombstone) → the retry no-ops at step 2. **Never** leave `pending` live without the matching append, or tombstone it without the append — the single atomic put guarantees both-or-neither.

- [ ] **Step 1: Write failing tests** (workers pool + `runDurableObjectAlarm(stub)`) — arm a timeout on a human-defended attack (room with timeout ON), fire the alarm → the attack resolves with the representative defender (one `attack` log entry, pending cleared); fire the alarm **after** the human already answered → no-op (no duplicate entry); a room with timeout OFF never arms an alarm (a human-defended attack leaves `getAlarm()` null). **Assertion-rigor (alarm/idempotency):** assert the mechanism — fire-after-answer produces **zero** additional log entries; drive the alarm explicitly via `runDurableObjectAlarm`, never a real timer.
- [ ] **Step 2-5:** implement; commit `feat(host): defender-timeout alarm — idempotent representative-defender resolution`.
- [ ] **Apply the Execution Discipline block.** Alarm/idempotency → assertion-rigor rule.

### Task B5.2: Arm / re-arm / clear + the Phase-2 alarmQueue hook

**Files:**
- Modify: `src/host/game-room.ts`
- Test: extend `test/host/alarm.test.ts`

**Behavior:** realize the reducer's `AlarmIntent`:
- `{action:"set", atEpochMs}` → `await this.ctx.storage.setAlarm(atEpochMs)` (only emitted when `defenderTimeout.enabled`).
- `{action:"clear"}` → `await this.ctx.storage.deleteAlarm()`.
- `extendDecision` → the reducer emits a fresh `{action:"set"}` with the new deadline + persists the updated `pending.deadlineEpochMs`; the DO re-arms. So a human clicking "I'm still thinking" resets the clock.

**Phase-2 `alarmQueue` multiplex hook (DOCUMENT ONLY — do NOT build):** a single DO has one alarm slot. v1's only consumer is the defender timeout. When Phase 2 adds room-TTL GC (a second consumer), multiplex via a stored `alarmQueue` row — a sorted list of `{ atEpochMs, kind, payload }`; the `alarm()` handler dispatches the earliest-due entry by `kind` and re-arms `setAlarm` to the next. Write this as a commented contract in `game-room.ts` near the `alarm()` handler + a one-paragraph note in B9's pitfalls, so the Phase-2 GC subagent has a concrete target. **Ship the single-consumer form.**

- [ ] **Step 1-5:** failing test (set arms `getAlarm()`; clear nulls it; extend pushes the deadline later) → implement → commit `feat(host): defender-timeout arm/re-arm/clear + documented alarmQueue Phase-2 hook`.
- [ ] **Apply the Execution Discipline block.**

**After Phase B5:** review from 3+ perspectives (OFF-by-default honored — no alarm armed when disabled; idempotent fire-after-answer; the extend reset; the alarmQueue hook is documented not built). Update Execution Status.

## Phase B6 — Socket attribution + malformed-traffic enforcement

**Execution Status:** ⬜ NOT STARTED

**⚠️ Review-class: per-message seat-token authentication (socket-auth Domain trigger). Classify `Review — per-socket seat-token auth + malformed-traffic enforcement`.**

Multi-tab routing (a seat token admits many sockets), per-message authentication, and the malformed-traffic count-limit-before-close.

### Task B6.1: Send routing (broadcast / toSeat / reply) + send-failure handling

**Files:**
- Modify: `src/host/game-room.ts`
- Test: `test/host/send-routing.test.ts`

**Behavior:** realize the reducer's effect routing —
- `broadcast` → every socket: `for (const ws of this.ctx.getWebSockets()) trySend(ws, msg)`.
- `toSeat[{seat, message}]` → `for (const ws of this.ctx.getWebSockets("seat:"+seat)) trySend(ws, msg)` (the defender prompt reaches all of that seat's tabs).
- `reply` → the originating socket only.
- `trySend(ws, msg)` wraps `ws.send(JSON.stringify(msg))` in try/catch; on failure mark the socket gone (presence is advisory UI state — spec §3). Encode messages once (the `applied`/`resync` payloads are already JSON-safe via the wire codecs).

- [ ] **Step 1: Write failing tests** (multi-tab: open two sockets on the same seat, assert a `toSeat` prompt reaches both; a `broadcast` reaches all seats' sockets; a `reply` reaches only the sender). **Assertion-rigor:** assert delivery to the *exact* socket set (mechanism), not just "≥1 send happened."
- [ ] **Step 2-5:** implement; commit `feat(host): send routing — broadcast/toSeat/reply + send-failure marks dead`.
- [ ] **Apply the Execution Discipline block.**

### Task B6.2: Per-message authentication + malformed count-limit

**Files:**
- Modify: `src/host/game-room.ts`
- Test: `test/host/malformed-auth.test.ts`

**Behavior:**
- **At accept (B4, async in the DO `fetch`):** parse `?seat=N&token=...` from the upgrade URL; compute `await tokenDigest(token)` and compare to `this.session.seats[N].authorizedDigest` (rehydrate first if needed). On mismatch/absent → **do NOT `acceptWebSocket`**; return `new Response("bad seat token", {status: 1008-equivalent 403})` or close. On success → `acceptWebSocket(server, ["seat:"+N])` + `serializeAttachment({ seat: N, malformedCount: 0 })`. (The digest comparison is the ONLY auth; per-message handlers then trust the attachment's `seat`.)
- **Per message:** `const att = ws.deserializeAttachment()`; `att.seat` IS the authenticated identity (validated at accept, survives hibernation) → it becomes `ctx.actingSeat`. Parse JSON → on failure / unknown `type` / oversized (`> MAX_MESSAGE_BYTES`, e.g. 64*1024) → send a structured `error` (`MALFORMED`/`UNKNOWN_TYPE`/`OVERSIZED`), **increment `att.malformedCount`, re-`serializeAttachment`**, and at a threshold (e.g. 8) send a final error + `ws.close(1008, "too many malformed messages")`. The count survives hibernation (it's in the attachment).

> **Why the count lives in the attachment, not memory:** an in-memory per-socket counter is lost on hibernation, letting an abuser reset their malformed budget by idling. The attachment survives hibernation (16 KiB cap — a small int is trivial). Pitfall DO-HIBER-1 (B9).

- [ ] **Step 1: Write failing tests** — a bad seat token at upgrade → rejected; N malformed messages → N structured errors then a close at the threshold; the count persists across an `evictDurableObject` hibernation (the abuser can't reset by idling). **Assertion-rigor + concurrency rule.**
- [ ] **Step 2-5:** implement; commit `feat(host): per-socket seat-token auth + malformed count-limit-before-close`.
- [ ] **Apply the Execution Discipline block.** **Review-class — Sam merges.**

**After Phase B6:** review from 3+ perspectives (multi-tab fan-out correctness; auth at accept + attachment trust; malformed count survives hibernation). **Review-class.** Update Execution Status.

## Phase B7 — vitest-pool-workers DO test suite (integration matrix)

**Execution Status:** ⬜ NOT STARTED

Earlier phases unit-test each piece in the pool. B7 ensures the **full spec §7 + this plan's "Definition of done" integration matrix** is covered as cohesive scenarios and adds shared test helpers. **API per CF research (2026-06-29) — VERIFY the exact import paths against the installed package version (B1.2 Step 1.3); they have changed across releases:** `env` (from `cloudflare:test` in older releases, `cloudflare:workers` in newer); `runInDurableObject`/`runDurableObjectAlarm`/`listDurableObjectIds` from `cloudflare:test`; `evictDurableObject(stub, {webSockets})` for hibernation; per-test-file storage isolation (automatic). **Windows + SQLite-backed DOs is broken (workerd#6110) — our CI is Linux (fine); skip on win32 locally with a reason.**

### Task B7.1: Test helpers + the integration matrix

**Files:**
- Create: `test/host/helpers.ts` (open a room, open a WS to a seat, send a command, evict, collect messages)
- Create: `test/host/integration.test.ts`
- Test: itself

**Coverage matrix (each an explicit test; some assert at the integration level what earlier unit tests asserted in isolation):**
1. **Hibernation wake-replay** — play rounds, `evictDurableObject({webSockets:"hibernate"})`, next message continues correctly.
2. **Alarm idempotency (fire-after-answer)** — `runDurableObjectAlarm` after a human answer → no duplicate entry.
3. **`serializeAttachment` round-trip** — seat identity survives hibernation.
4. **Seat auth + multi-tab** — a WS upgrade with a valid `?seat=N&token=...` accepts; a wrong/absent token → upgrade rejected (no `acceptWebSocket`); two sockets on the SAME valid token both attach to seat N (multi-tab success); a `claimSeat` ack is idempotent per `requestId`. (One-winner CAS over UNBOUND seats is Phase 2 — NOT tested here; the Phase-1 model is one pre-bound token per seat.)
5. **Double-submit / `expectedLogIndex` rejection** — a replayed command with a stale index → `resync`, no double-apply.
6. **Reconnect-during-pending** — a defender disconnects mid-prompt, reconnects → resync re-sends the outstanding prompt (only to the prompted seat).
7. **Snapshot + tail recovery** — evict mid-game, rehydrate, assert state equals a fresh `replayLog`.
8. **Broadcast never precedes the awaited `storage.put`** — the canonical ordering assertion (also in B3.2; here at the integration level).

- [ ] **Step 1: Write the helpers + the 8 scenario tests.** Use a fake/scripted `agentForSeat` where determinism helps (the injection seam pays off again for a **scripted** seat — relevant to the staging e2e smoke later). **Every concurrency/timing assertion is a mechanism assertion; the assertion-rigor rule governs the whole file — if any scenario flakes, fix with deterministic synchronization (await fences, explicit `runDurableObjectAlarm`), never by weakening.**
- [ ] **Step 2-5:** ensure green under the workers pool; commit `test(host): DO integration matrix — hibernation/alarm/seat-race/recovery/ordering`.
- [ ] **Apply the Execution Discipline block.**

**After Phase B7:** review from 3+ perspectives (matrix completeness vs spec §7 + this plan's "Definition of done"; no flaky symptom-only assertions; Windows-skip reasoned). Update Execution Status.

## Phase B8 — deploy-staging.yml + version guards + CI pool job

**Execution Status:** ⬜ NOT STARTED

**⚠️ `## Shared-config changes` (edits `ci.yml`). Classify `Review — CI/deploy wiring + first staging deploy surface`.** Not TDD (CI/config); the gate is "CI green on a real PR + a successful staging deploy from `dev`."

### Task B8.1: confirm the version artifacts (created in B1.3)

**Files:**
- Already created in **B1.3**: `src/host/version.ts`, `scripts/compute-replay-version.ts`, `test/host/version.test.ts`. B8.1 only confirms they exist and are correct; the CI `--check` step + deploy workflow land in B8.2. (If B1.3's closure list needs a tweak, do it here and note a Deviation.)

**Reference — what those artifacts do:** `compute-replay-version.ts` hashes the sorted contents of the **full replay transitive closure** — every file whose change alters how a STORED LOG is re-interpreted — and is NOT limited to spec §3's stated `engine+rng+board` (codex P1-8: that set is incomplete). The closure is: `src/engine/**` + `src/rng/**` + `src/board/**` + **`src/geometry/**`** (hull/distance/control geometry that combat + control + stranding depend on) + **`src/session/round.ts`** (`applyEntry` — the replay composition itself) + **`src/session/hash.ts`** (`stateHash` — the divergence checksum) + **`src/session/codec.ts`** (`rngBeforeApply` encode/decode) + **`src/session/replay.ts`** (`replayLog`). It does NOT include the interactive reducer files (`session.ts`/`pending.ts`/`agent-drive.ts`/`seats.ts`) — those drive LIVE play, not stored-log replay — nor any agent-pulling file. `src/host/version.ts` exports the committed `REPLAY_VERSION` (used by `worker.ts` to stamp `header.replayVersion`) and `AGENT_VERSION` (hash of `src/agent/**` only — build/deploy/observability, **never** a replay gate, so an agent tweak doesn't discard in-flight game tails; spec §3 version split). A `bun run scripts/compute-replay-version.ts --check` step **fails CI** if the computed hash ≠ the committed `REPLAY_VERSION` (forcing a deliberate bump when any replay-closure file changes). **This deviates from spec §3's narrower `engine+rng+board` definition — record it as a Deviation; the wider closure is the correct one** (a change to `applyEntry` or `control` geometry MUST bump the version, or in-flight games silently corrupt on the next deploy).

- [ ] **Step 1:** confirm `bun run scripts/compute-replay-version.ts --check` exits 0 against the committed `REPLAY_VERSION` (B1.3), and that `worker.ts` (B2.2) stamps `header.replayVersion = REPLAY_VERSION`. No new code unless B1.3's closure list was wrong; if you change it, re-run + recommit `version.ts` and note a Deviation.
- [ ] **Apply the Execution Discipline block.**

### Task B8.2: `ci.yml` host-test job + `deploy-staging.yml`

**Files:**
- Modify: `.github/workflows/ci.yml` (append a Node host-test job + the replay-version `--check` step)
- Create: `.github/workflows/deploy-staging.yml`

- [ ] **Step 1: Append to `ci.yml`** a Node-runtime job for the workers pool (the existing bun `check` job runs `bun run test:node` + typecheck + build + the replay-version `--check`; the new job runs the host project under Node — **spec §7 mandates DO-host tests run under Node in CI**):

```yaml
  host-tests:
    runs-on: ubuntu-latest   # Linux — avoids the win32 SQLite-DO limitation (workerd#6110)
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npx vitest run --project host
```

> Adjust the existing `check` job's test step to `bun run test:node` so the bun job no longer attempts the workerd pool (which spec §7 scopes to Node). Add the replay-version guard step `bun run scripts/compute-replay-version.ts --check` to `check`. **Local DX caveat:** on the bun-only dev machine, `bun run test:host` may not run the workerd pool — host tests are then **CI-gated** (acceptable; spec §7: "the bun-local question only decides local DX; CI has Node regardless"). Note this in the PR.

- [ ] **Step 2: Create `.github/workflows/deploy-staging.yml`** — push to `dev` → staging deploy. Uses the secrets Sam already set:

```yaml
name: deploy-staging
on: { push: { branches: [dev] } }
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      # wrangler bundles the Worker (src/host/worker.ts) itself — no `bun run build` needed for the Worker.
      # Only the assets dir must exist; generate the placeholder until the SPA build (deliverable 2) replaces it:
      - run: mkdir -p dist/client && printf '<!doctype html><title>Industrial Juggernaut (staging)</title>' > dist/client/index.html
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy --env staging
```

> **Do NOT** add `promote.yml`, `PROMOTE_TOKEN`, or production deploy here — those are the Sam-gated cutover plan. This plan ends at a **green staging deploy from `dev`**. The first push to `dev` after this merges should produce a live `industrial-juggernaut-staging` Worker; verify it deployed (check the Actions run + the staging URL) and record the staging URL in the Execution Status notes.

- [ ] **Step 3:** verify on a real PR (CI green incl. the host-tests job) and, after merge, a successful staging deploy. Commit `ci(host): Node host-test job + replay-version guard + deploy-staging workflow`.
- [ ] **Apply the Execution Discipline block.** **`## Shared-config changes`** lists `ci.yml`. Review-class.

**After Phase B8:** review from 3+ perspectives (host tests run under Node in CI; replay-version guard actually fails on an unbumped engine change; staging deploy uses the existing secrets, no new ones). Update Execution Status + record the staging URL.

## Phase B9 — DO/wire pitfalls documentation

**Execution Status:** ⬜ NOT STARTED

Adds the new `DO-*` pitfall entries (none exist yet — the pitfalls docs cover only the engine). **Not TDD** (docs); the gate is the maintenance-framework completeness checklist (`docs/pitfalls/implementation-pitfalls.md` "How to Add" — assign sequential IDs, write Flaw/Why/Fix/Lesson, update the review checklist + TOC + Appendix B summary table + cross-refs). Classify `Routine` (docs only).

### Task B9.1: Add the `DO-*` entries

**Files:**
- Modify: `docs/pitfalls/implementation-pitfalls.md`

Add these entries (full Flaw/Why/Fix/Lesson each, per the maintenance framework), citing this plan's phases as the source:

- **DO-PURITY-1** — host glue must not *directly* `import` `src/agent`/`src/driver`; drive agents via the `agentForSeat` binding; the engine barrel `src/index.ts` stays agent-free so the **client** bundle never pulls agents (the Worker bundle does — that's intended for vs-agents).
- **DO-CODEC-1** — DO **storage** stores raw structured-clone objects (bigints native — no JSON); the **wire** uses the codec (JSON-safe, bigints → decimal strings). Never JSON-encode the storage path; never send raw bigints on the wire (`JSON.stringify` throws).
- **DO-ORDER-1** — persist-first: `await storage.put` (a SINGLE atomic multi-key `put`, no `transaction` — the pending-clear rides as a tombstone in the same `put`) **before** broadcast, **and the alarm is armed before the prompt is sent**; the rationale is "client-visible state must never precede a durable write" (NOT the uncitable output-gate-covers-ws.send folklore); never `allowConcurrency`/`allowUnconfirmed` on game writes.
- **DO-STORAGE-1** — SQLite-backed DO value cap is **2 MB** (not 128 KiB, the legacy KV backend); the atomic multi-key `put` (≤128 pairs) + `transaction` for mixed put+delete.
- **DO-ID-1** — room/seat ids via `crypto.getRandomValues` (≥96-bit room, 128-bit token), **never** the engine PCG32 (identity ≠ game randomness; GEO-3-adjacent).
- **DO-AUTH-1** — store token **digests**, never raw tokens (public repo; spec §6); seat-token/socket-auth code is always **Review-class**.
- **DO-ALARM-1** — alarm handlers must be **idempotent** (at-least-once, exponential backoff, ≤6 retries); the atomic append+clear-pending makes a retry-after-failure safe; one alarm per DO → multiplex via a stored `alarmQueue` (the documented Phase-2 hook).
- **DO-HIBER-1** — no `setTimeout`/`setInterval` (prevent hibernation + die on eviction — use the alarm); **lazy-rehydrate on every wake path** (`webSocketMessage`/`alarm`/`fetch`); per-socket state that must survive hibernation (e.g. the malformed counter) lives in `serializeAttachment` (≤16 KiB), not memory.
- **WIRE-MAP-1** — engine throw MESSAGES are load-bearing for the session-layer wire mappers (`placeFirstBaseErrorCode`, `buildEngineErrorCode` in `src/session/session.ts` match `src/engine/apply.ts`/`turn.ts` message substrings; unrecognized → rethrow). Rewording an engine throw silently unmaps its wire code (fails loud via rethrow, but loses the teachable client error). Grep the session mappers before rewording engine throws. (Found in A3.3 quality review 2026-07-02.)
- **DO-TEST-1** — `@cloudflare/vitest-pool-workers` current API: the `cloudflareTest()` plugin (not `defineWorkersConfig`), `cloudflare:test` helpers (`runInDurableObject`/`runDurableObjectAlarm`/`evictDurableObject`), per-file storage isolation; **Windows + SQLite-DO is broken (workerd#6110) — Linux CI only**.

- [ ] **Step 1:** add the entries + complete the maintenance-framework checklist (IDs, review checklist §, TOC, Appendix B table, cross-refs).
- [ ] **Step 2:** verify the doc renders + the completeness checklist is done; commit `docs(pitfalls): add DO-* entries (purity/codec/ordering/storage/id/auth/alarm/hibernation/test)`.
- [ ] **Apply the Execution Discipline block** (docs scope — no TDD; the gate is the completeness checklist).

**After Phase B9 (end of Part B):** review from 3+ perspectives (every load-bearing DO decision has a pitfall entry; the entries cite phases; the maintenance checklist is complete). Update Execution Status — the top-of-plan table should show all phases shipped, and the deploy notes should carry the staging URL.

---

## Definition of done (this plan)

- A1–A6 shipped: a pure, vitest-tested interactive `GameSession` reducer + wire protocol, mergeable and usable independently.
- B1–B9 shipped: a `GameRoom` Durable Object hosted by the Worker, with hibernation, atomic storage + persist-first critical section, recovery, the opt-in defender-timeout alarm, multi-tab seat auth, the full vitest-pool-workers integration matrix, the `replayVersion` CI guard, and a green **staging** deploy from `dev`.
- New `DO-*` pitfalls documented.
- **Not** in scope (separate Sam-gated cutover plan): `promote.yml`, `PROMOTE_TOKEN`, `main` protection, default-branch flip, the doc rewrites, the golden-corpus replay-compat gate, the blocking staging e2e smoke.

## Execution strategy recommendation

**Recommended: `superpowers:subagent-driven-development`** (a fresh subagent per task, two-stage review between tasks), for these reasons:
- The plan is **highly sequential within each part** (the file-ownership table shows `session.ts` and `game-room.ts` each evolve across several phases) but **cleanly task-decomposed**, which is exactly what subagent-driven execution handles well — each task is self-contained with its own TDD cycle and commit.
- Several phases are **Review-class** (A5, B2, B6 seat-auth; B1/B8 shared-config) — a fresh subagent per task + review-between-tasks keeps those isolated for Sam's merge decision.
- The **Part A → Part B** boundary is a natural batch seam: execute and merge all of Part A (pure, fast vitest) first, then Part B (which depends on the merged reducer).
- Each phase merges to `dev` before the next starts (the file-ownership ordering), so subagent-driven's "review between tasks" maps directly onto the merge cadence.

Avoid parallel-agent execution **within** a part (the shared `session.ts`/`game-room.ts` files would conflict). Parallelism is only safe across genuinely file-disjoint tasks (e.g. B9 docs can run alongside late Part-B coding). The orchestrator should follow the file-ownership table strictly.

## Self-review (author, against spec §3 + this plan's "Definition of done")

**Spec §3 + Definition-of-done coverage:** GameRoom DO (B1 config, B3 storage/critical-section, B4 hibernation) ✓; storage layout header/log/snapshot/pending (A2 keys, B3.1) ✓; critical-section validate→apply→await put→broadcast (B3.2) ✓; command envelope expectedLogIndex+decisionId (A1, A3.1, A4.3) ✓; resync + version handshake (A6.1, A6.2) ✓; durable pending + write-lock + alarm (A4, B5) ✓; Phase-2 alarmQueue hook documented (B5.2) ✓; malformed-traffic structured + count-limit before close (A6.4, B6.2) ✓; multi-tab seat model (A5, B6.1) ✓; agent-drive via applyEntry not the agent module (A2.4/A4.4 + injected binding) ✓; replayVersion vs agentVersion (B8.1) ✓; room/seat ids via crypto.getRandomValues (B2.1) ✓; vitest-pool-workers test plan (B7, + per-phase) ✓; shared-config edit shapes (B1, B8) ✓; new DO-* pitfalls (B9) ✓.

**Decisions reflected:** one-plan-two-parts (structure) ✓; injected agentForSeat (A2.3, decision #2) ✓; src/session+src/wire+src/host naming ✓; defender-timeout OFF-by-default + still-thinking + roomOptions (A1, A4, B5, decision #4) ✓.

**Spec-claim corrections folded** (CF research + the review cycle; each is a Deviation where it changes a spec-stated value): 2 MB storage cap, not 128 KiB (B3.1, DO-STORAGE-1); bigints native in storage / codec only on the wire (A2.4, B3.1, DO-CODEC-1); persist-first rationale, not output-gate folklore (B3.2, DO-ORDER-1); single atomic `put` + pending tombstone, not put+delete/transaction (A2.1, B3.1); **`replayVersion` hash closure widened** to add `src/geometry` + `src/session/{round,hash,codec,replay}.ts` (B8.1 — an `applyEntry`/`control` change MUST bump it); **recovery freezes on a non-empty post-snapshot tail under a version mismatch** (B3.3). **Both `replayVersion`-hash and "Timeouts" were applied to spec §3 on 2026-06-29 (Sam-approved), so the spec now matches the plan.**

**Resolved by Sam (2026-06-29):** defender-timeout default interval = **120 s** when enabled (toggle still OFF by default); the **vitest bump is approved** — go to the latest vitest (4.x) + latest pool, **no fallback**, fix any broken tests as in-scope remediation (preserve assertions); spec §3 Timeouts + `replayVersion` updated. **Still asserted (defaults):** `wrangler.jsonc` `compatibility_flags` omitted (add only if a dep needs node:*); the WS-token-in-URL leakage tradeoff (B2.2 — accepted v1). All Sam-gated/deferred items (cutover, blocking staging smoke, dev branch protection, abuse floor) are flagged out-of-scope, not built here — but the cutover **admin prerequisites** now have a step-by-step in "Deferred / Sam-gated" below.

**Known residual risks (for execution):** (1) the local-DX gap for `bun run test:host` (workerd pool under bun) — CI-gated as the fallback; (2) the `dist/client` placeholder (generated in the deploy workflow) until the SPA plan lands; (3) the exact `@cloudflare/vitest-pool-workers` config API + import paths must be verified against the INSTALLED version at B1 (B1.2 Step 1.3).

## Plan Review Cycle Record

Six rounds (min 3), alternating runner self-review with independent reviewers — a fresh cold-read Claude reviewer AND a cross-model codex round (the kickoff flagged cross-model as high-value here; it was). Ran until a round produced no new substantive findings.

- **Round 1 — runner (Claude):** ~16. Undefined helpers in code blocks (`isMutating`/`errorEffects`/`resyncEffects`/`toWirePending`/`currentActor`), a forward-reference (A1 codec → A4 `Pending`), a `config: undefined as any` typo, vague "schema-validate", a `.gitignore`-unsafe assets placeholder, a misleading deploy `bun run build`, the B3-needs-B4 attachment ordering.
- **Round 2 — independent cold-read reviewer (Claude, fresh, no history):** 8 P0 + ~19 P1. **Victory never communicated to clients** (no `gameOver`; `applyEntry.terminal` ignored), **attackers not validated before the write-lock** (bad attack wedges the room), **`eligibleDefenders` duplicates the engine predicate** (drift → consistency test), the **atomic put+clear keystone under-specified** (→ single put + tombstone), the **seat-claim model contradiction**, the **vitest 2→4 bump**, a **sequential "race" test**, copy-paste bugs (`"balanced"` archetype, `{q,r,s}`, a false "engine rejects pass" note).
- **Round 3 — runner (Claude):** 4 second-order. `isMutating` malformed guard, `driveAgents` frozen guard, one-atomic attack+endRound, a `gameOver` mechanism assertion.
- **Round 4 — codex (OpenAI, cross-model, fresh session, `high` reasoning):** 16 P1 + 4 P2 — the decorrelated round found what same-provider review missed. **The two-auth-flows contradiction** (→ unified on WS-upgrade auth), **the `replayVersion` hash missing geometry + `session/round.ts`** (an `applyEntry` change wouldn't bump it → silent corruption on deploy), **the recovery tail unverifiable under a version mismatch** (→ freeze on non-empty tail), **alarm idempotency not implementable from `setAlarm(time)`** (→ compare `now` vs `deadlineEpochMs`), **`endRound` lets a human skip their turn** (→ A4 + `chainAttacker`), **`representativeDefender` `Hex|null` unguarded in the alarm**, **seat-runtime never persisted but recovery reloads it** (→ ephemeral runtime, auth in the header bundle), **alarm not armed before the prompt** (→ persist→arm→send + rehydrate re-arm), two missing imports, the **`CommandCtx` home** unspecified. Codex independently CONFIRMED the engine-symbol claims (`applyEntry` shape, `status()` victory shape + `gameOver` mapping, `representativeDefender` signature, `Hex` `{x,y,z}`, `Archetype` members).
- **Round 5 — runner (Claude):** 4 second-order of the codex fixes (A3 intro still listing `endRound`, redundant `handleCommand` param, mis-placed `version.test.ts`, `serializeAttachment` shape).
- **Round 6 — runner (Claude):** 1 polish (concrete freeze on the can't-happen alarm null) + a full consistency scan (no placeholders, single `CommandCtx`, no stale `transaction`/`tokenDigest`/`seatToken`) → convergence.

**The cross-model (codex) round and the fresh-cold-read round (R2) were where the highest-impact correctness findings came from** — the replay-version closure gap and the auth-flow contradiction were author blind spots two earlier rounds missed, consistent with the project's cross-model-plan-review learning: a decorrelated/no-history reader catches normalized assumptions.
