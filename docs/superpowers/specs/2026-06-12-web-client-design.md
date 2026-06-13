# Industrial Juggernaut — Web Client & Platform Design (DRAFT v3, post round-2 review)

**Date:** 2026-06-12
**Status:** DRAFT v3 — two adversarial review rounds complete (each: a multi-agent workflow + an independent codex consult). All confirmed P0/P1 findings folded in. Awaiting Sam's spec-review approval.
**Companion docs:** infrastructure decision in `2026-05-18-code-representation-options.md` (repo **root**, not docs/) §Web Deployment — all-TS on Cloudflare: client + Worker + Durable Object; product brief `PRODUCT.md`; visual seed `DESIGN.md`; rules `industrial-juggernaut-rules-v10.md`; git process `docs/git-strategy.md`.

## Context (established facts)

- Engine: pure ESM TypeScript, zero runtime deps, zero Node APIs — runs unmodified in Workers, Durable Objects, and browsers. Immutable `GameState` (~3.3–8.5KB), all randomness in-state via PCG32 (`RngState = {state: bigint, inc: bigint}`; both are uint64 — `JSON.stringify` throws on bigint).
- Agents consume in-state RNG during action *selection* (greedy: softmax draw; heuristic: per-build-piece + policy draws) for **every** action kind, not just attacks. An action log alone therefore cannot reproduce a game with agent seats — see the `rngBeforeApply` design in §3.
- `legalActions(state)` enumerates *representatives* only. `applyAction` is **not a complete rules oracle**: it accepts unconditional `pass`, empty `attacks: []`, duplicate attacker hexes (a guaranteed-win exploit — empirically reproduced: six copies of one fresh base → `attackers.length===6` → auto-win), and `defender === target`. Validation (§3) layers engine fixes + session checks; it never blindly delegates.
- `stepRound = applyAction → applyEliminations(actingPlayer) → removeEncircledStrandedBases`, eliminations once per whole action. The rules favor per-battle immediacy ("when you destroy a player's last base, their game is over"), so the per-declaration composition in §3 is a deliberate, rules-faithful semantics choice, not an equivalence claim.
- Engine `Action` union: `build | attack | pass`. Alliances exist only as `Player.alliance` state + coalition victory in `status()`; nothing forms/dissolves them.
- Agents: `Agent = (state, player) => {action, state}` sync/pure. greedy ~5.7ms/move, heuristic ~5.2ms (strongest), MCTS seconds-per-move (excluded from live play).
- Default config balance is known-broken (48/200 games won at setup); the balance-sweep harness (not started) owns the fix; adoption is human-gated.
- Repo: **personal** GitHub repo `scarson/industrial-juggernaut` (public); bun-only dev machine (`bun run test`, wrangler via `bunx`); CI runners have Node. TDD mandatory for `src/`. No CI, no branch protection, no wrangler config yet. Worker `industrial-juggernaut` exists in the CF dashboard.

## Decisions made in this brainstorm (Sam, 2026-06-12)

