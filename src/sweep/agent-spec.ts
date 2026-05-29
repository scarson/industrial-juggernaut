// ABOUTME: AgentSpec + buildAgent — JSON-serializable agent descriptors so worker processes can reconstruct agents.
// ABOUTME: Agents are closures (not serializable); a spec names the kind + its knobs, and buildAgent rebuilds it.

import { greedyAgent, type Agent } from "../agent/agent";
import { heuristicAgent } from "../agent/heuristic-agent";
import { lookahead2Agent } from "../agent/lookahead2";
import { lookahead2MultiAgent } from "../agent/lookahead2-multi";
import { lookaheadNAgent } from "../agent/lookaheadN";
import { mctsAgent, defaultMctsParams } from "../agent/mcts-agent";
import { randomAgent } from "../agent/random";
import type { Archetype } from "../agent/archetypes";

/**
 * A serializable description of an agent. Workers receive specs over JSON and
 * rebuild the actual `Agent` closure via {@link buildAgent}. `mcts.iterations` is
 * the one strength/speed knob exposed for sharded runs; omitting it uses the
 * agent default (the rest of MctsParams stays at its defaults).
 */
export type AgentSpec =
  | { kind: "heuristic"; allianceWeight?: number; breakAllianceWeight?: number }
  | { kind: "greedy"; archetype: Archetype }
  | { kind: "mcts"; iterations?: number }
  | { kind: "lookahead2" }
  | { kind: "lookahead2-multi" }
  | { kind: "lookaheadN"; depth: number }
  | { kind: "random" };

/** Reconstruct the `Agent` closure named by `spec`. Deterministic — the agent itself carries no hidden state. */
export function buildAgent(spec: AgentSpec): Agent {
  switch (spec.kind) {
    case "heuristic":
      return heuristicAgent({
        ...(spec.allianceWeight !== undefined && { allianceWeight: spec.allianceWeight }),
        ...(spec.breakAllianceWeight !== undefined && { breakAllianceWeight: spec.breakAllianceWeight }),
      });
    case "greedy":
      return greedyAgent(spec.archetype);
    case "mcts":
      return spec.iterations === undefined
        ? mctsAgent()
        : mctsAgent({ ...defaultMctsParams(), iterations: spec.iterations });
    case "lookahead2":
      return lookahead2Agent();
    case "lookahead2-multi":
      return lookahead2MultiAgent();
    case "lookaheadN":
      return lookaheadNAgent(spec.depth);
    case "random":
      return randomAgent();
  }
}
