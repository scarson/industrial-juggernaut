// ABOUTME: workerCount — pick how many GamePool workers to spawn, respecting `--workers N` first then falling back to os.cpus()-1.
// ABOUTME: Portable across compute environments: CC cloud (4 vCPU) defaults to 3; a 10-core host defaults to 9.

import { cpus } from "node:os";

/**
 * Resolve the worker count for a sweep script.
 *
 * Order of precedence:
 * 1. Explicit `--workers N` argv flag (parsed loosely; must be a positive integer).
 * 2. Environment variable `SWEEP_WORKERS` (positive integer string).
 * 3. `os.cpus().length - 1` (leave one logical CPU for the parent process + OS).
 * 4. Floor at 1 worker (so a single-core or misconfigured host still runs).
 *
 * An optional `max` clamps the chosen count — useful when a script has a small
 * job count and shouldn't spawn more workers than jobs.
 */
export function workerCount(opts: { max?: number } = {}): number {
  // 1. argv.
  const argv = process.argv;
  const i = argv.indexOf("--workers");
  if (i >= 0 && argv[i + 1] !== undefined) {
    const n = Number(argv[i + 1]);
    if (Number.isInteger(n) && n > 0) return clamp(n, opts.max);
  }
  // 2. env var (typed as unknown because process.env isn't fully declared in our shim).
  const envVal = (process as unknown as { env?: Record<string, string | undefined> }).env?.SWEEP_WORKERS;
  if (envVal !== undefined) {
    const n = Number(envVal);
    if (Number.isInteger(n) && n > 0) return clamp(n, opts.max);
  }
  // 3. cpus - 1, floored at 1.
  const count = Math.max(1, cpus().length - 1);
  return clamp(count, opts.max);
}

function clamp(n: number, max: number | undefined): number {
  return max !== undefined ? Math.min(n, max) : n;
}
