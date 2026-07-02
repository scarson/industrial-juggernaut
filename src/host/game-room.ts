// ABOUTME: The GameRoom Durable Object — the critical section (validate → apply → await put → arm alarm → send → drive).
// ABOUTME: Storage is the single source of truth; `session` is a cache. Effects flow through an injectable send sink.
import { DurableObject } from "cloudflare:workers";
import {
  openSession,
  applyCommand,
  applyEntry,
  stateHash,
  needsDrive,
  driveOneStep,
  agentForSeat,
} from "../session";
import {
  writeHeader,
  persistEvent,
  readHeaderBundle,
  readInitialized,
  readFrozen,
  writeFrozen,
  readPending,
  loadSnapshotAndTail,
  readLogHead,
} from "./storage";
import { REPLAY_VERSION } from "./version";
import type {
  SessionState,
  Effects,
  AlarmIntent,
  CommandCtx,
  SessionHeader,
  Snapshot,
  LogEntry,
} from "../session";
import type { GameState } from "../engine/types";
import type { ClientCommand, RoomOptions, ServerMessage } from "../wire/protocol";

/**
 * The mutating command kinds — every game-state / pending write. A frozen room (recovery detected replay
 * divergence, B3.3) rejects all of these with a FROZEN error emitted by the HOST (the reducer has no frozen
 * concept — it stays frozen-agnostic). Non-mutating reads (`resync`, `hello`, `claimSeat` roster ack) still work
 * so a client can reconnect and see the frozen state / the recorded replay.
 */
const MUTATING_COMMANDS: ReadonlySet<ClientCommand["type"]> = new Set([
  "placeFirstBase",
  "build",
  "attack",
  "endRound",
  "pass",
  "resolveDecision",
  "extendDecision",
]);

/** The bindings this DO uses (mirrors wrangler.jsonc). */
interface Env {
  GAME_ROOM: DurableObjectNamespace;
}

/**
 * The send sink: the three effect channels the reducer emits. B3.2 leaves these as no-op seams the
 * tests spy on; B6.1 replaces the default with real socket fan-out (broadcast / per-seat / originating
 * socket). Held as an instance property so a test can swap it and `runInDurableObject` can observe sends.
 */
type SendSink = {
  reply: (msgs: ServerMessage[]) => void;
  toSeat: (seat: number, msg: ServerMessage) => void;
  broadcast: (msgs: ServerMessage[]) => void;
};

const NOOP_SINK: SendSink = { reply: () => {}, toSeat: () => {}, broadcast: () => {} };

/** The /init payload the Worker create flow POSTs (seed rides as a decimal string — JSON has no bigint). */
type InitPayload = {
  header: Omit<SessionHeader, "seed"> & { seed: string };
  roomOptions: RoomOptions;
  authorizedDigests: (string | null)[];
};

export class GameRoom extends DurableObject<Env> {
  /** A CACHE of the durable state — storage is the single source of truth. Null until init/rehydrate. */
  private session: SessionState | null = null;
  /** True once recovery detected replay divergence (B3.3). A frozen room drives nothing and rejects mutations. */
  private frozen = false;
  /** The effect send channels. B6.1 swaps NOOP_SINK for real socket fan-out; tests spy by replacing it. */
  private sink: SendSink = NOOP_SINK;

