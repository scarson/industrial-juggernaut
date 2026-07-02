// ABOUTME: A4.3 attack command — defender proposal/substitution, write-lock carve-out, chainAttacker/endRound,
// ABOUTME: and the atomic attack+auto-close composition. Synthetic PLAY-phase states (iron ON base hexes; A4.2 trap).
import { test, expect, describe } from "vitest";
import { openSession, applyCommand } from "../../src/session/session";
import { logKey, SNAPSHOT_KEY, PENDING_KEY } from "../../src/session/keys";
import { PENDING_TOMBSTONE } from "../../src/session/session-types";
import { DEFAULT_ROOM_OPTIONS } from "../../src/wire/protocol";
import type { RoomOptions } from "../../src/wire/protocol";
import { defaultConfig } from "../../src/engine/config";
import { seed } from "../../src/rng/pcg";
import { key } from "../../src/geometry/cube";
import { representativeDefender, legalActions } from "../../src/index";
import type { Base, GameState, Hex, PlayerId, RngState, AttackDecl } from "../../src/engine/types";
import type { SessionHeader, SeatConfig } from "../../src/session/types";
import type { CommandCtx, SessionState, Pending } from "../../src/session/session-types";

// ---------------------------------------------------------------------------
// Synthetic PLAY-phase attack position — mirrors test/session/auto-close.test.ts.
// A real attack is applied via applyCommand/commitEntries/applyEntry. The A4.2
// Discoveries trap: a synthetic board with board.iron:[] gets BOTH players
// silently eliminated (noIron) the moment an entry routes through
// applyEliminations. Fix: place iron directly ON base hexes (controlled in both
// radiating and perimeter regimes), so neither side is eliminated mid-attack.
// Fixed seeds throughout.
// ---------------------------------------------------------------------------

const CONFIG = defaultConfig();
const RANGE = CONFIG.attackRange; // 6

/** A valid cube-coordinate hex (x+y+z=0). */
function hex(x: number, y: number): Hex {
  return { x, y, z: -x - y };
}

/** Cube distance — mirrors src/geometry/cube distance for test-side reasoning. */
function dist(a: Hex, b: Hex): number {
  return (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z)) / 2;
}

/** A fresh base literal. */
function base(owner: PlayerId, h: Hex, order: number, state: Base["state"] = "fresh"): Base {
  return { owner, hex: h, state, order };
}

/**
 * A minimal synthetic PLAY-phase GameState. `iron` MUST include one hex ON each
 * player's base cluster (on-hex control survives both regimes) or applyEliminations
 * wipes a player out (noIron) mid-attack. Player 0 is the current player (attacker):
 * order[0]=0, indexInOrder 0, turn 3 (a play-phase round; attack never advanceRound).
 */
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

/** A header whose seat kinds are supplied (attacker seat 0, defender seat 1). */
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

/** A SessionState whose game is the supplied synthetic position; logLength primed to 7. */
function mkSession(game: GameState, seats: SeatConfig[], roomOptions: RoomOptions = DEFAULT_ROOM_OPTIONS): SessionState {
  const s = openSession(mkHeader(seats), roomOptions);
  return { ...s, game, logLength: 7 };
}

// Canonical geometry. Attacker = player 0, defender-owner = player 1. Target T at origin.
const T = hex(0, 0);

// ---------------------------------------------------------------------------
// SCENARIO A — attacker EXHAUSTED after this attack (only 3 fresh bases committed;
// nothing left in range). A human attack here auto-closes the round in ONE put.
// ---------------------------------------------------------------------------
const A_ATTACKERS: Hex[] = [hex(1, 0), hex(2, -1), hex(0, 2)];
const A_DEF = hex(-1, 0); // the defender base player 1 owns, in range of T
const A_IRON: Hex[] = [A_ATTACKERS[0]!, A_DEF]; // iron ON base hexes (both survive)
function exhaustedBases(): Base[] {
  return [
    base(1, T, 0),
    base(1, A_DEF, 1),
    base(0, A_ATTACKERS[0]!, 2),
    base(0, A_ATTACKERS[1]!, 3),
    base(0, A_ATTACKERS[2]!, 4),
  ];
}
const A_DECL: AttackDecl = { target: T, attackers: A_ATTACKERS, defender: A_DEF };

