// ABOUTME: Sweep worker process — reads NDJSON SimJobs on stdin, plays each game, writes the GameRecord as NDJSON on stdout.
// ABOUTME: Spawned by GamePool; stays alive across jobs so process-startup cost is paid once, not per game.

import { createInterface } from "node:readline";
import { runOneGame } from "./run";
import { buildAgent } from "./agent-spec";
import type { SimJob } from "./pool";

const rl = createInterface({ input: process.stdin });

rl.on("line", (line) => {
  if (line.trim() === "") return;
  const { id, job } = JSON.parse(line) as { id: number; job: SimJob };
  try {
    const agents = job.seatAgents.map(buildAgent);
    const record = runOneGame(job.config, BigInt(job.seed), job.nPlayers, (p) => agents[p]!, job.turnCap);
    process.stdout.write(JSON.stringify({ id, ok: true, record }) + "\n");
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    process.stdout.write(JSON.stringify({ id, ok: false, error }) + "\n");
  }
});
