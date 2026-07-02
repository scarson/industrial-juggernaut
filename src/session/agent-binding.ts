// ABOUTME: The one module that value-imports src/agent — maps a SeatConfig to its driving Agent.
// ABOUTME: The reducer takes this as an injected parameter; the DO host imports it (Worker bundles agents).
import { greedyAgent, type Agent } from "../agent/agent";
import { heuristicAgent } from "../agent/heuristic-agent";
import type { SeatConfig } from "./types";

export function agentForSeat(seat: SeatConfig): Agent {
  if (seat.kind === "human") throw new Error("agentForSeat: a human seat has no agent");
  if (seat.agent === "greedy") return greedyAgent(seat.archetype);
  if (seat.agent === "heuristic") return heuristicAgent();
  throw new Error(`agentForSeat: unsupported agent ${(seat as { agent?: string }).agent}`);
}
