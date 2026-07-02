// ABOUTME: Untrusted create-body validation for POST /api/games — parses the designer-instrument config into a SessionHeader.
// ABOUTME: Host glue: engine symbols via the barrel only; NEVER value-imports src/agent (the archetype list is a local literal).

import { defaultConfig, loadBoard } from "../index";
import type { BoardDefinition, BoardSource, RuleConfig } from "../index";
import { DEFAULT_ROOM_OPTIONS } from "../wire/protocol";
import type { RoomOptions } from "../wire/protocol";
import type { SeatConfig } from "../session";

// Mirror of the engine's `Archetype` union (src/agent/archetypes.ts). Duplicated as a
// LOCAL literal so the host never value-imports src/agent (DO-PURITY-1). Keep in sync
// with `type Archetype` in src/agent/archetypes.ts.
const ARCHETYPES = ["aggressive", "economic", "expansionist"] as const;

// Generated-board size window (plan B2.2). `size` is the hex count; the engine's
// generator supports this range.
const MIN_BOARD_SIZE = 96;
const MAX_BOARD_SIZE = 300;

// Fixed-board hex cap: 4x the largest generated board (MAX_BOARD_SIZE hexes; the oval
// search in src/board/shape.ts converges to within ±6 of size). Fixed defs are the
// escape hatch for hand-digitized boards, so the cap leaves generous headroom while
// bounding validation work and every downstream per-hex loop.
export const MAX_FIXED_HEXES = 4 * MAX_BOARD_SIZE;

// Per-coordinate magnitude bound for fixed-board hexes. Derivation: the largest
// generated board (size 300) is an oval with half-axes A≈11, B≈9 (src/board/shape.ts:
// B = sqrt(size/(π·1.3)), A = 1.3B), so generated cube coords stay within |c| ≲ 25
// (y = -x-z worst case). 1024 is ~40x that extent — generous for digitized/offset
// boards, exact in float arithmetic, and keeps geometry key() strings short.
const MAX_HEX_COORD = 1024;

/** A validation failure carrying the offending field name for a friendly 400. */
export class CreateBodyError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "CreateBodyError";
  }
}

