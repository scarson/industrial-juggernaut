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
  resolveDefender,
} from "../session";
import { representativeDefender } from "../index";
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
import { malformedError, unknownTypeError, oversizedError } from "../session";
import { tokenDigest } from "./ids";
import { parseClientCommand, isKnownCommandType } from "./parse-command";
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

/** The largest single wire message the host accepts. Anything larger is OVERSIZED (rejected before parse, B6.2). */
const MAX_MESSAGE_BYTES = 64 * 1024;
/** After this many cumulative malformed messages (the count survives hibernation) the socket is closed 1008 (B6.2). */
const MAX_MALFORMED = 8;

/** The result of `handleCommand`. `"reducer-threw"` means the Layer-2 backstop caught an unexpected throw from
 *  `applyCommand` — the caller counts it toward the malformed-abuse budget (a shape Layer 1 missed, or a reducer bug). */
type CommandOutcome = "ok" | "reducer-threw";

/** The bindings this DO uses (mirrors wrangler.jsonc). */
interface Env {
  GAME_ROOM: DurableObjectNamespace;
}

/**
 * The send sink: the three effect channels the reducer emits — `reply` (the originating socket only),
 * `toSeat` (all of a seat's tabs), `broadcast` (every socket). Held as an instance property so a test can
 * swap it wholesale and `runInDurableObject` can observe sends. The DEFAULT is real socket fan-out (built in
 * the constructor from `getWebSockets`); `reply` routes to the per-command `replyTarget` the message handler binds.
 */
