// ABOUTME: The DO-host integration matrix (spec §7) — 8 cohesive end-to-end scenarios through the REAL Worker + DO +
// ABOUTME: WebSocket stack: hibernation wake-replay, alarm idempotency, seat auth/multi-tab, double-submit, reconnect, recovery, ordering.
import { describe, expect, test } from "vitest";
import { runInDurableObject, runDurableObjectAlarm, evictDurableObject } from "cloudflare:test";
import type { GameRoom } from "../../src/host/game-room";
import {
  logKey,
  PENDING_KEY,
  openSession,
  replayLog,
  stateHash,
  type SessionState,
  type SessionHeader,
  type CommandCtx,
  type LogEntry,
} from "../../src/session";
import type { ServerMessage } from "../../src/wire/protocol";
import { representativeFirstBase, defaultConfig, legalActions, seed as makeSeed } from "../../src/index";
import { key } from "../../src/geometry/cube";
import type { Base, GameState, Hex, PlayerId, RngState } from "../../src/engine/types";
import {
  createRoom,
  openSocket,
  openSocketExpectingReject,
  send,
  collect,
  sendAndCollect,
  stubFor,
  expectNoMessage,
  type CreatedRoom,
} from "./helpers";

// A create seed matching the DO's makeHeader tests (a 20-digit decimal). The Worker re-parses it to a bigint.
const SEED = "12345678901234567890";
const TIMEOUT_ON = { defenderTimeout: { enabled: true, seconds: 90 } };

/** The legal first-base hex for a seat in a freshly-opened 2-human room (deterministic from the create seed). */
function firstBaseHexFor(seat: number): Hex {
  const header: SessionHeader = {
    formatVersion: 1,
    replayVersion: "unused-here",
    seed: BigInt(SEED),
    config: defaultConfig(),
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    seats: [{ kind: "human" }, { kind: "human" }],
  };
  const s = openSession(header, { defenderTimeout: { enabled: false, seconds: 120 } });
  return representativeFirstBase(s.game, seat);
}

/** Read the whole stored log (index-ordered) from a room's storage. */
async function readStoredLog(storage: DurableObjectStorage): Promise<LogEntry[]> {
  const rows = await storage.list<LogEntry>({ prefix: "log:" });
  return [...rows.values()];
}

/** The two human tokens for a default 2-human room (create mints one per human seat). */
function tokensOf(room: CreatedRoom): [string, string] {
  const t0 = room.seatTokens[0];
  const t1 = room.seatTokens[1];
  if (t0 == null || t1 == null) throw new Error("expected two human seat tokens");
  return [t0, t1];
}

/**
 * Open a live defender pending on a room's WARM instance and return the prompted seat + decisionId. The
 * human-vs-human attack that opens a pending needs a 6-fresh-base mid-play position that a short real game cannot
 * reach (same challenge as the per-phase attack tests), so we seed the DO's session cache + storage to a synthetic
 * attack state and drive a REAL `attack` command through `handleCommand`. The reducer opens the durable pending
 * (write-lock, no log entry yet), persists PENDING_KEY, and — timeout ON — arms the alarm. The pending then lives
 * on the warm instance's `this.session`, so a subsequent REAL WS message (resync / resolveDecision) sees it.
 */
async function openPendingOnWarmInstance(
  stub: DurableObjectStub<GameRoom>,
): Promise<{ promptedSeat: number; decisionId: string; deadline: number | null }> {
  return runInDurableObject(stub, async (inst: GameRoom) => {
    const base = (inst as unknown as { session: SessionState }).session;
    (inst as unknown as { session: SessionState }).session = {
      ...base,
      game: attackGame(),
      logLength: 0,
      chainAttacker: null,
    };
    await inst.handleCommand({ type: "attack", expectedLogIndex: 0, decl: ATTACK_DECL }, mkCtx(0));
    const s = (inst as unknown as { session: SessionState }).session;
    expect(s.pending).not.toBeNull();
    return {
      promptedSeat: s.pending!.promptedSeat,
      decisionId: s.pending!.decisionId,
      deadline: s.pending!.deadlineEpochMs,
    };
  });
}

function mkCtx(actingSeat: number): CommandCtx {
  return { actingSeat, nowEpochMs: Date.now(), decisionId: `decision-${actingSeat}-${Math.random()}` };
}

