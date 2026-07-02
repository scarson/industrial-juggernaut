// ABOUTME: A4.1 pending-defender module — eligibleDefenders / validateAttackers / open / resolve / extend / toWirePending.
// ABOUTME: Attack-position states are synthetic GameState variants (justified inline) cross-checked against representativeDefender.
import { test, expect, describe } from "vitest";
import {
  eligibleDefenders,
  validateAttackers,
  openDefenderDecision,
  resolveDefender,
  extendDefender,
  toWirePending,
} from "../../src/session/pending";
import { openSession } from "../../src/session/session";
import { logKey, PENDING_KEY, SNAPSHOT_KEY } from "../../src/session/keys";
import { NO_EFFECTS, PENDING_TOMBSTONE } from "../../src/session/session-types";
import type { CommandCtx, SessionState, Pending } from "../../src/session/session-types";
import { validateAttackDecl } from "../../src/session/validation";
import { DEFAULT_ROOM_OPTIONS } from "../../src/wire/protocol";
import type { RoomOptions } from "../../src/wire/protocol";
import { defaultConfig } from "../../src/engine/config";
import { representativeDefender } from "../../src/index";
import { seed } from "../../src/rng/pcg";
import { key } from "../../src/geometry/cube";
import type { Base, GameState, Hex, PlayerId, RngState, AttackDecl } from "../../src/engine/types";
import type { SessionHeader } from "../../src/session/types";

// ---------------------------------------------------------------------------
// Synthetic board + state construction.
//
// Reaching a legal attack position through pure command builds is prohibitively
// tedious (a full radiate→perimeter buildout). The A4.1 plan explicitly sanctions
// crafting a synthetic GameState variant — bases placed at chosen hexes with the
// owner/state/order fields the engine reads — provided each construction is
// justified and satisfies the invariants the code under test relies on
// (attacker/defender bases are `state:"fresh"`; the hexes satisfy x+y+z=0 and lie
// within `config.attackRange` of the target). Every base below is `fresh` and every
// hex is a valid cube coordinate; distances are within attackRange=6.
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

/** A fresh base literal (the only fields eligibleDefenders/validateAttackers read besides owner/state/hex). */
function base(owner: PlayerId, h: Hex, order: number, state: Base["state"] = "fresh"): Base {
  return { owner, hex: h, state, order };
}

/**
 * A minimal synthetic GameState carrying just the fields the pure functions read:
 * bases, config (attackRange), players (alliance/eliminated are NOT read by
 * eligibleDefenders/validateAttackers/representativeDefender), phase, rngState.
 * board.hexes is populated so nothing downstream trips on an empty board.
 */
