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

/** A full `resync` ServerMessage wrapping the given game + logLength (the shape `hello` triggers as initial sync). */
function resyncMsg(game: GameState, logLength: number, seats: SeatRosterEntry[] = []): ServerMessage {
  return {
    type: "resync",
    snapshot: encodeState(game),
    logLength,
    pending: null,
    seats,
    protocolVersion: PROTOCOL_VERSION,
    replayVersion: REPLAY_VERSION,
    reason: null,
  };
}

const KEEPALIVE_MS = 25_000;
const TOKEN = "super-secret-seat-token";

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

  test("emits connection closed on an unexpected socket close", () => {
    const { driver, socket } = makeHarness();
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    socket().fireOpen();
    events.length = 0;
    socket().fireClose(1006, "gone");
    expect(events).toEqual([{ type: "connection", status: "closed" }]);
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
  });
});