// ---------------------------------------------------------------------------
// SCENARIO B — a legal attack REMAINS after this attack (spare cluster in range of
// a second target). A human attack here leaves the round open → chainAttacker set.
// (Board copied from auto-close.test.ts "legal attack remains" scenario.)
// ---------------------------------------------------------------------------
const B_ATTACKERS: Hex[] = [hex(1, 0), hex(2, -1), hex(0, 2)];
const B_DEF = hex(-1, 0);
const B_T2 = hex(-3, 3);
const B_DEF_T2 = hex(-3, 2);
const B_DEF_B2 = hex(1, -3);
const B_SPARE: Hex[] = [hex(-2, 3), hex(-3, 4), hex(-4, 4)];
const B_IRON: Hex[] = [B_SPARE[0]!, B_T2];
function remainsBases(): Base[] {
  return [
    base(1, T, 0),
    base(1, B_DEF, 1),
    base(1, B_T2, 2),
    base(1, B_DEF_T2, 3),
    base(1, B_DEF_B2, 4),
    base(0, B_ATTACKERS[0]!, 5),
    base(0, B_ATTACKERS[1]!, 6),
    base(0, B_ATTACKERS[2]!, 7),
    base(0, B_SPARE[0]!, 8),
    base(0, B_SPARE[1]!, 9),
    base(0, B_SPARE[2]!, 10),
  ];
}
const B_DECL: AttackDecl = { target: T, attackers: B_ATTACKERS, defender: B_DEF };

const HUMAN: SeatConfig = { kind: "human" };
const AGENT: SeatConfig = { kind: "agent", agent: "heuristic" };

// ===========================================================================
// 1. Human attacker vs AGENT defender — applies immediately, one atomic put.
// ===========================================================================
describe("human attacker vs agent defender", () => {
  test("EXHAUSTED: applies + auto-closes in ONE put (log:N attack + endRound + snapshot); representativeDefender substituted", () => {
    const pre = synthGame(exhaustedBases(), { iron: A_IRON });
    const s = mkSession(pre, [HUMAN, AGENT]);
    const idx = s.logLength;
    // The attacker (player 0) is a human; the defender-owner (player 1) is an agent → auto-substitute.
    const expectedDefender = representativeDefender(pre, T, 1);
    expect(expectedDefender).not.toBeNull();

    const { next, effects } = applyCommand(s, { type: "attack", expectedLogIndex: idx, decl: A_DECL }, mkCtx(0));

    // No write-lock — the attack applied immediately (agent defender needs no prompt).
    expect(next.pending).toBeNull();
    expect(effects.toSeat).toEqual([]);

    // Atomicity mechanism: ONE persist.put carrying attack log:N, its auto-close endRound log:N+1, and the snapshot.
    expect(effects.persist).not.toBeNull();
    const putKeys = Object.keys(effects.persist!.put).sort();
    expect(putKeys).toEqual([SNAPSHOT_KEY, logKey(idx), logKey(idx + 1)].sort());

    // The attack entry logs the substituted representativeDefender (not the proposal's placeholder is fine here,
    // but we assert the substituted defender explicitly).
    const attackEntry = effects.persist!.put[logKey(idx)] as { kind: string; decl: AttackDecl };
    expect(attackEntry.kind).toBe("attack");
    expect(attackEntry.decl.defender).toEqual(expectedDefender);
    expect(attackEntry.decl.target).toEqual(T);
    expect(attackEntry.decl.attackers).toEqual(A_ATTACKERS);
    const closeEntry = effects.persist!.put[logKey(idx + 1)] as { kind: string; player: number };
    expect(closeEntry.kind).toBe("endRound");
    expect(closeEntry.player).toBe(0);

    // logLength advanced by exactly two entries; chainAttacker cleared (round closed).
    expect(next.logLength).toBe(idx + 2);
    expect(next.chainAttacker).toBeNull();

    // Broadcast: applied(attack), applied(endRound), turnRollover (round closed, no victory here).
    const kinds = effects.broadcast.map((m) => m.type);
    expect(kinds).toEqual(["applied", "applied", "turnRollover"]);
  });

  test("REMAINS: applies WITHOUT auto-close (one attack log:N only), chainAttacker set to the attacker", () => {
    const pre = synthGame(remainsBases(), { iron: B_IRON });
    const s = mkSession(pre, [HUMAN, AGENT]);
    const idx = s.logLength;

    const { next, effects } = applyCommand(s, { type: "attack", expectedLogIndex: idx, decl: B_DECL }, mkCtx(0));

    expect(next.pending).toBeNull();
    // A legal attack remains → NO endRound, NO snapshot. Just the one attack entry.
    const putKeys = Object.keys(effects.persist!.put);
    expect(putKeys).toEqual([logKey(idx)]);
    expect(next.logLength).toBe(idx + 1);
    // Chain continues → chainAttacker is the acting seat.
    expect(next.chainAttacker).toBe(0);
    // Only the applied broadcast, no turnRollover.
    expect(effects.broadcast.map((m) => m.type)).toEqual(["applied"]);
  });
});

