// ABOUTME: One-off capture of control()'s golden output over a large crafted+seeded state battery for the parity oracle.
// ABOUTME: Run on the UNMODIFIED control() to write test/engine/fixtures/control-parity.golden.json; never edit the JSON by hand.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  buildBattery,
  canonicalControl,
  controlHash,
  type GoldenCase,
} from "../test/engine/control-parity-battery";

const cases = buildBattery();
const golden: GoldenCase[] = cases.map((c) => ({
  name: c.name,
  player: c.player,
  hash: controlHash(canonicalControl(c.state, c.player)),
}));

const outPath = join(import.meta.dirname, "..", "test", "engine", "fixtures", "control-parity.golden.json");
mkdirSync(dirname(outPath), { recursive: true });
// One compact JSON object per line — a valid JSON array, but each state is a
// single diffable line so the golden stays ~one-line-per-state (not pretty-
// printed across 5 lines each). Keeps the file human-scannable and git-friendly.
const body = golden.map((g) => "  " + JSON.stringify(g)).join(",\n");
writeFileSync(outPath, `[\n${body}\n]\n`);
console.log(`captured ${golden.length} golden control() cases -> ${outPath}`);
