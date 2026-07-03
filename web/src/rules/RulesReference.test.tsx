// ABOUTME: Structure tests for RulesReference — renders every curated section from rules-content,
// ABOUTME: with DER #1 present and prominent among the Territory & Perimeter section's callouts.
import { describe, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { RulesReference } from "./RulesReference";
import { rulesSections } from "./rules-content";

describe("RulesReference", () => {
  test("renders a heading naming the rules reference", () => {
    render(<RulesReference />);
    expect(screen.getByRole("heading", { name: /rules/i, level: 1 })).toBeInTheDocument();
  });

  test("renders every curated section title", () => {
    render(<RulesReference />);
    for (const section of rulesSections) {
      expect(screen.getByRole("heading", { name: section.title })).toBeInTheDocument();
    }
  });

  test("renders every DER callout with its number and title", () => {
    render(<RulesReference />);
    for (const section of rulesSections) {
      for (const der of section.ders) {
        expect(screen.getByText(new RegExp(`DER #${der.n}\\b`))).toBeInTheDocument();
        expect(screen.getByText(der.title)).toBeInTheDocument();
      }
    }
  });

  test("DER #1 renders first among the Territory & Perimeter section's callouts", () => {
    render(<RulesReference />);
    const territorySection = screen.getByTestId("rules-section-territory");
    const callouts = within(territorySection).getAllByTestId(/^der-callout-/);
    expect(callouts[0]).toHaveAttribute("data-testid", "der-callout-1");
  });

  test("no console errors during render", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<RulesReference />);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
