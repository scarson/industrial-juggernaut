// ABOUTME: Pins SocketDriver — connect/handshake/seat-claim/keepalive/message-pump against an injected
// ABOUTME: fake WebSocket (the sanctioned boundary fake) with fake timers; no real sockets, no real sleeps.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { makeSocketDriver } from "./socket-driver";
import { PROTOCOL_VERSION } from "../../../src/wire/protocol";
import { REPLAY_VERSION } from "../../../src/host/version";
import { encodeState } from "../../../src/wire/codec";
import { openSession } from "../../../src/session/session";
import { encodeEntry, defaultConfig } from "../engine-client/barrel";
import type { DriverEvent } from "./driver";
import type { GameState, LogEntry, SessionHeader } from "../engine-client/barrel";
import type { ClientCommand, ServerMessage, SeatRosterEntry } from "../../../src/wire/protocol";

// ── Fake WebSocket ────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The boundary fake (testing-pitfalls §7 "mock only the boundary"): a hand-rolled WebSocket that records every
 * `send`, records `close`, and lets a test drive `open`/`message`/`close` events synchronously. It mirrors only
 * the surface the driver touches (readyState, send, close, the onopen/onmessage/onclose handlers) — nothing more.
 */
const OPEN = 1;
const CLOSED = 3;
class FakeSocket {
  readyState = 0; // CONNECTING
  sent: string[] = [];
  closed: { code: number | undefined; reason: string | undefined } | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  // No onerror field: the driver intentionally leaves `error` unhandled (a real WebSocket always
  // follows `error` with `close`, which the driver DOES handle), so the fake models no error surface.
  constructor(public url: string) {}

  send(data: string): void {
    // WHATWG fidelity: a real WebSocket.send throws InvalidStateError while CONNECTING and silently
    // discards while CLOSING/CLOSED. The fake throws in EVERY not-OPEN state so any send-state bug
    // in the driver is loud in tests rather than silently recorded.
    if (this.readyState !== OPEN) {
      throw new Error(`InvalidStateError: send in readyState ${this.readyState}`);
    }
    this.sent.push(data);
  }
  close(code?: number, reason?: string): void {
    this.readyState = CLOSED;
    this.closed = { code, reason };
  }

  // ── test drivers (not part of the WebSocket surface) ──
  fireOpen(): void {
    this.readyState = OPEN;
    this.onopen?.();
  }
  fireMessage(data: string): void {
    this.onmessage?.({ data });
  }
  fireClose(code = 1006, reason = ""): void {
    this.readyState = CLOSED;
    this.onclose?.({ code, reason });
  }
}

/** The parsed JSON of everything the driver has sent, minus the literal keepalive `"ping"` frames. */
function sentJson(sock: FakeSocket): unknown[] {
  return sock.sent.filter((f) => f !== "ping").map((f) => JSON.parse(f));
}

// ── Fixtures ──────────────────────────────────────────────────────────────────────────────────────────────────
function realHeader(): SessionHeader {
  return {
    formatVersion: 1,
    replayVersion: "test",
    seed: 1n,
    config: defaultConfig(),
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    seats: [{ kind: "human" }, { kind: "human" }],
  };
}

function freshGame(): GameState {
  return openSession(realHeader(), { defenderTimeout: { enabled: false, seconds: 120 } }).game;
}

/** A full `resync` ServerMessage wrapping the given game + logLength (the shape `hello` triggers as initial sync).
 *  `reason` defaults to null (a hello/mount resync); pass "STALE_INDEX" to model the pushed envelope-reject resync. */
function resyncMsg(
  game: GameState,
  logLength: number,
  seats: SeatRosterEntry[] = [],
  reason: string | null = null,
): ServerMessage {
  return {
    type: "resync",
    snapshot: encodeState(game),
    logLength,
    pending: null,
    seats,
    protocolVersion: PROTOCOL_VERSION,
    replayVersion: REPLAY_VERSION,
    reason,
  };
}

const KEEPALIVE_MS = 25_000;
const TOKEN = "super-secret-seat-token";
// The reconnect backoff schedule, mirrored from socket-driver.ts for exact fake-timer assertions:
// 1s base doubling to a 30s cap, retried indefinitely until dispose.
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/**
 * Build a SocketDriver over a fresh FakeSocket, returning both. `requestId` is a deterministic counter and
 * `keepaliveMs` is fixed so timer assertions are exact; `location` pins the ws origin.
 */
function makeHarness(overrides: Partial<Parameters<typeof makeSocketDriver>[0]> = {}) {
  let sock: FakeSocket | null = null;
  let idCounter = 0;
  const driver = makeSocketDriver({
    roomId: "room-abc",
    seat: 1,
    token: TOKEN,
    socketFactory: (url: string) => {
      sock = new FakeSocket(url);
      return sock as unknown as WebSocket;
    },
    nextRequestId: () => `req-${++idCounter}`,
    keepaliveMs: KEEPALIVE_MS,
    location: { protocol: "https:", host: "play.example.com" },
    ...overrides,
  });
  return {
    driver,
    socket: () => {
      if (sock === null) throw new Error("socket not created");
      return sock;
    },
  };
}

