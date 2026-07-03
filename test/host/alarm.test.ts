// ABOUTME: Workers-pool tests for GameRoom.alarm() — the opt-in defender-timeout resolution (Phase B5).
// ABOUTME: Idempotent at-least-once semantics: resolve-on-fire, fire-after-answer no-op, recency re-arm, OFF never arms, null-defender freeze.
import { describe, expect, test } from "vitest";
import { env, runInDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import type { GameRoom } from "../../src/host/game-room";
import {
  PENDING_KEY,
  FROZEN_KEY,
  type SessionState,
  type SessionHeader,
  type CommandCtx,
  type LogEntry,
  type Pending,
} from "../../src/session";
import { REPLAY_VERSION } from "../../src/host/version";
import type { ClientCommand, RoomOptions, ServerMessage } from "../../src/wire/protocol";
import { defaultConfig, seed as makeSeed } from "../../src/index";
import { key } from "../../src/geometry/cube";
import type { Base, GameState, Hex, PlayerId, RngState } from "../../src/engine/types";

/** A fresh GameRoom stub on a unique name so each test owns its own storage. */
let counter = 0;
function freshStub(): DurableObjectStub<GameRoom> {
  const name = `alarm-test-${counter++}-${Date.now()}`;
  return env.GAME_ROOM.get(env.GAME_ROOM.idFromName(name)) as DurableObjectStub<GameRoom>;
}

const ROOM_OPTIONS_OFF: RoomOptions = { defenderTimeout: { enabled: false, seconds: 120 } };
const ROOM_OPTIONS_ON: RoomOptions = { defenderTimeout: { enabled: true, seconds: 120 } };

/** A header stamped with the committed REPLAY_VERSION so a cold wake takes the cheap rehydrate path. */
function makeHeader(seats: SessionHeader["seats"]): SessionHeader {
  return {
    formatVersion: 1,
    replayVersion: REPLAY_VERSION,
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

function mkCtx(actingSeat: number): CommandCtx {
  return { actingSeat, nowEpochMs: Date.now(), decisionId: `decision-${actingSeat}-${Math.random()}` };
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

/** Count only `attack` entries in the stored log. */
function attackCount(log: LogEntry[]): number {
  return log.filter((e) => e.kind === "attack").length;
}

/**
 * Open a real, live pending on the given stub: seed the cache to a synthetic attack state where seat 0 can
 * legally attack seat 1's HUMAN base, then send a real `attack` command through handleCommand. The reducer
 * opens the durable pending (write-lock, no log entry yet), persists it, and (timeout ON) arms the alarm.
 * Returns the pending's deadline (or null when timeout OFF).
 */
async function openLivePending(stub: DurableObjectStub<GameRoom>): Promise<number | null> {
  return runInDurableObject(stub, async (inst: GameRoom) => {
    const base = (inst as unknown as { session: SessionState }).session;
    (inst as unknown as { session: SessionState }).session = {
      ...base,
      game: attackGame(),
      logLength: 7,
      chainAttacker: null,
    };
    installCapturingSink(inst);
    await inst.handleCommand({ type: "attack", expectedLogIndex: 7, decl: ATTACK_DECL }, mkCtx(0));
    const s = (inst as unknown as { session: SessionState }).session;
    expect(s.pending).not.toBeNull();
    expect(s.pending!.promptedSeat).toBe(1); // seat 1 is the prompted human defender
    return s.pending!.deadlineEpochMs;
  });
}

// ---------------------------------------------------------------------------
// (1) Resolve on fire: a timeout-ON pending fires → the attack resolves with the representative defender.
//     ONE new `attack` entry appears; the pending clears to a tombstone; getAlarm() is null after.
// ---------------------------------------------------------------------------
describe("GameRoom.alarm — resolves the timed-out defender decision with the representative defender", () => {
  test("fire on/after deadline → exactly one new attack log entry, pending cleared, alarm null", async () => {
    const stub = freshStub();
    await initRoom(stub, makeHeader([{ kind: "human" }, { kind: "human" }]), ROOM_OPTIONS_ON, [
      "a".repeat(64),
      "b".repeat(64),
    ]);

    await openLivePending(stub);

    // The pending is open with a deadline; the alarm is armed to it.
    const { logBefore, alarmArmed } = await runInDurableObject(stub, async (_inst, state) => ({
      logBefore: (await readStoredLog(state.storage)).length,
      alarmArmed: await state.storage.getAlarm(),
    }));
    expect(logBefore).toBe(0); // a pending opens NO log entry yet
    expect(alarmArmed).not.toBeNull();

    // Force the deadline into the PAST so the handler resolves (not re-arms) when it fires.
    await runInDurableObject(stub, async (inst: GameRoom, state) => {
      const s = (inst as unknown as { session: SessionState }).session;
      const past: Pending = { ...s.pending!, deadlineEpochMs: Date.now() - 1000 };
      (inst as unknown as { session: SessionState }).session = { ...s, pending: past };
      await state.storage.put(PENDING_KEY, past);
    });

    // Fire the alarm via the pool helper (never a real timer).
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);

    const { log, pendingAfter, alarmAfter } = await runInDurableObject(stub, async (_inst, state) => ({
      log: await readStoredLog(state.storage),
      pendingAfter: await state.storage.get(PENDING_KEY),
      alarmAfter: await state.storage.getAlarm(),
    }));

    // MECHANISM: the timeout resolved into EXACTLY one attack entry (the auto-close endRound may follow, but the
    // decision itself contributes a single attack).
    expect(attackCount(log)).toBe(1);
    // MECHANISM: the resolution used the deterministic REPRESENTATIVE defender — ATTACK_DEF is seat 1's only
    // eligible fresh base within range, so representativeDefender must have picked it as the substituted defender.
    const attackEntry = log.find((e) => e.kind === "attack") as Extract<LogEntry, { kind: "attack" }>;
    expect(key(attackEntry.decl.defender)).toBe(key(ATTACK_DEF));
    // The pending cleared to a tombstone (reads back as cleared).
    expect((pendingAfter as { cleared?: boolean }).cleared).toBe(true);
    // The alarm was cleared by the resolution (effects.alarm = clear).
    expect(alarmAfter).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (2) Fire-after-answer no-op (the core idempotency assertion): resolve the pending via a real resolveDecision
//     command, THEN fire the alarm → ZERO additional log entries. The tombstone makes step 2 no-op.
// ---------------------------------------------------------------------------
describe("GameRoom.alarm — fire after the human already answered is a no-op (idempotency)", () => {
  test("resolveDecision first, then alarm fires → the log length is UNCHANGED by the fire", async () => {
    const stub = freshStub();
    await initRoom(stub, makeHeader([{ kind: "human" }, { kind: "human" }]), ROOM_OPTIONS_ON, [
      "a".repeat(64),
      "b".repeat(64),
    ]);

    await openLivePending(stub);

    // The human answers: resolveDecision with the eligible defender → the attack resolves, pending → tombstone.
    const logAfterAnswer = await runInDurableObject(stub, async (inst: GameRoom, state) => {
      const s = (inst as unknown as { session: SessionState }).session;
      installCapturingSink(inst);
      await inst.handleCommand(
        {
          type: "resolveDecision",
          expectedLogIndex: s.logLength, // a pending appends nothing, so logLength is unchanged since the prompt
          decisionId: s.pending!.decisionId,
          defender: ATTACK_DEF,
        },
        mkCtx(1),
      );
      const s2 = (inst as unknown as { session: SessionState }).session;
      expect(s2.pending).toBeNull(); // answered
      return (await readStoredLog(state.storage)).length;
    });
    expect(logAfterAnswer).toBeGreaterThan(0); // the answer DID append the resolving attack

    // The answer's resolution CLEARED the alarm (effects.alarm = clear). To exercise the handler's step-2 tombstone
    // no-op — the at-least-once retry that FIRES after the answer already committed — we re-arm the alarm slot to a
    // future time so the pool actually invokes alarm() (a null slot would return `ran=false` without running it).
    // This models a stray retry landing after the pending is already a tombstone.
    await runInDurableObject(stub, async (_inst, state) => {
      await state.storage.setAlarm(Date.now() + 60_000);
    });

    // Fire the alarm — it MUST run the handler (proving the no-op is the HANDLER's step-2 tombstone guard, not the
    // pool declining to fire a cleared slot).
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);

    const logAfterFire = await runInDurableObject(stub, async (_inst, state) =>
      (await readStoredLog(state.storage)).length,
    );

    // THE CORE IDEMPOTENCY ASSERTION: the alarm fire produced ZERO additional log entries (the tombstone no-op).
    expect(logAfterFire).toBe(logAfterAnswer);
  });
});

// ---------------------------------------------------------------------------
// (3) Recency guard (extendDecision + early-retry): when the LIVE deadline is in the FUTURE, the alarm fired for
//     an OLD deadline → the handler RE-ARMS to the live deadline and does NOT resolve. Zero new log entries.
//
//     Time control: the workers pool does not expose a settable clock to alarm(), and alarm() reads the host's
//     real Date.now(). Two independent knobs make this testable: (a) the PENDING's `deadlineEpochMs`, which the
//     handler compares against Date.now() to pick its branch, and (b) the ALARM SLOT, which the pool's
//     `runDurableObjectAlarm` fires only when `getAlarm()` is non-null. The pool auto-fires-and-clears an alarm
//     set to a PAST time (so it reads back null and would NOT run), so the slot MUST be armed to a future time
//     for the fire to happen. Here we set the pending deadline UNAMBIGUOUSLY in the future (Date.now() + 1h) so
//     the handler takes the recency-guard branch, while keeping the alarm slot armed (future) so the fire runs.
//     This models `extendDecision` having pushed the deadline later than the alarm that just fired. We assert
//     zero new log entries AND getAlarm() re-armed to the future deadline.
// ---------------------------------------------------------------------------
describe("GameRoom.alarm — a future live deadline re-arms and does not resolve (recency guard)", () => {
  test("live deadline in the future → re-arm getAlarm() to it, zero new log entries", async () => {
    const stub = freshStub();
    await initRoom(stub, makeHeader([{ kind: "human" }, { kind: "human" }]), ROOM_OPTIONS_ON, [
      "a".repeat(64),
      "b".repeat(64),
    ]);

    await openLivePending(stub);

    const futureDeadline = Date.now() + 3_600_000; // one hour out — unambiguously in the future for alarm()'s Date.now()

    // Push the live pending's deadline into the future (models an extendDecision the fired alarm predates). Arm the
    // alarm slot to a NEAR-future time (distinct from the live deadline) so the pool fires it — a past-time slot is
    // auto-cleared by workerd and would read back null (nothing to run). The handler must re-arm to the LIVE
    // (future) deadline, overwriting this near-future slot.
    const logBefore = await runInDurableObject(stub, async (inst: GameRoom, state) => {
      const s = (inst as unknown as { session: SessionState }).session;
      const extended: Pending = { ...s.pending!, deadlineEpochMs: futureDeadline };
      (inst as unknown as { session: SessionState }).session = { ...s, pending: extended };
      await state.storage.put(PENDING_KEY, extended);
      await state.storage.setAlarm(Date.now() + 60_000); // a stale (earlier) alarm the fire predates the live deadline
      return (await readStoredLog(state.storage)).length;
    });
    expect(logBefore).toBe(0);

    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);

    const { logAfter, pendingAfter, alarmAfter } = await runInDurableObject(stub, async (_inst, state) => ({
      logAfter: (await readStoredLog(state.storage)).length,
      pendingAfter: await state.storage.get<Pending>(PENDING_KEY),
      alarmAfter: await state.storage.getAlarm(),
    }));

    // MECHANISM: no resolution — zero new log entries; the pending is still live (not tombstoned).
    expect(logAfter).toBe(0);
    expect((pendingAfter as { cleared?: boolean }).cleared).not.toBe(true);
    // The handler re-armed the alarm to the LIVE (future) deadline.
    expect(alarmAfter).toBe(futureDeadline);
  });
});

// ---------------------------------------------------------------------------
// (4) Timeout OFF never arms: a human-defended attack in a timeout-OFF room leaves getAlarm() null.
// ---------------------------------------------------------------------------
describe("GameRoom.alarm — a timeout-OFF room never arms an alarm", () => {
  test("a human-vs-human attack opens a pending but arms NO alarm (deadline null)", async () => {
    const stub = freshStub();
    await initRoom(stub, makeHeader([{ kind: "human" }, { kind: "human" }]), ROOM_OPTIONS_OFF, [
      "a".repeat(64),
      "b".repeat(64),
    ]);

    const deadline = await openLivePending(stub);
    expect(deadline).toBeNull(); // timeout OFF → no deadline on the pending

    const alarm = await runInDurableObject(stub, async (_inst, state) => state.storage.getAlarm());
    expect(alarm).toBeNull(); // no alarm armed
  });
});

// ---------------------------------------------------------------------------
// (5) Null-defender freeze (defense in depth): a pending whose target has NO eligible representative defender.
//     Cannot arise under the write-lock (validateTargetAttackable guaranteed a defender at open, and the board is
//     frozen while a pending is open), so we construct it synthetically: a pending pointing at a target with zero
//     eligible defenders. The alarm fire must FREEZE the room (writeFrozen — the B3.3 mechanism) and DELETE the
//     alarm so it does not retry-loop, leaving the pending intact for post-mortem. We assert the room is frozen
//     (a subsequent mutating command → FROZEN), the alarm is null, and the pending is UNCHANGED.
// ---------------------------------------------------------------------------
describe("GameRoom.alarm — a null representative defender freezes the room (defense in depth)", () => {
  test("a pending with no eligible defender → freeze + deleteAlarm + pending intact (no resolve loop)", async () => {
    const stub = freshStub();
    await initRoom(stub, makeHeader([{ kind: "human" }, { kind: "human" }]), ROOM_OPTIONS_ON, [
      "a".repeat(64),
      "b".repeat(64),
    ]);

    // Construct a live pending whose target has ZERO eligible defenders: a game where seat 1 owns ONLY the target
    // base (no other fresh base within range), so representativeDefender(game, target, 1) === null. The pending is
    // hand-built (this state is unreachable through a real attack — validateTargetAttackable would have rejected it)
    // to exercise the defense-in-depth branch. deadlineEpochMs is in the past so alarm() takes the resolve branch.
    const decisionId = "synthetic-no-defender";
    await runInDurableObject(stub, async (inst: GameRoom, state) => {
      const base = (inst as unknown as { session: SessionState }).session;
      const game = noDefenderGame();
      const pending: Pending = {
        decisionId,
        kind: "defenderChoice",
        round: game.phase.turn,
        declaringPlayer: 0,
        promptedSeat: 1,
        proposed: { target: NO_DEF_TARGET, attackers: NO_DEF_ATTACKERS, defender: NO_DEF_TARGET },
        preDecisionLogLength: 0,
        rngBeforeApply: game.rngState,
        deadlineEpochMs: Date.now() - 1000,
      };
      (inst as unknown as { session: SessionState }).session = {
        ...base,
        game,
        logLength: 0,
        chainAttacker: null,
        pending,
      };
      await state.storage.put(PENDING_KEY, pending);
      // The pending deadline is in the PAST (handler resolves), but the alarm SLOT must be future so the pool
      // actually fires it (a past-time slot is auto-cleared by workerd and reads back null → nothing to run).
      await state.storage.setAlarm(Date.now() + 60_000);
    });

    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);

    const { frozenFlag, alarmAfter, pendingAfter, log } = await runInDurableObject(stub, async (_inst, state) => ({
      frozenFlag: await state.storage.get<boolean>(FROZEN_KEY),
      alarmAfter: await state.storage.getAlarm(),
      pendingAfter: await state.storage.get<Pending>(PENDING_KEY),
      log: await readStoredLog(state.storage),
    }));

    expect(frozenFlag).toBe(true); // the room froze (B3.3 mechanism reused)
    expect(alarmAfter).toBeNull(); // the alarm was deleted → no retry loop
    expect(attackCount(log)).toBe(0); // NOTHING resolved — no attack entry appended
    // The pending is intact for post-mortem (NOT tombstoned).
    expect((pendingAfter as { cleared?: boolean }).cleared).not.toBe(true);
    expect(pendingAfter!.decisionId).toBe(decisionId);

    // A subsequent mutating command → FROZEN (the same host interception as a divergence freeze).
    const sawFrozen = await runInDurableObject(stub, async (inst: GameRoom) => {
      const sent = installCapturingSink(inst);
      const s = (inst as unknown as { session: SessionState }).session;
      await inst.handleCommand({ type: "endRound", expectedLogIndex: s.logLength } as ClientCommand, mkCtx(0));
      return sent.some((x) => x.msg.type === "error" && x.msg.code === "FROZEN");
    });
    expect(sawFrozen).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Synthetic PLAY-phase attack position: seat 0 (attacker) can attack seat 1's origin base; seat 1 owns a SECOND
// fresh base (the eligible representative defender ATTACK_DEF). Iron sits on base hexes so neither side is
// silently eliminated (noIron) when the entry composes. It is seat 0's turn.
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

// ---------------------------------------------------------------------------
// A synthetic position for the null-defender branch: seat 1 owns ONLY the target base, so there is NO other
// eligible defender within range → representativeDefender(game, target, 1) === null.
// ---------------------------------------------------------------------------
const NO_DEF_TARGET: Hex = synthHex(0, 0);
const NO_DEF_ATTACKERS: Hex[] = [synthHex(1, 0), synthHex(2, -1), synthHex(0, 2)];

function noDefenderGame(): GameState {
  const bases: Base[] = [
    synthBase(1, NO_DEF_TARGET, 0), // seat 1's ONLY base — the target itself, which is excluded as its own defender
    synthBase(0, NO_DEF_ATTACKERS[0]!, 1),
    synthBase(0, NO_DEF_ATTACKERS[1]!, 2),
    synthBase(0, NO_DEF_ATTACKERS[2]!, 3),
  ];
  const rng: RngState = makeSeed(1n);
  return {
    board: { hexes: boardHexes(6), iron: [NO_DEF_ATTACKERS[0]!, NO_DEF_TARGET] },
    bases,
    factories: [],
    players: Array.from({ length: 2 }, (_, id) => ({ id, basesInHand: 12, alliance: [id], eliminated: false })),
    phase: { turn: 3, order: [0, 1], indexInOrder: 0 },
    factorySupply: 36,
    config: defaultConfig(),
    rngState: rng,
  };
}
