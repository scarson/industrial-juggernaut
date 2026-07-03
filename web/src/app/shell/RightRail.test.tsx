// ABOUTME: Structure tests for RightRail — visible content at "wide", a collapsed toggle with
// ABOUTME: correct aria-expanded + a resolving aria-controls at "narrow"/"compact", named landmark.
import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RightRail } from "./RightRail";

describe("RightRail", () => {
  test("at wide, renders as a complementary region named Rail with its content visible", () => {
    render(
      <RightRail breakpoint="wide">
        <p>Rail content</p>
      </RightRail>,
    );
    expect(screen.getByRole("complementary", { name: "Rail" })).toBeInTheDocument();
    expect(screen.getByText("Rail content")).toBeVisible();
    expect(screen.queryByRole("button", { name: /rail/i })).toBeNull();
  });

  test("at narrow, renders a collapsed toggle with aria-expanded=false and hidden content", () => {
    render(
      <RightRail breakpoint="narrow">
        <p>Rail content</p>
      </RightRail>,
    );
    const toggle = screen.getByRole("button", { name: /rail/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // The panel stays mounted (so aria-controls always resolves) but is hidden while collapsed.
    expect(screen.getByText("Rail content")).not.toBeVisible();
  });

  test("at narrow, the collapsed landmark carries the same Rail name as the wide tier", () => {
    render(
      <RightRail breakpoint="narrow">
        <p>Rail content</p>
      </RightRail>,
    );
    expect(screen.getByRole("complementary", { name: "Rail" })).toBeInTheDocument();
  });

  test("the toggle's aria-controls resolves to the panel element while collapsed", () => {
    render(
      <RightRail breakpoint="narrow">
        <p>Rail content</p>
      </RightRail>,
    );
    const toggle = screen.getByRole("button", { name: /rail/i });
    const panelId = toggle.getAttribute("aria-controls");
    expect(panelId).not.toBeNull();
    const panel = document.getElementById(panelId!);
    expect(panel).not.toBeNull();
    expect(panel).toContainElement(screen.getByText("Rail content"));
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
    expect(screen.getByRole("complementary", { name: "Rail" })).toBeInTheDocument();
  });
});
