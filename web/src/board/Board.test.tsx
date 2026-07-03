// ABOUTME: Structure tests for the SVG board renderer — asserts per-hex/base/factory/iron DOM
// ABOUTME: element counts, identity shapes, state markers, and hex-click parsing. Not a visual test.
import { describe, expect, test, vi } from "vitest";
import { render } from "@testing-library/react";
import { Board } from "./Board";
import { hexKey } from "./projection";
import { playerIdentity } from "../identity/player-identity";
import {
  initGame,
  placeFirstBase,
  legalFirstBaseHexes,
  defaultConfig,
} from "../engine-client/barrel";
import type { GameState, Hex } from "../engine-client/barrel";

// A real post-setup 2-player state built from the pure engine with a fixed seed — real engine
// calls beat structural overrides for the count/identity assertions (see task fixture guidance).
// 2 players is enough for counts; the 6-identity check lives in the dev page, not jsdom.
function postSetupState(): GameState {
  let state = initGame({
    seed: 42n,
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    nPlayers: 2,
    config: defaultConfig(),
  });
  // Drive placement for each seat in placement order until setup exits (turn -> 1).
  while (state.phase.turn === 0) {
    const player = state.phase.order[state.phase.indexInOrder]!;
    const legal = legalFirstBaseHexes(state);
    state = placeFirstBase(state, player, legal[0]!);
  }
  return state;
}

// Immutably clones `state` with the base at index `idx` forced to a given state field. Used only
// to synthesize a fatigued fixture — the setup path produces only "fresh" bases (documented override).
function withBaseState(state: GameState, idx: number, baseState: "fresh" | "fatigued"): GameState {
  return {
    ...state,
    bases: state.bases.map((b, i) => (i === idx ? { ...b, state: baseState } : b)),
  };
}

