// ABOUTME: SocketDriver — a GameDriver over the DO host's WebSocket: connect, hello/claimSeat handshake,
// ABOUTME: app-level keepalive, and the incoming-message pump. Reconnect + resync is a later task, not here.
//
// DYNAMIC-IMPORT CONTRACT. This module value-imports the wire version constant (src/wire/protocol), the host's
// replay version (src/host/version — the ONE src/host import the client makes), and `./wire-map` (which value-imports
// the src/wire codecs). Those pull real src/wire value modules into the bundle, so this module MUST be reached ONLY
// via dynamic import — from P4.5's live wiring and from tests — NEVER from an eagerly-loaded module. The build-time
// guard (web/scripts/check-bundle.ts) fails the build if any src/wire module lands in an eager chunk.
//
// WHAT IT DOES. On the socket's `open` it sends `hello` (protocol/replay versions — the server replies `reload` on a
// mismatch or a full `resync` as the initial sync) then `claimSeat` (a roster ack; the socket already authenticated
// its seat token at the WS upgrade, so no token rides in any message body), then starts the keepalive and emits
// `connection:"open"`. Every incoming text frame is either the runtime's literal `"pong"` (ignored — auto-answered by
// the DO runtime without waking it) or a JSON `ServerMessage` mapped through the shared wire-map seam to a
// DriverEvent and fanned out to subscribers. The driver sends ONLY well-formed JSON ClientCommands plus the literal
// `"ping"` — nothing else — so it never trips the host's per-socket malformed budget.
import { PROTOCOL_VERSION } from "../../../src/wire/protocol";
import { REPLAY_VERSION } from "../../../src/host/version";
import { toClientCommand, toDriverEvent } from "./wire-map";
import type { ClientCommand, ServerMessage } from "../../../src/wire/protocol";
import type { ConnectionStatus, DriverCommand, DriverEvent, GameDriver } from "./driver";

/** The app-level keepalive period. The DO runtime auto-answers `"ping"` with `"pong"` WITHOUT waking the DO. */
const DEFAULT_KEEPALIVE_MS = 25_000;

/** The minimal `window.location` surface the driver reads to build the ws(s) origin (protocol + host). */
export type SocketLocation = { protocol: string; host: string };

export type SocketDriverOptions = {
  /** The room whose WebSocket the driver connects to (`/api/games/:roomId/ws`). */
  roomId: string;
  /** The seat this client claims. `controllableSeats()` is exactly `[seat]`. */
  seat: number;
  /** The seat token — authenticated by the DO at the WS UPGRADE (query param). It NEVER rides in a message body,
   *  and the driver never puts it in any emitted/thrown error (browser WebSocket cannot set headers). */
  token: string;
  /** Injected WebSocket constructor (the sanctioned boundary fake in tests). Defaults to `new WebSocket(url)`. */
  socketFactory?: (url: string) => WebSocket;
  /** Injected requestId source for `claimSeat`. Defaults to `crypto.randomUUID()` (browser). */
  nextRequestId?: () => string;
  /** Keepalive period in ms. Defaults to {@link DEFAULT_KEEPALIVE_MS}. */
  keepaliveMs?: number;
  /** The origin source for the absolute ws(s) URL. Defaults to `window.location` (wss on https). */
  location?: SocketLocation;
};

/** Build the absolute ws(s) URL: wss on https, ws otherwise; seat + token ride as query params (token URL-encoded). */
function buildUrl(location: SocketLocation, roomId: string, seat: number, token: string): string {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  const query = `seat=${seat}&token=${encodeURIComponent(token)}`;
  return `${scheme}//${location.host}/api/games/${roomId}/ws?${query}`;
}

/**
 * Build a `GameDriver` backed by the DO host's WebSocket. The factory opens the socket immediately (state
 * `"connecting"`); the handshake, keepalive, and `connection:"open"` fire on the socket's `open` event.
 */
