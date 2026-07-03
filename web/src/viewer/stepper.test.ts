// ABOUTME: Pins buildFrames's fold over a recorded game's log — frames.length === log.length + 1,
// ABOUTME: frame[0] is the raw setup state (logIndex -1), and the final frame matches replay's last boundary hash.
import { describe, expect, test } from "vitest";
import { recordGame } from "../../../src/session/record";
import { applyEntry, defaultConfig, initGame, stateHash } from "../engine-client/barrel";
import { buildFrames } from "./stepper";
import type { SessionHeader } from "../engine-client/barrel";

// A small fixed-seed all-agent game — deterministic and fast (150-hex board, low turnCap).
// Two-seat games with the default victoryThreshold (10) tend to hit an iron or
// last-standing victory within the first round or two, which leaves too short a log for
// a meaningful "mid-game frame" assertion. Four seats plus a victoryThreshold raised out
// of reach spread play across more rounds before the game naturally ends (elimination is
// still possible and does end it here — turnCap is a backstop, not what closes this game).
function recordFixture() {
  const header: SessionHeader = {
    formatVersion: 1,
    replayVersion: "test",
    seed: 12345n,
    config: { ...defaultConfig(), victoryThreshold: 100_000 },
    boardSource: { kind: "generate", size: 150, ironCount: 18 },
    seats: [
      { kind: "agent", agent: "greedy", archetype: "economic" },
      { kind: "agent", agent: "greedy", archetype: "aggressive" },
      { kind: "agent", agent: "greedy", archetype: "expansionist" },
      { kind: "agent", agent: "greedy", archetype: "economic" },
    ],
  };
  return recordGame(header, { turnCap: 20 }); // RecordResult already carries `header`
}

describe("buildFrames", () => {
  test("frames.length === log.length + 1", () => {
    const { header, log } = recordFixture();
    const frames = buildFrames(header, log);
    expect(frames.length).toBe(log.length + 1);
  });

  test("frame[0] is the raw initGame state (setup phase, logIndex -1, no events)", () => {
    const { header, log } = recordFixture();
    const frames = buildFrames(header, log);
    const rawSetupState = initGame({
      seed: header.seed,
      boardSource: header.boardSource,
      nPlayers: header.seats.length,
      config: header.config,
    });

    expect(frames[0]!.logIndex).toBe(-1);
    expect(frames[0]!.events).toEqual([]);
    expect(frames[0]!.state).toEqual(rawSetupState);
  });

  test("frames[i+1] carries logIndex i (the entry applied to reach it)", () => {
    const { header, log } = recordFixture();
    const frames = buildFrames(header, log);
    for (let i = 0; i < log.length; i++) {
      expect(frames[i + 1]!.logIndex).toBe(i);
    }
  });

  test("a mid-game frame matches the state produced by folding applyEntry independently", () => {
    const { header, log } = recordFixture();
    expect(log.length).toBeGreaterThan(4); // otherwise "mid-game" isn't meaningful
    const frames = buildFrames(header, log);
    const midIndex = Math.floor(log.length / 2);

    // Independent fold — reuses applyEntry (same primitive buildFrames folds over) but not
    // buildFrames itself, so this isn't circular: it re-derives the mid-game state from the
    // log directly rather than reading it back out of the thing under test.
    let state = initGame({
      seed: header.seed,
      boardSource: header.boardSource,
      nPlayers: header.seats.length,
      config: header.config,
    });
    for (let i = 0; i <= midIndex; i++) {
      state = applyEntry(state, log[i]!).state;
    }

    expect(frames[midIndex + 1]!.state).toEqual(state);
  });

  test("the final frame's stateHash equals the recorded boundaryHashes tail (replay fidelity)", () => {
    const { header, log, boundaryHashes } = recordFixture();
    expect(boundaryHashes.length).toBeGreaterThan(0);
    const frames = buildFrames(header, log);
    const finalFrame = frames[frames.length - 1]!;

    // boundaryHashes gets a push only when an applied entry closes a round (applyEntry's
    // `advanced` flag) — see src/session/round.ts. The log's last entry always closes the
    // round it belongs to (recordGame only stops right after a `step()` that returns
    // terminal, or after turnCap is exceeded following a round-closing entry), so the
    // final frame's state is exactly the state that produced boundaryHashes's last entry.
    expect(stateHash(finalFrame.state)).toBe(boundaryHashes[boundaryHashes.length - 1]);
  });
});
