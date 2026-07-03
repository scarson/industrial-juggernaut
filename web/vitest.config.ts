// ABOUTME: SPA test project — jsdom env, colocated web/src tests; SEPARATE from the root node suite.
// ABOUTME: Keeps the engine's test/**/*.test.ts glob untouched (sweep track depends on it).
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    root: import.meta.dirname,
    passWithNoTests: true,
  },
});