// ===========================================================================
// 2. Human attacker vs HUMAN defender — opens a pending (write-lock), no log entry.
// ===========================================================================
describe("human attacker vs human defender", () => {
  test("opens a pending: PENDING_KEY only in the put, prompt toSeat'd to the defender, next.pending set", () => {
    const pre = synthGame(exhaustedBases(), { iron: A_IRON });
    const s = mkSession(pre, [HUMAN, HUMAN]);
    const ctx = mkCtx(0, { decisionId: "d-open" });

    const { next, effects } = applyCommand(s, { type: "attack", expectedLogIndex: s.logLength, decl: A_DECL }, ctx);

    // Write-lock held: pending set, NO log entry appended.
    expect(next.pending).not.toBeNull();
    expect(next.pending!.decisionId).toBe("d-open");
    expect(next.pending!.promptedSeat).toBe(1);
    expect(next.pending!.declaringPlayer).toBe(0);
    expect(next.logLength).toBe(s.logLength); // unchanged — no entry

    // The put carries ONLY the pending (no log:N, no snapshot).
    expect(effects.persist).not.toBeNull();
    expect(Object.keys(effects.persist!.put)).toEqual([PENDING_KEY]);

    // Prompt goes to the defender seat.
    expect(effects.toSeat).toHaveLength(1);
    expect(effects.toSeat[0]!.seat).toBe(1);
    expect(effects.toSeat[0]!.message.type).toBe("prompt");
    // No broadcast (nothing applied yet).
    expect(effects.broadcast).toEqual([]);
  });

  test("write-lock: a concurrent build from ANY seat while pending → DECISION_PENDING, identity, no persist", () => {
    const pre = synthGame(exhaustedBases(), { iron: A_IRON });
    const s0 = mkSession(pre, [HUMAN, HUMAN]);
    const opened = applyCommand(s0, { type: "attack", expectedLogIndex: s0.logLength, decl: A_DECL }, mkCtx(0, { decisionId: "d-lock" }));
    const s = opened.next;
    expect(s.pending).not.toBeNull();

    // A build from the ATTACKER (seat 0, the "currentActor") is blocked by the write-lock.
    const r0 = applyCommand(s, { type: "build", expectedLogIndex: s.logLength, pieces: [] }, mkCtx(0));
    expect(r0.next).toBe(s);
    expect(r0.effects.persist).toBeNull();
    expect(r0.effects.reply).toHaveLength(1);
    expect(r0.effects.reply[0]!.type).toBe("error");
    if (r0.effects.reply[0]!.type !== "error") throw new Error("expected error");
    expect(r0.effects.reply[0]!.code).toBe("DECISION_PENDING");

    // A build from the DEFENDER (seat 1) is ALSO blocked (only a matching resolveDecision gets through).
    const r1 = applyCommand(s, { type: "build", expectedLogIndex: s.logLength, pieces: [] }, mkCtx(1));
    expect(r1.next).toBe(s);
    expect(r1.effects.persist).toBeNull();
    if (r1.effects.reply[0]!.type !== "error") throw new Error("expected error");
    expect(r1.effects.reply[0]!.code).toBe("DECISION_PENDING");
  });
});

