// ABOUTME: Verifies the built SPA's eager chunks never bundle src/agent or src/wire — reads the module
// ABOUTME: map the bundle-guard Vite plugin emits at build time and fails the build if one leaked in.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BUNDLE_MODULE_MAP_PATH = join(SCRIPT_DIR, "..", "..", "dist", "client", ".bundle-modules.json");

// Targets this repo's lazy-only src/ directories: src/agent/ (heavy AI code — hotseat/offline only)
// and src/wire/ (the codecs, reached only through the drivers). Module IDs are absolute build-machine
// paths, so the pattern can't be anchored — a third-party package containing such a path would
// false-positive (acceptable: fail-closed).
const LAZY_ONLY_MODULE_PATTERN = /src\/(agent|wire)\//;

export interface BundleChunkInfo {
  isEntry: boolean;
  dynamicallyImported: boolean;
  /** The chunk's STATIC import edges (Rollup `chunk.imports`), by output file name. Dynamic-import
   *  edges (`chunk.dynamicImports`) are deliberately NOT followed — a dynamic edge is a lazy boundary. */
  staticImports: string[];
  moduleIds: string[];
}

export type BundleModuleMap = Record<string, BundleChunkInfo>;

/**
 * The EAGER chunk set: every entry chunk plus the transitive closure reached by following ONLY static
 * import edges from entries. These are the chunks in the initial payload — a lazy-only module in any of
 * them ships eagerly. A chunk that is merely `!dynamicallyImported` is NOT automatically eager: a chunk
 * shared between two DYNAMIC chunks is not a dynamic *entry*, yet nothing in the entry's static closure
 * reaches it, so it loads only when a driver chunk loads. Forward reachability distinguishes the two;
 * the older `isEntry || !dynamicallyImported` proxy conflated them and false-flagged shared lazy chunks.
 */
function eagerChunks(moduleMap: BundleModuleMap): Set<string> {
  const eager = new Set<string>();
  const stack = Object.entries(moduleMap)
    .filter(([, chunk]) => chunk.isEntry)
    .map(([fileName]) => fileName);

  // Fail CLOSED on a degenerate artifact: a build with no entry chunk is malformed (every real client
  // build has one). With zero entries the eager set is empty, so a lazy-only leak could never be flagged
  // — the gate would pass OPEN on broken input. Reject it instead of silently vouching for it.
  if (stack.length === 0) {
    throw new Error(
      "check-bundle: the bundle module map has no entry chunk — a build with no entry point is a " +
        'malformed artifact. Re-run "bun run build:client" and inspect dist/client/.bundle-modules.json.',
    );
  }

  while (stack.length > 0) {
    const fileName = stack.pop()!;
    if (eager.has(fileName)) continue; // visited-guard: tolerates static-import cycles
    eager.add(fileName);
    const chunk = moduleMap[fileName];
    if (chunk === undefined) continue;
    for (const imported of chunk.staticImports) {
      if (!eager.has(imported)) stack.push(imported);
    }
  }

  return eager;
}

/**
 * Throws if any eager chunk (an entry chunk, or one reachable from an entry through STATIC imports)
 * contains a module under src/agent/ or src/wire/. Those may only ship in chunks reached across a
 * dynamic-import boundary (lazy-loaded driver/route chunks or the separate Web Worker bundles).
 */
export function assertNoLazyOnlyModulesInEager(moduleMap: BundleModuleMap): void {
  const eager = eagerChunks(moduleMap);
  const violations: string[] = [];

  for (const fileName of eager) {
    const chunk = moduleMap[fileName];
    if (chunk === undefined) continue;
    for (const moduleId of chunk.moduleIds) {
      if (LAZY_ONLY_MODULE_PATTERN.test(moduleId)) {
        violations.push(`  ${moduleId} (in eager chunk ${fileName})`);
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `check-bundle: found src/agent or src/wire module(s) in eager chunk(s) — these must only ship ` +
        `in dynamically-imported chunks:\n${violations.join("\n")}`,
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
    assertNoLazyOnlyModulesInEager(moduleMap);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
    return;
  }

  console.log("check-bundle: OK (no src/agent or src/wire modules in eager chunks)");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
