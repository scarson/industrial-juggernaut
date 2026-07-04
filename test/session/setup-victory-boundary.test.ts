// ABOUTME: DER #18 setup→play boundary drives — a 2P agent drive and a 4P mixed drive pin that the ONE iron
// ABOUTME: victory resolves at the setup→play transition (turn 0 -> 1), never mid-setup, with no stall or double-emit.
import { test, expect, describe } from "vitest";
import { openSession, applyCommand } from "../../src/session/session";
import { driveOneStep, needsDrive, currentActor } from "../../src/session/agent-drive";
import { agentForSeat } from "../../src/session/agent-binding";
import { representativeFirstBase } from "../../src/engine/turn";
import { status, coalitionIron } from "../../src/engine/status";
import { defaultConfig } from "../../src/engine/config";
import { SNAPSHOT_KEY } from "../../src/session/keys";
import { DEFAULT_ROOM_OPTIONS } from "../../src/wire/protocol";
import type { SessionHeader, SeatConfig, LogEntry } from "../../src/session/types";
import type { SessionState, CommandCtx } from "../../src/session/session-types";
import type { ServerMessage } from "../../src/wire/protocol";

type VictoryStatus = Extract<ReturnType<typeof status>, { kind: "victory" }>;
const gameOversOf = (bcast: ServerMessage[]) => bcast.filter((m): m is Extract<ServerMessage, { type: "gameOver" }> => m.type === "gameOver");

// ===========================================================================
// (a) A full 2P agent drive whose FIRST placement already controls >= threshold iron,
// yet — per DER #18 — does NOT clinch mid-setup. The SECOND/FINAL placement advances
// phase.turn to 1, and commitEntries' setup→play status-check resolves the ONE iron
// victory at that boundary, carrying exactly one gameOver (no snapshot — placements
// never close a round; no turnRollover — a boundary victory skips advanceRound). This
// is the 2P gap distinct from the 4P drive tests in agent-drive.test.ts.
//
// Config lever — victoryThreshold: 5. On the DEFAULT 96/14 board a single outer-ring
// base radiates control over only ~5–6 of the 14 iron, and two NON-ALLIED singletons
// do NOT union their iron (coalitionIron is per-coalition), so at the default threshold
// of 10 no 2P setup→play boundary EVER resolves an iron victory — the win only lands
// later in play once one seat expands past 10 alone (verified: seeds 1–60 all stay
// ongoing at the 2P boundary under threshold 10). Lowering the threshold to 5 makes a
// single base QUALIFY at its own placement, which is exactly what surfaces the DER #18
// suppression: seat 0 controls >= threshold mid-setup but the game does NOT end there;
// it ends only at the boundary. Seed 1n / threshold 5 verified: seat 0 controls 5
// (>= 5) after its placement with status ongoing (suppressed); the boundary resolves
// to winner [0], reason iron, exactly one gameOver, drive halts.
// ===========================================================================

