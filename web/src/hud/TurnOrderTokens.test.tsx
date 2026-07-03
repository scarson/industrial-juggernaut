// ABOUTME: Structure tests for TurnOrderTokens — state.phase.order rendered as shape-tagged
// ABOUTME: tokens, with the current seat (from currentSeat/phase.indexInOrder) emphasized.
import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { TurnOrderTokens } from "./TurnOrderTokens";
import { defaultConfig, initGame } from "../engine-client/barrel";
import type { GameState } from "../engine-client/barrel";

function setupState(): GameState {
  return initGame({
    seed: 1n,
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    nPlayers: 3,
    config: defaultConfig(),
  });
}

describe("TurnOrderTokens — phase.order as shape-tagged tokens", () => {
  test("renders one token per seat in phase.order", () => {
    const state = setupState();
    const orderedState: GameState = { ...state, phase: { turn: 1, order: [2, 0, 1], indexInOrder: 0 } };
    render(<TurnOrderTokens state={orderedState} />);

    const tokens = screen.getAllByRole("listitem");
    expect(tokens.length).toBe(3);
    expect(tokens.map((t) => t.dataset["seat"])).toEqual(["2", "0", "1"]);
  });

  test("each token is shape-tagged with the seat's identity", () => {
    const state = setupState();
    const orderedState: GameState = { ...state, phase: { turn: 1, order: [0, 1, 2], indexInOrder: 0 } };
    render(<TurnOrderTokens state={orderedState} />);

    for (const seat of [0, 1, 2]) {
      const token = screen.getByTestId(`turn-order-token-${seat}`);
      expect(token.querySelector("svg")).not.toBeNull();
    }
  });

  test("the current seat's token is emphasized; the others are not", () => {
    const state = setupState();
    // indexInOrder 1 -> phase.order[1] = seat 1 is the current seat (currentSeat/currentPlayer).
    const orderedState: GameState = { ...state, phase: { turn: 1, order: [0, 1, 2], indexInOrder: 1 } };
    render(<TurnOrderTokens state={orderedState} />);

    const current = screen.getByTestId("turn-order-token-1");
    const others = [screen.getByTestId("turn-order-token-0"), screen.getByTestId("turn-order-token-2")];

    expect(current.dataset["current"]).toBe("true");
    for (const other of others) {
      expect(other.dataset["current"]).toBe("false");
    }
  });
});
