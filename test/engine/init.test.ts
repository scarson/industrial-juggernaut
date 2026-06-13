// ABOUTME: Tests for initGame — the shared board-source + setup-phase init for client and harness.
// ABOUTME: Pins parity with the driver's seed→generateBoard→setupGame init for the generate board source.
import { test, expect } from "vitest";
import { initGame } from "../../src/engine/init";
import { setupGame, placeFirstBase, representativeFirstBase } from "../../src/engine/turn";
import { generateBoard } from "../../src/board/generate";
import { seed } from "../../src/rng/pcg";
import { status } from "../../src/engine/status";
import { defaultConfig } from "../../src/engine/config";

test("initGame returns a setup-phase state; auto-placing all bases equals the driver's seeded setup", () => {
  const s = initGame({ seed: 7n, boardSource: { kind: "generate", size: 96, ironCount: 14 }, nPlayers: 4, config: defaultConfig() });
  expect(s.phase.turn).toBe(0);
  let auto = s;
  for (let i = 0; i < 4; i++) {
    const p = auto.phase.order[auto.phase.indexInOrder]!;
    auto = placeFirstBase(auto, p, representativeFirstBase(auto, p));
  }
  // Replicate the driver's internal init exactly (seed → generateBoard threading rng → setupGame).
  const g = generateBoard(seed(7n), { size: 96, ironCount: 14 });
  const viaDriver = setupGame(g.rng, g.board, 4, defaultConfig());
  expect(auto).toEqual(viaDriver);
});

test("initGame's auto-placed state for a normal seed is an ongoing (non-born-terminal) game", () => {
  const s = initGame({ seed: 7n, boardSource: { kind: "generate", size: 96, ironCount: 14 }, nPlayers: 4, config: defaultConfig() });
  let auto = s;
  for (let i = 0; i < 4; i++) {
    const p = auto.phase.order[auto.phase.indexInOrder]!;
    auto = placeFirstBase(auto, p, representativeFirstBase(auto, p));
  }
  expect(status(auto).kind).not.toBe("victory");
});
