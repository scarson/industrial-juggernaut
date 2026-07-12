// ABOUTME: Structure tests for SetupPlacement — placement-hex affordance for a controllable seat's
// ABOUTME: setup turn, the waiting state for a non-controllable slot, and the drawn order display.
import { describe, expect, test } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SetupPlacement } from "./SetupPlacement";
import { makeFakeDriver } from "../game/fake-driver";
import { createGameStore } from "../game/store";
import { hexKey } from "../board/projection";
import { defaultConfig, initGame, legalFirstBaseHexes } from "../engine-client/barrel";
import type { GameState } from "../engine-client/barrel";
import type { SeatRosterEntry } from "../game/driver";

// Setup-phase fixture (2 players, seed-1n/size-96 board) — deterministic across runs, mirrors the
// fixture shape used throughout web/src/{engine-client,game,composers} tests. `phase.turn === 0`
// here, so `phase.order` IS the drawn placement order (see src/engine/turn.ts's setup loop) and
// `currentPlayer(state)` reads `phase.order[phase.indexInOrder]`.
function setupState(): GameState {
  return initGame({
    seed: 1n,
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    nPlayers: 2,
    config: defaultConfig(),
  });
}

function fixtureRoster(): SeatRosterEntry[] {
  return [
    { seat: 0, claimed: true, kind: "human" },
    { seat: 1, claimed: true, kind: "human" },
  ];
}

function driverFor(state: GameState, controllableSeats: number[]) {
  return makeFakeDriver({ snapshot: state, roster: fixtureRoster(), controllableSeats });
}

describe("SetupPlacement — controllable seat's turn", () => {
  test("highlights the legal outer-ring placement hexes as clickable buttons", () => {
    const state = setupState(); // currentPlayer === 0
    const driver = driverFor(state, [0]);

    render(<SetupPlacement state={state} player={0} driver={driver} />);

    const legalHexes = legalFirstBaseHexes(state);
    expect(legalHexes.length).toBeGreaterThan(0);
    for (const hex of legalHexes) {
      expect(screen.getByTestId(`placement-hex-${hexKey(hex)}`)).toBeInTheDocument();
    }
  });

  test("clicking a highlighted hex submits placeFirstBase with that hex", async () => {
    const user = userEvent.setup();
    const state = setupState();
    const driver = driverFor(state, [0]);

    render(<SetupPlacement state={state} player={0} driver={driver} />);

    const hex = legalFirstBaseHexes(state)[0]!;
    await user.click(screen.getByTestId(`placement-hex-${hexKey(hex)}`));

    expect(driver.submitted()).toEqual([{ type: "placeFirstBase", hex }]);
  });

  test("shows the DER #6 free-choice-on-the-outer-ring rule note", () => {
    const state = setupState();
    const driver = driverFor(state, [0]);

    render(<SetupPlacement state={state} player={0} driver={driver} />);

    expect(screen.getByText(/outer ring/i)).toBeInTheDocument();
  });
});

describe("SetupPlacement — non-controllable setup slot", () => {
  test("shows a waiting state with no placement-hex affordance", () => {
    const state = setupState(); // currentPlayer === 0, this client controls only seat 1
    const driver = driverFor(state, [1]);

    render(<SetupPlacement state={state} player={0} driver={driver} />);

    for (const hex of legalFirstBaseHexes(state)) {
      expect(screen.queryByTestId(`placement-hex-${hexKey(hex)}`)).not.toBeInTheDocument();
    }
    expect(screen.getByText(/waiting/i)).toBeInTheDocument();
  });

  // Mutation coverage: deleting the `acting === player` clause from `controllableNow` (leaving
  // only the `driver.controllableSeats().includes(player)` check) previously still passed every
  // test in this file, because no fixture exercised "this instance's own seat is mounted while a
  // DIFFERENT seat is currently acting." This fixture does: seat 1 mounts, seat 1 IS in this
  // client's controllableSeats, but `currentPlayer(state)` is seat 0 — seat 1's instance must
  // still render the waiting state, not the placement list, until it's actually seat 1's turn.
  test("a controllable seat mounted while another seat is currently acting shows the waiting state, not the placement list", () => {
    const state = setupState(); // currentPlayer === 0, phase.order === [0, 1]
    const driver = driverFor(state, [1]); // this client controls seat 1...

    render(<SetupPlacement state={state} player={1} driver={driver} />); // ...but seat 1 mounts

    for (const hex of legalFirstBaseHexes(state)) {
      expect(screen.queryByTestId(`placement-hex-${hexKey(hex)}`)).not.toBeInTheDocument();
    }
    expect(screen.getByText(/waiting/i)).toBeInTheDocument();
  });
});

describe("SetupPlacement — drawn order + whose turn", () => {
  test("renders the drawn placement order and indicates whose turn it is", () => {
    const state = setupState(); // phase.order === [0, 1], currentPlayer === 0
    const driver = driverFor(state, [0]);

    render(<SetupPlacement state={state} player={0} driver={driver} />);

    const orderGroup = screen.getByRole("group", { name: /placement order/i });
    expect(orderGroup).toBeInTheDocument();
    // On-screen player labels are 1-based (the event-copy convention) — seat 0 reads "Player 1".
    expect(screen.getByTestId("setup-turn-indicator")).toHaveTextContent(/player 1 to place/i);
  });

  test("never leaks the 0-based engine index into a player label", () => {
    const state = setupState(); // currentPlayer === 0
    const driver = driverFor(state, [0]);

    render(<SetupPlacement state={state} player={0} driver={driver} />);

    expect(screen.queryByText(/player 0/i)).not.toBeInTheDocument();
  });

  test("the waiting line for a non-controllable slot names the player 1-based", () => {
    const state = setupState(); // currentPlayer === 0
    const driver = driverFor(state, [1]); // this client does NOT control the acting seat

    render(<SetupPlacement state={state} player={1} driver={driver} />);

    expect(screen.getByText(/waiting for player 1/i)).toBeInTheDocument();
    expect(screen.queryByText(/player 0/i)).not.toBeInTheDocument();
  });
});

describe("SetupPlacement — board-click seam", () => {
  test("registers a placement board-handler that submits placeFirstBase for a controllable turn", () => {
    const state = setupState();
    const driver = driverFor(state, [0]);
    const store = createGameStore();
    store.getState().connectDriver(driver);

    render(<SetupPlacement state={state} player={0} driver={driver} store={store} />);

    const handler = store.getState().ui.boardHandlers.placement;
    expect(handler).toBeDefined();

    const hex = legalFirstBaseHexes(state)[0]!;
    act(() => handler!(hex));

    expect(driver.submitted()).toEqual([{ type: "placeFirstBase", hex }]);
  });

  test("does NOT register a placement handler while the acting seat is not controllable", () => {
    const state = setupState(); // currentPlayer === 0
    const driver = driverFor(state, [1]);
    const store = createGameStore();
    store.getState().connectDriver(driver);

    render(<SetupPlacement state={state} player={1} driver={driver} store={store} />);

    expect(store.getState().ui.boardHandlers.placement).toBeUndefined();
  });
});
