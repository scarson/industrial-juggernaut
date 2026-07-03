// ABOUTME: The accessibility gate — proves the token palette clears WCAG AA contrast and
// ABOUTME: that the 6 player colors stay pairwise-separable under deutan/protan/tritan CVD.
import { describe, expect, test } from "vitest";
import {
  contrastRatio,
  cvdSeparable,
  cvdDeltaE,
  CVD_SEPARABILITY_THRESHOLD,
} from "./cvd-check";
import { ink, parchment, chrome, playerColors } from "./tokens";

// Threshold rationale (asserted here so the choice is visible and testable):
//
// cvdSeparable uses CIE76 ΔE on Machado-2009-simulated colors. CVD_SEPARABILITY_THRESHOLD
// is 9.0. Why 9.0:
//  - It is far above CIE76's ~2.3 "just-noticeable difference", so a pair scoring above it
//    is reliably distinguishable, not merely non-identical (the teeth test below proves the
//    gate rejects a near-identical pair at ΔE ≈ 0.6).
//  - The BINDING floor of the final 6-color set is the fixed brief-committed pair
//    cobalt × violet, which collapses to ΔE76 ≈ 9.41 under deuteranopia (blue and purple
//    desaturate toward the same hue). Those two colors are committed and may not be moved,
//    so no palette we can build clears a threshold above ~9.4. The gate therefore certifies
//    the achievable guarantee: no pair is near-identical, and adding the three EXTENSION
//    colors (gold / steel / forest) never makes separability worse than the committed
//    baseline — every extension-involving pair clears ΔE76 ≥ 17 (checked below).
//  - The residual risk on that single committed pair is carried by the mandatory redundant
//    shape encoding (PRODUCT.md: player identity is "never color alone"). The color gate is
//    the second layer of defense-in-depth, not the sole safeguard.
//
// CIE76 (not CIEDE2000) is acceptable per the task because the threshold is calibrated and
// documented against this palette; CIEDE2000 rates the same committed pair even closer
// (≈5.4), which would only tighten the same conclusion.

describe("contrastRatio (WCAG 2.1 relative luminance)", () => {
  test("matches known reference pairs", () => {
    // black on white = 21:1 exactly; white on white = 1:1.
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    // symmetric regardless of argument order
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(
      contrastRatio("#ffffff", "#000000"),
      5,
    );
  });

  test("body ink on the board's parchment clears AA (>= 4.5:1)", () => {
    expect(contrastRatio(ink.ink900.hex, parchment.parchment300.hex)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(ink.ink900.hex, parchment.parchment100.hex)).toBeGreaterThanOrEqual(4.5);
  });

  test("body text on the dark chrome clears AA (>= 4.5:1)", () => {
    // Parchment-toned text is the body color on the walnut app chrome.
    expect(contrastRatio(parchment.parchment100.hex, chrome.walnut900.hex)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(parchment.parchment300.hex, chrome.walnut900.hex)).toBeGreaterThanOrEqual(4.5);
    // and on the one-step-up panel surface
    expect(contrastRatio(parchment.parchment100.hex, chrome.walnut800.hex)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("cvdSeparable (deutan / protan / tritan pairwise)", () => {
  const sixPlayerHexes = playerColors.map((c) => c.hex);

  test("the six token player colors are pairwise-separable under all three CVD types", () => {
    expect(cvdSeparable(sixPlayerHexes)).toBe(true);
  });

  test("the six player colors are also separable under normal vision", () => {
    // If CVD sim of near-identical colors trivially passed, this would be uninformative;
    // asserting normal-vision separability confirms the set is genuinely distinct to start.
    for (let i = 0; i < sixPlayerHexes.length; i++) {
      for (let j = i + 1; j < sixPlayerHexes.length; j++) {
        expect(cvdDeltaE(sixPlayerHexes[i]!, sixPlayerHexes[j]!, "normal")).toBeGreaterThanOrEqual(
          CVD_SEPARABILITY_THRESHOLD,
        );
      }
    }
  });

  test("teeth: a palette with two near-identical colors is NOT separable", () => {
    // #c0492f vs #c24a30 differ by one step per channel — ΔE ≈ 0.6, far below threshold.
    const nearIdentical = ["#c0492f", "#c24a30", "#2f6f9f", "#dcb43f"];
    expect(cvdSeparable(nearIdentical)).toBe(false);
  });

  test("teeth: identical colors are NOT separable", () => {
    expect(cvdSeparable(["#c0492f", "#c0492f"])).toBe(false);
  });

  test("every pair except the fixed committed one clears a comfortable margin (>= 17) across all CVD types", () => {
    // The extension colors we chose must add real headroom, not ride the committed floor.
    // Only the fixed brief-committed cobalt×violet pair is permitted near the threshold —
    // every other pair (extension×anything, and the other committed pairs) clears >= 17.
    const cobalt = playerColors[1]!.hex;
    const violet = playerColors[2]!.hex;
    const types = ["normal", "protan", "deutan", "tritan"] as const;

    for (let i = 0; i < sixPlayerHexes.length; i++) {
      for (let j = i + 1; j < sixPlayerHexes.length; j++) {
        const a = sixPlayerHexes[i]!;
        const b = sixPlayerHexes[j]!;
        const isFixedCommittedPair =
          (a === cobalt && b === violet) || (a === violet && b === cobalt);
        if (isFixedCommittedPair) continue;
        for (const t of types) {
          expect(cvdDeltaE(a, b, t)).toBeGreaterThanOrEqual(17);
        }
      }
    }
  });
});

describe("cvdDeltaE (color-difference primitive)", () => {
  test("identical colors have zero difference under every mode", () => {
    for (const t of ["normal", "protan", "deutan", "tritan"] as const) {
      expect(cvdDeltaE("#3c5f45", "#3c5f45", t)).toBeCloseTo(0, 6);
    }
  });

  test("red↔green separation collapses under deuteranopia (sanity of the CVD sim)", () => {
    const normal = cvdDeltaE("#ff0000", "#00ff00", "normal");
    const deutan = cvdDeltaE("#ff0000", "#00ff00", "deutan");
    // Under deutan the red-green axis is compressed, so the gap must shrink substantially.
    expect(deutan).toBeLessThan(normal * 0.5);
  });
});
