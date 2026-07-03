// ABOUTME: Vitest setup for the SPA project — registers jest-dom matchers and RTL's
// ABOUTME: per-test DOM cleanup (there's no global `afterEach` here for RTL to auto-detect).
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom ships no ResizeObserver; Radix primitives (e.g. Slider) construct one on mount. Stub it
// with a no-op so those components render under jsdom — the real browser provides the API.
if (!("ResizeObserver" in globalThis)) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

afterEach(cleanup);