// ===========================================================================
// 3. Bad attacker set → INVALID_ATTACKERS/DUP_ATTACKERS, NO write-lock acquired.
// ===========================================================================
describe("attacker validation precedes the write-lock", () => {
  test("too few attackers → INVALID_ATTACKERS, next.pending null, identity, no persist", () => {
    const pre = synthGame(exhaustedBases(), { iron: A_IRON });
    const s = mkSession(pre, [HUMAN, HUMAN]);
    const decl: AttackDecl = { target: T, attackers: A_ATTACKERS.slice(0, 2), defender: A_DEF };

    const { next, effects } = applyCommand(s, { type: "attack", expectedLogIndex: s.logLength, decl }, mkCtx(0));

    expect(next).toBe(s); // identity — NO write-lock, NO pending
    expect(next.pending).toBeNull();
    expect(effects.persist).toBeNull();
    if (effects.reply[0]!.type !== "error") throw new Error("expected error");
    expect(effects.reply[0]!.code).toBe("INVALID_ATTACKERS");
  });

  test("duplicate attackers → DUP_ATTACKERS, no write-lock", () => {
    const pre = synthGame(exhaustedBases(), { iron: A_IRON });
    const s = mkSession(pre, [HUMAN, HUMAN]);
    const decl: AttackDecl = { target: T, attackers: [A_ATTACKERS[0]!, A_ATTACKERS[1]!, A_ATTACKERS[1]!], defender: A_DEF };

    const { next, effects } = applyCommand(s, { type: "attack", expectedLogIndex: s.logLength, decl }, mkCtx(0));

    expect(next).toBe(s);
    expect(next.pending).toBeNull();
    expect(effects.persist).toBeNull();
    if (effects.reply[0]!.type !== "error") throw new Error("expected error");
    expect(effects.reply[0]!.code).toBe("DUP_ATTACKERS");
  });

  test("out-of-range attacker → INVALID_ATTACKERS, no write-lock", () => {
    const far = hex(6, 1); // dist 7 > range 6
    expect(dist(far, T)).toBeGreaterThan(RANGE);
    const bases: Base[] = [
      base(1, T, 0),
      base(1, A_DEF, 1),
      base(0, A_ATTACKERS[0]!, 2),
      base(0, A_ATTACKERS[1]!, 3),
      base(0, far, 4),
    ];
    const s = mkSession(synthGame(bases, { iron: [A_ATTACKERS[0]!, A_DEF] }), [HUMAN, HUMAN]);
    const decl: AttackDecl = { target: T, attackers: [A_ATTACKERS[0]!, A_ATTACKERS[1]!, far], defender: A_DEF };

    const { next, effects } = applyCommand(s, { type: "attack", expectedLogIndex: s.logLength, decl }, mkCtx(0));

    expect(next).toBe(s);
    expect(next.pending).toBeNull();
    expect(effects.persist).toBeNull();
    if (effects.reply[0]!.type !== "error") throw new Error("expected error");
    expect(effects.reply[0]!.code).toBe("INVALID_ATTACKERS");
  });
});