/** The validated, host-stamped result of a create request (everything the DO needs to init). */
export type CreateSpec = {
  seats: SeatConfig[];
  boardSource: BoardSource;
  seed: string; // decimal string; the DO re-parses with BigInt at init (JSON can't carry bigints)
  config: RuleConfig;
  roomOptions: RoomOptions;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Validate one seat entry against the closed SeatConfig shape (spec §3). */
function validateSeat(raw: unknown, index: number): SeatConfig {
  if (!isRecord(raw) || typeof raw.kind !== "string") {
    throw new CreateBodyError("seats", `seat ${index}: missing string "kind"`);
  }
  if (raw.kind === "human") {
    return { kind: "human" };
  }
  if (raw.kind === "agent") {
    if (raw.agent === "heuristic") {
      return { kind: "agent", agent: "heuristic" };
    }
    if (raw.agent === "greedy") {
      if (typeof raw.archetype !== "string" || !ARCHETYPES.includes(raw.archetype as never)) {
        throw new CreateBodyError(
          "archetype",
          `seat ${index}: greedy agent needs archetype in {${ARCHETYPES.join(", ")}}`,
        );
      }
      return { kind: "agent", agent: "greedy", archetype: raw.archetype as (typeof ARCHETYPES)[number] };
    }
    throw new CreateBodyError("seats", `seat ${index}: agent must be "greedy" or "heuristic"`);
  }
  throw new CreateBodyError("seats", `seat ${index}: kind must be "human" or "agent"`);
}

function validateSeats(raw: unknown): SeatConfig[] {
  if (!Array.isArray(raw)) {
    throw new CreateBodyError("seats", "seats must be an array");
  }
  if (raw.length < 2 || raw.length > 6) {
    throw new CreateBodyError("seats", `seats length must be 2-6 (got ${raw.length})`);
  }
  return raw.map((s, i) => validateSeat(s, i));
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

function validateBoardSource(raw: unknown): BoardSource {
  if (!isRecord(raw) || typeof raw.kind !== "string") {
    throw new CreateBodyError("boardSource", 'boardSource needs a string "kind"');
  }
  if (raw.kind === "generate") {
    if (typeof raw.size !== "number" || !Number.isInteger(raw.size) || raw.size < MIN_BOARD_SIZE || raw.size > MAX_BOARD_SIZE) {
      throw new CreateBodyError("size", `generate size must be an integer in [${MIN_BOARD_SIZE}, ${MAX_BOARD_SIZE}]`);
    }
    if (!isPositiveInt(raw.ironCount)) {
      throw new CreateBodyError("ironCount", "generate ironCount must be a positive integer");
    }
    return { kind: "generate", size: raw.size, ironCount: raw.ironCount };
  }
  if (raw.kind === "fixed") {
    const def = raw.def;
    if (!isRecord(def) || !Array.isArray(def.hexes) || !Array.isArray(def.iron)) {
      throw new CreateBodyError("def", "fixed def must be { hexes: Hex[], iron: Hex[] }");
    }
    // Size caps BEFORE any per-entry loop, so a hostile def cannot buy unbounded
    // validation work. Iron is a subset of hexes, so iron can never legally be longer.
    if (def.hexes.length > MAX_FIXED_HEXES) {
      throw new CreateBodyError("def", `fixed def is capped at ${MAX_FIXED_HEXES} hexes`);
    }
    if (def.iron.length > def.hexes.length) {
      throw new CreateBodyError("def", "fixed def has more iron entries than hexes");
    }
    // Coordinate gates BEFORE loadBoard: its cube-sum check (x+y+z===0) is satisfied
    // by fractional pairs ({x:0.5,y:-0.5,z:0}) and astronomically large ones
    // ({x:1e308,y:-1e308,z:0} — 1e308 IS an integer value, so the magnitude bound is
    // its own gate). The engine's geometry assumes small exact integers.
    for (const h of def.hexes) validateHexCoords(h);
    for (const h of def.iron) validateHexCoords(h);
    try {
      // loadBoard validates the remaining invariants (cube constraint, dup hexes,
      // iron membership, dup iron). We validate by calling it; the returned Board is
      // discarded here (the DO rebuilds it from the persisted def at init).
      loadBoard(def as unknown as BoardDefinition);
    } catch (e) {
      throw new CreateBodyError("def", `fixed board rejected: ${e instanceof Error ? e.message : String(e)}`);
    }
    return { kind: "fixed", def: def as unknown as BoardDefinition };
  }
  throw new CreateBodyError("boardSource", 'boardSource.kind must be "generate" or "fixed"');
}

/** Gate one hex's coordinates: integers with |c| <= MAX_HEX_COORD (see the bound's derivation). */
function validateHexCoords(h: unknown): void {
  if (!isRecord(h)) {
    throw new CreateBodyError("def", "fixed def hex entries must be {x, y, z} objects");
  }
  for (const axis of ["x", "y", "z"] as const) {
    const c = h[axis];
    if (typeof c !== "number" || !Number.isInteger(c) || Math.abs(c) > MAX_HEX_COORD) {
      throw new CreateBodyError(
        "def",
        `fixed def hex ${axis} must be an integer with |${axis}| <= ${MAX_HEX_COORD}`,
      );
    }
  }
}

// A DECIMAL bigint string: optional leading '-', then one or more digits. Deliberately
// tighter than raw BigInt() acceptance (which also takes 0x/0o/0b and surrounding
// whitespace) so the wire contract is unambiguously decimal — the DO re-parses the SAME
// string with BigInt() at init and must get the identical value.
const DECIMAL_BIGINT = /^-?\d+$/;

function validateSeed(raw: unknown): string {
  if (typeof raw !== "string" || !DECIMAL_BIGINT.test(raw)) {
    throw new CreateBodyError("seed", "seed must be a decimal integer string");
  }
  return raw;
}

const KILL_BOUNTIES = ["full", "half", "none"] as const;

/**
 * Validate an optional `config` override. Omitted → `defaultConfig()`. Otherwise each
 * provided key MUST be a known RuleConfig key whose value matches that key's shape:
 * numeric keys by `typeof number`, `allowPass`/`autoWinAt6` by `typeof boolean`,
 * `killBounty` against its literal union, and `combatTable` structurally. Unknown keys
 * are REJECTED — silently dropping a typo'd tuning key is the failure mode we guard.
 */
function validateConfig(raw: unknown): RuleConfig {
  if (raw === undefined) {
    return defaultConfig();
  }
  if (!isRecord(raw)) {
    throw new CreateBodyError("config", "config must be an object");
  }
  const merged = defaultConfig();
  for (const [k, v] of Object.entries(raw)) {
    // Object.hasOwn, NOT `in`: `in` walks the prototype chain, so JSON own-keys like
    // "__proto__"/"constructor" (which JSON.parse creates as ordinary own properties)
    // would false-match Object.prototype's members and fall into the wrong branch.
    if (!Object.hasOwn(merged, k)) {
      throw new CreateBodyError(k, `unknown config key "${k}"`);
    }
    assignConfigKey(merged, k as keyof RuleConfig, v);
  }
  return merged;
}

/** Assign one validated override onto `cfg`, throwing a field-named 400 on a shape mismatch. */
function assignConfigKey(cfg: RuleConfig, key: keyof RuleConfig, v: unknown): void {
  switch (key) {
    case "combatTable":
      validateCombatTable(v);
      cfg.combatTable = v as RuleConfig["combatTable"];
      return;
    case "killBounty":
      if (typeof v !== "string" || !KILL_BOUNTIES.includes(v as never)) {
        throw new CreateBodyError("killBounty", `config.killBounty must be one of ${KILL_BOUNTIES.join(", ")}`);
      }
      cfg.killBounty = v as RuleConfig["killBounty"];
      return;
    case "autoWinAt6":
    case "allowPass":
      if (typeof v !== "boolean") {
        throw new CreateBodyError(key, `config.${key} must be a boolean`);
      }
      cfg[key] = v;
      return;
    default: {
      // Every remaining RuleConfig key is a strictly positive integer QUANTITY, so one
      // shared gate covers them (Number.isInteger also rejects Infinity — JSON `1e999`
      // parses to Infinity and passes a bare typeof check). Per-key semantics:
      //   radius / placeRange / attackRange — hex-grid distances (rings/range), >= 1
      //   baseLimit                         — starting bases-in-hand count, >= 1
      //   factorySupply                     — total factory pieces, >= 1
      //   ironCount / boardSize             — board-composition counts, >= 1
      //   victoryThreshold                  — controlled-iron win count, >= 1
      //   brokenPerimeterDeathAtFactories   — factory-count threshold, >= 1
      if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) {
        throw new CreateBodyError(key, `config.${key} must be a positive integer`);
      }
      cfg[key] = v;
    }
  }
}

/** `combatTable` is a Record<3|4|5|6, number> — exact key set, each value a probability. */
function validateCombatTable(raw: unknown): void {
  if (!isRecord(raw)) {
    throw new CreateBodyError("combatTable", "config.combatTable must be an object");
  }
  const keys = Object.keys(raw).sort();
  if (keys.join(",") !== "3,4,5,6") {
    throw new CreateBodyError("combatTable", "config.combatTable must have exactly keys 3,4,5,6");
  }
  for (const k of keys) {
    const v = raw[k];
    // Attacker win probabilities per committed-base count — finite and in [0,1]
    // (the finite check also rejects Infinity from JSON `1e999`).
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
      throw new CreateBodyError("combatTable", `config.combatTable[${k}] must be a probability in [0, 1]`);
    }
  }
}