/**
 * A reconnect-aware harness: unlike {@link makeHarness}, it retains EVERY socket the factory produces (not just the
 * latest) and exposes the factory call count, so a test can assert the backoff schedule (advance exact durations,
 * check how many sockets were created), single-flight (a stale socket's close must not spawn a parallel loop), and
 * dispose-wins races (no socket created after dispose).
 */
function makeReconnectHarness(overrides: Partial<Parameters<typeof makeSocketDriver>[0]> = {}) {
  const sockets: FakeSocket[] = [];
  let idCounter = 0;
  const driver = makeSocketDriver({
    roomId: "room-abc",
    seat: 1,
    token: TOKEN,
    socketFactory: (url: string) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s as unknown as WebSocket;
    },
    nextRequestId: () => `req-${++idCounter}`,
    keepaliveMs: KEEPALIVE_MS,
    location: { protocol: "https:", host: "play.example.com" },
    ...overrides,
  });
  return {
    driver,
    sockets,
    /** The most recently created socket (the live one after a reconnect). */
    latest: () => {
      if (sockets.length === 0) throw new Error("no socket created");
      return sockets[sockets.length - 1]!;
    },
    /** How many sockets the factory has produced — the reconnect-attempt counter (includes the first connect). */
    factoryCalls: () => sockets.length,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

// ── 1. URL construction ───────────────────────────────────────────────────────────────────────────────────────
describe("URL construction", () => {
  test("wss origin from https location, with seat + token query params", () => {
    const { socket } = makeHarness();
    expect(socket().url).toBe(
      "wss://play.example.com/api/games/room-abc/ws?seat=1&token=super-secret-seat-token",
    );
  });

  test("ws (not wss) origin from an http location", () => {
    const { socket } = makeHarness({ location: { protocol: "http:", host: "localhost:8787" } });
    expect(socket().url).toBe(
      "ws://localhost:8787/api/games/room-abc/ws?seat=1&token=super-secret-seat-token",
    );
  });

  test("the token is URL-encoded in the query", () => {
    const { socket } = makeHarness({ token: "a b/c+d" });
    expect(socket().url).toContain("token=a%20b%2Fc%2Bd");
  });
});

// ── 2. Handshake on open ──────────────────────────────────────────────────────────────────────────────────────
describe("handshake on open", () => {
  test("sends exactly hello then claimSeat, as JSON, once, in order", () => {
    const { driver, socket } = makeHarness();
    socket().fireOpen();
    const msgs = sentJson(socket());
    expect(msgs).toEqual([
      { type: "hello", protocolVersion: PROTOCOL_VERSION, replayVersion: REPLAY_VERSION },
      { type: "claimSeat", requestId: "req-1", seat: 1 },
    ]);
    driver.dispose();
  });

  test("a second open event does not re-handshake", () => {
    const { socket } = makeHarness();
    socket().fireOpen();
    socket().fireOpen(); // spurious duplicate
    const helloCount = sentJson(socket()).filter((m) => (m as { type: string }).type === "hello").length;
    expect(helloCount).toBe(1);
  });
});

// ── 3. Keepalive ──────────────────────────────────────────────────────────────────────────────────────────────
describe("keepalive", () => {
  test("sends the literal ping frame on each interval tick after open", () => {
    const { socket } = makeHarness();
    socket().fireOpen();
    socket().sent = []; // discard the handshake frames
    vi.advanceTimersByTime(KEEPALIVE_MS);
    expect(socket().sent).toEqual(["ping"]);
    vi.advanceTimersByTime(KEEPALIVE_MS);
    expect(socket().sent).toEqual(["ping", "ping"]);
  });

  test("does not ping before open", () => {
    const { socket } = makeHarness();
    vi.advanceTimersByTime(KEEPALIVE_MS * 3);
    expect(socket().sent).toEqual([]);
  });

  test("stops pinging after dispose", () => {
    const { driver, socket } = makeHarness();
    socket().fireOpen();
    socket().sent = [];
    driver.dispose();
    vi.advanceTimersByTime(KEEPALIVE_MS * 3);
    expect(socket().sent).toEqual([]);
  });

  test("stops pinging after an unexpected close", () => {
    const { socket } = makeHarness();
    socket().fireOpen();
    socket().sent = [];
    socket().fireClose();
    vi.advanceTimersByTime(KEEPALIVE_MS * 3);
    expect(socket().sent).toEqual([]);
  });

  test("an incoming pong frame is ignored (no throw, no event)", () => {
    const { driver, socket } = makeHarness();
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    socket().fireOpen();
    events.length = 0;
    expect(() => socket().fireMessage("pong")).not.toThrow();
    expect(events).toEqual([]);
  });
});

// ── 4. Message pump ───────────────────────────────────────────────────────────────────────────────────────────
describe("message pump", () => {
  test("resync frame becomes a sync event for every subscriber", () => {
    const { driver, socket } = makeHarness();
    const a: DriverEvent[] = [];
    const b: DriverEvent[] = [];
    driver.subscribe((e) => a.push(e));
    driver.subscribe((e) => b.push(e));
    socket().fireOpen();
    const game = freshGame();
    socket().fireMessage(JSON.stringify(resyncMsg(game, 5)));
    const syncOf = (evs: DriverEvent[]) => evs.find((e) => e.type === "sync");
    expect(syncOf(a)).toBeDefined();
    expect(syncOf(b)).toBeDefined();
    expect((syncOf(a) as Extract<DriverEvent, { type: "sync" }>).logLength).toBe(5);
  });

  test("a seatClaimed frame (null mapping) emits nothing", () => {
    const { driver, socket } = makeHarness();
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    socket().fireOpen();
    events.length = 0;
    const msg: ServerMessage = { type: "seatClaimed", seat: 1, requestId: "req-1" };
    socket().fireMessage(JSON.stringify(msg));
    expect(events).toEqual([]);
  });

  test("an applied frame becomes an applied event", () => {
    const { driver, socket } = makeHarness();
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    socket().fireOpen();
    events.length = 0;
    const game = freshGame();
    const entry: LogEntry = { player: 0, kind: "placeFirstBase", hex: { x: 0, y: 0, z: 0 }, rngBeforeApply: game.rngState };
    const msg: ServerMessage = { type: "applied", entry: encodeEntry(entry), events: [], logIndex: 4 };
    socket().fireMessage(JSON.stringify(msg));
    expect(events.map((e) => e.type)).toContain("applied");
  });

  test("a malformed (non-JSON) frame does not crash the pump nor close the socket", () => {
    const { driver, socket } = makeHarness();
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    socket().fireOpen();
    events.length = 0;
    expect(() => socket().fireMessage("{not json")).not.toThrow();
    expect(events).toEqual([]);
    expect(socket().closed).toBeNull(); // the connection survives
    // ...and a subsequent valid frame still pumps through
    socket().fireMessage(JSON.stringify(resyncMsg(freshGame(), 2)));
    expect(events.some((e) => e.type === "sync")).toBe(true);
  });
});

// ── 5. reload → reload-required ───────────────────────────────────────────────────────────────────────────────
describe("reload", () => {
  test("a reload frame emits connection reload-required and nothing else", () => {
    const { driver, socket } = makeHarness();
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    socket().fireOpen();
    events.length = 0;
    socket().fireMessage(JSON.stringify({ type: "reload" } satisfies ServerMessage));
    expect(events).toEqual([{ type: "connection", status: "reload-required" }]);
  });
});

// ── 6. submit + logLength tracking ────────────────────────────────────────────────────────────────────────────
describe("submit", () => {
  test("maps via toClientCommand at the current logLength and sends JSON, resolving on send", async () => {
    const { driver, socket } = makeHarness();
    socket().fireOpen();
    socket().fireMessage(JSON.stringify(resyncMsg(freshGame(), 7))); // logLength := 7
    socket().sent = [];
    await driver.submit({ type: "endRound" });
    const sent = sentJson(socket());
    expect(sent).toEqual([{ type: "endRound", expectedLogIndex: 7 } satisfies ClientCommand]);
  });

  test("logLength starts at 0 before any sync (endRound stamps 0)", async () => {
    const { driver, socket } = makeHarness();
    socket().fireOpen();
    socket().sent = [];
    await driver.submit({ type: "endRound" });
    expect(sentJson(socket())).toEqual([{ type: "endRound", expectedLogIndex: 0 } satisfies ClientCommand]);
  });

  test("an applied event advances logLength to logIndex + 1", async () => {
    const { driver, socket } = makeHarness();
    socket().fireOpen();
    socket().fireMessage(JSON.stringify(resyncMsg(freshGame(), 3)));
    const game = freshGame();
    const entry: LogEntry = { player: 0, kind: "placeFirstBase", hex: { x: 0, y: 0, z: 0 }, rngBeforeApply: game.rngState };
    socket().fireMessage(JSON.stringify({ type: "applied", entry: encodeEntry(entry), events: [], logIndex: 3 } satisfies ServerMessage));
    socket().sent = [];
    await driver.submit({ type: "pass" });
    expect(sentJson(socket())).toEqual([{ type: "pass", expectedLogIndex: 4 } satisfies ClientCommand]);
  });

  test("a later sync resets logLength from the resync's logLength", async () => {
    const { driver, socket } = makeHarness();
    socket().fireOpen();
    socket().fireMessage(JSON.stringify(resyncMsg(freshGame(), 10)));
    socket().fireMessage(JSON.stringify(resyncMsg(freshGame(), 2))); // a fresh resync rewinds our tracked length
    socket().sent = [];
    await driver.submit({ type: "pass" });
    expect(sentJson(socket())).toEqual([{ type: "pass", expectedLogIndex: 2 } satisfies ClientCommand]);
  });

  test("submit before the socket is open rejects (no send)", async () => {
    const { driver, socket } = makeHarness();
    // not opened yet
    await expect(driver.submit({ type: "endRound" })).rejects.toThrow();
    expect(sentJson(socket())).toEqual([]);
  });

  test("submit after close rejects", async () => {
    const { driver, socket } = makeHarness();
    socket().fireOpen();
    socket().fireClose();
    await expect(driver.submit({ type: "endRound" })).rejects.toThrow();
  });
});

// ── 7. Subscriber contract ────────────────────────────────────────────────────────────────────────────────────
describe("subscriber contract", () => {
  test("a subscriber attaching AFTER the initial sync gets a replay of the latest sync immediately", () => {
    const { driver, socket } = makeHarness();
    socket().fireOpen();
    socket().fireMessage(JSON.stringify(resyncMsg(freshGame(), 8)));
    // now a fresh subscriber attaches
    const late: DriverEvent[] = [];
    driver.subscribe((e) => late.push(e));
    expect(late).toHaveLength(1);
    expect(late[0]!.type).toBe("sync");
    expect((late[0] as Extract<DriverEvent, { type: "sync" }>).logLength).toBe(8);
  });

  test("a subscriber attaching BEFORE the sync gets no immediate replay, then the sync as it arrives", () => {
    const { driver, socket } = makeHarness();
    const early: DriverEvent[] = [];
    driver.subscribe((e) => early.push(e));
    expect(early).toEqual([]); // nothing cached yet
    socket().fireOpen();
    socket().fireMessage(JSON.stringify(resyncMsg(freshGame(), 1)));
    expect(early.some((e) => e.type === "sync")).toBe(true);
  });

  test("the replayed sync is the LATEST sync (a second resync supersedes the first)", () => {
    const { driver, socket } = makeHarness();
    socket().fireOpen();
    socket().fireMessage(JSON.stringify(resyncMsg(freshGame(), 4)));
    socket().fireMessage(JSON.stringify(resyncMsg(freshGame(), 9)));
    const late: DriverEvent[] = [];
    driver.subscribe((e) => late.push(e));
    expect((late[0] as Extract<DriverEvent, { type: "sync" }>).logLength).toBe(9);
  });

  test("requestSync sends the wire resync command", () => {
    const { driver, socket } = makeHarness();
    socket().fireOpen();
    socket().sent = [];
    driver.requestSync();
    expect(sentJson(socket())).toEqual([{ type: "resync" } satisfies ClientCommand]);
  });

  test("requestSync before open is a no-op (no send, no throw)", () => {
    const { driver, socket } = makeHarness();
    // not opened yet — a real WebSocket.send would throw InvalidStateError while CONNECTING
    expect(() => driver.requestSync()).not.toThrow();
    expect(socket().sent).toEqual([]);
  });

  test("requestSync after close is a no-op (no send, no throw)", () => {
    const { driver, socket } = makeHarness();
    socket().fireOpen();
    socket().fireClose();
    socket().sent = [];
    expect(() => driver.requestSync()).not.toThrow();
    expect(socket().sent).toEqual([]);
  });

  test("unsubscribe stops delivery to that handler", () => {
    const { driver, socket } = makeHarness();
    const events: DriverEvent[] = [];
    const off = driver.subscribe((e) => events.push(e));
    socket().fireOpen();
    off();
    events.length = 0;
    socket().fireMessage(JSON.stringify(resyncMsg(freshGame(), 1)));
    expect(events).toEqual([]);
  });
});

// ── 8. Connection status events ───────────────────────────────────────────────────────────────────────────────
describe("connection status", () => {
  test("emits connection open after the handshake sends, on socket open", () => {
    const { driver, socket } = makeHarness();
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    socket().fireOpen();
    expect(events).toContainEqual({ type: "connection", status: "open" });
    // the handshake frames were sent BEFORE the open event (assert both hello+claimSeat present)
    expect(sentJson(socket()).map((m) => (m as { type: string }).type)).toEqual(["hello", "claimSeat"]);
  });

  test("emits connection reconnecting (not closed) on an unexpected socket close", () => {
    const { driver, socket } = makeHarness();
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    socket().fireOpen();
    events.length = 0;
    socket().fireClose(1006, "gone");
    // The outage opens a reconnect loop, so the driver signals "reconnecting", never a terminal "closed".
    expect(events).toEqual([{ type: "connection", status: "reconnecting" }]);
    driver.dispose(); // cancel the pending backoff so no timer leaks into the next test
  });

  test("dispose closes the socket and emits nothing further", () => {
    const { driver, socket } = makeHarness();
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    socket().fireOpen();
    events.length = 0;
    driver.dispose();
    expect(socket().closed).not.toBeNull(); // the socket was closed
    // the driver-initiated close must NOT surface as a "closed" connection event
    socket().fireClose(); // even if the platform fires close after our dispose
    expect(events).toEqual([]);
  });
});

// ── 9. controllableSeats + token safety ───────────────────────────────────────────────────────────────────────
describe("controllableSeats", () => {
  test("returns exactly the claimed seat", () => {
    const { driver } = makeHarness({ seat: 4 });
    expect(driver.controllableSeats()).toEqual([4]);
  });
});

describe("token safety", () => {
  test("the token never appears in an emitted or thrown error", async () => {
    const { driver, socket } = makeHarness();
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    // trigger the rejection path
    let thrown: unknown;
    try {
      await driver.submit({ type: "endRound" }); // before open → rejects
    } catch (e) {
      thrown = e;
    }
    socket().fireOpen();
    socket().fireClose();
    const haystack = JSON.stringify(events) + String((thrown as Error)?.message ?? "") + String((thrown as Error)?.stack ?? "");
    expect(haystack).not.toContain(TOKEN);
    driver.dispose(); // cancel the reconnect the close opened
  });
});

// ── 10. Reconnect: backoff schedule ───────────────────────────────────────────────────────────────────────────
describe("reconnect backoff schedule", () => {
  test("an unexpected close schedules a fresh socket after the base delay", () => {
    const h = makeReconnectHarness();
    h.latest().fireOpen();
    expect(h.factoryCalls()).toBe(1); // only the initial connect so far
    h.latest().fireClose();
    // No new socket the instant the close fires — the reconnect waits out the backoff delay.
    expect(h.factoryCalls()).toBe(1);
    vi.advanceTimersByTime(RECONNECT_BASE_MS - 1);
    expect(h.factoryCalls()).toBe(1); // still waiting
    vi.advanceTimersByTime(1); // now at exactly RECONNECT_BASE_MS
    expect(h.factoryCalls()).toBe(2); // a fresh socket was created
    h.driver.dispose();
  });

  test("backoff doubles from base to the cap across successive failed attempts", () => {
    const h = makeReconnectHarness();
    h.latest().fireOpen();
    h.latest().fireClose(); // outage starts

    // Each attempt's socket is created, then closes WITHOUT ever opening (attempt failed) → the next wait doubles.
    const expectedDelays = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]; // doubles, then pins at the 30s cap
    let created = 1; // the initial socket
    for (const delay of expectedDelays) {
      vi.advanceTimersByTime(delay - 1);
      expect(h.factoryCalls()).toBe(created); // the wait hasn't elapsed yet
      vi.advanceTimersByTime(1); // delay fully elapsed
      created += 1;
      expect(h.factoryCalls()).toBe(created); // a fresh socket for this attempt
      h.latest().fireClose(); // this attempt's socket dies before opening → escalate the backoff
    }
    h.driver.dispose();
  });

  test("a genuine recovery (open + sync frame) resets the backoff to the base delay", () => {
    const h = makeReconnectHarness();
    h.latest().fireOpen();
    h.latest().fireClose(); // outage 1 starts

    // First attempt after base delay, and let it SUCCEED: open, then the recovery sync arrives (useful work).
    vi.advanceTimersByTime(RECONNECT_BASE_MS);
    expect(h.factoryCalls()).toBe(2);
    h.latest().fireOpen();
    h.latest().fireMessage(JSON.stringify(resyncMsg(freshGame(), 1))); // THIS is success — the backoff resets here

    // A second outage must again wait only the BASE delay (not the doubled 2s), proving the reset.
    h.latest().fireClose();
    vi.advanceTimersByTime(RECONNECT_BASE_MS - 1);
    expect(h.factoryCalls()).toBe(2); // still waiting the base delay
    vi.advanceTimersByTime(1);
    expect(h.factoryCalls()).toBe(3); // reconnected again after exactly the base delay
    h.driver.dispose();
  });

  test("an accept-then-drop crash loop still escalates to the cap (open without a sync is not success)", () => {
    const h = makeReconnectHarness();
    h.latest().fireOpen();
    h.latest().fireMessage(JSON.stringify(resyncMsg(freshGame(), 1))); // the healthy session did useful work
    h.latest().fireClose(); // outage starts

    // Each attempt OPENS (the server accepts the socket) but drops it before ANY frame arrives — a
    // crash-looping server. An open alone must not reset the backoff, or the client hammers the server at
    // the base delay forever; the schedule must keep doubling to the cap exactly as if no open ever fired.
    const expectedDelays = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000];
    let created = 1; // the initial socket
    for (const delay of expectedDelays) {
      vi.advanceTimersByTime(delay - 1);
      expect(h.factoryCalls()).toBe(created); // the wait hasn't elapsed yet
      vi.advanceTimersByTime(1);
      created += 1;
      expect(h.factoryCalls()).toBe(created);
      h.latest().fireOpen(); // the server accepts…
      h.latest().fireClose(); // …then kills the socket before a single frame
    }
    h.driver.dispose();
  });

  test("emits reconnecting exactly once per outage, not once per attempt", () => {
    const h = makeReconnectHarness();
    const events: DriverEvent[] = [];
    h.driver.subscribe((e) => events.push(e));
    h.latest().fireOpen();
    events.length = 0;
    h.latest().fireClose(); // outage starts

    const reconnectingCount = () =>
      events.filter((e) => e.type === "connection" && e.status === "reconnecting").length;
    expect(reconnectingCount()).toBe(1); // signalled once at outage start

    // Two failed attempts within the SAME outage must not re-emit "reconnecting".
    vi.advanceTimersByTime(RECONNECT_BASE_MS);
    h.latest().fireClose();
    vi.advanceTimersByTime(2 * RECONNECT_BASE_MS);
    h.latest().fireClose();
    expect(reconnectingCount()).toBe(1); // still exactly one for this outage
    h.driver.dispose();
  });
});