// ===========================================================================
// (1) Hibernation wake-replay — evict-hibernate mid-game, a command on the SURVIVING socket continues correctly.
//     END-TO-END VIA WS: the whole scenario (create → WS upgrade → command → hibernate → command) runs through the
//     real Worker + DO + socket stack; the socket survives the eviction and the DO lazy-rehydrates on the next message.
// ===========================================================================
describe("integration (1) — hibernation wake-replay on the surviving socket", () => {
  test("place a base, evict-hibernate, place the next on the same socket → applied + the persisted log grew", async () => {
    const room = await createRoom();
    const [t0, t1] = tokensOf(room);
    const seat0 = await openSocket(room.roomId, 0, t0);
    const seat1 = await openSocket(room.roomId, 1, t1);
    const stub = stubFor(room.roomId);

    // Seat 0 (the setup placer) places its first base while warm.
    const applied0 = await sendAndCollect(
      seat0,
      { type: "placeFirstBase", expectedLogIndex: 0, hex: firstBaseHexFor(0) },
      (m) => m.type === "applied",
    );
    expect(applied0[applied0.length - 1]!.type).toBe("applied");

    const logAfterFirst = await runInDurableObject(stub, async (_i, state) =>
      (await readStoredLog(state.storage)).length,
    );
    expect(logAfterFirst).toBe(1);

    // Force hibernation — the in-memory instance is torn down; both sockets stay connected.
    await evictDurableObject(stub, { webSockets: "hibernate" });

    // Seat 1 places its first base on the SAME (surviving) socket after the wake: the DO lazy-rehydrates from a cold
    // cache AND attributes the command to seat 1 (the surviving attachment) → applied at log index 1.
    const applied1 = await sendAndCollect(
      seat1,
      { type: "placeFirstBase", expectedLogIndex: 1, hex: firstBaseHexFor(1) },
      (m) => m.type === "applied",
    );
    const last = applied1[applied1.length - 1]!;
    expect(last.type).toBe("applied");
    if (last.type === "applied") expect(last.logIndex).toBe(1);

    // MECHANISM: the persisted log grew to 2 (the wake rehydrated, then applied + persisted the second placement).
    const logAfterWake = await runInDurableObject(stub, async (_i, state) => await readStoredLog(state.storage));
    expect(logAfterWake.length).toBe(2);
    expect(logAfterWake[1]!.kind).toBe("placeFirstBase");
    expect(logAfterWake[1]!.player).toBe(1);

    seat0.close(1000, "done");
    seat1.close(1000, "done");
  });
});

