// ABOUTME: Structure tests for BuildComposer — budget meter text, bootstrap-disabled base option +
// ABOUTME: explanation, preview-on-placement via the store, and Commit submitting the build command.
import { describe, expect, test } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BuildComposer } from "./BuildComposer";
import { makeFakeDriver } from "../game/fake-driver";
import { createGameStore } from "../game/store";
import { hex, key } from "../../../src/geometry/cube";
import { defaultConfig, initGame } from "../engine-client/barrel";
import type { GameState } from "../engine-client/barrel";
import type { SeatRosterEntry } from "../game/driver";

// Setup-phase fixture (2 players, seed-1n/size-96 board) — deterministic across runs, mirrors the
// fixture shape used throughout web/src/{engine-client,game,composers} tests.
function setupState(): GameState {
  return initGame({
    seed: 1n,
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    nPlayers: 2,
    config: defaultConfig(),
  });
}

// Bootstrap fixture: p0 has exactly one base and one controlled iron, no factories — the FOUNDING
// state isBootstrapOnly gates on (GEO-7: baseCount===1, not <4). `board.iron` is OVERRIDDEN
// wholesale (not appended) so the setup board's own generated deposits don't inflate the
// controlled-iron count past 1 and mask bootstrap — mirrors test/engine/build.test.ts's mkState.
const P0_BASE = hex(0, 0, 0);
const IRON = hex(5, -5, 0);
const BOOTSTRAP_FACTORY_TARGET = hex(3, -3, 0); // on-board, d=3 from P0_BASE, within default placeRange 5

function bootstrapFixture(): GameState {
  const base = setupState();
  const present = new Set(base.board.hexes.map(key));
  const hexes = present.has(key(IRON)) ? base.board.hexes : [...base.board.hexes, IRON];
  return {
    ...base,
    board: { ...base.board, hexes, iron: [IRON] },
    phase: { turn: 1, order: [0, 1], indexInOrder: 0 },
    bases: [{ owner: 0, hex: P0_BASE, state: "fresh", order: 0 }],
    players: [
      { id: 0, basesInHand: 11, alliance: [0], eliminated: false },
      { id: 1, basesInHand: 12, alliance: [1], eliminated: false },
    ],
  };
}

// Normal play-phase fixture: p0 has a 4-base perimeter and enough resources for a real budget
// (rc = 3 controlled iron + 1 controlled factory = 4 => budget floor(4/2) = 2), so bootstrap does
// NOT apply and the base option is available. `board.iron` is overridden wholesale for the same
// reason as bootstrapFixture — otherwise the generated board's own iron (which also falls inside
// this perimeter) inflates rc past what the fixture's comment claims.
const PERIMETER_BASES = [hex(0, 0, 0), hex(4, -4, 0), hex(4, 0, -4), hex(0, 4, -4)];
const PLAY_IRON = [hex(2, -2, 0), hex(2, 0, -2), hex(1, 1, -2)];
const PLAY_FACTORY = hex(2, 1, -3);
const PLAY_BUILD_TARGET = hex(2, -1, -1); // distinct on-board hex within placeRange for a new build