// ===========================================================================
// 4. Unattackable target → NO_ELIGIBLE_DEFENDER. No base at target → MALFORMED.
// ===========================================================================
describe("target guards", () => {
  test("target with no eligible defender → NO_ELIGIBLE_DEFENDER, no write-lock", () => {
    // Defender-owner (player 1) owns ONLY the target base — no other in-range fresh base to defend.
    const bases: Base[] = [
      base(1, T, 0),
      base(0, A_ATTACKERS[0]!, 1),
      base(0, A_ATTACKERS[1]!, 2),
      base(0, A_ATTACKERS[2]!, 3),
    ];
    const s = mkSession(synthGame(bases, { iron: [A_ATTACKERS[0]!, T] }), [HUMAN, HUMAN]);

    const { next, effects } = applyCommand(s, { type: "attack", expectedLogIndex: s.logLength, decl: A_DECL }, mkCtx(0));

    expect(next).toBe(s);
    expect(next.pending).toBeNull();
    expect(effects.persist).toBeNull();
    if (effects.reply[0]!.type !== "error") throw new Error("expected error");
    expect(effects.reply[0]!.code).toBe("NO_ELIGIBLE_DEFENDER");
  });

  test("no base at the target hex → MALFORMED, no write-lock", () => {
    const pre = synthGame(exhaustedBases(), { iron: A_IRON });
    const s = mkSession(pre, [HUMAN, HUMAN]);
    const emptyHex = hex(4, 0); // no base sits here
    const decl: AttackDecl = { target: emptyHex, attackers: A_ATTACKERS, defender: A_DEF };

    const { next, effects } = applyCommand(s, { type: "attack", expectedLogIndex: s.logLength, decl }, mkCtx(0));

    expect(next).toBe(s);
    expect(next.pending).toBeNull();
    expect(effects.persist).toBeNull();
    if (effects.reply[0]!.type !== "error") throw new Error("expected error");
    expect(effects.reply[0]!.code).toBe("MALFORMED");
  });
});

// ===========================================================================
// 5. resolveDecision happy path — atomic log:N (+ auto-close) + PENDING_TOMBSTONE, alarm cleared, pending nulled.
// ===========================================================================
describe("resolveDecision happy path", () => {
  test("prompted defender resolves with an eligible defender → ONE put with attack log:N, endRound, snapshot, PENDING_TOMBSTONE; alarm clear; pending nulled", () => {
    const roomOptions: RoomOptions = { defenderTimeout: { enabled: true, seconds: 120 } };
    const pre = synthGame(exhaustedBases(), { iron: A_IRON });
    const s0 = mkSession(pre, [HUMAN, HUMAN], roomOptions);
    const opened = applyCommand(s0, { type: "attack", expectedLogIndex: s0.logLength, decl: A_DECL }, mkCtx(0, { decisionId: "d-r" }));
    const s = opened.next;
    expect(s.pending).not.toBeNull();
    const idx = s.logLength;

    // The prompted defender (seat 1) picks the eligible defender A_DEF.
    const { next, effects } = applyCommand(
      s,
      { type: "resolveDecision", expectedLogIndex: idx, decisionId: "d-r", defender: A_DEF },
      mkCtx(1),
    );

    // Atomicity: ONE put with the attack log:N, its auto-close endRound, the snapshot, AND the pending tombstone.
    expect(effects.persist).not.toBeNull();
    const put = effects.persist!.put;
    expect(put).toHaveProperty(logKey(idx));
    expect(put).toHaveProperty(logKey(idx + 1)); // auto-close endRound (exhausted attacker)
    expect(put).toHaveProperty(SNAPSHOT_KEY);
    expect(put[PENDING_KEY]).toBe(PENDING_TOMBSTONE);

    const attackEntry = put[logKey(idx)] as { kind: string; decl: AttackDecl };
    expect(attackEntry.kind).toBe("attack");
    expect(attackEntry.decl.defender).toEqual(A_DEF);
    expect((put[logKey(idx + 1)] as { kind: string }).kind).toBe("endRound");

    // Pending nulled; alarm cleared; chainAttacker cleared (round closed).
    expect(next.pending).toBeNull();
    expect(effects.alarm).toEqual({ action: "clear" });
    expect(next.chainAttacker).toBeNull();
    expect(next.logLength).toBe(idx + 2);
  });
});

