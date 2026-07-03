// ABOUTME: Workers-pool tests for the GameRoom critical section — the assertion-rigor flagship (recorded-order put<send).
// ABOUTME: Init/second-init/uninitialized routing, STALE_INDEX no-put, alarm-before-send, agent-drive continuation.
import { describe, expect, test } from "vitest";
import { SELF, env, runInDurableObject } from "cloudflare:test";
import type { GameRoom } from "../../src/host/game-room";
import {
  logKey,
  PENDING_KEY,
  type SessionState,
  type SessionHeader,
  type CommandCtx,
} from "../../src/session";
import type { ClientCommand, RoomOptions, ServerMessage } from "../../src/wire/protocol";
import { representativeFirstBase, defaultConfig } from "../../src/index";
import { seed as makeSeed } from "../../src/index";
import { key } from "../../src/geometry/cube";
import type { Base, GameState, Hex, PlayerId, RngState } from "../../src/engine/types";

/** A fresh GameRoom stub on a unique name so each test owns its own storage. */
let counter = 0;
function freshStub(): DurableObjectStub<GameRoom> {
  const name = `crit-test-${counter++}-${Date.now()}`;
  return env.GAME_ROOM.get(env.GAME_ROOM.idFromName(name)) as DurableObjectStub<GameRoom>;
}

const ROOM_OPTIONS_OFF: RoomOptions = { defenderTimeout: { enabled: false, seconds: 120 } };
const ROOM_OPTIONS_ON: RoomOptions = { defenderTimeout: { enabled: true, seconds: 90 } };

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

function mkCtx(actingSeat: number): CommandCtx {
  return { actingSeat, nowEpochMs: Date.now(), decisionId: `decision-${actingSeat}-${Math.random()}` };
}

/** POST /init to a stub and return the Response. */
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

/** One recorded operation on the shared ordered array: a storage put (its keys) or a send (message type + logIndex). */
type Op =
  | { op: "put"; keys: string[] }
  | { op: "setAlarm"; at: number }
  | { op: "deleteAlarm" }
  | { op: "send"; channel: "reply" | "toSeat" | "broadcast"; type: string; logIndex: number | null };

/**
 * Install the recorded-order harness on a running instance+state: wrap `state.storage.put`,
 * `state.storage.setAlarm`, `state.storage.deleteAlarm`, and the instance `sink` so every storage
 * mutation and every send appends a tagged marker to ONE shared ordered array. The array's INDEX
 * order is the observed causal order (never a timestamp) — the load-bearing mechanism.
 */
function installOrderSpy(inst: GameRoom, state: DurableObjectState): Op[] {
  const ops: Op[] = [];
  const storage = state.storage;

  const realPut = storage.put.bind(storage);
  // storage.put has two shapes: put(key, value) and put(entries). We only ever use the bulk form
  // in persistEvent, but wrap both defensively so writeHeader's bulk put is recorded too.
  (storage as unknown as { put: typeof storage.put }).put = ((
    keyOrEntries: string | Record<string, unknown>,
    value?: unknown,
  ) => {
    if (typeof keyOrEntries === "string") {
      ops.push({ op: "put", keys: [keyOrEntries] });
      return realPut(keyOrEntries, value as never);
    }
    ops.push({ op: "put", keys: Object.keys(keyOrEntries) });
    return realPut(keyOrEntries as never);
  }) as typeof storage.put;

  const realSetAlarm = storage.setAlarm.bind(storage);
  (storage as unknown as { setAlarm: typeof storage.setAlarm }).setAlarm = ((at: number, opts?: unknown) => {
    ops.push({ op: "setAlarm", at });
    return realSetAlarm(at, opts as never);
  }) as typeof storage.setAlarm;

  const realDeleteAlarm = storage.deleteAlarm.bind(storage);
  (storage as unknown as { deleteAlarm: typeof storage.deleteAlarm }).deleteAlarm = ((opts?: unknown) => {
    ops.push({ op: "deleteAlarm" });
    return realDeleteAlarm(opts as never);
  }) as typeof storage.deleteAlarm;

  const logIndexOf = (m: ServerMessage): number | null =>
    m.type === "applied" ? m.logIndex : null;
  const record = (channel: "reply" | "toSeat" | "broadcast") => (msgs: ServerMessage[]) => {
    for (const m of msgs) ops.push({ op: "send", channel, type: m.type, logIndex: logIndexOf(m) });
  };
  // The instance sink is the seam B6.1 fills with socket fan-out; here the test replaces it.
  (inst as unknown as { sink: unknown }).sink = {
    reply: record("reply"),
    toSeat: (seat: number, msg: ServerMessage) => record("toSeat")([msg]),
    broadcast: record("broadcast"),
  };
  return ops;
}

