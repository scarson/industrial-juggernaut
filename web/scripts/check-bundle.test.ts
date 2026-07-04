// ABOUTME: Tests assertNoLazyOnlyModulesInEager against in-memory module-map fixtures shaped like the
// ABOUTME: bundle-guard plugin's emitted output — proves both the failure path and the allow path.
import { describe, expect, test } from "vitest";
import { assertNoLazyOnlyModulesInEager } from "./check-bundle";

describe("assertNoLazyOnlyModulesInEager", () => {
  test("returns ok for an eager entry chunk with no agent or wire modules", () => {
    const moduleMap = {
      "index.js": {
        isEntry: true,
        dynamicallyImported: false,
        staticImports: [],
        moduleIds: ["/repo/web/src/main.tsx", "/repo/src/engine/rules.ts", "/repo/src/board/hex.ts"],
      },
    };

    expect(() => assertNoLazyOnlyModulesInEager(moduleMap)).not.toThrow();
  });

  test("throws naming the offending module and chunk when an eager chunk contains an agent module", () => {
    const moduleMap = {
      "index.js": {
        isEntry: true,
        dynamicallyImported: false,
        staticImports: [],
        moduleIds: ["/repo/web/src/main.tsx", "/repo/src/agent/greedy.ts"],
      },
    };

    expect(() => assertNoLazyOnlyModulesInEager(moduleMap)).toThrow(/src\/agent\/greedy\.ts/);
    expect(() => assertNoLazyOnlyModulesInEager(moduleMap)).toThrow(/index\.js/);
  });

  test("throws naming the offending module and chunk when an eager chunk contains a wire module", () => {
    const moduleMap = {
      "index.js": {
        isEntry: true,
        dynamicallyImported: false,
        staticImports: [],
        moduleIds: ["/repo/web/src/main.tsx", "/repo/src/wire/codec.ts"],
      },
    };

    expect(() => assertNoLazyOnlyModulesInEager(moduleMap)).toThrow(/src\/wire\/codec\.ts/);
    expect(() => assertNoLazyOnlyModulesInEager(moduleMap)).toThrow(/index\.js/);
  });

  test("allows agent and wire modules inside a dynamically-imported chunk", () => {
    const moduleMap = {
      "index.js": {
        isEntry: true,
        dynamicallyImported: false,
        staticImports: [],
        moduleIds: ["/repo/web/src/main.tsx"],
      },
      "driver-chunk.js": {
        isEntry: false,
        dynamicallyImported: true,
        staticImports: [],
        moduleIds: ["/repo/src/agent/greedy.ts", "/repo/src/agent/heuristic.ts", "/repo/src/wire/codec.ts"],
      },
    };

    expect(() => assertNoLazyOnlyModulesInEager(moduleMap)).not.toThrow();
  });

  test("flags a chunk in the entry's STATIC-import closure (a true eager sub-chunk)", () => {
    // The entry statically imports a shared chunk that carries an agent module — it ships in the
    // initial payload just like the entry itself. Forward reachability from the entry via
    // `staticImports` catches it even though the chunk is neither an entry nor a dynamic entry.
    const moduleMap = {
      "index.js": {
        isEntry: true,
        dynamicallyImported: false,
        staticImports: ["shared-vendor.js"],
        moduleIds: ["/repo/web/src/main.tsx"],
      },
      "shared-vendor.js": {
        isEntry: false,
        dynamicallyImported: false,
        staticImports: [],
        moduleIds: ["/repo/src/agent/mcts.ts"],
      },
    };

    expect(() => assertNoLazyOnlyModulesInEager(moduleMap)).toThrow(/src\/agent\/mcts\.ts/);
    expect(() => assertNoLazyOnlyModulesInEager(moduleMap)).toThrow(/shared-vendor\.js/);
  });

  test("allows a shared chunk imported ONLY by dynamic chunks (not forward-reachable from the entry)", () => {
    // wire-map's real shape: a shared dependency of TWO dynamically-imported driver chunks. It is
    // `dynamicallyImported:false` (not itself a dynamic ENTRY) and its own `staticImports` point back
    // at the entry (shared vendor code), but NOTHING in the entry's forward static closure reaches it —
    // it loads only when a driver chunk loads. The v1 `!dynamicallyImported → eager` proxy false-flagged
    // this; forward reachability from the entry does not.
    const moduleMap = {
      "index.js": {
        isEntry: true,
        dynamicallyImported: false,
        staticImports: [], // the entry statically imports NOTHING; the drivers are dynamic imports
        moduleIds: ["/repo/web/src/main.tsx"],
      },
      "wire-map.js": {
        isEntry: false,
        dynamicallyImported: false, // shared chunk of two dynamic importers — not a dynamic ENTRY
        staticImports: ["index.js"], // imports shared vendor FROM the entry; the entry does not import it
        moduleIds: ["/repo/src/wire/codec.ts", "/repo/src/wire/protocol.ts"],
      },
      "socket-driver.js": {
        isEntry: false,
        dynamicallyImported: true,
        staticImports: ["wire-map.js", "index.js"],
        moduleIds: ["/repo/web/src/game/socket-driver.ts"],
      },
      "local-reducer-driver.js": {
        isEntry: false,
        dynamicallyImported: true,
        staticImports: ["wire-map.js", "index.js"],
        moduleIds: ["/repo/web/src/game/local-reducer-driver.ts", "/repo/src/agent/greedy.ts"],
      },
    };

    expect(() => assertNoLazyOnlyModulesInEager(moduleMap)).not.toThrow();
  });

  test("still flags a lazy-only module even when a static-import cycle exists between eager chunks", () => {
    // Defense against a cycle in the eager graph causing infinite recursion: the closure walk must be
    // visited-guarded. Entry ⇄ shared cycle, and the shared chunk carries a wire module → still flagged.
    const moduleMap = {
      "index.js": {
        isEntry: true,
        dynamicallyImported: false,
        staticImports: ["shared.js"],
        moduleIds: ["/repo/web/src/main.tsx"],
      },
      "shared.js": {
        isEntry: false,
        dynamicallyImported: false,
        staticImports: ["index.js"], // cycle back to the entry
        moduleIds: ["/repo/src/wire/codec.ts"],
      },
    };

    expect(() => assertNoLazyOnlyModulesInEager(moduleMap)).toThrow(/src\/wire\/codec\.ts/);
  });

  test("throws on a module map with NO entry chunks (a degenerate/malformed build artifact)", () => {
    // A build with no entry chunk cannot be a clean bundle — every real client build has at least one
    // entry. With zero entries the eager set would be empty and a lazy-only leak could never be flagged,
    // so the fail-closed gate would pass OPEN on a broken artifact. Reject the input instead.
    const moduleMap = {
      "orphan-chunk.js": {
        isEntry: false,
        dynamicallyImported: true,
        staticImports: [],
        moduleIds: ["/repo/src/wire/codec.ts"],
      },
    };

    expect(() => assertNoLazyOnlyModulesInEager(moduleMap)).toThrow(/no entry chunk/i);
  });
});
