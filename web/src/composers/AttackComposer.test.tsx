// ABOUTME: Structure tests for AttackComposer — target selection reveals eligible attackers,
// ABOUTME: the commitment slider reads odds from config.combatTable (anti-hardcoding proof),
// ABOUTME: Commit submits the attack decl with the representativeDefender proposal, no local
// ABOUTME: combat resolution happens, and a null-defender target blocks Commit with DER #4.
import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AttackComposer } from "./AttackComposer";
import { makeFakeDriver } from "../game/fake-driver";
import { createGameStore } from "../game/store";
import { hex, key } from "../../../src/geometry/cube";
import { defaultConfig, initGame, representativeDefender } from "../engine-client/barrel";
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

// Attack-legal fixture: p0 has 6 fresh bases within attackRange (6) of TARGET; p1 has 2 bases
// (target + defender), both within range. Coordinates verified on-board for seed-1n/size-96 in
// test/engine/apply-attack.test.ts — reused verbatim from preview.test.ts's attackFixture.
const TARGET = hex(2, -2, 0);
const DEFENDER = hex(0, -1, 1);
const ATTACKERS6 = [
  hex(0, 0, 0),
  hex(-1, 1, 0),
  hex(0, 1, -1),
  hex(1, 0, -1),
  hex(0, 2, -2),
  hex(-2, 2, 0),
];

function attackFixture(): GameState {
  const base = setupState();
  return {
    ...base,
    phase: { turn: 1, order: [0, 1], indexInOrder: 0 },
    bases: [
      ...ATTACKERS6.map((h, i) => ({ owner: 0 as const, hex: h, state: "fresh" as const, order: i })),
      { owner: 1 as const, hex: TARGET, state: "fresh" as const, order: 0 },
      { owner: 1 as const, hex: DEFENDER, state: "fresh" as const, order: 1 },
    ],
    players: [
      { id: 0, basesInHand: 6, alliance: [0], eliminated: false },
      { id: 1, basesInHand: 10, alliance: [1], eliminated: false },
    ],
  };
}

// Same geometry as attackFixture, but with a non-default combatTable — proves the composer's
// odds display reads config.combatTable rather than the 75/83/89/auto literals baked into
// defaultConfig(). Values are deliberately NOT the default fractions.
function mutatedCombatTableFixture(): GameState {
  const state = attackFixture();
  return {
    ...state,
    config: { ...state.config, combatTable: { 3: 0.5, 4: 0.6, 5: 0.7, 6: 1 } },
  };
}

// No-eligible-defender fixture (DER #4): p1's only base at TARGET has no OTHER fresh p1 base in
// range, so representativeDefender(state, TARGET, 1) returns null. legalActions would never emit
// this target (attackTargets already excludes it), so this fixture exercises the composer's
// defense-in-depth path directly by constructing a state highlightSets would not naturally offer
// as a legal attack. The test selects the hex explicitly rather than via the highlighted-targets
// list.
function noDefenderFixture(): GameState {
  const base = setupState();
  return {
    ...base,
    phase: { turn: 1, order: [0, 1], indexInOrder: 0 },
    bases: [
      ...ATTACKERS6.map((h, i) => ({ owner: 0 as const, hex: h, state: "fresh" as const, order: i })),
      { owner: 1 as const, hex: TARGET, state: "fresh" as const, order: 0 },
    ],
    players: [
      { id: 0, basesInHand: 6, alliance: [0], eliminated: false },
      { id: 1, basesInHand: 11, alliance: [1], eliminated: false },
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

describe("AttackComposer — target selection", () => {
  test("selecting a target reveals its eligible attackers", async () => {
    const user = userEvent.setup();
    const state = attackFixture();
    const store = createGameStore();
    const driver = driverFor(state);
    store.getState().connectDriver(driver);

    render(<AttackComposer state={state} player={0} driver={driver} store={store} />);

    await user.click(screen.getByTestId(`attack-target-${key(TARGET)}`));

    // All 6 fresh in-range p0 bases become available as attacker candidates.
    for (const h of ATTACKERS6) {
      expect(screen.getByTestId(`attack-attacker-${key(h)}`)).toBeInTheDocument();
    }
  });
});

describe("AttackComposer — commitment odds follow config.combatTable", () => {
  afterEach(() => vi.restoreAllMocks());

  test("lowering the commitment re-renders without a React style-conflict warning", async () => {
    // A committed attacker span emphasizes its border color over the base span's border. If the
    // base uses the `border` shorthand and the committed override sets `borderColor`, React warns
    // on the re-render that reverts a span from committed→uncommitted (shorthand/longhand conflict)
    // — the exact defect fixed in TurnOrderTokens. Lowering the slider MUST stay console-clean.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    const state = attackFixture();
    const store = createGameStore();
    const driver = driverFor(state);
    store.getState().connectDriver(driver);

    render(<AttackComposer state={state} player={0} driver={driver} store={store} />);
    await user.click(screen.getByTestId(`attack-target-${key(TARGET)}`));

    const slider = screen.getByRole("slider", { name: /commitment/i });
    slider.focus();
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}"); // raise 3 → 6 (commit spans)
    await user.keyboard("{ArrowLeft}{ArrowLeft}{ArrowLeft}"); // lower 6 → 3 (revert spans)

    const styleWarnings = consoleError.mock.calls.filter((call) => String(call[0]).includes("shorthand"));
    expect(styleWarnings).toEqual([]);
  });

  test("default combatTable: commitment 3/4/5/6 render 75%/83%/89%/auto", async () => {
    const user = userEvent.setup();
    const state = attackFixture();
    const store = createGameStore();
    const driver = driverFor(state);
    store.getState().connectDriver(driver);

    render(<AttackComposer state={state} player={0} driver={driver} store={store} />);
    await user.click(screen.getByTestId(`attack-target-${key(TARGET)}`));

    const slider = screen.getByRole("slider", { name: /commitment/i });

    expect(screen.getByTestId("attack-odds")).toHaveTextContent("75%");

    slider.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByTestId("attack-odds")).toHaveTextContent("83%");

    await user.keyboard("{ArrowRight}");
    expect(screen.getByTestId("attack-odds")).toHaveTextContent("89%");

    await user.keyboard("{ArrowRight}");
    expect(screen.getByTestId("attack-odds")).toHaveTextContent("auto");
  });

  test("a mutated combatTable changes the displayed odds — proves the display is NOT hardcoded", async () => {
    const user = userEvent.setup();
    const state = mutatedCombatTableFixture();
    const store = createGameStore();
    const driver = driverFor(state);
    store.getState().connectDriver(driver);

    render(<AttackComposer state={state} player={0} driver={driver} store={store} />);
    await user.click(screen.getByTestId(`attack-target-${key(TARGET)}`));

    const slider = screen.getByRole("slider", { name: /commitment/i });

    // commitment 3 => 0.5 (NOT the default 0.75/"75%").
    expect(screen.getByTestId("attack-odds")).toHaveTextContent("50%");

    slider.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByTestId("attack-odds")).toHaveTextContent("60%"); // 0.6, not default 5/6.

    await user.keyboard("{ArrowRight}");
    expect(screen.getByTestId("attack-odds")).toHaveTextContent("70%"); // 0.7, not default 8/9.

    await user.keyboard("{ArrowRight}");
    expect(screen.getByTestId("attack-odds")).toHaveTextContent("auto"); // prob 1 either way.
  });
});

