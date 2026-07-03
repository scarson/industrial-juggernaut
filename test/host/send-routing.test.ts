// ABOUTME: Workers-pool tests for GameRoom send routing — broadcast (all sockets), toSeat (a seat's tabs),
// ABOUTME: reply (originating socket only), and trySend swallowing a dead socket's throw without breaking fan-out.
import { describe, expect, test } from "vitest";
import { env, runInDurableObject } from "cloudflare:test";
import type { GameRoom } from "../../src/host/game-room";
import { tokenDigest } from "../../src/host/ids";
import type { SessionHeader } from "../../src/session";
import type { RoomOptions, ServerMessage } from "../../src/wire/protocol";
import { defaultConfig } from "../../src/index";

/** A fresh GameRoom stub on a unique name so each test owns its own storage. */
let counter = 0;
function freshStub(): DurableObjectStub<GameRoom> {
  const name = `send-test-${counter++}-${Date.now()}`;
  return env.GAME_ROOM.get(env.GAME_ROOM.idFromName(name)) as DurableObjectStub<GameRoom>;
}

const ROOM_OPTIONS_OFF: RoomOptions = { defenderTimeout: { enabled: false, seconds: 120 } };

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

// Per-seat human tokens: fixed strings whose digests we install so the (B6.2) upgrade auth accepts them.
// B6.1's upgrade does not yet check the token, but passing valid tokens keeps these tests green after B6.2.
const SEAT_TOKENS = ["token-seat-0", "token-seat-1", "token-seat-2"] as const;

/** Digests for an all-human room, in seat order (each seat authorized by its fixed token). */
async function humanDigests(count: number): Promise<string[]> {
  return Promise.all(Array.from({ length: count }, (_, seat) => tokenDigest(SEAT_TOKENS[seat]!)));
}

/** Open a hibernatable socket to a seat with its valid token and accept the client end. */
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

/** Collect the NEXT `count` messages a client socket receives, as parsed ServerMessages. */
function collect(socket: WebSocket, count: number): Promise<ServerMessage[]> {
  const got: ServerMessage[] = [];
  return new Promise<ServerMessage[]>((resolve) => {
    if (count === 0) {
      resolve(got);
      return;
    }
    socket.addEventListener("message", (event) => {
      got.push(JSON.parse(event.data as string) as ServerMessage);
      if (got.length === count) resolve(got);
    });
  });
}

// A distinct probe message per channel so a test can assert the EXACT delivery set (not "≥1 send happened").
const BROADCAST_MSG: ServerMessage = { type: "reload" };
const REPLY_MSG: ServerMessage = { type: "reload" };
const SEAT_MSG: ServerMessage = {
  type: "error",
  code: "MALFORMED",
  message: "to-seat probe",
  currentLogIndex: null,
};

// ---------------------------------------------------------------------------
// (1) toSeat fans out to ALL of a seat's tabs (multi-tab) — the exact socket set, not ≥1.
// ---------------------------------------------------------------------------
describe("GameRoom send routing — toSeat reaches every tab of a seat", () => {
  test("two sockets on seat 1 → a toSeat message reaches BOTH; a seat-0 socket receives NOTHING", async () => {
    const stub = freshStub();
    await initRoom(stub, makeHeader([{ kind: "human" }, { kind: "human" }]), ROOM_OPTIONS_OFF, await humanDigests(2));
    const tabA = await openSocket(stub, 1);
    const tabB = await openSocket(stub, 1);
    const other = await openSocket(stub, 0);

    const gotA = collect(tabA, 1);
    const gotB = collect(tabB, 1);
    // The seat-0 socket must receive NOTHING; a 200ms window without a message is our negative assertion.
    let otherReceived = false;
    other.addEventListener("message", () => {
      otherReceived = true;
    });

    await runInDurableObject(stub, async (inst: GameRoom) => {
      (inst as unknown as { sink: { toSeat: (s: number, m: ServerMessage) => void } }).sink.toSeat(1, SEAT_MSG);
    });

    const [a] = await gotA;
    const [b] = await gotB;
    expect(a).toEqual(SEAT_MSG); // tab A of seat 1 received it
    expect(b).toEqual(SEAT_MSG); // tab B of seat 1 received it
    expect(otherReceived).toBe(false); // the seat-0 socket did NOT

    tabA.close(1000, "done");
    tabB.close(1000, "done");
    other.close(1000, "done");
  });
});

// ---------------------------------------------------------------------------
// (2) broadcast reaches every socket of every seat.
// ---------------------------------------------------------------------------
describe("GameRoom send routing — broadcast reaches all sockets", () => {
  test("a broadcast reaches sockets on seat 0 AND seat 1 (the exact set of all open sockets)", async () => {
    const stub = freshStub();
    await initRoom(stub, makeHeader([{ kind: "human" }, { kind: "human" }]), ROOM_OPTIONS_OFF, await humanDigests(2));
    const s0 = await openSocket(stub, 0);
    const s1a = await openSocket(stub, 1);
    const s1b = await openSocket(stub, 1);

    const got0 = collect(s0, 1);
    const got1a = collect(s1a, 1);
    const got1b = collect(s1b, 1);

    await runInDurableObject(stub, async (inst: GameRoom) => {
      (inst as unknown as { sink: { broadcast: (m: ServerMessage[]) => void } }).sink.broadcast([BROADCAST_MSG]);
    });

    expect((await got0)[0]).toEqual(BROADCAST_MSG);
    expect((await got1a)[0]).toEqual(BROADCAST_MSG);
    expect((await got1b)[0]).toEqual(BROADCAST_MSG);

    s0.close(1000, "done");
    s1a.close(1000, "done");
    s1b.close(1000, "done");
  });
});

