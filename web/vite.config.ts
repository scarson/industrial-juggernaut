// ABOUTME: Vite config for the Industrial Juggernaut SPA; builds to ../dist/client (Worker assets dir).
// ABOUTME: React plugin; ES-format workers; the bundle-guard plugin (added in P0.2) emits .bundle-modules.json.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// import { bundleGuard } from "./vite-plugin-bundle-guard"; // added in P0.2

export default defineConfig({
  root: import.meta.dirname, // the web/ dir
  build: { outDir: "../dist/client", emptyOutDir: true, manifest: true },
  worker: { format: "es" },
  plugins: [react() /*, bundleGuard() — wired in P0.2 */],
});
