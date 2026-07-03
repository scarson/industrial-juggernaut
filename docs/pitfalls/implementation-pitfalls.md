# Industrial Juggernaut — Implementation Pitfalls & Review Findings

> **Purpose:** Document implementation traps, design flaws, and corrected decisions that would cause production failures, security vulnerabilities, or data correctness bugs if shipped. This document is the primary code review reference for the Industrial Juggernaut codebase.
>
> **Relationship to testing-pitfalls.md:** This document specifies *what* to implement and *why*. `docs/pitfalls/testing-pitfalls.md` specifies *how to verify* those implementations work correctly. They are complementary — cross-references are noted inline.
>
> **Last validated against codebase:** 2026-05-27 (replace when you audit against the current code)

---

## How to Use This Document

This document serves three audiences. Start here, then go directly to the section you need.

**If you're implementing code:** Go to the domain section matching your work area. Each entry has a clear *Flaw → Why It Matters → Fix → Lesson* structure. Follow the Fix. The Lesson teaches the generalizable principle so you'll catch the next instance of this pattern.

**If you're reviewing code:** Go to your domain section's **Review Checklist** at the end. Each item is a pass/fail check derived from the pitfalls above it. If a checklist item fails, read the referenced pitfall for context.

**If you're maintaining this document:** Every pitfall discovered during implementation, review, or debugging MUST be added here. See the maintenance sections at the end of this file. Partial updates cause drift.

---

## Table of Contents