function validateRoomOptions(raw: unknown): RoomOptions {
  if (raw === undefined) {
    return DEFAULT_ROOM_OPTIONS;
  }
  if (!isRecord(raw) || !isRecord(raw.defenderTimeout)) {
    throw new CreateBodyError("roomOptions", "roomOptions must be { defenderTimeout: {...} }");
  }
  const dt = raw.defenderTimeout;
  if (typeof dt.enabled !== "boolean") {
    throw new CreateBodyError("defenderTimeout", "defenderTimeout.enabled must be a boolean");
  }
  if (!isPositiveInt(dt.seconds)) {
    throw new CreateBodyError("defenderTimeout", "defenderTimeout.seconds must be a positive integer");
  }
  return { defenderTimeout: { enabled: dt.enabled, seconds: dt.seconds } };
}

// Client-controllable top-level keys. Anything else (notably `replayVersion` /
// `formatVersion`, which the HOST stamps) is rejected so a typo or a spoof attempt
// fails loudly instead of being silently dropped — consistent with the config-key rule.
const ALLOWED_TOP_LEVEL_KEYS = new Set(["seats", "boardSource", "seed", "config", "roomOptions"]);

/**
 * Validate an untrusted create body into a {@link CreateSpec}. Throws {@link CreateBodyError}
 * (with the offending field) on any violation. Host-stamped fields (formatVersion,
 * replayVersion) are NOT taken from the body — the caller stamps them.
 */
export function validateCreateBody(body: unknown): CreateSpec {
  if (!isRecord(body)) {
    throw new CreateBodyError("body", "request body must be a JSON object");
  }
  for (const k of Object.keys(body)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(k)) {
      throw new CreateBodyError(k, `unknown top-level key "${k}"`);
    }
  }
  return {
    seats: validateSeats(body.seats),
    boardSource: validateBoardSource(body.boardSource),
    seed: validateSeed(body.seed),
    config: validateConfig(body.config),
    roomOptions: validateRoomOptions(body.roomOptions),
  };
}
