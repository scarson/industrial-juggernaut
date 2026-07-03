// ABOUTME: Structure tests for RightRail — expanded content at "wide", a collapsed toggle
// ABOUTME: with correct aria-expanded at "narrow"/"compact", and keyboard-focusable toggle.
import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RightRail } from "./RightRail";

describe("RightRail", () => {
  test("at wide, renders as a complementary region with its content visible", () => {
    render(
      <RightRail breakpoint="wide">
        <p>Rail content</p>
      </RightRail>,
    );
    expect(screen.getByRole("complementary")).toBeInTheDocument();
    expect(screen.getByText("Rail content")).toBeVisible();
    expect(screen.queryByRole("button", { name: /rail/i })).toBeNull();
  });

  test("at narrow, renders a collapsed toggle button with aria-expanded=false and no content", () => {
    render(
      <RightRail breakpoint="narrow">
        <p>Rail content</p>
      </RightRail>,
    );
    const toggle = screen.getByRole("button", { name: /rail/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Rail content")).toBeNull();
  });

  test("at narrow, activating the toggle expands the rail and flips aria-expanded", async () => {
    const user = userEvent.setup();
    render(
      <RightRail breakpoint="narrow">
        <p>Rail content</p>
      </RightRail>,
    );
    const toggle = screen.getByRole("button", { name: /rail/i });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Rail content")).toBeVisible();
  });

  test("the narrow toggle is keyboard-focusable", async () => {
    const user = userEvent.setup();
    render(
      <RightRail breakpoint="narrow">
        <p>Rail content</p>
      </RightRail>,
    );
    await user.tab();
    expect(screen.getByRole("button", { name: /rail/i })).toHaveFocus();
  });

  test("at compact, also renders the collapsed toggle (check-in tier collapses too)", () => {
    render(
      <RightRail breakpoint="compact">
        <p>Rail content</p>
      </RightRail>,
    );
    const toggle = screen.getByRole("button", { name: /rail/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});
