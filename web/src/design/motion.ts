// ABOUTME: Motion tokens — 150–250ms feedback durations + easing, and a reduced-motion probe.
// ABOUTME: Choreographed set pieces (combat/elimination/victory) use their own longer timings.

/**
 * Feedback durations, in milliseconds. These cover the everyday responsive
 * feedback the brief pins at 150–250ms (hover, selection, composer reveal). The
 * choreographed moments — combat draw, elimination, victory — are staged
 * separately and are not part of this scale.
 */
export const duration = {
  /** Snappy state change — hover, press, small toggles. */
  fast: 150,
  /** Default feedback — selection, composer open/close, tooltip. */
  base: 200,
  /** Deliberate feedback — panel/rail slide, larger reveals. */
  slow: 250,
} as const;

export type DurationToken = keyof typeof duration;

/** Easing curves. `standard` for most feedback; `enter`/`exit` for asymmetric reveals. */
export const easing = {
  /** Symmetric ease for in-place state changes. */
  standard: "cubic-bezier(0.2, 0, 0.2, 1)",
  /** Decelerate — elements entering the scene. */
  enter: "cubic-bezier(0, 0, 0.2, 1)",
  /** Accelerate — elements leaving the scene. */
  exit: "cubic-bezier(0.4, 0, 1, 1)",
} as const;

export type EasingToken = keyof typeof easing;

/**
 * Whether the user has asked for reduced motion. SSR-safe: returns `false` when
 * there is no DOM (no `window` / `matchMedia`), so server or test environments
 * without a media-query implementation default to the non-reduced path.
 *
 * Every animation must have a reduced-motion alternative (PRODUCT.md); call this
 * to branch, or prefer the CSS `@media (prefers-reduced-motion: reduce)` query
 * where the animation is CSS-driven.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * A CSS `transition` shorthand from the tokens, e.g.
 * `transitionOf("opacity", "base")` → `"opacity 200ms cubic-bezier(0.2, 0, 0.2, 1)"`.
 * Returns `"none"` under reduced-motion so callers get a single honest value.
 */
export function transitionOf(
  property: string,
  durationToken: DurationToken = "base",
  easingToken: EasingToken = "standard",
): string {
  if (prefersReducedMotion()) return "none";
  return `${property} ${duration[durationToken]}ms ${easing[easingToken]}`;
}