function playFixture(): GameState {
  const base = setupState();
  const extra = [...PLAY_IRON, PLAY_FACTORY, PLAY_BUILD_TARGET];
  const present = new Set(base.board.hexes.map(key));
  const hexes = [...base.board.hexes];
  for (const h of extra) {
    if (!present.has(key(h))) {
      hexes.push(h);
      present.add(key(h));
    }
  }
  return {
    ...base,
    board: { ...base.board, hexes, iron: PLAY_IRON },
    phase: { turn: 1, order: [0, 1], indexInOrder: 0 },
    bases: PERIMETER_BASES.map((h, i) => ({ owner: 0 as const, hex: h, state: "fresh" as const, order: i })),
    factories: [{ hex: PLAY_FACTORY }],
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

function driverFor(state: GameState) {
  return makeFakeDriver({ snapshot: state, roster: fixtureRoster(), controllableSeats: [0] });
}

describe("BuildComposer — budget meter", () => {
  test("renders the remaining budget from budgetOf(state, player)", () => {
    const state = playFixture();
    const store = createGameStore();
    const driver = driverFor(state);
    store.getState().connectDriver(driver);

    render(<BuildComposer state={state} player={0} driver={driver} store={store} />);

    // rc = 3 iron + 1 factory = 4 => budget floor(4/2) = 2, nothing staged yet => 2 remaining.
    expect(screen.getByTestId("build-budget")).toHaveTextContent("Remaining: 2");
  });

  test("remaining budget decreases as pieces are staged, distinct from the staged count", async () => {
    const user = userEvent.setup();
    const state = playFixture();
    const store = createGameStore();
    const driver = driverFor(state);
    store.getState().connectDriver(driver);

    render(<BuildComposer state={state} player={0} driver={driver} store={store} />);
    expect(screen.getByTestId("build-budget")).toHaveTextContent("Remaining: 2");

    await user.click(screen.getByTestId(`build-hex-${key(PLAY_BUILD_TARGET)}`));

    // budget 2 - 1 staged piece = 1 remaining (not "1 staged", which would coincidentally also
    // read "1" here — the exact "Remaining: 1" text distinguishes the two interpretations).
    expect(screen.getByTestId("build-budget")).toHaveTextContent("Remaining: 1");
  });

  test("a hex button is disabled once the budget is exhausted — staging beyond budget is not offered", async () => {
    const user = userEvent.setup();
    const state = bootstrapFixture(); // budget 1 (the bootstrap +1 term)
    const store = createGameStore();
    const driver = driverFor(state);
    store.getState().connectDriver(driver);

    render(<BuildComposer state={state} player={0} driver={driver} store={store} />);
    await user.click(screen.getByTestId(`build-hex-${key(BOOTSTRAP_FACTORY_TARGET)}`));
    expect(screen.getByTestId("build-budget")).toHaveTextContent("Remaining: 0");

    // A second legal-build hex exists (e.g. (2,-2,0)), but the budget is spent — applyAction
    // would throw "exceeds build budget" if previewCommand were called with 2 pieces against
    // budget 1, so the composer must not let a click stage a second piece once budget hits 0.
    const secondHex = screen.getByTestId(`build-hex-${key(hex(2, -2, 0))}`);
    expect(secondHex).toBeDisabled();
  });
});

describe("BuildComposer — bootstrap", () => {
  test("in bootstrap state, the base option is disabled and the bootstrap explanation shows", () => {
    const state = bootstrapFixture();
    const store = createGameStore();
    const driver = driverFor(state);
    store.getState().connectDriver(driver);

    render(<BuildComposer state={state} player={0} driver={driver} store={store} />);

    expect(screen.getByRole("radio", { name: /base/i })).toBeDisabled();
    expect(screen.getByText(/first build must be a factory/i)).toBeInTheDocument();
  });

  test("outside bootstrap, the base option is enabled and no bootstrap explanation shows", () => {
    const state = playFixture();
    const store = createGameStore();
    const driver = driverFor(state);
    store.getState().connectDriver(driver);

    render(<BuildComposer state={state} player={0} driver={driver} store={store} />);

    expect(screen.getByRole("radio", { name: /base/i })).not.toBeDisabled();
    expect(screen.queryByText(/first build must be a factory/i)).not.toBeInTheDocument();
  });
});

describe("BuildComposer — piece placement + preview", () => {
  test("placing a factory on a highlighted hex adds it to the pending pieces and updates the store's preview", async () => {
    const user = userEvent.setup();
    const state = bootstrapFixture();
    const store = createGameStore();
    const driver = driverFor(state);
    store.getState().connectDriver(driver);

    render(<BuildComposer state={state} player={0} driver={driver} store={store} />);

    const hexButton = screen.getByTestId(`build-hex-${key(BOOTSTRAP_FACTORY_TARGET)}`);
    await user.click(hexButton);

    const preview = store.getState().preview;
    expect(preview.source).toEqual({
      type: "build",
      pieces: [{ type: "factory", hex: BOOTSTRAP_FACTORY_TARGET }],
    });
    expect(preview.state).not.toBeNull();
    expect(preview.state!.factorySupply).toBe(state.factorySupply - 1);
  });

  test("selecting the base piece type and placing a hex stages a base piece, not a factory", async () => {
    const user = userEvent.setup();
    const state = playFixture(); // bootstrap does not apply — base is selectable
    const store = createGameStore();
    const driver = driverFor(state);
    store.getState().connectDriver(driver);

    render(<BuildComposer state={state} player={0} driver={driver} store={store} />);

    await user.click(screen.getByRole("radio", { name: /base/i }));
    await user.click(screen.getByTestId(`build-hex-${key(PLAY_BUILD_TARGET)}`));

    const preview = store.getState().preview;
    expect(preview.source).toEqual({
      type: "build",
      pieces: [{ type: "base", hex: PLAY_BUILD_TARGET }],
    });
    expect(preview.state).not.toBeNull();
    const baseKeys = preview.state!.bases.map((b) => key(b.hex));
    expect(baseKeys).toContain(key(PLAY_BUILD_TARGET));
  });
});

describe("BuildComposer — commit", () => {
  test("Commit submits the build command with the staged pieces", async () => {
    const user = userEvent.setup();
    const state = bootstrapFixture();
    const store = createGameStore();
    const driver = driverFor(state);
    store.getState().connectDriver(driver);

    render(<BuildComposer state={state} player={0} driver={driver} store={store} />);

    const hexButton = screen.getByTestId(`build-hex-${key(BOOTSTRAP_FACTORY_TARGET)}`);
    await user.click(hexButton);

    await user.click(screen.getByRole("button", { name: /commit/i }));

    expect(driver.submitted()).toEqual([
      { type: "build", pieces: [{ type: "factory", hex: BOOTSTRAP_FACTORY_TARGET }] },
    ]);
  });

  test("Commit is disabled until at least one piece is staged", () => {
    const state = bootstrapFixture();
    const store = createGameStore();
    const driver = driverFor(state);
    store.getState().connectDriver(driver);

    render(<BuildComposer state={state} player={0} driver={driver} store={store} />);

    expect(screen.getByRole("button", { name: /commit/i })).toBeDisabled();
  });
});

describe("BuildComposer — board-click seam", () => {
  test("registers a build board-handler that stages a piece, published to ui.stagedBuild", () => {
    const state = playFixture();
    const store = createGameStore();
    const driver = driverFor(state);
    store.getState().connectDriver(driver);

    render(<BuildComposer state={state} player={0} driver={driver} store={store} />);

    const handler = store.getState().ui.boardHandlers.build;
    expect(handler).toBeDefined();

    act(() => handler!(PLAY_BUILD_TARGET));

    expect(screen.getByTestId("build-budget")).toHaveTextContent("Remaining: 1");
    expect(store.getState().ui.stagedBuild).toEqual([PLAY_BUILD_TARGET]);
  });

  test("unmount unregisters the handler and clears the staged publication", () => {
    const state = playFixture();
    const store = createGameStore();
    const driver = driverFor(state);
    store.getState().connectDriver(driver);

    const { unmount } = render(<BuildComposer state={state} player={0} driver={driver} store={store} />);
    act(() => store.getState().ui.boardHandlers.build!(PLAY_BUILD_TARGET));
    expect(store.getState().ui.stagedBuild).toHaveLength(1);

    unmount();

    expect(store.getState().ui.boardHandlers.build).toBeUndefined();
    expect(store.getState().ui.stagedBuild).toEqual([]);
  });

  test("Commit clears the staged publication along with the local staging", async () => {
    const user = userEvent.setup();
    const state = playFixture();
    const store = createGameStore();
    const driver = driverFor(state);
    store.getState().connectDriver(driver);

    render(<BuildComposer state={state} player={0} driver={driver} store={store} />);
    act(() => store.getState().ui.boardHandlers.build!(PLAY_BUILD_TARGET));

    await user.click(screen.getByRole("button", { name: /^commit$/i }));

    expect(store.getState().ui.stagedBuild).toEqual([]);
  });
});
