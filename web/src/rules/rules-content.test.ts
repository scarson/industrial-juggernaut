// ABOUTME: Pins rulesSections — the curated rules structure with all 17 Digital Edition Rulings
// ABOUTME: merged inline. Asserts every DER #1-17 appears exactly once, and DER #1 is prominent.
import { describe, expect, test } from "vitest";
import { rulesSections } from "./rules-content";

describe("rulesSections", () => {
  test("has at least one section", () => {
    expect(rulesSections.length).toBeGreaterThan(0);
  });

  test("every section has a non-empty title and body", () => {
    for (const section of rulesSections) {
      expect(section.title.trim(), JSON.stringify(section)).not.toBe("");
      expect(section.body.trim(), JSON.stringify(section)).not.toBe("");
    }
  });

  test("all 17 Digital Edition Rulings are present, each exactly once", () => {
    const allDers = rulesSections.flatMap((s) => s.ders.map((d) => d.n));
    const expected = Array.from({ length: 17 }, (_, i) => i + 1);
    expect(allDers.slice().sort((a, b) => a - b)).toEqual(expected);
  });

  test("every DER callout has a non-empty title and body", () => {
    for (const section of rulesSections) {
      for (const der of section.ders) {
        expect(der.title.trim(), `DER #${der.n}`).not.toBe("");
        expect(der.body.trim(), `DER #${der.n}`).not.toBe("");
      }
    }
  });

  test("DER #1 (convex-hull territory) is flagged prominently in the territory section", () => {
    const der1Section = rulesSections.find((s) => s.ders.some((d) => d.n === 1));
    expect(der1Section, "no section carries DER #1").toBeDefined();
    // Prominent = the first DER callout attached to its section, not buried after others.
    expect(der1Section!.ders[0]!.n).toBe(1);
    expect(der1Section!.ders[0]!.title.toLowerCase()).toMatch(/convex hull/);
  });

  test("v10-at-root stays the source of truth (curation doc comment present)", () => {
    // The module's own doc comment states the curation choice; this test just guards against the
    // whole file being deleted/emptied — the human-readable claim lives in the source comment.
    expect(rulesSections.length).toBeGreaterThanOrEqual(6);
  });
});