describe("(a) DER #18 2P agent drive: a mid-setup threshold is suppressed; the boundary resolves exactly one iron victory", () => {
  const SEED_2P = 1n;
  const THRESHOLD = 5;
  function header2p(): SessionHeader {
    return {
      formatVersion: 1,
      replayVersion: "test",
      seed: SEED_2P,
      config: { ...defaultConfig(), victoryThreshold: THRESHOLD },
      boardSource: { kind: "generate", size: 96, ironCount: 14 },
      seats: [{ kind: "agent", agent: "heuristic" }, { kind: "agent", agent: "heuristic" }],
    };
  }

  test("seat 0 controls >= threshold mid-setup but does NOT clinch; seat 1's boundary placement crosses to play with exactly one gameOver", () => {
    let s = openSession(header2p(), DEFAULT_ROOM_OPTIONS);
    expect(s.game.phase.turn).toBe(0);
    expect(currentActor(s)).toBe(0);

    // --- FIRST placement (seat 0): stays in setup, no victory resolves (DER #18). ---
    const step0 = driveOneStep(s, agentForSeat, { nowEpochMs: 1_000_000, decisionId: "d-0" });
    expect(step0.terminal, "seat 0's setup placement does not decide the game").toBeNull();
    expect(gameOversOf(step0.effects.broadcast), "no gameOver mid-setup").toHaveLength(0);
    const put0 = step0.effects.persist!.put;
    expect(Object.keys(put0).filter((k) => k.startsWith("log:")), "one placement log").toHaveLength(1);
    s = step0.next;
    // The heart of DER #18: seat 0 ALREADY controls >= threshold iron (it would have won under the old
    // first-clinch rule), yet the game is still in setup (turn 0) and status() is ongoing — suppressed.
    expect(coalitionIron(s.game, [0]), "seat 0 is already at/over threshold after its own placement")
      .toBeGreaterThanOrEqual(THRESHOLD);
    expect(s.game.phase.turn, "still in setup after one of two placements").toBe(0);
    expect(status(s.game).kind, "status is ongoing while in setup, DESPITE seat 0 being at threshold").toBe("ongoing");
    expect(currentActor(s)).toBe(1);
    expect(needsDrive(s)).toBe(true);

    // --- SECOND/FINAL placement (seat 1): crosses the setup→play boundary and resolves the victory. ---
    const step1 = driveOneStep(s, agentForSeat, { nowEpochMs: 1_000_001, decisionId: "d-1" });

    // The transition placement is a placeFirstBase that did NOT close a round (advanced false) yet reported terminal.
    const put1 = step1.effects.persist!.put;
    const logKeys = Object.keys(put1).filter((k) => k.startsWith("log:"));
    expect(logKeys, "the boundary put carries exactly the placement's log:N").toHaveLength(1);
    expect((put1[logKeys[0]!] as LogEntry).kind).toBe("placeFirstBase");
    expect(step1.advanced, "a placement never closes a round").toBe(false);
    expect(Object.keys(put1), "NO snapshot — snapshots are round-boundary artifacts").not.toContain(SNAPSHOT_KEY);

    // terminal captured; broadcast carries EXACTLY ONE gameOver and NO turnRollover.
    expect(step1.terminal, "the DriveResult captured the boundary terminal").not.toBeNull();
    expect(step1.terminal!.kind).toBe("victory");
    const gameOvers = gameOversOf(step1.effects.broadcast);
    expect(gameOvers, "exactly one gameOver at the setup→play transition").toHaveLength(1);
    expect(step1.effects.broadcast.some((m) => m.type === "turnRollover"), "no turnRollover at a boundary victory").toBe(false);

    s = step1.next;
    expect(s.game.phase.turn, "the final placement crossed the setup→play boundary").toBe(1);

    // Winners/cause cross-checked against an INDEPENDENT status() on the post-application state (reason iron).
    const st = status(s.game) as VictoryStatus;
    expect(st.kind).toBe("victory");
    expect(st.reason).toBe("iron");
    expect(gameOvers[0]!.winners, "gameOver winners == status().players").toEqual(st.players);
    expect(gameOvers[0]!.cause, "gameOver cause == status().reason").toBe(st.reason);
    expect((step1.terminal as VictoryStatus).players).toEqual(st.players);

    // The drive halts at the terminal — no further steps.
    expect(needsDrive(s), "terminal → no further drive").toBe(false);
  });
});

// ===========================================================================
// (b) A 4P MIXED-seat drive (agent/human/agent/human interleaving) driven from open
// to terminal — the whole-drive invariant. This pins the coherence of the four
// enforcement points DER #18 touches: across ALL placements, no step before the
// boundary reports terminal or emits a gameOver, and the game does NOT stall — the
// FOURTH/last placement advances phase.turn to 1 and resolves EXACTLY ONE victory,
// after which the drive terminates. Distinct from agent-drive.test.ts's all-agent
// roster (its [agg,exp,eco,heu] drive-path and [agg,eco,heu,human] command-path
// tests): here agent and human seats alternate, human seats placing via the real
// wire path (applyCommand) and agent seats via driveOneStep — the real host split.
//
// Seed 1n / roster [aggressive, human, economic, human] verified empirically: four
// placements, terminal ONLY at the fourth, no mid-setup terminal, exactly one
// gameOver total, drive terminates (winner [1] by the DER #14 tie-break).
// ===========================================================================

