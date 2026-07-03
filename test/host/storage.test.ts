// ABOUTME: Workers-pool tests for the DO storage layer — atomic persistEvent, header bundle, snapshot/tail load.
// ABOUTME: Reaches a real ctx.storage via runInDurableObject's state arg; proves bigints survive raw structured clone.
import { describe, expect, test } from "vitest";
import { env, runInDurableObject } from "cloudflare:test";
import {
  writeHeader,
  readInitialized,
  readHeaderBundle,
  readPending,
  readFrozen,
  writeFrozen,
  persistEvent,
  loadSnapshotAndTail,
} from "../../src/host/storage";
import {
  logKey,
  PENDING_KEY,
  SNAPSHOT_KEY,
  PENDING_TOMBSTONE,
  type LogEntry,
  type Pending,
  type SessionHeader,
  type Snapshot,
} from "../../src/session";
import { defaultConfig, seed, type GameState, type RngState } from "../../src/index";

/** A fresh GameRoom stub on a unique name so each test owns its own storage. */
let counter = 0;
function freshStub() {
  const name = `storage-test-${counter++}-${Date.now()}`;
  return env.GAME_ROOM.get(env.GAME_ROOM.idFromName(name));
}

/** A real SessionHeader with a bigint seed and a mix of human/agent seats. */
function makeHeader(seedValue: bigint): SessionHeader {
  return {
    formatVersion: 1,
    replayVersion: "test-replay-version",
    seed: seedValue,
    config: defaultConfig(),
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    seats: [
      { kind: "human" },
      { kind: "agent", agent: "heuristic" },
      { kind: "agent", agent: "greedy", archetype: "aggressive" },
    ],
  };
}

/** A real RngState carrying bigints — the load-bearing structured-clone payload. */
function makeRng(state: bigint): RngState {
  return seed(state, 54n);
}

/** A real attack LogEntry whose rngBeforeApply carries bigints. */
function makeAttackEntry(player: number, rngState: bigint): LogEntry {
  return {
    player,
    kind: "attack",
    decl: { target: { x: 0, y: 0, z: 0 }, attackers: [{ x: 1, y: -1, z: 0 }], defender: { x: 0, y: 0, z: 0 } },
    rngBeforeApply: makeRng(rngState),
  };
}

function makePending(rngState: bigint, deadline: number | null): Pending {
  return {
    decisionId: "decision-abc",
    kind: "defenderChoice",
    round: 3,
    declaringPlayer: 0,
    promptedSeat: 1,
    proposed: { target: { x: 0, y: 0, z: 0 }, attackers: [{ x: 1, y: -1, z: 0 }], defender: { x: 0, y: 0, z: 0 } },
    preDecisionLogLength: 7,
    rngBeforeApply: makeRng(rngState),
    deadlineEpochMs: deadline,
  };
}

/** A minimal but real Snapshot with a GameState that carries a bigint-bearing rngState. */
function makeSnapshot(logIndex: number, rngState: bigint): Snapshot {
  const game = { rngState: makeRng(rngState) } as unknown as GameState;
  return { state: game, logIndex, stateHash: "hash-xyz", replayVersion: "test-replay-version" };
}

describe("writeHeader + readHeaderBundle (bigint seed survives raw structured clone)", () => {
  test("header bundle round-trips with bigint seed identity, config/seats deep-equal, digests aligned", async () => {
    const stub = freshStub();
    const bigSeed = 12345678901234567890n;
    const header = makeHeader(bigSeed);
    const roomOptions = { defenderTimeout: { enabled: true, seconds: 90 } };
    const digests = ["deadbeef".repeat(8), null, null];

    await runInDurableObject(stub, async (_inst, state) => {
      await writeHeader(state.storage, { header, roomOptions, authorizedDigests: digests, initialized: true });
      const bundle = await readHeaderBundle(state.storage);
      expect(bundle).not.toBeNull();

      // THE load-bearing assertion: the seed is a native bigint, identical value — no codec on this path.
      expect(typeof bundle!.header.seed).toBe("bigint");
      expect(bundle!.header.seed).toBe(bigSeed);

      expect(bundle!.header.config).toEqual(defaultConfig());
      expect(bundle!.header.seats).toEqual(header.seats);
      expect(bundle!.header.replayVersion).toBe("test-replay-version");
      expect(bundle!.roomOptions).toEqual(roomOptions);
      expect(bundle!.authorizedDigests).toEqual(digests);
    });
  });
});

describe("readInitialized", () => {
  test("false before writeHeader, true after", async () => {
    const stub = freshStub();
    await runInDurableObject(stub, async (_inst, state) => {
      expect(await readInitialized(state.storage)).toBe(false);
      await writeHeader(state.storage, {
        header: makeHeader(1n),
        roomOptions: { defenderTimeout: { enabled: false, seconds: 120 } },
        authorizedDigests: [null, null, null],
        initialized: true,
      });
      expect(await readInitialized(state.storage)).toBe(true);
    });
  });
});

