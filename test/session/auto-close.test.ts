// ABOUTME: A4.2 attack-round auto-close — autoCloseIfNoAttack existence-checks the actor's legal attacks.
// ABOUTME: Synthetic GameState variants (A4.1 pattern); the post-attack state is reached via a REAL applied attack.
import { test, expect, describe } from "vitest";
import { autoCloseIfNoAttack } from "../../src/session/pending";
import { commitEntries } from "../../src/session/agent-drive";
import { openSession } from "../../src/session/session";
import { DEFAULT_ROOM_OPTIONS } from "../../src/wire/protocol";
import { defaultConfig } from "../../src/engine/config";
import { seed } from "../../src/rng/pcg";
import { key } from "../../src/geometry/cube";
import type { Base, GameState, Hex, PlayerId, RngState, AttackDecl } from "../../src/engine/types";
import type { LogEntry, SessionHeader } from "../../src/session/types";
import type { SessionState } from "../../src/session/session-types";

// ---------------------------------------------------------------------------
// Synthetic board + state construction — mirrors test/session/pending.test.ts.
// A real attack is applied via commitEntries/applyEntry (never hand-marked
// fatigue): applyOneAttack (src/engine/apply.ts) fatigues every committed
// attacker base REGARDLESS of combat outcome, so a fixed seed reliably
// produces the post-attack fatigue state we need without caring who won.
// ---------------------------------------------------------------------------

const CONFIG = defaultConfig();

/** A valid cube-coordinate hex (x+y+z=0). */
function hex(x: number, y: number): Hex {
  return { x, y, z: -x - y };
}

/** A fresh base literal (the only fields read by legalActions/autoCloseIfNoAttack besides owner/state/hex). */
function base(owner: PlayerId, h: Hex, order: number, state: Base["state"] = "fresh"): Base {
  return { owner, hex: h, state, order };
}

/**
 * A minimal synthetic GameState — mirrors pending.test.ts's synthGame, extended with an `iron`
 * option. Unlike A4.1 (which never routes through applyEliminations), this suite applies REAL
 * attacks via commitEntries, which runs applyEliminations after every entry. A player controlling
 * zero iron is eliminated (noIron, src/engine/status.ts) even with live bases, so every base cluster
 * here must have at least one iron hex within its radiating control disk (config.radius) or the
 * attacker/defender would be wiped out mid-test rather than exercising the post-attack fatigue state.
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
    // indexInOrder: 0, order[0] = 0 — player 0 (the attacker) is the current player throughout,
    // matching the post-attack throwaway state's actor (attack never calls advanceRound).
    phase: { turn: opts?.turn ?? 3, order: Array.from({ length: nPlayers }, (_, i) => i), indexInOrder: 0 },
    factorySupply: 36,
    config: CONFIG,
    rngState: opts?.rng ?? seed(1n),
  };
}

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

/** A SessionState whose game is a supplied synthetic position (both seats human). */
function mkSession(game: GameState): SessionState {
  const s = openSession(mkHeader(), DEFAULT_ROOM_OPTIONS);
  return { ...s, game, logLength: 7 };
}

// Target T, attacker = player 0, defender-owner = player 1.
const T = hex(0, 0);

// ---------------------------------------------------------------------------
// (a) Exhausted — the attacker commits its ONLY 3 fresh bases; after the real
// attack applies, none remain fresh and no other target is in range → no
// legal attack remains → autoCloseIfNoAttack returns an endRound entry.
// ---------------------------------------------------------------------------

describe("autoCloseIfNoAttack — attacker exhausted", () => {
  const ATTACKERS: Hex[] = [hex(1, 0), hex(2, -1), hex(0, 2)];
  const DEF_A = hex(-1, 0);
  // One iron hex ON each side's base hex so neither player is eliminated by the unconditional
  // noIron check that applyEliminations runs after the real attack applies. On-hex placement
  // guarantees control regardless of whether the attacker wins (4 bases -> perimeter mode, hull
  // interior only) or loses (3 bases -> radiating disk) — an own base hex is always controlled
  // in both regimes (R1 on-edge=inside for the hull case; distance 0 for the radiating case).
  const IRON: Hex[] = [ATTACKERS[0]!, DEF_A];

  function bases(): Base[] {
    return [
      base(1, T, 0),
      base(1, DEF_A, 1),
      base(0, ATTACKERS[0]!, 2),
      base(0, ATTACKERS[1]!, 3),
      base(0, ATTACKERS[2]!, 4),
    ];
  }

  test("returns an endRound entry with player===actor and rngBeforeApply===post-attack rngState", () => {
    const pre = synthGame(bases(), { iron: IRON });
    const decl: AttackDecl = { target: T, attackers: ATTACKERS, defender: DEF_A };
    const entry: LogEntry = { player: 0, kind: "attack", decl, rngBeforeApply: pre.rngState };
    const s = mkSession(pre);
    const { next } = commitEntries(s, [entry]);

    // Sanity: the real attack fatigued all three committed attacker bases.
    for (const h of ATTACKERS) {
      const b = next.game.bases.find((x) => x.owner === 0 && key(x.hex) === key(h));
      expect(b).toBeDefined();
      expect(b!.state).toBe("fatigued");
    }

    const result = autoCloseIfNoAttack(next.game, 0);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("endRound");
    expect(result!.player).toBe(0);
    expect(result!.rngBeforeApply).toBe(next.game.rngState);
  });
});