type SendSink = {
  reply: (msgs: ServerMessage[]) => void;
  toSeat: (seat: number, msg: ServerMessage) => void;
  broadcast: (msgs: ServerMessage[]) => void;
};

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
  /** The originating socket of the command currently being handled. `webSocketMessage` sets it before dispatch and
   *  clears it in `finally`; every non-command path (alarm / rehydrate / init drive) leaves it null, so a `reply`
   *  emitted off those paths reaches nobody (they use broadcast / toSeat, which do not need an originating socket). */
  private replyTarget: WebSocket | null = null;
  /** The effect send channels — REAL socket fan-out by default (see the constructor). `broadcast`/`toSeat` route
   *  from `getWebSockets()` on EVERY path (command, alarm, rehydrate, init); `reply` routes to `replyTarget`. Tests
   *  spy by replacing this whole object and calling `handleCommand` directly. */
  private sink: SendSink;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // The client sends an app-level "ping" (~25 s) that the runtime answers "pong" WITHOUT waking the DO
    // (no `webSocketMessage` invocation, no billable duration) — the client cannot emit protocol pings.
    // Registered in the constructor so it is installed on every wake (the constructor runs on re-init after
    // hibernation), never a `setTimeout`/`setInterval` (those prevent hibernation and die on eviction).
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));

    // The permanent, real send sink. Built once here (not per-command) so alarm() / rehydrate() / init drives fan
    // out to real sockets, not a no-op. Each message is JSON-encoded ONCE per socket set. Every send goes through
    // `trySend` so a dead/closing socket can never throw out of `sendEffects` (the B5 liveness window — a send
    // throw between the awaited persist and the trailing driveAgents would strand a rolled-to agent turn).
    this.sink = {
      reply: (msgs) => {
        const ws = this.replyTarget;
        if (ws === null) return; // no originating socket bound (an alarm/rehydrate path) → reaches nobody
        for (const m of msgs) this.trySend(ws, JSON.stringify(m));
      },
      toSeat: (seat, msg) => {
        const encoded = JSON.stringify(msg);
        for (const ws of this.ctx.getWebSockets("seat:" + seat)) this.trySend(ws, encoded);
      },
      broadcast: (msgs) => {
        for (const m of msgs) {
          const encoded = JSON.stringify(m);
          for (const ws of this.ctx.getWebSockets()) this.trySend(ws, encoded);
        }
      },
    };
  }

  /**
   * Send one already-encoded message to one socket, swallowing any throw. A send throws when the socket is
   * closing/closed; presence is advisory UI state (spec §3), so a dead socket must NEVER propagate an error out
   * of `sendEffects` — that would interrupt the persist→alarm→send→drive critical section (the B5 liveness window).
   * The socket is simply dropped from this send; the seat tag + hibernation attachment remain the durable identity.
   */
  private trySend(ws: WebSocket, encoded: string): void {
    try {
      ws.send(encoded);
    } catch {
      // The socket is gone. Presence is advisory (spec §3); no durable state to unwind. Drop it from this send.
    }
  }

  /**
   * Internal routes (the Worker forwards to these; never public):
   * - POST /init : one-time room initialization (header bundle + digests → openSession → writeHeader → drive).
   * - GET  /ws   : the WebSocket upgrade — WebSocketPair + accept + seat-tag + serializeAttachment (B4).
   */
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // The Worker POSTs /init directly (https://do.internal/init) and forwards the WS upgrade with its
    // original path (/api/games/:id/ws), so match the WS route by suffix, not an exact pathname.
    if (request.method === "POST" && url.pathname === "/init") {
      return this.handleInit(request);
    }
    if (url.pathname === "/ws" || url.pathname.endsWith("/ws")) {
      return this.handleUpgrade(request, url);
    }
    return new Response("not found", { status: 404 });
  }

  /**
   * The WebSocket upgrade (a wake path — lazy-rehydrate first). Validates the request SHAPE then AUTHENTICATES the
   * seat token: it must be an `Upgrade: websocket` request to an initialized room, with an in-range integer `?seat=N`
   * (shape) AND a `?token=...` whose SHA-256 digest matches that seat's authorized digest (auth). On success it mints
   * a hibernatable socket tagged `seat:<n>` (so `getWebSockets("seat:"+n)` finds a seat's tabs — multi-tab, B6) and
   * stashes the per-socket attachment (`seat` = the authenticated identity `webSocketMessage` reads back after
   * hibernation; `malformedCount` = the abuse counter B6.2 increments).
   *
   * AUTH — the token-digest check is the ONLY authentication; the per-message handlers then TRUST the attachment's
   * `seat` (validated here). LAYER 2 of the three-layer agent-seat resolution lives here: an agent seat has
   * `authorizedDigest === null` (tokens are minted for HUMAN seats only), so it can never match any token — the
   * upgrade refuses to bind a socket to an agent seat regardless of token validity (agent seats are host-driven,
   * never socket-bound). A refusal returns a GENERIC 403 that does not reveal whether the seat exists, is an agent,
   * or how close the token was. DO-AUTH-1: never log the token or the query string; never store the raw token.
   */
  private async handleUpgrade(request: Request, url: URL): Promise<Response> {
    if ((request.headers.get("Upgrade") ?? "").toLowerCase() !== "websocket") {
      return new Response("expected a websocket upgrade", { status: 426 });
    }

    // Lazy-rehydrate: the room must be initialized before a socket can bind to a seat. An uninitialized room
    // (never /init'd) leaves `this.session` null → reject; the Worker already rejects joins to unknown rooms.
    if (this.session === null) await this.rehydrate();
    if (this.session === null) {
      return new Response("room not initialized", { status: 404 });
    }

    // Parse the seat from the query (integer, in range). Missing / empty / non-integer / out-of-range → 400
    // (shape, not auth). `Number("")` is 0, so an empty `?seat=` must be rejected explicitly before Number().
    const seatParam = url.searchParams.get("seat");
    const seat = seatParam === null || seatParam.trim() === "" ? NaN : Number(seatParam);
    if (!Number.isInteger(seat) || seat < 0 || seat >= this.session.seats.length) {
      return new Response("invalid seat", { status: 400 });
    }

    // AUTHENTICATE the seat token. The authorized digest is null for an agent seat (LAYER 2 — no token to match, so
    // the seat is refused outright: agent seats are host-driven, never socket-bound) and for any seat missing a token.
    // A generic "bad seat token" 403 covers every failure mode (wrong token / agent seat / absent token) so the
    // rejection leaks nothing. DO-AUTH-1: the raw token never touches a log or storage — only its digest is compared.
    const authorizedDigest = this.session.seats[seat]!.authorizedDigest;
    const token = url.searchParams.get("token");
    if (authorizedDigest === null || token === null || (await tokenDigest(token)) !== authorizedDigest) {
      return new Response("bad seat token", { status: 403 });
    }

    // Mint the hibernatable socket. `acceptWebSocket(server, tags)` (NOT ws.accept()) is what lets the DO hibernate
    // while the socket stays connected; the `seat:<n>` tag is the multi-tab discovery key. The attachment survives
    // hibernation (16 KiB cap — a small object is trivially under). Never store the raw token (DO-AUTH-1) — only the
    // authenticated `seat` (the identity the per-message handler trusts) and the malformed-abuse counter.
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], ["seat:" + seat]);
    pair[1].serializeAttachment({ seat, malformedCount: 0 });
    return new Response(null, { status: 101, webSocket: pair[0] });
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
   * A wake path (lazy-rehydrate). The thin wrapper over the critical section: read the authenticated seat from the
   * surviving socket attachment (set at accept, survives hibernation), parse the message JSON into a ClientCommand,
   * build the per-command ctx, and call `handleCommand`. The JSON.parse / crypto.randomUUID happen HERE (before
   * handleCommand) so the critical section keeps its no-non-storage-await invariant (plan B3.2).
   *
   * Send routing (B6.1): the instance `sink` is the permanent real fan-out (broadcast/toSeat via `getWebSockets`,
   * `reply` via `replyTarget`). This handler binds `replyTarget` to the originating socket for the duration of the
   * command and clears it in `finally`, so a subsequent spy (or an alarm-path reply) sees the null default.
   *
   * Malformed enforcement (B6.2): OVERSIZED (`> MAX_MESSAGE_BYTES`) / JSON.parse failure (MALFORMED) / unknown
   * `type` (UNKNOWN_TYPE) each reply a structured error, then `registerMalformed` bumps the attachment's cumulative
   * `malformedCount` (which survives hibernation — DO-HIBER-1) and closes the socket 1008 once it reaches
   * MAX_MALFORMED. A WELL-FORMED command never increments the count. The count lives in the attachment (not memory)
   * so an abuser cannot reset their malformed budget by idling until the DO hibernates.
   */
  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (this.session === null) await this.rehydrate();

    const att = ws.deserializeAttachment() as { seat: number; malformedCount: number } | null;
    // A socket accepted by this DO always carries an attachment (set at accept). Absent → treat as unattributable.
    if (att === null) return;
    const seat = att.seat;

    // Bind the originating socket so `reply` routes to it for this command; cleared in `finally`.
    this.replyTarget = ws;
    try {
      // OVERSIZED: reject on the raw wire byte length before parsing. A binary frame carries its byteLength for free
      // (no decode). A text frame's exact UTF-8 byte length needs one encode pass; the transient buffer is bounded
      // and short-lived, and an oversized frame is flagged immediately, so the cost is acceptable.
      const byteLength = typeof message === "string" ? new TextEncoder().encode(message).length : message.byteLength;
      if (byteLength > MAX_MESSAGE_BYTES) {
        this.sink.reply([oversizedError(byteLength, MAX_MESSAGE_BYTES)]);
        this.registerMalformed(ws, att);
        return;
      }

      const text = typeof message === "string" ? message : new TextDecoder().decode(message);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        this.sink.reply([malformedError("invalid JSON")]);
        this.registerMalformed(ws, att);
        return;
      }

      // LAYER 1 (primary) — full SHAPE validation before handleCommand. `applyCommand` dereferences fields like
      // `decl.target.x` / `pieces.map(...)` without null/array guards, so a well-typed-`type` but shape-malformed
      // payload ({type:"attack",decl:null}, {type:"build",pieces:"x"}, ...) from a VALID-seat client would throw
      // uncaught out of the reducer — crashing the room AND bypassing the abuse budget. `parseClientCommand` rejects
      // any shape mismatch → route it to MALFORMED + the count-limit, exactly like invalid JSON. UNKNOWN_TYPE (an
      // unrecognized `type`) stays a distinct code; a known type with a broken shape is MALFORMED.
      const command = parseClientCommand(parsed);
      if (command === null) {
        const type = (parsed as { type?: unknown } | null)?.type;
        // UNKNOWN_TYPE is reserved for a real string `type` that isn't a known command; a known type with a broken
        // shape, or a non-object / no-string-type payload, is MALFORMED (never surface a literal "undefined").
        this.sink.reply([
          typeof type === "string" && !isKnownCommandType(type)
            ? unknownTypeError(type)
            : malformedError(typeof type === "string" ? `malformed ${type} command` : "malformed command payload"),
        ]);
        this.registerMalformed(ws, att);
        return;
      }

      const ctx: CommandCtx = { actingSeat: seat, nowEpochMs: Date.now(), decisionId: crypto.randomUUID() };
      // Layer 2 backstop: a reducer throw handleCommand caught (Layer 1 should have prevented it) counts toward the
      // abuse budget too — a client that keeps tripping it is closed at MAX_MALFORMED, same as any malformed traffic.
      if ((await this.handleCommand(command, ctx)) === "reducer-threw") {
        this.registerMalformed(ws, att);
      }
    } finally {
      this.replyTarget = null;
    }
  }

  /**
   * Record one malformed message against a socket: bump the attachment's cumulative `malformedCount` (re-serialized
   * so it survives hibernation — an abuser cannot reset the budget by idling, DO-HIBER-1) and, once the count reaches
   * {@link MAX_MALFORMED}, send a final error and close the socket 1008. Only malformed messages call this; a
   * well-formed command never touches the count. Must run inside the `replyTarget`-bound window (the final error
   * routes through `reply`).
   */
  private registerMalformed(ws: WebSocket, att: { seat: number; malformedCount: number }): void {
    const malformedCount = att.malformedCount + 1;
    ws.serializeAttachment({ seat: att.seat, malformedCount });
    if (malformedCount >= MAX_MALFORMED) {
      this.sink.reply([malformedError("too many malformed messages")]);
      ws.close(1008, "too many malformed messages");
    }
  }

  /**
   * A socket closed / errored. Presence is advisory UI state (spec §3) — B6 formalizes presence tracking and
   * `trySend`-failure marking. B4 leaves these as clean seams: the hibernation attachment and the seat tag are the
   * durable identity, so no host bookkeeping is lost when a socket drops. (No `ws.close()` needed — the
   * web_socket_auto_reply_to_close compat behavior completes the close handshake.)
   */
  override async webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    // B6 seam: mark the socket's seat presence gone for the roster. No durable state to unwind here.
  }

  override async webSocketError(_ws: WebSocket, _error: unknown): Promise<void> {
    // B6 seam: same advisory-presence handling as webSocketClose.
  }

  /**
   * The defender-timeout alarm (a wake path — lazy-rehydrate first). The single alarm consumer in v1: the opt-in
   * defender timeout (OFF by default; armed only while a pending decision is open AND roomOptions.defenderTimeout
   * is enabled). A bare `setAlarm(atEpochMs)` carries NO decision id, so identity/recency is checked against the
   * STORED `pending`, not the alarm itself. This handler RESOLVES a timed-out decision; it never arms/clears the
   * alarm for the normal command path — `handleCommand`'s `realizeAlarm(effects.alarm)` already does that
   * (openDefenderDecision → set, resolveDecision → clear, extendDecision → a fresh set with the pushed deadline).
   *
   * AT-LEAST-ONCE + IDEMPOTENCY (CF alarms retry on an uncaught throw with exponential backoff, ≤6): the resolving
   * `log:N` append AND the pending-clear (`[PENDING_KEY]: PENDING_TOMBSTONE`) land in ONE atomic put (resolveDefender
   * → persistEvent). A retry after a mid-handler failure re-reads a still-LIVE `pending` (the prior attempt never
   * committed) and re-resolves IDENTICALLY (representativeDefender is deterministic on the write-locked board); once
   * committed, `readPending` returns null → the retry no-ops at the tombstone guard below. NEVER leave `pending`
   * live without the append, nor tombstone it without the append — the single atomic put guarantees both-or-neither.
   *
   * PHASE-2 alarmQueue MULTIPLEX HOOK (documented contract — NOT built in v1): a single DO has exactly ONE alarm
   * slot. v1's only consumer is this defender timeout, so the slot IS the defender deadline and this handler owns
   * it outright. When Phase 2 adds a SECOND consumer (room-TTL GC), the slot must be multiplexed: store an
   * `alarmQueue` row — a sorted list of `{ atEpochMs, kind, payload }` — and have `alarm()` dispatch the
   * earliest-due entry by `kind` (a `defenderTimeout` entry → this resolution path; a `roomTtl` entry → the GC
   * path) and then re-arm `setAlarm` to the next-earliest entry. Until that lands, ship the single-consumer form.
   */
  override async alarm(_alarmInfo?: AlarmInvocationInfo): Promise<void> {
    // Wake path: rehydrate an empty cache before touching `this.session` (B4's message/upgrade paths do the same).
    if (this.session === null) await this.rehydrate();
    if (this.session === null) return; // an uninitialized room has no decision to resolve
    const pending = this.session.pending;

    // (2) No-op on an absent/tombstoned pending — the decision was already resolved (fire-after-answer): the
    //     answer's atomic put cleared the pending, and this is a late at-least-once retry firing after the commit.
    if (pending === null) return;

    // (3) Recency guard (extendDecision re-arm + early at-least-once retries): a null deadline means the timeout
    //     is OFF and no alarm should exist → defensively no-op. A live deadline in the FUTURE means this alarm
    //     fired for an OLD deadline (extendDecision pushed it later) or is an early retry → re-arm to the real
    //     deadline and return WITHOUT resolving. alarm() is host code, so reading Date.now() here is allowed.
    if (pending.deadlineEpochMs === null) return;
    if (Date.now() < pending.deadlineEpochMs) {
      await this.ctx.storage.setAlarm(pending.deadlineEpochMs);
      return;
    }

    // (4) Date.now() >= deadline → resolve with the deterministic representative defender.
    const def = representativeDefender(this.session.game, pending.proposed.target, pending.promptedSeat);
    if (def === null) {
      // Can't happen under the write-lock: validateTargetAttackable guaranteed an eligible defender at open, and
      // the board is frozen while the pending holds the lock. Defense in depth — never call resolveDefender(null).
      // Freeze the room (the B3.3 mechanism; mutating commands then → FROZEN) and DELETE the alarm so it does not
      // retry-loop, leaving `pending` intact for post-mortem.
      await this.freezeAndDisarm();
      return;
    }

    const result = resolveDefender(this.session, pending, def);
    if ("error" in result) {
      // representativeDefender's pick is always eligible, so validateAttackDecl inside resolveDefender should never
      // reject it — but if it somehow does, treat it exactly like the null-defender case: freeze + disarm rather
      // than looping the alarm forever on an unresolvable decision, leaving `pending` intact for post-mortem.
      await this.freezeAndDisarm();
      return;
    }

    // The ONE atomic put: the resolving attack `log:N` (+ its auto-close endRound + snapshot) AND the pending-clear
    // tombstone, together (resolveDefender merged [PENDING_KEY]: PENDING_TOMBSTONE into the same put).
    await persistEvent(this.ctx.storage, result.effects.persist!);
    // Maintain `chainAttacker` the same way the resolveDecision command layer does (session.ts withChainAttacker):
    // a round that auto-closed (advanced) clears it; otherwise the attacker keeps their open chain.
    this.session = { ...result.next, chainAttacker: result.advanced ? null : pending.declaringPlayer };
    // Realize the reducer's alarm intent (a resolution emits { action: "clear" } → deleteAlarm).
    await this.realizeAlarm(result.effects.alarm);
    // Broadcast the applied resolution (the attack + any auto-close), each strictly after its awaited persist.
    this.sendEffects(result.effects);
    // The resolved attack may unblock agent turns (the attacker's chain continued, or the round rolled to an agent).
    // Liveness note: sends go through the non-throwing trySend, so sendEffects cannot strand this driveAgents; the
    // only throw left between the awaited persist and this drive is a storage error in realizeAlarm. If that fires,
    // the resolution is durable but a rolled-to agent turn is un-driven on this invocation — the alarm's
    // at-least-once retry re-instantiates the DO and rehydrate()'s tail driveAgents self-heals the common (cold)
    // case; a warm-instance retry no-ops at the pending-tombstone guard and the turn then waits for the next wake /
    // human command (which tail-drives).
    await this.driveAgents();
  }

  /**
   * Freeze the room and delete the alarm — the alarm-side defense-in-depth exit (a null/unresolvable representative
   * defender). Reuses the B3.3 freeze mechanism (writeFrozen + the `frozen` flag; mutating commands → FROZEN) and
   * disarms the alarm so a non-resolving decision does not retry-loop, leaving `pending` live for post-mortem.
   */
  private async freezeAndDisarm(): Promise<void> {
    await writeFrozen(this.ctx.storage);
    this.frozen = true;
    await this.ctx.storage.deleteAlarm();
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
  async handleCommand(command: ClientCommand, ctx: CommandCtx): Promise<CommandOutcome> {
    if (this.session === null) await this.rehydrate();
    if (this.session === null) {
      // An uninitialized room cannot be joined (the Worker rejects joins to unknown rooms), but a command that
      // somehow reaches here gets a structured error rather than a crash — the reply channel carries it back.
      this.sink.reply([
        { type: "error", code: "ROOM_NOT_INITIALIZED", message: "This room has not been initialized.", currentLogIndex: null },
      ]);
      return "ok";
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
      return "ok";
    }

    // 1. Validate + apply — synchronous, pure, NO await between here and the persist. LAYER 2 (backstop): wrap ONLY
    //    this pre-persist reducer call. Layer 1 (parseClientCommand in webSocketMessage) should have rejected every
    //    shape error already; this guarantees that even a shape Layer 1 missed OR a genuine reducer bug can never
    //    crash the room or escape the abuse budget — it becomes a counted MALFORMED with NO persist, never a swallow.
    //    Only applyCommand is wrapped; the persist/alarm/send/drive below stay unguarded so real storage failures
    //    surface loud (B3). The caller (webSocketMessage) counts the reducer-throw toward MAX_MALFORMED.
    let applied: { next: SessionState; effects: Effects };
    try {
      applied = applyCommand(this.session, command, ctx);
    } catch {
      this.sink.reply([malformedError(`could not process the ${command.type} command`)]);
      return "reducer-threw";
    }
    const { next, effects } = applied;

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
    return "ok";
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
    try {
      let game: GameState = snapshot !== null ? snapshot.state : session.game;
      for (const { entry } of tail) {
        game = applyEntry(game, entry).state;
      }
      session.game = game;
      session.logLength = (snapshot !== null ? snapshot.logIndex + 1 : 0) + tail.length;
      // Derive chainAttacker from the LAST applied log entry: an `attack` entry does NOT close the round, so if the
      // last entry is an attack the chain is still open and belongs to that entry's player. Any other last entry (or
      // an empty tail) means no open chain. This exactly reconstructs an open attack chain across eviction so a
      // reconnecting attacker can still send endRound. (Not persisted — session-types.ts.)
      const lastEntry: LogEntry | null = tail.length > 0 ? tail[tail.length - 1]!.entry : null;
      session.chainAttacker = lastEntry !== null && lastEntry.kind === "attack" ? lastEntry.player : null;
    } catch {
      // The stored log does not replay under the current engine. A frozen room with an unreplayable log serves the
      // best-available state for resync — snapshot.state when a snapshot exists, else the deterministic openSession
      // initial state — with logLength/chainAttacker consistent with THAT state (the unapplied tail contributes
      // neither). The raw stored log remains the authoritative record for the replay viewer (recorded under the
      // engine version stamped on the snapshot/header, per the freeze labeling). Reaching here NOT-frozen means an
      // unreplayable log under a MATCHING version stamp (storage corruption / an unbumped engine change): freeze
      // now — serving a stale state as live would let mutating commands append against it.
      if (!this.frozen) {
        await writeFrozen(this.ctx.storage);
        this.frozen = true;
      }
      session.game = snapshot !== null ? snapshot.state : session.game;
      session.logLength = snapshot !== null ? snapshot.logIndex + 1 : 0;
      session.chainAttacker = null;
    }

    // Reload the live pending (a tombstone / absent value → null).
    session.pending = await readPending(this.ctx.storage);

    this.session = session;

    // Self-heal a lost alarm: if a pending is live with a deadline, re-arm the timeout alarm (idempotent — it
    // overwrites the single alarm slot; P1-15). Covers a setAlarm that failed before eviction. Alarm-loss window:
    // a crash BETWEEN persist(PENDING) and setAlarm (the command path persists first) loses the alarm until the
    // next wake re-arms it here. Acceptable liveness: a live pending implies a prompted defender and connected
    // clients whose traffic wakes the room, so the window closes on the first message after the crash.
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
    let boundaryHash: string;
    try {
      let game = openSession(header, roomOptions).game;
      for (const entry of boundaryLog) {
        game = applyEntry(game, entry).state;
      }
      boundaryHash = stateHash(game);
    } catch {
      // The recorded log does not even APPLY under the current engine (a bumped engine now rejects a
      // previously-legal entry) — strictly stronger divergence evidence than a hash mismatch. Without this catch
      // the throw would propagate out of rehydrate BEFORE writeFrozen commits, leaving the room an unmarked brick
      // that re-throws on every wake. Only the pure replay is wrapped: applyEntry/openSession touch no storage, so
      // a transient storage error can never be misread as divergence (readLogHead sits outside the try).
      return false;
    }
    if (boundaryHash !== snapshot.stateHash) return false; // hash diverges → the played game replays differently
    // Hash matches: continue ONLY if the tail is empty. A non-empty tail is unverifiable (no per-entry hash).
    return tailLength === 0;
  }
}