/** Index of the first op matching a predicate; -1 if none. */
function firstIndex(ops: Op[], pred: (o: Op) => boolean): number {
  return ops.findIndex(pred);
}

describe("GameRoom /init routing", () => {
  test("POST /init → 200, second init → 409", async () => {
    const stub = freshStub();
    const header = makeHeader([{ kind: "human" }, { kind: "human" }]);
    const digests = ["a".repeat(64), "b".repeat(64)];

    const res1 = await initRoom(stub, header, ROOM_OPTIONS_OFF, digests);
    expect(res1.status).toBe(200);

    const res2 = await initRoom(stub, header, ROOM_OPTIONS_OFF, digests);
    expect(res2.status).toBe(409);
  });

  test("init installs the header + digests (seed re-parsed as bigint) so the session is playable", async () => {
    const stub = freshStub();
    const header = makeHeader([{ kind: "human" }, { kind: "human" }]);
    const digests = ["c".repeat(64), "d".repeat(64)];
    await initRoom(stub, header, ROOM_OPTIONS_OFF, digests);

    await runInDurableObject(stub, async (inst: GameRoom, state) => {
      // The session cache is populated and the seed came back as a native bigint.
      const s = (inst as unknown as { session: SessionState | null }).session;
      expect(s).not.toBeNull();
      expect(typeof s!.header.seed).toBe("bigint");
      expect(s!.header.seed).toBe(12345678901234567890n);
      // Digests installed into the seats runtime.
      expect(s!.seats[0]!.authorizedDigest).toBe("c".repeat(64));
      expect(s!.seats[1]!.authorizedDigest).toBe("d".repeat(64));
      // Storage marked initialized.
      expect(await state.storage.get("initialized")).toBe(true);
    });
  });

  test("GET /ws still 501 in B3 (B4 owns the WebSocketPair)", async () => {
    const stub = freshStub();
    await initRoom(stub, makeHeader([{ kind: "human" }, { kind: "human" }]), ROOM_OPTIONS_OFF, [null, null]);
    const res = await stub.fetch("https://do.internal/ws", { headers: { Upgrade: "websocket" } });
    expect(res.status).toBe(501);
  });
});

