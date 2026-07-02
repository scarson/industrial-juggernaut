// ABOUTME: The GameRoom Durable Object — the critical section (validate → apply → await put → arm alarm → send → drive).
// ABOUTME: Storage is the single source of truth; `session` is a cache. Effects flow through an injectable send sink.
import { DurableObject } from "cloudflare:workers";
import {
  openSession,
  applyCommand,
  applyEntry,
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
  readPending,
  loadSnapshotAndTail,
} from "./storage";
import type {
  SessionState,
  Effects,
  AlarmIntent,
  CommandCtx,
  SessionHeader,
} from "../session";
import type { ClientCommand, RoomOptions, ServerMessage } from "../wire/protocol";

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
   * Rebuild `this.session` from storage on a wake with an empty cache. B3.2 ships the MINIMAL form: load the
   * header bundle → openSession → install digests → replay the FULL log via applyEntry → reload pending.
   *
   * B3.3 REPLACES this body with the cheap snapshot+tail path (install snapshot.state, apply only the
   * post-snapshot tail), the replayVersion-mismatch freeze-on-divergence check, chainAttacker derivation from
   * the last log entry, the pending-deadline alarm re-arm, and a post-rehydrate driveAgents. The structure below
   * (load bundle → open → replay → reload pending → [B3.3: derive chain / re-arm / freeze / drive]) is kept so
   * B3.3 extends rather than rewrites it. An uninitialized room leaves `this.session` null (the caller replies
   * ROOM_NOT_INITIALIZED).
   */
  private async rehydrate(): Promise<void> {
    const bundle = await readHeaderBundle(this.ctx.storage);
    if (bundle === null) return; // never initialized — caller handles the null session

    this.frozen = await readFrozen(this.ctx.storage);

    const session = openSession(bundle.header, bundle.roomOptions);
    for (let seat = 0; seat < session.seats.length; seat++) {
      session.seats[seat]!.authorizedDigest = bundle.authorizedDigests[seat] ?? null;
    }

    // B3.2 minimal replay: fold the FULL log from index 0 (no snapshot fast-path yet — B3.3 adds it).
    const { tail } = await loadSnapshotAndTail(this.ctx.storage);
    let game = session.game;
    for (const { entry } of tail) {
      game = applyEntry(game, entry).state;
    }
    session.game = game;
    session.logLength = tail.length;

    // Reload the live pending (a tombstone / absent value → null).
    session.pending = await readPending(this.ctx.storage);

    // B3.3 ADDS HERE: derive chainAttacker from the last log entry (an open attack chain), re-arm the
    // pending-deadline alarm, run the replayVersion-mismatch freeze-on-divergence check, and call driveAgents().

    this.session = session;
  }
}