// ── 11. Reconnect: dispose-wins races ──────────────────────────────────────────────────────────────────────────
describe("reconnect races with dispose", () => {
  test("dispose during the backoff wait cancels the pending attempt (no new socket)", () => {
    const h = makeReconnectHarness();
    h.latest().fireOpen();
    h.latest().fireClose(); // schedule a reconnect
    expect(h.factoryCalls()).toBe(1);
    h.driver.dispose(); // dispose BEFORE the backoff timer fires
    vi.advanceTimersByTime(RECONNECT_MAX_MS * 10); // let any pending timer fire
    expect(h.factoryCalls()).toBe(1); // no socket was ever created post-dispose
  });

  test("dispose during an in-flight attempt closes that socket and suppresses its late open", () => {
    const h = makeReconnectHarness();
    const events: DriverEvent[] = [];
    h.driver.subscribe((e) => events.push(e));
    h.latest().fireOpen();
    h.latest().fireClose();
    vi.advanceTimersByTime(RECONNECT_BASE_MS); // a fresh socket is created (attempt in flight), open not yet fired
    expect(h.factoryCalls()).toBe(2);
    const inflight = h.latest();
    events.length = 0;
    h.driver.dispose(); // dispose while the new socket is connecting
    expect(inflight.closed).not.toBeNull(); // the in-flight socket was closed
    inflight.fireOpen(); // a late open from that socket must be suppressed (disposed guard)
    expect(inflight.sent).toEqual([]); // no handshake sent post-dispose
    expect(events).toEqual([]); // no "open" event post-dispose
  });

  test("submit + requestSync after dispose behave as before across a reconnect", async () => {
    const h = makeReconnectHarness();
    h.latest().fireOpen();
    h.latest().fireClose();
    h.driver.dispose();
    await expect(h.driver.submit({ type: "endRound" })).rejects.toThrow();
    expect(() => h.driver.requestSync()).not.toThrow();
  });
});

