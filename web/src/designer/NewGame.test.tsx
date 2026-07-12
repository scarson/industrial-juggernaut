// ABOUTME: Structure + behavior tests for the NewGame designer instrument — grouped knob controls,
// ABOUTME: preset fill, per-field validation gating Start, board-source picker, seat roster, seed, fork.
import { describe, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewGame } from "./NewGame";
import { configGroups } from "./config-form";
import { defaultConfig } from "../engine-client/barrel";
import type { RuleConfig, SessionHeader } from "../engine-client/barrel";

// Finds the Start action — the one brass-filled primary button (Brass Budget).
function startButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: /start/i }) as HTMLButtonElement;
}

describe("NewGame — config groups", () => {
  test("renders a labelled group region per config group", () => {
    render(<NewGame onStart={vi.fn()} />);
    for (const groupName of Object.keys(configGroups())) {
      // Exact match: the "Board" knob cluster and the "Board source" fieldset are both role=group,
      // so a substring/regex name would collide — the group's accessible name must be exactly its key.
      expect(
        screen.getByRole("group", { name: groupName }),
        `group ${groupName}`,
      ).toBeInTheDocument();
    }
  });

  test("renders a control for every RuleConfig knob", () => {
    render(<NewGame onStart={vi.fn()} />);
    for (const key of Object.keys(defaultConfig())) {
      expect(
        screen.getByTestId(`knob-${key}`),
        `control for knob ${key}`,
      ).toBeInTheDocument();
    }
  });

  test("numeric knobs render in the mono face (Honest Numbers)", () => {
    render(<NewGame onStart={vi.fn()} />);
    const boardSize = screen.getByTestId("knob-boardSize").querySelector("input");
    expect(boardSize).not.toBeNull();
    expect(boardSize).toHaveClass("mono");
  });
});

describe("NewGame — presets", () => {
  test("selecting the playtest preset fills the knobs from that config", async () => {
    const user = userEvent.setup();
    render(<NewGame onStart={vi.fn()} />);
    // Drift a knob away from the preset, then apply the preset and confirm it resets.
    const ironInput = screen.getByTestId("knob-ironCount").querySelector("input")!;
    await user.clear(ironInput);
    await user.type(ironInput, "99");
    expect(ironInput).toHaveValue(99);

    await user.selectOptions(
      screen.getByRole("combobox", { name: /preset/i }),
      "current-playtest-config",
    );
    expect(ironInput).toHaveValue(defaultConfig().ironCount);
  });
});

describe("NewGame — provenance", () => {
  test("a knob left at its default reads as default; a hand-edited one reads as tuned", async () => {
    const user = userEvent.setup();
    render(<NewGame onStart={vi.fn()} />);
    const ironKnob = screen.getByTestId("knob-ironCount");
    expect(within(ironKnob).getByText(/default/i)).toBeInTheDocument();

    const ironInput = ironKnob.querySelector("input")!;
    await user.clear(ironInput);
    await user.type(ironInput, "20");
    expect(within(ironKnob).getByText(/tuned/i)).toBeInTheDocument();
  });
});

describe("NewGame — validation gates Start", () => {
  test("an invalid ironCount shows the validation message and disables Start", async () => {
    const user = userEvent.setup();
    render(<NewGame onStart={vi.fn()} />);
    const ironInput = screen.getByTestId("knob-ironCount").querySelector("input")!;
    await user.clear(ironInput);
    await user.type(ironInput, "0"); // below IRON_COUNT_MIN

    expect(within(screen.getByTestId("knob-ironCount")).getByText(/ironCount/i)).toBeInTheDocument();
    expect(startButton()).toBeDisabled();
  });

  test("a valid form leaves Start enabled", () => {
    render(<NewGame onStart={vi.fn()} />);
    expect(startButton()).toBeEnabled();
  });
});

