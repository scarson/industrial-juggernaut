// ABOUTME: A6.1 resyncPayload seat-filtered pending + the resync command — logLength/snapshot/roster/versions/reason,
// ABOUTME: defender-prompt privacy (prompted seat only, both directions asserted), and the resync/STALE_INDEX wiring.
import { test, expect, describe } from "vitest";
import { openSession, applyCommand, resyncPayload } from "../../src/session/session";
import { decodeState } from "../../src/wire/codec";
import { stateHash } from "../../src/session/hash";
import { DEFAULT_ROOM_OPTIONS, PROTOCOL_VERSION } from "../../src/wire/protocol";
import type { RoomOptions } from "../../src/wire/protocol";
import { defaultConfig } from "../../src/engine/config";
import { seed } from "../../src/rng/pcg";
import { key } from "../../src/geometry/cube";
import type { Base, GameState, Hex, PlayerId, RngState, AttackDecl } from "../../src/engine/types";
import type { SessionHeader, SeatConfig } from "../../src/session/types";
import type { CommandCtx, SessionState } from "../../src/session/session-types";
import type { EncodedPending } from "../../src/wire/protocol";

const CONFIG = defaultConfig();

// ---------------------------------------------------------------------------
// Synthetic PLAY-phase attack position, mirroring test/session/attack-command.test.ts
// (same fixture shape — iron placed ON base hexes so neither side is noIron-eliminated
// mid-attack; see that file's header comment for the full trap explanation).
// ---------------------------------------------------------------------------

/** A valid cube-coordinate hex (x+y+z=0). */
function hex(x: number, y: number): Hex {
  return { x, y, z: -x - y };
}

/** A fresh base literal. */
function base(owner: PlayerId, h: Hex, order: number, state: Base["state"] = "fresh"): Base {
  return { owner, hex: h, state, order };
}

function synthGame(bases: Base[], opts?: { rng?: RngState; turn?: number; nPlayers?: number; iron?: Hex[] }): GameState {
  const nPlayers = opts?.nPlayers ?? 2;
  const allHexes = new Set<string>();
  const hexes: Hex[] = [];
  for (let x = -6; x <= 6; x++) {
    for (let y = -6; y <= 6; y++) {
      const h = hex(x, y);
      if (Math.abs(h.z) <= 6 && !allHexes.has(key(h))) {
        allHexes.add(key(h));
        hexes.push(h);
      }
    }
  }
  return {
    board: { hexes, iron: opts?.iron ?? [] },
    bases,
    factories: [],
    players: Array.from({ length: nPlayers }, (_, id) => ({
      id, basesInHand: 12, alliance: [id], eliminated: false,
    })),
    phase: { turn: opts?.turn ?? 3, order: Array.from({ length: nPlayers }, (_, i) => i), indexInOrder: 0 },
    factorySupply: 36,
    config: CONFIG,
    rngState: opts?.rng ?? seed(1n),
  };
}

function mkHeader(seats: SeatConfig[]): SessionHeader {
  return {
    formatVersion: 1,
    replayVersion: "test",
    seed: 42n,
    config: CONFIG,
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    seats,
  };
}

function mkCtx(actingSeat: number, opts?: { nowEpochMs?: number; decisionId?: string }): CommandCtx {
  return {
    actingSeat,
    nowEpochMs: opts?.nowEpochMs ?? 1_000_000,
    decisionId: opts?.decisionId ?? "decision-xyz",
  };
}

function mkSession(game: GameState, seats: SeatConfig[], roomOptions: RoomOptions = DEFAULT_ROOM_OPTIONS): SessionState {
  const s = openSession(mkHeader(seats), roomOptions);
  return { ...s, game, logLength: 7 };
}

const HUMAN: SeatConfig = { kind: "human" };

