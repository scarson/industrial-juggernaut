// ABOUTME: Structure tests for TopBar — header landmark, wordmark, Instruments button,
// ABOUTME: turn/seed placeholder rendering, and the ≤44px height token (not a magic number).
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

  test("renders a keyboard-focusable Instruments button", async () => {
    const user = userEvent.setup();
    render(<TopBar />);
    const button = screen.getByRole("button", { name: "Instruments" });
    await user.tab();
    expect(button).toHaveFocus();
  });

  test("calls onInstrumentsClick when the Instruments button is activated", async () => {
    const user = userEvent.setup();
    const onInstrumentsClick = vi.fn();
    render(<TopBar onInstrumentsClick={onInstrumentsClick} />);
    await user.click(screen.getByRole("button", { name: "Instruments" }));
    expect(onInstrumentsClick).toHaveBeenCalledTimes(1);
  });

  test("without turnLabel/seedLabel, renders em-dash placeholders", () => {
    render(<TopBar />);
    expect(screen.getByTestId("topbar-turn")).toHaveTextContent("—");
    expect(screen.getByTestId("topbar-seed")).toHaveTextContent("—");
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
