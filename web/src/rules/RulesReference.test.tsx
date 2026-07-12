// ABOUTME: Structure tests for RulesReference — renders every curated section from rules-content,
// ABOUTME: with DER #1 present and prominent among the Territory & Perimeter section's callouts.
import { describe, expect, test, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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

  test("renders every ruling callout with a self-explaining kicker, never the bare DER acronym", () => {
    render(<RulesReference />);
    for (const section of rulesSections) {
      for (const der of section.ders) {
        expect(screen.getByText(`Digital Edition Ruling ${der.n}`)).toBeInTheDocument();
        expect(screen.getByText(der.title)).toBeInTheDocument();
      }
    }
    // The acronym is working-session shorthand — a player never sees it.
    expect(screen.queryByText(/\bDER\b/)).not.toBeInTheDocument();
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

describe("RulesReference — navigation & collapse", () => {
  test("renders a hotlinked table of contents with one anchor per section", () => {
    render(<RulesReference />);
    const toc = screen.getByRole("navigation", { name: /contents/i });
    for (const section of rulesSections) {
      const link = within(toc).getByRole("link", { name: section.title });
      expect(link).toHaveAttribute("href", `#rules-${section.id}`);
      // The anchor target exists.
      expect(document.getElementById(`rules-${section.id}`)).not.toBeNull();
    }
  });

  test("every section is collapsible and open by default (a reference reads top-to-bottom)", () => {
    render(<RulesReference />);
    for (const section of rulesSections) {
      const el = screen.getByTestId(`rules-section-${section.id}`);
      const details = el.querySelector("details") ?? (el.tagName === "DETAILS" ? el : null);
      expect(details, section.id).not.toBeNull();
      expect(details!.hasAttribute("open"), section.id).toBe(true);
      // The section title lives in the summary — the click/keyboard disclosure control.
      const summary = details!.querySelector("summary");
      expect(summary?.textContent).toContain(section.title);
    }
  });
});

describe("RulesReference — illustrative vignettes", () => {
  test("the territory section carries an engine-rendered vignette with a caption", async () => {
    render(<RulesReference />);
    const territory = screen.getByTestId("rules-section-territory");
    const figure = await within(territory).findByTestId("rules-vignette-perimeter");
    // The board arrives from a lazy chunk — wait for the real render, not the Suspense fallback.
    await waitFor(() => expect(figure.querySelector("svg.board-surface")).not.toBeNull());
    expect(figure.querySelector("figcaption")?.textContent).toMatch(/perimeter|hull/i);
  });

  test("the setup section illustrates the outer-ring placement choice", async () => {
    render(<RulesReference />);
    const setup = screen.getByTestId("rules-section-setup");
    const figure = await within(setup).findByTestId("rules-vignette-placement");
    // The vignette actually highlights placement cells — the picture shows the rule.
    await waitFor(() =>
      expect(figure.querySelectorAll('polygon[data-highlight="placement"]').length).toBeGreaterThan(0),
    );
  });
});