// ---------------------------------------------------------------------------
// (b) Remains — the attacker commits 3 of its 6 fresh bases against T; three
// SPARE attacker bases, in range of a SECOND target, survive fresh and still
// form a legal (>= MIN_ATTACKERS=3) attack → autoCloseIfNoAttack returns null
// (round stays open). A single surviving base is NOT enough on its own — a
// legal attack needs >= 3 eligible attackers (src/engine/legal.ts MIN_ATTACKERS)
// — so the "remains" case needs its own 3-base spare cluster, not just one hex.
// ---------------------------------------------------------------------------

describe("autoCloseIfNoAttack — legal attack remains", () => {
  const ATTACKERS: Hex[] = [hex(1, 0), hex(2, -1), hex(0, 2)];
  const DEF_A = hex(-1, 0);
  // A second, distinct target T2 owned by player 1, with its own eligible defender,
  // both within range of the surviving spare attacker cluster.
  const T2 = hex(-3, 3);
  const DEF_T2 = hex(-3, 2);
  // A 4th base for player 1 (opposite side of {T, DEF_A, T2, DEF_T2}) giving player 1 a valid
  // non-degenerate perimeter. Player 0's post-attack spare cluster + captured-T base form a large
  // hull that encloses T2; without its own perimeter, player 1 would be RADIATING and DER #17
  // (src/engine/control.ts) would exclude T2's iron as sitting inside a non-ally perimeter,
  // wrongly eliminating player 1 (noIron) before the attack-remains assertion is ever reached.
  // Perimetered players keep their whole hull interior regardless of overlap with a rival hull.
  const DEF_B2 = hex(1, -3);
  // Three spare attacker bases (player 0), in range of T2, NOT committed to the first attack.
  const SPARE: Hex[] = [hex(-2, 3), hex(-3, 4), hex(-4, 4)];
  // Iron placed ON base hexes guaranteed to survive the attack regardless of combat outcome
  // (SPARE[0] is never committed; T2 is never targeted) — same on-hex-control reasoning as
  // scenario (a), so neither player is eliminated by the noIron check.
  const IRON: Hex[] = [SPARE[0]!, T2];

  function bases(): Base[] {
    return [
      base(1, T, 0),
      base(1, DEF_A, 1),
      base(1, T2, 2),
      base(1, DEF_T2, 3),
      base(1, DEF_B2, 4),
      base(0, ATTACKERS[0]!, 5),
      base(0, ATTACKERS[1]!, 6),
      base(0, ATTACKERS[2]!, 7),
      base(0, SPARE[0]!, 8),
      base(0, SPARE[1]!, 9),
      base(0, SPARE[2]!, 10),
    ];
  }

  test("returns null — the spare attacker cluster still has a legal attack available", () => {
    const pre = synthGame(bases(), { iron: IRON });
    const decl: AttackDecl = { target: T, attackers: ATTACKERS, defender: DEF_A };
    const entry: LogEntry = { player: 0, kind: "attack", decl, rngBeforeApply: pre.rngState };
    const s = mkSession(pre);
    const { next } = commitEntries(s, [entry]);

    // Sanity: the committed attackers fatigued; the spares stayed fresh.
    for (const h of ATTACKERS) {
      const b = next.game.bases.find((x) => x.owner === 0 && key(x.hex) === key(h));
      expect(b!.state).toBe("fatigued");
    }
    for (const h of SPARE) {
      const b = next.game.bases.find((x) => x.owner === 0 && key(x.hex) === key(h));
      expect(b).toBeDefined();
      expect(b!.state).toBe("fresh");
    }

    const result = autoCloseIfNoAttack(next.game, 0);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (c) Existence-check discipline — direct probes on synthetic states, confirming
// the helper is a pure existence check over legalActions (never membership
// testing a specific declared action). No real attack application needed here;
// these probe autoCloseIfNoAttack directly against hand-built board states
// that are already in their "final" fresh/fatigued configuration.
// ---------------------------------------------------------------------------

describe("autoCloseIfNoAttack — existence-check discipline", () => {
  test("fresh attacker bases in range of another target → attack remains → null", () => {
    // Player 0 owns one fresh base in range of a lone opponent target; a legal
    // 3-attacker action does not exist (only one fresh base), so to exercise
    // "attack remains" here we give player 0 three fresh bases in range of T,
    // none yet committed — a plain pre-attack legal position.
    const ATTACKERS: Hex[] = [hex(1, 0), hex(2, -1), hex(0, 2)];
    const bases: Base[] = [
      base(1, T, 0),
      base(1, hex(-1, 0), 1),
      base(0, ATTACKERS[0]!, 2),
      base(0, ATTACKERS[1]!, 3),
      base(0, ATTACKERS[2]!, 4),
    ];
    const game = synthGame(bases);
    expect(autoCloseIfNoAttack(game, 0)).toBeNull();
  });

  test("all attacker bases fatigued (hand-marked terminal board state, no in-progress attack to replay) → no attack remains → endRound", () => {
    // This scenario represents the FINAL fatigue configuration directly rather than
    // reaching it via a real applied attack — there is no single legal attack that
    // fatigues bases at two disjoint, mutually out-of-range locations in one entry,
    // so hand-marking is the only way to construct "all of the actor's bases are
    // fatigued, scattered across the board" as a terminal state.
    const bases: Base[] = [
      base(1, T, 0),
      base(1, hex(-1, 0), 1),
      base(0, hex(1, 0), 2, "fatigued"),
      base(0, hex(2, -1), 3, "fatigued"),
      base(0, hex(0, 2), 4, "fatigued"),
    ];
    const game = synthGame(bases);
    expect(autoCloseIfNoAttack(game, 0)).not.toBeNull();
    expect(autoCloseIfNoAttack(game, 0)!.kind).toBe("endRound");
  });
});
