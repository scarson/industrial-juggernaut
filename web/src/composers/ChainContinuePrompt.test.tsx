// ABOUTME: Structure tests for ChainContinuePrompt — offered only while canAttackAgain is true
// ABOUTME: (caller-derived from legalActions), "done attacking" submits endRound, "attack again"
// ABOUTME: hands control back to the caller via onAttackAgain without submitting anything.
import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChainContinuePrompt } from "./ChainContinuePrompt";
import { makeFakeDriver } from "../game/fake-driver";
import { defaultConfig, initGame, legalActions } from "../engine-client/barrel";
import type { GameState } from "../engine-client/barrel";
import type { SeatRosterEntry } from "../game/driver";

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

function driverFor(state: GameState) {
  return makeFakeDriver({ snapshot: state, roster: fixtureRoster(), controllableSeats: [0] });
}

describe("ChainContinuePrompt — offer + done attacking", () => {
  test("renders 'attack again' and 'done attacking' affordances", () => {
    const state = setupState();
    const driver = driverFor(state);

    render(<ChainContinuePrompt driver={driver} canAttackAgain onAttackAgain={() => {}} />);

    expect(screen.getByRole("button", { name: /attack again/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /done attacking/i })).toBeInTheDocument();
  });

  test("'done attacking' submits endRound", () => {
    const state = setupState();
    const driver = driverFor(state);

    render(<ChainContinuePrompt driver={driver} canAttackAgain onAttackAgain={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /done attacking/i }));

    expect(driver.submitted()).toEqual([{ type: "endRound" }]);
  });

  test("'attack again' does NOT submit — it calls onAttackAgain so the caller hands control back to AttackComposer", () => {
    const state = setupState();
    const driver = driverFor(state);
    const onAttackAgain = vi.fn();

    render(<ChainContinuePrompt driver={driver} canAttackAgain onAttackAgain={onAttackAgain} />);
    fireEvent.click(screen.getByRole("button", { name: /attack again/i }));

    expect(onAttackAgain).toHaveBeenCalledTimes(1);
    expect(driver.submitted()).toEqual([]);
  });
});

describe("ChainContinuePrompt — canAttackAgain reflects the reducer's auto-close rule via legalActions", () => {
  // The reducer auto-closes the round (no prompt at all) once fewer than 3 fresh in-range
  // attackers remain or no legal attack exists — this component does NOT recompute that rule.
  // It takes `canAttackAgain` as a caller-supplied boolean; the caller is expected to derive it
  // via `legalActions(state).some(a => a.kind === "attack")` (the same existence check
  // `autoCloseIfNoAttack` in src/session/pending.ts uses), never by re-deriving the 3-fresh
  // threshold itself. This test proves that derivation against a real state, documenting the
  // contract rather than asserting anything DefenderPrompt-side.
  test("canAttackAgain=false hides 'attack again', showing only 'done attacking'", () => {
    const state = setupState(); // setup-phase state: legalActions would be called on turn>=1 in
    // real use; here we simply assert the prop-driven rendering contract directly.
    const driver = driverFor(state);

    render(<ChainContinuePrompt driver={driver} canAttackAgain={false} onAttackAgain={() => {}} />);

    expect(screen.queryByRole("button", { name: /attack again/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /done attacking/i })).toBeInTheDocument();
  });

  test("legalActions on a state with no legal attack yields false for the caller's derivation", () => {
    const state = setupState();
    // Setup phase (turn 0): legalActions falls through to the stuck-player fallback (see
    // highlight.ts's documented behavior) and returns only pass — no attack action, so a caller
    // deriving canAttackAgain via legalActions(state).some(a => a.kind === "attack") gets false.
    const hasAttack = legalActions(state).some((a) => a.kind === "attack");
    expect(hasAttack).toBe(false);
  });
});
