// ABOUTME: Structure + behavior tests for AgentViewer — inject a fake generateGame returning a fixed
// ABOUTME: RecordResult; step/scrub/play-pause (fake timers) + agent-free import of a pasted record.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentViewer, type GenerateGame } from "./AgentViewer";
import { buildFrames } from "./stepper";
import { encodeRecord, defaultConfig } from "../engine-client/barrel";
import { HEADER_FORMAT_VERSION, HEADER_REPLAY_VERSION } from "../designer/new-game-form";
import { recordGame } from "../../../src/session/record";
import type { RecordResult } from "../../../src/session/record";
import type { SessionHeader } from "../engine-client/barrel";

// A small fixed-seed all-agent game — the fixture the fake generateGame resolves with, and the
// same record the import round-trip pastes. Agents run fine in the test process (only the client
// BUNDLE bars them). victoryThreshold is raised so the log spans several rounds (a meaningful scrub).
function fixtureHeader(): SessionHeader {
  return {
    formatVersion: HEADER_FORMAT_VERSION,
    replayVersion: HEADER_REPLAY_VERSION,
    seed: 4242n,
    config: { ...defaultConfig(), victoryThreshold: 100_000 },
    boardSource: { kind: "generate", size: 150, ironCount: 18 },
    seats: [
      { kind: "agent", agent: "greedy", archetype: "aggressive" },
      { kind: "agent", agent: "greedy", archetype: "economic" },
      { kind: "agent", agent: "greedy", archetype: "expansionist" },
    ],
  };
}

let recordCache: RecordResult | null = null;
function fixtureRecord(): RecordResult {
  if (!recordCache) recordCache = recordGame(fixtureHeader(), { turnCap: 20 });
  return recordCache;
}

// The injected generateGame seam: resolves with the fixture and records that it was CALLED, so the
// import path can assert it was NOT called (agent-free import).
function makeFakeGenerate() {
  const fake = vi.fn<GenerateGame>(async () => fixtureRecord());
  return { fake };
}

function renderViewer(overrides?: { generate?: ReturnType<typeof makeFakeGenerate>["fake"] }) {
  const { fake } = makeFakeGenerate();
  const generate = overrides?.generate ?? fake;
  render(<AgentViewer header={fixtureHeader()} generateGame={generate} />);
  return { generate };
}

async function generateAndWait(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /generate/i }));
  // The fake resolves synchronously-ish; flush the microtask that sets frames.
  await screen.findByRole("img", { name: /game board/i });
}

describe("AgentViewer — generate → frames", () => {
  test("clicking Generate runs the injected generateGame and shows the board at frame 0", async () => {
    const user = userEvent.setup();
    const { generate } = renderViewer();
    await generateAndWait(user);

    expect(generate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("img", { name: /game board/i })).toBeInTheDocument();
    // Frame 0 is the setup state (logIndex -1) — the frame readout shows position 0.
    expect(screen.getByTestId("frame-position")).toHaveTextContent(/\b0\b/);
  });

  test("the total frame count matches buildFrames(header, log)", async () => {
    const user = userEvent.setup();
    renderViewer();
    await generateAndWait(user);

    const frames = buildFrames(fixtureRecord().header, fixtureRecord().log);
    expect(screen.getByTestId("frame-total")).toHaveTextContent(String(frames.length - 1));
  });
});

describe("AgentViewer — step forward / back", () => {
  test("Step forward advances the frame; Step back returns to it", async () => {
    const user = userEvent.setup();
    renderViewer();
    await generateAndWait(user);

    const pos = screen.getByTestId("frame-position");
    expect(pos).toHaveTextContent(/\b0\b/);

    await user.click(screen.getByRole("button", { name: /step forward/i }));
    expect(pos).toHaveTextContent(/\b1\b/);

    await user.click(screen.getByRole("button", { name: /step back/i }));
    expect(pos).toHaveTextContent(/\b0\b/);
  });

  test("Step back at frame 0 is a no-op (does not go negative)", async () => {
    const user = userEvent.setup();
    renderViewer();
    await generateAndWait(user);
    await user.click(screen.getByRole("button", { name: /step back/i }));
    expect(screen.getByTestId("frame-position")).toHaveTextContent(/\b0\b/);
  });
});