// ── 12. Reconnect: single-flight ───────────────────────────────────────────────────────────────────────────────
describe("reconnect single-flight", () => {
  test("a stale socket's close does not spawn a second parallel reconnect loop", () => {
    const h = makeReconnectHarness();
    h.latest().fireOpen();
    const stale = h.sockets[0]!; // the original socket
    stale.fireClose(); // outage starts → one reconnect scheduled

    vi.advanceTimersByTime(RECONNECT_BASE_MS);
    expect(h.factoryCalls()).toBe(2); // exactly one new socket

    // The STALE (original) socket now fires close AGAIN, after the new socket already exists.
    // A single-flight driver must ignore it — no second parallel backoff loop.
    stale.fireClose();
    vi.advanceTimersByTime(RECONNECT_MAX_MS * 5);
    expect(h.factoryCalls()).toBe(2); // still just the one reconnect socket — no parallel loop
    h.driver.dispose();
  });

  test("only the CURRENT socket's close drives the loop; a superseded socket is inert", () => {
    const h = makeReconnectHarness();
    h.latest().fireOpen();
    h.latest().fireClose(); // outage
    vi.advanceTimersByTime(RECONNECT_BASE_MS);
    expect(h.factoryCalls()).toBe(2);
    h.latest().fireOpen(); // reconnect succeeds; sockets[0] is now fully superseded

    // sockets[0] (long dead) fires a stray close — must not reopen an outage on the healthy connection.
    const events: DriverEvent[] = [];
    h.driver.subscribe((e) => events.push(e));
    events.length = 0;
    h.sockets[0]!.fireClose();
    vi.advanceTimersByTime(RECONNECT_MAX_MS);
    expect(h.factoryCalls()).toBe(2); // no new socket
    expect(events.filter((e) => e.type === "connection")).toEqual([]); // no connection churn
    h.driver.dispose();
  });

  test("a stale socket's message after the reconnect socket is live emits nothing to subscribers", () => {
    // Invariant: a superseded socket is inert — its onmessage identity guard drops the frame, so a stale socket
    // cannot pump a mis-indexed event to the store. (Today a stale socket is always already-closed, so this is
    // latent defense against a future proactive-reconnect trigger that supersedes a still-live socket.)
    const h = makeReconnectHarness();
    h.latest().fireOpen();
    h.latest().fireClose(); // outage
    vi.advanceTimersByTime(RECONNECT_BASE_MS);
    expect(h.factoryCalls()).toBe(2);
    h.latest().fireOpen(); // reconnect succeeds; sockets[0] is now superseded

    const events: DriverEvent[] = [];
    h.driver.subscribe((e) => events.push(e));
    events.length = 0;
    h.sockets[0]!.fireMessage(JSON.stringify(resyncMsg(freshGame(), 42))); // stale socket pumps a frame
    expect(events).toEqual([]); // the identity guard drops it — nothing reaches subscribers
    h.driver.dispose();
  });

  test("a never-opened superseded socket's late open sends no handshake and emits no open", () => {
    // Invariant: a superseded socket is inert — its onopen identity guard drops the open, so a stale socket cannot
    // re-handshake (hello/claimSeat) or clobber reconnecting/backoff. This bites a socket that never opened: a
    // reconnect attempt that closes before opening is superseded by the NEXT attempt, then fires a late open. Its
    // per-socket `handshaken` is still false (only a genuine open sets it), so ONLY the identity guard stops it —
    // without the guard, this late open re-handshakes on a dead socket and re-emits connection:"open".
    const h = makeReconnectHarness();
    h.latest().fireOpen();
    h.latest().fireClose(); // outage 1
    vi.advanceTimersByTime(RECONNECT_BASE_MS);
    expect(h.factoryCalls()).toBe(2);

    const stalled = h.latest(); // sockets[1] — the first reconnect attempt
    stalled.fireClose(); // it closes BEFORE ever opening → schedules the next attempt (still the current socket here)
    vi.advanceTimersByTime(RECONNECT_BASE_MS * 2); // the escalated delay
    expect(h.factoryCalls()).toBe(3); // sockets[2] created and becomes current; sockets[1] is now superseded

    const events: DriverEvent[] = [];
    h.driver.subscribe((e) => events.push(e));
    events.length = 0;
    stalled.fireOpen(); // sockets[1]'s late open arrives after it was superseded — handshaken is still false
    expect(sentJson(stalled)).toEqual([]); // no hello/claimSeat sent on the superseded socket
    expect(events.filter((e) => e.type === "connection")).toEqual([]); // no connection:"open" emitted
    h.driver.dispose();
  });
});

