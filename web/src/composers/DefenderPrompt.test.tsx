// ABOUTME: Structure tests for DefenderPrompt — renders reducer-provided eligibleDefenders + a
// ABOUTME: rule line, resolves on choice, and shows a countdown/extend affordance only when timed.
import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DefenderPrompt } from "./DefenderPrompt";
import { makeFakeDriver } from "../game/fake-driver";
import { hex, key } from "../../../src/geometry/cube";
import { defaultConfig, initGame } from "../engine-client/barrel";
import type { GameState } from "../engine-client/barrel";
import type { DriverPending, SeatRosterEntry } from "../game/driver";

function setupState(): GameState {
  return initGame({
    seed: 1n,
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    nPlayers: 2,
    config: defaultConfig(),
  });
}

const TARGET = hex(2, -2, 0);
const DEFENDER_A = hex(0, -1, 1);
const DEFENDER_B = hex(-1, 0, 1);

function pendingFixture(overrides: Partial<DriverPending> = {}): DriverPending {
  return {
    decisionId: "decision-1",
    round: 1,
    declaringPlayer: 0,
    promptedSeat: 1,
    target: TARGET,
    eligibleDefenders: [DEFENDER_A, DEFENDER_B],
    deadlineEpochMs: null,
    ...overrides,
  };
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

describe("DefenderPrompt — choices + rule line", () => {
  test("renders the reducer-provided eligibleDefenders as choices, verbatim (not re-derived)", () => {
    const state = setupState();
    const pending = pendingFixture();
    const driver = driverFor(state, [1]);

    render(<DefenderPrompt pending={pending} driver={driver} />);

    expect(screen.getByTestId(`defender-choice-${key(DEFENDER_A)}`)).toBeInTheDocument();
    expect(screen.getByTestId(`defender-choice-${key(DEFENDER_B)}`)).toBeInTheDocument();
  });

  test("shows a one-line rule explanation for the decision", () => {
    const state = setupState();
    const pending = pendingFixture();
    const driver = driverFor(state, [1]);

    render(<DefenderPrompt pending={pending} driver={driver} />);

    expect(screen.getByRole("note")).toBeInTheDocument();
  });

  test("choosing a defender submits resolveDecision with the decisionId and chosen defender", () => {
    const state = setupState();
    const pending = pendingFixture();
    const driver = driverFor(state, [1]);

    render(<DefenderPrompt pending={pending} driver={driver} />);
    fireEvent.click(screen.getByTestId(`defender-choice-${key(DEFENDER_B)}`));

    expect(driver.submitted()).toEqual([
      { type: "resolveDecision", decisionId: "decision-1", defender: DEFENDER_B },
    ]);
  });
});

describe("DefenderPrompt — non-controllable / waiting state", () => {
  // Contract: the store (game/store.ts) already gates `authoritative.pending` to seats this
  // client controls — a `prompt` event for another seat clears the preview but never sets
  // `pending`. DefenderPrompt expresses "not your decision" by taking `pending: DriverPending |
  // null` and rendering a waiting message when handed `null`, rather than re-deriving
  // controllability itself. The mounting caller (P3.11's game screen) is expected to pass
  // `store.authoritative.pending` straight through — null there means either no decision is
  // outstanding, or one is outstanding for a seat this client doesn't control; both read as
  // "waiting" from this component's point of view, which is the correct rendering for both.
  test("pending=null renders a waiting message, not the choice list", () => {
    const state = setupState();
    const driver = driverFor(state, [0]);

    render(<DefenderPrompt pending={null} driver={driver} />);

    expect(screen.getByText(/waiting/i)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /defender/i })).not.toBeInTheDocument();
  });
});

describe("DefenderPrompt — countdown + extend (Phase-2 rooms)", () => {
  test("deadlineEpochMs set shows a countdown and an extend button; clicking extend submits extendDecision", () => {
    const state = setupState();
    const now = () => 10_000;
    const pending = pendingFixture({ deadlineEpochMs: 40_000 }); // 30s remaining
    const driver = driverFor(state, [1]);

    render(<DefenderPrompt pending={pending} driver={driver} now={now} />);

    expect(screen.getByTestId("defender-countdown")).toHaveTextContent("30");
    const extendButton = screen.getByRole("button", { name: /still thinking/i });
    fireEvent.click(extendButton);

    expect(driver.submitted()).toEqual([
      { type: "extendDecision", decisionId: "decision-1" },
    ]);
  });

  test("deadlineEpochMs === null (local/timeout-off) shows no countdown and no extend button", () => {
    const state = setupState();
    const pending = pendingFixture({ deadlineEpochMs: null });
    const driver = driverFor(state, [1]);

    render(<DefenderPrompt pending={pending} driver={driver} />);

    expect(screen.queryByTestId("defender-countdown")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /still thinking/i })).not.toBeInTheDocument();
  });
});
