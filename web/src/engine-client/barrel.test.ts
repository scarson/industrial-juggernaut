// ABOUTME: Proves the engine-client barrel actually resolves and re-exports the agent-free
// ABOUTME: engine + deep session symbols the client depends on, plus a GameDriver type smoke.
import { describe, expect, test } from "vitest";
import { applyEntry, replayLog, stateHash, legalActions, control, initGame, defaultConfig } from "./barrel";
import type { DriverCommand, DriverEvent } from "../game/driver";

describe("engine-client barrel", () => {
  test("re-exports the agent-free engine + deep session functions", () => {
    expect(typeof applyEntry).toBe("function");
    expect(typeof replayLog).toBe("function");
    expect(typeof stateHash).toBe("function");
    expect(typeof legalActions).toBe("function");
    expect(typeof control).toBe("function");
    expect(typeof initGame).toBe("function");
    expect(typeof defaultConfig).toBe("function");
  });
});

describe("GameDriver types", () => {
  // Type-level smoke: a valid literal of each union typechecks. `tsc --noEmit`
  // is the real assertion here; the runtime expect just gives the smoke a home.
  test("DriverCommand and DriverEvent accept valid literals", () => {
    const command: DriverCommand = { type: "pass" };
    const event: DriverEvent = { type: "connection", status: "open" };
    expect(command.type).toBe("pass");
    expect(event.type).toBe("connection");
  });
});