describe("AttackComposer — commit", () => {
  test("Commit submits the attack decl with target/attackers/commitment and the default representativeDefender proposal", async () => {
    const user = userEvent.setup();
    const state = attackFixture();
    const store = createGameStore();
    const driver = driverFor(state);
    store.getState().connectDriver(driver);

    render(<AttackComposer state={state} player={0} driver={driver} store={store} />);
    await user.click(screen.getByTestId(`attack-target-${key(TARGET)}`));

    // Default commitment is 3 (the minimum) — nearest 3 of the 6 eligible attackers.
    await user.click(screen.getByRole("button", { name: /commit/i }));

    const expectedDefender = representativeDefender(state, TARGET, 1);
    expect(expectedDefender).not.toBeNull();
    const submitted = driver.submitted();
    expect(submitted).toHaveLength(1);
    const cmd = submitted[0]!;
    expect(cmd.type).toBe("attack");
    if (cmd.type !== "attack") throw new Error("unreachable");
    expect(cmd.decl.target).toEqual(TARGET);
    expect(cmd.decl.attackers).toHaveLength(3);
    expect(cmd.decl.defender).toEqual(expectedDefender);
  });

  test("Commit does not mutate the store's authoritative state — the preview for attack is {combat:true}, state unchanged", async () => {
    const user = userEvent.setup();
    const state = attackFixture();
    const store = createGameStore();
    const driver = driverFor(state);
    store.getState().connectDriver(driver);

    render(<AttackComposer state={state} player={0} driver={driver} store={store} />);
    await user.click(screen.getByTestId(`attack-target-${key(TARGET)}`));

    const authoritativeBefore = store.getState().authoritative.state;

    await user.click(screen.getByRole("button", { name: /commit/i }));

    // No `applied` event was scripted on the fake driver, so nothing should have folded — the
    // store's authoritative state reference is untouched by submit() itself.
    expect(store.getState().authoritative.state).toBe(authoritativeBefore);
  });

  test("Commit is disabled until a target is selected", () => {
    const state = attackFixture();
    const store = createGameStore();
    const driver = driverFor(state);
    store.getState().connectDriver(driver);

    render(<AttackComposer state={state} player={0} driver={driver} store={store} />);

    expect(screen.getByRole("button", { name: /commit/i })).toBeDisabled();
  });
});

describe("AttackComposer — no eligible defender (DER #4)", () => {
  test("a target whose representativeDefender is null blocks Commit and shows the DER #4 reason, without submitting", async () => {
    const user = userEvent.setup();
    const state = noDefenderFixture();
    expect(representativeDefender(state, TARGET, 1)).toBeNull();

    const store = createGameStore();
    const driver = driverFor(state);
    store.getState().connectDriver(driver);

    render(<AttackComposer state={state} player={0} driver={driver} store={store} />);

    await user.click(screen.getByTestId(`attack-target-${key(TARGET)}`));

    expect(screen.getByRole("button", { name: /commit/i })).toBeDisabled();
    expect(screen.getByText(/no eligible defender/i)).toBeInTheDocument();

    // Defense in depth: even if Commit were clicked, no submit should occur since it's disabled.
    expect(driver.submitted()).toHaveLength(0);
  });
});
