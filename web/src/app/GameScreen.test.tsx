// ABOUTME: Integration-ish structure tests for GameScreen — a fake driver scripted through setup →
// ABOUTME: play → attack/defender → choreography → victory, asserting the RIGHT composer + HUD updates at each beat.
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GameScreen } from "./GameScreen";
import { RailHost, RailContentProvider } from "./shell/rail-content";
import { ShellLabelsProvider, TopBarHost } from "./shell/shell-labels";
import { makeFakeDriver } from "../game/fake-driver";
import { hex } from "../../../src/geometry/cube";
import { defaultConfig, initGame, legalFirstBaseHexes } from "../engine-client/barrel";
import { controlOf } from "../engine-client/selectors";
import { hexKey } from "../board/projection";
import { highlightSets } from "../board/highlight";
import { overlapFixtureState, SHARED_HEX } from "../board/test-fixtures";
import * as BoardModule from "../board/Board";
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
 * `header` skips the NewGame entry so the test mounts straight into play. GameScreen publishes its HUD
 * into the shell rail, so the mount wraps it in the rail-content provider with the RailHost standing
 * in for the shell rail — the HUD mounts the rail, which is where the HUD assertions read it.
 */
function renderGame(snapshot: GameState, controllableSeats: number[], pending: DriverPending | null = null) {
  const driver = makeFakeDriver({ snapshot, roster: fixtureRoster(), controllableSeats, pending });
  const createDriver = () => driver as GameDriver;
  render(
    <RailContentProvider>
      <GameScreen createDriver={createDriver} header={dummyHeader()} />
      <RailHost breakpoint="wide" />
    </RailContentProvider>,
  );
  return driver;
}

