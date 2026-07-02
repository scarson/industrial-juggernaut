// ABOUTME: Pins REPLAY_VERSION/AGENT_VERSION (src/host/version.ts) to the live hash of their source closures.
// ABOUTME: An unbumped replay-closure or agent-closure change fails this test (mirrors the --check CLI guard).
import { test, expect } from "vitest";
import { REPLAY_VERSION, AGENT_VERSION } from "../src/host/version";
import { computeReplayVersion, computeAgentVersion } from "../scripts/compute-replay-version";

test("REPLAY_VERSION matches the computed hash of the replay closure", () => {
  expect(REPLAY_VERSION).toBe(computeReplayVersion());
});

test("AGENT_VERSION matches the computed hash of src/agent/**", () => {
  expect(AGENT_VERSION).toBe(computeAgentVersion());
});

test("REPLAY_VERSION and AGENT_VERSION are distinct", () => {
  expect(REPLAY_VERSION).not.toBe(AGENT_VERSION);
});

test("computeReplayVersion is deterministic across calls", () => {
  expect(computeReplayVersion()).toBe(computeReplayVersion());
});

test("computeAgentVersion is deterministic across calls", () => {
  expect(computeAgentVersion()).toBe(computeAgentVersion());
});
