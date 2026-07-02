// ABOUTME: agentForSeat binding tests — maps SeatConfig to the real engine agents.
import { test, expect } from "vitest";
import { agentForSeat } from "../../src/session/agent-binding";

test("agentForSeat returns a callable for agent seats and throws on human", () => {
  expect(typeof agentForSeat({ kind: "agent", agent: "heuristic" })).toBe("function");
  // Archetype is "aggressive" | "economic" | "expansionist" (src/agent/archetypes.ts) — NOT "balanced".
  expect(typeof agentForSeat({ kind: "agent", agent: "greedy", archetype: "aggressive" })).toBe("function");
  expect(() => agentForSeat({ kind: "human" })).toThrow(/human seat has no agent/i);
});