// Attacker = player 0, defender-owner = player 1. Target T at origin. (attack-command.test.ts's "exhausted" fixture:
// attacker commits all 3 fresh bases, nothing left in range → the human-vs-human attack opens a pending and, once
// resolved, auto-closes the round in one put.)
const T = hex(0, 0);
const ATTACKERS: Hex[] = [hex(1, 0), hex(2, -1), hex(0, 2)];
const DEF = hex(-1, 0); // the defender base player 1 owns, in range of T
const IRON: Hex[] = [ATTACKERS[0]!, DEF];
function exhaustedBases(): Base[] {
  return [
    base(1, T, 0),
    base(1, DEF, 1),
    base(0, ATTACKERS[0]!, 2),
    base(0, ATTACKERS[1]!, 3),
    base(0, ATTACKERS[2]!, 4),
  ];
}
const DECL: AttackDecl = { target: T, attackers: ATTACKERS, defender: DEF };

/** Opens a real human-vs-human pending via the attack command path (attack-command.test.ts's pattern). */
function openedHumanPending(decisionId = "d-resync", opts?: { roomOptions?: RoomOptions; nowEpochMs?: number }): SessionState {
  const pre = synthGame(exhaustedBases(), { iron: IRON });
  const s0 = mkSession(pre, [HUMAN, HUMAN], opts?.roomOptions ?? DEFAULT_ROOM_OPTIONS);
  const opened = applyCommand(
    s0,
    { type: "attack", expectedLogIndex: s0.logLength, decl: DECL },
    mkCtx(0, { decisionId, ...(opts?.nowEpochMs !== undefined ? { nowEpochMs: opts.nowEpochMs } : {}) }),
  );
  if (opened.next.pending === null) throw new Error("expected a pending to open (human defender)");
  return opened.next;
}