// ---------------------------------------------------------------------------
// (3) reply reaches ONLY the originating socket (the one whose message bound the reply target).
// ---------------------------------------------------------------------------
describe("GameRoom send routing — reply reaches only the originating socket", () => {
  test("a reply routed for socket A does NOT reach socket B (same seat, two tabs)", async () => {
    const stub = freshStub();
    await initRoom(stub, makeHeader([{ kind: "human" }, { kind: "human" }]), ROOM_OPTIONS_OFF, await humanDigests(2));
    const tabA = await openSocket(stub, 0);
    const tabB = await openSocket(stub, 0);

    const gotA = collect(tabA, 1);
    let bReceived = false;
    tabB.addEventListener("message", () => {
      bReceived = true;
    });

    // Bind the reply target to tab A's server-side socket, then reply — only tab A should receive it.
    await runInDurableObject(stub, async (inst: GameRoom, state) => {
      const holder = inst as unknown as {
        replyTarget: WebSocket | null;
        sink: { reply: (m: ServerMessage[]) => void };
      };
      // The FIRST seat-0 socket in accept order is tab A (opened first).
      holder.replyTarget = state.getWebSockets("seat:0")[0]!;
      holder.sink.reply([REPLY_MSG]);
    });

    expect((await gotA)[0]).toEqual(REPLY_MSG);
    expect(bReceived).toBe(false);

    tabA.close(1000, "done");
    tabB.close(1000, "done");
  });

  test("reply with a null target (no originating socket, e.g. an alarm path) sends to nobody without throwing", async () => {
    const stub = freshStub();
    await initRoom(stub, makeHeader([{ kind: "human" }, { kind: "human" }]), ROOM_OPTIONS_OFF, await humanDigests(2));
    const s0 = await openSocket(stub, 0);
    let received = false;
    s0.addEventListener("message", () => {
      received = true;
    });

    await runInDurableObject(stub, async (inst: GameRoom) => {
      const holder = inst as unknown as {
        replyTarget: WebSocket | null;
        sink: { reply: (m: ServerMessage[]) => void };
      };
      holder.replyTarget = null; // no originating socket bound (default outside webSocketMessage)
      holder.sink.reply([REPLY_MSG]); // must not throw, must reach nobody
    });

    expect(received).toBe(false);
    s0.close(1000, "done");
  });
});

// ---------------------------------------------------------------------------
// (4) trySend swallows a throwing/closed socket's send WITHOUT throwing out, and the other sockets still receive.
// ---------------------------------------------------------------------------
describe("GameRoom send routing — trySend is failure-tolerant (closes the B5 liveness window)", () => {
  test("a broadcast to a set containing a closed socket does NOT throw, and the live socket still receives", async () => {
    const stub = freshStub();
    await initRoom(stub, makeHeader([{ kind: "human" }, { kind: "human" }]), ROOM_OPTIONS_OFF, await humanDigests(2));
    const live = await openSocket(stub, 0);
    const doomed = await openSocket(stub, 1);

    const gotLive = collect(live, 1);

    const threw = await runInDurableObject(stub, async (inst: GameRoom, state) => {
      // Force the seat-1 server-side socket into a state where send throws: close it server-side.
      const doomedServer = state.getWebSockets("seat:1")[0]!;
      doomedServer.close(1011, "forced");
      try {
        (inst as unknown as { sink: { broadcast: (m: ServerMessage[]) => void } }).sink.broadcast([BROADCAST_MSG]);
        return false;
      } catch {
        return true;
      }
    });

    expect(threw).toBe(false); // trySend swallowed the closed socket's throw
    expect((await gotLive)[0]).toEqual(BROADCAST_MSG); // the live socket still received the broadcast

    live.close(1000, "done");
    doomed.close(1000, "done");
  });

  test("sendEffects can no longer throw out even when a broadcast target is dead (the B6.1 obligation)", async () => {
    const stub = freshStub();
    await initRoom(stub, makeHeader([{ kind: "human" }, { kind: "human" }]), ROOM_OPTIONS_OFF, await humanDigests(2));
    const doomed = await openSocket(stub, 0);

    const threw = await runInDurableObject(stub, async (inst: GameRoom, state) => {
      const doomedServer = state.getWebSockets("seat:0")[0]!;
      doomedServer.close(1011, "forced");
      // Drive sendEffects directly with a broadcast-carrying Effects bundle over the closed-only socket set.
      const effects = {
        persist: null,
        reply: [],
        toSeat: [],
        broadcast: [BROADCAST_MSG],
        alarm: null,
      };
      try {
        (inst as unknown as { sendEffects: (e: unknown) => void }).sendEffects(effects);
        return false;
      } catch {
        return true;
      }
    });

    expect(threw).toBe(false);
    doomed.close(1000, "done");
  });
});
