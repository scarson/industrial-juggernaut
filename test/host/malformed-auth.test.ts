// ABOUTME: Workers-pool tests for GameRoom B6.2 — per-socket seat-token auth at the WS upgrade (incl. the agent-seat
// ABOUTME: layer-2 bind-refusal) and the malformed count-limit-before-close whose counter survives hibernation.
import { describe, expect, test } from "vitest";
import { env, runInDurableObject, evictDurableObject } from "cloudflare:test";
import type { GameRoom } from "../../src/host/game-room";
import { tokenDigest } from "../../src/host/ids";
import type { SessionHeader } from "../../src/session";
import type { RoomOptions, ServerMessage } from "../../src/wire/protocol";
import { defaultConfig } from "../../src/index";

/** The B6.2 limits (kept in sync with src/host/game-room.ts). */
const MAX_MALFORMED = 8;
const MAX_MESSAGE_BYTES = 64 * 1024;

let counter = 0;
function freshStub(): DurableObjectStub<GameRoom> {
  const name = `malformed-test-${counter++}-${Date.now()}`;
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

const HUMAN_TOKEN = "human-seat-token-0";

/** Init a 2-seat room: seat 0 human (authorized by HUMAN_TOKEN), seat 1 the given kind (null digest for agent). */
async function initHumanAgentRoom(stub: DurableObjectStub<GameRoom>, seat1Kind: "human" | "agent"): Promise<void> {
  const digest0 = await tokenDigest(HUMAN_TOKEN);
  const seats: SessionHeader["seats"] =
    seat1Kind === "agent" ? [{ kind: "human" }, { kind: "agent", agent: "heuristic" }] : [{ kind: "human" }, { kind: "human" }];
  const digest1 = seat1Kind === "agent" ? null : await tokenDigest("human-seat-token-1");
  await initRoom(stub, makeHeader(seats), ROOM_OPTIONS_OFF, [digest0, digest1]);
}

/** Attempt a WS upgrade with the given raw query string (already URL-encoded). Returns the Response. */
async function upgrade(stub: DurableObjectStub<GameRoom>, query: string): Promise<Response> {
  return stub.fetch(`https://do.internal/ws?${query}`, { headers: { Upgrade: "websocket" } });
}

/** Count the DO's currently-open server-side sockets. */
async function socketCount(stub: DurableObjectStub<GameRoom>): Promise<number> {
  return runInDurableObject(stub, async (_inst, state) => state.getWebSockets().length);
}

/** Open + accept a valid-token socket for seat 0 (HUMAN_TOKEN). */
async function openSeat0(stub: DurableObjectStub<GameRoom>): Promise<WebSocket> {
  const res = await upgrade(stub, `seat=0&token=${encodeURIComponent(HUMAN_TOKEN)}`);
  expect(res.status).toBe(101);
  const socket = res.webSocket!;
  socket.accept();
  return socket;
}

/** Send `payload` and resolve with the FIRST server message the socket replies. */
function roundTrip(socket: WebSocket, payload: string): Promise<ServerMessage> {
  const got = new Promise<ServerMessage>((resolve) => {
    socket.addEventListener("message", (event) => resolve(JSON.parse(event.data as string) as ServerMessage), {
      once: true,
    });
  });
  socket.send(payload);
  return got;
}

// ---------------------------------------------------------------------------
// (a) A bad / absent seat token at upgrade → rejected, NO socket added.
// ---------------------------------------------------------------------------
describe("GameRoom /ws auth — a bad or absent token is refused (no acceptWebSocket)", () => {
  test("a wrong token → 403, generic message, getWebSockets() did not grow", async () => {
    const stub = freshStub();
    await initHumanAgentRoom(stub, "human");
    expect(await socketCount(stub)).toBe(0);

    const res = await upgrade(stub, `seat=0&token=${encodeURIComponent("wrong-token")}`);
    expect(res.status).toBe(403);
    expect(res.webSocket).toBeFalsy();
    // The rejection is GENERIC — it must not leak whether the seat exists / is an agent / how close the token was.
    expect(await res.text()).toBe("bad seat token");
    expect(await socketCount(stub)).toBe(0);
  });

  test("an absent token → 403, no socket", async () => {
    const stub = freshStub();
    await initHumanAgentRoom(stub, "human");
    const res = await upgrade(stub, "seat=0");
    expect(res.status).toBe(403);
    expect(res.webSocket).toBeFalsy();
    expect(await socketCount(stub)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (b) LAYER 2 — an agent seat (authorizedDigest null) refuses ANY token, even a syntactically valid one.
// ---------------------------------------------------------------------------
describe("GameRoom /ws auth — layer-2 agent-seat bind-refusal", () => {
  test("an upgrade to an AGENT seat with any token → 403 (agent seats are host-driven, never socket-bound)", async () => {
    const stub = freshStub();
    await initHumanAgentRoom(stub, "agent"); // seat 1 is an agent → authorizedDigest === null

    // Even a well-formed token cannot bind an agent seat (there is no token to match — the refusal is by seat kind).
    const res = await upgrade(stub, `seat=1&token=${encodeURIComponent("anything")}`);
    expect(res.status).toBe(403);
    expect(res.webSocket).toBeFalsy();
    expect(await res.text()).toBe("bad seat token"); // same generic message — does not reveal it is an agent seat
    expect(await socketCount(stub)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (c) A VALID token → accepted (101), the socket is bound + counted.
// ---------------------------------------------------------------------------
describe("GameRoom /ws auth — a valid token is accepted", () => {
  test("seat 0 with HUMAN_TOKEN → 101, the socket is bound (getWebSockets grows to 1)", async () => {
    const stub = freshStub();
    await initHumanAgentRoom(stub, "human");
    const res = await upgrade(stub, `seat=0&token=${encodeURIComponent(HUMAN_TOKEN)}`);
    expect(res.status).toBe(101);
    expect(res.webSocket).toBeTruthy();
    res.webSocket!.accept();
    expect(await socketCount(stub)).toBe(1);
    res.webSocket!.close(1000, "done");
  });

  test("a valid token whose seat has a non-null digest but the WRONG token → 403", async () => {
    const stub = freshStub();
    await initHumanAgentRoom(stub, "human"); // seat 1 is human with digest of "human-seat-token-1"
    const res = await upgrade(stub, `seat=1&token=${encodeURIComponent(HUMAN_TOKEN)}`); // seat-0's token on seat 1
    expect(res.status).toBe(403);
    expect(res.webSocket).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// (d) N malformed messages → N structured errors, then a close at MAX_MALFORMED.
// ---------------------------------------------------------------------------
describe("GameRoom malformed enforcement — count-limit-before-close", () => {
  test("MAX_MALFORMED malformed messages → each replies an error, the last closes the socket 1008", async () => {
    const stub = freshStub();
    await initHumanAgentRoom(stub, "human");
    const socket = await openSeat0(stub);

    const closed = new Promise<number>((resolve) => {
      socket.addEventListener("close", (event) => resolve(event.code), { once: true });
    });

    const errors: ServerMessage[] = [];
    // Send MAX_MALFORMED malformed (invalid-JSON) messages, collecting the error reply for each.
    for (let i = 0; i < MAX_MALFORMED; i++) {
      const reply = await roundTrip(socket, "not json{{{");
      errors.push(reply);
    }

    // Every one replied a structured MALFORMED error.
    expect(errors).toHaveLength(MAX_MALFORMED);
    for (const e of errors) {
      expect(e.type).toBe("error");
      if (e.type === "error") expect(e.code).toBe("MALFORMED");
    }

    // The MAX_MALFORMED-th malformed message closed the socket 1008.
    expect(await closed).toBe(1008);
  });

  test("OVERSIZED and UNKNOWN_TYPE also count toward the malformed budget", async () => {
    const stub = freshStub();
    await initHumanAgentRoom(stub, "human");
    const socket = await openSeat0(stub);

    // An oversized message → OVERSIZED error.
    const big = "x".repeat(MAX_MESSAGE_BYTES + 1);
    const over = await roundTrip(socket, big);
    expect(over.type).toBe("error");
    if (over.type === "error") expect(over.code).toBe("OVERSIZED");

    // A well-formed JSON object with an unknown `type` → UNKNOWN_TYPE error.
    const unknown = await roundTrip(socket, JSON.stringify({ type: "definitelyNotACommand" }));
    expect(unknown.type).toBe("error");
    if (unknown.type === "error") expect(unknown.code).toBe("UNKNOWN_TYPE");

    // The attachment's malformedCount is now 2 (one OVERSIZED + one UNKNOWN_TYPE).
    const count = await runInDurableObject(stub, async (_inst, state) => {
      const ws = state.getWebSockets("seat:0")[0]!;
      return (ws.deserializeAttachment() as { malformedCount: number }).malformedCount;
    });
    expect(count).toBe(2);

    socket.close(1000, "done");
  });
});

// ---------------------------------------------------------------------------
// (e) THE load-bearing anti-idle-abuse assertion: the malformed count PERSISTS across hibernation.
// ---------------------------------------------------------------------------
describe("GameRoom malformed enforcement — the count survives hibernation (anti-idle-abuse)", () => {
  test("send k<MAX malformed, evict-hibernate, send more → the close still fires at the CUMULATIVE threshold", async () => {
    const stub = freshStub();
    await initHumanAgentRoom(stub, "human");
    const socket = await openSeat0(stub);

    const half = MAX_MALFORMED - 3; // send a few short of the threshold before hibernating
    for (let i = 0; i < half; i++) {
      const reply = await roundTrip(socket, "garbage{{{");
      expect(reply.type).toBe("error");
    }

    // The counter is at `half` in the attachment.
    const beforeEvict = await runInDurableObject(stub, async (_inst, state) => {
      const ws = state.getWebSockets("seat:0")[0]!;
      return (ws.deserializeAttachment() as { malformedCount: number }).malformedCount;
    });
    expect(beforeEvict).toBe(half);

    // Force hibernation — the in-memory instance is torn down; the socket + its attachment survive.
    await evictDurableObject(stub, { webSockets: "hibernate" });

    // The count must NOT reset. It survived in the attachment — verify, then continue sending.
    const afterEvict = await runInDurableObject(stub, async (_inst, state) => {
      const ws = state.getWebSockets("seat:0")[0]!;
      return (ws.deserializeAttachment() as { malformedCount: number }).malformedCount;
    });
    expect(afterEvict).toBe(half); // NOT reset to 0 by the idle/hibernate

    const closed = new Promise<number>((resolve) => {
      socket.addEventListener("close", (event) => resolve(event.code), { once: true });
    });

    // Send exactly enough MORE malformed messages to reach the cumulative threshold. If the count had reset,
    // these (MAX_MALFORMED - half) messages would NOT reach the threshold and the socket would stay open.
    for (let i = half; i < MAX_MALFORMED; i++) {
      await roundTrip(socket, "garbage{{{");
    }

    expect(await closed).toBe(1008); // the close fired at the CUMULATIVE threshold, proving no reset
  });
});

// ---------------------------------------------------------------------------
// (f) A WELL-FORMED message does NOT increment the malformed count.
// ---------------------------------------------------------------------------
describe("GameRoom malformed enforcement — a well-formed command never increments the count", () => {
  test("interleaving well-formed messages does not advance the threshold early", async () => {
    const stub = freshStub();
    await initHumanAgentRoom(stub, "human");
    const socket = await openSeat0(stub);

    let closedEarly = false;
    socket.addEventListener("close", () => {
      closedEarly = true;
    });

    // Send MAX_MALFORMED-1 malformed messages, interleaving a WELL-FORMED resync after each. If a well-formed
    // message incremented the count, the socket would close before we intend; it must NOT.
    for (let i = 0; i < MAX_MALFORMED - 1; i++) {
      await roundTrip(socket, "bad{{{"); // malformed → increments
      const good = await roundTrip(socket, JSON.stringify({ type: "resync" })); // well-formed → does NOT increment
      expect(good.type).toBe("resync");
    }

    // After MAX_MALFORMED-1 malformed (and MAX_MALFORMED-1 well-formed) messages, the socket is STILL open.
    expect(closedEarly).toBe(false);

    const count = await runInDurableObject(stub, async (_inst, state) => {
      const ws = state.getWebSockets("seat:0")[0]!;
      return (ws.deserializeAttachment() as { malformedCount: number }).malformedCount;
    });
    expect(count).toBe(MAX_MALFORMED - 1); // exactly the malformed count — the well-formed ones did not count

    socket.close(1000, "done");
  });
});
