// ABOUTME: Tests for useBreakpoint — matchMedia-driven tier selection (wide/narrow/compact),
// ABOUTME: live tier updates on change events, change subscription, and cleanup on unmount.
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useBreakpoint } from "./useBreakpoint";

interface StubList {
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}

/**
 * Installs a matchMedia stub that reports `matches` for whichever query's threshold the
 * current viewport width satisfies. Mirrors the house pattern in design/motion.test.ts's
 * stubReducedMotion, extended two ways: listeners are tracked per MediaQueryList so cleanup
 * can be asserted, and `matches` is a live getter over a mutable width so `setWidth` can
 * simulate the viewport crossing a breakpoint (updating `matches` AND firing the registered
 * change handlers, as a real MediaQueryList does).
 */
function stubMatchMediaForWidth(initialWidth: number): {
  lists: StubList[];
  setWidth: (next: number) => void;
} {
  let width = initialWidth;
  const lists: StubList[] = [];
  const registrations: { listeners: Set<(ev: { matches: boolean }) => void>; threshold: number }[] =
    [];

  vi.stubGlobal("matchMedia", (query: string) => {
    const minWidthMatch = query.match(/min-width:\s*(\d+)px/);
    const threshold = minWidthMatch === null ? Number.POSITIVE_INFINITY : Number(minWidthMatch[1]);
    const listeners = new Set<(ev: { matches: boolean }) => void>();
    const addEventListener = vi.fn((type: string, handler: (ev: { matches: boolean }) => void) => {
      if (type === "change") listeners.add(handler);
    });
    const removeEventListener = vi.fn(
      (type: string, handler: (ev: { matches: boolean }) => void) => {
        if (type === "change") listeners.delete(handler);
      },
    );
    lists.push({ addEventListener, removeEventListener });
    registrations.push({ listeners, threshold });
    return {
      get matches() {
        return width >= threshold;
      },
      media: query,
      addEventListener,
      removeEventListener,
    };
  });

  return {
    lists,
    setWidth(next: number) {
      width = next;
      for (const { listeners, threshold } of registrations) {
        for (const handler of listeners) {
          handler({ matches: width >= threshold });
        }
      }
    },
  };
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

  test("updates the tier live when the viewport crosses a breakpoint", () => {
    const { setWidth } = stubMatchMediaForWidth(1200);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("wide");

    act(() => setWidth(900));
    expect(result.current).toBe("narrow");

    act(() => setWidth(500));
    expect(result.current).toBe("compact");

    act(() => setWidth(1200));
    expect(result.current).toBe("wide");
  });

  test("subscribes a change listener on mount", () => {
    const { lists } = stubMatchMediaForWidth(1100);
    renderHook(() => useBreakpoint());
    const subscribed = lists.filter((list) => list.addEventListener.mock.calls.length > 0);
    expect(subscribed.length).toBeGreaterThan(0);
    for (const list of subscribed) {
      expect(list.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    }
  });

  test("removes every subscribed change listener on unmount (no leak)", () => {
    const { lists } = stubMatchMediaForWidth(1100);
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