describe("NewGame — board source", () => {
  test("defaults to generate mode, sourcing size + iron from the BOARD knobs — no duplicate inputs", () => {
    render(<NewGame onStart={vi.fn()} />);
    expect(screen.getByTestId("board-source-generate")).toBeInTheDocument();
    // Exactly ONE Board size / Iron deposits input each (the BOARD cluster's knobs). The picker
    // previously duplicated both with shadow state that generation read INSTEAD of the knobs —
    // editing the visible knob silently did nothing.
    expect(screen.getAllByRole("spinbutton", { name: /board size/i })).toHaveLength(1);
    expect(screen.getAllByRole("spinbutton", { name: /iron deposits/i })).toHaveLength(1);
  });

  test("CSP-infeasible generate params show a friendly error and disable Start — never a crash", async () => {
    const user = userEvent.setup();
    render(<NewGame onStart={vi.fn()} />);

    // 99 iron deposits cannot be placed on a 96-hex board under the generator's constraints —
    // before the probe guard this THREW inside a useMemo and white-screened the whole designer.
    const iron = screen.getByRole("spinbutton", { name: /iron deposits/i });
    await user.clear(iron);
    await user.type(iron, "99");

    const note = screen.getByTestId("board-infeasible-note");
    expect(note.textContent).toMatch(/can.t be generated/i);
    expect(note.textContent).not.toMatch(/placeIron|restarts|CSP/i); // friendly copy, no internals
    expect(startButton()).toBeDisabled();
    // The form survived — the preset picker is still there.
    expect(screen.getByRole("combobox", { name: /preset/i })).toBeInTheDocument();
  });

  test("the BOARD cluster's size + iron knobs feed the generated board source", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<NewGame onStart={onStart} />);

    const size = screen.getByRole("spinbutton", { name: /board size/i });
    await user.clear(size);
    await user.type(size, "120");
    const iron = screen.getByRole("spinbutton", { name: /iron deposits/i });
    await user.clear(iron);
    await user.type(iron, "16");

    await user.click(startButton());

    expect(onStart).toHaveBeenCalledTimes(1);
    const header = onStart.mock.calls[0]![0] as SessionHeader;
    expect(header.boardSource).toEqual({ kind: "generate", size: 120, ironCount: 16 });
    expect(header.config.boardSize).toBe(120);
    expect(header.config.ironCount).toBe(16);
  });

  test("switching to fixed JSON and pasting bad JSON shows the friendly parse error", async () => {
    const user = userEvent.setup();
    render(<NewGame onStart={vi.fn()} />);
    await user.selectOptions(screen.getByRole("combobox", { name: /board source/i }), "fixed");
    const textarea = screen.getByRole("textbox", { name: /board json/i });
    // paste (not type): the `{` in a JSON string is a userEvent.type keyboard-modifier escape, and
    // pasting a board is the real designer flow anyway.
    await user.click(textarea);
    await user.paste("{ not json");

    expect(screen.getByText(/couldn't parse json/i)).toBeInTheDocument();
    expect(startButton()).toBeDisabled();
  });
});

describe("NewGame — seats", () => {
  test("starts with two seats, each carrying a player identity icon", () => {
    render(<NewGame onStart={vi.fn()} />);
    const rows = screen.getAllByTestId(/^seat-row-/);
    expect(rows).toHaveLength(2);
    // Each seat row shows a shape icon (svg) as its identity chip.
    for (const row of rows) {
      expect(row.querySelector("svg")).not.toBeNull();
    }
  });

  test("adding seats grows the roster up to six", async () => {
    const user = userEvent.setup();
    render(<NewGame onStart={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /add seat/i }));
    expect(screen.getAllByTestId(/^seat-row-/)).toHaveLength(3);
  });

  test("toggling a seat to greedy exposes the archetype picker", async () => {
    const user = userEvent.setup();
    render(<NewGame onStart={vi.fn()} />);
    const seat0 = screen.getByTestId("seat-row-0");
    // No archetype picker while the seat is human.
    expect(within(seat0).queryByRole("combobox", { name: /archetype/i })).toBeNull();

    await user.selectOptions(within(seat0).getByRole("combobox", { name: /seat 1 kind/i }), "greedy");
    expect(within(seat0).getByRole("combobox", { name: /archetype/i })).toBeInTheDocument();
  });
});

