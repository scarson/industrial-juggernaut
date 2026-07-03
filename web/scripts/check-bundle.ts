// ABOUTME: Verifies the built SPA's eager chunks never bundle src/agent — reads the module map the
// ABOUTME: bundle-guard Vite plugin emits at build time and fails the build if an agent module leaked in.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BUNDLE_MODULE_MAP_PATH = join(SCRIPT_DIR, "..", "..", "dist", "client", ".bundle-modules.json");

// Targets this repo's src/agent/ directory. Module IDs are absolute build-machine paths, so the
// pattern can't be anchored — a third-party package containing a src/agent/ path would
// false-positive (acceptable: fail-closed).
const AGENT_MODULE_PATTERN = /src\/agent\//;

export interface BundleChunkInfo {
  isEntry: boolean;
  dynamicallyImported: boolean;
  moduleIds: string[];
}

export type BundleModuleMap = Record<string, BundleChunkInfo>;

/**
 * Throws if any eager chunk (isEntry, or reachable only via static imports — i.e. not
 * dynamicallyImported) contains a module under src/agent/. Agents may only ship in
 * dynamically-imported chunks (lazy-loaded or Web Worker bundles).
 */
export function assertNoAgentsInEager(moduleMap: BundleModuleMap): void {
  const violations: string[] = [];

  for (const [fileName, chunk] of Object.entries(moduleMap)) {
    const isEager = chunk.isEntry || !chunk.dynamicallyImported;
    if (!isEager) continue;

    for (const moduleId of chunk.moduleIds) {
      if (AGENT_MODULE_PATTERN.test(moduleId)) {
        violations.push(`  ${moduleId} (in eager chunk ${fileName})`);
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `check-bundle: found src/agent module(s) in eager chunk(s) — agents must only ship in ` +
        `dynamically-imported chunks:\n${violations.join("\n")}`,
    );
  }
}

function main(): void {
  let raw: string;
  try {
    raw = readFileSync(BUNDLE_MODULE_MAP_PATH, "utf8");
  } catch (err) {
    console.error(`check-bundle: could not read ${BUNDLE_MODULE_MAP_PATH}`);
    console.error(`  Run "bun run build:client" first. (${(err as Error).message})`);
    process.exit(1);
    return;
  }

  const moduleMap = JSON.parse(raw) as BundleModuleMap;

  try {
    assertNoAgentsInEager(moduleMap);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
    return;
  }

  console.log("check-bundle: OK (no src/agent modules in eager chunks)");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