describe("AgentViewer — play / pause on a timer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // Load frames via the SYNCHRONOUS import path with fireEvent (NOT userEvent — userEvent schedules
  // its own timers which deadlock against fake timers). parseSessionRecord + buildFrames run in the
  // click handler with no await, so there is no promise to flush; the transport is deterministic.
  function importFixture() {
    const encoded = encodeRecord(fixtureRecord().header, fixtureRecord().log);
    const textarea = screen.getByRole("textbox", { name: /import|paste|record/i });
    fireEvent.change(textarea, { target: { value: JSON.stringify(encoded) } });
    fireEvent.click(screen.getByRole("button", { name: /import/i }));
    screen.getByRole("img", { name: /game board/i }); // throws if the board didn't mount
  }

  test("Play advances frames on each tick; Pause stops the advance", () => {
    renderViewer();
    importFixture();

    const pos = screen.getByTestId("frame-position");
    expect(pos).toHaveTextContent(/\b0\b/);

    fireEvent.click(screen.getByRole("button", { name: /^play$/i }));

    // One tick advances one frame — deterministic, no sleeps.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    const afterOne = Number(pos.textContent!.match(/\d+/)![0]);
    expect(afterOne).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByRole("button", { name: /pause/i }));
    const parked = Number(pos.textContent!.match(/\d+/)![0]);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    // Paused: the position must not have moved.
    expect(Number(pos.textContent!.match(/\d+/)![0])).toBe(parked);
  });

  test("playback stops at the last frame (does not overrun)", () => {
    renderViewer();
    importFixture();

    const total = Number(screen.getByTestId("frame-total").textContent!.match(/\d+/)![0]);
    fireEvent.click(screen.getByRole("button", { name: /^play$/i }));
    act(() => {
      // Advance well past the whole game's worth of ticks.
      vi.advanceTimersByTime(1000 * (total + 50));
    });
    expect(Number(screen.getByTestId("frame-position").textContent!.match(/\d+/)![0])).toBe(total);
  });
});

describe("AgentViewer — scrub slider", () => {
  test("a scrub slider is present and reflects the frame range", async () => {
    const user = userEvent.setup();
    renderViewer();
    await generateAndWait(user);

    const slider = screen.getByRole("slider", { name: /scrub|frame|timeline/i });
    expect(slider).toBeInTheDocument();
    const total = Number(screen.getByTestId("frame-total").textContent!.match(/\d+/)![0]);
    expect(slider).toHaveAttribute("aria-valuemax", String(total));
    expect(slider).toHaveAttribute("aria-valuemin", "0");
  });
});

describe("AgentViewer — agent-free import", () => {
  test("importing a pasted record renders its frames WITHOUT calling generateGame", async () => {
    const user = userEvent.setup();
    const { generate } = renderViewer();

    const encoded = encodeRecord(fixtureRecord().header, fixtureRecord().log);
    await user.click(screen.getByRole("textbox", { name: /import|paste|record/i }));
    // Paste is faster + avoids userEvent parsing the JSON braces as special keys.
    await user.paste(JSON.stringify(encoded));
    await user.click(screen.getByRole("button", { name: /import/i }));

    await screen.findByRole("img", { name: /game board/i });
    expect(generate).not.toHaveBeenCalled();

    const frames = buildFrames(fixtureRecord().header, fixtureRecord().log);
    expect(screen.getByTestId("frame-total")).toHaveTextContent(String(frames.length - 1));
  });

  test("a malformed import shows the friendly error and no board", async () => {
    const user = userEvent.setup();
    renderViewer();

    await user.click(screen.getByRole("textbox", { name: /import|paste|record/i }));
    await user.paste("}{ not json");
    await user.click(screen.getByRole("button", { name: /import/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/json/i);
    expect(screen.queryByRole("img", { name: /game board/i })).toBeNull();
  });
});
