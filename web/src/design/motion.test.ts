// ABOUTME: Unit tests for the motion tokens — transitionOf's reduced-motion vs. animated
// ABOUTME: branches (matchMedia mocked for both) and the 150–250ms feedback-duration bound.
import { afterEach, describe, expect, test, vi } from "vitest";
import { duration, easing, transitionOf } from "./motion";

/** Install a matchMedia stub that reports the given reduced-motion preference. */
function stubReducedMotion(prefersReduced: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("prefers-reduced-motion: reduce") ? prefersReduced : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("transitionOf", () => {
  test("reduced-motion true → the instant/none branch", () => {
    stubReducedMotion(true);
    expect(transitionOf("opacity")).toBe("none");
    // Holds regardless of the duration/easing requested.
    expect(transitionOf("transform", "slow", "enter")).toBe("none");
  });

  test("reduced-motion false → a property duration easing string", () => {
    stubReducedMotion(false);
    expect(transitionOf("opacity", "base")).toBe(
      `opacity ${duration.base}ms ${easing.standard}`,
    );
    expect(transitionOf("transform", "fast", "enter")).toBe(
      `transform ${duration.fast}ms ${easing.enter}`,
    );
  });

  test("defaults to base duration and standard easing", () => {
    stubReducedMotion(false);
    expect(transitionOf("color")).toBe(`color ${duration.base}ms ${easing.standard}`);
  });
});

describe("feedback durations sit in the 150–250ms band", () => {
  test("every duration token is within [150, 250]", () => {
    for (const ms of Object.values(duration)) {
      expect(ms).toBeGreaterThanOrEqual(150);
      expect(ms).toBeLessThanOrEqual(250);
    }
  });
});
