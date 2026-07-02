// ABOUTME: Cheap shard worker for the parallel==sequential guard — runs runGameEntry on a small board with the default
// ABOUTME: heuristic agent for its disjoint gameIndex slice, appending the SAME ShardLine the big300 shard emits.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import process from "node:process";

import { defaultConfig } from "../engine/config";
import type { RuleConfig } from "../engine/config";
import { runGameEntry } from "./run";
import type { RunConfigOpts } from "./run";
import { toShardLine } from "./big300-merge";

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i + 1 >= process.argv.length) throw new Error(`missing --${name}`);
  return process.argv[i + 1]!;
}

const shard = Number(arg("shard"));
const numShards = Number(arg("num-shards"));
const games = Number(arg("games"));
const turnCap = Number(arg("turn-cap"));
const baseSeed = BigInt(arg("base-seed"));
const playerCounts = arg("player-counts").split(",").map((s) => Number(s));
const outPath = arg("out");

const config: RuleConfig = { ...defaultConfig(), boardSize: 61, ironCount: 8, radius: 4 };
const opts: RunConfigOpts = { games, turnCap, baseSeed, playerCounts }; // default heuristic agent

mkdirSync(dirname(outPath), { recursive: true });
for (let i = shard; i < games; i += numShards) {
  const t0 = Date.now();
  const entry = runGameEntry(config, opts, i);
  appendFileSync(outPath, JSON.stringify(toShardLine(i, entry, Date.now() - t0)) + "\n", "utf8");
}