describe("GameRoom.handleCommand — THE flagship: recorded put-before-send ordering", () => {
  test("a mutating human command persists log:000000 STRICTLY before it sends the applied message", async () => {
    const stub = freshStub();
    const header = makeHeader([{ kind: "human" }, { kind: "human" }]);
    await initRoom(stub, header, ROOM_OPTIONS_OFF, ["e".repeat(64), "f".repeat(64)]);

    const ops = await runInDurableObject(stub, async (inst: GameRoom, state) => {
      const recorded = installOrderSpy(inst, state);
      // Seat 0 places its first base at a legal outer-ring hex (the setup placer is seat 0).
      const session = (inst as unknown as { session: SessionState }).session;
      const hex = representativeFirstBase(session.game, 0);
      const cmd: ClientCommand = { type: "placeFirstBase", expectedLogIndex: 0, hex };
      await inst.handleCommand(cmd, mkCtx(0));
      return recorded;
    });

    // The load-bearing assertion: the put carrying log:000000 appears at a STRICTLY LOWER index
    // than the send of the applied message for logIndex 0. Mechanism = observed order, never a clock.
    const putIdx = firstIndex(ops, (o) => o.op === "put" && o.keys.includes(logKey(0)));
    const sendIdx = firstIndex(ops, (o) => o.op === "send" && o.type === "applied" && o.logIndex === 0);
    expect(putIdx).toBeGreaterThanOrEqual(0);
    expect(sendIdx).toBeGreaterThanOrEqual(0);
    expect(putIdx).toBeLessThan(sendIdx);
  });

  test("each agent-drive round persists its entry STRICTLY before it broadcasts that entry's applied message", async () => {
    const stub = freshStub();
    // Seat 0 human (the setup placer), seat 1 agent. After seat 0 places, it becomes seat 1's
    // placement (agent) — driveAgents auto-places for the agent seat, persisting+broadcasting each.
    const header = makeHeader([{ kind: "human" }, { kind: "agent", agent: "heuristic" }]);
    await initRoom(stub, header, ROOM_OPTIONS_OFF, ["e".repeat(64), null]);

    const ops = await runInDurableObject(stub, async (inst: GameRoom, state) => {
      const recorded = installOrderSpy(inst, state);
      const session = (inst as unknown as { session: SessionState }).session;
      const hex = representativeFirstBase(session.game, 0);
      await inst.handleCommand({ type: "placeFirstBase", expectedLogIndex: 0, hex }, mkCtx(0));
      return recorded;
    });

    // The agent's placement is log:000001 (seat 0's is log:000000). Its put precedes its broadcast.
    const putIdx = firstIndex(ops, (o) => o.op === "put" && o.keys.includes(logKey(1)));
    const sendIdx = firstIndex(ops, (o) => o.op === "send" && o.type === "applied" && o.logIndex === 1);
    expect(putIdx).toBeGreaterThanOrEqual(0);
    expect(sendIdx).toBeGreaterThanOrEqual(0);
    expect(putIdx).toBeLessThan(sendIdx);
    // And every applied send in the array is preceded by a put carrying its log key (per-event invariant).
    for (let i = 0; i < ops.length; i++) {
      const o = ops[i]!;
      if (o.op === "send" && o.type === "applied" && o.logIndex !== null) {
        const key = logKey(o.logIndex);
        const putBefore = ops.slice(0, i).some((p) => p.op === "put" && p.keys.includes(key));
        expect(putBefore).toBe(true);
      }
    }
  });
});

describe("GameRoom.handleCommand — rejected commands do not persist", () => {
  test("STALE_INDEX: no put occurs, session unchanged, a resync reply flows through the sink", async () => {
    const stub = freshStub();
    const header = makeHeader([{ kind: "human" }, { kind: "human" }]);
    await initRoom(stub, header, ROOM_OPTIONS_OFF, ["e".repeat(64), "f".repeat(64)]);

    const { ops, logLenBefore, logLenAfter } = await runInDurableObject(
      stub,
      async (inst: GameRoom, state) => {
        const recorded = installOrderSpy(inst, state);
        const session = (inst as unknown as { session: SessionState }).session;
        const before = session.logLength;
        const hex = representativeFirstBase(session.game, 0);
        // expectedLogIndex 5 is stale (real logLength is 0) → STALE_INDEX resync, no mutation.
        await inst.handleCommand({ type: "placeFirstBase", expectedLogIndex: 5, hex }, mkCtx(0));
        const after = (inst as unknown as { session: SessionState }).session.logLength;
        return { ops: recorded, logLenBefore: before, logLenAfter: after };
      },
    );

    expect(ops.some((o) => o.op === "put")).toBe(false); // NO put at all
    expect(logLenAfter).toBe(logLenBefore); // session unchanged
    expect(ops.some((o) => o.op === "send" && o.channel === "reply" && o.type === "resync")).toBe(true);
  });
});

describe("GameRoom.handleCommand — uninitialized room", () => {
  test("handleCommand on an uninitialized room → ROOM_NOT_INITIALIZED error reply through the sink", async () => {
    const stub = freshStub(); // never /init'd
    const ops = await runInDurableObject(stub, async (inst: GameRoom, state) => {
      const recorded = installOrderSpy(inst, state);
      await inst.handleCommand({ type: "resync" }, mkCtx(0));
      return recorded;
    });
    expect(
      ops.some((o) => o.op === "send" && o.channel === "reply" && o.type === "error"),
    ).toBe(true);
  });
});

