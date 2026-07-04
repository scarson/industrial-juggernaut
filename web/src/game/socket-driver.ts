// ABOUTME: SocketDriver — a GameDriver over the DO host's WebSocket: connect, hello/claimSeat handshake,
// ABOUTME: app-level keepalive, the incoming-message pump, and reconnect-with-backoff after an unexpected close.
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
//
// RECONNECT. An unexpected close (any close the driver didn't initiate) emits `connection:"reconnecting"` once and
// opens a single-flight reconnect loop: it waits out a capped exponential backoff, then creates a FRESH socket from
// the same factory + URL (seat token unchanged) and re-runs the whole per-socket lifecycle — handshake, keepalive,
// pump. The `hello` of that handshake IS the recovery request: the server answers it with a full `resync`, which the
// pump maps to a `sync` DriverEvent, so recovery needs no extra round-trip. The backoff resets to the base once a new
// socket opens and re-handshakes. The loop retries indefinitely (there is no give-up state): terminal UX belongs to
// the reload-guard, and a player who leaves simply unmounts, which calls `dispose` and silences everything. Only the
// CURRENT socket's close drives the loop — a stale pre-reconnect socket firing close cannot spawn a parallel loop.
import { PROTOCOL_VERSION } from "../../../src/wire/protocol";
import { REPLAY_VERSION } from "../../../src/host/version";
import { toClientCommand, toDriverEvent } from "./wire-map";
import type { ClientCommand, ServerMessage } from "../../../src/wire/protocol";
import type { ConnectionStatus, DriverCommand, DriverEvent, GameDriver } from "./driver";

/** The app-level keepalive period. The DO runtime auto-answers `"ping"` with `"pong"` WITHOUT waking the DO. */
const DEFAULT_KEEPALIVE_MS = 25_000;

/** The first reconnect delay after an outage. The wait doubles per failed attempt up to {@link RECONNECT_MAX_MS}. */
const RECONNECT_BASE_MS = 1_000;
/** The reconnect backoff cap. Delays double from the base — 1s, 2s, 4s, … — then pin here, retried until dispose. */
const RECONNECT_MAX_MS = 30_000;

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

  const handlers = new Set<(e: DriverEvent) => void>();
  /** The latest mapped `sync` DriverEvent, replayed to any subscriber that attaches after it arrived. */
  let lastSync: DriverEvent | null = null;
  /** The client's view of the authoritative log length — stamped onto every mutating command as expectedLogIndex.
   *  Set from a `sync` (the resync's logLength) and advanced by an `applied` (logIndex + 1). Starts at 0. */
  let logLength = 0;
  let disposed = false;
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  /** The live socket. Reassigned on each reconnect; only THIS socket's close drives the reconnect loop
   *  (single-flight — a stale socket firing close after a reconnect must be inert). */
  let socket: WebSocket = connect();
  /** The pending backoff timer while an outage's reconnect is scheduled, or null when none is scheduled. */
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** True from the moment a healthy connection drops until a fresh socket successfully opens. Gates the
   *  `connection:"reconnecting"` emit to once per outage (a failed retry mid-outage does not re-signal). */
  let reconnecting = false;
  /** The next backoff delay. Starts at the base, doubles per failed attempt to the cap, resets on a successful open. */
  let reconnectDelay = RECONNECT_BASE_MS;

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

  /** Send one well-formed ClientCommand as a JSON text frame on the live socket. The ONLY JSON the driver ever sends. */
  function sendCommand(command: ClientCommand): void {
    socket.send(JSON.stringify(command));
  }

  /** Create a fresh socket, wire its lifecycle handlers, and return it. Used for the initial connect AND each reconnect. */
  function connect(): WebSocket {
    const sock = socketFactory(url);
    // Each fresh socket handshakes exactly once on its own open. `handshaken` is per-socket (closure-local here),
    // so a spurious duplicate open on the SAME socket won't re-handshake, while a genuine reconnect socket does.
    let handshaken = false;

    sock.onopen = (): void => {
      if (disposed || handshaken) return; // a spurious duplicate open (or a late open after dispose) must not handshake
      handshaken = true;
      reconnecting = false; // this open ends the outage — the next drop starts a fresh one and re-signals
      reconnectDelay = RECONNECT_BASE_MS; // a socket that opened + handshakes is a successful (re)connect — reset backoff
      // The handshake: hello (initial-sync/recovery trigger) THEN claimSeat (roster ack). No token in either body.
      sendCommand({ type: "hello", protocolVersion: PROTOCOL_VERSION, replayVersion: REPLAY_VERSION });
      sendCommand({ type: "claimSeat", requestId: nextRequestId(), seat: opts.seat });
      keepaliveTimer = setInterval(() => sock.send("ping"), keepaliveMs);
      emitConnection("open"); // after the handshake sends, per the driver contract
    };

    sock.onmessage = (event: MessageEvent): void => {
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

      // Track the client's authoritative log length from the two events that move it. A recovery/STALE_INDEX resync
      // arrives as a `sync` too, so this retracks logLength after reconnect and the next submit stamps the fresh index.
      if (driverEvent.type === "sync") {
        logLength = driverEvent.logLength;
        lastSync = driverEvent; // cache for late-subscriber replay
      } else if (driverEvent.type === "applied") {
        logLength = driverEvent.logIndex + 1;
      }

      emit(driverEvent);
    };

    sock.onclose = (): void => {
      if (disposed) return; // a dispose-initiated close is silent (subscribers are told nothing after dispose)
      if (sock !== socket) return; // single-flight: a stale (superseded) socket's close never drives the loop
      stopKeepalive();
      if (!reconnecting) { // first drop of this outage → signal once; a failed retry mid-outage stays silent
        reconnecting = true;
        emitConnection("reconnecting");
      }
      scheduleReconnect();
    };

    // `error` is intentionally unhandled: a WebSocket always follows `error` with `close`, so the
    // onclose handler above already covers every error-terminated connection.
    return sock;
  }

  /** Wait out the current backoff delay, then replace the socket and escalate the delay for the next attempt. */
  function scheduleReconnect(): void {
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (disposed) return; // dispose during the wait cancels the attempt (belt-and-braces beside clearTimeout)
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS); // escalate; a successful open resets to base
      socket = connect(); // a fresh socket becomes the live one; its open re-handshakes and resyncs via hello
    }, reconnectDelay);
  }

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
        // No request queueing across an outage — a submit while reconnecting rejects honestly, and the caller
        // retries once `connection:"open"` re-fires. (Queueing is a separate, unshipped concern.)
        throw new Error("cannot submit before the connection is open");
      }
      sendCommand(toClientCommand(cmd, logLength));
    },

    requestSync(): void {
      if (disposed) return;
      // WebSocket.send throws InvalidStateError while CONNECTING and silently discards while
      // CLOSING/CLOSED (WHATWG). requestSync is called from synchronous recovery paths (and on
      // mount, possibly before open), so a not-open socket must be a silent no-op — requestSync
      // returns void, and a mid-outage resync is unnecessary anyway: the reconnect's own hello
      // re-triggers a full resync the moment the new socket opens.
      if (socket.readyState !== WebSocket.OPEN) return;
      sendCommand({ type: "resync" });
    },

    controllableSeats(): number[] {
      return [opts.seat];
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      stopKeepalive();
      if (reconnectTimer !== null) { // cancel a pending backoff so no socket is created after dispose
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      socket.close(); // closes the live socket (whether established or an in-flight reconnect attempt); its late
      // open is suppressed by the disposed guard, and its close is silent (disposed short-circuits onclose)
      handlers.clear();
    },
  };
}
