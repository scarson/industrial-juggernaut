// ABOUTME: Workers-pool tests for GameRoom WebSocket hibernation — upgrade/accept, wake-replay across eviction,
// ABOUTME: setWebSocketAutoResponse no-wake, serializeAttachment seat identity survival, seat-tag multi-tab discovery.
import { describe, expect, test } from "vitest";
import { env, runInDurableObject, evictDurableObject } from "cloudflare:test";
import type { GameRoom } from "../../src/host/game-room";
import {
  logKey,
  openSession,
  type SessionState,
  type SessionHeader,
  type LogEntry,
} from "../../src/session";
import type { RoomOptions, ServerMessage } from "../../src/wire/protocol";
import { representativeFirstBase, defaultConfig } from "../../src/index";
import { seed as makeSeed } from "../../src/index";
import { tokenDigest } from "../../src/host/ids";
import { key } from "../../src/geometry/cube";
import type { Base, GameState, Hex, PlayerId, RngState } from "../../src/engine/types";

/** A fresh GameRoom stub on a unique name so each test owns its own storage. */
let counter = 0;
function freshStub(): DurableObjectStub<GameRoom> {
  const name = `hiber-test-${counter++}-${Date.now()}`;
  return env.GAME_ROOM.get(env.GAME_ROOM.idFromName(name)) as DurableObjectStub<GameRoom>;
}

const ROOM_OPTIONS_OFF: RoomOptions = { defenderTimeout: { enabled: false, seconds: 120 } };

/** A header for a room whose seats we control (kind per seat). Seed rides as bigint in-memory. */
function makeHeader(seats: SessionHeader["seats"]): SessionHeader {
  return {
    formatVersion: 1,
    replayVersion: "test-replay-version",
    seed: 12345678901234567890n,
    config: defaultConfig(),
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    seats,
  };
}

/** The /init payload shape the DO parses (seed as decimal STRING; digests per seat). */
function initPayload(header: SessionHeader, roomOptions: RoomOptions, authorizedDigests: (string | null)[]) {
  return { header: { ...header, seed: header.seed.toString() }, roomOptions, authorizedDigests };
}

async function initRoom(
  stub: DurableObjectStub<GameRoom>,
  header: SessionHeader,
  roomOptions: RoomOptions,
  authorizedDigests: (string | null)[],
): Promise<Response> {
  return stub.fetch("https://do.internal/init", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(initPayload(header, roomOptions, authorizedDigests)),
  });
}

// Per-seat human tokens (B6.2): the upgrade now authenticates `?token=` against the seat's authorized digest, so
// these tests install matching digests and open sockets WITH the seat's token. `humanDigests(n)` returns the digest
// array to pass to initRoom; `openSocket` sends the matching token.
const SEAT_TOKENS = ["hiber-token-0", "hiber-token-1", "hiber-token-2"] as const;
async function humanDigests(count: number): Promise<string[]> {
  return Promise.all(Array.from({ length: count }, (_, seat) => tokenDigest(SEAT_TOKENS[seat]!)));
}

/**
 * Open a hibernatable WebSocket to a seat via the DO's /ws upgrade route and accept the client end.
 * Mirrors the verified CF test pattern (docs: testing-with-durable-objects) — `response.webSocket`
 * is the client end; `.accept()` makes it usable in the test. The returned socket SURVIVES
 * `evictDurableObject(stub, { webSockets: "hibernate" })`. Sends the seat's token (B6.2 auth).
 */
async function openSocket(stub: DurableObjectStub<GameRoom>, seat: number): Promise<WebSocket> {
  const token = encodeURIComponent(SEAT_TOKENS[seat]!);
  const res = await stub.fetch(`https://do.internal/ws?seat=${seat}&token=${token}`, {
    headers: { Upgrade: "websocket" },
  });
  expect(res.status).toBe(101);
  const socket = res.webSocket;
  if (!socket) throw new Error("expected a WebSocket on the 101 response");
  socket.accept();
  return socket;
}

/** Send a JSON command over a client socket and resolve with the FIRST server message it replies. */
function roundTrip(socket: WebSocket, command: unknown): Promise<ServerMessage> {
  const got = new Promise<ServerMessage>((resolve) => {
    socket.addEventListener(
      "message",
      (event) => resolve(JSON.parse(event.data as string) as ServerMessage),
      { once: true },
    );
  });
  socket.send(JSON.stringify(command));
  return got;
}

