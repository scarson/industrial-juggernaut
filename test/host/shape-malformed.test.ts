// ABOUTME: Workers-pool regression for the CRITICAL DoS: a valid-seat client sending well-typed but shape-malformed
// ABOUTME: commands ({type:"attack",decl:null}, ...) must NOT crash the room or bypass the malformed-abuse budget.
import { describe, expect, test } from "vitest";
import { env, runInDurableObject } from "cloudflare:test";
import type { GameRoom } from "../../src/host/game-room";
import { tokenDigest } from "../../src/host/ids";
import { type SessionHeader, type SessionState, type LogEntry, type CommandCtx } from "../../src/session";
import type { ClientCommand, RoomOptions, ServerMessage } from "../../src/wire/protocol";
import { defaultConfig, seed as makeSeed } from "../../src/index";
import { key } from "../../src/geometry/cube";
import type { Base, GameState, Hex, PlayerId, RngState } from "../../src/engine/types";

let counter = 0;
function freshStub(): DurableObjectStub<GameRoom> {
  const name = `shape-test-${counter++}-${Date.now()}`;
  return env.GAME_ROOM.get(env.GAME_ROOM.idFromName(name)) as DurableObjectStub<GameRoom>;
}

const ROOM_OPTIONS_OFF: RoomOptions = { defenderTimeout: { enabled: false, seconds: 120 } };
const SEAT0_TOKEN = "shape-token-0";
const SEAT1_TOKEN = "shape-token-1";

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

async function initTwoHumanRoom(stub: DurableObjectStub<GameRoom>): Promise<void> {
  const digests = [await tokenDigest(SEAT0_TOKEN), await tokenDigest(SEAT1_TOKEN)];
  await stub.fetch("https://do.internal/init", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(initPayload(makeHeader([{ kind: "human" }, { kind: "human" }]), ROOM_OPTIONS_OFF, digests)),
  });
}

async function openSeat(stub: DurableObjectStub<GameRoom>, seat: number, token: string): Promise<WebSocket> {
  const res = await stub.fetch(`https://do.internal/ws?seat=${seat}&token=${encodeURIComponent(token)}`, {
    headers: { Upgrade: "websocket" },
  });
  expect(res.status).toBe(101);
  const socket = res.webSocket!;
  socket.accept();
  return socket;
}

/** Send a RAW string and resolve with the FIRST server message the socket replies. */
function roundTripRaw(socket: WebSocket, raw: string): Promise<ServerMessage> {
  const got = new Promise<ServerMessage>((resolve) => {
    socket.addEventListener("message", (event) => resolve(JSON.parse(event.data as string) as ServerMessage), {
      once: true,
    });
  });
  socket.send(raw);
  return got;
}

async function seat0Count(stub: DurableObjectStub<GameRoom>): Promise<number> {
  return runInDurableObject(stub, async (_inst, state) => {
    const ws = state.getWebSockets("seat:0")[0]!;
    return (ws.deserializeAttachment() as { malformedCount: number }).malformedCount;
  });
}

async function storedLogLength(stub: DurableObjectStub<GameRoom>): Promise<number> {
  return runInDurableObject(stub, async (_inst, state) => {
    const rows = await state.storage.list<LogEntry>({ prefix: "log:" });
    return rows.size;
  });
}

// ---------------------------------------------------------------------------
// Synthetic PLAY-phase attack state (mirrors critical-section.test.ts) — so `attack`/`build` reach the reducer
// BODY (past the setup/turn envelope guards), where the unguarded field derefs live. Seat 0 is the current actor.
// ---------------------------------------------------------------------------
function synthHex(x: number, y: number): Hex {
  return { x, y, z: -x - y };
}
const T: Hex = synthHex(0, 0);
const A: Hex[] = [synthHex(1, 0), synthHex(2, -1), synthHex(0, 2)];
const DEF: Hex = synthHex(-1, 0);
const IRON: Hex[] = [A[0]!, DEF];
function synthBase(owner: PlayerId, h: Hex, order: number): Base {
  return { owner, hex: h, state: "fresh", order };
}
function synthAttackGame(): GameState {
  const seen = new Set<string>();
  const hexes: Hex[] = [];
  for (let x = -6; x <= 6; x++) {
    for (let y = -6; y <= 6; y++) {
      const h = synthHex(x, y);
      if (Math.abs(h.z) <= 6 && !seen.has(key(h))) {
        seen.add(key(h));
        hexes.push(h);
      }
    }
  }
  const bases: Base[] = [
    synthBase(1, T, 0),
    synthBase(1, DEF, 1),
    synthBase(0, A[0]!, 2),
    synthBase(0, A[1]!, 3),
    synthBase(0, A[2]!, 4),
  ];
  const rng: RngState = makeSeed(1n);
  return {
    board: { hexes, iron: IRON },
    bases,
    factories: [],
    players: Array.from({ length: 2 }, (_, id) => ({ id, basesInHand: 12, alliance: [id], eliminated: false })),
    phase: { turn: 3, order: [0, 1], indexInOrder: 0 },
    factorySupply: 36,
    config: defaultConfig(),
    rngState: rng,
  };
}

