// ABOUTME: appendResultAndCommit — write a per-game result line to a JSONL file AND git-commit+push it, synchronously.
// ABOUTME: Container is ephemeral; long-running sweeps MUST persist per-game results immediately or compute is lost on restart.

import { mkdirSync, appendFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { execSync } from "node:child_process";

/**
 * One JSONL record describing a single game's outcome. Schema is open — callers
 * pack whatever they want into `data`; `meta` is the bookkeeping fields the
 * commit message uses to make commits readable in `git log`.
 */
export interface IncrementalRecord {
  /** Open-shape per-record data (turns, victoryType, winner, metrics, etc.). */
  data: Record<string, unknown>;
  /** Bookkeeping for the commit message (game N/total + a short summary). */
  meta: {
    label: string; // a short tag the commit message includes (e.g. "mcts-300-on-c")
    done: number;
    total: number;
    summary: string; // one-line summary of the game (e.g. "2P -> t=12 last-standing w=0")
  };
}

/**
 * Append a record to `path` (JSONL) and IMMEDIATELY git-add+commit+push it.
 * Synchronous on purpose — concurrent callers serialize naturally on the
 * parent process's event loop, and the calling sweep loops are not bottlenecked
 * by the ~0.5-2s commit/push latency (per-game compute is minutes).
 *
 * Failures (push reject, network blip) log but do NOT throw — losing one
 * intermediate commit isn't worth aborting the whole sweep. The next per-game
 * append catches up. (If TWO consecutive pushes fail, the data is still on
 * disk, recoverable on container restart UNTIL the container itself dies —
 * at which point you've lost the data ahead of the last successful push,
 * which is the unavoidable tail of the failure mode.)
 *
 * Caller MUST be in the project repo's working tree (cwd somewhere under it).
 */
export function appendResultAndCommit(path: string, record: IncrementalRecord): void {
  // 1. Ensure dir exists; append the JSON line. JSONL = one JSON object per line.
  mkdirSync(dirname(path), { recursive: true });
  const isNew = !existsSync(path);
  appendFileSync(path, JSON.stringify(record.data) + "\n", "utf8");

  // 2. Commit + push. Run from cwd (the script runs from the repo root).
  const tag = `data(${record.meta.label}): game ${record.meta.done}/${record.meta.total} ${record.meta.summary}`;
  try {
    execSync(`git add ${JSON.stringify(path)}`, { stdio: ["ignore", "ignore", "pipe"] });
    // Use --quiet to suppress noise; the result is in `git log`.
    execSync(`git commit --quiet -m ${JSON.stringify(tag)}`, { stdio: ["ignore", "ignore", "pipe"] });
    execSync(`git push --quiet origin HEAD`, { stdio: ["ignore", "ignore", "pipe"] });
  } catch (err) {
    // Log but don't throw — the JSONL data is on disk, and the next append's
    // commit will sweep this up. If the data must survive a container restart,
    // running the sweep with a successful commit cadence handles the common case;
    // an unrecoverable network outage is the only path to data loss.
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(`appendResultAndCommit: git step failed for ${path} (${message}); data appended locally, will be picked up on next successful commit.${isNew ? " (file was new)" : ""}`);
  }
}