describe("persistEvent — one atomic multi-key put", () => {
  test("an op carrying BOTH logKey(N) and PENDING_KEY:tombstone lands both from ONE put (entry present, pending null)", async () => {
    const stub = freshStub();
    const entry = makeAttackEntry(0, 111n);
    await runInDurableObject(stub, async (_inst, state) => {
      // Seed a live pending first so the tombstone has something to clear.
      await state.storage.put(PENDING_KEY, makePending(999n, 12345));
      expect(await readPending(state.storage)).not.toBeNull();

      // The mechanism: the resolving entry AND the pending clear ride in ONE put.
      await persistEvent(state.storage, { put: { [logKey(5)]: entry, [PENDING_KEY]: PENDING_TOMBSTONE } });

      // Both landed: the entry reads back with bigint identity...
      const stored = await state.storage.get<LogEntry>(logKey(5));
      expect(stored).toBeDefined();
      expect(stored!.kind).toBe("attack");
      expect(typeof stored!.rngBeforeApply.state).toBe("bigint");
      expect(stored!.rngBeforeApply.state).toBe(entry.rngBeforeApply.state);
      expect(stored!.rngBeforeApply.inc).toBe(entry.rngBeforeApply.inc);

      // ...and the pending is cleared (tombstone maps to null).
      expect(await readPending(state.storage)).toBeNull();
    });
  });

  test("a pending WRITE round-trips bigint-intact via readPending", async () => {
    const stub = freshStub();
    const pending = makePending(424242n, 98765);
    await runInDurableObject(stub, async (_inst, state) => {
      await persistEvent(state.storage, { put: { [PENDING_KEY]: pending } });
      const back = await readPending(state.storage);
      expect(back).not.toBeNull();
      expect(back!.decisionId).toBe("decision-abc");
      expect(typeof back!.rngBeforeApply.state).toBe("bigint");
      expect(back!.rngBeforeApply.state).toBe(pending.rngBeforeApply.state);
      expect(back!.rngBeforeApply.inc).toBe(pending.rngBeforeApply.inc);
      expect(back!.deadlineEpochMs).toBe(98765);
    });
  });

  test("readPending returns null for an absent value (no pending written)", async () => {
    const stub = freshStub();
    await runInDurableObject(stub, async (_inst, state) => {
      expect(await readPending(state.storage)).toBeNull();
    });
  });
});

describe("loadSnapshotAndTail", () => {
  test("snapshot at logIndex 2 + log:0..4 → tail is exactly indices 3,4 in order with correct entries", async () => {
    const stub = freshStub();
    await runInDurableObject(stub, async (_inst, state) => {
      const entries: LogEntry[] = [0, 1, 2, 3, 4].map((i) => makeAttackEntry(i % 3, BigInt(1000 + i)));
      const put: Record<string, unknown> = {};
      for (let i = 0; i < 5; i++) put[logKey(i)] = entries[i];
      put[SNAPSHOT_KEY] = makeSnapshot(2, 777n);
      await state.storage.put(put);

      const { snapshot, tail } = await loadSnapshotAndTail(state.storage);
      expect(snapshot).not.toBeNull();
      expect(snapshot!.logIndex).toBe(2);
      // The snapshot's own bigint-bearing rngState survives raw.
      expect(typeof snapshot!.state.rngState.state).toBe("bigint");

      // Tail is exactly the post-snapshot entries, in order, with their true indices.
      expect(tail.map((t) => t.index)).toEqual([3, 4]);
      expect(tail[0]!.entry.rngBeforeApply.state).toBe(entries[3]!.rngBeforeApply.state);
      expect(tail[1]!.entry.rngBeforeApply.state).toBe(entries[4]!.rngBeforeApply.state);
      expect(typeof tail[0]!.entry.rngBeforeApply.state).toBe("bigint");
    });
  });

  test("no snapshot → full log as tail starting from index 0", async () => {
    const stub = freshStub();
    await runInDurableObject(stub, async (_inst, state) => {
      const entries: LogEntry[] = [0, 1, 2].map((i) => makeAttackEntry(i, BigInt(2000 + i)));
      const put: Record<string, unknown> = {};
      for (let i = 0; i < 3; i++) put[logKey(i)] = entries[i];
      await state.storage.put(put);

      const { snapshot, tail } = await loadSnapshotAndTail(state.storage);
      expect(snapshot).toBeNull();
      expect(tail.map((t) => t.index)).toEqual([0, 1, 2]);
      expect(tail[2]!.entry.rngBeforeApply.state).toBe(entries[2]!.rngBeforeApply.state);
    });
  });

  test("empty storage → { snapshot: null, tail: [] }", async () => {
    const stub = freshStub();
    await runInDurableObject(stub, async (_inst, state) => {
      const { snapshot, tail } = await loadSnapshotAndTail(state.storage);
      expect(snapshot).toBeNull();
      expect(tail).toEqual([]);
    });
  });
});

describe("frozen flag", () => {
  test("readFrozen false before, true after writeFrozen", async () => {
    const stub = freshStub();
    await runInDurableObject(stub, async (_inst, state) => {
      expect(await readFrozen(state.storage)).toBe(false);
      await writeFrozen(state.storage);
      expect(await readFrozen(state.storage)).toBe(true);
    });
  });
});