/** Seed the DO cache to the synthetic play-phase attack state at logLength 7 (seat 0 can legally attack). */
async function seedAttackState(stub: DurableObjectStub<GameRoom>): Promise<void> {
  await runInDurableObject(stub, async (inst: GameRoom) => {
    const base = (inst as unknown as { session: SessionState }).session;
    (inst as unknown as { session: SessionState }).session = { ...base, game: synthAttackGame(), logLength: 7 };
  });
}

// The shape-malformed payloads that (pre-fix) threw uncaught out of applyCommand. Each is well-typed (`type` is a
// real command) but shape-broken. `idx` matches the seeded logLength (7) so the STALE_INDEX envelope guard does not
// short-circuit before the reducer body — the throw surface is only reachable with a fresh index.
const SHAPE_ATTACKS: ReadonlyArray<{ name: string; raw: string }> = [
  { name: "attack decl null", raw: JSON.stringify({ type: "attack", expectedLogIndex: 7, decl: null }) },
  { name: "attack decl.target null", raw: JSON.stringify({ type: "attack", expectedLogIndex: 7, decl: { target: null } }) },
  {
    name: "attack attackers not-array (number)",
    raw: JSON.stringify({ type: "attack", expectedLogIndex: 7, decl: { target: T, attackers: 5, defender: DEF } }),
  },
  {
    name: "attack attackers not-array (string)",
    raw: JSON.stringify({ type: "attack", expectedLogIndex: 7, decl: { target: T, attackers: "abc", defender: DEF } }),
  },
  { name: "build pieces null", raw: JSON.stringify({ type: "build", expectedLogIndex: 7, pieces: null }) },
  { name: "build pieces string", raw: JSON.stringify({ type: "build", expectedLogIndex: 7, pieces: "x" }) },
  { name: "build piece empty object", raw: JSON.stringify({ type: "build", expectedLogIndex: 7, pieces: [{}] }) },
  { name: "placeFirstBase bad hex", raw: JSON.stringify({ type: "placeFirstBase", expectedLogIndex: 7, hex: { x: "a", y: 0, z: 0 } }) },
];

describe("GameRoom shape-malformed commands — no crash, MALFORMED reply, counted, not persisted", () => {
  for (const { name, raw } of SHAPE_ATTACKS) {
    test(`${name} → MALFORMED reply, count incremented, no log entry, no throw`, async () => {
      const stub = freshStub();
      await initTwoHumanRoom(stub);
      const socket = await openSeat(stub, 0, SEAT0_TOKEN);
      await seedAttackState(stub);

      const logBefore = await storedLogLength(stub);
      const countBefore = await seat0Count(stub);

      // (a) NO throw escapes: roundTripRaw resolves with a reply rather than hanging / the room crashing.
      const reply = await roundTripRaw(socket, raw);

      // (b) a MALFORMED structured error reply.
      expect(reply.type).toBe("error");
      if (reply.type === "error") expect(reply.code).toBe("MALFORMED");

      // (c) the malformed count INCREMENTED (the abuse budget applies to a shape-attack).
      expect(await seat0Count(stub)).toBe(countBefore + 1);

      // (d) NO log entry persisted.
      expect(await storedLogLength(stub)).toBe(logBefore);

      socket.close(1000, "done");
    });
  }

  test("a well-formed legal attack of the same shape STILL succeeds (validator does not reject legal commands)", async () => {
    const stub = freshStub();
    await initTwoHumanRoom(stub);
    const seat0 = await openSeat(stub, 0, SEAT0_TOKEN);
    // Seat 1 (the human defender) must be present so its defender pending can open + prompt reaches its tab.
    const seat1 = await openSeat(stub, 1, SEAT1_TOKEN);
    await seedAttackState(stub);

    // A legal attack against seat 1's human base opens a durable pending (no log entry) and PROMPTS seat 1 (toSeat).
    // The attacker (seat 0) gets no direct reply, so we await the prompt on seat 1's socket instead.
    const prompt = new Promise<ServerMessage>((resolve) => {
      seat1.addEventListener("message", (event) => resolve(JSON.parse(event.data as string) as ServerMessage), {
        once: true,
      });
    });
    seat0.send(JSON.stringify({ type: "attack", expectedLogIndex: 7, decl: { target: T, attackers: A, defender: DEF } }));

    // The validator did NOT reject the legal command: it reached the reducer, which opened the pending + prompted.
    const promptMsg = await prompt;
    expect(promptMsg.type).toBe("prompt");
    // A well-formed command never increments the malformed count.
    expect(await seat0Count(stub)).toBe(0);
    // A pending opens WITHOUT a log entry — no persist from a legal attack that awaits the defender.
    expect(await storedLogLength(stub)).toBe(0);

    seat0.close(1000, "done");
    seat1.close(1000, "done");
  });
});

