// ABOUTME: Tests for workerCount — argv first, env second, os.cpus()-1 fallback, optional max clamp.
// ABOUTME: Stubs process.argv + process.env for each scenario; restores them so order doesn't leak.

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { workerCount } from "../../src/sweep/worker-count";

describe("workerCount", () => {
  const origArgv = process.argv;
  const origEnv = (process as unknown as { env: Record<string, string | undefined> }).env;

  beforeEach(() => {
    // Reset to a known-empty state for each test. We restore in afterEach.
    process.argv = ["node", "test"];
    (process as unknown as { env: Record<string, string | undefined> }).env = {};
  });

  afterEach(() => {
    process.argv = origArgv;
    (process as unknown as { env: Record<string, string | undefined> }).env = origEnv;
  });

  it("returns a positive integer when no argv, env, or override is provided (defaults to cpus-1)", () => {
    const n = workerCount();
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(1);
  });

  it("uses --workers N from argv when present and valid", () => {
    process.argv = ["node", "test", "--workers", "7"];
    expect(workerCount()).toBe(7);
  });

  it("ignores --workers when the value is missing or invalid (falls back to cpus-1)", () => {
    process.argv = ["node", "test", "--workers", "invalid"];
    const n = workerCount();
    expect(n).toBeGreaterThanOrEqual(1);
    // n should be cpus-1, NOT a NaN or 0.
    expect(Number.isInteger(n)).toBe(true);
  });

  it("ignores negative --workers values", () => {
    process.argv = ["node", "test", "--workers", "-3"];
    const n = workerCount();
    expect(n).toBeGreaterThanOrEqual(1);
  });

  it("uses SWEEP_WORKERS env when argv is absent", () => {
    (process as unknown as { env: Record<string, string | undefined> }).env = { SWEEP_WORKERS: "5" };
    expect(workerCount()).toBe(5);
  });

  it("argv takes precedence over SWEEP_WORKERS env", () => {
    process.argv = ["node", "test", "--workers", "9"];
    (process as unknown as { env: Record<string, string | undefined> }).env = { SWEEP_WORKERS: "2" };
    expect(workerCount()).toBe(9);
  });

  it("applies the max clamp", () => {
    process.argv = ["node", "test", "--workers", "100"];
    expect(workerCount({ max: 4 })).toBe(4);
  });

  it("max clamp does not raise a value below it", () => {
    process.argv = ["node", "test", "--workers", "2"];
    expect(workerCount({ max: 16 })).toBe(2);
  });
});
