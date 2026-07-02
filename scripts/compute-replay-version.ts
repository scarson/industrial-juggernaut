// ABOUTME: Computes REPLAY_VERSION (hash of the full replay transitive closure) and AGENT_VERSION
// ABOUTME: (hash of src/agent/**). Run bare to print both; run --check to verify against src/host/version.ts.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");

/**
 * Every file whose change alters how a STORED LOG is re-interpreted: the engine, rng, board, and
 * geometry primitives, plus the four session files that compose/checksum/encode a replay
 * (applyEntry, stateHash, rngBeforeApply codec, replayLog). Excludes the interactive reducer files
 * (session.ts/pending.ts/agent-drive.ts/seats.ts/errors.ts) — those drive live play, not stored-log
 * replay — and anything agent-pulling.
 */
const REPLAY_CLOSURE_GLOBS = [
  "src/engine",
  "src/rng",
  "src/board",
  "src/geometry",
  "src/session/round.ts",
  "src/session/hash.ts",
  "src/session/codec.ts",
  "src/session/replay.ts",
];

/** Build/deploy/observability only — never a replay gate, so an agent tweak doesn't discard in-flight game tails. */
const AGENT_CLOSURE_GLOBS = ["src/agent"];

const HASH_LENGTH = 16;

function listFiles(entryPath: string): string[] {
  const stat = statSync(entryPath);
  if (stat.isFile()) return [entryPath];
  const out: string[] = [];
  for (const entry of readdirSync(entryPath, { withFileTypes: true })) {
    const full = join(entryPath, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

/** Enumerates a closure's files as repo-relative, sorted, forward-slashed paths (stable across platforms). */
function closureFiles(globs: string[]): string[] {
  const files = globs.flatMap((g) => listFiles(join(REPO_ROOT, g)));
  return files.map((f) => relative(REPO_ROOT, f).split("\\").join("/")).sort();
}

/** Hashes sorted "path\ncontent" entries with SHA-256, returning a short hex digest. */
function hashClosure(globs: string[]): string {
  const hash = createHash("sha256");
  for (const relPath of closureFiles(globs)) {
    const content = readFileSync(join(REPO_ROOT, relPath), "utf8");
    hash.update(relPath);
    hash.update("\n");
    hash.update(content);
  }
  return hash.digest("hex").slice(0, HASH_LENGTH);
}

export function computeReplayVersion(): string {
  return hashClosure(REPLAY_CLOSURE_GLOBS);
}

export function computeAgentVersion(): string {
  return hashClosure(AGENT_CLOSURE_GLOBS);
}

async function main(): Promise<void> {
  const replayVersion = computeReplayVersion();
  const agentVersion = computeAgentVersion();

  if (process.argv.includes("--check")) {
    const { REPLAY_VERSION, AGENT_VERSION } = await import("../src/host/version");
    const mismatches: string[] = [];
    if (REPLAY_VERSION !== replayVersion) {
      mismatches.push(`REPLAY_VERSION: committed=${REPLAY_VERSION} computed=${replayVersion}`);
    }
    if (AGENT_VERSION !== agentVersion) {
      mismatches.push(`AGENT_VERSION: committed=${AGENT_VERSION} computed=${agentVersion}`);
    }
    if (mismatches.length > 0) {
      console.error("compute-replay-version --check: FAILED");
      for (const m of mismatches) console.error(`  ${m}`);
      console.error("A replay-closure or agent-closure file changed. Re-run without --check, copy the");
      console.error("printed values into src/host/version.ts, and commit the bump.");
      process.exit(1);
    }
    console.log("compute-replay-version --check: OK (committed constants match the source closures)");
    return;
  }

  console.log(`REPLAY_VERSION=${replayVersion}`);
  console.log(`AGENT_VERSION=${agentVersion}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
