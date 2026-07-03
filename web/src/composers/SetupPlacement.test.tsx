// ABOUTME: Structure tests for SetupPlacement — placement-hex affordance for a controllable seat's
// ABOUTME: setup turn, the waiting state for a non-controllable slot, and the drawn order display.
import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
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
    const store = createGameStore();
    const driver = driverFor(state, [0]);
    store.getState().connectDriver(driver);

    render(<SetupPlacement state={state} player={0} driver={driver} store={store} />);

    const legalHexes = legalFirstBaseHexes(state);
    expect(legalHexes.length).toBeGreaterThan(0);
    for (const hex of legalHexes) {
      expect(screen.getByTestId(`placement-hex-${hexKey(hex)}`)).toBeInTheDocument();
    }
  });

  test("clicking a highlighted hex submits placeFirstBase with that hex", async () => {
    const user = userEvent.setup();
    const state = setupState();
    const store = createGameStore();
    const driver = driverFor(state, [0]);
    store.getState().connectDriver(driver);

    render(<SetupPlacement state={state} player={0} driver={driver} store={store} />);

    const hex = legalFirstBaseHexes(state)[0]!;
    await user.click(screen.getByTestId(`placement-hex-${hexKey(hex)}`));

    expect(driver.submitted()).toEqual([{ type: "placeFirstBase", hex }]);
  });

  test("shows the DER #6 free-choice-on-the-outer-ring rule note", () => {
    const state = setupState();
    const store = createGameStore();
    const driver = driverFor(state, [0]);
    store.getState().connectDriver(driver);

    render(<SetupPlacement state={state} player={0} driver={driver} store={store} />);

    expect(screen.getByText(/outer ring/i)).toBeInTheDocument();
  });
});

describe("SetupPlacement — non-controllable setup slot", () => {
  test("shows a waiting state with no placement-hex affordance", () => {
    const state = setupState(); // currentPlayer === 0, this client controls only seat 1
    const store = createGameStore();
    const driver = driverFor(state, [1]);
    store.getState().connectDriver(driver);

    render(<SetupPlacement state={state} player={0} driver={driver} store={store} />);

    for (const hex of legalFirstBaseHexes(state)) {
      expect(screen.queryByTestId(`placement-hex-${hexKey(hex)}`)).not.toBeInTheDocument();
    }
    expect(screen.getByText(/waiting/i)).toBeInTheDocument();
  });
});

describe("SetupPlacement — drawn order + whose turn", () => {
  test("renders the drawn placement order and indicates whose turn it is", () => {
    const state = setupState(); // phase.order === [0, 1], currentPlayer === 0
    const store = createGameStore();
    const driver = driverFor(state, [0]);
    store.getState().connectDriver(driver);

    render(<SetupPlacement state={state} player={0} driver={driver} store={store} />);

    const orderGroup = screen.getByRole("group", { name: /placement order/i });
    expect(orderGroup).toBeInTheDocument();
    expect(screen.getByTestId("setup-turn-indicator")).toHaveTextContent(/0/);
  });
});