describe("(b) DER #18 4P mixed drive: one victory at the boundary, no mid-setup victory, no stall", () => {
  const agg = (): SeatConfig => ({ kind: "agent", agent: "greedy", archetype: "aggressive" });
  const eco = (): SeatConfig => ({ kind: "agent", agent: "greedy", archetype: "economic" });
  const hum = (): SeatConfig => ({ kind: "human" });
  const SEED_4P = 1n;
  function header4p(): SessionHeader {
    return {
      formatVersion: 1,
      replayVersion: "test",
      seed: SEED_4P,
      config: defaultConfig(),
      boardSource: { kind: "generate", size: 96, ironCount: 14 },
      seats: [agg(), hum(), eco(), hum()], // agent/human/agent/human interleaving
    };
  }

  test("agent+human interleaved placements: no pre-boundary victory, exactly one gameOver at the last placement, drive terminates", () => {
    let s = openSession(header4p(), DEFAULT_ROOM_OPTIONS);

    let totalGameOvers = 0;
    let terminalStatus: ReturnType<typeof status> | null = null;
    let boundaryGameOvers = 0;
    let placements = 0;
    let placementsBeforeBoundary = 0;
    let sawTurnRolloverAtBoundary = false;

    // Drive the whole SETUP: agent seats via driveOneStep (host agent-drive path), human seats via applyCommand
    // (real wire path) at the SAME deterministic representative hex the drive would pick.
    while (s.game.phase.turn === 0) {
      const placer = currentActor(s);
      const wasSetup = s.game.phase.turn === 0;
      let stepGameOvers = 0;
      let stepTerminal: ReturnType<typeof status> | null = null;
      let sawRollover = false;
      let nextGame;

      if (s.header.seats[placer]!.kind === "agent") {
        const r = driveOneStep(s, agentForSeat, { nowEpochMs: 1_000_000 + placements, decisionId: `d-${placements}` });
        stepGameOvers = gameOversOf(r.effects.broadcast).length;
        stepTerminal = r.terminal;
        sawRollover = r.effects.broadcast.some((m) => m.type === "turnRollover");
        s = r.next;
        nextGame = r.next.game;
      } else {
        const hex = representativeFirstBase(s.game, placer);
        const ctx: CommandCtx = { actingSeat: placer, nowEpochMs: 1_000_000 + placements, decisionId: `d-${placements}` };
        const r = applyCommand(s, { type: "placeFirstBase", expectedLogIndex: s.logLength, hex }, ctx);
        expect(r.effects.persist, `human placement ${placements} must apply`).not.toBeNull();
        stepGameOvers = gameOversOf(r.effects.broadcast).length;
        // The command path reports a victory via the broadcast, not a `terminal` field — derive it from status().
        sawRollover = r.effects.broadcast.some((m) => m.type === "turnRollover");
        s = r.next;
        nextGame = r.next.game;
        if (stepGameOvers > 0) stepTerminal = status(nextGame);
      }

      placements += 1;
      totalGameOvers += stepGameOvers;
      const crossedBoundary = wasSetup && nextGame.phase.turn === 1;

      if (crossedBoundary) {
        // The boundary placement resolves the victory: it carries the gameOver and NO turnRollover.
        terminalStatus = stepTerminal ?? status(nextGame);
        boundaryGameOvers = stepGameOvers;
        sawTurnRolloverAtBoundary = sawRollover;
      } else {
        // Every PRE-boundary placement stays in setup, decides nothing, and emits no gameOver (DER #18).
        expect(nextGame.phase.turn, `placement ${placements} stays in setup until the boundary`).toBe(0);
        expect(stepTerminal, `pre-boundary placement ${placements} reports no terminal`).toBeNull();
        expect(stepGameOvers, `no gameOver at pre-boundary placement ${placements}`).toBe(0);
        expect(status(nextGame).kind, `status ongoing at pre-boundary placement ${placements}`).toBe("ongoing");
        placementsBeforeBoundary += 1;
      }
    }

    // Coherence of the whole drive: exactly four placements, the victory ONLY at the fourth (the boundary).
    expect(placements, "a 4P game has four setup placements").toBe(4);
    expect(placementsBeforeBoundary, "the first three placements are pre-boundary and non-terminal").toBe(3);

    // Exactly ONE gameOver, emitted at the boundary — no double-emit, no mid-setup emit.
    expect(totalGameOvers, "exactly one gameOver across the whole drive").toBe(1);
    expect(boundaryGameOvers, "the one gameOver is at the boundary placement").toBe(1);
    expect(sawTurnRolloverAtBoundary, "no turnRollover at a boundary victory (placements never advanceRound)").toBe(false);

    // No stall: the drive reached play (turn 1), resolved a victory, and terminates.
    expect(s.game.phase.turn, "the drive left setup").toBe(1);
    expect(terminalStatus, "the boundary resolved a victory").not.toBeNull();
    expect(terminalStatus!.kind).toBe("victory");
    expect(needsDrive(s), "terminal → the drive halts, no stall").toBe(false);

    // Winners/cause cross-checked against an INDEPENDENT status() over the final board (DER #14 tie-break; reason iron).
    const st = status(s.game) as VictoryStatus;
    expect(st.kind).toBe("victory");
    expect(st.reason).toBe("iron");
    expect((terminalStatus as VictoryStatus).players).toEqual(st.players);
  });
});