export function makeSocketDriver(opts: SocketDriverOptions): GameDriver {
  const socketFactory = opts.socketFactory ?? ((url: string) => new WebSocket(url));
  const nextRequestId = opts.nextRequestId ?? (() => crypto.randomUUID());
  const keepaliveMs = opts.keepaliveMs ?? DEFAULT_KEEPALIVE_MS;
  const location = opts.location ?? window.location;

  const url = buildUrl(location, opts.roomId, opts.seat, opts.token);
  const socket = socketFactory(url);

  const handlers = new Set<(e: DriverEvent) => void>();
  /** The latest mapped `sync` DriverEvent, replayed to any subscriber that attaches after it arrived. */
  let lastSync: DriverEvent | null = null;
  /** The client's view of the authoritative log length — stamped onto every mutating command as expectedLogIndex.
   *  Set from a `sync` (the resync's logLength) and advanced by an `applied` (logIndex + 1). Starts at 0. */
  let logLength = 0;
  let handshaken = false;
  let disposed = false;
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  function emit(event: DriverEvent): void {
    for (const handler of handlers) handler(event);
  }

  function emitConnection(status: ConnectionStatus): void {
    emit({ type: "connection", status });
  }

  function stopKeepalive(): void {
    if (keepaliveTimer !== null) {
      clearInterval(keepaliveTimer);
      keepaliveTimer = null;
    }
  }

  /** Send one well-formed ClientCommand as a JSON text frame. The ONLY JSON the driver ever sends. */
  function sendCommand(command: ClientCommand): void {
    socket.send(JSON.stringify(command));
  }

  socket.onopen = (): void => {
    if (disposed || handshaken) return; // a spurious duplicate open must not re-handshake
    handshaken = true;
    // The handshake: hello (initial-sync trigger) THEN claimSeat (roster ack). No token in either body.
    sendCommand({ type: "hello", protocolVersion: PROTOCOL_VERSION, replayVersion: REPLAY_VERSION });
    sendCommand({ type: "claimSeat", requestId: nextRequestId(), seat: opts.seat });
    keepaliveTimer = setInterval(() => socket.send("ping"), keepaliveMs);
    emitConnection("open"); // after the handshake sends, per the driver contract
  };

  socket.onmessage = (event: MessageEvent): void => {
    if (disposed) return;
    const data = event.data;
    if (typeof data !== "string") return; // the protocol is text-only; ignore any binary frame
    if (data === "pong") return; // the runtime's keepalive answer — NOT JSON; ignore before parsing

    let msg: ServerMessage;
    try {
      msg = JSON.parse(data) as ServerMessage;
    } catch {
      // The server never sends malformed frames, but the pump must not die on one — ignore and keep the connection.
      return;
    }

    const driverEvent = toDriverEvent(msg);
    if (driverEvent === null) return; // seatClaimed and other no-driver-counterpart messages map to nothing

    // Track the client's authoritative log length from the two events that move it.
    if (driverEvent.type === "sync") {
      logLength = driverEvent.logLength;
      lastSync = driverEvent; // cache for late-subscriber replay
    } else if (driverEvent.type === "applied") {
      logLength = driverEvent.logIndex + 1;
    }

    emit(driverEvent);
  };

  socket.onclose = (): void => {
    if (disposed) return; // a dispose-initiated close is silent (subscribers are told nothing after dispose)
    stopKeepalive();
    emitConnection("closed"); // plain closed — reconnect/backoff is a later task
  };

  return {
    subscribe(handler: (e: DriverEvent) => void): () => void {
      if (disposed) return () => {}; // a subscribe after dispose registers nothing and delivers nothing
      handlers.add(handler);
      if (lastSync !== null) handler(lastSync); // replay the latest sync to a late subscriber
      return () => { handlers.delete(handler); };
    },

    async submit(cmd: DriverCommand): Promise<void> {
      if (disposed) throw new Error("cannot submit on a disposed driver");
      if (socket.readyState !== WebSocket.OPEN) {
        // No request queueing while closed (YAGNI — a later task owns reconnect). Reject honestly.
        throw new Error("cannot submit before the connection is open");
      }
      sendCommand(toClientCommand(cmd, logLength));
    },

    requestSync(): void {
      if (disposed) return;
      sendCommand({ type: "resync" });
    },

    controllableSeats(): number[] {
      return [opts.seat];
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      stopKeepalive();
      socket.close();
      handlers.clear();
    },
  };
}