// ---------------------------------------------------------------------------
// LAYER 2 (backstop) — proven in isolation by calling handleCommand DIRECTLY with a shape-malformed command
// (bypassing Layer 1, exactly what "a shape Layer 1 missed, or a reducer bug" looks like from handleCommand's view).
// The backstop must: return "reducer-threw", reply MALFORMED, persist NOTHING, and never let the throw escape.
// ---------------------------------------------------------------------------
describe("GameRoom.handleCommand — Layer 2 backstop catches an applyCommand throw Layer 1 didn't", () => {
  test("a shape-malformed command sent straight to handleCommand → 'reducer-threw', MALFORMED reply, no persist, no throw", async () => {
    const stub = freshStub();
    await initTwoHumanRoom(stub);
    await seedAttackState(stub);

    const { outcome, replied, logLen, threw } = await runInDurableObject(stub, async (inst: GameRoom, state) => {
      // Capture the sink reply without a socket (handleCommand is the WebSocket-free seam).
      const replies: ServerMessage[] = [];
      (inst as unknown as { sink: { reply: (m: ServerMessage[]) => void; toSeat: () => void; broadcast: () => void } }).sink = {
        reply: (msgs: ServerMessage[]) => replies.push(...msgs),
        toSeat: () => {},
        broadcast: () => {},
      };
      // {type:"attack",decl:null} passes the type gate but derefs null in the reducer — Layer 1 would catch it, but
      // here we bypass Layer 1 to prove Layer 2 alone contains the throw. Cast through unknown (it is not a valid decl).
      const ctx: CommandCtx = { actingSeat: 0, nowEpochMs: Date.now(), decisionId: "d" };
      const bad = { type: "attack", expectedLogIndex: 7, decl: null } as unknown as ClientCommand;
      let result: string;
      let didThrow = false;
      try {
        result = await inst.handleCommand(bad, ctx);
      } catch {
        result = "ESCAPED";
        didThrow = true;
      }
      const rows = await state.storage.list<LogEntry>({ prefix: "log:" });
      return { outcome: result, replied: replies, logLen: rows.size, threw: didThrow };
    });

    expect(threw).toBe(false); // the throw did NOT escape handleCommand
    expect(outcome).toBe("reducer-threw"); // the backstop signalled the caller to count it
    expect(replied).toHaveLength(1);
    expect(replied[0]!.type).toBe("error");
    if (replied[0]!.type === "error") expect(replied[0]!.code).toBe("MALFORMED");
    expect(logLen).toBe(0); // NOTHING persisted
  });

  test("a well-formed command through handleCommand returns 'ok' (the backstop does not false-positive)", async () => {
    const stub = freshStub();
    await initTwoHumanRoom(stub);
    await seedAttackState(stub);

    const outcome = await runInDurableObject(stub, async (inst: GameRoom) => {
      (inst as unknown as { sink: { reply: () => void; toSeat: () => void; broadcast: () => void } }).sink = {
        reply: () => {},
        toSeat: () => {},
        broadcast: () => {},
      };
      const ctx: CommandCtx = { actingSeat: 0, nowEpochMs: Date.now(), decisionId: "d" };
      const good: ClientCommand = { type: "attack", expectedLogIndex: 7, decl: { target: T, attackers: A, defender: DEF } };
      return inst.handleCommand(good, ctx);
    });

    expect(outcome).toBe("ok");
  });
});