// ===========================================================================
// 6. resolveDecision auth: stale id → ALREADY_RESOLVED; wrong seat → NOT_YOUR_TURN; ineligible → error, pending STAYS.
// ===========================================================================
describe("resolveDecision authorization", () => {
  function openedHumanPending(): SessionState {
    const pre = synthGame(exhaustedBases(), { iron: A_IRON });
    const s0 = mkSession(pre, [HUMAN, HUMAN]);
    return applyCommand(s0, { type: "attack", expectedLogIndex: s0.logLength, decl: A_DECL }, mkCtx(0, { decisionId: "d-auth" })).next;
  }

  test("wrong decisionId → ALREADY_RESOLVED, identity, pending stays", () => {
    const s = openedHumanPending();
    const { next, effects } = applyCommand(
      s,
      { type: "resolveDecision", expectedLogIndex: s.logLength, decisionId: "STALE-ID", defender: A_DEF },
      mkCtx(1),
    );
    expect(next).toBe(s);
    expect(next.pending).not.toBeNull(); // pending untouched
    expect(effects.persist).toBeNull();
    if (effects.reply[0]!.type !== "error") throw new Error("expected error");
    expect(effects.reply[0]!.code).toBe("ALREADY_RESOLVED");
  });

  test("matching id from the WRONG seat → NOT_YOUR_TURN, identity, pending stays", () => {
    const s = openedHumanPending();
    // Seat 0 (the attacker) tries to answer the defender's decision — only the prompted seat may.
    const { next, effects } = applyCommand(
      s,
      { type: "resolveDecision", expectedLogIndex: s.logLength, decisionId: "d-auth", defender: A_DEF },
      mkCtx(0),
    );
    expect(next).toBe(s);
    expect(next.pending).not.toBeNull();
    expect(effects.persist).toBeNull();
    if (effects.reply[0]!.type !== "error") throw new Error("expected error");
    expect(effects.reply[0]!.code).toBe("NOT_YOUR_TURN");
  });

  test("ineligible defender choice → DEFENDER_INELIGIBLE, no persist, PENDING STAYS", () => {
    const s = openedHumanPending();
    const ineligible = hex(6, 1); // out of range / not owned by defender
    const { next, effects } = applyCommand(
      s,
      { type: "resolveDecision", expectedLogIndex: s.logLength, decisionId: "d-auth", defender: ineligible },
      mkCtx(1),
    );
    // The pending MUST stay so the defender can retry with a valid choice.
    expect(next).toBe(s);
    expect(next.pending).not.toBeNull();
    expect(next.pending!.decisionId).toBe("d-auth");
    expect(effects.persist).toBeNull();
    if (effects.reply[0]!.type !== "error") throw new Error("expected error");
    expect(effects.reply[0]!.code).toBe("DEFENDER_INELIGIBLE");
  });

  test("resolveDecision with NO pending decision → ALREADY_RESOLVED (never crashes the reducer)", () => {
    // A resolveDecision can arrive after the decision was already resolved and cleared (a lost-ack retry, or a
    // ghost id). With no pending, the write-lock carve-out's ALREADY_RESOLVED branch isn't reached (that branch
    // only runs while pending); the switch case must itself reject rather than deref a null pending.
    const pre = synthGame(exhaustedBases(), { iron: A_IRON });
    const s = mkSession(pre, [HUMAN, HUMAN]); // no pending set
    expect(s.pending).toBeNull();
    const { next, effects } = applyCommand(
      s,
      { type: "resolveDecision", expectedLogIndex: s.logLength, decisionId: "ghost", defender: A_DEF },
      mkCtx(0),
    );
    expect(next).toBe(s);
    expect(effects.persist).toBeNull();
    if (effects.reply[0]!.type !== "error") throw new Error("expected error");
    expect(effects.reply[0]!.code).toBe("ALREADY_RESOLVED");
  });

  test("STALE_INDEX still applies to a matching resolveDecision (resync-then-retry client)", () => {
    const s = openedHumanPending();
    const { next, effects } = applyCommand(
      s,
      { type: "resolveDecision", expectedLogIndex: 999, decisionId: "d-auth", defender: A_DEF },
      mkCtx(1),
    );
    expect(next).toBe(s);
    expect(next.pending).not.toBeNull();
    expect(effects.persist).toBeNull();
    if (effects.reply[0]!.type !== "resync") throw new Error("expected resync");
    expect(effects.reply[0]!.reason).toBe("STALE_INDEX");
  });
});

