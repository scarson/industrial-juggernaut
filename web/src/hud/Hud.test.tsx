// ABOUTME: Structure tests for Hud — composes ResourcePanel + FactoryGauge + TurnOrderTokens +
// ABOUTME: the reused EventLog (fed via an `events` prop) into the right-rail instrument stack.
import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { Hud } from "./Hud";
import { eventLine } from "./event-copy";
import { defaultConfig, initGame } from "../engine-client/barrel";
import type { GameEvent, GameState } from "../engine-client/barrel";

function setupState(): GameState {
  return initGame({
    seed: 1n,
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    nPlayers: 2,
    config: defaultConfig(),
  });
}

const sampleEvents: GameEvent[] = [
  { kind: "placed", piece: "base", hex: { x: 0, y: 0, z: 0 }, owner: 0 },
];

describe("Hud — right-rail composition", () => {
  test("renders the resource panel, factory gauge, turn order tokens, and event log together", () => {
    const state = setupState();
    render(<Hud state={state} events={sampleEvents} />);

    expect(screen.getByTestId("resource-row-0")).toBeInTheDocument();
    expect(screen.getByTestId("resource-row-1")).toBeInTheDocument();
    expect(screen.getByTestId("factory-gauge")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
    expect(screen.getByRole("log")).toBeInTheDocument();
  });

  test("passes the events prop through to the reused EventLog verbatim", () => {
    const state = setupState();
    render(<Hud state={state} events={sampleEvents} />);
    const log = screen.getByRole("log");
    expect(log.textContent).toContain(eventLine(sampleEvents[0]!));
  });

  test("renders no events gracefully (EventLog's own empty state, not a Hud crash)", () => {
    const state = setupState();
    render(<Hud state={state} events={[]} />);
    expect(screen.getByRole("log")).toBeInTheDocument();
  });
});