function synthGame(bases: Base[], opts?: { rng?: RngState; turn?: number; nPlayers?: number }): GameState {
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
    board: { hexes, iron: [] },
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

// A canonical attack geometry reused across the open/resolve/extend suites.
// Attacker = player 0, defender-owner = player 1. Target T at origin.
const T = hex(0, 0);
// Three attacker bases (player 0), all within range 6 of T, distinct, fresh.
const ATTACKERS: Hex[] = [hex(1, 0), hex(2, -1), hex(0, 2)];
// Two eligible defender bases (player 1), within range 6 of T, != T, fresh.
const DEF_A = hex(-1, 0); // dist 1
const DEF_B = hex(-2, 1); // dist 2
function attackGameBases(): Base[] {
  return [
    base(1, T, 0), // the target base itself (owned by defender)
    base(1, DEF_A, 1),
    base(1, DEF_B, 2),
    base(0, ATTACKERS[0]!, 3),
    base(0, ATTACKERS[1]!, 4),
    base(0, ATTACKERS[2]!, 5),
  ];
}

function mkCtx(actingSeat: number, opts?: { nowEpochMs?: number; decisionId?: string }): CommandCtx {
  return {
    actingSeat,
    nowEpochMs: opts?.nowEpochMs ?? 1_000_000,
    decisionId: opts?.decisionId ?? "decision-xyz",
  };
}

/** A 2-human header; the game field is overwritten with a synthetic attack state. */
function mkHeader(): SessionHeader {
  return {
    formatVersion: 1,
    replayVersion: "test",
    seed: 42n,
    config: CONFIG,
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    seats: [{ kind: "human" }, { kind: "human" }],
  };
}

/** A SessionState whose game is the synthetic attack position (both seats human). */
function mkAttackSession(opts?: { roomOptions?: RoomOptions; gameRng?: RngState }): SessionState {
  const s = openSession(mkHeader(), opts?.roomOptions ?? DEFAULT_ROOM_OPTIONS);
  const game = opts?.gameRng ? synthGame(attackGameBases(), { rng: opts.gameRng }) : synthGame(attackGameBases());
  return { ...s, game, logLength: 7 };
}

// The proposed decl the attacker submits (defender field is a placeholder replaced on resolution).
const PROPOSED: AttackDecl = { target: T, attackers: ATTACKERS, defender: DEF_A };

// ---------------------------------------------------------------------------
// (a) eligibleDefenders — correct fresh/in-range set.
// ---------------------------------------------------------------------------

describe("eligibleDefenders", () => {
  test("returns the fresh, owned-by-defender, in-range, non-target bases", () => {
    const game = synthGame(attackGameBases());
    const elig = eligibleDefenders(game, T, 1);
    const keys = elig.map(key).sort();
    expect(keys).toEqual([key(DEF_A), key(DEF_B)].sort());
    // Target base itself is excluded even though it is owned by the defender.
    expect(keys).not.toContain(key(T));
  });

  test("excludes fatigued, out-of-range, and wrong-owner bases", () => {
    const far = hex(6, 1); // dist 7 from T > range 6 (|6|+|1|+|7| = 14 → 7)
    expect(dist(far, T)).toBeGreaterThan(RANGE);
    const bases: Base[] = [
      base(1, T, 0),
      base(1, DEF_A, 1),                       // eligible
      base(1, DEF_B, 2, "fatigued"),           // fatigued → excluded
      base(1, far, 3),                          // out of range → excluded
      base(0, hex(-1, 1), 4),                  // wrong owner (attacker) → excluded
    ];
    const elig = eligibleDefenders(synthGame(bases), T, 1);
    expect(elig.map(key)).toEqual([key(DEF_A)]);
  });

  test("returns empty when the defender owns only the target base", () => {
    const bases: Base[] = [base(1, T, 0), base(0, ATTACKERS[0]!, 1)];
    expect(eligibleDefenders(synthGame(bases), T, 1)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (b) Drift guard — eligibleDefenders vs representativeDefender must never disagree.
// representativeDefender(game,target,owner) === null  <=>  eligibleDefenders(...) empty,
// and when non-null the pick is a MEMBER of the eligible set.
// ---------------------------------------------------------------------------

describe("drift guard: eligibleDefenders vs representativeDefender", () => {
  // Several deterministic synthetic states spanning both the has-defender and
  // no-defender regimes (fresh/fatigued, in/out of range, target-only, empty).
  const scenarios: { name: string; bases: Base[]; target: Hex; owner: PlayerId }[] = [
    { name: "two eligible", bases: attackGameBases(), target: T, owner: 1 },
    {
      name: "only target base",
      bases: [base(1, T, 0), base(0, hex(1, 0), 1)],
      target: T,
      owner: 1,
    },
    {
      name: "all defenders fatigued",
      bases: [base(1, T, 0), base(1, DEF_A, 1, "fatigued"), base(1, DEF_B, 2, "fatigued")],
      target: T,
      owner: 1,
    },
    {
      name: "all defenders out of range",
      bases: [base(1, T, 0), base(1, hex(6, 1), 1), base(1, hex(-6, -1), 2)],
      target: T,
      owner: 1,
    },
    {
      name: "one eligible among mixed",
      bases: [
        base(1, T, 0),
        base(1, DEF_A, 1),
        base(1, hex(6, 1), 2),           // out of range
        base(1, hex(-3, 0), 3, "fatigued"),
      ],
      target: T,
      owner: 1,
    },
    {
      name: "no bases owned by defender at all",
      bases: [base(0, hex(1, 0), 0), base(0, hex(2, 0), 1)],
      target: T,
      owner: 1,
    },
  ];

  for (const sc of scenarios) {
    test(`consistent: ${sc.name}`, () => {
      const game = synthGame(sc.bases);
      const rep = representativeDefender(game, sc.target, sc.owner);
      const elig = eligibleDefenders(game, sc.target, sc.owner);
      // null <=> empty
      expect(rep === null).toBe(elig.length === 0);
      // when non-null, the pick is a member of the eligible set
      if (rep !== null) {
        expect(elig.map(key)).toContain(key(rep));
      }
    });
  }

  // Third drift surface: eligibleDefenders vs validateAttackDecl (the RESOLUTION-side check).
  // A divergence here would let the client render a defender that then errors on resolveDefender.
  // The attacker set is held fixed and duplicate-free (ATTACKERS) — validateAttackDecl's attacker-side
  // check is duplicates only, so the leg isolates the DEFENDER-side agreement.
  for (const sc of scenarios) {
    test(`resolution agreement: ${sc.name}`, () => {
      const game = synthGame(sc.bases);
      const elig = eligibleDefenders(game, sc.target, sc.owner);
      // Every client-rendered eligible defender passes the resolution-side validation.
      for (const d of elig) {
        expect(validateAttackDecl(game, sc.owner, { target: sc.target, attackers: ATTACKERS, defender: d })).toBeNull();
      }
      // The target itself is NEVER a valid defender — DEFENDER_IS_TARGET.
      const targetErr = validateAttackDecl(game, sc.owner, { target: sc.target, attackers: ATTACKERS, defender: sc.target });
      expect(targetErr).not.toBeNull();
      expect(targetErr!.code).toBe("DEFENDER_IS_TARGET");
      // Every defender-owned base OUTSIDE the eligible set (fatigued / out-of-range) fails DEFENDER_INELIGIBLE.
      const eligKeys = new Set(elig.map(key));
      for (const b of sc.bases) {
        if (b.owner !== sc.owner) continue;
        if (key(b.hex) === key(sc.target)) continue; // the target case is asserted above
        if (eligKeys.has(key(b.hex))) continue;
        const err = validateAttackDecl(game, sc.owner, { target: sc.target, attackers: ATTACKERS, defender: b.hex });
        expect(err).not.toBeNull();
        expect(err!.code).toBe("DEFENDER_INELIGIBLE");
      }
    });
  }

  // Also cross-check on REAL states reached via openSession (setup phase — no
  // attackers/defenders exist yet, so every target is null/empty; the guard must
  // still hold vacuously and identically on non-synthetic states).
  test("consistent on real setup-phase states over several seeds", () => {
    for (const seedN of [1n, 7n, 42n, 99n]) {
      const header = { ...mkHeader(), seed: seedN };
      const s = openSession(header, DEFAULT_ROOM_OPTIONS);
      // Probe every existing base hex as a target, for every player id.
      const targets = s.game.bases.map((b) => b.hex);
      const probeTargets = targets.length > 0 ? targets : [hex(0, 0)];
      for (const target of probeTargets) {
        for (let owner = 0; owner < s.game.players.length; owner++) {
          const rep = representativeDefender(s.game, target, owner);
          const elig = eligibleDefenders(s.game, target, owner);
          expect(rep === null).toBe(elig.length === 0);
          if (rep !== null) expect(elig.map(key)).toContain(key(rep));
          // Third drift surface on real states: every eligible hex passes the resolution-side check,
          // and the target-as-defender probe fails it (non-vacuous even when the eligible set is empty).
          for (const d of elig) {
            expect(validateAttackDecl(s.game, owner, { target, attackers: ATTACKERS, defender: d })).toBeNull();
          }
          const targetErr = validateAttackDecl(s.game, owner, { target, attackers: ATTACKERS, defender: target });
          expect(targetErr).not.toBeNull();
          expect(targetErr!.code).toBe("DEFENDER_IS_TARGET");
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// (c) validateAttackers — rejects bad sets, accepts a legal one.
// ---------------------------------------------------------------------------

describe("validateAttackers", () => {
  const game = () => synthGame(attackGameBases());

  test("accepts a legal 3-attacker set → null", () => {
    expect(validateAttackers(game(), 0, T, ATTACKERS)).toBeNull();
  });

  test("rejects too few (<3) → INVALID_ATTACKERS", () => {
    const err = validateAttackers(game(), 0, T, ATTACKERS.slice(0, 2));
    expect(err).not.toBeNull();
    expect(err!.code).toBe("INVALID_ATTACKERS");
    expect(err!.message.length).toBeGreaterThan(0);
  });

  test("rejects too many (>6) → INVALID_ATTACKERS", () => {
    // Build a fresh synthetic state with 7 distinct attacker bases in range.
    const many: Hex[] = [hex(1, 0), hex(2, -1), hex(0, 2), hex(-1, 2), hex(2, 0), hex(0, -2), hex(3, -1)];
    for (const h of many) expect(dist(h, T)).toBeLessThanOrEqual(RANGE);
    const bases: Base[] = [base(1, T, 0), base(1, DEF_A, 1), ...many.map((h, i) => base(0, h, 2 + i))];
    const err = validateAttackers(synthGame(bases), 0, T, many);
    expect(err).not.toBeNull();
    expect(err!.code).toBe("INVALID_ATTACKERS");
  });

  test("rejects duplicate attacker hexes → DUP_ATTACKERS", () => {
    const dup = [ATTACKERS[0]!, ATTACKERS[1]!, ATTACKERS[1]!];
    const err = validateAttackers(game(), 0, T, dup);
    expect(err).not.toBeNull();
    expect(err!.code).toBe("DUP_ATTACKERS");
  });

  test("rejects a non-owned attacker → INVALID_ATTACKERS", () => {
    // Replace one attacker hex with a hex where no player-0 base exists (a defender base).
    const notOwned = [ATTACKERS[0]!, ATTACKERS[1]!, DEF_A];
    const err = validateAttackers(game(), 0, T, notOwned);
    expect(err).not.toBeNull();
    expect(err!.code).toBe("INVALID_ATTACKERS");
  });

  test("rejects a fatigued attacker → INVALID_ATTACKERS", () => {
    const bases = attackGameBases().map((b) =>
      b.owner === 0 && key(b.hex) === key(ATTACKERS[0]!) ? { ...b, state: "fatigued" as const } : b,
    );
    const err = validateAttackers(synthGame(bases), 0, T, ATTACKERS);
    expect(err).not.toBeNull();
    expect(err!.code).toBe("INVALID_ATTACKERS");
  });

  test("rejects an out-of-range attacker → INVALID_ATTACKERS", () => {
    const far = hex(6, 1); // dist 7 > range 6
    expect(dist(far, T)).toBeGreaterThan(RANGE);
    const bases: Base[] = [
      base(1, T, 0),
      base(1, DEF_A, 1),
      base(0, ATTACKERS[0]!, 2),
      base(0, ATTACKERS[1]!, 3),
      base(0, far, 4),
    ];
    const err = validateAttackers(synthGame(bases), 0, T, [ATTACKERS[0]!, ATTACKERS[1]!, far]);
    expect(err).not.toBeNull();
    expect(err!.code).toBe("INVALID_ATTACKERS");
  });
});

// ---------------------------------------------------------------------------
// (d) openDefenderDecision — timeout OFF vs ON.
// ---------------------------------------------------------------------------

describe("openDefenderDecision", () => {
  test("timeout OFF → alarm null, deadlineEpochMs null, pending persisted, prompt carries eligible set + no storage-only fields", () => {
    const s = mkAttackSession(); // DEFAULT_ROOM_OPTIONS has defenderTimeout.enabled === false
    const ctx = mkCtx(0, { decisionId: "d-1" });
    const { pending, effects } = openDefenderDecision(s, PROPOSED, 1, ctx);

    // Pending shape (storage form carries crash-recovery fields).
    expect(pending.decisionId).toBe("d-1");
    expect(pending.kind).toBe("defenderChoice");
    expect(pending.declaringPlayer).toBe(0);   // the attacker (acting seat)
    expect(pending.promptedSeat).toBe(1);      // defender owner
    expect(pending.round).toBe(s.game.phase.turn);
    expect(pending.proposed).toEqual(PROPOSED);
    expect(pending.preDecisionLogLength).toBe(s.logLength);
    expect(pending.rngBeforeApply).toBe(s.game.rngState);
    expect(pending.deadlineEpochMs).toBeNull();

    // No log entry — the attack is not applied yet.
    expect(effects.persist).not.toBeNull();
    expect(Object.keys(effects.persist!.put)).toEqual([PENDING_KEY]);
    expect(effects.persist!.put[PENDING_KEY]).toBe(pending); // raw storage pending
    expect(effects.broadcast).toEqual([]);
    expect(effects.alarm).toBeNull();

    // Prompt to the defender seat.
    expect(effects.toSeat).toHaveLength(1);
    expect(effects.toSeat[0]!.seat).toBe(1);
    const msg = effects.toSeat[0]!.message;
    expect(msg.type).toBe("prompt");
    if (msg.type !== "prompt") throw new Error("expected prompt");
    // Wire pending carries the client-rendered eligible set.
    expect(msg.pending.eligibleDefenders.map(key).sort()).toEqual([key(DEF_A), key(DEF_B)].sort());
    expect(msg.pending.target).toEqual(T);
    expect(msg.pending.deadlineEpochMs).toBeNull();
    // Storage-only fields MUST NOT be on the wire pending.
    expect(msg.pending).not.toHaveProperty("rngBeforeApply");
    expect(msg.pending).not.toHaveProperty("preDecisionLogLength");
    expect(msg.pending).not.toHaveProperty("proposed");
    expect(msg.pending).not.toHaveProperty("attackers");
  });

  test("timeout ON → alarm set at now+seconds*1000, deadline matches", () => {
    const roomOptions: RoomOptions = { defenderTimeout: { enabled: true, seconds: 120 } };
    const s = mkAttackSession({ roomOptions });
    const ctx = mkCtx(0, { nowEpochMs: 5_000_000, decisionId: "d-2" });
    const { pending, effects } = openDefenderDecision(s, PROPOSED, 1, ctx);

    const expected = 5_000_000 + 120 * 1000;
    expect(pending.deadlineEpochMs).toBe(expected);
    expect(effects.alarm).not.toBeNull();
    expect(effects.alarm).toEqual({ action: "set", atEpochMs: expected });
    // Wire pending mirrors the deadline.
    const msg = effects.toSeat[0]!.message;
    if (msg.type !== "prompt") throw new Error("expected prompt");
    expect(msg.pending.deadlineEpochMs).toBe(expected);
  });

  test("next state carries the pending", () => {
    const s = mkAttackSession();
    const { pending, effects } = openDefenderDecision(s, PROPOSED, 1, mkCtx(0));
    // openDefenderDecision returns { pending, effects } — the caller sets next.pending.
    // Assert the effects reference the same pending object that was returned.
    expect(effects.persist!.put[PENDING_KEY]).toBe(pending);
  });
});

// ---------------------------------------------------------------------------
// (e) resolveDefender — ineligible choice → error, no persist.
// (f) resolveDefender — valid → atomic log:N + PENDING_TOMBSTONE in ONE put, stored rng installed.
// ---------------------------------------------------------------------------

/** Build a Pending as openDefenderDecision would, given a game rng distinct from the stored one. */
function mkPending(storedRng: RngState, opts?: { round?: number }): Pending {
  return {
    decisionId: "d-resolve",
    kind: "defenderChoice",
    round: opts?.round ?? 3,
    declaringPlayer: 0,
    promptedSeat: 1,
    proposed: PROPOSED,
    preDecisionLogLength: 7,
    rngBeforeApply: storedRng,
    deadlineEpochMs: null,
  };
}

describe("resolveDefender", () => {
  test("ineligible defender → { error: DEFENDER_INELIGIBLE }, no persist / no state change", () => {
    const s = mkAttackSession();
    const pending = mkPending(s.game.rngState);
    const ineligible = hex(6, 1); // owned by nobody / out of range → not a fresh in-range defender
    const result = resolveDefender(s, pending, ineligible);
    expect("error" in result).toBe(true);
    if (!("error" in result)) throw new Error("expected error");
    expect(result.error.code).toBe("DEFENDER_INELIGIBLE");
  });

  test("target-as-defender → DEFENDER_IS_TARGET", () => {
    const s = mkAttackSession();
    const pending = mkPending(s.game.rngState);
    const result = resolveDefender(s, pending, T);
    expect("error" in result).toBe(true);
    if (!("error" in result)) throw new Error("expected error");
    expect(result.error.code).toBe("DEFENDER_IS_TARGET");
  });

  test("valid defender → ONE persist.put with attack log:N + auto-close endRound + PENDING_TOMBSTONE (atomic), alarm clear, stored rng installed", () => {
    // Discriminating RNG: the PENDING carries a DIFFERENT rng than the current game state,
    // so we can prove the applied entry threads the STORED pre-decision rng (GEO-3), not s.game.rngState.
    const storedRng = seed(777n);
    const gameRng = seed(1n);
    // Sanity: the two rng states are genuinely different (else the test cannot discriminate).
    expect(storedRng.state === gameRng.state && storedRng.inc === gameRng.inc).toBe(false);

    const s = mkAttackSession({ gameRng });
    const pending = mkPending(storedRng);

    const result = resolveDefender(s, pending, DEF_A);
    expect("error" in result).toBe(false);
    if ("error" in result) throw new Error(`unexpected error: ${result.error.code}`);
    const { next, effects } = result;

    // A4.3 composition refactor: resolveDefender now lands the attack AND its auto-close endRound in the SAME
    // atomic put (the A4.1→A4.3 seam). The canonical geometry commits all 3 fresh attackers → none remain fresh
    // → no legal attack remains → the round auto-closes (endRound + SNAPSHOT_KEY) in the resolving put.
    expect(effects.persist).not.toBeNull();
    const put = effects.persist!.put;
    const idx = pending.preDecisionLogLength; // the resolving attack append lands at logLength
    expect(put).toHaveProperty(logKey(idx));
    expect(put).toHaveProperty(logKey(idx + 1)); // the auto-close endRound
    expect(put).toHaveProperty(SNAPSHOT_KEY);     // the round closed → boundary snapshot
    expect(put[PENDING_KEY]).toBe(PENDING_TOMBSTONE);

    // The applied entry is an attack whose rngBeforeApply is the STORED rng (not the game rng).
    const entry = put[logKey(idx)] as { kind: string; decl: AttackDecl; rngBeforeApply: RngState };
    expect(entry.kind).toBe("attack");
    expect(entry.rngBeforeApply).toBe(storedRng);
    expect(entry.rngBeforeApply.state).toBe(storedRng.state);
    expect(entry.rngBeforeApply.state).not.toBe(gameRng.state);
    // The final decl uses the chosen defender.
    expect(entry.decl.defender).toEqual(DEF_A);
    expect(entry.decl.target).toEqual(T);
    expect(entry.decl.attackers).toEqual(ATTACKERS);
    // The second entry is the auto-close endRound for the attacker.
    const close = put[logKey(idx + 1)] as { kind: string; player: PlayerId };
    expect(close.kind).toBe("endRound");
    expect(close.player).toBe(pending.declaringPlayer);

    // Pending cleared in the returned state; alarm cleared.
    expect(next.pending).toBeNull();
    expect(effects.alarm).toEqual({ action: "clear" });
    // logLength advanced by exactly two entries (attack + auto-close endRound).
    expect(next.logLength).toBe(s.logLength + 2);
  });
});

// ---------------------------------------------------------------------------
// (g) extendDefender — pushes deadline + re-arms the alarm.
// ---------------------------------------------------------------------------

describe("extendDefender", () => {
  test("timeout OFF → pure no-op: next === s (identity), effects equal NO_EFFECTS (no persist, no alarm)", () => {
    // In a timeout-OFF room there is nothing to extend — arming an alarm or stamping a non-null
    // deadline onto a pending opened with deadlineEpochMs null would be a spurious liveness clock.
    const s = mkAttackSession(); // DEFAULT_ROOM_OPTIONS: defenderTimeout.enabled === false
    const pending = mkPending(s.game.rngState); // deadlineEpochMs null, as openDefenderDecision built it
    const withPending: SessionState = { ...s, pending };

    const result = extendDefender(withPending, pending, mkCtx(1, { nowEpochMs: 9_000_000 }));
    if ("error" in result) throw new Error(`unexpected error: ${result.error.code}`);
    const { next, effects } = result;

    expect(next).toBe(withPending); // identity — the pending stays exactly as-is
    expect(effects).toEqual(NO_EFFECTS);
    expect(effects.persist).toBeNull();
    expect(effects.alarm).toBeNull();
  });

  test("a non-prompted acting seat → { error: NOT_YOUR_TURN } — internal re-validation (defense in depth), no effects", () => {
    // The command layer ALSO enforces this (session.ts extendDecision handler); the plan (Task A4.3) requires
    // extendDefender to re-validate ctx.actingSeat === pending.promptedSeat internally too, so a future caller
    // that skips the command layer cannot let a non-prompted seat reset the defender's liveness clock.
    const roomOptions: RoomOptions = { defenderTimeout: { enabled: true, seconds: 90 } };
    const s = mkAttackSession({ roomOptions });
    const pending = mkPending(s.game.rngState); // promptedSeat: 1
    const withPending: SessionState = { ...s, pending };

    const result = extendDefender(withPending, pending, mkCtx(0, { nowEpochMs: 9_000_000 })); // seat 0 ≠ prompted 1

    expect("error" in result).toBe(true);
    if (!("error" in result)) throw new Error("expected error");
    expect(result.error.code).toBe("NOT_YOUR_TURN");
    expect(result.error.message.length).toBeGreaterThan(0);
    // An error result carries NO next/effects — nothing persisted, no alarm re-armed, no deadline pushed.
    expect(result).not.toHaveProperty("next");
    expect(result).not.toHaveProperty("effects");
  });

  test("pushes deadlineEpochMs to now+seconds*1000 and re-arms the alarm", () => {
    const roomOptions: RoomOptions = { defenderTimeout: { enabled: true, seconds: 90 } };
    const s = mkAttackSession({ roomOptions });
    const original = mkPending(s.game.rngState);
    // Pretend the decision opened earlier at a stale deadline.
    const pending: Pending = { ...original, deadlineEpochMs: 1_000_000 + 90 * 1000 };

    const ctx = mkCtx(1, { nowEpochMs: 9_000_000 });
    const result = extendDefender(s, pending, ctx);
    if ("error" in result) throw new Error(`unexpected error: ${result.error.code}`);
    const { next, effects } = result;

    const expected = 9_000_000 + 90 * 1000;
    // The persisted pending reflects the new deadline.
    expect(effects.persist).not.toBeNull();
    expect(Object.keys(effects.persist!.put)).toEqual([PENDING_KEY]);
    const persisted = effects.persist!.put[PENDING_KEY] as Pending;
    expect(persisted.deadlineEpochMs).toBe(expected);
    // The alarm is re-armed to the new deadline.
    expect(effects.alarm).toEqual({ action: "set", atEpochMs: expected });
    // next.pending mirrors the pushed deadline; no log entry appended.
    expect(next.pending).not.toBeNull();
    expect(next.pending!.deadlineEpochMs).toBe(expected);
    expect(next.logLength).toBe(s.logLength);
    // The pending is otherwise unchanged (same decisionId, proposal, stored rng).
    expect(persisted.decisionId).toBe(pending.decisionId);
    expect(persisted.proposed).toEqual(pending.proposed);
    expect(persisted.rngBeforeApply).toBe(pending.rngBeforeApply);
  });
});

// ---------------------------------------------------------------------------
// toWirePending — projection omits storage-only fields, adds eligible set.
// ---------------------------------------------------------------------------

describe("toWirePending", () => {
  test("projects storage → wire, omitting crash-recovery fields and adding eligible", () => {
    const pending = mkPending(seed(5n));
    const eligible = [DEF_A, DEF_B];
    const wire = toWirePending(pending, eligible);
    expect(wire).toEqual({
      decisionId: pending.decisionId,
      kind: "defenderChoice",
      round: pending.round,
      declaringPlayer: pending.declaringPlayer,
      promptedSeat: pending.promptedSeat,
      target: pending.proposed.target,
      eligibleDefenders: eligible,
      deadlineEpochMs: pending.deadlineEpochMs,
    });
    // Storage-only fields absent.
    expect(wire).not.toHaveProperty("proposed");
    expect(wire).not.toHaveProperty("preDecisionLogLength");
    expect(wire).not.toHaveProperty("rngBeforeApply");
  });
});