  /**
   * Internal routes (the Worker forwards to these; never public):
   * - POST /init : one-time room initialization (header bundle + digests → openSession → writeHeader → drive).
   * - GET  /ws   : the WebSocket upgrade — still 501 in B3 (B4 owns the WebSocketPair + token auth).
   */
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // The Worker POSTs /init directly (https://do.internal/init) and forwards the WS upgrade with its
    // original path (/api/games/:id/ws), so match the WS route by suffix, not an exact pathname.
    if (request.method === "POST" && url.pathname === "/init") {
      return this.handleInit(request);
    }
    if (url.pathname === "/ws" || url.pathname.endsWith("/ws")) {
      // B4 owns the WebSocketPair + per-seat token auth; until then a WS upgrade is not implemented.
      return new Response("GameRoom WebSocket upgrade not implemented until B4", { status: 501 });
    }
    return new Response("not found", { status: 404 });
  }

  /**
   * One-time room initialization. Parses the untrusted-by-shape-but-host-authored payload, re-parses the
   * seed as a bigint, opens the session, installs the per-seat authorized digests, writes the atomic header
   * bundle, caches the session, and drives any agent/agent-first opening. A SECOND init → 409 (already set).
   * On a storage failure the platform resets the DO and the Worker create flow returns 500 (no tokens).
   */
  private async handleInit(request: Request): Promise<Response> {
    if (await readInitialized(this.ctx.storage)) {
      return new Response("room already initialized", { status: 409 });
    }
    const payload = (await request.json()) as InitPayload;
    // Re-parse the seed as a native bigint (it rode as a decimal string over JSON).
    const header: SessionHeader = { ...payload.header, seed: BigInt(payload.header.seed) };

    const session = openSession(header, payload.roomOptions);
    // Install the per-seat authorized digests into the seats runtime (openSession leaves them null).
    for (let seat = 0; seat < session.seats.length; seat++) {
      session.seats[seat]!.authorizedDigest = payload.authorizedDigests[seat] ?? null;
    }

    // The atomic header bundle (header + digests + roomOptions + initialized flag) in ONE put.
    await writeHeader(this.ctx.storage, {
      header,
      roomOptions: payload.roomOptions,
      authorizedDigests: payload.authorizedDigests,
      initialized: true,
    });
    this.session = session;

    // An all-agent or agent-first room starts moving immediately. Per the reducer-layer resolution, a
    // mid-setup victory emits its own gameOver through the drive results — no host special-case needed.
    await this.driveAgents();

    return new Response(null, { status: 200 });
  }

  /**
   * The critical-section entry (the testable seam — B4's webSocketMessage is a thin wrapper that reads the
   * authenticated seat from the socket attachment, parses, builds ctx, and calls this). NO WebSocket reads here.
   *
   * CONCURRENCY INVARIANT (plan B3.2): this handler issues SEVERAL awaited storage writes — the human event,
   * then one per agent-drive round. The guarantee is PER-EVENT: every send is emitted AFTER the awaited
   * persistEvent of the entry(ies) it announces, never before (persist-first — client-visible state must never
   * precede a durably-committed write). There is NO non-storage await anywhere in handleCommand/driveAgents
   * (no fetch, no timers, no subtle.digest — those happen in webSocketMessage BEFORE calling this). The DO input
   * gate guarantees no OTHER incoming event is delivered while any of these awaits is outstanding, so the whole
   * handler runs to completion atomically w.r.t. other events; the multiple awaits do not admit interleaving.
   * Never allowConcurrency/allowUnconfirmed on these writes.
   */
  async handleCommand(command: ClientCommand, ctx: CommandCtx): Promise<void> {
    if (this.session === null) await this.rehydrate();
    if (this.session === null) {
      // An uninitialized room cannot be joined (the Worker rejects joins to unknown rooms), but a command that
      // somehow reaches here gets a structured error rather than a crash — the reply channel carries it back.
      this.sink.reply([
        { type: "error", code: "ROOM_NOT_INITIALIZED", message: "This room has not been initialized.", currentLogIndex: null },
      ]);
      return;
    }

    // A frozen room (recovery divergence, B3.3) rejects every mutating command with a FROZEN error from the HOST.
    // The reducer stays frozen-agnostic (it has no frozen concept); the host intercepts here so a frozen room
    // never mutates. Non-mutating reads (resync / hello / claimSeat) fall through and are answered normally.
    if (this.frozen && MUTATING_COMMANDS.has(command.type)) {
      // `currentLogIndex: logLength` matches the reducer's errorEffects convention (session.ts) — the current head.
      this.sink.reply([
        {
          type: "error",
          code: "FROZEN",
          message: "This room is frozen: it was recorded under an engine version that replays differently.",
          currentLogIndex: this.session.logLength,
        },
      ]);
      return;
    }

    // 1. Validate + apply — synchronous, pure, NO await between here and the persist.
    const { next, effects } = applyCommand(this.session, command, ctx);

    // 2. Persist (if any), THEN cache the new state. A non-mutating result (e.g. claimSeat's roster, a rejected
    //    command) has no persist but still advances the cache to `next`. Order below: persist → arm/clear alarm → send.
    if (effects.persist !== null) {
      await persistEvent(this.ctx.storage, effects.persist);
    }
    this.session = next;

    // 3. Realize the alarm intent BEFORE any send (arming the defender timeout before the prompt goes out
    //    prevents a stall if setAlarm were to fail after the prompt — the rehydrate re-arm then self-heals it).
    await this.realizeAlarm(effects.alarm);

    // 4. Send this command's own effects (each strictly after its awaited persist above).
    this.sendEffects(effects);

    // 5. Drive any agent/eliminated rounds this command unblocked (each round its own persist→send pair).
    await this.driveAgents();
  }

  /**
   * The shared agent-drive loop: advance every agent/eliminated round the current state calls for, each as its
   * own awaited persist THEN send (per-event persist-first). A frozen room drives nothing. Called after init,
   * after every applied command, after rehydrate (B3.3), and after an alarm resolves (B5).
   */
  private async driveAgents(): Promise<void> {
    while (!this.frozen && this.session !== null && needsDrive(this.session)) {
      const r = driveOneStep(this.session, agentForSeat, {
        nowEpochMs: Date.now(),
        decisionId: crypto.randomUUID(),
      });
      if (r.effects.persist !== null) {
        await persistEvent(this.ctx.storage, r.effects.persist);
      }
      this.session = r.next;
      // A drive step may arm an alarm (an agent attacking a human opens a pending) — realize it before sending.
      await this.realizeAlarm(r.effects.alarm);
      // Every broadcast strictly after ITS awaited persist above.
      this.sendEffects(r.effects);
      if (r.terminal !== null) break;
    }
  }

  /** Realize an AlarmIntent as a storage side effect. Null → nothing to do. Never a non-storage await. */
  private async realizeAlarm(alarm: AlarmIntent | null): Promise<void> {
    if (alarm === null) return;
    if (alarm.action === "set") {
      await this.ctx.storage.setAlarm(alarm.atEpochMs);
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }

  /** Route an Effects bundle's sends through the sink: reply → originating socket, toSeat → a seat's tabs, broadcast → all. */
  private sendEffects(effects: Effects): void {
    if (effects.reply.length > 0) this.sink.reply(effects.reply);
    for (const { seat, message } of effects.toSeat) this.sink.toSeat(seat, message);
    if (effects.broadcast.length > 0) this.sink.broadcast(effects.broadcast);
  }

  /**
   * Rebuild `this.session` from storage on a wake with an empty cache (storage is the single source of truth).
   * The cheap, steady-state path (replayVersion MATCHES): openSession → install digests → install the snapshot's
   * post-close state (or replay the whole log if no snapshot yet) → apply the post-snapshot tail → reload pending →
   * derive `chainAttacker` from the last log entry (reconstructs an open attack chain) → re-arm the timeout alarm →
   * drive any agent rounds the wake unblocked. On a `replayVersion` MISMATCH (rare — the B8 CI guard forces a
   * version bump on any replay-closure change), run the freeze-on-divergence check before continuing. An
   * uninitialized room leaves `this.session` null (the caller replies ROOM_NOT_INITIALIZED).
   *
   * GEO-3: recovery re-runs `applyEntry`, which installs each entry's `rngBeforeApply` before applying — the locked
   * replay model. It never uses "the preceding entry's post-state". NO non-storage await anywhere in this path
   * (the B3.2 concurrency invariant governs — see handleCommand).
   */
  private async rehydrate(): Promise<void> {
    const bundle = await readHeaderBundle(this.ctx.storage);
    if (bundle === null) return; // never initialized — caller handles the null session

    this.frozen = await readFrozen(this.ctx.storage);

    const session = openSession(bundle.header, bundle.roomOptions);
    // Rebuild seat runtime: authorizedDigest from the header bundle; claimed/lastRequestId are ephemeral (P1-9) —
    // openSession already leaves them false/null, and sockets re-ack on reconnect.
    for (let seat = 0; seat < session.seats.length; seat++) {
      session.seats[seat]!.authorizedDigest = bundle.authorizedDigests[seat] ?? null;
    }

    // Load the snapshot (post-close state at snapshot.logIndex) and the post-snapshot tail. With no snapshot yet
    // (early game), `snapshot` is null and `tail` is the FULL log from index 0.
    const { snapshot, tail } = await loadSnapshotAndTail(this.ctx.storage);

    // The replayVersion the room was recorded under: the snapshot's stamp when there is a snapshot, else the
    // header's stamp (the room's create-time REPLAY_VERSION). The plan keys the mismatch check on the snapshot's
    // stamp; for a no-snapshot room there is no snapshot hash to validate, so we compare the header's replayVersion
    // (which openSession/initGame reproduce deterministically from the header — no stored log to reinterpret when
    // the log is empty, and any non-empty log under a mismatched header has NO stored hash to catch divergence).
    const recordedReplayVersion = snapshot !== null ? snapshot.replayVersion : bundle.header.replayVersion;
    const versionMatches = recordedReplayVersion === REPLAY_VERSION;

    if (!versionMatches && !this.frozen) {
      // MISMATCH (expensive path — taken ONLY on a version mismatch, which the CI guard makes rare). Decide whether
      // the recorded game replays identically under the CURRENT engine before continuing; freeze if we cannot prove
      // it. Skipped when already frozen (a prior wake decided; the freeze flag is authoritative).
      const canContinue = await this.canContinueUnderCurrentEngine(bundle.header, bundle.roomOptions, snapshot, tail.length);
      if (!canContinue) {
        await writeFrozen(this.ctx.storage);
        this.frozen = true;
      }
    }

    // Build the game state. Cheap path: install the snapshot's post-close state and apply ONLY the tail. No
    // snapshot: replay the whole log (the tail IS the full log from index 0). Either way `applyEntry` installs each
    // entry's rngBeforeApply (GEO-3). When frozen, we still reconstruct the state so resync / the replay viewer work.
    let game: GameState = snapshot !== null ? snapshot.state : session.game;
    for (const { entry } of tail) {
      game = applyEntry(game, entry).state;
    }
    session.game = game;
    session.logLength = (snapshot !== null ? snapshot.logIndex + 1 : 0) + tail.length;

    // Reload the live pending (a tombstone / absent value → null).
    session.pending = await readPending(this.ctx.storage);

    // Derive chainAttacker from the LAST applied log entry: an `attack` entry does NOT close the round, so if the
    // last entry is an attack the chain is still open and belongs to that entry's player. Any other last entry (or
    // an empty tail) means no open chain. This exactly reconstructs an open attack chain across eviction so a
    // reconnecting attacker can still send endRound. (Not persisted — session-types.ts.)
    const lastEntry: LogEntry | null = tail.length > 0 ? tail[tail.length - 1]!.entry : null;
    session.chainAttacker = lastEntry !== null && lastEntry.kind === "attack" ? lastEntry.player : null;

    this.session = session;

    // Self-heal a lost alarm: if a pending is live with a deadline, re-arm the timeout alarm (idempotent — it
    // overwrites the single alarm slot; P1-15). Covers a setAlarm that failed before eviction.
    if (session.pending !== null && session.pending.deadlineEpochMs !== null) {
      await this.ctx.storage.setAlarm(session.pending.deadlineEpochMs);
    }

    // Self-heal the agent-drive: a room evicted mid-agent-turn wakes and continues without a human message.
    // Deterministic per GEO-3 (agents draw from the restored rngState) → re-driving reproduces the same entries,
    // so the post-crash drive is idempotent. A frozen room drives nothing (driveAgents guards on `this.frozen`).
    await this.driveAgents();
  }

  /**
   * The replayVersion-mismatch decision (B3.3 step 3): can the recorded game continue under the CURRENT engine?
   * There is exactly ONE stored hash — the snapshot's; the post-snapshot tail has NO per-entry hash. So:
   *  - No snapshot: continue ONLY if the log is empty (nothing to reinterpret — openSession is deterministic from
   *    the header). A non-empty log under a mismatched header has no stored hash to catch a silent divergence → freeze.
   *  - Snapshot present: re-replay `log[0 .. snapshot.logIndex]` from openSession under the current engine and
   *    compare `stateHash` to `snapshot.stateHash`. Hash DIVERGES → freeze (the played game replays differently).
   *    Hash MATCHES but the tail is NON-EMPTY → freeze anyway (the mid-chain tail is unverifiable — snapshots are
   *    only at round boundaries, so there is no hash for the tail; codex P1-7). Hash matches AND tail empty → continue.
   * Reads only storage (the boundary log range) — the no-non-storage-await invariant holds.
   */
  private async canContinueUnderCurrentEngine(
    header: SessionHeader,
    roomOptions: RoomOptions,
    snapshot: Snapshot | null,
    tailLength: number,
  ): Promise<boolean> {
    if (snapshot === null) {
      // A no-snapshot room continues under the new engine only when there is nothing to reinterpret (empty log).
      return tailLength === 0;
    }
    // Re-replay the snapshot-boundary entries 0..snapshot.logIndex from openSession under the CURRENT engine.
    const boundaryLog = await readLogHead(this.ctx.storage, snapshot.logIndex);
    let game = openSession(header, roomOptions).game;
    for (const entry of boundaryLog) {
      game = applyEntry(game, entry).state;
    }
    if (stateHash(game) !== snapshot.stateHash) return false; // hash diverges → the played game replays differently
    // Hash matches: continue ONLY if the tail is empty. A non-empty tail is unverifiable (no per-entry hash).
    return tailLength === 0;
  }
}