// ===========================================================================
// 7. extendDecision: matching id + prompted seat (timeout ON) → deadline pushed + alarm re-armed;
//    wrong id → ALREADY_RESOLVED; wrong seat → NOT_YOUR_TURN; timeout OFF → no-op effects.
// ===========================================================================
describe("extendDecision", () => {
  function openedPending(roomOptions: RoomOptions): SessionState {
    const pre = synthGame(exhaustedBases(), { iron: A_IRON });
    const s0 = mkSession(pre, [HUMAN, HUMAN], roomOptions);
    return applyCommand(
      s0,
      { type: "attack", expectedLogIndex: s0.logLength, decl: A_DECL },
      mkCtx(0, { decisionId: "d-ext", nowEpochMs: 1_000_000 }),
    ).next;
  }

  test("timeout ON, matching id, prompted seat → deadline pushed, alarm re-armed", () => {
    const roomOptions: RoomOptions = { defenderTimeout: { enabled: true, seconds: 90 } };
    const s = openedPending(roomOptions);
    expect(s.pending!.deadlineEpochMs).toBe(1_000_000 + 90 * 1000);

    const { next, effects } = applyCommand(s, { type: "extendDecision", decisionId: "d-ext" }, mkCtx(1, { nowEpochMs: 5_000_000 }));

    const expected = 5_000_000 + 90 * 1000;
    expect(next.pending!.deadlineEpochMs).toBe(expected);
    expect(effects.alarm).toEqual({ action: "set", atEpochMs: expected });
    expect(effects.persist).not.toBeNull();
    expect(Object.keys(effects.persist!.put)).toEqual([PENDING_KEY]);
    expect(next.logLength).toBe(s.logLength); // no log entry
  });

  test("wrong id → ALREADY_RESOLVED, identity", () => {
    const roomOptions: RoomOptions = { defenderTimeout: { enabled: true, seconds: 90 } };
    const s = openedPending(roomOptions);
    const { next, effects } = applyCommand(s, { type: "extendDecision", decisionId: "OTHER" }, mkCtx(1));
    expect(next).toBe(s);
    expect(effects.persist).toBeNull();
    if (effects.reply[0]!.type !== "error") throw new Error("expected error");
    expect(effects.reply[0]!.code).toBe("ALREADY_RESOLVED");
  });

  test("wrong seat (matching id) → NOT_YOUR_TURN, identity", () => {
    const roomOptions: RoomOptions = { defenderTimeout: { enabled: true, seconds: 90 } };
    const s = openedPending(roomOptions);
    // Seat 0 (attacker) tries to reset the defender's liveness clock — rejected.
    const { next, effects } = applyCommand(s, { type: "extendDecision", decisionId: "d-ext" }, mkCtx(0));
    expect(next).toBe(s);
    expect(effects.persist).toBeNull();
    if (effects.reply[0]!.type !== "error") throw new Error("expected error");
    expect(effects.reply[0]!.code).toBe("NOT_YOUR_TURN");
  });

  test("timeout OFF room → matching id + prompted seat → no-op effects (identity)", () => {
    const s = openedPending(DEFAULT_ROOM_OPTIONS); // defenderTimeout OFF
    expect(s.pending!.deadlineEpochMs).toBeNull();
    const { next, effects } = applyCommand(s, { type: "extendDecision", decisionId: "d-ext" }, mkCtx(1, { nowEpochMs: 5_000_000 }));
    // extendDefender no-ops when the timeout is off → next === s, NO_EFFECTS.
    expect(next).toBe(s);
    expect(effects.persist).toBeNull();
    expect(effects.alarm).toBeNull();
    expect(effects.reply).toEqual([]);
    expect(effects.broadcast).toEqual([]);
    expect(effects.toSeat).toEqual([]);
  });
});