describe("NewGame — seed", () => {
  test("a non-digit seed shows a friendly error and disables Start", async () => {
    const user = userEvent.setup();
    render(<NewGame onStart={vi.fn()} />);
    const seed = screen.getByRole("textbox", { name: /seed/i });
    await user.clear(seed);
    await user.type(seed, "0x9f3a");

    expect(screen.getByText(/digits/i)).toBeInTheDocument();
    expect(startButton()).toBeDisabled();
  });
});

describe("NewGame — balance note", () => {
  test("renders the balance-under-development note", () => {
    render(<NewGame onStart={vi.fn()} />);
    expect(screen.getByText(/balance is under active development/i)).toBeInTheDocument();
  });
});

describe("NewGame — setup-degeneracy note", () => {
  test("renders for the degenerate default config (generate 96/14, radius 5, threshold 10)", () => {
    render(<NewGame onStart={vi.fn()} />);
    expect(screen.getByTestId("setup-degeneracy-note")).toBeInTheDocument();
  });

  test("is absent once the victory threshold is raised above max single-base coverage", async () => {
    const user = userEvent.setup();
    render(<NewGame onStart={vi.fn()} />);
    const thresholdInput = screen.getByTestId("knob-victoryThreshold").querySelector("input")!;
    await user.clear(thresholdInput);
    await user.type(thresholdInput, "12");

    expect(screen.queryByTestId("setup-degeneracy-note")).toBeNull();
  });
});

describe("NewGame — start", () => {
  test("Start on a valid form calls onStart with the assembled header (bigint seed)", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<NewGame onStart={onStart} />);

    const seed = screen.getByRole("textbox", { name: /seed/i });
    await user.clear(seed);
    await user.type(seed, "12345");

    // Make seat 2 a heuristic agent so the assembled seats aren't all-default.
    await user.selectOptions(
      within(screen.getByTestId("seat-row-1")).getByRole("combobox", { name: /seat 2 kind/i }),
      "heuristic",
    );

    await user.click(startButton());

    expect(onStart).toHaveBeenCalledTimes(1);
    const header = onStart.mock.calls[0]![0] as SessionHeader;
    expect(header.seed).toBe(12345n);
    expect(typeof header.seed).toBe("bigint");
    expect(header.config).toMatchObject(defaultConfig());
    expect(header.boardSource).toEqual({ kind: "generate", size: 96, ironCount: 14 });
    expect(header.seats).toEqual([{ kind: "human" }, { kind: "agent", agent: "heuristic" }]);
  });

  test("does not call onStart while the form is invalid", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<NewGame onStart={onStart} />);
    const ironInput = screen.getByTestId("knob-ironCount").querySelector("input")!;
    await user.clear(ironInput);
    await user.type(ironInput, "0");

    await user.click(startButton());
    expect(onStart).not.toHaveBeenCalled();
  });
});

describe("NewGame — fork pre-fill", () => {
  test("initialConfig pre-fills the knobs and marks the differing ones tuned", () => {
    const forked: RuleConfig = { ...defaultConfig(), ironCount: 22 };
    render(<NewGame onStart={vi.fn()} initialConfig={forked} />);

    const ironKnob = screen.getByTestId("knob-ironCount");
    expect(ironKnob.querySelector("input")).toHaveValue(22);
    expect(within(ironKnob).getByText(/tuned/i)).toBeInTheDocument();

    // A knob left at the default still reads default.
    const radiusKnob = screen.getByTestId("knob-radius");
    expect(within(radiusKnob).getByText(/default/i)).toBeInTheDocument();
  });
});