// ── 13. Reconnect: recovery + resync ───────────────────────────────────────────────────────────────────────────
describe("reconnect recovery", () => {
  test("full sequence for a subscriber present across the outage: reconnecting → open → sync", () => {
    const h = makeReconnectHarness();
    const events: DriverEvent[] = [];
    h.driver.subscribe((e) => events.push(e));
    h.latest().fireOpen(); // initial open
    h.latest().fireMessage(JSON.stringify(resyncMsg(freshGame(), 5))); // initial sync
    events.length = 0;

    h.latest().fireClose(); // outage
    vi.advanceTimersByTime(RECONNECT_BASE_MS);
    h.latest().fireOpen(); // reconnect: re-handshake fires, connection "open" re-emitted
    // The new socket's hello reply is a resync ServerMessage → flows through the pump as a "sync".
    h.latest().fireMessage(JSON.stringify(resyncMsg(freshGame(), 8)));

    const statuses = events
      .filter((e) => e.type === "connection")
      .map((e) => (e as Extract<DriverEvent, { type: "connection" }>).status);
    expect(statuses).toEqual(["reconnecting", "open"]);
    // ...and the recovery sync arrives AFTER the "open", in order.
    const openIdx = events.findIndex((e) => e.type === "connection" && e.status === "open");
    const syncIdx = events.findIndex((e) => e.type === "sync");
    expect(openIdx).toBeGreaterThanOrEqual(0);
    expect(syncIdx).toBeGreaterThan(openIdx);
    h.driver.dispose();
  });

  test("the reconnected socket re-runs the full hello+claimSeat handshake", () => {
    const h = makeReconnectHarness();
    h.latest().fireOpen();
    h.latest().fireClose();
    vi.advanceTimersByTime(RECONNECT_BASE_MS);
    const reconnected = h.latest();
    reconnected.fireOpen();
    const msgs = sentJson(reconnected);
    expect(msgs).toEqual([
      { type: "hello", protocolVersion: PROTOCOL_VERSION, replayVersion: REPLAY_VERSION },
      { type: "claimSeat", requestId: "req-2", seat: 1 }, // req-1 was the first connect's claim
    ]);
    h.driver.dispose();
  });

  test("a late subscriber attaching after recovery gets the POST-reconnect sync replayed", () => {
    const h = makeReconnectHarness();
    h.latest().fireOpen();
    h.latest().fireMessage(JSON.stringify(resyncMsg(freshGame(), 5)));
    h.latest().fireClose();
    vi.advanceTimersByTime(RECONNECT_BASE_MS);
    h.latest().fireOpen();
    h.latest().fireMessage(JSON.stringify(resyncMsg(freshGame(), 8))); // recovery sync supersedes the pre-outage one

    const late: DriverEvent[] = [];
    h.driver.subscribe((e) => late.push(e));
    expect(late).toHaveLength(1);
    expect((late[0] as Extract<DriverEvent, { type: "sync" }>).logLength).toBe(8);
    h.driver.dispose();
  });
});

