// ABOUTME: Vitest setup for the SPA project — registers jest-dom matchers and RTL's
// ABOUTME: per-test DOM cleanup (there's no global `afterEach` here for RTL to auto-detect).
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(cleanup);