| § | Section | You're working on... | Entries | Checklist |
|---|---------|---------------------|---------|-----------|
| 1 | [Geometry & Engine](#section-1-geometry--engine) | Hex math, coordinate projection, PRNG threading, derived state | GEO-1 – GEO-7 | §1.C |
| 2 | [Durable Object Host](#section-2-durable-object-host) | The `GameRoom` DO — storage, ordering, identity, auth, alarms, hibernation, tests | DO-PURITY-1 – DO-TEST-1 | §2.C |
| 3 | [Wire Protocol](#section-3-wire-protocol) | The `ClientCommand`/`ServerMessage` boundary and the session-layer error mappers | WIRE-MAP-1 – WIRE-SHAPE-1 | §3.C |
| — | [Orchestration](#orchestration) | Parallel subagent dispatch and output persistence | ORCH-1 | §Orchestration.C |
| A | [Historical Changelog](#appendix-a-historical-changelog) | Provenance, validation dates, review process meta-observations | — | — |
| B | [Unified Summary Table](#appendix-b-unified-summary-table) | All pitfalls at a glance, with severity and status | — | — |

---

# Section 1: Geometry & Engine

> **Reader context:** I'm building or reviewing the hex-board geometry, coordinate projection, the deterministic PRNG, or any state derived from board layout.
>
> The engine is a deterministic rules engine over a hex board. Two trap families dominate this domain: (1) floating-point and integer-lattice errors when hex coordinates are projected to plane coordinates or interpolated, and (2) state-correctness errors from sharing mutable PRNG state, keying collections by object identity, or caching values that should be derived. Every entry here is a correctness bug that breaks determinism or geometry silently — the kind that passes a happy-path test and fails a replay.

---

### GEO-1: Floating Point in Convex Hull / Point-in-Polygon

**The Flaw:** Hex centers project to floating-point plane coordinates, and geometry predicates (convex-hull orientation, point-in-polygon sidedness) compare those projected floats directly — or with `===` — to decide which side of an edge a point falls on.

**Why It Matters:** A point that lies exactly on an edge produces an orientation determinant of ~0 that floating-point rounding can flip to a tiny positive or negative value. Without tolerance, the same point is classified "inside" on one machine or evaluation order and "outside" on another, breaking determinism and perimeter computation. The failure is intermittent and invisible in happy-path tests because it only triggers for collinear/on-edge configurations.

**The Fix:** Use an epsilon of `1e-9` on every orientation/sidedness test, and treat an on-edge point as **inside** (this is design resolution **R1**). Never compare projected floats with `===` or `<`/`>` without the epsilon band:

```
// orientation: > eps left, < -eps right, otherwise collinear (on edge → inside)
const d = cross(a, b, p);
if (d > EPS) return LEFT;
if (d < -EPS) return RIGHT;
return ON_EDGE; // counts as inside per R1
```

**The Lesson:** Any time integer/lattice data is projected into floating-point space for a geometric decision, the decision needs an explicit tolerance and a documented tie-break rule. Exact float equality on derived coordinates is always a bug.

---

### GEO-2: Hex Rounding

**The Flaw:** Interpolating between two hexes (cube-coordinate lerp) produces fractional cube coordinates, and the endpoints are truncated or naively rounded component-by-component, landing off the integer lattice where `x + y + z = 0` no longer holds.

**Why It Matters:** A hex whose components don't sum to zero is not a valid lattice point; downstream set membership, adjacency, and distance calculations silently produce wrong neighbors. Independent rounding of each axis can violate the constraint even when each axis rounds "correctly."

**The Fix:** Round fractional cube coordinates with the standard cube-round algorithm: round each of x, y, z, then reset the component with the largest rounding delta from the sum of the other two, so `x + y + z = 0` always holds.

**The Lesson:** Constrained coordinate systems (cube coords, normalized quaternions, simplex coords) must be re-projected onto their constraint after any floating-point operation. Per-component rounding is not constraint-preserving.

---

### GEO-3: PRNG State Threading

**The Flaw:** A randomness consumer reads from a shared/ambient PRNG, reuses a PRNG state captured before a previous draw, or calls `Math.random()` directly.

**Why It Matters:** Determinism depends on a single, linear sequence of draws from a seeded generator. If two consumers draw from the same pre-draw state, they collide and produce identical "random" values; if any code path calls `Math.random()`, the engine becomes non-deterministic and replays diverge. This breaks `(seed, actions) → state` reproducibility — the foundational engine invariant.

**The Fix:** Every consumer of randomness takes a PRNG state as input and returns the advanced state alongside its result. Thread the returned state forward; never reuse a pre-draw state. There must be **no `Math.random()` anywhere in the engine** — enforce with a lint rule.

```
const [roll, next] = drawD6(prng);
// use `next` for the following draw — never `prng` again
```

**The Lesson:** Determinism is a data-flow property: randomness state must be threaded explicitly, like an accumulator, never read from ambient context. A reused state is a silent collision.

---

### GEO-4: Set Membership on Hex

A `Hex` is a value object, not a reference — two `Hex` instances with the same coordinates are equal but are distinct objects. Keying a `Set` or `Map` by object identity will store duplicates and fail membership tests for an equal-but-distinct hex. Always key collections by a canonical string `"x,y,z"`, never by object identity.

---

### GEO-5: Perimeter Is Derived, Never Stored

A player's perimeter is a pure function of their current bases. Caching it invites staleness: a later base placement or removal silently invalidates the cached value, and the engine then reasons about a perimeter that no longer matches the board. Always recompute the perimeter from the current bases at the point of use; never store it as mutable state.

---

### GEO-6: Factory-Death Clock Is Per-Player Controlled, Not Shared-Pool

The broken-perimeter death clock (`applyEliminations`, cause `brokenPerimeterAt18Factories`) triggers on the player's OWN controlled-factory count (`control(state, p).factories.length >= config.brokenPerimeterDeathAtFactories`), gated on that player having `< 4` bases — NOT on the shared placed-factory pool (`36 − factorySupply`). The rulebook's wording ("when 18 or more factories have been placed *on the board*") describes a shared clock; the engine deliberately departs from it (authorized tuning, 2026-05-27). **Why:** the shared clock coupled every `<4`-base player's fate to the table's total factory-spam, so one player's industry advanced the death clock for everyone — producing simultaneous turn-3 mass-elimination (200-game heuristic-greedy self-play: 152/200 empty-coalition wipeouts, all games over by turn 3). Per-player decoupling means a player's own industry-without-territory imbalance kills them; that converts simultaneous empty-coalition wipeouts into sequential eliminations with real winners (17/200 empty after the fix) and lets real iron contests play out. The default threshold was recalibrated from 18 (shared-pool-of-36 scale) to 8 (per-player scale; experimentally the minimum-empty-wipeout point with zero turn-cap stalls). The `EliminationCause` name is preserved as a stable identifier — the "18"/"shared" in the name is historical. Do NOT silently revert to the shared count.

---

### GEO-7: Bootstrap-Only Is the Founding Single Base, Not Every Sub-Perimeter Player

**The Flaw:** The bootstrap-factory-only restriction (`isBootstrapOnly` in `src/engine/build.ts`) is gated on `baseCount < 4` (every sub-perimeter player), suppressing base builds whenever a `<4`-base player's only budget is the bootstrap `+1`.

**Why It Matters:** A multi-base player at resource count 1 — radiating onto a single iron, or knocked back below the perimeter — must still place bases on the bootstrap `+1` budget (radiating 2nd/3rd base, and the perimeter-establishing 4th base). This is simulation-validated engine behavior pinned by the agent suite (`test/agent/score.test.ts` "4th base … hard-pruned to -Infinity"; `test/agent/heuristic-policy.test.ts` "samples a perimeter-forming 4th-base build"). A `baseCount < 4` gate suppresses that 4th base and breaks both tests. The printed rules (`industrial-juggernaut-rules-v10.md` lines 104, 240) say bootstrap is factory-only "when fewer than 4 bases," which argues for `baseCount < 4` — but the rules doc is stale relative to the iterated engine, and the code is the source of truth (Sam, 2026-06-13).

**The Fix:** Gate on `baseCount === 1` (the FOUNDING single-base state): `floor(rc/2) === 0 && baseCount === 1 && iron >= 1 && factories === 0`. Only the founding player is forced to spend the bootstrap `+1` on a factory; a 2+-base player is past founding and places bases normally even at resource count 1. Note the deliberate asymmetry with `buildBudget`, whose bootstrap term still grants `+1` to any `<4`-base player — `buildBudget` provides the budget; `isBootstrapOnly` restricts only WHAT that budget buys, only at founding. Regression-guarded in `test/engine/bootstrap-factory-only.test.ts` ("multi-base player at rc=1 … is NOT bootstrap-only").

**The Lesson:** When a printed-rules reading and the validated test suite disagree, the code wins (see the project memory "code over rules doc"). A spec-driven gate that breaks a pre-existing behavior test has mis-scoped the rule — narrow it to match the code, do not widen the code to match the doc. A failing pre-existing test after a spec change is a STOP-and-confirm signal, never a license to edit the test.

---

### GEO-8: Radiating Control Excludes Non-Ally Perimeter Interior (DER #17)

**The Flaw:** `control(state, p)` for a RADIATING player (`<4` bases / no valid hull) counts every iron and factory inside its radius-disk — including resources that physically sit inside a *non-ally opponent's* convex-hull perimeter. The rules (`industrial-juggernaut-rules-v10.md` ~line 76) say a perimeter makes its interior iron "no longer available to adjacent players that are still radiating," so the radiating player should NOT command those resources.

**Why It Matters:** The double-count is exploitable and measured (DER #17 investigation, `docs/plans/2026-06-28-der17-overlap-balance-findings.md`). Under the diverse `samplePolicy` heuristic, the radiate-and-blanket strategy (stay `<4` bases, cover the board's iron with big radius-5 disks, claim a turn-1 iron victory on iron inside opponents' perimeters) produced **41/363 (11.29%) false iron victories** — every one a win on iron the rules award to the perimetered opponent, while the rightful perimetered leader (8–9 exclusive iron) was denied. Greedy self-play was immune (it perimeters), so the bug is agent-dependent but genuine and human-reproducible. The engine is becoming authoritative for human play, so a deliberate human exploit that contradicts validated design intent must be closed — this is the case where the code/rules-doc divergence IS a real bug, not stale doc.

**The Fix:** In `control()`, when the player is RADIATING (`!perimeter`), drop any iron/factory hex that lies inside a *non-ally, non-eliminated* opponent's valid perimeter hull (`>=4` bases, `hullArea > 0`). Subtract BOTH iron AND factories (authorized, Sam 2026-06-28) — not iron-only — so `resourceCount`/`buildBudget`/`isBootstrapOnly` stay coherent (a radiating player never gets budget or bootstrap status from resources it does not own). Leave `hexes` (territory/reach) UNCHANGED — only resource ownership shifts, not line-of-sight or attack reach. Ally perimeters never subtract (the coalition keeps the resource via the ally; `coalitionIron` unions). Recompute the opponent hulls per call — never cache (GEO-5 preserved; `control()` stays a pure function of `state`, it just reads other players' bases). Regression-guarded in `test/engine/control.test.ts` (exclusion + ally-keeps + factory), `test/engine/status.test.ts` (victory flips to the perimetered owner; `noIron` + factory-clock eliminations), `test/engine/turn.test.ts` (iron-weighted turn-order), `test/engine/build.test.ts` (budget + bootstrap). The measurement script `scripts/der17-measure.ts` confirms closure: overlap-assisted wins **41 → 0**.

**The Lesson (downstream ripple of a core `control()` change):** subtracting factories has three intended-but-non-obvious consequences a reviewer must accept, not stumble into — (1) the GEO-6 factory-death clock counts fewer factories for a radiating player (slightly harder to clock-kill; near-unreachable corner), (2) `noIron` elimination is more aggressive for a radiator whose entire iron set is borrowed (faithful — it controls no iron of its own), (3) `isBootstrapOnly` can flip `false→true` when a borrowed factory is subtracted (a founding single-base player at true `rc=1` is correctly factory-only, GEO-7). All are pinned by tests. When changing `control()`, enumerate its consumers (`status`/`coalitionIron` victory, `build` budget/bootstrap, `applyEliminations`, `turn.ts` 2-player draw, the agents) — the direct change is easy; the ripple is the work.

---

### Review Checklist

- [ ] **All geometry predicates use a `1e-9` epsilon and treat on-edge as inside** — no `===`/bare `<`/`>` on projected floats; on-edge counts as inside per R1 (GEO-1)
- [ ] **Fractional cube coordinates are cube-rounded** — largest-delta component reset so `x + y + z = 0` holds after every lerp/round (GEO-2)
- [ ] **PRNG state is threaded, not reused** — every randomness consumer takes and returns advanced state; no `Math.random()` anywhere in the engine (GEO-3)
- [ ] **Hex collections are keyed by canonical `"x,y,z"` strings** — never by object identity (GEO-4)
- [ ] **Perimeter is recomputed from current bases, never cached** — no stored perimeter that a base change could invalidate (GEO-5)
- [ ] **Factory-death clock counts the player's OWN controlled factories, not the shared placed pool** — per-player decoupling; not reverted to `36 − factorySupply` (GEO-6)
- [ ] **`isBootstrapOnly` is gated on `baseCount === 1`, not `baseCount < 4`** — only the founding single base is factory-only; multi-base players at rc=1 still place bases (GEO-7)
- [ ] **Radiating `control()` excludes iron/factories inside a non-ally opponent's valid perimeter** — perimeter claims its interior resources; ally perimeters never subtract; `hexes` (reach) unchanged; recomputed per call (GEO-8)

---

# Section 2: Durable Object Host

> **Reader context:** I'm building or reviewing the `GameRoom` Durable Object (`src/host/game-room.ts`, `src/host/storage.ts`, `src/host/ids.ts`, `wrangler.jsonc`) — the thin host that performs the pure `GameSession` reducer's effects: storage, ordering, identity, auth, alarms, hibernation, and the vitest-pool-workers test setup.
>
> The DO host is not the engine — it introduces a different trap family: (1) purity/bundle boundaries (which modules a downstream bundle transitively pulls in), (2) storage-vs-wire representation mismatches (bigints, JSON-safety), (3) durability ordering (what must be true before a client sees state), (4) platform limits (value caps, key counts), (5) identity/randomness separation, (6) at-least-once retry semantics for alarms, and (7) hibernation's memory-vs-attachment split. Every entry here traces to a phase of `docs/plans/2026-06-29-do-host-wire-protocol-plan.md` (Phase B1–B8) where the trap was found or the design decision was locked.

---

### DO-PURITY-1: Host Glue Never Directly Imports the Agent Modules

**The Flaw:** Code under `src/host/` reaches for `src/agent/*` or `src/driver/*` directly to drive an agent seat's turn, instead of going through the reducer's injected `agentForSeat` binding.

**Why It Matters:** The engine barrel (`src/index.ts`) is deliberately agent-free — its header comment states "value exports must never pull in `src/agent` or `src/driver`" — so that a browser/client bundle importing only the barrel never pulls agent code into its payload. The DO-hosted Worker bundle for vs-agents games is *allowed* to include `src/agent` (it needs the real greedy/heuristic agents to drive agent seats), but that inclusion must flow through exactly one seam: `src/session/agent-binding.ts`'s `agentForSeat(seat: SeatConfig): Agent`, the single module that value-imports `src/agent`. If `src/host/game-room.ts` (or any other host file) imports `src/agent` directly, there are now two paths into agent code with no single audit point, and a future attempt to strip agents from the client bundle (or reason about what the Worker bundle contains) has to re-derive the boundary from scratch instead of trusting one file.

**The Fix:** `game-room.ts` imports `agentForSeat` from the session barrel (`../session`), which re-exports `src/session/agent-binding.ts` — never `from "../agent/..."` or `from "../driver/..."` directly. Verify the boundary by grepping the host directory: `grep -rn 'from "\.\./agent\|from "\.\./driver"' src/host/` must return nothing. This was verified by bundle inspection at B2 (zero `src/agent` references in the compiled Worker bundle outside the one binding's transitive pull) and re-verified by grep at A2 (commit fa0b32af phase review: "agent-purity invariant verified by grep — only agent-binding.ts value-imports src/agent").

**The Lesson:** When a downstream consumer (a Worker bundle) is allowed to pull in something a sibling consumer (a browser bundle) must never see, don't rely on "nobody happens to import it" — force the inclusion through one named seam and grep for violations at review time. A purity guarantee that lives only in a design decision (not an enforced import path) erodes the first time a new file needs "just a quick" agent call.

---

### DO-CODEC-1: Storage Is Raw Structured Clone; the Wire Is the Codec

**The Flaw:** Code on the storage path (`src/host/storage.ts`, `game-room.ts`'s `persistEvent`/`writeHeader`/`readHeaderBundle`) JSON-encodes a `SessionState`/`LogEntry`/`Snapshot` before writing it, or code on the wire path (`src/wire/codec.ts`, anything that calls `ws.send`) sends a raw `GameState`/`RngState` object containing native `bigint`s straight to `JSON.stringify`.

**Why It Matters:** These are two different serialization domains with two different constraints, and conflating them breaks in opposite but equally bad ways. Durable Object SQLite-backed storage (`ctx.storage.put`) uses the platform's structured-clone codec, which carries `bigint` values natively — no encoding needed, no precision loss, no string round-trip. `JSON.stringify` cannot represent a `bigint` at all; it throws (`TypeError: Do not know how to serialize a BigInt`) the moment a stored object touching the wire (any RNG state, any log entry's `rngBeforeApply`) reaches a raw `JSON.stringify`. Conversely, the wire protocol is a JSON message stream to/from a browser client, so a client message must be JSON-safe — bigints must become decimal strings via the wire codec (`src/wire/codec.ts`'s `encodeState`/`decodeState`), not ride raw. Using the wrong domain's representation on the wrong path either crashes (raw bigint → `JSON.stringify` on the wire) or silently drops precision/adds needless round-trip cost (JSON-encoding on the storage path, which structured-clone already handles for free).

**The Fix:** Storage (`ctx.storage.put`/`.get`) always stores the raw, structured-clone-native object — bigints, `Map`/`Set` if ever used, etc. — never run it through `JSON.stringify`/`JSON.parse` first. The wire (anything constructed for `ws.send`) always goes through the `src/wire/codec.ts` encoder, which converts bigints to decimal strings and back. `test/host/storage.test.ts` proves this with the load-bearing assertion `expect(typeof bundle!.header.seed).toBe("bigint")` after a real `writeHeader`/`readHeaderBundle` round-trip through `runInDurableObject`'s real `ctx.storage` — the seed survives as a native bigint with no codec touching the storage path (B3.1).

**The Lesson:** When a value crosses two different serialization boundaries in the same system (a durable-storage boundary and a network-wire boundary), each boundary gets its own encoding decision — don't assume "we already have a codec" covers both. Prove the storage path's bigint fidelity with a real round-trip test through the actual storage API, not a mock; a mock that accepts `JSON.stringify`d input would validate the wrong thing.

---

### DO-ORDER-1: Persist-First — Durable State Precedes Anything Client-Visible

**The Flaw:** `game-room.ts`'s critical section (`handleCommand`, `alarm`, `driveAgents`) sends a broadcast, replies to a socket, or arms the defender-timeout alarm *before* the `await this.ctx.storage.put(...)` that makes the corresponding state durable — or persists via `allowConcurrency`/`allowUnconfirmed` options that let the write proceed without confirmation.

**Why It Matters:** If a client sees an "applied" message before the underlying write is confirmed durable, a crash or eviction between the send and the write leaves the client believing something happened that storage never recorded — the client's view diverges from the source of truth with no way to reconcile except a resync that reveals the vanished state. Note what does *not* justify this ordering: it is **not** because "the Cloudflare output gate covers `ws.send`" — that folklore is uncitable and this plan explicitly rejects it as the rationale. The real invariant is simpler and stronger: **client-visible state must never precede a durable write**, full stop, independent of what any platform output-buffering guarantee may or may not do underneath. The same reasoning governs the alarm: `handleCommand`'s comment is explicit that the alarm is armed *before* the prompt is sent specifically "to prevent a stall if `setAlarm` were to fail after the prompt" — if the prompt went out first and the arm failed, a human could be left waiting on a defender decision with no timeout ever protecting them, and no one would know until they complained.

**The Fix:** Every code path follows `await persistEvent(storage, op) → realizeAlarm(intent) → send`, strictly in that order, with **no** `allowConcurrency: true` or `allowUnconfirmed: true` on any game-state write. The pending-clear rides as a tombstone (`[PENDING_KEY]: PENDING_TOMBSTONE`) *inside* the same atomic `put` as the resolving log entry — never a separate `delete` or a multi-step `transaction` — so the write and the clear are atomic-by-construction (both land or neither does; see DO-STORAGE-1 for the platform mechanism). `test/host/critical-section.test.ts` is the flagship op-order proof: "a mutating human command persists `log:000000` STRICTLY before it sends the applied message," "each agent-drive round persists its entry STRICTLY before it broadcasts that entry's applied message," and "a human-vs-human attack opening a pending shows `put(PENDING) < setAlarm < send(prompt)`" — each assertion is a recorded-operation-order check (a spy records the sequence of calls), not a timing guess.

**The Lesson:** When you find yourself justifying an ordering decision with "but the platform probably buffers/covers this underneath," that's a signal to find the *actual* invariant instead. "Client-visible state must never precede a durable write" is provable and citable; "the output gate covers `ws.send`" is neither — it's the kind of folklore that sounds plausible until someone asks for the doc that says so. Assert mechanism (recorded call order), not symptom (no error was thrown).

---

### DO-STORAGE-1: The SQLite-Backed DO Value Cap Is 2 MB, Not 128 KiB

**The Flaw:** Code assumes the legacy Durable Objects KV storage backend's per-value limit (128 KiB) applies to this project's SQLite-backed storage class, and under-batches or over-splits a single logical write across multiple `put` calls to stay under an imagined smaller cap — or, in the other direction, assumes an unlimited value size and never checks that a single atomic `put`'s combined payload (a snapshot plus a handful of log entries plus the pending tombstone) stays within the real limit.

**Why It Matters:** The two DO storage backends have materially different per-value caps, and reasoning from the wrong one produces either needless complexity (splitting writes that didn't need splitting, breaking the "one atomic put" invariant DO-ORDER-1 depends on) or a silent correctness cliff (a write that quietly exceeds the real cap once game state grows large enough — a late-game snapshot with many log entries batched into one `put`). `wrangler.jsonc`'s `migrations` pins `new_sqlite_classes: ["GameRoom"]` — the project is on the SQLite-backed class, whose value cap is 2 MB per key, not the older KV backend's 128 KiB.

**The Fix:** Size single-`put` payloads (header bundle, snapshot, one event's log entries + tombstone) against the 2 MB SQLite-backed cap, not 128 KiB. The atomic multi-key `put` used throughout (`persistEvent`, `writeHeader`) is also bounded by Cloudflare's ≤128-key-pairs-per-put guarantee for all-or-nothing atomicity — `storage.ts`'s `persistEvent` comment notes "our events write ≤4" keys, comfortably under both the key-count and value-size ceilings. If a future change (e.g., a much larger board or a long uninterrupted attack chain before the next snapshot) risks approaching either limit, that is the trigger to revisit batching — not a reason to pre-emptively split every write today.

**The Lesson:** A platform limit is a fact about the specific backend in use, not a generic "Durable Objects" fact — verify which storage class (`new_sqlite_classes` vs. the legacy KV-backed default) the project is actually pinned to before designing around its limits, and re-verify if a migration changes the backend.

---

### DO-ID-1: Room and Seat Identity Come From WebCrypto, Never the Engine PRNG

**The Flaw:** Code that mints a room id, a seat token, or any other identity/security-relevant random value draws from the engine's seeded PCG32 stream (`src/rng`) instead of `crypto.getRandomValues`.

**Why It Matters:** The engine's PRNG is deterministic *by design* — `(seed, actions) → state` reproducibility (GEO-3) is the foundational engine invariant, and every consumer of that stream is expected to be replayable from the seed. Room/seat identity has the opposite requirement: it must be unpredictable and never reproducible from a seed, because it is a security boundary (a room id or seat token doubles as a bearer credential — see DO-AUTH-1). Drawing identity randomness from the same PCG32 stream the game itself consumes would couple credential generation to gameplay determinism: two rooms opened with related seeds could produce correlated ids, and any consumer of the game's random draws (replay, an agent, a test fixture) could shift the stream and inadvertently affect — or leak information about — identity generation. This is the identity-vs-game-randomness version of GEO-3's "no ambient/shared PRNG state" lesson, applied to a security-relevant consumer rather than a gameplay one.

**The Fix:** `src/host/ids.ts` mints all identity randomness via `crypto.getRandomValues` — `newRoomId()` draws 12 bytes (≥96 bits) and `newSeatToken()` draws 16 bytes (128 bits), both encoded through a pinned Crockford base32 alphabet — with an explicit comment at the top of the file: "Identity randomness only — WebCrypto, never the engine PCG32." Never thread a `RngState` or call anything under `src/rng` from `src/host/ids.ts` or any other identity-minting code.

**The Lesson:** GEO-3-adjacent: whenever a codebase has a deterministic, seeded PRNG for reproducibility purposes, every *other* randomness consumer (identity, tokens, nonces, salts) must be visibly and structurally separated from it — different function, different import, different backing primitive (WebCrypto vs. the seeded stream) — so a reviewer can confirm the separation by reading imports alone, without tracing data flow. See also GEO-3 (PRNG State Threading) for the gameplay-side half of this boundary.

---

### DO-AUTH-1: Store Token Digests, Never Raw Tokens

**The Flaw:** Seat-token authentication code stores a seat's raw bearer token in Durable Object storage, includes it in a log line, or echoes it back in an error message — instead of storing and comparing only its SHA-256 digest.

**Why It Matters:** This is a public repository, and Durable Object storage is queryable by anyone who gains any read access to it (a debugging endpoint, a storage export, a future admin tool) — storing the raw token turns any such access into full account takeover for that seat, whereas a digest is useless to an attacker without the original token (a one-way function; digest-only comparison never needs the raw value back). Logging the token or the raw query string is just as dangerous: WS-upgrade tokens ride as a URL query parameter (`?token=...`, an accepted v1 tradeoff — B2.2), and URLs land in access logs, browser history, and referrer headers by default, so a log line that includes the query string leaks the credential to every system that touches that log.

**The Fix:** `src/host/ids.ts`'s `tokenDigest(token)` computes lowercase-hex SHA-256 of the token; only the digest is ever written to storage (`authorizedDigests` in the header bundle) or compared (`handleUpgrade`'s `(await tokenDigest(token)) !== authorizedDigest`). The raw token exists only transiently: minted once at room-creation time and handed to the client in the create-room HTTP response, then presented back over the WS-upgrade query string — never persisted, never logged. `handleUpgrade`'s doc comment is explicit: "DO-AUTH-1: never log the token or the query string; never store the raw token." Any code path touching seat tokens, seat claims, join codes, or socket auth is unconditionally Review-class (never Routine, never agent-auto-merged) per the plan's merge-classification table — this is a structural rule, not a per-PR judgment call.

**The Lesson:** For any bearer credential in a system that might ever be read by someone other than its holder (a public repo's storage, shared logs, a debugging surface), default to storing only a one-way digest and treat "never log the raw value or anything that embeds it (a query string, a header)" as a blanket rule applied to every code path that touches it — not something to remember to redact ad hoc at each call site.

---

### DO-ALARM-1: Alarm Handlers Must Be Idempotent Under At-Least-Once Retry

**The Flaw:** The defender-timeout `alarm()` handler assumes it runs exactly once per armed deadline — it resolves the pending decision and clears it as two separate operations, or it doesn't guard against being invoked again after the decision was already resolved by a human's answer.

**Why It Matters:** Cloudflare alarms are **at-least-once**: an uncaught exception during the handler triggers a retry with exponential backoff (starting at 2 s, up to 6 retries). A handler that isn't idempotent under this retry model can double-resolve a decision (appending a second, spurious attack-resolution log entry) or crash-loop indefinitely on an unresolvable state. There are two distinct hazards the handler must survive: (1) a **fire-after-answer** race, where the human answers the pending decision right as the alarm fires, so by the time `alarm()` reads storage the decision is already gone; and (2) a **mid-handler failure retry**, where the handler starts resolving, fails before its atomic put commits, and the platform retries from scratch.

**The Fix:** Both hazards resolve to the same mechanism: the resolving `log:N` append **and** the pending-clear tombstone land in **one** atomic `put` (DO-ORDER-1's atomicity — never two separate operations). This makes both cases safe by construction: (1) fire-after-answer — `alarm()`'s step 2 no-ops the instant `readPending` returns `null` (a live pending was already tombstoned by the human's answer); (2) mid-handler-failure retry — since the append+tombstone never partially committed, a retry re-reads a still-*live* `pending` and re-resolves *identically* (`representativeDefender` is deterministic against the write-locked, frozen-in-place board), and once it does commit, any further retry hits the same fire-after-answer no-op. A **recency guard** additionally protects against a stale alarm firing early (an `extendDecision` push, or an early retry landing before the real deadline): if `pending.deadlineEpochMs` is in the future relative to `Date.now()`, the handler re-arms to the real deadline and returns *without* resolving — it never resolves a decision whose deadline hasn't actually passed. A **null/unresolvable-defender** guard (can't-happen under the write-lock, but defense in depth) freezes the room and deletes the alarm rather than retry-looping forever on something it cannot resolve. All of this is currently single-consumer: v1 has exactly one alarm use (the defender timeout), so the DO's one alarm slot is fully owned by it. The documented (not yet built) Phase-2 extension point is an `alarmQueue` — a stored, sorted list of `{ atEpochMs, kind, payload }` entries — that a second consumer (room-TTL GC) would require `alarm()` to dispatch by `kind` and re-arm to the next-earliest entry; this is a commented contract beside `alarm()` in `game-room.ts`, not implemented code.

**The Lesson:** Any handler a platform can invoke at-least-once must be analyzed for what a *second* invocation does at every possible point of failure, not just the happy path — and the cheapest way to guarantee idempotency is usually to make the "did this already happen" check and the "make it happen" write land in one atomic operation, so there is no window where a retry can observe a half-done state.

---

### DO-HIBER-1: No Timers; Lazy-Rehydrate on Every Wake Path; Per-Socket State Lives in the Attachment

**The Flaw:** Host code calls `setTimeout`/`setInterval` to schedule work, assumes `this.session` (the in-memory cache) is populated without checking, or stores per-socket state (like a malformed-message counter) in a plain instance field or a `Map` keyed by the WebSocket object.

**Why It Matters:** Three related but distinct hibernation hazards. First, `setTimeout`/`setInterval` **prevent hibernation** (the runtime can't tell if a callback still needs to fire, so it keeps the DO warm) and **die silently on eviction** (a hibernating or evicted DO doesn't run pending timers at all) — either way, any liveness mechanism built on a JS timer is broken by design in a hibernating DO; only the platform alarm (`ctx.storage.setAlarm`) survives across hibernation and eviction. Second, `this.session` is an in-memory cache — a wake into a fresh DO instance (post-hibernation or post-eviction) starts with `this.session === null`, and every entry point (`webSocketMessage`, `alarm`, `fetch`'s `/init`/`/ws`) must lazy-rehydrate (`if (this.session === null) await this.rehydrate()`) *before* touching it — miss one wake path and that path silently operates on a null/stale cache. Third, ordinary instance fields and JS-object-keyed maps do not survive hibernation at all (the instance is torn down and reconstructed) — any per-socket state that must persist across a hibernation cycle (the cumulative malformed-message counter used for the abuse budget) has to live in the socket's `serializeAttachment`, which the platform preserves and hands back via `deserializeAttachment` on the next `webSocketMessage` for that socket, even after the DO rehibernated in between.

**The Fix:** The constructor registers the ping/pong `WebSocketRequestResponsePair` via `ctx.setWebSocketAutoResponse` (answered by the runtime without waking the DO at all) instead of any app-level timer, and the file's top comment states the invariant directly: "never a `setTimeout`/`setInterval` (those prevent hibernation and die on eviction) — use the alarm." Every wake path — `webSocketMessage`, `alarm`, `handleUpgrade` — opens with `if (this.session === null) await this.rehydrate();`. The per-socket malformed-message count is stored via `pair[1].serializeAttachment({ seat, malformedCount: 0 })` at accept time and re-serialized on every increment (`registerMalformed`'s `ws.serializeAttachment({ seat: att.seat, malformedCount })`), staying comfortably under the attachment's ~16 KiB cap for a two-field object — so an abuser cannot reset their malformed-message budget by going idle long enough for the DO to hibernate and wake again.

**The Lesson:** Hibernation changes what "always true between calls" means: nothing in ordinary JS memory (instance fields, closures, `Map`s keyed by live objects) survives a hibernation cycle except what the platform explicitly preserves (storage, the alarm slot, and per-socket `serializeAttachment` payloads). Any state a DO needs across a wake — cached derived state, per-connection counters, liveness timers — has to be re-derived from storage/attachment on wake or stored in one of those three preserved slots; there is no fourth option.

---

### DO-TEST-1: The Current `@cloudflare/vitest-pool-workers` API Surface

**The Flaw:** Test code (or a new contributor unfamiliar with the package's version history) reaches for `defineWorkersConfig`/`poolOptions.workers` (the older config shape) or imports test helpers from the wrong module, or assumes the workerd test pool needs Node and can't run under `bun run test` on this bun-only machine, or runs the host test project on Windows CI.

**Why It Matters:** `@cloudflare/vitest-pool-workers`'s configuration API changed across releases, and stale documentation or memory of an older version leads to config that silently doesn't wire up the pool at all (a `poolOptions.workers` block with no effect under the newer plugin form) or import errors for helpers that moved modules. Separately, the plan's own risk register anticipated "the local-DX gap for `bun run test:host` (workerd pool under bun) — CI-gated as the fallback," a reasonable worry given bun's history of native-runner gaps — but this **did not materialize**: CI evidence (a green `dev` run, `28633567530`) shows the `check` job's `bun run test` step ran the full host project — `test/host/{alarm,critical-section,recovery,hibernation,storage,worker,ids}.test.ts`, 49 tests in `worker.test.ts` alone — under bun on Linux, successfully. Since B2, the workerd pool has run under bun with no fallback needed. Finally, the workerd pool combined with SQLite-backed Durable Objects is a known-broken combination on Windows (`workerd#6110`) — a real, currently-unfixed upstream issue, not a local misconfiguration — so host tests can only run reliably on Linux/macOS.

**The Fix:** Use the **`cloudflareTest()` Vite plugin** form (from `@cloudflare/vitest-pool-workers`, passed in `plugins: []` alongside a `test: { name: "host", include: [...] }` block — see `vitest.config.ts`), not `defineWorkersConfig`. Import `runInDurableObject`, `runDurableObjectAlarm`, `evictDurableObject`, and `listDurableObjectIds` from `cloudflare:test` (verify against the installed package version — the exact module has moved across releases, e.g. some helpers moved from `cloudflare:test` to `cloudflare:workers` in different releases). Storage isolation is per-test-file automatically — no manual cleanup needed between tests in the same file. Because bun *does* run the pool successfully, **`bun run test` is the single command that gates both the node and host vitest projects in CI** — the plan's originally-anticipated Node-only CI split (a separate `host-tests` job running under `npx vitest`) was not built; it would have added a branch-protection gap (a second job outside the single required `check` status context) for no DX benefit the CI evidence didn't already prove unnecessary. Skip host-project tests on Windows locally with an explicit skip + a comment citing `workerd#6110`; CI runs Linux, so this is a local-only carve-out.

**The Lesson:** When a widely-used package's config API is known to have changed across major versions, verify the *installed* version's actual exported shape (read its `package.json`/`dist` exports or current docs) before writing config from memory or an older example — and when a plan documents an anticipated DX gap as a risk, treat it as a hypothesis to verify against real CI evidence before building compensating infrastructure (like a CI job split) around it; the compensating infrastructure has its own costs (here, a branch-protection gap) that aren't worth paying if the hypothesized gap never materializes.

---

### Review Checklist

- [ ] **Host code never directly imports `src/agent`/`src/driver`** — agent-driving always goes through `agentForSeat` (`src/session/agent-binding.ts`); grep `src/host/` for `from "../agent` / `from "../driver"` and expect zero hits (DO-PURITY-1)
- [ ] **Storage writes use raw structured-clone objects (bigints native); wire messages use the codec (bigints → decimal strings)** — never `JSON.stringify` on the storage path; never a raw bigint reaches `ws.send` (DO-CODEC-1)
- [ ] **Every mutating path awaits its persist BEFORE arming the alarm and BEFORE any send** — one atomic multi-key `put` (pending-clear as an in-put tombstone, never a separate delete/transaction); no `allowConcurrency`/`allowUnconfirmed` on game writes (DO-ORDER-1)
- [ ] **Single-`put` payloads are sized against the 2 MB SQLite-backed cap** (not the legacy 128 KiB KV cap) **and stay ≤128 key-pairs** for atomicity (DO-STORAGE-1)
- [ ] **Room ids and seat tokens are minted via `crypto.getRandomValues`, never the engine PCG32** (DO-ID-1, cross-ref GEO-3)
- [ ] **Only token digests are stored/compared/logged — the raw token is never persisted or written to a log line** (DO-AUTH-1); any seat-token/seat-claim/socket-auth PR is unconditionally Review-class
- [ ] **Alarm handlers are idempotent under at-least-once retry** — the resolving append and the pending-clear tombstone land in one atomic put; a recency guard prevents early/stale firing (DO-ALARM-1)
- [ ] **No `setTimeout`/`setInterval` anywhere in the DO** — only `ctx.storage.setAlarm`; every wake path (`webSocketMessage`/`alarm`/`fetch`) lazy-rehydrates `this.session`; per-socket state that must survive hibernation lives in `serializeAttachment` (≤16 KiB), not memory (DO-HIBER-1)
- [ ] **Test config uses the current `cloudflareTest()` plugin form and `cloudflare:test` helper imports for the installed package version** — verified against the installed version, not memory of an older release; Windows + SQLite-DO host tests are skipped locally with a `workerd#6110` citation (DO-TEST-1)

---

# Section 3: Wire Protocol

> **Reader context:** I'm building or reviewing the `ClientCommand`/`ServerMessage` boundary (`src/wire/protocol.ts`, `src/host/parse-command.ts`) or the session-layer error mappers that translate engine/reducer failures into wire error codes (`src/session/session.ts`).
>
> The wire protocol is the only place untrusted client input enters the reducer. Its trap family is different from both the engine's (determinism/geometry) and the DO host's (durability/platform limits): it's about the boundary between "the client sent something well-typed" and "the client sent something the reducer can safely dereference," and about keeping the mapping between internal failure strings and external wire codes from drifting silently as the internal code evolves.

---

### WIRE-MAP-1: Engine Throw Messages Are Load-Bearing for the Session Error Mappers

**The Flaw:** An engine throw message (in `src/engine/turn.ts`'s `placeFirstBase` path or `src/engine/apply.ts`'s `applyBuild` path) is reworded — for clarity, consistency, or as part of an unrelated refactor — without checking whether `src/session/session.ts`'s error mappers (`placeFirstBaseErrorCode`, `buildEngineErrorCode`) match against the old wording via `message.includes(...)` substring checks.

**Why It Matters:** These mappers exist specifically to translate an internal engine throw into a structured `WireErrorCode` the client can teach from (e.g., `"hex is not on the board"` → `HEX_OFF_BOARD`, `"exceeds build budget"` → `BUILD_OVER_BUDGET`). They match by substring against the exact thrown message string — there is no shared constant, no enum, no compile-time link between the engine's throw site and the session's mapper. Reword the engine throw and the mapper's `message.includes(...)` check silently stops matching; the failure mode is not a crash but a *quiet demotion*: the mapper falls through to its `return null` case, and the caller's documented policy for an unrecognized message is to **rethrow** rather than map it to a wire code (the A3.2 unknown-throw-policy decision — unrecognized throws are reducer/engine bugs, not client errors, and must stay loud). So the practical effect of a silent rewording is that a perfectly ordinary, previously-well-explained client mistake (placing a base on an occupied hex) turns into an unhandled-looking failure with no teachable code — the client's error-code-driven UI has nothing to show, even though the underlying validation logic didn't change at all.

**The Fix:** Before rewording any engine throw whose message text is matched by `placeFirstBaseErrorCode` or `buildEngineErrorCode` in `session.ts`, grep those two functions for the substring you're about to change (`grep -n "message.includes" src/session/session.ts`) and update the matching `.includes(...)` string in the same commit. This was surfaced by the A3.3 spec review (2026-07-02) as a documented pitfall precisely because it's easy to miss — a purely-engine-scoped refactor has no obvious reason to touch `session.ts`, so the drift is invisible to a reviewer who isn't specifically looking for it.

**The Lesson:** A substring-matched string contract between two files (one throws a message, another matches against it) is a real interface even though the type system doesn't enforce it — treat "grep the consumer before rewording the producer's message" as mandatory whenever a thrown/logged string is known to be parsed downstream, exactly as you would treat changing a function signature that has callers.

---

### WIRE-SHAPE-1: The Wire Boundary Must Validate Full Shape, Not Just `type`

**The Flaw:** The host accepts a parsed JSON message as a `ClientCommand` on the strength of its `type` field alone (e.g., `{ type: "attack", ... }`), without verifying that the remaining fields conform to that command variant's shape — then passes it straight to `applyCommand`.

**Why It Matters:** `applyCommand` and its command handlers dereference fields assuming they conform to the `ClientCommand` union's shape — `c.decl.target.x`, `c.pieces.map(...)`, `key(c.hex)` — with no null/array guards, because the reducer's contract is "the caller already validated the shape; I only validate game *legality*." A well-typed-but-shape-malformed payload from an otherwise-legitimately-authenticated client — `{type:"attack",decl:null}`, `{type:"build",pieces:"x"}`, `{type:"resolveDecision",defender:null}` — passes a `type`-only check and then throws **uncaught** inside the reducer. This is worse than an ordinary client error in two compounding ways: (1) an uncaught throw crashes the room (the DO's synchronous handler has no surrounding try/catch at that layer), taking down every other player's session along with the malformed sender's; (2) it **bypasses the malformed-traffic abuse budget** (`MAX_MALFORMED`), because that budget only increments on messages the host's own parsing recognizes as malformed — a throw that escapes past the parser was never counted, so an attacker sending shape-malformed commands in a loop gets unlimited free crashes rather than being rate-limited and disconnected after 8. This was CONFIRMED as a genuine DoS during the B6 adversarial review, not a theoretical concern.

**The Fix:** Defense in depth, two layers. **Layer 1 (primary):** `src/host/parse-command.ts`'s `parseClientCommand` performs full shape validation — every field the corresponding handler will dereference, checked for presence and type (`isHex`, `isPieceArray`, `isAttackDecl`, etc.) — for every `ClientCommand` variant, *before* the message ever reaches `applyCommand`. A shape mismatch returns `null`, which the caller (`webSocketMessage`) routes to a `MALFORMED` reply and increments the abuse counter, exactly like invalid JSON. **Layer 2 (backstop):** `handleCommand` wraps *only* the `applyCommand` call itself in a `try/catch` — if a shape error Layer 1 somehow missed, or a genuine reducer bug throws, the backstop catches it, replies `MALFORMED`, and reports `"reducer-threw"` so the caller still counts it toward the abuse budget. Neither layer alone is sufficient: Layer 1 is the fast, cheap, complete check for known shapes; Layer 2 is the never-crash guarantee for anything Layer 1's author didn't anticipate (a future command variant, an edge case in the shape checker itself).

**SPA-plan relevance:** the client *also* validates commands before sending (better UX, fewer round-trips) — but the **authoritative** shape gate is this server-side one. Any future command entry point (a different transport, a batch-import tool, a replay-and-resubmit debugging feature) needs the same host-side shape validation before `applyCommand`; never assume a client did its own validation correctly or honestly.

**The Lesson:** "The type is a known variant" and "the payload conforms to that variant's shape" are two different checks, and a reducer that trusts its input's shape (reasonable — it should not have to re-litigate JSON parsing) pushes the *entire* shape-validation obligation onto its caller. Any boundary between untrusted input and a shape-trusting consumer needs an explicit, exhaustive-by-construction validator (one case per variant, checking every field the consumer will touch) sitting between them — "the type-tag looked right" is not shape validation, and skipping the rest of the shape checks turns a bad-input bug into a crash-plus-bypassed-rate-limit DoS.

---

### Review Checklist

- [ ] **Before rewording any engine/apply throw message, grep `session.ts`'s error mappers for the old substring and update the match** — `placeFirstBaseErrorCode`/`buildEngineErrorCode` match by `message.includes(...)`, not a shared constant (WIRE-MAP-1)
- [ ] **Any new wire-facing command entry point full-shape-validates every field the handler will dereference before calling `applyCommand`** — a `type`-only check is not enough; unrecognized/malformed shape routes to `MALFORMED` + the abuse counter, never straight to the reducer (WIRE-SHAPE-1)
- [ ] **The pre-persist reducer call is wrapped in a try/catch backstop** that counts an escaped throw toward the malformed-abuse budget rather than letting it crash the room silently (WIRE-SHAPE-1)
- [ ] **Client-side validation is never treated as sufficient** — the server-side shape gate is authoritative for every command entry point, including ones added later (WIRE-SHAPE-1)

---

## Orchestration

Pitfalls that arise when a session dispatches parallel subagents and consolidates their output. The canonical rules live in `docs/git-strategy.md` → §Multi-agent coordination → Output persistence. This section is the discovery hook for plan writers who arrive here via the `writing-plans-enhanced` (or equivalent) mandated-read path — it does NOT restate the rules in full.

### ORCH-1: Analysis Dispatches Must Persist Findings Before Returning

**Trigger:** Your plan dispatches parallel subagents (bug hunts, audits, phased analysis, parallel investigations) whose findings would be expensive to regenerate if lost.

**What you need to do:** Every such dispatched subagent MUST write its complete report to a persistent file BEFORE returning; the response message is not the sole record.

**Read the full rule:** `docs/git-strategy.md` → §Multi-agent coordination → Output persistence. That section carries the copy-pasteable prompt block (with `<PERSISTENCE_PATH>` substitution), file-path conventions, orchestrator commit cadence, and the cases where the rule doesn't apply.

**Why this is in implementation-pitfalls:** because the plan-writing skill mandates reading this file, and this rule has to be noticed at plan-write time (when the dispatch prompts are being drafted), not at execution time (when it's too late). The failure mode — orchestrator context compacting mid-consolidation and lossily dropping findings — is predictable and preventable if the plan author builds persistence into the dispatch prompts from the start.

### Review Checklist

- [ ] **Dispatch prompts include the mandatory-persistence block** — copy from `docs/git-strategy.md` §Output persistence; substitute `<PERSISTENCE_PATH>` with a durable per-subagent path (ORCH-1)
- [ ] **Plan specifies exact persistence paths, not "write somewhere useful"** — ambiguous paths default to `/tmp` under pressure, which doesn't survive (ORCH-1)
- [ ] **Orchestrator commits subagent artifacts wave-by-wave** — committed files land on the campaign branch before consolidation begins (ORCH-1)

---

# Appendix A: Historical Changelog

<!-- TODO: Add changelog entries as the document evolves. Format: -->
<!-- ## YYYY-MM-DD — <event> -->
<!-- - Added PREFIX-N (<title>) — <what and why> -->
<!-- - Updated PREFIX-M — <what changed> -->

## 2026-07-03 — DO-Host + Wire-Protocol plan, Phase B9

- Added Section 2: Durable Object Host (DO-PURITY-1, DO-CODEC-1, DO-ORDER-1, DO-STORAGE-1, DO-ID-1, DO-AUTH-1, DO-ALARM-1, DO-HIBER-1, DO-TEST-1) — the `GameRoom` DO's purity boundary, storage/wire representation split, persist-before-broadcast ordering, SQLite value cap, identity-vs-game-randomness separation, token-digest auth, alarm idempotency, hibernation/timer discipline, and the current vitest-pool-workers API surface. Sourced from `docs/plans/2026-06-29-do-host-wire-protocol-plan.md` Phases B1–B8 (design decisions locked 2026-06-29; shipped 2026-07-02–03) and the plan's Discoveries section (agent-seat auth boundary resolution).
- Added Section 3: Wire Protocol (WIRE-MAP-1, WIRE-SHAPE-1) — the substring-matched contract between engine throw messages and the session-layer error mappers, and the mandatory full-shape validation at the wire boundary before `applyCommand`. WIRE-MAP-1 from the A3.3 spec review (2026-07-02); WIRE-SHAPE-1 from the B6 adversarial review (2026-07-03), which confirmed it as a real DoS (uncaught crash + bypassed malformed-abuse budget) before the two-layer defense-in-depth fix landed.
- Cross-referenced DO-ID-1 ↔ GEO-3 (both govern the PRNG-vs-identity-randomness boundary, from opposite sides — GEO-3 protects gameplay determinism, DO-ID-1 protects identity/security from being coupled to it).

## 2026-06-13 — Web-client foundation Phase 3

- Added GEO-7 (Bootstrap-Only Is the Founding Single Base, Not Every Sub-Perimeter Player) — surfaced when the Phase-3 `baseCount<4` gate regressed two pre-existing agent tests; resolved to `baseCount===1` per code-as-source-of-truth (Sam).
- Added the missing GEO-6 row to Appendix B (pre-existing drift: the entry existed in §1 but never reached the summary table). Marked GEO-6 and GEO-7 VALIDATED.

---

# Appendix B: Unified Summary Table

<!-- TODO: One row per pitfall for at-a-glance review. Keep in sync with the sections above. -->

| ID | Title | Severity | Status | Domain |
|----|-------|----------|--------|--------|
| GEO-1 | Floating Point in Convex Hull / Point-in-Polygon | HIGH | UNIMPLEMENTED | Geometry & Engine |
| GEO-2 | Hex Rounding | HIGH | UNIMPLEMENTED | Geometry & Engine |
| GEO-3 | PRNG State Threading | CRITICAL | UNIMPLEMENTED | Geometry & Engine |
| GEO-4 | Set Membership on Hex | MEDIUM | UNIMPLEMENTED | Geometry & Engine |
| GEO-5 | Perimeter Is Derived, Never Stored | MEDIUM | UNIMPLEMENTED | Geometry & Engine |
| GEO-6 | Factory-Death Clock Is Per-Player Controlled, Not Shared-Pool | HIGH | VALIDATED | Geometry & Engine |
| GEO-7 | Bootstrap-Only Is the Founding Single Base, Not Every Sub-Perimeter Player | HIGH | VALIDATED | Geometry & Engine |
| GEO-8 | Radiating Control Excludes Non-Ally Perimeter Interior (DER #17) | HIGH | VALIDATED | Geometry & Engine |
| DO-PURITY-1 | Host Glue Never Directly Imports the Agent Modules | HIGH | VALIDATED | Durable Object Host |
| DO-CODEC-1 | Storage Is Raw Structured Clone; the Wire Is the Codec | CRITICAL | VALIDATED | Durable Object Host |
| DO-ORDER-1 | Persist-First — Durable State Precedes Anything Client-Visible | CRITICAL | VALIDATED | Durable Object Host |
| DO-STORAGE-1 | The SQLite-Backed DO Value Cap Is 2 MB, Not 128 KiB | MEDIUM | VALIDATED | Durable Object Host |
| DO-ID-1 | Room and Seat Identity Come From WebCrypto, Never the Engine PRNG | HIGH | VALIDATED | Durable Object Host |
| DO-AUTH-1 | Store Token Digests, Never Raw Tokens | CRITICAL | VALIDATED | Durable Object Host |
| DO-ALARM-1 | Alarm Handlers Must Be Idempotent Under At-Least-Once Retry | HIGH | VALIDATED | Durable Object Host |
| DO-HIBER-1 | No Timers; Lazy-Rehydrate on Every Wake Path; Per-Socket State Lives in the Attachment | HIGH | VALIDATED | Durable Object Host |
| DO-TEST-1 | The Current `@cloudflare/vitest-pool-workers` API Surface | MEDIUM | VALIDATED | Durable Object Host |
| WIRE-MAP-1 | Engine Throw Messages Are Load-Bearing for the Session Error Mappers | MEDIUM | VALIDATED | Wire Protocol |
| WIRE-SHAPE-1 | The Wire Boundary Must Validate Full Shape, Not Just `type` | CRITICAL | VALIDATED | Wire Protocol |
| ORCH-1 | Analysis Dispatches Must Persist Findings | HIGH | VALIDATED | Orchestration |

Severity levels: `CRITICAL` (production data loss / security), `HIGH` (correctness bug under predictable conditions), `MEDIUM` (correctness bug under edge cases), `LOW` (cleanliness / clarity).

Status values: `VALIDATED` (prescribed fix is implemented and tested), `UNIMPLEMENTED` (pitfall documented but fix not yet in code), `SUPERSEDED` (replaced by another entry or no longer applicable).

---

# Appendix C: Document Maintenance Guide

## When to Update This Document

Update this document when any of the following occur:

| Trigger | Action |
|---------|--------|
| Bug hunt finds a generalizable pattern | Add a pitfall to the appropriate domain section |
| Health review flags a cross-cutting issue | Add or strengthen a pitfall |
| Implementation reveals a prescribed fix was wrong | Update the existing pitfall to match reality — the code is the source of truth |
| Code review catches a pitfall already documented here | Strengthen the entry with the new example |
| A pitfall's prescribed fix is implemented | Update the entry's status in Appendix B |
| A feature is removed or an approach abandoned | Mark the pitfall as SUPERSEDED with a note explaining why |
| testing-pitfalls.md adds a new section | Check if a cross-reference should be added here |

**Do NOT update this document for:**

- One-off implementation bugs that don't generalize to a pattern
- Code style preferences or formatting choices
- Performance optimizations without correctness implications

---

## How to Add a Pitfall

### Step 1: Choose the domain section

If the pitfall spans two domains, place it where the reader is most likely to look when they encounter the bug. Add a "See Also" cross-reference in the other section.

### Step 2: Assign the next ID

IDs are sequential within each section (`AUTH-3`, `DB-12`, etc.). Check the last entry in the section and increment. Use a short prefix that matches the section (2-5 letters, uppercase, descriptive).

### Step 3: Write the entry

**For complex findings** (non-obvious failure mode or architectural fix):

```markdown
### SECTION-N: Title

**The Flaw:** What the code does wrong or what's missing.
**Why It Matters:** The production failure mode — what breaks, for whom, and why it's hard to detect.
**The Fix:** The specific code change or pattern to apply. Include a code example when the fix is non-trivial.
**The Lesson:** The generalizable principle. What should the reader watch for in future code?
```

**For simple findings** (one-line pattern substitution, self-evident why):

```markdown
### SECTION-N: Title
[One paragraph: what's wrong, what to do instead, and why. No code example needed.]
```

**Use the right heuristic:** If an implementing agent could correctly apply the fix from just a one-line description without understanding the failure mode, use the condensed format. If they'd need to understand WHY to apply it correctly, use the full format.

### Step 4: Update the review checklist

Add a checkbox item to the section's review checklist (§X.C) that captures the key check for this pitfall.

### Step 5: Update the Table of Contents

Update the entry count in the TOC table (e.g., `AUTH-1 – AUTH-12` becomes `AUTH-1 – AUTH-13`).

### Step 6: Update the Summary Table

Add a row to Appendix B with the pitfall ID, title, severity, status, and domain.

### Step 7: Check for cross-references

- Does testing-pitfalls.md need a corresponding test guidance entry?
- Does another domain section need a "See Also" pointer?
- Does the same pattern exist elsewhere in the codebase? Grep for other instances.

---

## How to Update an Existing Pitfall

1. **Read the current entry** and understand its intent
2. **Check the code** to see what actually changed
3. **Update the entry** to reflect reality — never preserve a prescription that contradicts the code
4. **Update Appendix B** status if it changed (e.g., `UNIMPLEMENTED` → `VALIDATED`)
5. **Check Appendix A** — add a changelog line noting the update date and reason

---

## How to Mark a Pitfall as Superseded

Do NOT delete pitfall entries. Mark them:

```markdown
### SECTION-N: Title

> **SUPERSEDED (YYYY-MM-DD):** [Reason — e.g., "Feature removed in Phase 12" or "Replaced by SECTION-M which covers the broader pattern"]

[Original content preserved below for historical context]
```

Update Appendix B status to `SUPERSEDED`.

---

## Completeness Checklist

**A pitfall update is not complete until ALL of these are done.** Partial updates are how this document drifts — and a drifted document is worse than no document, because it creates false confidence in protections that don't exist.

- [ ] Entry written in the correct domain section with the correct format
- [ ] Entry has the next sequential ID for its section
- [ ] TOC entry count updated
- [ ] Appendix B summary table row added/updated
- [ ] Review checklist (§X.C) updated with the corresponding check item
- [ ] Cross-references checked: testing-pitfalls.md, other domain sections, See Also block
- [ ] If the pattern could exist elsewhere in the codebase: grepped for other instances
- [ ] Appendix A changelog updated with date and source

**If you skip any of these steps, the next agent to read this document will not find your pitfall.** The TOC is the routing table — without it, your entry is invisible. The summary table is the audit trail — without it, the next health review won't know your finding was addressed.

---

## Voice and Style Reference

This document uses persuasion principles to ensure agents follow critical practices:

- **Authority** for bright-line rules: "MUST", "Never", "Always", "No exceptions"
- **Implementation intentions** for triggers: "When writing a PATCH handler, ALWAYS use pointer types"
- **Social proof via failure modes**: "Without this, the webhook client follows redirects to internal metadata endpoints — every time"
- **Commitment** via checklists: the review checklists at the end of each section

When writing pitfall entries, apply these principles. A pitfall that says "consider using X" will be ignored under pressure. A pitfall that says "MUST use X — without it, Y happens every time" will be followed.

Reference: the `superpowers:writing-skills` skill (or equivalent in your skill library) carries the full persuasion-principles framework if you want to go deeper.