// ===========================================================================
// 8. chainAttacker + endRound.
// ===========================================================================
describe("chainAttacker + endRound", () => {
  test("an attack leaving a legal attack open sets chainAttacker; endRound from that attacker closes the round and nulls it", () => {
    const pre = synthGame(remainsBases(), { iron: B_IRON });
    const s0 = mkSession(pre, [HUMAN, AGENT]);
    const idx = s0.logLength;
    const opened = applyCommand(s0, { type: "attack", expectedLogIndex: idx, decl: B_DECL }, mkCtx(0));
    const s = opened.next;
    expect(s.chainAttacker).toBe(0);
    expect(s.logLength).toBe(idx + 1);

    // endRound from the chain attacker closes the round: snapshot + rollover, chainAttacker nulled.
    const { next, effects } = applyCommand(s, { type: "endRound", expectedLogIndex: s.logLength }, mkCtx(0));
    const putKeys = Object.keys(effects.persist!.put).sort();
    expect(putKeys).toEqual([SNAPSHOT_KEY, logKey(s.logLength)].sort());
    expect(next.chainAttacker).toBeNull();
    expect(next.logLength).toBe(s.logLength + 1);
    // A round-close broadcast (turnRollover or gameOver) accompanies the applied endRound.
    const kinds = effects.broadcast.map((m) => m.type);
    expect(kinds[0]).toBe("applied");
    expect(["turnRollover", "gameOver"]).toContain(kinds[1]);
  });

  test("a legal build that closes the round mid-chain clears chainAttacker (no stale turn-skip token, DER #5)", () => {
    // Open a chain as seat 0 (agent defender → applies immediately, chainAttacker=0), then seat 0 sends a LEGAL
    // build (legalActions offers build mid-chain). A build self-closes the round; without clearing chainAttacker
    // it would linger as 0 and let seat 0 later endRound at round-start to skip a turn — the exact DER #5 exploit
    // the chainAttacker guard exists to prevent.
    const pre = synthGame(remainsBases(), { iron: B_IRON });
    const s0 = mkSession(pre, [HUMAN, AGENT]);
    const s = applyCommand(s0, { type: "attack", expectedLogIndex: s0.logLength, decl: B_DECL }, mkCtx(0)).next;
    expect(s.chainAttacker).toBe(0);

    // Pick a genuinely legal single-piece build from the post-attack legal set (not a hand-picked hex).
    const build = legalActions(s.game).find(
      (a): a is Extract<typeof a, { kind: "build" }> => a.kind === "build" && a.pieces.length === 1,
    );
    if (build === undefined) throw new Error("expected a legal single-piece build mid-chain");
    const pieces = build.pieces.map((p) => ({ type: p.type, hex: p.hex }));

    const { next, effects } = applyCommand(s, { type: "build", expectedLogIndex: s.logLength, pieces }, mkCtx(0));

    // The build closed the round (snapshot present) → chainAttacker MUST be cleared (non-vacuous).
    expect(effects.persist).not.toBeNull();
    expect(Object.keys(effects.persist!.put)).toContain(SNAPSHOT_KEY);
    expect(next.chainAttacker).toBeNull();
  });

  test("endRound at round start (no open chain) → NOT_YOUR_TURN, identity, no persist", () => {
    // Fresh play-phase state, no attack yet → chainAttacker null → endRound is illegal (would skip the turn, DER #5).
    const pre = synthGame(remainsBases(), { iron: B_IRON });
    const s = mkSession(pre, [HUMAN, AGENT]);
    expect(s.chainAttacker).toBeNull();

    const { next, effects } = applyCommand(s, { type: "endRound", expectedLogIndex: s.logLength }, mkCtx(0));
    expect(next).toBe(s);
    expect(effects.persist).toBeNull();
    if (effects.reply[0]!.type !== "error") throw new Error("expected error");
    expect(effects.reply[0]!.code).toBe("NOT_YOUR_TURN");
  });

  test("endRound from a DIFFERENT seat mid-chain → NOT_YOUR_TURN, identity", () => {
    // Open a chain as seat 0 (attack applies immediately — agent defender), then have seat 1 try to close it.
    // Only chainAttacker===actingSeat may endRound; seat 1 is also not the currentActor, so NOT_YOUR_TURN fires.
    const pre = synthGame(remainsBases(), { iron: B_IRON });
    const s0 = mkSession(pre, [HUMAN, AGENT]);
    const s = applyCommand(s0, { type: "attack", expectedLogIndex: s0.logLength, decl: B_DECL }, mkCtx(0)).next;
    expect(s.chainAttacker).toBe(0);

    const { next, effects } = applyCommand(s, { type: "endRound", expectedLogIndex: s.logLength }, mkCtx(1));
    expect(next).toBe(s);
    expect(effects.persist).toBeNull();
    if (effects.reply[0]!.type !== "error") throw new Error("expected error");
    expect(effects.reply[0]!.code).toBe("NOT_YOUR_TURN");
  });
});
