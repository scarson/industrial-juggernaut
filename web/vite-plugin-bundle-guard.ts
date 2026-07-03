// ABOUTME: Rollup plugin that records each output chunk's full module membership as a build
// ABOUTME: artifact, so check-bundle.ts can verify src/agent never lands in an eager chunk.
// Vite compiles ES workers as a separate Rollup build, so worker chunks never appear in this
// bundle object — this guard covers the client entry graph only; worker isolation is structural.
import type { Plugin } from "vite";
import type { BundleChunkInfo, BundleModuleMap } from "./scripts/check-bundle";

const BUNDLE_MODULE_MAP_FILE_NAME = ".bundle-modules.json";

export function bundleGuard(): Plugin {
  return {
    name: "bundle-guard",
    generateBundle(_options, bundle) {
      const moduleMap: BundleModuleMap = {};

      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type !== "chunk") continue;

        const chunkInfo: BundleChunkInfo = {
          isEntry: output.isEntry,
          // isDynamicEntry means the chunk exists only as an import() target. A statically
          // reachable module always stays in a static chunk (Rollup resolves static-vs-dynamic
          // dual imports toward the eager chunk), so this flag safely means "lazy-only".
          dynamicallyImported: output.isDynamicEntry,
          moduleIds: Object.keys(output.modules),
        };
        moduleMap[fileName] = chunkInfo;
      }

      this.emitFile({
        type: "asset",
        fileName: BUNDLE_MODULE_MAP_FILE_NAME,
        source: JSON.stringify(moduleMap),
      });
    },
  };
}