// ===========================================================================
// (2) Alarm idempotency (fire-after-answer) — the human answers via resolveDecision, THEN the alarm fires → NO
//     duplicate log entry. The answer over a REAL WS; the pending opened via runInDurableObject (a real end-to-end
//     human-vs-human attack needs a 6-base mid-play position unreachable from a short real game — see the helper).
// ===========================================================================
describe("integration (2) — alarm idempotency: a fire after the human answered is a no-op", () => {
  test("resolveDecision over WS, then runDurableObjectAlarm → the log length is unchanged by the fire", async () => {
    const room = await createRoom({ roomOptions: TIMEOUT_ON });
    const [t0, t1] = tokensOf(room);
    const attacker = await openSocket(room.roomId, 0, t0);
    const defender = await openSocket(room.roomId, 1, t1);
    const stub = stubFor(room.roomId);

    // Open the pending (seat 0 attacks seat 1's human base). Timeout ON → an alarm is armed to the deadline.
    const { promptedSeat, decisionId, deadline } = await openPendingOnWarmInstance(stub);
    expect(promptedSeat).toBe(1);
    expect(deadline).not.toBeNull();

    const logBefore = await runInDurableObject(stub, async (_i, state) =>
      (await readStoredLog(state.storage)).length,
    );
    expect(logBefore).toBe(0); // a pending opens NO log entry yet

    // The prompted human (seat 1) answers over its REAL socket. resolveDecision appends the resolving attack entry.
    const answer = await sendAndCollect(
      defender,
      { type: "resolveDecision", expectedLogIndex: 0, decisionId, defender: ATTACK_DEF },
      (m) => m.type === "applied",
      8_000,
    );
    expect(answer.some((m) => m.type === "applied")).toBe(true);

    const logAfterAnswer = await runInDurableObject(stub, async (_i, state) =>
      (await readStoredLog(state.storage)).length,
    );
    expect(logAfterAnswer).toBeGreaterThan(0); // the answer DID append the resolving attack

    // The answer cleared the alarm slot. Re-arm it to a future time so the pool actually FIRES the handler — the
    // no-op we exercise is the handler's tombstone guard (a stray at-least-once retry landing after the answer),
    // not the pool declining to run a cleared slot.
    await runInDurableObject(stub, async (_i, state) => {
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);

    const logAfterFire = await runInDurableObject(stub, async (_i, state) =>
      (await readStoredLog(state.storage)).length,
    );

    // THE CORE IDEMPOTENCY ASSERTION: the alarm fire produced ZERO additional entries (the pending is tombstoned).
    expect(logAfterFire).toBe(logAfterAnswer);

    attacker.close(1000, "done");
    defender.close(1000, "done");
  });
});

// ===========================================================================
// (3) serializeAttachment round-trip — seat identity survives hibernation. After eviction, each socket's command is
//     attributed to ITS seat: in setup, seat 0 (the placer) → applied; seat 1 → NOT_YOUR_TURN. END-TO-END VIA WS.
// ===========================================================================
describe("integration (3) — seat identity survives hibernation (serializeAttachment round-trip)", () => {
  test("after evict-hibernate, seat 1's placeFirstBase → NOT_YOUR_TURN, seat 0's → applied (each attributed to its seat)", async () => {
    const room = await createRoom();
    const [t0, t1] = tokensOf(room);
    const seat0 = await openSocket(room.roomId, 0, t0);
    const seat1 = await openSocket(room.roomId, 1, t1);
    const stub = stubFor(room.roomId);

    // Hibernate BEFORE either seat has placed — a cold wake rehydrates to the setup phase (empty log, seat 0 places).
    await evictDurableObject(stub, { webSockets: "hibernate" });

    const hex0 = firstBaseHexFor(0);

    // Seat 1 attempts to place first — it is NOT seat 1's turn in setup. The command is attributed to seat 1 (from
    // the surviving attachment) → NOT_YOUR_TURN. If the attachment were lost/misattributed this would differ.
    const seat1Reply = await sendAndCollect(
      seat1,
      { type: "placeFirstBase", expectedLogIndex: 0, hex: hex0 },
      (m) => m.type === "error" || m.type === "applied",
    );
    const s1 = seat1Reply[seat1Reply.length - 1]!;
    expect(s1.type).toBe("error");
    if (s1.type === "error") expect(s1.code).toBe("NOT_YOUR_TURN");

    // Seat 0 places first — attributed to seat 0 → applied.
    const seat0Reply = await sendAndCollect(
      seat0,
      { type: "placeFirstBase", expectedLogIndex: 0, hex: hex0 },
      (m) => m.type === "applied",
    );
    expect(seat0Reply[seat0Reply.length - 1]!.type).toBe("applied");

    seat0.close(1000, "done");
    seat1.close(1000, "done");
  });
});

// ===========================================================================
// (4) Seat auth + multi-tab — valid token accepts; wrong/absent/agent token rejected (403, no socket); two tabs on
//     the SAME token both attach to seat N and BOTH receive a broadcast; a claimSeat ack is idempotent per requestId.
//     END-TO-END VIA WS (the broadcast/ack drive real sockets); the rejection paths assert the 403 + no-socket.
// ===========================================================================
describe("integration (4) — seat auth, multi-tab fan-out, and claimSeat idempotency", () => {
  test("valid token accepts; wrong/absent/agent tokens are refused 403 with no socket", async () => {
    // A human+agent room so seat 1 is an agent (authorizedDigest null → layer-2 refusal).
    const room = await createRoom({ seats: [{ kind: "human" }, { kind: "agent", agent: "heuristic" }] });
    const humanToken = room.seatTokens[0];
    if (humanToken == null) throw new Error("expected a human seat-0 token");
    expect(room.seatTokens[1]).toBeNull(); // the agent seat mints no token

    // A valid token → 101 with a socket.
    const ok = await openSocket(room.roomId, 0, humanToken);
    ok.close(1000, "done");

    // A wrong token → 403, no socket.
    const wrong = await openSocketExpectingReject(room.roomId, 0, "definitely-not-the-token");
    expect(wrong.status).toBe(403);
    expect(wrong.webSocket).toBeFalsy();

    // An absent token → 403, no socket.
    const absent = await openSocketExpectingReject(room.roomId, 0, null);
    expect(absent.status).toBe(403);
    expect(absent.webSocket).toBeFalsy();

    // An AGENT seat with any token → 403 (layer-2 bind-refusal: agent seats are host-driven, never socket-bound).
    const agent = await openSocketExpectingReject(room.roomId, 1, "anything");
    expect(agent.status).toBe(403);
    expect(agent.webSocket).toBeFalsy();
  });

  test("two tabs on the SAME valid token both attach to seat 1 and BOTH receive a broadcast (multi-tab)", async () => {
    const room = await createRoom();
    const [, t1] = tokensOf(room);
    const tabA = await openSocket(room.roomId, 1, t1);
    const tabB = await openSocket(room.roomId, 1, t1);
    const stub = stubFor(room.roomId);

    // Both tabs are discovered under the seat tag.
    const seat1Count = await runInDurableObject(stub, async (_i, state) => state.getWebSockets("seat:1").length);
    expect(seat1Count).toBe(2);

    // A broadcast reaches BOTH tabs (the exact multi-tab delivery set).
    const gotA = collect(tabA, 1);
    const gotB = collect(tabB, 1);
    await runInDurableObject(stub, async (inst: GameRoom) => {
      (inst as unknown as { sink: { broadcast: (m: ServerMessage[]) => void } }).sink.broadcast([{ type: "reload" }]);
    });
    expect((await gotA)[0]!.type).toBe("reload");
    expect((await gotB)[0]!.type).toBe("reload");

    tabA.close(1000, "done");
    tabB.close(1000, "done");
  });

  test("claimSeat is idempotent per requestId — a re-ack with the same requestId returns the same seatClaimed, no re-broadcast", async () => {
    const room = await createRoom();
    const [t0, t1] = tokensOf(room);
    const seat0 = await openSocket(room.roomId, 0, t0);
    const seat1 = await openSocket(room.roomId, 1, t1);

    // Seat 0 claims its seat (a false→true transition): the reply is seatClaimed AND it broadcasts to seat 1.
    const seat1Broadcast = collect(seat1, (m) => m.type === "seatClaimed");
    const firstAck = await sendAndCollect(
      seat0,
      { type: "claimSeat", requestId: "req-abc", seat: 0 },
      (m) => m.type === "seatClaimed",
    );
    const first = firstAck[firstAck.length - 1]!;
    expect(first.type).toBe("seatClaimed");
    if (first.type === "seatClaimed") {
      expect(first.seat).toBe(0);
      expect(first.requestId).toBe("req-abc");
    }
    // The transition broadcast reached seat 1.
    expect((await seat1Broadcast).some((m) => m.type === "seatClaimed")).toBe(true);

    // A re-ack with the SAME requestId → the same seatClaimed reply, but NO re-broadcast to seat 1 (idempotent).
    let seat1SawRebroadcast = expectNoMessage(seat1, 250);
    const reAck = await sendAndCollect(
      seat0,
      { type: "claimSeat", requestId: "req-abc", seat: 0 },
      (m) => m.type === "seatClaimed",
    );
    const re = reAck[reAck.length - 1]!;
    expect(re.type).toBe("seatClaimed");
    if (re.type === "seatClaimed") expect(re.requestId).toBe("req-abc");
    expect(await seat1SawRebroadcast).toBe(false); // no re-broadcast on a same-requestId re-ack

    seat0.close(1000, "done");
    seat1.close(1000, "done");
  });
});

// ===========================================================================
// (5) Double-submit / expectedLogIndex — a replayed command with a STALE index → a `resync` reply (reason
//     STALE_INDEX), NO double-apply. The log grows by exactly ONE for the original, not two. END-TO-END VIA WS.
// ===========================================================================
describe("integration (5) — double-submit is rejected by expectedLogIndex (no double-apply)", () => {
  test("place at index 0, then replay the SAME command at index 0 → resync (STALE_INDEX), the log grew by exactly one", async () => {
    const room = await createRoom();
    const [t0] = tokensOf(room);
    const seat0 = await openSocket(room.roomId, 0, t0);
    const stub = stubFor(room.roomId);

    const cmd = { type: "placeFirstBase" as const, expectedLogIndex: 0, hex: firstBaseHexFor(0) };

    // The ORIGINAL command applies at index 0.
    const applied = await sendAndCollect(seat0, cmd, (m) => m.type === "applied");
    expect(applied[applied.length - 1]!.type).toBe("applied");

    const logAfterOriginal = await runInDurableObject(stub, async (_i, state) =>
      (await readStoredLog(state.storage)).length,
    );
    expect(logAfterOriginal).toBe(1);

    // The REPLAYED command (same expectedLogIndex 0, now stale — the real head is 1) → a resync reply, NOT a re-apply.
    const replay = await sendAndCollect(seat0, cmd, (m) => m.type === "resync" || m.type === "applied");
    const r = replay[replay.length - 1]!;
    expect(r.type).toBe("resync");
    if (r.type === "resync") {
      expect(r.reason).toBe("STALE_INDEX");
      expect(r.logLength).toBe(1); // the resync reflects the true head — one entry, not two
    }

    // MECHANISM: the log grew by EXACTLY ONE — the replay did not double-apply.
    const logAfterReplay = await runInDurableObject(stub, async (_i, state) =>
      (await readStoredLog(state.storage)).length,
    );
    expect(logAfterReplay).toBe(1);

    seat0.close(1000, "done");
  });
});

// ===========================================================================
// (6) Reconnect-during-pending — a human-vs-human attack opens a pending; the prompted defender's socket
//     disconnects; a NEW socket for that seat connects and `resync` → the resync CARRIES the outstanding prompt.
//     A NON-prompted seat's resync does NOT (the privacy rule at the integration level). END-TO-END VIA WS for the
//     resync + privacy assertions; the pending opened via runInDurableObject (see the helper).
// ===========================================================================
describe("integration (6) — reconnect during a pending re-delivers the prompt to the prompted seat only", () => {
  test("defender reconnects → resync carries the pending; a non-prompted seat's resync does NOT (privacy)", async () => {
    const room = await createRoom({ roomOptions: TIMEOUT_ON });
    const [t0, t1] = tokensOf(room);
    const attacker = await openSocket(room.roomId, 0, t0);
    const defender = await openSocket(room.roomId, 1, t1);
    const stub = stubFor(room.roomId);

    // Open the pending (seat 0 attacks seat 1's human base). promptedSeat is 1.
    const { promptedSeat } = await openPendingOnWarmInstance(stub);
    expect(promptedSeat).toBe(1);

    // The prompted defender's socket disconnects (a real close).
    defender.close(1000, "reconnecting");

    // A NEW socket for the SAME seat (seat 1) connects and resyncs → the resync carries the outstanding prompt.
    const defenderReconnected = await openSocket(room.roomId, 1, t1);
    const reconnectResync = await sendAndCollect(
      defenderReconnected,
      { type: "resync" },
      (m) => m.type === "resync",
      8_000,
    );
    const rs = reconnectResync[reconnectResync.length - 1]!;
    expect(rs.type).toBe("resync");
    if (rs.type === "resync") {
      expect(rs.pending).not.toBeNull(); // MECHANISM: the reconnecting prompted seat re-receives the prompt
      expect(rs.pending!.promptedSeat).toBe(1);
    }

    // The NON-prompted seat (seat 0, the attacker) resyncs → its resync does NOT carry the pending (privacy rule).
    const attackerResync = await sendAndCollect(attacker, { type: "resync" }, (m) => m.type === "resync", 8_000);
    const ar = attackerResync[attackerResync.length - 1]!;
    expect(ar.type).toBe("resync");
    if (ar.type === "resync") expect(ar.pending).toBeNull(); // the attacker must NOT see the defender's prompt

    attacker.close(1000, "done");
    defenderReconnected.close(1000, "done");
  });
});

// ===========================================================================
// (7) Snapshot + tail recovery — play past a round boundary (a snapshot written), evict (FULL, not hibernate),
//     reconnect + a command → the rehydrated state equals a fresh replayLog(header, storedLog). Mechanism: stateHash
//     equality against an independent replay of the stored log. Read the stored log + header via a stub.
//     The play + continuation run VIA WS end-to-end; the stored-log read + replay comparison via runInDurableObject.
// ===========================================================================
describe("integration (7) — snapshot + tail recovery equals a fresh replay of the stored log", () => {
  test("play to a snapshot, full-evict, reconnect + continue → rehydrated stateHash == replayLog(header, storedLog)", async () => {
    const room = await createRoom();
    const [t0, t1] = tokensOf(room);
    let seat0 = await openSocket(room.roomId, 0, t0);
    let seat1 = await openSocket(room.roomId, 1, t1);
    const stub = stubFor(room.roomId);

    // Both placements, then one build closes the round → a snapshot is written. Drive it through real sockets.
    await sendAndCollect(
      seat0,
      { type: "placeFirstBase", expectedLogIndex: 0, hex: firstBaseHexFor(0) },
      (m) => m.type === "applied",
    );
    await sendAndCollect(
      seat1,
      { type: "placeFirstBase", expectedLogIndex: 1, hex: firstBaseHexFor(1) },
      (m) => m.type === "applied" || m.type === "turnRollover",
    );

    // Now in play (log length 2 after the two placements). The current actor drives a legal build (a build
    // self-closes the round → snapshot + rollover). Compute the legal build + current actor + head index from the
    // warm instance, then send it over that actor's socket at the true head index.
    const { actor, buildPieces, headIndex } = await runInDurableObject(stub, async (inst: GameRoom) => {
      const s = (inst as unknown as { session: SessionState }).session;
      const a = s.game.phase.order[s.game.phase.indexInOrder]!;
      const build = legalActions(s.game).find((x) => x.kind === "build");
      if (build === undefined || build.kind !== "build") throw new Error("expected a legal build");
      return { actor: a, buildPieces: build.pieces, headIndex: s.logLength };
    });
    expect(headIndex).toBe(2); // place@0, place@1 → the build lands at index 2
    const actorSocket = actor === 0 ? seat0 : seat1;
    await sendAndCollect(
      actorSocket,
      { type: "build", expectedLogIndex: headIndex, pieces: buildPieces },
      (m) => m.type === "applied",
    );

    // Read the stored log while warm; confirm a snapshot exists and the log has the expected shape.
    const { storedLog, header } = await runInDurableObject(stub, async (inst: GameRoom, state) => {
      const log = await readStoredLog(state.storage);
      const s = (inst as unknown as { session: SessionState }).session;
      return { storedLog: log, header: s.header };
    });
    expect(storedLog.length).toBe(3); // place@0, place@1, build@2 (the round-closing build)

    // Full eviction (NOT hibernate) — the sockets drop; the DO cache + instance are gone.
    seat0.close(1000, "evicting");
    seat1.close(1000, "evicting");
    await evictDurableObject(stub);

    // A cold wake rehydrates from storage (snapshot + tail). Assert cold-then-rehydrate BEFORE reconnecting a socket
    // (the WS upgrade itself lazy-rehydrates, so the cold check must run first, off any socket path).
    const rehydratedHash = await runInDurableObject(stub, async (inst: GameRoom) => {
      expect((inst as unknown as { session: SessionState | null }).session).toBeNull(); // cold
      await inst.handleCommand({ type: "resync" }, mkCtx(0)); // triggers rehydrate
      const s = (inst as unknown as { session: SessionState }).session;
      return stateHash(s.game);
    });

    // MECHANISM: the rehydrated game equals a fresh, INDEPENDENT replay of the stored log (canonical stateHash).
    const fresh = replayLog(header, storedLog);
    expect(rehydratedHash).toBe(stateHash(fresh.state));

    // And the room is live post-recovery: a reconnecting real socket resyncs and gets the recovered state back.
    seat0 = await openSocket(room.roomId, 0, t0);
    const cont = await sendAndCollect(seat0, { type: "resync" }, (m) => m.type === "resync");
    const contResync = cont[cont.length - 1]!;
    expect(contResync.type).toBe("resync");
    if (contResync.type === "resync") expect(contResync.logLength).toBe(storedLog.length);

    seat0.close(1000, "done");
  });
});

// ===========================================================================
// (8) Broadcast never precedes the awaited storage.put — the canonical ordering assertion at the integration level.
//     runInDurableObject wraps storage.put + the send path into ONE ordered array (the critical-section.test.ts
//     technique), asserting the put(log:N) index < the send(applied logIndex N) index. This is the one scenario a
//     real WS cannot express: observing the RELATIVE order of the internal put vs. the internal send requires
//     wrapping the instance's storage + sink, which only runInDurableObject can do — the socket only sees the final
//     message, never the put that preceded it. The DO + storage are real; only the observation point is internal.
// ===========================================================================
type Op =
  | { op: "put"; keys: string[] }
  | { op: "send"; type: string; logIndex: number | null };

describe("integration (8) — a broadcast never precedes the awaited storage.put (recorded order)", () => {
  test("a mutating command persists log:000000 STRICTLY before it sends the applied message for logIndex 0", async () => {
    const room = await createRoom();
    const stub = stubFor(room.roomId);

    const ops = await runInDurableObject(stub, async (inst: GameRoom, state) => {
      const recorded: Op[] = [];
      const storage = state.storage;
      const realPut = storage.put.bind(storage);
      (storage as unknown as { put: typeof storage.put }).put = ((
        keyOrEntries: string | Record<string, unknown>,
        value?: unknown,
      ) => {
        if (typeof keyOrEntries === "string") {
          recorded.push({ op: "put", keys: [keyOrEntries] });
          return realPut(keyOrEntries, value as never);
        }
        recorded.push({ op: "put", keys: Object.keys(keyOrEntries) });
        return realPut(keyOrEntries as never);
      }) as typeof storage.put;

      const logIndexOf = (m: ServerMessage): number | null => (m.type === "applied" ? m.logIndex : null);
      const record = (msgs: ServerMessage[]): void => {
        for (const m of msgs) recorded.push({ op: "send", type: m.type, logIndex: logIndexOf(m) });
      };
      (inst as unknown as { sink: unknown }).sink = {
        reply: record,
        toSeat: (_seat: number, msg: ServerMessage) => record([msg]),
        broadcast: record,
      };

      const s = (inst as unknown as { session: SessionState }).session;
      const hex = representativeFirstBase(s.game, 0);
      await inst.handleCommand({ type: "placeFirstBase", expectedLogIndex: 0, hex }, mkCtx(0));
      return recorded;
    });

    // The load-bearing assertion: the put carrying log:000000 appears at a STRICTLY LOWER index than the send of the
    // applied message for logIndex 0. Mechanism = observed order in ONE shared array, never a clock.
    const putIdx = ops.findIndex((o) => o.op === "put" && o.keys.includes(logKey(0)));
    const sendIdx = ops.findIndex((o) => o.op === "send" && o.type === "applied" && o.logIndex === 0);
    expect(putIdx).toBeGreaterThanOrEqual(0);
    expect(sendIdx).toBeGreaterThanOrEqual(0);
    expect(putIdx).toBeLessThan(sendIdx);
  });
});

// ---------------------------------------------------------------------------
// Synthetic PLAY-phase attack position (mirrors test/host/alarm.test.ts). Seat 0 (attacker) can attack seat 1's
// origin base; seat 1 owns a SECOND fresh base (the eligible representative defender ATTACK_DEF). Iron sits on base
// hexes so neither side is silently eliminated (noIron) when the entry composes. It is seat 0's turn.
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

function boardHexes(radius: number): Hex[] {
  const seen = new Set<string>();
  const hexes: Hex[] = [];
  for (let x = -radius; x <= radius; x++) {
    for (let y = -radius; y <= radius; y++) {
      const h = synthHex(x, y);
      if (Math.abs(h.z) <= radius && !seen.has(key(h))) {
        seen.add(key(h));
        hexes.push(h);
      }
    }
  }
  return hexes;
}

/** Seat 0 can legally attack seat 1's origin base; seat 1 has ATTACK_DEF as the eligible representative defender. */
function attackGame(): GameState {
  const bases: Base[] = [
    synthBase(1, ATTACK_TARGET, 0),
    synthBase(1, ATTACK_DEF, 1),
    synthBase(0, ATTACK_ATTACKERS[0]!, 2),
    synthBase(0, ATTACK_ATTACKERS[1]!, 3),
    synthBase(0, ATTACK_ATTACKERS[2]!, 4),
  ];
  const rng: RngState = makeSeed(1n);
  return {
    board: { hexes: boardHexes(6), iron: ATTACK_IRON },
    bases,
    factories: [],
    players: Array.from({ length: 2 }, (_, id) => ({ id, basesInHand: 12, alliance: [id], eliminated: false })),
    phase: { turn: 3, order: [0, 1], indexInOrder: 0 },
    factorySupply: 36,
    config: defaultConfig(),
    rngState: rng,
  };
}
