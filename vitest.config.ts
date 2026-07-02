// ABOUTME: Vitest config — a plain-node project (engine/session/wire/sweep) + a workerd pool project (DO host).
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        // PRESERVE the existing node glob (sweep track depends on test/sweep/* matching here).
        // Long CPU-bound tests (MCTS, drive/recordGame parity) run for tens of seconds
        // synchronously; vitest 4 enforces testTimeout on sync bodies (vitest #2920), so the
        // node project raises it above the 5000ms default to give those tests their budget.
        test: {
          name: "node",
          include: ["test/**/*.test.ts"],
          exclude: ["test/host/**"],
          testTimeout: 120_000,
        },
      },
      {
        plugins: [cloudflareTest({ main: "./src/host/worker.ts", wrangler: { configPath: "./wrangler.jsonc" } })],
        test: { name: "host", include: ["test/host/**/*.test.ts"] },
      },
    ],
  },
});