// ── 14. Optimistic concurrency across the outage ───────────────────────────────────────────────────────────────
describe("optimistic concurrency across reconnect", () => {
  test("a submit after recovery stamps expectedLogIndex from the POST-reconnect logLength (rewind case)", async () => {
    const h = makeReconnectHarness();
    h.latest().fireOpen();
    h.latest().fireMessage(JSON.stringify(resyncMsg(freshGame(), 5))); // pre-outage logLength := 5
    h.latest().fireClose();
    vi.advanceTimersByTime(RECONNECT_BASE_MS);
    h.latest().fireOpen();
    h.latest().fireMessage(JSON.stringify(resyncMsg(freshGame(), 3))); // recovery says logLength 3 (client was ahead)
    h.latest().sent = [];
    await h.driver.submit({ type: "endRound" });
    expect(sentJson(h.latest())).toEqual([{ type: "endRound", expectedLogIndex: 3 } satisfies ClientCommand]);
    h.driver.dispose();
  });

  test("a submit after recovery stamps the POST-reconnect logLength (advance case)", async () => {
    const h = makeReconnectHarness();
    h.latest().fireOpen();
    h.latest().fireMessage(JSON.stringify(resyncMsg(freshGame(), 5))); // pre-outage logLength := 5
    h.latest().fireClose();
    vi.advanceTimersByTime(RECONNECT_BASE_MS);
    h.latest().fireOpen();
    h.latest().fireMessage(JSON.stringify(resyncMsg(freshGame(), 9))); // recovery says logLength 9 (server moved ahead)
    h.latest().sent = [];
    await h.driver.submit({ type: "pass" });
    expect(sentJson(h.latest())).toEqual([{ type: "pass", expectedLogIndex: 9 } satisfies ClientCommand]);
    h.driver.dispose();
  });

  test("an in-session STALE_INDEX resync retracks logLength for the next submit", async () => {
    const { driver, socket } = makeHarness();
    socket().fireOpen();
    socket().fireMessage(JSON.stringify(resyncMsg(freshGame(), 7))); // logLength := 7
    // The server answers a stale-indexed command with a pushed resync{reason:"STALE_INDEX"}; wire-map drops the
    // reason and maps it to a plain sync. It must retrack logLength so the NEXT submit stamps the corrected index.
    socket().fireMessage(JSON.stringify(resyncMsg(freshGame(), 4, [], "STALE_INDEX")));
    socket().sent = [];
    await driver.submit({ type: "pass" });
    expect(sentJson(socket())).toEqual([{ type: "pass", expectedLogIndex: 4 } satisfies ClientCommand]);
    driver.dispose();
  });
});

// ── 15. Keepalive across reconnect ─────────────────────────────────────────────────────────────────────────────
describe("keepalive across reconnect", () => {
  test("no ping is sent during the outage (the strict fake would throw), and pings resume on the new socket", () => {
    const h = makeReconnectHarness();
    h.latest().fireOpen();
    const original = h.sockets[0]!;
    original.sent = []; // discard the handshake frames
    original.fireClose(); // outage

    // While reconnecting, no timer may fire a ping (the strict FakeSocket throws when not OPEN — that's the proof).
    expect(() => vi.advanceTimersByTime(KEEPALIVE_MS * 3)).not.toThrow();
    expect(original.sent).toEqual([]); // the old socket's keepalive stopped at close

    // Reconnect and open the new socket; its keepalive is a fresh interval.
    vi.advanceTimersByTime(RECONNECT_BASE_MS);
    const reconnected = h.latest();
    reconnected.fireOpen();
    reconnected.sent = []; // discard the re-handshake frames
    vi.advanceTimersByTime(KEEPALIVE_MS);
    expect(reconnected.sent).toEqual(["ping"]); // pings resume on the new socket
    h.driver.dispose();
  });
});
