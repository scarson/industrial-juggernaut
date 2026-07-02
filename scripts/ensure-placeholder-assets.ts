// ABOUTME: Generates a placeholder dist/client/index.html so pre-SPA `wrangler deploy --dry-run` and deploys pass the assets-directory check.
// ABOUTME: The deploy workflow (B8) runs this before `wrangler deploy`; run it locally before dry-runs.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const indexPath = join(SCRIPT_DIR, "..", "dist", "client", "index.html");

mkdirSync(dirname(indexPath), { recursive: true });
// No-clobber guard: the real SPA build replaces this placeholder and must never be overwritten by it.
if (!existsSync(indexPath)) {
  writeFileSync(indexPath, "<!doctype html><title>Industrial Juggernaut (staging)</title>", "utf8");
}
