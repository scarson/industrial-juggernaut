// ABOUTME: A6.2 hello version handshake — matching versions resync, mismatched protocol/replay version reload,
// ABOUTME: and hello during a pending (non-mutating bypass; the resync carries the seat-filtered pending per A6.1).
import { test, expect, describe } from "vitest";
import { openSession, applyCommand } from "../../src/session/session";
import { DEFAULT_ROOM_OPTIONS, PROTOCOL_VERSION } from "../../src/wire/protocol";
import type { RoomOptions } from "../../src/wire/protocol";
import { defaultConfig } from "../../src/engine/config";
import { seed } from "../../src/rng/pcg";
import { key } from "../../src/geometry/cube";
import type { Base, GameState, Hex, PlayerId, RngState, AttackDecl } from "../../src/engine/types";
import type { SessionHeader, SeatConfig } from "../../src/session/types";
import type { CommandCtx, SessionState } from "../../src/session/session-types";

const CONFIG = defaultConfig();

// ---------------------------------------------------------------------------
// Fixtures mirror test/session/resync.test.ts (same synthetic PLAY-phase attack position).
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

// Attacker = player 0, defender-owner = player 1. Target T at origin. (resync.test.ts's "exhausted" fixture:
// attacker commits all 3 fresh bases, nothing left in range → the human-vs-human attack opens a pending.)
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

/** Opens a real human-vs-human pending via the attack command path. */
function openedHumanPending(decisionId = "d-hello"): SessionState {
  const pre = synthGame(exhaustedBases(), { iron: IRON });
  const s0 = mkSession(pre, [HUMAN, HUMAN]);
  const opened = applyCommand(s0, { type: "attack", expectedLogIndex: s0.logLength, decl: DECL }, mkCtx(0, { decisionId }));
  if (opened.next.pending === null) throw new Error("expected a pending to open (human defender)");
  return opened.next;
}

// ===========================================================================
// 1. Matching versions → full resync reply.
// ===========================================================================
describe("hello with matching versions", () => {
  test("replies with a resync carrying the correct logLength/protocolVersion/replayVersion; state unchanged", () => {
    const pre = synthGame(exhaustedBases(), { iron: IRON });
    const s = mkSession(pre, [HUMAN, HUMAN]);

    const { next, effects } = applyCommand(
      s,
      { type: "hello", protocolVersion: PROTOCOL_VERSION, replayVersion: s.header.replayVersion },
      mkCtx(0),
    );

    expect(next).toBe(s); // non-mutating: identity
    expect(effects.persist).toBeNull();
    expect(effects.reply).toHaveLength(1);
    const reply = effects.reply[0]!;
    expect(reply.type).toBe("resync");
    if (reply.type !== "resync") throw new Error("expected resync");
    expect(reply.logLength).toBe(s.logLength);
    expect(reply.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(reply.replayVersion).toBe(s.header.replayVersion);
  });
});

// ===========================================================================
// 2. Wrong protocolVersion → reload, no resync, no persist, identity.
// ===========================================================================
describe("hello with a mismatched protocolVersion", () => {
  test("replies with exactly {type: 'reload'} — no resync, no persist, state unchanged", () => {
    const pre = synthGame(exhaustedBases(), { iron: IRON });
    const s = mkSession(pre, [HUMAN, HUMAN]);

    const { next, effects } = applyCommand(
      s,
      { type: "hello", protocolVersion: PROTOCOL_VERSION + 1, replayVersion: s.header.replayVersion },
      mkCtx(0),
    );

    expect(next).toBe(s); // non-mutating: identity
    expect(effects.persist).toBeNull();
    expect(effects.reply).toHaveLength(1);
    expect(effects.reply[0]).toEqual({ type: "reload" });
  });
});

// ===========================================================================
// 3. Wrong replayVersion → reload.
// ===========================================================================
describe("hello with a mismatched replayVersion", () => {
  test("replies with exactly {type: 'reload'} — no resync, no persist, state unchanged", () => {
    const pre = synthGame(exhaustedBases(), { iron: IRON });
    const s = mkSession(pre, [HUMAN, HUMAN]);
    expect(s.header.replayVersion).not.toBe("stale-client-bundle");

    const { next, effects } = applyCommand(
      s,
      { type: "hello", protocolVersion: PROTOCOL_VERSION, replayVersion: "stale-client-bundle" },
      mkCtx(0),
    );

    expect(next).toBe(s);
    expect(effects.persist).toBeNull();
    expect(effects.reply).toHaveLength(1);
    expect(effects.reply[0]).toEqual({ type: "reload" });
  });
});

// ===========================================================================
// 4. hello during a pending — non-mutating bypass; the resync carries the seat-filtered
//    pending per A6.1's privacy rule (present for the prompted seat, absent for others).
// ===========================================================================
describe("hello while a pending is set", () => {
  test("still answered (bypasses the write-lock) — the resync carries the pending for the PROMPTED seat", () => {
    const s = openedHumanPending();
    const promptedSeat = s.pending!.promptedSeat;
    expect(promptedSeat).toBe(1);

    const { next, effects } = applyCommand(
      s,
      { type: "hello", protocolVersion: PROTOCOL_VERSION, replayVersion: s.header.replayVersion },
      mkCtx(promptedSeat),
    );

    expect(next).toBe(s); // bypassed the write-lock entirely — identity, not just "unchanged fields"
    expect(effects.persist).toBeNull();
    expect(effects.reply).toHaveLength(1);
    const reply = effects.reply[0]!;
    expect(reply.type).toBe("resync");
    if (reply.type !== "resync") throw new Error("expected resync");
    expect(reply.pending).not.toBeNull();
    expect(reply.pending!.decisionId).toBe(s.pending!.decisionId);
  });

  test("a NON-prompted seat's hello resync carries pending: null (privacy still applies)", () => {
    const s = openedHumanPending();
    const promptedSeat = s.pending!.promptedSeat;
    const attackerSeat = 0;
    expect(attackerSeat).not.toBe(promptedSeat);

    const { effects } = applyCommand(
      s,
      { type: "hello", protocolVersion: PROTOCOL_VERSION, replayVersion: s.header.replayVersion },
      mkCtx(attackerSeat),
    );

    const reply = effects.reply[0]!;
    expect(reply.type).toBe("resync");
    if (reply.type !== "resync") throw new Error("expected resync");
    expect(reply.pending).toBeNull();
  });
});