// Counts real Board renders without altering behavior — the hover render-scoping test reads it.
const boardRenderSpy = vi.fn();
const RealBoard = BoardModule.Board;
vi.spyOn(BoardModule, "Board").mockImplementation((props) => {
  boardRenderSpy();
  return RealBoard(props);
});

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
  test("the HUD publishes into the shell rail from the synced state", async () => {
    renderGame(setupState(), [0, 1]);
    // The HUD lands in the shell rail (the rail exists BECAUSE the HUD published into it).
    expect(await screen.findByLabelText("HUD")).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Rail" })).toBeInTheDocument();
    // No events yet — the log is empty on a fresh sync.
    expect(screen.getByText(/no events yet/i)).toBeInTheDocument();
  });

  test("GameScreen does not render its own Instruments rail lane — the HUD lives in the shell rail", async () => {
    renderGame(setupState(), [0, 1]);
    await screen.findByLabelText("HUD");
    // The HUD's only landmark is the shell rail; GameScreen renders no aside of its own.
    expect(screen.queryByRole("complementary", { name: "Instruments" })).toBeNull();
  });

  test("unmounting GameScreen drops the rail entirely (navigating away mid-game)", async () => {
    const driver = makeFakeDriver({ snapshot: setupState(), roster: fixtureRoster(), controllableSeats: [0, 1] });
    function Harness({ inGame }: { inGame: boolean }) {
      return (
        <RailContentProvider>
          {inGame ? <GameScreen createDriver={() => driver as GameDriver} header={dummyHeader()} /> : null}
          <RailHost breakpoint="wide" />
        </RailContentProvider>
      );
    }

    const { rerender } = render(<Harness inGame={true} />);
    expect(await screen.findByLabelText("HUD")).toBeInTheDocument();

    rerender(<Harness inGame={false} />);
    // The publish effect's cleanup cleared the content, so the rail itself is gone.
    expect(screen.queryByLabelText("HUD")).toBeNull();
    expect(screen.queryByRole("complementary")).toBeNull();
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

// ── Victory's spatial story — the board and the labels tell the ending, not just a text block ────
describe("GameScreen — victory's spatial story", () => {
  test("at game over, the winner's controlled iron takes the brass selected treatment", async () => {
    const state = playState();
    const driver = renderGame(state, [0, 1]);
    await screen.findByTestId("play-composers");

    act(() => {
      driver.pushEvent({ type: "gameOver", winners: [0], cause: "victory" });
    });
    await screen.findByTestId("victory");

    // Self-validating fixture: the winner really controls iron on this board.
    const winnerIron = controlOf(state, 0).iron;
    expect(winnerIron.length).toBeGreaterThan(0);
    for (const iron of winnerIron) {
      const cell = document.querySelector(`polygon[data-hex="${hexKey(iron)}"]`) as SVGPolygonElement;
      expect(cell.getAttribute("data-selected")).toBe("true");
    }
  });

  test("at game over, stale legal-move highlights leave the victory stage", async () => {
    const state = playState();
    const driver = renderGame(state, [0, 1]);
    await screen.findByTestId("play-composers");
    // The live play phase highlights legal builds…
    expect(document.querySelectorAll("polygon[data-highlight]").length).toBeGreaterThan(0);

    act(() => {
      driver.pushEvent({ type: "gameOver", winners: [0], cause: "victory" });
    });
    await screen.findByTestId("victory");

    // …but a finished game affords nothing, so no cell may keep a highlight treatment.
    expect(document.querySelectorAll("polygon[data-highlight]")).toHaveLength(0);
  });

  test("at game over, the turn banner tells the outcome instead of a phantom turn", async () => {
    const driver = renderGame(playState(), [0, 1]);
    await screen.findByTestId("play-composers");

    act(() => {
      driver.pushEvent({ type: "gameOver", winners: [1], cause: "victory" });
    });
    await screen.findByTestId("victory");

    const banner = screen.getByTestId("turn-banner");
    expect(banner.textContent).toMatch(/victory — player 2/i);
    expect(banner.textContent).not.toMatch(/round|places/i);
  });

  test("at game over, the top-bar turn chip swaps to the game-over label", async () => {
    const driver = makeFakeDriver({ snapshot: playState(), roster: fixtureRoster(), controllableSeats: [0, 1] });
    render(
      <ShellLabelsProvider>
        <RailContentProvider>
          <GameScreen createDriver={() => driver as GameDriver} header={dummyHeader()} />
          <RailHost breakpoint="wide" />
        </RailContentProvider>
        <TopBarHost />
      </ShellLabelsProvider>,
    );
    await screen.findByTestId("play-composers");
    expect(screen.getByTestId("topbar-turn")).toHaveTextContent(/turn 1/i);

    act(() => {
      driver.pushEvent({ type: "gameOver", winners: [0], cause: "victory" });
    });
    await screen.findByTestId("victory");

    expect(screen.getByTestId("topbar-turn")).toHaveTextContent("Victory — Player 1");
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

// ── Rejection surfacing — a rejected command teaches the rule it broke (DESIGN.md §5) ────────────
describe("GameScreen — rejection notice", () => {
  test("a rejected command surfaces the rule explanation, never the bare code", async () => {
    // A non-default placeRange: the teaching line must state THIS game's rule, not the default 5.
    const state: GameState = { ...playState(), config: { ...defaultConfig(), placeRange: 3 } };
    const driver = renderGame(state, [0, 1]);
    await screen.findByTestId("play-composers");

    act(() => {
      driver.pushEvent({
        type: "rejected",
        code: "BUILD_ILLEGAL_FACTORY",
        message: "raw wire message",
        currentLogIndex: null,
      });
    });

    const notice = await screen.findByTestId("rejection-notice");
    expect(notice.textContent).toMatch(/factory must be placed on an empty non-iron hex/i);
    expect(notice.textContent).toMatch(/within 3\b/);
    expect(notice.textContent).not.toContain("BUILD_ILLEGAL_FACTORY");
    expect(notice).toHaveAttribute("role", "alert");
  });

  test("the next authoritative event clears the rejection notice", async () => {
    const driver = renderGame(playState(), [0, 1]);
    await screen.findByTestId("play-composers");

    act(() => {
      driver.pushEvent({
        type: "rejected",
        code: "BUILD_OVER_BUDGET",
        message: "over budget",
        currentLogIndex: null,
      });
    });
    await screen.findByTestId("rejection-notice");

    act(() => {
      driver.pushEvent({
        type: "sync",
        snapshot: playState(),
        logLength: 0,
        pending: null,
        seats: fixtureRoster(),
      });
    });

    await waitFor(() => expect(screen.queryByTestId("rejection-notice")).not.toBeInTheDocument());
  });
});

// ── Board interactivity — the board is the interface (UI brief §7), chips stay the a11y path ─────
describe("GameScreen — board interactivity", () => {
  test("clicking a highlighted placement hex on the SVG board places the first base", async () => {
    const state = setupState();
    const driver = renderGame(state, [0, 1]);
    await screen.findByRole("region", { name: /setup placement/i });

    const target = legalFirstBaseHexes(state)[0]!;
    const cell = document.querySelector(
      `polygon[data-hex="${target.x},${target.y},${target.z}"]`,
    ) as SVGPolygonElement;
    act(() => {
      cell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(driver.submitted()).toEqual([{ type: "placeFirstBase", hex: target }]);
  });

  test("clicking a highlighted build hex stages the piece and brass-marks the cell", async () => {
    const state = playState();
    renderGame(state, [0, 1]);
    await screen.findByTestId("play-composers");

    // A hex the engine offers as a legal build target (the same set the board highlights).
    const buildKey = [...highlightSets(state).buildHexes][0]!;
    const cell = document.querySelector(`polygon[data-hex="${buildKey}"]`) as SVGPolygonElement;
    expect(cell.getAttribute("data-highlight")).toBe("build");
    act(() => {
      cell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(screen.getByTestId("build-budget")).toHaveTextContent("Remaining: 1");
    const staged = document.querySelector(`polygon[data-hex="${buildKey}"]`) as SVGPolygonElement;
    expect(staged.getAttribute("data-selected")).toBe("true");
  });

  test("a non-highlighted hex is not click-actionable (no false affordance)", async () => {
    const state = playState();
    const driver = renderGame(state, [0, 1]);
    await screen.findByTestId("play-composers");

    const sets = highlightSets(state);
    const inertHex = state.board.hexes.find((h) => {
      const k = `${h.x},${h.y},${h.z}`;
      return !sets.buildHexes.has(k) && !sets.attackTargets.has(k) && !sets.placementHexes.has(k);
    })!;
    const cell = document.querySelector(
      `polygon[data-hex="${inertHex.x},${inertHex.y},${inertHex.z}"]`,
    ) as SVGPolygonElement;
    act(() => {
      cell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(driver.submitted()).toEqual([]);
    expect(screen.getByTestId("build-budget")).toHaveTextContent("Remaining: 2");
  });

  test("hovering a hex surfaces the surveyor readout with its contents", async () => {
    const state = playState();
    renderGame(state, [0, 1]);
    await screen.findByTestId("play-composers");

    // PLAY_IRON[0] is iron under p0's control — the readout should name both facts.
    const ironHex = PLAY_IRON[0]!;
    const cell = document.querySelector(
      `polygon[data-hex="${ironHex.x},${ironHex.y},${ironHex.z}"]`,
    ) as SVGPolygonElement;
    act(() => {
      // jsdom has no PointerEvent; React synthesizes onPointerEnter from bubbling `pointerover`
      // (see Board.test.tsx's hover test for the full rationale).
      cell.dispatchEvent(new Event("pointerover", { bubbles: true }));
    });

    const readout = await screen.findByTestId("hex-readout");
    expect(readout.textContent).toContain(`${ironHex.x},${ironHex.y},${ironHex.z}`);
    expect(readout.textContent).toMatch(/iron/i);
  });
});

// ── The turn banner — whose round it is, in plain sight beside the board ─────────────────────────
describe("GameScreen — turn banner", () => {
  test("setup phase shows the 1-based acting player in the banner", async () => {
    renderGame(setupState(), [0, 1]);
    const banner = await screen.findByTestId("turn-banner");
    expect(banner.textContent).toMatch(/setup/i);
    expect(banner.textContent).toMatch(/player 1/i);
  });

  test("play phase shows the turn number and the acting player's round", async () => {
    renderGame(playState(), [0, 1]);
    const banner = await screen.findByTestId("turn-banner");
    expect(banner.textContent).toMatch(/turn 1/i);
    expect(banner.textContent).toMatch(/player 1/i);
  });
});

// ── No false affordances on turns this client cannot act in (blind-review P1) ────────────────────
describe("GameScreen — board affordance gating", () => {
  test("a NON-controllable acting seat gets ZERO click-affordant cells (waiting turn)", async () => {
    const state = playState(); // seat 0 acting...
    renderGame(state, [1]); // ...but this client controls only seat 1
    await screen.findByTestId("waiting-notice");

    // No cell may carry the click affordance: pointer cursor + click handler are gated together.
    const affordant = [...document.querySelectorAll("polygon[data-hex]")].filter(
      (p) => (p as SVGPolygonElement).style.cursor === "pointer",
    );
    expect(affordant).toHaveLength(0);
  });

  test("setup phase with a non-controllable acting seat offers no placement affordance", async () => {
    const state = setupState(); // seat 0 placing...
    renderGame(state, [1]); // ...but this client controls only seat 1
    await screen.findByRole("region", { name: /setup placement/i });

    const affordant = [...document.querySelectorAll("polygon[data-hex]")].filter(
      (p) => (p as SVGPolygonElement).style.cursor === "pointer",
    );
    expect(affordant).toHaveLength(0);
  });
});

// ── Honest readout on contested hexes + hover render scoping (blind-review round 2) ─────────────
describe("GameScreen — contested-hex readout", () => {
  test("hovering an overlap hex reads as contested with BOTH controllers, never a sole owner", async () => {
    renderGame(overlapFixtureState(), [0, 1]);
    await screen.findByTestId("composer-lane");

    const cell = document.querySelector(
      `polygon[data-hex="${SHARED_HEX.x},${SHARED_HEX.y},${SHARED_HEX.z}"]`,
    ) as SVGPolygonElement;
    act(() => {
      cell.dispatchEvent(new Event("pointerover", { bubbles: true }));
    });

    const readout = await screen.findByTestId("hex-readout");
    expect(readout.textContent).toMatch(/contested/i);
    expect(readout.textContent).toMatch(/player 1/i);
    expect(readout.textContent).toMatch(/player 2/i);
  });
});

describe("GameScreen — hover render scoping", () => {
  test("a hover publish re-renders the readout, not the board", async () => {
    renderGame(playState(), [0, 1]);
    await screen.findByTestId("play-composers");

    const rendersBefore = boardRenderSpy.mock.calls.length;
    const hex = playState().board.hexes[5]!;
    const cell = document.querySelector(
      `polygon[data-hex="${hex.x},${hex.y},${hex.z}"]`,
    ) as SVGPolygonElement;
    act(() => {
      cell.dispatchEvent(new Event("pointerover", { bubbles: true }));
    });

    await screen.findByTestId("hex-readout");
    // The hover published to the store and the readout re-rendered — the board must not have.
    expect(boardRenderSpy.mock.calls.length).toBe(rendersBefore);
  });
});
