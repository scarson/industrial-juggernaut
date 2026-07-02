// ABOUTME: Workers-pool tests for GameRoom.rehydrate() — snapshot+tail cheap path, replayVersion freeze-on-divergence.
// ABOUTME: Continuity across evictDurableObject, agent-drive self-heal, chainAttacker reconstruction, alarm re-arm.
import { describe, expect, test } from "vitest";
import { env, runInDurableObject, evictDurableObject } from "cloudflare:test";
import type { GameRoom } from "../../src/host/game-room";
import {
  logKey,
  SNAPSHOT_KEY,
  FROZEN_KEY,
  openSession,
  applyCommand,
  replayLog,
  stateHash,
  type SessionState,
  type SessionHeader,
  type CommandCtx,
  type LogEntry,
  type Snapshot,
} from "../../src/session";
import { REPLAY_VERSION } from "../../src/host/version";
import { decodeState } from "../../src/wire/codec";
import type { ClientCommand, RoomOptions, ServerMessage } from "../../src/wire/protocol";
import { representativeFirstBase, defaultConfig, legalActions } from "../../src/index";
import { key } from "../../src/geometry/cube";
import { seed as makeSeed } from "../../src/index";
import type { Base, GameState, Hex, PlayerId, RngState } from "../../src/engine/types";

/** A fresh GameRoom stub on a unique name so each test owns its own storage. */
let counter = 0;
function freshStub(): DurableObjectStub<GameRoom> {
  const name = `recovery-test-${counter++}-${Date.now()}`;
  return env.GAME_ROOM.get(env.GAME_ROOM.idFromName(name)) as DurableObjectStub<GameRoom>;
}

const ROOM_OPTIONS_OFF: RoomOptions = { defenderTimeout: { enabled: false, seconds: 120 } };
const ROOM_OPTIONS_ON: RoomOptions = { defenderTimeout: { enabled: true, seconds: 90 } };

/** A foreign replayVersion string used to force the mismatch branch (never equals the committed REPLAY_VERSION). */
const FOREIGN_REPLAY_VERSION = "deadbeefdeadbeef";

/**
 * A header stamped with the REAL committed REPLAY_VERSION — so a snapshot written during play (which stamps
 * `header.replayVersion`) MATCHES the recovery check's `REPLAY_VERSION` and takes the cheap path. Tests that want
 * the mismatch branch overwrite the snapshot's `replayVersion` in storage AFTER play.
 */