// ===========================================================================
// 1. resyncPayload after some moves — logLength, decodable+hash-equal snapshot, roster, versions, reason.
// ===========================================================================
describe("resyncPayload after moves", () => {
  test("carries the correct logLength, a decodable+hash-equal snapshot, roster, versions, and reason", () => {
    const pre = synthGame(exhaustedBases(), { iron: IRON });
    const s = mkSession(pre, [HUMAN, HUMAN]);

    const payload = resyncPayload(s, 0, "manual-refresh");
    if (payload.type !== "resync") throw new Error("expected resync");

    expect(payload.logLength).toBe(s.logLength);
    // Wire fidelity via stateHash, not deep-equality — generated boards can carry -0 cube coords, which JSON
    // canonicalizes to 0 (inert for the engine; key()'s string form and all numeric === comparisons treat -0
    // and 0 identically). See test/wire/codec.test.ts for the same discovery on encodeState round-trips.
    const decoded = decodeState(payload.snapshot);
    expect(stateHash(decoded)).toBe(stateHash(s.game));

    expect(payload.seats).toHaveLength(2);
    expect(payload.seats.map((r) => r.kind)).toEqual(["human", "human"]);
    expect(payload.seats.map((r) => r.seat)).toEqual([0, 1]);

    expect(payload.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(payload.replayVersion).toBe(s.header.replayVersion);
    expect(payload.reason).toBe("manual-refresh");
  });
});

// ===========================================================================
// 2. Prompt privacy (the mechanism assertion) — both directions.
// ===========================================================================
describe("resyncPayload pending privacy", () => {
  test("the PROMPTED seat's resync carries the wire pending (eligible set, no storage-only fields)", () => {
    const s = openedHumanPending();
    const pending = s.pending!;
    expect(pending.promptedSeat).toBe(1); // defender-owner

    const payload = resyncPayload(s, 1, null);
    if (payload.type !== "resync") throw new Error("expected resync");
    expect(payload.pending).not.toBeNull();
    const wire = payload.pending as EncodedPending;

    expect(wire.decisionId).toBe(pending.decisionId);
    expect(wire.kind).toBe("defenderChoice");
    expect(wire.round).toBe(pending.round);
    expect(wire.declaringPlayer).toBe(pending.declaringPlayer);
    expect(wire.promptedSeat).toBe(pending.promptedSeat);
    expect(wire.target).toEqual(pending.proposed.target);
    expect(wire.eligibleDefenders).toEqual([DEF]); // the only fresh in-range base player 1 owns besides the target
    expect(wire.deadlineEpochMs).toBe(pending.deadlineEpochMs);

    // Storage-only fields MUST be absent from the wire projection.
    expect(wire).not.toHaveProperty("rngBeforeApply");
    expect(wire).not.toHaveProperty("preDecisionLogLength");
    expect(wire).not.toHaveProperty("proposed");
  });

  test("ANY OTHER seat's resync carries pending: null", () => {
    const s = openedHumanPending();
    expect(s.pending!.promptedSeat).toBe(1);

    // The attacker (seat 0) — not the prompted seat — must NOT see the defender prompt.
    const payload = resyncPayload(s, 0, null);
    if (payload.type !== "resync") throw new Error("expected resync");
    expect(payload.pending).toBeNull();
  });

  test("no pending set → pending: null regardless of requesting seat", () => {
    const pre = synthGame(exhaustedBases(), { iron: IRON });
    const s = mkSession(pre, [HUMAN, HUMAN]);
    expect(s.pending).toBeNull();

    expect((resyncPayload(s, 0, null) as { pending: unknown }).pending).toBeNull();
    expect((resyncPayload(s, 1, null) as { pending: unknown }).pending).toBeNull();
  });
});

// ===========================================================================
// 3. The `resync` command through applyCommand — non-mutating, works during a pending,
//    seat-privacy follows ctx.actingSeat.
// ===========================================================================
describe("resync command via applyCommand", () => {
  test("routes to a resync reply (not UNKNOWN_TYPE)", () => {
    const pre = synthGame(exhaustedBases(), { iron: IRON });
    const s = mkSession(pre, [HUMAN, HUMAN]);
    const { next, effects } = applyCommand(s, { type: "resync" }, mkCtx(0));

    expect(next).toBe(s); // non-mutating: identity
    expect(effects.persist).toBeNull();
    expect(effects.reply).toHaveLength(1);
    const reply = effects.reply[0]!;
    expect(reply.type).toBe("resync");
    if (reply.type !== "resync") throw new Error("expected resync");
    expect(reply.reason).toBeNull();
    expect(reply.logLength).toBe(s.logLength);
  });

  test("works while a pending is set (non-mutating bypass) — no error, no state change", () => {
    const s = openedHumanPending();
    const { next, effects } = applyCommand(s, { type: "resync" }, mkCtx(0));

    expect(next).toBe(s); // bypassed the write-lock entirely — identity, not just "unchanged fields"
    expect(effects.persist).toBeNull();
    expect(effects.reply).toHaveLength(1);
    expect(effects.reply[0]!.type).toBe("resync");
  });

  test("the reply's pending follows ctx.actingSeat: prompted seat sees it, others don't", () => {
    const s = openedHumanPending();
    expect(s.pending!.promptedSeat).toBe(1);

    const forPrompted = applyCommand(s, { type: "resync" }, mkCtx(1)).effects.reply[0]!;
    if (forPrompted.type !== "resync") throw new Error("expected resync");
    expect(forPrompted.pending).not.toBeNull();

    const forOther = applyCommand(s, { type: "resync" }, mkCtx(0)).effects.reply[0]!;
    if (forOther.type !== "resync") throw new Error("expected resync");
    expect(forOther.pending).toBeNull();
  });

  test("extendDecision → resync: the wire pending carries the EXTENDED deadline, not the original (projection reads the live pending)", () => {
    // End-to-end through applyCommand only: open a pending in a timeout-ON room, extend the deadline, then
    // resync as the prompted seat — the projected pending must reflect the post-extend state, pinning that
    // resyncPayload projects the LIVE s.pending (not a stale copy captured at open/prompt time).
    const roomOptions: RoomOptions = { defenderTimeout: { enabled: true, seconds: 120 } };
    const s0 = openedHumanPending("d-extend", { roomOptions, nowEpochMs: 1_000_000 });
    const originalDeadline = s0.pending!.deadlineEpochMs;
    expect(originalDeadline).toBe(1_000_000 + 120 * 1000); // opened at 1_000_000, timeout 120s

    // The prompted defender (seat 1) extends at a LATER time → the deadline moves.
    const extended = applyCommand(s0, { type: "extendDecision", decisionId: "d-extend" }, mkCtx(1, { nowEpochMs: 5_000_000 }));
    const s1 = extended.next;
    const extendedDeadline = 5_000_000 + 120 * 1000;
    expect(s1.pending!.deadlineEpochMs).toBe(extendedDeadline);
    expect(extendedDeadline).not.toBe(originalDeadline); // non-vacuous: the two values genuinely differ

    // Resync from the prompted seat: the wire pending carries the extended deadline, NOT the original.
    const reply = applyCommand(s1, { type: "resync" }, mkCtx(1)).effects.reply[0]!;
    if (reply.type !== "resync") throw new Error("expected resync");
    expect(reply.pending).not.toBeNull();
    expect(reply.pending!.deadlineEpochMs).toBe(extendedDeadline);
    expect(reply.pending!.deadlineEpochMs).not.toBe(originalDeadline);
  });
});

// ===========================================================================
// 4. STALE_INDEX resyncs (A3's path) also carry the seat-filtered pending.
//
// Reachability design (the A3 guard order — see src/session/session.ts applyCommand):
//   - WHILE a pending is held, the write-lock carve-out (line ~89-115) admits ONLY a
//     resolveDecision matching the pending's decisionId, and ONLY from the PROMPTED
//     seat — every other mutating command (including a resolveDecision from a
//     different seat, or with a stale decisionId) is rejected as DECISION_PENDING /
//     ALREADY_RESOLVED BEFORE the STALE_INDEX check ever runs. So "a stale mutating
//     command from ANOTHER seat during a pending" can never reach STALE_INDEX — the
//     guard order forecloses it. The carve-out's own STALE_INDEX check (line ~103)
//     IS reachable: a matching resolveDecision (correct id, correct prompted seat)
//     with a WRONG expectedLogIndex falls through to resyncEffects — this is
//     Case A below, and its resync carries the pending (ctx.actingSeat ===
//     promptedSeat).
//   - The null-pending case is therefore built from the NO-pending branch (line
//     ~117): any mutating command with a wrong expectedLogIndex when s.pending is
//     null resyncs with pending:null trivially. This still exercises the real
//     wiring (resyncEffects threading ctx.actingSeat through to resyncPayload) —
//     it's just that with no pending object to filter, the "seat" doesn't change
//     the outcome. Both cases together pin resyncEffects's requestingSeat wiring:
//     Case A proves the WITH-pending path is seat-filtered; Case B proves the
//     NO-pending path stays null regardless of seat.
// ===========================================================================
describe("STALE_INDEX resyncs carry the seat-filtered pending", () => {
  test("Case A: a stale resolveDecision from the PROMPTED seat during a pending → resync WITH the pending", () => {
    const s = openedHumanPending("d-stale");
    const promptedSeat = s.pending!.promptedSeat;
    expect(promptedSeat).toBe(1);

    const { next, effects } = applyCommand(
      s,
      { type: "resolveDecision", expectedLogIndex: 999, decisionId: "d-stale", defender: DEF },
      mkCtx(promptedSeat),
    );

    expect(next).toBe(s); // rejected — identity
    expect(effects.persist).toBeNull();
    expect(effects.reply).toHaveLength(1);
    const reply = effects.reply[0]!;
    expect(reply.type).toBe("resync");
    if (reply.type !== "resync") throw new Error("expected resync");
    expect(reply.reason).toBe("STALE_INDEX");
    expect(reply.pending).not.toBeNull(); // ctx.actingSeat (promptedSeat) === s.pending.promptedSeat
  });

  test("Case B: a stale command with no pending set → resync with pending: null", () => {
    const pre = synthGame(exhaustedBases(), { iron: IRON });
    const s = mkSession(pre, [HUMAN, HUMAN]);
    expect(s.pending).toBeNull();

    const { next, effects } = applyCommand(s, { type: "pass", expectedLogIndex: 999 }, mkCtx(0));

    expect(next).toBe(s);
    expect(effects.persist).toBeNull();
    const reply = effects.reply[0]!;
    expect(reply.type).toBe("resync");
    if (reply.type !== "resync") throw new Error("expected resync");
    expect(reply.reason).toBe("STALE_INDEX");
    expect(reply.pending).toBeNull();
  });
});
