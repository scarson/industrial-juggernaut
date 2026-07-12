// ABOUTME: Structure tests for TopBar — header landmark, wordmark, Instruments button,
// ABOUTME: conditional turn/seed readouts, and the ≤44px height token (not a magic number).
import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TopBar, TOPBAR_HEIGHT_CLASS } from "./TopBar";

describe("TopBar", () => {
  test("renders a <header> landmark", () => {
    render(<TopBar />);
    expect(screen.getByRole("banner")).toBeInTheDocument();
  });

  test("renders the wordmark", () => {
    render(<TopBar />);
    expect(screen.getByText("Industrial Juggernaut")).toBeInTheDocument();
  });

  test("the wordmark uses the display serif (Cartouche Rule — the title plate)", () => {
    render(<TopBar />);
    expect(screen.getByText("Industrial Juggernaut")).toHaveClass("cartouche");
  });

  test("the wordmark is a home link that navigates in-app on plain click", async () => {
    const user = userEvent.setup();
    const onWordmarkClick = vi.fn();
    render(<TopBar onWordmarkClick={onWordmarkClick} />);
    const link = screen.getByRole("link", { name: "Industrial Juggernaut" });
    expect(link).toHaveAttribute("href", "/");
    await user.click(link);
    expect(onWordmarkClick).toHaveBeenCalledTimes(1);
  });

  test("a modifier-click on the wordmark is left to the browser (open-in-new-tab works)", async () => {
    const user = userEvent.setup();
    const onWordmarkClick = vi.fn();
    render(<TopBar onWordmarkClick={onWordmarkClick} />);
    await user.keyboard("[MetaLeft>]");
    await user.click(screen.getByRole("link", { name: "Industrial Juggernaut" }));
    await user.keyboard("[/MetaLeft]");
    expect(onWordmarkClick).not.toHaveBeenCalled();
  });

  test("keyboard order runs wordmark link, then the Instruments button", async () => {
    const user = userEvent.setup();
    render(<TopBar onInstrumentsClick={() => {}} />);
    await user.tab();
    expect(screen.getByRole("link", { name: "Industrial Juggernaut" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Instruments" })).toHaveFocus();
  });

  test("renders no Instruments button until something wires it (no dead brass)", () => {
    render(<TopBar />);
    expect(screen.queryByRole("button", { name: "Instruments" })).toBeNull();
  });

  test("calls onInstrumentsClick when the Instruments button is activated", async () => {
    const user = userEvent.setup();
    const onInstrumentsClick = vi.fn();
    render(<TopBar onInstrumentsClick={onInstrumentsClick} />);
    await user.click(screen.getByRole("button", { name: "Instruments" }));
    expect(onInstrumentsClick).toHaveBeenCalledTimes(1);
  });

  test("without turnLabel/seedLabel, renders no turn/seed readouts (instruments with nothing to report recede)", () => {
    render(<TopBar />);
    expect(screen.queryByTestId("topbar-turn")).toBeNull();
    expect(screen.queryByTestId("topbar-seed")).toBeNull();
  });

  test("each readout renders independently of the other", () => {
    render(<TopBar turnLabel="Round 3 · Oxide's move" />);
    expect(screen.getByTestId("topbar-turn")).toHaveTextContent("Round 3 · Oxide's move");
    expect(screen.queryByTestId("topbar-seed")).toBeNull();
  });

  test("with turnLabel/seedLabel, renders the given values", () => {
    render(<TopBar turnLabel="Round 3 · Oxide's move" seedLabel="0x9f3a" />);
    expect(screen.getByTestId("topbar-turn")).toHaveTextContent("Round 3 · Oxide's move");
    expect(screen.getByTestId("topbar-seed")).toHaveTextContent("0x9f3a");
  });

  test("the seed/config readout uses the mono face", () => {
    render(<TopBar seedLabel="0x9f3a" />);
    expect(screen.getByTestId("topbar-seed")).toHaveClass("mono");
  });

  test("carries the shell height token class, not an inline height", () => {
    render(<TopBar />);
    const header = screen.getByRole("banner");
    expect(header).toHaveClass(TOPBAR_HEIGHT_CLASS);
    expect(header.style.height).toBe("");
  });
});