function makeHeader(seats: SessionHeader["seats"], seedValue = 12345678901234567890n): SessionHeader {
  return {
    formatVersion: 1,
    replayVersion: REPLAY_VERSION,
    seed: seedValue,
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

/** Install a sink that captures every send channel + message into ONE flat array (order preserved). */
type Sent = { channel: "reply" | "toSeat" | "broadcast"; msg: ServerMessage };
function installCapturingSink(inst: GameRoom): Sent[] {
  const sent: Sent[] = [];
  (inst as unknown as { sink: unknown }).sink = {
    reply: (msgs: ServerMessage[]) => msgs.forEach((msg) => sent.push({ channel: "reply", msg })),
    toSeat: (_seat: number, msg: ServerMessage) => sent.push({ channel: "toSeat", msg }),
    broadcast: (msgs: ServerMessage[]) => msgs.forEach((msg) => sent.push({ channel: "broadcast", msg })),
  };
  return sent;
}

/** Read the whole stored log (index-ordered) from a room's storage. */
async function readStoredLog(storage: DurableObjectStorage): Promise<LogEntry[]> {
  const rows = await storage.list<LogEntry>({ prefix: "log:" });
  return [...rows.values()];
}

/** The current actor (PlayerId == seat) for a session's game. */
function currentActor(s: SessionState): number {
  return s.game.phase.order[s.game.phase.indexInOrder]!;
}

/**
 * Play a 2-human room to a play-phase round close so a snapshot exists: place both first bases, then the current
 * actor drives a legal single-piece `build` (a build self-closes the round → snapshot + turnRollover). Voluntary
 * `pass` is illegal in play (PASS_NOT_FORCED), so `build` is the reliable round-closer from a real init.
 */
async function playToSnapshot(stub: DurableObjectStub<GameRoom>): Promise<void> {
  await runInDurableObject(stub, async (inst: GameRoom) => {
    installCapturingSink(inst);
    const session = () => (inst as unknown as { session: SessionState }).session;
    await inst.handleCommand(
      { type: "placeFirstBase", expectedLogIndex: 0, hex: representativeFirstBase(session().game, 0) },
      mkCtx(0),
    );
    await inst.handleCommand(
      { type: "placeFirstBase", expectedLogIndex: 1, hex: representativeFirstBase(session().game, 1) },
      mkCtx(1),
    );
    // Now in play (turn 1); the current actor builds → the round closes → a snapshot is written at index 2.
    const actor = currentActor(session());
    const build = legalActions(session().game).find((a) => a.kind === "build");
    if (build === undefined || build.kind !== "build") throw new Error("playToSnapshot: expected a legal build action");
    await inst.handleCommand(
      { type: "build", expectedLogIndex: session().logLength, pieces: build.pieces } as ClientCommand,
      mkCtx(actor),
    );
  });
}

// ---------------------------------------------------------------------------
// (a) Continuity: play, evict, continue — rehydrated state == fresh replayLog over the stored log.
// ---------------------------------------------------------------------------
describe("rehydrate — continuity across eviction", () => {
  test("evict mid-game, send a new command → correct continuation; state == replayLog(stored log)", async () => {
    const stub = freshStub();
    const header = makeHeader([{ kind: "human" }, { kind: "human" }]);
    await initRoom(stub, header, ROOM_OPTIONS_OFF, ["a".repeat(64), "b".repeat(64)]);

    await playToSnapshot(stub); // log:0,1 placements + log:2 build (round close → snapshot at index 2)

    // Read the stored log while the room is still warm, then evict (drop the cache + instance).
    const storedLog = await runInDurableObject(stub, async (_inst, state) => readStoredLog(state.storage));
    expect(storedLog.length).toBe(3);
    await evictDurableObject(stub);

    // A cold wake: resync to reconstruct, inspect the state, then send a mutating continuation command.
    const { rehydratedHash, logLenAfterWake, appliedIndex } = await runInDurableObject(
      stub,
      async (inst: GameRoom) => {
        expect((inst as unknown as { session: SessionState | null }).session).toBeNull(); // cold
        const sent = installCapturingSink(inst);
        await inst.handleCommand({ type: "resync" }, mkCtx(0)); // triggers rehydrate
        const s = (inst as unknown as { session: SessionState }).session;
        const hash = stateHash(s.game);
        const idxBefore = s.logLength;
        // The current actor drives another legal build (a valid continuation).
        const actor = currentActor(s);
        const build = legalActions(s.game).find((a) => a.kind === "build");
        if (build === undefined || build.kind !== "build") throw new Error("continuity: expected a legal build");
        await inst.handleCommand(
          { type: "build", expectedLogIndex: idxBefore, pieces: build.pieces } as ClientCommand,
          mkCtx(actor),
        );
        const applied = sent.find((x) => x.msg.type === "applied");
        return {
          rehydratedHash: hash,
          logLenAfterWake: (inst as unknown as { session: SessionState }).session.logLength,
          appliedIndex: applied && applied.msg.type === "applied" ? applied.msg.logIndex : null,
        };
      },
    );

    // MECHANISM: the rehydrated game equals a fresh replay of the stored log (canonical stateHash comparison).
    const fresh = replayLog(header, storedLog);
    expect(rehydratedHash).toBe(stateHash(fresh.state));
    // The continuation command appended at the right index and advanced the log.
    expect(appliedIndex).toBe(storedLog.length);
    expect(logLenAfterWake).toBe(storedLog.length + 1);
  });
});

// ---------------------------------------------------------------------------
// (b) Agent-drive self-heal: a room evicted at an agent's turn wakes on a NON-mutating command and drives the agent.
// ---------------------------------------------------------------------------
describe("rehydrate — agent-drive self-heal", () => {
  test("evicted at the agent's setup turn → a resync wake drives the agent WITHOUT a human mutating command", async () => {
    const stub = freshStub();
    // Seat 0 human (the first setup placer), seat 1 agent (the SECOND placer).
    const header = makeHeader([{ kind: "human" }, { kind: "agent", agent: "heuristic" }]);
    await initRoom(stub, header, ROOM_OPTIONS_OFF, ["a".repeat(64), null]);

    // Fabricate the crash state: the human's log:0 landed, but the DO was evicted BEFORE driving the agent.
    // Produce the exact entry the reducer would persist (no hand-rolled rng), write ONLY it, and cold-evict.
    await runInDurableObject(stub, async (_inst: GameRoom, state) => {
      const session = openSession(header, ROOM_OPTIONS_OFF);
      const hex = representativeFirstBase(session.game, 0);
      const { effects } = applyCommand(session, { type: "placeFirstBase", expectedLogIndex: 0, hex }, mkCtx(0));
      // Persist ONLY the human's placement (no drive) — the pre-eviction storage state.
      await state.storage.put(effects.persist!.put);
      // Confirm exactly one log entry exists (log:0) and no agent entry yet.
      expect((await readStoredLog(state.storage)).length).toBe(1);
    });
    await evictDurableObject(stub);

    // A cold, NON-mutating wake: resync. rehydrate() replays log:0 → seat 1 (agent) is the placer → driveAgents.
    await runInDurableObject(stub, async (inst: GameRoom, state) => {
      expect((inst as unknown as { session: SessionState | null }).session).toBeNull();
      installCapturingSink(inst);
      await inst.handleCommand({ type: "resync" }, mkCtx(0)); // NON-mutating
      // MECHANISM: the agent's entry (log:1) now exists in storage — produced with NO human mutating command.
      const log1 = await state.storage.get<LogEntry>(logKey(1));
      expect(log1).toBeDefined();
      expect(log1!.player).toBe(1);
      expect(log1!.kind).toBe("placeFirstBase");
    });
  });
});

// ---------------------------------------------------------------------------
// (c) Cheap-path mechanism: the tail list starts at logKey(snapshot.logIndex + 1) (no pre-snapshot re-read).
// ---------------------------------------------------------------------------
describe("rehydrate — cheap path lists only the post-snapshot tail", () => {
  test("with a snapshot present, storage.list is called with start === logKey(snapshot.logIndex + 1)", async () => {
    const stub = freshStub();
    const header = makeHeader([{ kind: "human" }, { kind: "human" }]);
    await initRoom(stub, header, ROOM_OPTIONS_OFF, ["a".repeat(64), "b".repeat(64)]);
    await playToSnapshot(stub); // snapshot at logIndex 2

    const snapshotIndex = await runInDurableObject(stub, async (_inst, state) => {
      const snap = await state.storage.get<Snapshot>(SNAPSHOT_KEY);
      return snap!.logIndex;
    });
    expect(snapshotIndex).toBe(2);

    await evictDurableObject(stub);

    const logListStarts = await runInDurableObject(stub, async (inst: GameRoom, state) => {
      // Wrap storage.list to record the `start` option of every log-prefixed listing during rehydrate.
      const starts: (string | undefined)[] = [];
      const realList = state.storage.list.bind(state.storage);
      (state.storage as unknown as { list: typeof state.storage.list }).list = ((opts?: {
        prefix?: string;
        start?: string;
      }) => {
        if (opts?.prefix === "log:") starts.push(opts.start);
        return realList(opts as never);
      }) as typeof state.storage.list;

      installCapturingSink(inst);
      await inst.handleCommand({ type: "resync" }, mkCtx(0)); // triggers rehydrate
      return starts;
    });

    // MECHANISM: the ONLY log listing during rehydrate starts at the post-snapshot index — no full-log re-read.
    expect(logListStarts).toEqual([logKey(snapshotIndex + 1)]);
  });
});

// ---------------------------------------------------------------------------
// (d) replayVersion MISMATCH + snapshot-hash MATCH + EMPTY tail → continues (not frozen).
// ---------------------------------------------------------------------------
describe("rehydrate — version mismatch, hash matches, empty tail → continue", () => {
  test("a snapshot with a different replayVersion but a correct stateHash and no tail → not frozen, play continues", async () => {
    const stub = freshStub();
    const header = makeHeader([{ kind: "human" }, { kind: "human" }]);
    await initRoom(stub, header, ROOM_OPTIONS_OFF, ["a".repeat(64), "b".repeat(64)]);
    await playToSnapshot(stub); // snapshot at logIndex 2, tail EMPTY (log ends at index 2)

    // Overwrite ONLY the snapshot's replayVersion to a foreign string; keep the (correct) stateHash.
    await runInDurableObject(stub, async (_inst, state) => {
      const snap = (await state.storage.get<Snapshot>(SNAPSHOT_KEY))!;
      await state.storage.put(SNAPSHOT_KEY, { ...snap, replayVersion: FOREIGN_REPLAY_VERSION });
    });
    await evictDurableObject(stub);

    const { frozenFlag, appliedAfterWake } = await runInDurableObject(stub, async (inst: GameRoom, state) => {
      const sent = installCapturingSink(inst);
      expect((inst as unknown as { session: SessionState | null }).session).toBeNull();
      // A mutating command after a MATCHING re-replay must be accepted (not frozen).
      await inst.handleCommand({ type: "resync" }, mkCtx(0)); // rehydrate
      const s = (inst as unknown as { session: SessionState }).session;
      const actor = currentActor(s);
      const build = legalActions(s.game).find((a) => a.kind === "build");
      if (build === undefined || build.kind !== "build") throw new Error("continue-case: expected a legal build");
      await inst.handleCommand(
        { type: "build", expectedLogIndex: s.logLength, pieces: build.pieces } as ClientCommand,
        mkCtx(actor),
      );
      return {
        frozenFlag: await state.storage.get<boolean>(FROZEN_KEY),
        appliedAfterWake: sent.some((x) => x.msg.type === "applied"),
      };
    });

    expect(frozenFlag).not.toBe(true); // NOT frozen
    expect(appliedAfterWake).toBe(true); // the mutating command was accepted
  });
});

// ---------------------------------------------------------------------------
// (e) replayVersion MISMATCH + snapshot-hash DIVERGES → freeze; mutating → FROZEN; resync still answered.
// ---------------------------------------------------------------------------
describe("rehydrate — version mismatch, hash diverges → freeze", () => {
  test("a snapshot with a wrong stateHash + foreign replayVersion → room freezes; mutating → FROZEN, resync OK", async () => {
    const stub = freshStub();
    const header = makeHeader([{ kind: "human" }, { kind: "human" }]);
    await initRoom(stub, header, ROOM_OPTIONS_OFF, ["a".repeat(64), "b".repeat(64)]);
    await playToSnapshot(stub);

    // Corrupt the snapshot: a WRONG stateHash under a foreign replayVersion → the re-replay hash diverges.
    await runInDurableObject(stub, async (_inst, state) => {
      const snap = (await state.storage.get<Snapshot>(SNAPSHOT_KEY))!;
      await state.storage.put(SNAPSHOT_KEY, {
        ...snap,
        replayVersion: FOREIGN_REPLAY_VERSION,
        stateHash: "0000000000000000",
      });
    });
    await evictDurableObject(stub);

    const { frozenFlag, sawFrozenError, resyncAnswered, logLenBefore, logLenAfter } = await runInDurableObject(
      stub,
      async (inst: GameRoom, state) => {
        const sent = installCapturingSink(inst);
        await inst.handleCommand({ type: "resync" }, mkCtx(0)); // rehydrate → freeze
        const s = (inst as unknown as { session: SessionState }).session;
        const before = (await readStoredLog(state.storage)).length;
        const actor = currentActor(s);
        // A mutating command on a frozen room → FROZEN error (via the sink), NO new log entry.
        const build = legalActions(s.game).find((a) => a.kind === "build");
        const mutating: ClientCommand =
          build !== undefined && build.kind === "build"
            ? ({ type: "build", expectedLogIndex: s.logLength, pieces: build.pieces } as ClientCommand)
            : { type: "endRound", expectedLogIndex: s.logLength };
        await inst.handleCommand(mutating, mkCtx(actor));
        const after = (await readStoredLog(state.storage)).length;
        // Non-mutating resync is still answered even on a frozen room.
        const beforeResyncCount = sent.filter((x) => x.msg.type === "resync").length;
        await inst.handleCommand({ type: "resync" }, mkCtx(0));
        const afterResyncCount = sent.filter((x) => x.msg.type === "resync").length;
        return {
          frozenFlag: await state.storage.get<boolean>(FROZEN_KEY),
          sawFrozenError: sent.some((x) => x.msg.type === "error" && x.msg.code === "FROZEN"),
          resyncAnswered: afterResyncCount > beforeResyncCount,
          logLenBefore: before,
          logLenAfter: after,
        };
      },
    );

    expect(frozenFlag).toBe(true); // persisted freeze
    expect(sawFrozenError).toBe(true); // the mutating command got FROZEN
    expect(logLenAfter).toBe(logLenBefore); // no entry appended on a frozen room
    expect(resyncAnswered).toBe(true); // resync still works
  });
});

// ---------------------------------------------------------------------------
// (f) replayVersion MISMATCH + snapshot-hash MATCH + NON-EMPTY tail → freeze (the tail is unverifiable).
// ---------------------------------------------------------------------------
describe("rehydrate — version mismatch, hash matches, non-empty tail → freeze", () => {
  test("snapshot ok but tail entries exist past it → freeze (no per-entry hash to verify the tail)", async () => {
    const stub = freshStub();
    const header = makeHeader([{ kind: "human" }, { kind: "human" }]);
    await initRoom(stub, header, ROOM_OPTIONS_OFF, ["a".repeat(64), "b".repeat(64)]);

    // Play a real 2-human game past ONE round boundary: 2 placements + 2 builds → log 0..3, the latest snapshot at
    // index 3. Every round-closing play action re-snapshots, so a natural non-empty tail is not reachable this early
    // (only an open attack chain leaves an entry past a snapshot, and that needs 6+ fresh bases). Instead we repoint
    // the stored snapshot to the EARLIER real boundary at index 2 (a genuine round close, with its correct hash
    // computed from the same header + stored log), leaving entry index 3 as a genuine, unverifiable post-snapshot
    // tail. This isolates the freeze cause to the tail: the snapshot-boundary re-replay MATCHES its stored hash.
    await runInDurableObject(stub, async (inst: GameRoom) => {
      installCapturingSink(inst);
      const S = () => (inst as unknown as { session: SessionState }).session;
      await inst.handleCommand(
        { type: "placeFirstBase", expectedLogIndex: 0, hex: representativeFirstBase(S().game, 0) },
        mkCtx(0),
      );
      await inst.handleCommand(
        { type: "placeFirstBase", expectedLogIndex: 1, hex: representativeFirstBase(S().game, 1) },
        mkCtx(1),
      );
      for (let i = 0; i < 2; i++) {
        const actor = currentActor(S());
        const build = legalActions(S().game).find((a) => a.kind === "build");
        if (build === undefined || build.kind !== "build") throw new Error("tail-case: expected a legal build");
        await inst.handleCommand(
          { type: "build", expectedLogIndex: S().logLength, pieces: build.pieces } as ClientCommand,
          mkCtx(actor),
        );
      }
    });

    const storedLog = await runInDurableObject(stub, async (_inst, state) => readStoredLog(state.storage));
    expect(storedLog.length).toBe(4); // place@0, place@1, build@2, build@3

    // Repoint the snapshot to the real round boundary at index 2 with its correct hash (recomputed from the header +
    // log[0..2]) and a FOREIGN replayVersion. Now the tail past the snapshot is [entry@3] — non-empty, unverifiable.
    const boundaryState = replayLog(header, storedLog.slice(0, 3)).state; // entries 0,1,2 inclusive
    await runInDurableObject(stub, async (_inst, state) => {
      const snapshot: Snapshot = {
        state: boundaryState,
        logIndex: 2,
        stateHash: stateHash(boundaryState),
        replayVersion: FOREIGN_REPLAY_VERSION,
      };
      await state.storage.put(SNAPSHOT_KEY, snapshot);
    });
    await evictDurableObject(stub);

    const frozenFlag = await runInDurableObject(stub, async (inst: GameRoom, state) => {
      installCapturingSink(inst);
      await inst.handleCommand({ type: "resync" }, mkCtx(0)); // rehydrate → freeze (tail unverifiable)
      return state.storage.get<boolean>(FROZEN_KEY);
    });

    expect(frozenFlag).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (g) chainAttacker derivation: an open attack chain survives eviction — the attacker can still endRound.
// ---------------------------------------------------------------------------
describe("rehydrate — chainAttacker reconstructed from the last log entry", () => {
  test("an open attack chain (last entry is attack) survives eviction: attacker endRound OK, other seat NOT_YOUR_TURN", async () => {
    const stub = freshStub();
    // Two humans so a human-vs-human attack leaves the chain OPEN (agent defenders auto-close).
    const header = makeHeader([{ kind: "human" }, { kind: "human" }]);
    await initRoom(stub, header, ROOM_OPTIONS_ON, ["a".repeat(64), "b".repeat(64)]);

    // The open-chain position needs 6+ fresh bases + two opponent targets — unreachable from a real short game — so
    // we inject a synthetic PLAY state. For it to SURVIVE eviction (rehydrate rebuilds ONLY from storage), the synth
    // state is captured as a round-boundary SNAPSHOT (at logIndex 0, its correct stateHash, the committed
    // REPLAY_VERSION so recovery takes the cheap path) and the open attack rides as the post-snapshot TAIL at index 1.
    // On wake, rehydrate installs snapshot.state and applies the attack tail → the open chain (chainAttacker == 0).
    const synthGame = openChainAttackGame();
    // Run the attack + defender resolution ONCE to capture the EXACT attack LogEntry the reducer persists (its
    // rngBeforeApply is the pre-decision rng — hand-rolling it would drift from the real replay).
    let attackEntry: LogEntry | null = null;
    await runInDurableObject(stub, async (inst: GameRoom, state) => {
      const base = (inst as unknown as { session: SessionState }).session;
      (inst as unknown as { session: SessionState }).session = {
        ...base,
        game: synthGame,
        logLength: 0,
        chainAttacker: null,
      };
      installCapturingSink(inst);
      await inst.handleCommand({ type: "attack", expectedLogIndex: 0, decl: OPEN_CHAIN_DECL }, mkCtx(0));
      const s1 = (inst as unknown as { session: SessionState }).session;
      const pending = s1.pending!;
      expect(pending.promptedSeat).toBe(1);
      await inst.handleCommand(
        { type: "resolveDecision", expectedLogIndex: 0, decisionId: pending.decisionId, defender: OPEN_CHAIN_DECL.defender },
        mkCtx(1),
      );
      const s2 = (inst as unknown as { session: SessionState }).session;
      expect(s2.chainAttacker).toBe(0); // chain stayed OPEN — the attacker keeps a second legal attack
      attackEntry = (await state.storage.get<LogEntry>(logKey(0)))!; // the persisted attack (at index 0 here)
      expect(attackEntry.kind).toBe("attack");
    });

    // Rebuild storage to the crash shape: a snapshot of the synth PRE-attack state at logIndex 0 + the attack as the
    // sole post-snapshot tail entry at index 1. rehydrate then installs the snapshot and applies the attack tail.
    await runInDurableObject(stub, async (_inst, state) => {
      // Drop the ad-hoc log:000000 written above; re-lay the attack at index 1 with a preceding snapshot at index 0.
      await state.storage.delete(logKey(0));
      const snapshot: Snapshot = {
        state: synthGame,
        logIndex: 0,
        stateHash: stateHash(synthGame),
        replayVersion: REPLAY_VERSION,
      };
      await state.storage.put({ [SNAPSHOT_KEY]: snapshot, [logKey(1)]: attackEntry! });
    });

    await evictDurableObject(stub);

    const { reconstructedChain, otherSeatError, attackerEndRoundApplied } = await runInDurableObject(
      stub,
      async (inst: GameRoom) => {
        installCapturingSink(inst);
        await inst.handleCommand({ type: "resync" }, mkCtx(0)); // rehydrate → chainAttacker reconstructed from log
        const s = (inst as unknown as { session: SessionState }).session;
        const chain = s.chainAttacker;

        // Seat 1's endRound → NOT_YOUR_TURN (the chain belongs to seat 0).
        const otherSent = installCapturingSink(inst);
        await inst.handleCommand({ type: "endRound", expectedLogIndex: s.logLength }, mkCtx(1));
        const otherErr = otherSent.find((x) => x.msg.type === "error");

        // Seat 0's endRound closes its own chain → an applied entry.
        const attackerSent = installCapturingSink(inst);
        await inst.handleCommand({ type: "endRound", expectedLogIndex: s.logLength }, mkCtx(0));
        const applied = attackerSent.some((x) => x.msg.type === "applied");
        return {
          reconstructedChain: chain,
          otherSeatError: otherErr && otherErr.msg.type === "error" ? otherErr.msg.code : null,
          attackerEndRoundApplied: applied,
        };
      },
    );

    expect(reconstructedChain).toBe(0); // MECHANISM: reconstructed from the last (attack) log entry
    expect(otherSeatError).toBe("NOT_YOUR_TURN"); // the other seat cannot end the attacker's chain
    expect(attackerEndRoundApplied).toBe(true); // the attacker's endRound survived eviction and applied
  });
});

// ---------------------------------------------------------------------------
// (h) Alarm re-arm: a timeout-ON room with a live pending re-arms the alarm to the pending's deadline on wake.
// ---------------------------------------------------------------------------
describe("rehydrate — alarm self-heal from the live pending deadline", () => {
  test("a timeout-ON room with a live pending, evicted → wake re-arms getAlarm() to the pending's deadline", async () => {
    const stub = freshStub();
    const header = makeHeader([{ kind: "human" }, { kind: "human" }]);
    await initRoom(stub, header, ROOM_OPTIONS_ON, ["a".repeat(64), "b".repeat(64)]);

    // Open a pending (seat 0 attacks seat 1's human base) so a deadline + alarm are armed, then read the deadline.
    const deadline = await runInDurableObject(stub, async (inst: GameRoom) => {
      const base = (inst as unknown as { session: SessionState }).session;
      (inst as unknown as { session: SessionState }).session = {
        ...base,
        game: openChainAttackGame(),
        logLength: 0,
        chainAttacker: null,
      };
      installCapturingSink(inst);
      await inst.handleCommand({ type: "attack", expectedLogIndex: 0, decl: OPEN_CHAIN_DECL }, mkCtx(0));
      const s = (inst as unknown as { session: SessionState }).session;
      return s.pending!.deadlineEpochMs!;
    });
    expect(typeof deadline).toBe("number");

    await evictDurableObject(stub);

    const alarmAfterWake = await runInDurableObject(stub, async (inst: GameRoom, state) => {
      // Clear any alarm carried by storage so we prove the WAKE re-arms it (not a leftover).
      await state.storage.deleteAlarm();
      expect(await state.storage.getAlarm()).toBeNull();
      installCapturingSink(inst);
      await inst.handleCommand({ type: "resync" }, mkCtx(0)); // rehydrate → re-arm the alarm from pending.deadlineEpochMs
      return state.storage.getAlarm();
    });

    // MECHANISM: the alarm is re-armed to the EXACT pending deadline.
    expect(alarmAfterWake).toBe(deadline);
  });
});

// ---------------------------------------------------------------------------
// Hardening: a THROWING replay must freeze cleanly (not brick the room), and a frozen room whose log cannot
// replay must still serve its best-available state so resync / the replay viewer keep working.
// ---------------------------------------------------------------------------
describe("rehydrate — a throwing boundary re-replay freezes cleanly (no unmarked brick)", () => {
  test("mismatched version + a boundary entry the engine rejects → wake completes, frozen, FROZEN reply, resync answered", async () => {
    const stub = freshStub();
    const header = makeHeader([{ kind: "human" }, { kind: "human" }]);
    await initRoom(stub, header, ROOM_OPTIONS_OFF, ["a".repeat(64), "b".repeat(64)]);
    await playToSnapshot(stub); // log 0..2, snapshot@2

    // Corrupt the BOUNDARY log so the mismatch re-replay THROWS: overwrite log:1 (the second placement) to place
    // on log:0's hex — placeFirstBase throws "hex is already occupied", standing in for a bumped engine that now
    // rejects a previously-legal entry. Stamp a foreign replayVersion so the mismatch path runs (the re-replay
    // throws BEFORE any hash comparison, so the stored stateHash is irrelevant here).
    await runInDurableObject(stub, async (_inst, state) => {
      const e0 = (await state.storage.get<LogEntry>(logKey(0))) as Extract<LogEntry, { kind: "placeFirstBase" }>;
      const e1 = (await state.storage.get<LogEntry>(logKey(1))) as Extract<LogEntry, { kind: "placeFirstBase" }>;
      expect(e0.kind).toBe("placeFirstBase");
      expect(e1.kind).toBe("placeFirstBase");
      const snap = (await state.storage.get<Snapshot>(SNAPSHOT_KEY))!;
      await state.storage.put({
        [logKey(1)]: { ...e1, hex: e0.hex },
        [SNAPSHOT_KEY]: { ...snap, replayVersion: FOREIGN_REPLAY_VERSION },
      });
    });
    await evictDurableObject(stub);

    const { frozenFlag, resyncAnswered, sawFrozen } = await runInDurableObject(stub, async (inst: GameRoom, state) => {
      const sent = installCapturingSink(inst);
      // The wake MUST complete — an uncaught throw here is the unmarked-brick regression (rehydrate re-throwing
      // on every wake with the room never marked frozen).
      await inst.handleCommand({ type: "resync" }, mkCtx(0));
      const flag = await state.storage.get<boolean>(FROZEN_KEY);
      const s = (inst as unknown as { session: SessionState }).session;
      // Any mutating command → FROZEN from the HOST interception (before the reducer would say NOT_YOUR_TURN).
      await inst.handleCommand({ type: "endRound", expectedLogIndex: s.logLength }, mkCtx(0));
      return {
        frozenFlag: flag,
        resyncAnswered: sent.some((x) => x.msg.type === "resync"),
        sawFrozen: sent.some((x) => x.msg.type === "error" && x.msg.code === "FROZEN"),
      };
    });

    expect(frozenFlag).toBe(true); // writeFrozen COMMITTED despite the throwing re-replay
    expect(resyncAnswered).toBe(true); // the frozen room still answers resync
    expect(sawFrozen).toBe(true); // mutating command → FROZEN
  });
});

describe("rehydrate — a frozen room with an unreplayable log serves best-available state", () => {
  test("snapshot case: a throwing TAIL entry → frozen, resync carries the stored snapshot.state", async () => {
    const stub = freshStub();
    const header = makeHeader([{ kind: "human" }, { kind: "human" }]);
    await initRoom(stub, header, ROOM_OPTIONS_OFF, ["a".repeat(64), "b".repeat(64)]);
    await playToSnapshot(stub); // log 0..2, snapshot@2 (correct stateHash)

    // Append a TAIL entry the current engine REJECTS at apply: a placeFirstBase in PLAY phase always throws
    // ("not in setup phase") — standing in for a tail recorded under an engine whose semantics changed. Keep the
    // snapshot's CORRECT stateHash so the freeze comes from the unverifiable tail, and the rebuild throw is
    // exercised on a room that froze the "hash matches, tail non-empty" way.
    await runInDurableObject(stub, async (_inst, state) => {
      const snap = (await state.storage.get<Snapshot>(SNAPSHOT_KEY))!;
      const throwing: LogEntry = { player: 0, kind: "placeFirstBase", hex: H(0, 0), rngBeforeApply: makeSeed(1n) };
      await state.storage.put({
        [logKey(3)]: throwing,
        [SNAPSHOT_KEY]: { ...snap, replayVersion: FOREIGN_REPLAY_VERSION },
      });
    });
    await evictDurableObject(stub);

    const { frozenFlag, servedHash, storedHash, resyncLogLength } = await runInDurableObject(
      stub,
      async (inst: GameRoom, state) => {
        const sent = installCapturingSink(inst);
        await inst.handleCommand({ type: "resync" }, mkCtx(0)); // the wake MUST complete
        const resync = sent.find((x) => x.msg.type === "resync");
        const snap = (await state.storage.get<Snapshot>(SNAPSHOT_KEY))!;
        return {
          frozenFlag: await state.storage.get<boolean>(FROZEN_KEY),
          servedHash: resync && resync.msg.type === "resync" ? stateHash(decodeState(resync.msg.snapshot)) : null,
          storedHash: stateHash(snap.state),
          resyncLogLength: resync && resync.msg.type === "resync" ? resync.msg.logLength : null,
        };
      },
    );

    expect(frozenFlag).toBe(true);
    // MECHANISM: the resync payload's state IS the stored snapshot.state (the best-available state) — the raw
    // stored log remains the authoritative record for the replay viewer.
    expect(servedHash).toBe(storedHash);
    expect(resyncLogLength).toBe(3); // self-consistent with the served state (the snapshot covers entries 0..2)
  });

  test("no-snapshot case: a throwing log under a mismatched header → frozen, resync carries the initial state", async () => {
    const stub = freshStub();
    // The header itself carries a foreign replayVersion (the room was created under an older engine; no snapshot
    // was ever written). The room's only log entry does not apply under the current engine.
    const header: SessionHeader = {
      ...makeHeader([{ kind: "human" }, { kind: "human" }]),
      replayVersion: FOREIGN_REPLAY_VERSION,
    };
    await initRoom(stub, header, ROOM_OPTIONS_OFF, ["a".repeat(64), "b".repeat(64)]);

    // One throwing entry: an off-board hex → placeFirstBase throws "hex is not on the board".
    await runInDurableObject(stub, async (_inst, state) => {
      const throwing: LogEntry = {
        player: 0,
        kind: "placeFirstBase",
        hex: { x: 999, y: 999, z: -1998 },
        rngBeforeApply: makeSeed(1n),
      };
      await state.storage.put(logKey(0), throwing);
    });
    await evictDurableObject(stub);

    const { frozenFlag, servedHash, resyncLogLength } = await runInDurableObject(stub, async (inst: GameRoom, state) => {
      const sent = installCapturingSink(inst);
      await inst.handleCommand({ type: "resync" }, mkCtx(0)); // the wake MUST complete
      const resync = sent.find((x) => x.msg.type === "resync");
      return {
        frozenFlag: await state.storage.get<boolean>(FROZEN_KEY),
        servedHash: resync && resync.msg.type === "resync" ? stateHash(decodeState(resync.msg.snapshot)) : null,
        resyncLogLength: resync && resync.msg.type === "resync" ? resync.msg.logLength : null,
      };
    });

    expect(frozenFlag).toBe(true);
    // Best-available state with no snapshot = the deterministic openSession initial state.
    expect(servedHash).toBe(stateHash(openSession(header, ROOM_OPTIONS_OFF).game));
    expect(resyncLogLength).toBe(0); // self-consistent: the served state reflects zero applied entries
  });
});

// ---------------------------------------------------------------------------
// Synthetic PLAY-phase position where the attacker keeps a SECOND legal attack after the first, so a
// human-vs-human attack resolution leaves the round OPEN (chainAttacker set, last log entry `attack`).
// Seat 1 owns four bases in two separated clusters; seat 0 owns six fresh bases split to reach each cluster.
// Iron sits on every base hex so no side is silently eliminated (noIron) when the entry composes.
// ---------------------------------------------------------------------------
function H(x: number, y: number): Hex {
  return { x, y, z: -x - y };
}
const OPEN_CHAIN_TARGET: Hex = H(-4, 0);
const OPEN_CHAIN_ATTACKERS: Hex[] = [H(-2, -1), H(-2, 0), H(-3, 1)];
const OPEN_CHAIN_DEFENDER: Hex = H(-5, 0);
const OPEN_CHAIN_DECL = {
  target: OPEN_CHAIN_TARGET,
  attackers: OPEN_CHAIN_ATTACKERS,
  defender: OPEN_CHAIN_DEFENDER,
};

const DEF_BASE_HEXES: Hex[] = [H(-4, 0), H(-5, 0), H(4, 0), H(5, 0)];
const ATTACKER_BASE_HEXES: Hex[] = [H(-2, 0), H(-3, 1), H(-2, -1), H(2, 0), H(3, -1), H(2, 1)];

function synthBase(owner: PlayerId, h: Hex, order: number): Base {
  return { owner, hex: h, state: "fresh", order };
}

function openChainAttackGame(): GameState {
  const seen = new Set<string>();
  const hexes: Hex[] = [];
  for (let x = -10; x <= 10; x++) {
    for (let y = -10; y <= 10; y++) {
      const h = H(x, y);
      if (Math.abs(h.z) <= 10 && !seen.has(key(h))) {
        seen.add(key(h));
        hexes.push(h);
      }
    }
  }
  const bases: Base[] = [
    ...DEF_BASE_HEXES.map((h, i) => synthBase(1, h, i)),
    ...ATTACKER_BASE_HEXES.map((h, i) => synthBase(0, h, DEF_BASE_HEXES.length + i)),
  ];
  const iron: Hex[] = [...DEF_BASE_HEXES, ...ATTACKER_BASE_HEXES];
  const rng: RngState = makeSeed(1n);
  return {
    board: { hexes, iron },
    bases,
    factories: [],
    players: Array.from({ length: 2 }, (_, id) => ({ id, basesInHand: 6, alliance: [id], eliminated: false })),
    phase: { turn: 3, order: [0, 1], indexInOrder: 0 },
    factorySupply: 36,
    config: defaultConfig(),
    rngState: rng,
  };
}