describe("Board", () => {
  test("renders one <polygon data-hex> per board hex", () => {
    const state = postSetupState();
    const { container } = render(<Board state={state} />);
    expect(container.querySelectorAll("polygon[data-hex]")).toHaveLength(state.board.hexes.length);
  });

  test("each hex polygon's data-hex encodes its canonical hexKey", () => {
    const state = postSetupState();
    const { container } = render(<Board state={state} />);
    const keys = new Set(
      [...container.querySelectorAll("polygon[data-hex]")].map((p) => p.getAttribute("data-hex")),
    );
    for (const hex of state.board.hexes) {
      expect(keys.has(hexKey(hex))).toBe(true);
    }
  });

  test("renders one base marker per state.base with the owner's identity shape", () => {
    const state = postSetupState();
    const { container } = render(<Board state={state} />);
    const baseEls = container.querySelectorAll("[data-base]");
    expect(baseEls).toHaveLength(state.bases.length);
    // Every base carries its owner's shape token (a PlayerShapeIcon renders one circle/polygon).
    for (const base of state.bases) {
      const el = container.querySelector(`[data-base="${hexKey(base.hex)}"]`);
      expect(el).not.toBeNull();
      expect(el!.getAttribute("data-owner")).toBe(String(base.owner));
      // The owner's identity determines whether the token top is a <circle> or <polygon>.
      const identity = playerIdentity(base.owner);
      const marker = identity.shape === "circle" ? el!.querySelector("circle") : el!.querySelector("polygon");
      expect(marker).not.toBeNull();
    }
  });

  test("a fatigued base carries data-state=\"fatigued\"", () => {
    const base = postSetupState();
    const state = withBaseState(base, 0, "fatigued");
    const { container } = render(<Board state={state} />);
    const fatiguedKey = hexKey(state.bases[0]!.hex);
    const el = container.querySelector(`[data-base="${fatiguedKey}"]`);
    expect(el!.getAttribute("data-state")).toBe("fatigued");
    // Every other base stays fresh.
    expect(container.querySelectorAll('[data-base][data-state="fatigued"]')).toHaveLength(1);
  });

  test("renders one iron glyph per board.iron", () => {
    const state = postSetupState();
    const { container } = render(<Board state={state} />);
    expect(container.querySelectorAll("[data-iron]")).toHaveLength(state.board.iron.length);
  });

  test("a base on an iron hex renders BOTH glyphs, with the base painted after (on top of) the iron", () => {
    // Structural override: relocate the first iron deposit onto the first base's hex — setup
    // placement is outer-ring-only, so stacking them via real engine calls would need a full
    // build sequence for no extra structural fidelity (documented override, like the fatigued one).
    const base = postSetupState();
    const stackedHex = base.bases[0]!.hex;
    const state: GameState = {
      ...base,
      board: { ...base.board, iron: [stackedHex, ...base.board.iron.slice(1)] },
    };
    const key = hexKey(stackedHex);
    const { container } = render(<Board state={state} />);

    const ironEl = container.querySelector(`[data-iron="${key}"]`);
    const baseEl = container.querySelector(`[data-base="${key}"]`);
    expect(ironEl).not.toBeNull();
    expect(baseEl).not.toBeNull();
    // SVG paints in document order, so the base token must FOLLOW the iron glyph to sit on top
    // of the deposit — the landmass → iron → factories → bases paint-order contract in Board.tsx.
    expect(
      ironEl!.compareDocumentPosition(baseEl!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("renders one factory glyph per state.factories", () => {
    const state = postSetupState();
    // Synthesize a couple of factories on known hexes (setup leaves factories empty).
    const withFactories: GameState = {
      ...state,
      factories: [{ hex: state.board.hexes[0]! }, { hex: state.board.hexes[1]! }],
    };
    const { container } = render(<Board state={withFactories} />);
    expect(container.querySelectorAll("[data-factory]")).toHaveLength(2);
  });

  test("a hex in highlights.buildHexes gets a build-highlight marker", () => {
    const state = postSetupState();
    const target = state.board.hexes[10]!;
    const highlights = {
      buildHexes: new Set([hexKey(target)]),
      attackTargets: new Set<string>(),
      placementHexes: new Set<string>(),
    };
    const { container } = render(<Board state={state} highlights={highlights} />);
    const cell = container.querySelector(`polygon[data-hex="${hexKey(target)}"]`);
    expect(cell!.getAttribute("data-highlight")).toBe("build");
    // Only the one hex is highlighted.
    expect(container.querySelectorAll('polygon[data-highlight="build"]')).toHaveLength(1);
  });

  test("defined-but-empty highlight sets mark ZERO cells (distinct from the omitted-prop path)", () => {
    // Pins the all-three-Set-miss branch of highlightFor: `highlights` is PRESENT but every set
    // is empty, so no cell may carry data-highlight — same outcome as omitting the prop, reached
    // through the has()-miss path rather than the undefined short-circuit.
    const state = postSetupState();
    const highlights = {
      buildHexes: new Set<string>(),
      attackTargets: new Set<string>(),
      placementHexes: new Set<string>(),
    };
    const { container } = render(<Board state={state} highlights={highlights} />);
    expect(container.querySelectorAll("polygon[data-highlight]")).toHaveLength(0);
  });

  test("a base whose hexKey is in strandedHexes carries the stranded mark", () => {
    const state = postSetupState();
    const strandedKey = hexKey(state.bases[0]!.hex);
    const { container } = render(<Board state={state} strandedHexes={new Set([strandedKey])} />);
    const el = container.querySelector(`[data-base="${strandedKey}"]`);
    expect(el!.getAttribute("data-stranded")).toBe("true");
    expect(container.querySelectorAll('[data-base][data-stranded="true"]')).toHaveLength(1);
  });

  test("clicking a hex polygon fires onHexClick with the parsed {x,y,z} as numbers", () => {
    const state = postSetupState();
    const onHexClick = vi.fn();
    const { container } = render(<Board state={state} onHexClick={onHexClick} />);
    const hex: Hex = state.board.hexes[5]!;
    const cell = container.querySelector(`polygon[data-hex="${hexKey(hex)}"]`) as SVGPolygonElement;
    cell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onHexClick).toHaveBeenCalledTimes(1);
    const arg = onHexClick.mock.calls[0]![0];
    expect(arg).toEqual({ x: hex.x, y: hex.y, z: hex.z });
    // Parsed to numbers, not the raw "x,y,z" string fragments.
    expect(typeof arg.x).toBe("number");
    expect(typeof arg.y).toBe("number");
    expect(typeof arg.z).toBe("number");
  });
});
