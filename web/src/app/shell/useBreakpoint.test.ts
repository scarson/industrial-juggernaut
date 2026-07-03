// ABOUTME: Tests for useBreakpoint — matchMedia-driven tier selection (wide/narrow/compact),
// ABOUTME: change subscription, and listener cleanup on unmount.
import { afterEach, describe, expect, test, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useBreakpoint } from "./useBreakpoint";

/**
 * Installs a matchMedia stub that reports `matches` for whichever query's threshold the
 * given viewport width satisfies. Mirrors the house pattern in design/motion.test.ts's
 * stubReducedMotion, extended to track listeners per MediaQueryList so cleanup can be
 * asserted.
 */
function stubMatchMediaForWidth(width: number): {
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}[] {
  const lists: {
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
  }[] = [];

  vi.stubGlobal("matchMedia", (query: string) => {
    const minWidthMatch = query.match(/min-width:\s*(\d+)px/);
    const matches = minWidthMatch !== null && width >= Number(minWidthMatch[1]);
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const list = { addEventListener, removeEventListener };
    lists.push(list);
    return {
      matches,
      media: query,
      addEventListener,
      removeEventListener,
    };
  });

  return lists;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useBreakpoint", () => {
  test("returns \"compact\" below 768px", () => {
    stubMatchMediaForWidth(500);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("compact");
  });

  test("returns \"narrow\" between 768 and 1099px", () => {
    stubMatchMediaForWidth(900);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("narrow");
  });

  test("returns \"wide\" at 1100px and above", () => {
    stubMatchMediaForWidth(1100);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("wide");
  });

  test("subscribes a change listener on mount", () => {
    const lists = stubMatchMediaForWidth(1100);
    renderHook(() => useBreakpoint());
    const subscribed = lists.filter((list) => list.addEventListener.mock.calls.length > 0);
    expect(subscribed.length).toBeGreaterThan(0);
    for (const list of subscribed) {
      expect(list.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    }
  });

  test("removes every subscribed change listener on unmount (no leak)", () => {
    const lists = stubMatchMediaForWidth(1100);
    const { unmount } = renderHook(() => useBreakpoint());
    const subscribed = lists.filter((list) => list.addEventListener.mock.calls.length > 0);
    expect(subscribed.length).toBeGreaterThan(0);
    for (const list of subscribed) {
      expect(list.removeEventListener).not.toHaveBeenCalled();
    }
    unmount();
    for (const list of subscribed) {
      expect(list.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    }
  });
});
