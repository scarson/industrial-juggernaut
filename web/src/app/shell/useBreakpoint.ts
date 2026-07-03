// ABOUTME: matchMedia-driven responsive tier hook — wide/narrow/compact per UI brief §5's
// ABOUTME: asserted breakpoint defaults (rail collapses below ~1100px; compact below ~768px).
import { useEffect, useState } from "react";

/**
 * Layout tier for the app shell. `wide` shows the right rail expanded; `narrow` collapses it
 * behind a toggle; `compact` is the "check-in" tier (board-only chrome, composing gated per
 * the UI brief — P0 only exposes the tier, later phases gate on it).
 */
export type Breakpoint = "wide" | "narrow" | "compact";

const NARROW_MIN_WIDTH = 768;
const WIDE_MIN_WIDTH = 1100;

const NARROW_QUERY = `(min-width: ${NARROW_MIN_WIDTH}px)`;
const WIDE_QUERY = `(min-width: ${WIDE_MIN_WIDTH}px)`;

function tierOf(narrowQuery: MediaQueryList, wideQuery: MediaQueryList): Breakpoint {
  if (wideQuery.matches) return "wide";
  if (narrowQuery.matches) return "narrow";
  return "compact";
}

/** SSR-safe: no `window`/`matchMedia` defaults to `wide`, matching prefersReducedMotion's guard. */
function readBreakpoint(): Breakpoint {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "wide";
  }
  return tierOf(window.matchMedia(NARROW_QUERY), window.matchMedia(WIDE_QUERY));
}

/**
 * The current responsive tier, updated live as the viewport crosses a breakpoint. Subscribes
 * to both threshold queries via `change` listeners and cleans them up on unmount.
 */
export function useBreakpoint(): Breakpoint {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>(readBreakpoint);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const narrowQuery = window.matchMedia(NARROW_QUERY);
    const wideQuery = window.matchMedia(WIDE_QUERY);
    const handleChange = () => setBreakpoint(tierOf(narrowQuery, wideQuery));

    narrowQuery.addEventListener("change", handleChange);
    wideQuery.addEventListener("change", handleChange);
    handleChange();

    return () => {
      narrowQuery.removeEventListener("change", handleChange);
      wideQuery.removeEventListener("change", handleChange);
    };
  }, []);

  return breakpoint;
}