describe("GameRoom.handleCommand — alarm armed BEFORE the prompt is sent (timeout ON)", () => {
  test("a human-vs-human attack opening a pending shows put(PENDING) < setAlarm < send(prompt)", async () => {
    // A 2-human room with timeout ON. We seed the DO's session cache directly to a synthetic mid-play
    // attack position (the same shape test/session/attack-command.test.ts uses) so seat 0 can legally
    // attack seat 1's human base — that opens a pending, arms the alarm, and prompts the defender.
    const stub = freshStub();
    const header = makeHeader([{ kind: "human" }, { kind: "human" }]);
    await initRoom(stub, header, ROOM_OPTIONS_ON, ["e".repeat(64), "f".repeat(64)]);

    const ops = await runInDurableObject(stub, async (inst: GameRoom, state) => {
      // Replace the cache with a synthetic attackable state (keep the real header/seats/roomOptions).
      const base = (inst as unknown as { session: SessionState }).session;
      const game = synthAttackGame();
      (inst as unknown as { session: SessionState }).session = { ...base, game, logLength: 7 };

      const recorded = installOrderSpy(inst, state);
      const cmd: ClientCommand = { type: "attack", expectedLogIndex: 7, decl: ATTACK_DECL };
      await inst.handleCommand(cmd, mkCtx(0));
      return recorded;
    });

    const pendingPutIdx = firstIndex(ops, (o) => o.op === "put" && o.keys.includes(PENDING_KEY));
    const setAlarmIdx = firstIndex(ops, (o) => o.op === "setAlarm");
    const promptSendIdx = firstIndex(ops, (o) => o.op === "send" && o.type === "prompt");
    expect(pendingPutIdx).toBeGreaterThanOrEqual(0);
    expect(setAlarmIdx).toBeGreaterThanOrEqual(0);
    expect(promptSendIdx).toBeGreaterThanOrEqual(0);
    // Order: persist(PENDING) → arm alarm → send(prompt). Observed index order, never a clock.
    expect(pendingPutIdx).toBeLessThan(setAlarmIdx);
    expect(setAlarmIdx).toBeLessThan(promptSendIdx);
  });
});

describe("Worker create flow — real init, no 501 tolerance", () => {
  test("POST /api/games now succeeds fully end-to-end (real /init returns 200, tokens handed out)", async () => {
    const res = await SELF.fetch("https://host.test/api/games", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        seats: [{ kind: "human" }, { kind: "agent", agent: "heuristic" }],
        boardSource: { kind: "generate", size: 96, ironCount: 14 },
        seed: "12345678901234567890",
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { roomId: string; seatTokens: (string | null)[] };
    expect(json.roomId).toHaveLength(20);
    expect(json.seatTokens[0]).toHaveLength(26);
    expect(json.seatTokens[1]).toBeNull();

    // The created room's DO is really initialized: a second /init to its stub → 409.
    const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(json.roomId)) as DurableObjectStub<GameRoom>;
    const second = await stub.fetch("https://do.internal/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        initPayload(makeHeader([{ kind: "human" }, { kind: "agent", agent: "heuristic" }]), ROOM_OPTIONS_OFF, [
          null,
          null,
        ]),
      ),
    });
    expect(second.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Synthetic PLAY-phase attack position (mirrors test/session/attack-command.test.ts).
// Player 0 (attacker) can attack player 1's base at the origin; iron sits ON base
// hexes so neither side is silently eliminated (noIron) when the entry composes.
// ---------------------------------------------------------------------------
function synthHex(x: number, y: number): Hex {
  return { x, y, z: -x - y };
}
const ATTACK_TARGET: Hex = synthHex(0, 0);
const ATTACK_ATTACKERS: Hex[] = [synthHex(1, 0), synthHex(2, -1), synthHex(0, 2)];
const ATTACK_DEF: Hex = synthHex(-1, 0);
const ATTACK_IRON: Hex[] = [ATTACK_ATTACKERS[0]!, ATTACK_DEF];
const ATTACK_DECL = { target: ATTACK_TARGET, attackers: ATTACK_ATTACKERS, defender: ATTACK_DEF };

function synthBase(owner: PlayerId, h: Hex, order: number): Base {
  return { owner, hex: h, state: "fresh", order };
}

/** A minimal synthetic PLAY-phase GameState where seat 0 can attack seat 1's origin base. */
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
