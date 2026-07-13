// ABOUTME: Structural pins for board-motion.css — the changed-hex emphasis pulse must be invisible
// ABOUTME: at rest (pure decoration), animate only under no-preference, and stay transform-led.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const css = readFileSync(join(import.meta.dirname, "board-motion.css"), "utf8");

describe("board-motion.css — the changed-hex emphasis pulse", () => {
  test("the pulse is INVISIBLE at rest — opacity 0 outside any media query", () => {
    // The inverse of the set pieces' opacity-floor rule: choreography stages already-visible
    // CONTENT, so its resting opacity floors above 0; the emphasis overlay is pure DECORATION,
    // so its resting (and reduced-motion) state must be fully hidden — a pulse that never fires
    // must leave no permanent ink on the map.
    const rule = css.match(/\.hex-emphasis\s*\{[^}]*\}/)?.[0];
    expect(rule).toBeDefined();
    expect(rule).toMatch(/opacity:\s*0\s*;/);
    // The base rule must sit OUTSIDE the media query (before it in this file).
    expect(css.indexOf(".hex-emphasis {")).toBeLessThan(css.indexOf("@media"));
  });

  test("the animation runs only under prefers-reduced-motion: no-preference", () => {
    const media = css.match(/@media \(prefers-reduced-motion: no-preference\)\s*\{[\s\S]*\}/)?.[0];
    expect(media).toBeDefined();
    expect(media).toMatch(/\.hex-emphasis\s*\{[^}]*animation:/);
    // No animation declaration leaks outside the media query.
    const outside = css.replace(/@media \(prefers-reduced-motion: no-preference\)\s*\{[\s\S]*\}/, "");
    expect(outside).not.toMatch(/animation:/);
  });

  test("the pulse keyframes are transform-led on the feedback scale (150-250ms)", () => {
    expect(css).toMatch(/@keyframes hex-emphasis-pulse/);
    expect(css).toMatch(/transform:\s*scale\(/);
    const duration = Number(css.match(/animation:\s*hex-emphasis-pulse\s+(\d+)ms/)?.[1]);
    expect(duration).toBeGreaterThanOrEqual(150);
    expect(duration).toBeLessThanOrEqual(250);
  });

  test("the pulse scales from its own cell center (SVG transform-box/origin)", () => {
    // Without fill-box + center, an SVG transform scales about the viewBox origin and the pulse
    // would fly toward a corner instead of swelling in place.
    const rule = css.match(/\.hex-emphasis\s*\{[^}]*\}/)?.[0];
    expect(rule).toMatch(/transform-box:\s*fill-box\s*;/);
    expect(rule).toMatch(/transform-origin:\s*center\s*;/);
  });
});
