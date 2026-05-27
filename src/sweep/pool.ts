// ABOUTME: GamePool — a persistent pool of spawned tsx worker processes that each play independent games in parallel.
// ABOUTME: Deterministic: jobs are seed-indexed and results return in submission order, so a sharded run equals a serial one.

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { GameRecord } from "./metrics";
import type { AgentSpec } from "./agent-spec";
import type { RuleConfig } from "../engine/config";

/**
 * One unit of parallel work: play a single game. `seed` is a decimal string
 * because JSON cannot carry a bigint. `seatAgents[p]` is the agent for seat p
 * (length must equal `nPlayers`). The worker rebuilds the agents via `buildAgent`
 * and calls the same `runOneGame` the serial path uses, so the produced
 * `GameRecord` is byte-identical to the serial one.
 */
export interface SimJob {
  seed: string;
  config: RuleConfig;
  turnCap: number;
  nPlayers: number;
  seatAgents: AgentSpec[];
}

type WorkerResult =
  | { id: number; ok: true; record: GameRecord }
  | { id: number; ok: false; error: string };

interface Pending {
  resolve: (record: GameRecord) => void;
  reject: (err: Error) => void;
}

const WORKER_PATH = fileURLToPath(new URL("./worker.ts", import.meta.url));

/**
 * A reusable pool of `workers` child processes. Construct once, call
 * {@link runGames} (or {@link runGame}) as many times as needed, then
 * {@link close}. Jobs queue and are dispatched to idle workers; a worker holds
 * exactly one (CPU-bound) game at a time, so the pool saturates `workers` cores.
 */
export class GamePool {
  private readonly children: ChildProcess[] = [];
  private readonly idle: ChildProcess[] = [];
  private readonly queue: { id: number; job: SimJob }[] = [];
  private readonly pending = new Map<number, Pending>();
  private readonly busy = new Map<ChildProcess, number>();
  private nextId = 0;
  private closed = false;

  constructor(workers: number) {
    for (let i = 0; i < workers; i++) {
      const child = spawn(process.execPath, ["--import", "tsx", WORKER_PATH], {
        stdio: ["pipe", "pipe", "inherit"],
      });
      createInterface({ input: child.stdout! }).on("line", (line) => this.onLine(child, line));
      child.on("exit", (code) => this.onExit(child, code));
      this.children.push(child);
      this.idle.push(child);
    }
  }

  private onLine(child: ChildProcess, line: string): void {
    if (line.trim() === "") return;
    const msg = JSON.parse(line) as WorkerResult;
    const p = this.pending.get(msg.id);
    if (p === undefined) return;
    this.pending.delete(msg.id);
    this.busy.delete(child);
    this.idle.push(child);
    if (msg.ok) p.resolve(msg.record);
    else p.reject(new Error(`worker job ${msg.id} failed: ${msg.error}`));
    this.pump();
  }

  private onExit(child: ChildProcess, code: number | null): void {
    const id = this.busy.get(child);
    if (id !== undefined) {
      const p = this.pending.get(id);
      if (p !== undefined) {
        this.pending.delete(id);
        p.reject(new Error(`worker exited (code ${code}) mid-job ${id}`));
      }
      this.busy.delete(child);
    }
  }

  private pump(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const child = this.idle.pop()!;
      const item = this.queue.shift()!;
      this.busy.set(child, item.id);
      child.stdin!.write(JSON.stringify(item) + "\n");
    }
  }

  /** Submit one game; resolves with its `GameRecord`. */
  runGame(job: SimJob): Promise<GameRecord> {
    if (this.closed) return Promise.reject(new Error("GamePool is closed"));
    const id = this.nextId++;
    return new Promise<GameRecord>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.queue.push({ id, job });
      this.pump();
    });
  }

  /** Submit many games; resolves with their `GameRecord`s in the SAME order as `jobs` (so merges are deterministic). */
  async runGames(jobs: SimJob[]): Promise<GameRecord[]> {
    return Promise.all(jobs.map((job) => this.runGame(job)));
  }

  /** End every worker's stdin so the children exit. Call once finished. */
  close(): void {
    this.closed = true;
    for (const child of this.children) child.stdin!.end();
  }
}
