// ABOUTME: Structure tests for FactoryGauge — "X / Y" mono readout of factoriesPlaced(state)
// ABOUTME: out of config.factorySupply, never a hardcoded 36.
import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { FactoryGauge } from "./FactoryGauge";
import { defaultConfig, initGame } from "../engine-client/barrel";
import type { GameState } from "../engine-client/barrel";

function setupState(): GameState {
  return initGame({
    seed: 1n,
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    nPlayers: 2,
    config: defaultConfig(),
  });
}

describe("FactoryGauge — supply readout", () => {
  test("renders 0 / 36 for a fresh default-config state (nothing placed yet)", () => {
    const state = setupState();
    render(<FactoryGauge state={state} />);
    const gauge = screen.getByTestId("factory-gauge");
    expect(gauge.textContent).toBe("0 / 36");
    expect(gauge.className).toMatch(/\bmono\b/);
  });

  test("reads the total from config.factorySupply, not a hardcoded 36", () => {
    const state = setupState();
    const customConfig = { ...defaultConfig(), factorySupply: 37 };
    const withPlaced: GameState = { ...state, config: customConfig, factorySupply: 32 };
    render(<FactoryGauge state={withPlaced} />);
    const gauge = screen.getByTestId("factory-gauge");
    // factoriesPlaced = config.factorySupply (37) - state.factorySupply (32) = 5
    expect(gauge.textContent).toBe("5 / 37");
  });
});
