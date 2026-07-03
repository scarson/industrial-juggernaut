// ABOUTME: Integration-ish structure tests for GameScreen — a fake driver scripted through setup →
// ABOUTME: play → attack/defender → choreography → victory, asserting the RIGHT composer + HUD updates at each beat.
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GameScreen } from "./GameScreen";
import { makeFakeDriver } from "../game/fake-driver";
import { hex } from "../../../src/geometry/cube";
import { defaultConfig, initGame, legalFirstBaseHexes } from "../engine-client/barrel";
import type { GameState, LogEntry } from "../engine-client/barrel";
import type { DriverPending, GameDriver, SeatRosterEntry } from "../game/driver";
import type { SessionHeader } from "../engine-client/barrel";

// ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────
function setupState(): GameState {
  return initGame({
    seed: 1n,
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    nPlayers: 2,
    config: defaultConfig(),
  });
}

// A play-phase state where seat 0 is acting with real build actions (mirrors BuildComposer's playFixture).
const PERIMETER_BASES = [hex(0, 0, 0), hex(4, -4, 0), hex(4, 0, -4), hex(0, 4, -4)];
const PLAY_IRON = [hex(2, -2, 0), hex(2, 0, -2), hex(1, 1, -2)];
const PLAY_FACTORY = hex(2, 1, -3);

function playState(): GameState {
  const base = setupState();
  const present = new Set(base.board.hexes.map((h) => `${h.x},${h.y},${h.z}`));
  const extra = [...PERIMETER_BASES, ...PLAY_IRON, PLAY_FACTORY].filter(
    (h) => !present.has(`${h.x},${h.y},${h.z}`),
  );
  return {
    ...base,
    board: { ...base.board, hexes: [...base.board.hexes, ...extra], iron: PLAY_IRON },
    factories: [{ hex: PLAY_FACTORY }],
    phase: { turn: 1, order: [0, 1], indexInOrder: 0 },
    bases: PERIMETER_BASES.map((h, i) => ({ owner: 0 as const, hex: h, state: "fresh" as const, order: i })),
    players: [
      { id: 0, basesInHand: 8, alliance: [0], eliminated: false },
      { id: 1, basesInHand: 12, alliance: [1], eliminated: false },
    ],
  };
}

function fixtureRoster(): SeatRosterEntry[] {
  return [
    { seat: 0, claimed: true, kind: "human" },
    { seat: 1, claimed: true, kind: "human" },
  ];
}

function fixturePending(promptedSeat: number): DriverPending {
  return {
    decisionId: "d1",
    round: 1,
    declaringPlayer: 1,
    promptedSeat,
    target: PERIMETER_BASES[0]!,
    eligibleDefenders: [hex(1, -1, 0)],
    deadlineEpochMs: null,
  };
}

/** A dummy header — the fake driver ignores it (it echoes the scripted snapshot), so any well-formed
 *  header works. GameScreen only uses it as the started-game identity. */
function dummyHeader(): SessionHeader {
  return {
    formatVersion: 1,
    replayVersion: "test",
    seed: 1n,
    config: defaultConfig(),
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    seats: [{ kind: "human" }, { kind: "human" }],
  };
}

/**
 * Mount GameScreen with an injected fake driver reporting `snapshot`. Returns the driver so the test
 * can push scripted authoritative events (`pushEvent`) — the same seam the store/composer tests use.
 * `header` skips the NewGame entry so the test mounts straight into play.
 */
function renderGame(snapshot: GameState, controllableSeats: number[], pending: DriverPending | null = null) {
  const driver = makeFakeDriver({ snapshot, roster: fixtureRoster(), controllableSeats, pending });
  const createDriver = () => driver as GameDriver;
  render(<GameScreen createDriver={createDriver} header={dummyHeader()} />);
  return driver;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── The `/game` entry flow ─────────────────────────────────────────────────────────────────────
describe("GameScreen — entry flow", () => {
  test("with no header, it shows the NewGame designer (the pre-game screen)", () => {
    render(<GameScreen createDriver={() => makeFakeDriver({ snapshot: setupState(), roster: fixtureRoster(), controllableSeats: [0, 1] })} />);
    expect(screen.getByRole("heading", { name: /new game/i })).toBeInTheDocument();
  });
});

// ── The contextual composer for each phase ───────────────────────────────────────────────────────
describe("GameScreen — the right composer at each phase", () => {
  test("setup phase mounts the SetupPlacement composer", async () => {
    renderGame(setupState(), [0, 1]);
    expect(await screen.findByRole("region", { name: /setup placement/i })).toBeInTheDocument();
  });

  test("play phase for a controllable acting seat mounts Build + Attack composers", async () => {
    renderGame(playState(), [0, 1]);
    expect(await screen.findByTestId("play-composers")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /build/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /attack/i })).toBeInTheDocument();
  });

  test("play phase for a NON-controllable acting seat shows a waiting notice, no composer", async () => {
    renderGame(playState(), [1]); // seat 0 is acting, this client controls only seat 1
    expect(await screen.findByTestId("waiting-notice")).toBeInTheDocument();
    expect(screen.queryByTestId("play-composers")).not.toBeInTheDocument();
  });

  test("a pending defender decision for a controllable seat mounts the DefenderPrompt", async () => {
    // The sync carries a pending (the store sets authoritative.pending on sync); seat 1 is prompted + controllable.
    renderGame(playState(), [0, 1], fixturePending(1));
    expect(await screen.findByRole("region", { name: /defender decision/i })).toBeInTheDocument();
  });
});