1. Play modes: vs-agents + hotseat first; online rooms (join links, no accounts) in plan scope as a later phase.
2. UI stack: React + Vite, served as Workers static assets.
3. Gitflow: two-branch — `dev` integration, `main` live/deploy; auto-promote dev→main on green CI; GitHub Actions CI; branch protection.
4. Additional plan scope (Phase 3): save/resume, replay viewer, full Map Table polish, alliances engine extension.
5. Architecture: DO-authoritative for all *multi-actor* live games; thin DO host around a pure `GameSession` module. **All-agent (zero-human) games run client-side on the pure engine** (no DO — see §1). Replay/watch reuses the pure engine client-side.
6. First-base placement: **human-choice setup phase** (faithful to the rules; the engine gains a setup phase — §5).
7. Territory model: **convex-hull is the committed digital-edition rule** (Sam's eyes-open call; accepts it plays differently from Tony's printed visibility-polygon rules — Digital Edition Ruling #1).

## Phases

| Phase | Contents | Gate to next |
|---|---|---|
| **1 — Playable core** | Engine fixes + setup phase (§5), GameSession + DO host + wire protocol incl. **seat-token mechanism** (§3), client vs-agents + hotseat + **client-side all-agent watch with a minimal game viewer** (§4), gitflow/CI/deploy pipeline (§6), staging e2e smoke | Pipeline green end-to-end; one full game playable on staging |
| **2 — Online rooms** | **Join UX** (share links, cross-device seat claiming over the wire), reconnection UX, defender prompts cross-client, **abuse & identity floor** + alarm-multiplex GC (§2/§3) | Abuse floor implemented (Review-class); default-config preset decision |
| **3 — Depth** | Polished replay viewer, save/resume surfacing, alliances (engine + protocol + UI; `formatVersion` bump), Map Table polish | — |

Sections tag phase-specific content. The seat-token *mechanism* (DO attributing sockets to seats) is Phase 1; the *join UX* (a stranger opening a share link and claiming a seat from another device) is Phase 2.

## §1 Goal & scope

A web-hosted, playable Industrial Juggernaut on the existing `industrial-juggernaut` Cloudflare Worker.

**Play modes:** vs-agents and hotseat (Phase 1, DO-hosted); online rooms via join links (Phase 2). Identity is per-game seat tokens; no accounts ever in this plan.

**Designer instrument (new-game screen):** per-seat human/agent assignment (greedy archetypes + heuristic), the full `RuleConfig` knob set grouped with validation and provenance (default vs hand-tuned), board source (generated `{size, ironCount}` or fixed `BoardDefinition` JSON — schema-validated as untrusted input), explicit seed. **Default config policy:** defaults to a named, swappable preset (`current-playtest-config`, initially the engine default) stored in one place so sweep-derived adoption is a one-line change; designer mode shows a "balance under active development" note. **Named deferral:** PRODUCT.md also asks for *sweep parameters* in-client — deferred until the balance-sweep harness exists (its config schema is the dependency); the config panel is shaped so a "sweep this knob over a range" affordance can attach later.

**All-agent (zero-human) games (PRODUCT.md "watch agent-vs-agent"):** run **entirely client-side on the pure engine** — no DO, no CPU limit, no network per move, instant; consumed through the minimal game viewer (Phase 1) with play/pause/step. This resolves the DO-CPU and phase-ordering risks of running whole agent games server-side, and gives designers an offline-capable balance-probe surface. Live multi-actor games stay DO-hosted (decision 5).

**Teaching surface (PRODUCT.md "the board teaches itself"):** a rules-reference screen that renders `industrial-juggernaut-rules-v10.md` **with the Digital Edition Rulings merged inline as callouts at the relevant sections** — never raw v10, which would teach rules the engine diverges from. Structured illegal-action error codes map to one-sentence rule explanations; contextual one-liners on defender-choice and forced-pass prompts.

**Also in scope (Phase 3):** save/resume, polished replay viewer, Map Table polish, alliances.

**Non-goals:** accounts/matchmaking/D1; MCTS as a live opponent; AlphaZero anything; the balance sweep itself; **competitive turn clocks** (liveness mechanisms below are in scope — a blocking seat affects others); offline play for *multi-actor* games (the all-agent path is the offline-capable surface; see §2 trade note).

## §2 Topology

- **One Worker** (`industrial-juggernaut`) serving the Vite-built SPA via Workers static assets, `/api/*` routes, and WebSocket upgrades to DOs. **Explicit routing config** (not header-sniffing defaults): `assets.not_found_handling: "single-page-application"` + `run_worker_first: ["/api/*"]` (WS upgrades at `/api/games/:id/ws`; confirm the glob covers the full multi-segment path — use `/api/*` and verify in `wrangler dev`, widen to `/api/**` if single-segment), plus a pinned `compatibility_date`. SPA deep links (`/room/<id>`) are served `index.html` by asset-serving; `/api/*` is pinned to the Worker. Config is `wrangler.jsonc` (JSON syntax).
- **One DO class `GameRoom`**, one per multi-actor game, **SQLite-backed** (`new_sqlite_classes` in migration tag v1 — irreversible after first deploy, hence specified). Storage uses the **KV API** (`storage.put/get`) on the SQLite backend (no `sql.exec` — the chosen key layout needs no schema; values are structured-clone blobs, so `RngState` bigints store natively; all stored values sit far under the 128 KiB KV-API per-value cap). **DO storage is the single source of truth; in-memory `GameSession` is a cache rebuilt on any wake.**
- **Hibernation discipline:** Hibernation API only — `state.acceptWebSocket()` + class-level `webSocketMessage/webSocketClose/webSocketError`; `setTimeout`/`setInterval` forbidden in the DO (both die on eviction and defeat hibernation). Seat identity rides on each socket via `serializeAttachment` ({seat index, token digest} — far under the 16KB cap). Keepalives: the **client sends application-level `ws.send("ping")`** on a ~25s interval (browsers cannot emit protocol ping frames; protocol pings, if any, are auto-ponged by the runtime); the DO uses `state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping","pong"))` to answer without waking. Every wake path (`webSocketMessage`, `alarm`, `fetch`) lazily rehydrates session + pending from storage before processing.
- **Deploys restart every DO and drop every WebSocket (incl. hibernated).** With auto-promote this is steady-state: client auto-reconnect + resync is a core protocol requirement (§3); recovery correctness is designed for (snapshots + `rngBeforeApply`), not hoped for.
- **Room addressing:** room IDs are **≥96-bit crypto-random** base32 (via `crypto.getRandomValues` in the Worker — explicitly NOT the engine's user-visible-seed PCG32), used with `idFromName(roomId)`. An `initialized` storage flag distinguishes create from join; uninitialized rooms reject joins so ID-guessing can't spawn junk state. The share link IS the room capability; seat tokens (128-bit crypto-random) gate seats within it.
- **Abuse & identity floor (Phase 2 gate; Review-class; never pre-authorized):** create-room rate limiting via the **Workers Rate Limiting binding** (no extra store) and/or Turnstile on room creation; join-attempt throttling; room TTL via alarm-driven GC. Retention v1: keep everything (~10KB/game, cost accepted, quantified); the TTL is the recorded future hook.
- **Environments:** top-level = production `industrial-juggernaut`; `[env.staging]` auto-names `industrial-juggernaut-staging`. DO bindings are **non-inheritable** — the `durable_objects` block + class export is repeated in the staging env; migrations live top-level only (inherited). **Deploys happen only from CI** (no local `wrangler login`). Workers observability (logs) enabled in `wrangler.jsonc` from day one.
- **No D1/KV/R2 in v1.**
- **Named trade (decision 5, eyes-open):** multi-actor games are network-dependent — no offline play for them, every move round-trips, local play of a hotseat game requires `wrangler dev`. The all-agent client-side path covers offline balance work; a client-local human "sandbox" mode driving the pure engine is a later increment needing no DO changes, because `GameSession` is pure.

## §3 Session model & wire format

The DO is a thin host (sockets, storage, one alarm) around a **pure `GameSession` module** — TDD'd in plain vitest, no workerd.

### `SessionRecord` — the JSON interchange shape

The save-export / replay-download / wire-snapshot shape (distinct from the storage *layout* below):

```ts
SessionRecord = {
  formatVersion: number,        // LogEntry/SessionRecord schema version
  replayVersion: string,        // engine semantics version (see Recovery)
  seed: string,                 // bigint → decimal string (codec below)
  config: RuleConfig,
  boardSource: BoardSource,     // {kind:'generate', size, ironCount} | {kind:'fixed', def}
  seats: SeatConfig[],          // human | {agent:'greedy', archetype} | {agent:'heuristic'}
  log: LogEntry[],
}
```

`SessionRecord` is the canonical pre-authorized artifact named in §6, with this exact field list.

### Storage layout & crash consistency

- **Header** (one row, written once at creation): `{formatVersion, replayVersion, seed (decimal string), config, boardSource, seats}`.
- **Log**: one row per entry, keyed by zero-padded index (`log:000001`…). Never one growing array value.
- **Snapshot** (one row, overwritten): `{state, logIndex, stateHash, replayVersion}`, written at every round boundary, holding the **post-`advanceRound`** state (so wake applies the tail starting at `logIndex+1` with no extra `advanceRound`). `stateHash` is the divergence checksum.
- **Pending** (one row, present only mid-decision): see Pending decisions.
- **Atomicity:** each mutating event commits in **one `storage.put({...})` multi-key call** (atomic — all keys or none): the new `log:N` entry, the updated snapshot (at boundaries), and the `pending` set/clear, together. No partial states.
- **Critical-section ordering:** per mutating event — validate → apply (sync) → **`await storage.put(...)`** → broadcast. The `await` makes durability-before-broadcast explicit rather than relying on the output gate covering `ws.send()` (Cloudflare docs enumerate gating for responses + `fetch()`, not hibernation `ws.send()` — so we do not depend on it). The input gate prevents other events from interleaving during the storage `await`; no non-storage `await` appears in the critical section. Never `allowUnconfirmed`/`allowConcurrency` on game writes. On storage failure the platform reset stands — never continue with memory ahead of the log; reconnect re-sync self-heals any broadcast a client missed.

### Recovery & the deploy problem

Wake = load snapshot + replay log tail (+ reload `pending`). Pure full-log replay on every wake is rejected (turn-based think time guarantees hibernation between most moves; O(N) wake replay grows with game age).

**Version discipline — two distinct versions:**
- **`replayVersion`** = hash of `src/engine/** + src/rng/** + src/board/**` (the semantics that affect stored-log replay), **mechanically guarded in CI** (build fails if the hash changes without a bump). Governs storage stamps, the on-mismatch path, and the promote replay-compat gate.
- **`agentVersion`** = hash of `src/agent/**`, governs build/deploy only. Agent code is **never** executed during replay (replay installs recorded RNG — below), so an agent improvement must NOT trigger snapshot-reset or version-mismatch handling. This split prevents a softmax-temperature tweak from discarding in-flight games' log tails.

**On `replayVersion` mismatch at wake:** never silently re-replay old log entries under new semantics. The materialized snapshot `state` is engine-versioned data, so the policy is an explicit **runtime ruling: no migration — continue play under the new engine from the snapshot state** (the post-snapshot tail is *not* discarded blindly; it is replayed and validated against `stateHash`, and on divergence the game is frozen read-only with a friendly notice rather than continued on corrupt state). Replay-viewer replay of older games is best-effort, labeled "recorded under engine v<replayVersion>" when `stateHash` validation fails. A **replay-compatibility gate** in the promote pipeline (golden corpus of session logs replayed under the candidate engine, compared on `stateHash` at boundaries) blocks auto-promote on breaking diffs without a `replayVersion` bump (§6).

### LogEntry union (closed per `formatVersion` 1) and replay determinism

```ts
LogEntry =
  | { player, kind: 'placeFirstBase', hex, rngBeforeApply }   // setup; logged for ALL seats (human choice + agent auto-pick)
  | { player, kind: 'build',  pieces: Piece[], rngBeforeApply } // whole build at once; self-closing (calls advanceRound)
  | { player, kind: 'attack', decl: AttackDecl, rngBeforeApply }// ONE battle; substituted defender recorded
  | { player, kind: 'endRound', rngBeforeApply }                // closes an attack chain (calls advanceRound)
  | { player, kind: 'pass', rngBeforeApply }                    // self-closing
  | { player, kind: 'roundSkipped', rngBeforeApply }            // eliminated seat's slot; appended by session; calls advanceRound
```

- **`rngBeforeApply`** (bigint-codec'd `RngState`) is the RNG state to **install before applying this entry's rules** — i.e. the *post-agent-selection, pre-application* state for agent seats, and the naturally-threaded state for human seats. **Replay procedure:** for each entry, `state.rngState = entry.rngBeforeApply`, then run the entry's rules (`applyAction` for build/attack/placeFirstBase, then `advanceRound` for self-closing/endRound/roundSkipped). This reconstructs combat and turn-order draws exactly **without re-executing agent policies** (whose selection draws are not in the log and are the reason a bare action log is insufficient). For human entries `rngBeforeApply` equals the threaded state and doubles as a checksum. *(Note: this is the codex-recommended model. A round-2 finder proposed instead "install the preceding entry's post-state" — that is incorrect: it omits the agent's selection draws and produces wrong combat. The distinction is load-bearing.)*
- **Round state machine** (the one-action-per-round rule lives HERE — `applyAction` is round-context-free): each round is exactly one of {one whole build · an attack chain of ≥1 declarations closed by `endRound` · pass}. Mode-changing second submissions are structured errors; sequential builds in one round are impossible by construction (closing the budget-recompute inflation hole).
- **One canonical composition for ALL seats:** every action — human or agent — is applied per-declaration via `applyAction → applyEliminations(actingPlayer) → removeEncircledStrandedBases`, `actingPlayer` captured at round start and held constant. v1 constrains agent seats to single-declaration attack actions (true of greedy/heuristic today); `GameSession` never invokes the engine's atomic multi-decl `applyAttack`. Per-battle elimination/stranding is the documented digital ruling (rules-faithful). §7 pins property tests to this, not to stepRound equivalence.
- **`advanceRound` is driven by exactly one log entry** (self-closing kinds + `endRound` + `roundSkipped`); replay calls it the same number of times at the same indices (§7 property test).
- **`endRound` authorship:** a human attacker who chooses to stop sends an explicit `{type:'endRound', expectedLogIndex}` command (the §4 chain-continue prompt's "done attacking" button); the session also **auto-closes** an attack round when fewer than 3 fresh in-range attackers remain or no legal attack exists (rules line 209).
- **Eliminated seats:** the session appends `roundSkipped` (and auto-advances) for slots whose player is eliminated — live and replay both consume the entry.
- **`status()` runs exactly once per round**, after the final composition step and before `advanceRound` — never mid-chain (rules: victory "at the end of a round"); the actor ends the round to claim a mid-chain threshold crossing.
- **Agent-drive invariant:** after any wake or applied event, if the current seat is an agent and no decision is pending, the session drives agent rounds forward (logging each) until a human seat, a pending decision, or game end. Reconnects generate wakes, so this self-heals after every deploy with no timers.
- **Setup phase:** `initGame` seeds the RNG, generates/loads the board, draws a **placement order** (Fisher-Yates from the seed), and returns a setup-phase state. Each seat places its first base in placement order — humans via a `placeFirstBase` command (validated: unoccupied outermost-ring hex), agents via `representativeFirstBase` auto-pick (§5). **All placements (human and agent) are logged as `placeFirstBase` entries** so the post-setup board is fully reconstructable. After the last placement the engine transitions to turn 1, drawing the turn-1 order (consuming RNG). The "near where you sit" table rule has no digital analog; free choice on the outer ring is the documented ruling (DER #6).
- **NOT in `formatVersion` 1:** `allianceOp`. The alliance wire shape lands with the Phase 3 alliance design as a `formatVersion` bump (speccing a contract before its semantics was reviewed and rejected). The union is closed per version.
- **Reserved v1 rules deviation:** maxed-out-attacker capture is **destroy-only** (engine's current behavior); the rules' relocate-or-destroy choice is Phase 3+ with a reserved kind `captureResolution`. See Digital Edition Rulings.

### Pending decisions (durable)

A `pending` record is written to storage **atomically in the prompt-issuing `put`** and cleared atomically with the resolving log append. Wake reloads it; reconnect/resync re-sends the outstanding prompt.

```ts
pending = {
  decisionId,                 // unique; carried on prompt and answer
  kind,                       // 'defenderChoice' (Phase 3: 'allianceProposal' | 'loanConsent')
  round,                      // round identity
  declaringPlayer,
  payload,                    // FULL crash-recovery contract: proposed AttackDecl (target+attackers),
                              //   pre-decision log index, and the rngBeforeApply to install on resolution
  promptedSeat,
  deadline,                   // for the alarm
}
```

- **Global write-lock:** while `pending` exists, every mutating command except the matching answer (or the timeout alarm) is rejected with a structured "decision pending" error. This serializes the half-open round against any other action, alliance op, or seat change.
- **Defender field is a PROPOSAL:** every `AttackDecl`'s defender — human- or agent-originated — is proposed. If the defending seat is human, the session opens a pending decision and substitutes the human's validated choice (covering the agent-attacks-human case); agent seats and timeouts use `representativeDefender` (§5). The substituted choice is logged.
- **No-eligible-defender ruling:** a target with no fresh in-range defender (excluding itself) is **not attackable this round**; `GameSession` validates defender-eligibility-nonempty at declaration *before* creating a pending decision (a sanctioned derived check — see Validation). The client greys such targets out with the reason.
- **Timeouts:** a DO storage **alarm** keyed to the pending record (the only alarm consumer in v1). At-least-once semantics: the handler loads `pending`, no-ops if absent or `decisionId` mismatch, else applies the representative choice and appends (the atomic multi-key `put` makes a retry-after-failure idempotent — `pending` stays set until the append commits together with its clear). Stale-`decisionId` answers get a structured "already resolved" error + resync. Online defender timeout: 90s default (a liveness mechanism, not a competitive clock); hotseat/local prompts have no timeout.
- **Phase 2 alarm multiplex:** when GC (or any second consumer) is added, the single alarm slot is multiplexed via a stored `alarmQueue` row — a sorted list of `{time, kind, payload}`; the `alarm()` handler dispatches the earliest due entry by `kind` and re-arms `setAlarm` for the next. v1 ships the single-consumer form; this schema is the documented Phase 2 hook so the GC subagent has a target.
- **Stalled acting player (liveness):** the room creator can hand any seat to an agent (also a designer instrument: swap yourself out mid-game). This, not timers, is the recovery for a vanished attacker mid-chain.

### Wire protocol

- **Command envelope:** every mutating client message carries `expectedLogIndex` (optimistic concurrency against log length) and, when answering a decision, the `decisionId`. Mismatch → structured error with current index + resync payload. This makes a lost-ack retry **safe** (the retry's stale index is rejected, not double-applied) — note this is mismatch-and-resync, *not* idempotent-replay; only seat-claim (which carries a request id) is idempotent in the same-result sense.
- **Seat claiming (mechanism: Phase 1; cross-device join UX: Phase 2):** processed inside the DO as a single-event check-and-set (one winner per seat; loser gets a seat-taken error); token minting idempotent per claim-request id (retries return the same token). Phase 1 local games issue all seat tokens to the creator at room creation. Seat tokens admit multiple concurrent sockets (multi-tab); all receive broadcasts/prompts; `expectedLogIndex`/`decisionId` arbitrate duplicates.
- **Resync payload** (on join, reconnect, any index mismatch): state snapshot (codec'd), log length, outstanding pending prompt if the seat is the prompted one, seat roster, and protocol/replay versions. **Version handshake:** client hello carries its bundle's protocol/replay version; mismatch (cached assets vs redeployed DO) → client hard-reloads. Optimistic preview is advisory and never applied to authoritative state.
- **Malformed traffic:** invalid JSON / unknown type / oversized payload / wrong seat token → structured error, count-limited per socket before close. Send failures mark the socket dead; seat presence is advisory UI state.
- **Events:** each applied entry broadcasts `{entry, events: GameEvent[], logIndex}`; the session additionally emits a wire-level `turnRollover` event with the new order (and, at 2P, the iron weights used) for the HUD's draw ceremony — replay-derivable, so broadcast-only, not logged.

### Validation (defense in depth)

= **engine fixes (§5) + `applyAction`'s throwing checks + named session checks.** Membership testing against `legalActions` stays forbidden (representatives ≠ the legal space), but **derived existence/eligibility checks are sanctioned and required**:

1. `pass` accepted only when `config.allowPass` or `legalActions(state)` yields only pass (forced-pass detection — same computation §4's auto-notice needs).
2. `attack` entries carry exactly one declaration; `attacks: []`-style no-ops rejected.
3. Attack declarations have **no duplicate attacker hexes** (Set check on hex keys) and `defender !== target` — session-layer pre-checks, defense-in-depth backing the §5 engine fixes.
4. Defender eligibility non-empty at declaration; substituted defender re-validated (fresh/range/owner/≠target).
5. Build pieces are a set (no duplicate hexes) of one piece type; budget checked by the engine at entry; bootstrap restricts to a single factory (§5 item 5).

The client may import the engine for hint highlighting and previews (same module, version-matched by the handshake); authority stays in the DO.

## §4 Client (Phase 1 core, Phase 3 polish)

React + Vite SPA. Screens: home/new-game (designer instrument incl. preset selector), game, **minimal game viewer** (Phase 1 — steps through a completed/all-agent game's log via the pure engine; play/pause/step), polished replay viewer (Phase 3), join-room (Phase 2), rules reference (DER-merged render).

Game screen: SVG hex board (96–300 hexes renders comfortably in SVG); territory rendering for both regimes (radius-union and **convex-hull polygon**, per DER #1) with shared-credit overlap zones; **stranded bases visually marked**; fresh/fatigued states; CVD-safe player identity with shape/pattern redundancy; legal-target highlighting from engine hints; build composer (piece-type commit, budget meter, bootstrap explained); attack composer (target → attackers → commitment, **public odds shown before the draw**); defender prompt + chain-continue prompt (the "done attacking" button issues `endRound`) with contextual rule one-liners; forced-pass auto-notice; turn-order draw ceremony from `turnRollover` (2P shows iron weighting); event log narrating `GameEvent`s; HUD: per-player resources, factory supply counter, turn-order tokens, eliminations/bounties. Keepalive loop sends app-level `ws.send("ping")` ~every 25s. Earned choreography (combat reveal, elimination, victory) per DESIGN.md with reduced-motion alternatives. Errors surface as rule explanations, not codes.

## §5 Engine work (TDD; enumerated — §6 defines what "pre-authorized" means)

Exhaustive list; anything not named here is not covered by the pre-authorization:

1. `src/index.ts` barrel exporting: `setupGame, initGame, applyAction, applyEliminations, removeEncircledStrandedBases, advanceRound, currentPlayer, legalActions, status, buildBudget, generateBoard, loadBoard, control, representativeDefender, representativeFirstBase`, the `rng` primitives (`seed/nextUint32/nextFloat`), the bigint↔decimal RNG codec, engine types, `BoardSource`, and `RuleConfig`/`defaultConfig`.
2. `initGame(seed, boardSource, nPlayers, config): GameState` — packages board-gen RNG threading (generate-vs-fixed asymmetry), the placement-order draw, the setup-phase state, and the born-terminal `status()` check; test pins byte-equality with the driver's init for both board sources.
3. **Fix:** `applyOneAttack` throws on duplicate attacker hexes (kills the auto-win exploit). Regression test reproduces the six-copies exploit first.
4. **Fix:** `applyOneAttack` throws when `defender === target` (mirrors `legalActions`).
5. **Fix (mechanism specified):** bootstrap build is factory-only. `legalActions` suppresses all base-build emissions while in bootstrap state (`baseCount < 4 && controlledIron >= 1 && controlledFactories === 0`); `applyBuild` throws if `pieces[0].type !== 'factory'` in bootstrap state (defense in depth). TDD test: a bootstrap-state player's legal moves contain no base build, and a submitted base build throws.
6. Export `representativeDefender(state, target, defendingPlayer)` (extracted from `legalActions`' inline nearest-eligible logic) — used by agent-defender policy and timeout auto-pick.
7. Move `BoardSource` from `src/driver/record.ts` into engine types (pure data; removes the value-import-drags-the-agent-stack tripwire); driver re-exports.
8. **Setup phase:** `initGame` returns a setup-phase state with a drawn placement order; `placeFirstBase(state, player, hex)` validates (unoccupied outermost-ring hex) and applies; `representativeFirstBase(state, player)` is the agent auto-pick; transition to turn 1 (drawing turn-1 order) when all seats are placed. RNG ordering: placement order drawn at setup start, turn-1 order at the setup→turn-1 transition.
9. **One-time engine-vs-rulebook fidelity audit** (completion condition: read all of `industrial-juggernaut-rules-v10.md` against `src/engine/**`; every discrepancy becomes either a numbered §5 fix or a numbered Digital Edition Ruling; done when no unresolved discrepancy remains and Sam has signed off on any new rulings). Gates the client treating the engine as authoritative for human play.
10. **Phase 3 (own design addendum, not pre-authorized here):** alliance extension — form-consent flow, agent decline policy, loan records, acceptance window (ops rejected while a round is open or a decision pending), the all-players-alliance terminal-condition ruling, `formatVersion` bump.

## §6 Gitflow & CI/CD

- Create `dev` from `main`; flip GitHub default branch to `dev`; root checkout pins to `dev`; worktrees branch from `dev`; PRs target `dev`; Routine auto-merge to `dev` per existing merge-authority rules.
- **Workflows:** `ci.yml` — typecheck + full vitest + build, on PRs/pushes to dev & main, bun via `oven-sh/setup-bun`, **plus a Node CI job** running `@cloudflare/vitest-pool-workers` DO-host tests (§7). `deploy-staging.yml` — push to dev → `wrangler deploy --env staging`. **`promote.yml` — on green CI on dev:** verify the dev SHA's CI is green and the fast-forward to main is clean (no merge commit) via `gh api`; run the staging e2e smoke (create room → claim seat → play one scripted round over a real WebSocket against staging) and the replay-compat gate (golden corpus vs candidate `replayVersion`); then fast-forward main and perform the production deploy **in the same run** (sidesteps GitHub's GITHUB_TOKEN-pushes-don't-trigger-workflows trap). A `concurrency` group serializes overlapping promotions; the exact candidate SHA is pinned end-to-end.
- **Push authentication (the GITHUB_TOKEN trap):** the default `GITHUB_TOKEN` **cannot** push to a protected branch on a personal repo (no bypass list). The promote workflow's fast-forward push uses a **`PROMOTE_TOKEN`** secret — a fine-grained PAT (contents:write on this repo, owned by Sam the admin) — which both satisfies the protection and lets the push land. Sam provisions it via `gh secret set PROMOTE_TOKEN` from stdin.
- **Branch protection:** `main` — required status checks, direct pushes restricted (only the `PROMOTE_TOKEN` identity / admin), no required PR (fast-forward of an already-checked dev SHA is the intended path); `dev` — required CI on PRs.
- **Atomic cutover:** ONE PR lands {rewritten `docs/git-strategy.md`, CLAUDE.md/AGENTS.md sibling sync, the workflows, branch-protection config}; protection on main + `PROMOTE_TOKEN` are configured BEFORE deploy-prod is enabled, so a stale-doc session cannot Routine-merge to production. **Ordering note:** the cutover PR is itself Review-class (Sam merges it) — pre-authorization (below) only takes effect *after* it lands.
- **Pre-authorization, done legitimately:** the git-strategy rewrite adds a §Merge-authority provision — *spec-pre-authorized contract*: a PR is Routine despite Domain triggers ONLY if an approved spec names the exact artifact (type name + field list — §3's `SessionRecord`/`LogEntry` and §5's enumerated items qualify) AND the PR body cites the spec section and asserts zero shape deviations; any deviation reverts to Review. **Never pre-authorized:** seat-token/join-code/socket-auth code (session management — Domain trigger), the abuse floor, anything altering replay behavior of existing logs.
- **Secrets:** `CLOUDFLARE_API_TOKEN` (+ account id var) and `PROMOTE_TOKEN` via `gh secret set` from stdin. No secrets in flags; repo is public — review wrangler config before committing.
- **Break-glass:** `wrangler rollback` documented as the production rollback path; flip-to-Sam-gated promotion = removing the fast-forward step from `promote.yml` (one-line revert to a manual promotion PR).

## §7 Testing

- TDD for all `src/` production code. Session module: plain vitest under bun (local + CI).
- **Property tests (fast-check), structural equality:** replay equivalence over random agent games (same terminal state; `advanceRound` called the same number of times at the same indices; each entry's `rngBeforeApply`-driven replay reproduces the live `stateHash` at every boundary); games with mid-turn eliminations; mid-chain elimination bounty/stranding timing under the canonical composition; build-budget non-inflation across a round; bootstrap factory-only; regime boundaries (3↔4 bases, commitment 3/4/5/6); the **bigint↔decimal codec** round-trips uint64 values above 2^53 bit-exactly (all consumers use `BigInt()`, never `Number()`; one shared codec module enforces it).
- **DO-host tests run under Node in CI** via `@cloudflare/vitest-pool-workers` (`runInDurableObject`/`runDurableObjectAlarm`): hibernation wake-replay, alarm idempotency (fire-after-answer), `serializeAttachment` round-trip, seat-claim races, double-submit/`expectedLogIndex` rejection, reconnect-during-pending, snapshot+tail recovery, and a focused check that **broadcast never precedes the awaited storage write**. The bun-local question only decides local DX; CI has Node regardless.
- **E2E (no mocks):** the staging smoke in `promote.yml` is the canonical end-to-end test — real worker, real WebSocket, real DO.
- Engine fixes (§5) land red-green with regression tests reproducing each exploit first.

## §8 Errors & edge cases

- Board-gen CSP infeasibility (`placeIron` throws after 1000 restarts) and `loadBoard` validation throws → friendly create-time errors with parameter suggestions.
- Illegal actions → structured error codes + rule explanations (§4); session checks carve off the engine's known acceptance gaps.
- Forced pass → auto-advance with notice (server-detected).
- Reconnect: seat token + resync payload; deploys drop all sockets, so reconnect is routine.
- Recovery: snapshot + log tail + pending record; `replayVersion` mismatch → continue from snapshot, freeze read-only on `stateHash` divergence, never silent re-replay.
- Room GC: alarm-multiplexed TTL (Phase 2+), export-before-delete for finished games.

## Digital Edition Rulings (documented divergences from the printed rules)

1. **Territory is the convex hull** of all bases (engine model). Sam's committed v1 ruling (decision 7) — the rulebook's reassessed visibility-polygons and stranded-base territory exclusion are NOT modeled; stranded bases still count toward the hull and block placements. **Accepted risk:** plays differently from Tony's board; the rules-reference screen flags this prominently.
2. **Stranded-base rescue window** ("this turn or next") is unmodeled — stranding persists until rescue or encirclement.
3. **Maxed-out capture is destroy-only** (no relocate choice) — Phase 3+ with reserved log kind `captureResolution`.
4. **No-eligible-defender targets are unattackable** (engine ruling; rules silent).
5. **Voluntary pass is illegal** (`allowPass: false` default) — enforced via session validation.
6. **First-base placement:** free choice on the outer ring for humans (no seat-arc constraint), in a drawn placement order; auto-pick for agents (decision 6).
7. **Two prior Sam-authorized engine divergences** stand: per-player factory-death clock (threshold 8); triangle rule applies to the perimeter-establishing 4th+ base only.

## Review record

**Round 1** — 5-lens workflow (cloudflare-platform, engine-integration, rules-fidelity, concurrency-protocol, scope-process; 62 findings, 13 fully panel-verified before spend-limit failures truncated the rest; remainder adopted on finder evidence + cross-model agreement) + independent codex consult (31 findings, 6 P0; several empirically reproduced). v2 folded in: rngAfter-per-entry (later corrected — see round 2), snapshot+tail recovery, durable pending records, SQLite-backed DO + per-entry rows, explicit assets routing, command envelope, seat-claim CAS, crypto-random identifiers, engine fixes, canonical per-decl composition, allianceOp removed from v1, atomic cutover, pre-authorization codified, phase table, teaching surface.

**Round 2** — lean workflow (3 sonnet finders + 1 sonnet adjudicator: 21 findings → 12 stand, 8 downgraded, 1 refuted; ~263k tokens) + codex resume on v2 (~876k OpenAI tokens). **Two new P0s** (both folded): (a) `promote.yml`'s `GITHUB_TOKEN` cannot push to a protected branch on a personal repo → `PROMOTE_TOKEN` PAT; (b) the output gate does not cover hibernation `ws.send()` → the critical section now **awaits** the storage write before broadcasting rather than relying on it. v3 also fixed: the RNG model (`rngBeforeApply`, replacing v2's `rngAfter` — codex's mechanism, which a round-2 finder's "use preceding entry's post-state" suggestion would have broken; I overrode that suggested fix); `replayVersion`/`agentVersion` split (agent tweaks no longer discard in-flight tails); storage atomicity via single multi-key `put`; pending global write-lock + payload contract; `SessionRecord` now defined; `representativeDefender` added to the barrel; bootstrap fix mechanism specified; explicit `endRound` command; all-agent watch resolved to client-side + minimal Phase-1 viewer; setup-phase RNG ordering; rules-reference DER-merged; rate limiting via Workers binding; alarm-multiplex schema; bigint-codec precision contract; "engine-independent snapshot" and "idempotent retry" wording corrected.

**Considered and rejected:** browser-hosted authoritative multi-actor sessions (decision 5 stands; client-side path is for all-agent + future sandbox); blanket "never legalActions" validation (replaced with a precise existence/eligibility carve-out); pure event-sourcing without snapshots; speccing the alliance wire shape now; the round-2 finder's "inject preceding entry's post-state" replay model (omits agent selection draws — wrong).

**Still uncertain / for Sam:** all-agent watching as client-side-replay-only in v1 (vs a live spectate stream — PRODUCT.md says "watch"); the 90s online defender-timeout value; whether the staging e2e smoke gate must block Phase 1 promotion or can be a fast-follow. The convex-hull ruling (DER #1) is now a committed decision, not an open question.