// ---------------------------------------------------------------------------
// (1) Upgrade shape validation — the 426 / 400 / uninitialized rejections short-circuit BEFORE the token check
//     (the token-digest auth itself is covered in malformed-auth.test.ts); the valid-upgrade case supplies a token.
// ---------------------------------------------------------------------------
describe("GameRoom /ws upgrade — shape validation", () => {
  test("a non-Upgrade request → 426 (never accepts a socket)", async () => {
    const stub = freshStub();
    await initRoom(stub, makeHeader([{ kind: "human" }, { kind: "human" }]), ROOM_OPTIONS_OFF, [null, null]);
    const res = await stub.fetch("https://do.internal/ws?seat=0");
    expect(res.status).toBe(426);
    expect(res.webSocket).toBeFalsy();
  });

  test("a missing / out-of-range seat → 400 (shape rejection, no socket)", async () => {
    const stub = freshStub();
    await initRoom(stub, makeHeader([{ kind: "human" }, { kind: "human" }]), ROOM_OPTIONS_OFF, [null, null]);
    const missing = await stub.fetch("https://do.internal/ws", { headers: { Upgrade: "websocket" } });
    expect(missing.status).toBe(400);
    expect(missing.webSocket).toBeFalsy();
    const outOfRange = await stub.fetch("https://do.internal/ws?seat=9", { headers: { Upgrade: "websocket" } });
    expect(outOfRange.status).toBe(400);
    expect(outOfRange.webSocket).toBeFalsy();
    const notInt = await stub.fetch("https://do.internal/ws?seat=abc", { headers: { Upgrade: "websocket" } });
    expect(notInt.status).toBe(400);
    expect(notInt.webSocket).toBeFalsy();
    // `Number("")` is 0 — an empty `?seat=` must NOT silently bind to seat 0.
    const empty = await stub.fetch("https://do.internal/ws?seat=", { headers: { Upgrade: "websocket" } });
    expect(empty.status).toBe(400);
    expect(empty.webSocket).toBeFalsy();
    // A fractional seat is not an integer → rejected.
    const fractional = await stub.fetch("https://do.internal/ws?seat=1.5", { headers: { Upgrade: "websocket" } });
    expect(fractional.status).toBe(400);
    expect(fractional.webSocket).toBeFalsy();
  });

  test("an upgrade to an uninitialized room → rejected (no socket)", async () => {
    const stub = freshStub(); // never /init'd
    const res = await stub.fetch("https://do.internal/ws?seat=0", { headers: { Upgrade: "websocket" } });
    expect(res.status).not.toBe(101);
    expect(res.webSocket).toBeFalsy();
  });

  test("a valid upgrade (valid token) → 101 with a client WebSocket", async () => {
    const stub = freshStub();
    await initRoom(stub, makeHeader([{ kind: "human" }, { kind: "human" }]), ROOM_OPTIONS_OFF, await humanDigests(2));
    const res = await stub.fetch(`https://do.internal/ws?seat=1&token=${encodeURIComponent(SEAT_TOKENS[1])}`, {
      headers: { Upgrade: "websocket" },
    });
    expect(res.status).toBe(101);
    expect(res.webSocket).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// (2) Hibernation wake-replay: a command round-trips, evict-hibernate, another command still round-trips.
// ---------------------------------------------------------------------------
describe("GameRoom hibernation — wake-replay on the surviving socket", () => {
  test("evict-hibernate mid-connection, then a mutating command on the SAME socket persists + replies", async () => {
    const stub = freshStub();
    // Seat 0 is the setup placer. A placeFirstBase mutates the log; a resync reads it back.
    await initRoom(stub, makeHeader([{ kind: "human" }, { kind: "human" }]), ROOM_OPTIONS_OFF, await humanDigests(2));
    const socket = await openSocket(stub, 0);

    // A first command round-trips while warm: resync returns the current (empty) log.
    const first = await roundTrip(socket, { type: "resync" });
    expect(first.type).toBe("resync");

    // Force hibernation — the in-memory instance is torn down; the socket stays connected.
    await evictDurableObject(stub, { webSockets: "hibernate" });

    // A mutating command on the SAME (surviving) socket after the wake. The DO must lazy-rehydrate
    // (cold cache) AND attribute the command to seat 0 (from the surviving attachment).
    const hex = await runInDurableObject(stub, async (inst: GameRoom) => {
      // Read the legal first-base hex for seat 0 from a fresh, independent session (no cache mutation).
      const s = openSession(makeHeader([{ kind: "human" }, { kind: "human" }]), ROOM_OPTIONS_OFF);
      return representativeFirstBase(s.game, 0);
    });
    const applied = await roundTrip(socket, { type: "placeFirstBase", expectedLogIndex: 0, hex });
    expect(applied.type).toBe("applied");

    // MECHANISM: the entry is durably persisted at log:000000 (the wake rehydrated then applied + persisted).
    const stored = await runInDurableObject(stub, async (_inst, state) =>
      state.storage.get<LogEntry>(logKey(0)),
    );
    expect(stored).toBeDefined();
    expect(stored!.kind).toBe("placeFirstBase");
    expect(stored!.player).toBe(0);

    socket.close(1000, "done");
  });
});

// ---------------------------------------------------------------------------
// (3) Auto-response: an app-level "ping" gets "pong" WITHOUT invoking webSocketMessage (no wake).
// ---------------------------------------------------------------------------
describe("GameRoom auto-response — ping/pong does not wake the DO", () => {
  test("the auto-response pair is configured (getWebSocketAutoResponse returns ping→pong)", async () => {
    const stub = freshStub();
    await initRoom(stub, makeHeader([{ kind: "human" }, { kind: "human" }]), ROOM_OPTIONS_OFF, [null, null]);
    const pair = await runInDurableObject(stub, async (_inst, state) => {
      const p = state.getWebSocketAutoResponse();
      return p === null ? null : { req: p.request, res: p.response };
    });
    expect(pair).not.toBeNull();
    expect(pair!.req).toBe("ping");
    expect(pair!.res).toBe("pong");
  });

  test('an app-level "ping" is answered "pong" WITHOUT incrementing the webSocketMessage counter', async () => {
    const stub = freshStub();
    await initRoom(stub, makeHeader([{ kind: "human" }, { kind: "human" }]), ROOM_OPTIONS_OFF, await humanDigests(2));
    const socket = await openSocket(stub, 0);

    // Spy on the instance's webSocketMessage: count invocations without changing behavior.
    const before = await runInDurableObject(stub, async (inst: GameRoom) => {
      const holder = inst as unknown as { __wsMsgCalls?: number; webSocketMessage: GameRoom["webSocketMessage"] };
      holder.__wsMsgCalls = holder.__wsMsgCalls ?? 0;
      const real = holder.webSocketMessage.bind(inst);
      holder.webSocketMessage = (async (ws: WebSocket, message: string | ArrayBuffer) => {
        holder.__wsMsgCalls = (holder.__wsMsgCalls ?? 0) + 1;
        return real(ws, message);
      }) as GameRoom["webSocketMessage"];
      return holder.__wsMsgCalls;
    });
    expect(before).toBe(0);

    // Send the app-level ping and wait for the auto-response "pong".
    const pong = new Promise<string>((resolve) => {
      socket.addEventListener("message", (event) => resolve(event.data as string), { once: true });
    });
    socket.send("ping");
    expect(await pong).toBe("pong");

    // MECHANISM: the message handler was NOT invoked by the ping (the auto-response answered without a wake).
    const after = await runInDurableObject(stub, async (inst: GameRoom) => {
      const holder = inst as unknown as { __wsMsgCalls?: number };
      return holder.__wsMsgCalls ?? 0;
    });
    expect(after).toBe(0);

    socket.close(1000, "done");
  });
});

// ---------------------------------------------------------------------------
// (4) serializeAttachment round-trip: the seat identity survives hibernation and drives ctx.actingSeat.
// ---------------------------------------------------------------------------
describe("GameRoom serializeAttachment — seat identity survives hibernation", () => {
  test("after evict-hibernate, a command is attributed to the socket's seat (NOT_YOUR_TURN vs applied distinguishes it)", async () => {
    const stub = freshStub();
    // Synthetic mid-play attack position: seat 0 can attack; it is seat 0's turn (phase.order[indexInOrder]=0).
    // Seat 1's socket therefore CANNOT act (NOT_YOUR_TURN); seat 0's socket CAN.
    await initRoom(stub, makeHeader([{ kind: "human" }, { kind: "human" }]), ROOM_OPTIONS_OFF, await humanDigests(2));
    const seat0 = await openSocket(stub, 0);
    const seat1 = await openSocket(stub, 1);

    // Seed the DO's cache to the synthetic attack state so seat 0 has a legal attack at logLength 7.
    await runInDurableObject(stub, async (inst: GameRoom) => {
      const base = (inst as unknown as { session: SessionState }).session!;
      (inst as unknown as { session: SessionState }).session = { ...base, game: synthAttackGame(), logLength: 7 };
    });

    await evictDurableObject(stub, { webSockets: "hibernate" });

    // After the wake, the cache is cold — so it rehydrates from storage (an EMPTY log → setup phase, logLength 0).
    // In setup, seat 0 is the placer and seat 1 is not: seat 1's placeFirstBase → NOT_YOUR_TURN / a resync;
    // seat 0's placeFirstBase → applied. The mechanism under test is that each socket's command is attributed to
    // ITS seat (from the surviving attachment), which the two distinct outcomes prove.
    const hex0 = await runInDurableObject(stub, async () => {
      const s = openSession(makeHeader([{ kind: "human" }, { kind: "human" }]), ROOM_OPTIONS_OFF);
      return representativeFirstBase(s.game, 0);
    });

    // Seat 1 attempts to place first — it is NOT seat 1's turn in setup → NOT_YOUR_TURN.
    const seat1Reply = await roundTrip(seat1, { type: "placeFirstBase", expectedLogIndex: 0, hex: hex0 });
    expect(seat1Reply.type).toBe("error");
    if (seat1Reply.type === "error") expect(seat1Reply.code).toBe("NOT_YOUR_TURN");

    // Seat 0 places first — attributed to seat 0 → applied.
    const seat0Reply = await roundTrip(seat0, { type: "placeFirstBase", expectedLogIndex: 0, hex: hex0 });
    expect(seat0Reply.type).toBe("applied");

    seat0.close(1000, "done");
    seat1.close(1000, "done");
  });
});

// ---------------------------------------------------------------------------
// (5) Seat-tag multi-tab discovery: two sockets on the same seat:N tag are both found by getWebSockets("seat:N").
// ---------------------------------------------------------------------------
describe("GameRoom seat-tag — multi-tab discovery", () => {
  test('two sockets on seat 1 → getWebSockets("seat:1") returns both; getWebSockets() returns all', async () => {
    const stub = freshStub();
    await initRoom(stub, makeHeader([{ kind: "human" }, { kind: "human" }]), ROOM_OPTIONS_OFF, await humanDigests(2));
    const tabA = await openSocket(stub, 1);
    const tabB = await openSocket(stub, 1);
    const tabOther = await openSocket(stub, 0);

    const { seat1Count, allCount } = await runInDurableObject(stub, async (_inst, state) => ({
      seat1Count: state.getWebSockets("seat:1").length,
      allCount: state.getWebSockets().length,
    }));

    expect(seat1Count).toBe(2); // both seat-1 tabs discovered by the seat tag
    expect(allCount).toBe(3); // all three sockets discovered overall

    tabA.close(1000, "done");
    tabB.close(1000, "done");
    tabOther.close(1000, "done");
  });
});

// ---------------------------------------------------------------------------
// Synthetic PLAY-phase attack position (mirrors test/host/critical-section.test.ts).
// Seat 0 (attacker) can attack seat 1's origin base; iron sits ON base hexes so neither side is
// silently eliminated (noIron) when the entry composes. It is seat 0's turn (indexInOrder → 0).
// ---------------------------------------------------------------------------
function synthHex(x: number, y: number): Hex {
  return { x, y, z: -x - y };
}
const ATTACK_TARGET: Hex = synthHex(0, 0);
const ATTACK_ATTACKERS: Hex[] = [synthHex(1, 0), synthHex(2, -1), synthHex(0, 2)];
const ATTACK_DEF: Hex = synthHex(-1, 0);
const ATTACK_IRON: Hex[] = [ATTACK_ATTACKERS[0]!, ATTACK_DEF];

function synthBase(owner: PlayerId, h: Hex, order: number): Base {
  return { owner, hex: h, state: "fresh", order };
}

function synthAttackGame(): GameState {
  const allHexes = new Set<string>();
  const hexes: Hex[] = [];
  for (let x = -6; x <= 6; x++) {
    for (let y = -6; y <= 6; y++) {
      const h = synthHex(x, y);
      if (Math.abs(h.z) <= 6 && !allHexes.has(key(h))) {
        allHexes.add(key(h));
        hexes.push(h);
      }
    }
  }
  const bases: Base[] = [
    synthBase(1, ATTACK_TARGET, 0),
    synthBase(1, ATTACK_DEF, 1),
    synthBase(0, ATTACK_ATTACKERS[0]!, 2),
    synthBase(0, ATTACK_ATTACKERS[1]!, 3),
    synthBase(0, ATTACK_ATTACKERS[2]!, 4),
  ];
  const rng: RngState = makeSeed(1n);
  return {
    board: { hexes, iron: ATTACK_IRON },
    bases,
    factories: [],
    players: Array.from({ length: 2 }, (_, id) => ({ id, basesInHand: 12, alliance: [id], eliminated: false })),
    phase: { turn: 3, order: [0, 1], indexInOrder: 0 },
    factorySupply: 36,
    config: defaultConfig(),
    rngState: rng,
  };
}