// ── The HUD + event log update on the authoritative stream ───────────────────────────────────────
describe("GameScreen — HUD + event log", () => {
  test("the HUD renders in the right rail from the synced state", async () => {
    renderGame(setupState(), [0, 1]);
    expect(await screen.findByLabelText("HUD")).toBeInTheDocument();
    // No events yet — the log is empty on a fresh sync.
    expect(screen.getByText(/no events yet/i)).toBeInTheDocument();
  });

  test("an applied batch appends its events to the event log", async () => {
    const snapshot = setupState();
    const driver = renderGame(snapshot, [0, 1]);
    await screen.findByRole("log", { name: /event log/i });

    // A real setup placement entry folds cleanly via applyEntry (logIndex 0 continues logLength 0).
    // A setup placement itself emits NO GameEvents (round.ts returns events:[]), so the driver's
    // `applied` reports the batch's events separately — here a `placed` event — and GameScreen
    // accumulates exactly the reported `events`, independent of the folded entry. This is the seam:
    // the store folds STATE from the entry; GameScreen accumulates NARRATION from `events`.
    const hexToPlace = legalFirstBaseHexes(snapshot)[0]!;
    const entry: LogEntry = {
      player: 0,
      kind: "placeFirstBase",
      hex: hexToPlace,
      rngBeforeApply: snapshot.rngState,
    };

    act(() => {
      driver.pushEvent({
        type: "applied",
        entry,
        events: [{ kind: "placed", piece: "base", hex: hexToPlace, owner: 0 }],
        logIndex: 0,
      });
    });

    // The log now narrates the placement (no longer "No events yet").
    await waitFor(() => {
      expect(screen.queryByText(/no events yet/i)).not.toBeInTheDocument();
    });
  });
});

// ── Choreography: combat set piece + persistent victory ──────────────────────────────────────────
describe("GameScreen — choreography", () => {
  test("a combat event in an applied batch stages the CombatReveal set piece", async () => {
    // A play-phase snapshot; the combat comes in an applied batch (the entry is not folded here — we
    // enqueue a logIndex that would NOT fold, so the store leaves state alone; the choreography effect
    // reads the batch's events regardless). To keep the fold clean, we push a self-consistent applied.
    const snapshot = setupState();
    const driver = renderGame(snapshot, [0, 1]);
    await screen.findByRole("region", { name: /setup placement/i });

    const hexToPlace = legalFirstBaseHexes(snapshot)[0]!;
    const entry: LogEntry = { player: 0, kind: "placeFirstBase", hex: hexToPlace, rngBeforeApply: snapshot.rngState };
    // Attach a synthetic combat event to the batch (the choreography effect keys off the events, not the entry).
    act(() => {
      driver.pushEvent({
        type: "applied",
        entry,
        events: [{ kind: "combat", target: PERIMETER_BASES[1]!, committed: 5, attackerWon: true }],
        logIndex: 0,
      });
    });

    expect(await screen.findByTestId("combat-reveal")).toBeInTheDocument();
    // The set piece can be dismissed to return to the active composer.
    await userEvent.click(screen.getByTestId("choreography-continue"));
    expect(screen.queryByTestId("combat-reveal")).not.toBeInTheDocument();
  });

  test("the top-level gameOver DriverEvent renders the persistent Victory set piece", async () => {
    const driver = renderGame(playState(), [0, 1]);
    await screen.findByTestId("play-composers");

    act(() => {
      driver.pushEvent({ type: "gameOver", winners: [0], cause: "victory" });
    });

    expect(await screen.findByTestId("victory")).toBeInTheDocument();
    expect(screen.getByTestId("victory-winner-0")).toBeInTheDocument();
    // Victory is terminal: the play composers are gone.
    expect(screen.queryByTestId("play-composers")).not.toBeInTheDocument();
  });
});

// ── The turn-order ceremony from a turnRollover ──────────────────────────────────────────────────
describe("GameScreen — turn-order ceremony", () => {
  test("a turnRollover event surfaces the turn-order ceremony", async () => {
    const driver = renderGame(playState(), [0, 1]);
    await screen.findByTestId("play-composers");

    act(() => {
      driver.pushEvent({ type: "turnRollover", order: [1, 0], ironWeights: [3, 5] });
    });

    expect(await screen.findByRole("region", { name: /turn order draw/i })).toBeInTheDocument();
  });
});
