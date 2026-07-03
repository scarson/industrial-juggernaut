// ABOUTME: Validates a BoardSource before it ever reaches loadBoard() — friendly errors for
// ABOUTME: generate-kind numeric ranges and fixed-kind untrusted input, from the designer's own
// ABOUTME: paste (parseBoardSource) or an imported SessionRecord (validateBoardSource).
import { BOARD_SIZE_RANGE, IRON_COUNT_MIN, isInteger } from "./config-form";
import { hexKey } from "../board/projection";
import type { BoardSource, Hex } from "../engine-client/barrel";

/**
 * Input to `parseBoardSource`. `generate` takes numbers straight off the
 * designer's size/ironCount form fields. `fixed` takes the RAW TEXTAREA
 * STRING the designer pastes — this function owns the `JSON.parse` (and
 * every validation step after it) so a malformed paste never reaches
 * `loadBoard`, which throws instead of returning a friendly error. P2.4's
 * NewGame form is the consumer: it forwards field values / textarea content
 * here unmodified.
 */
export type BoardSourceInput =
  | { kind: "generate"; size: number; ironCount: number }
  | { kind: "fixed"; raw: string };

/** One `generate`-kind validation failure, keyed to the form field it belongs to. */
export interface GenerateFieldError {
  field: "size" | "ironCount";
  message: string;
}

/**
 * Result of `parseBoardSource`. The two failure arms are deliberately
 * asymmetric: `generate` errors are field-keyed because each maps to exactly
 * one form field (`size` / `ironCount`), so the NewGame form can attach a
 * message inline next to the offending input. `fixed` errors stay flat
 * strings: hex-level failures (cube invariant, duplicates, iron membership)
 * have no single form field — the whole pasted textarea is the "field".
 */
export type BoardSourceValidation =
  | { ok: true; source: BoardSource }
  | { ok: false; kind: "generate"; errors: GenerateFieldError[] }
  | { ok: false; kind: "fixed"; errors: string[] };

// Spec §4 renders 96-300 hexes comfortably (see config-form.ts's BOARD_SIZE_RANGE); a fixed
// paste is capped an order of magnitude above that ceiling — generous for hand-authored or
// generator-exported boards, while still rejecting a pathological paste before any per-hex
// validation loop runs (the 10k-hex negative-property test asserts this cap fires fast).
const MAX_FIXED_HEXES = 1000;

// Mirrors loadBoard's own MAX_BOARD_COORD (src/board/load.ts) — a fixed def whose coordinates
// would trip loadBoard's bound check must be rejected here first with a friendly error, never
// let the engine's own throw escape uncaught.
const MAX_BOARD_COORD = 1024;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatHex(h: { x: unknown; y: unknown; z: unknown }): string {
  return `(${h.x}, ${h.y}, ${h.z})`;
}

/** Field-keyed validation shared by `generate`-kind designer input AND an imported record's `boardSource`. */
function validateGenerateFields(input: {
  size: number;
  ironCount: number;
}): GenerateFieldError[] {
  const errors: GenerateFieldError[] = [];

  if (!isInteger(input.size)) {
    errors.push({ field: "size", message: "size must be an integer." });
  } else if (input.size < BOARD_SIZE_RANGE.min || input.size > BOARD_SIZE_RANGE.max) {
    errors.push({
      field: "size",
      message: `size must be between ${BOARD_SIZE_RANGE.min} and ${BOARD_SIZE_RANGE.max} (DER #16 oval-fit range).`,
    });
  }

  if (!isInteger(input.ironCount)) {
    errors.push({ field: "ironCount", message: "ironCount must be an integer." });
  } else if (input.ironCount < IRON_COUNT_MIN) {
    errors.push({
      field: "ironCount",
      message: `ironCount must be at least ${IRON_COUNT_MIN}.`,
    });
  }

  return errors;
}

function parseGenerateSource(input: {
  kind: "generate";
  size: number;
  ironCount: number;
}): BoardSourceValidation {
  const errors = validateGenerateFields(input);
  if (errors.length > 0) {
    return { ok: false, kind: "generate", errors };
  }
  return {
    ok: true,
    source: { kind: "generate", size: input.size, ironCount: input.ironCount },
  };
}

// Validates one hex's shape (three integer fields within the engine's coordinate bound) before
// any geometric invariant is checked. `label` identifies which array + index the hex came from,
// for friendly messages. Checks integer-ness (not just finiteness) and the coordinate bound so a
// hex that would trip loadBoard's own checkCoords is caught here instead of throwing uncaught.
function validateHexShape(value: unknown, label: string, errors: string[]): Hex | null {
  if (!isPlainObject(value)) {
    errors.push(`${label} must be an object with x, y, z fields.`);
    return null;
  }
  const coords: (keyof Hex)[] = ["x", "y", "z"];
  let shapeOk = true;
  for (const c of coords) {
    const v = value[c];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      errors.push(`${label}.${c} must be a number.`);
      shapeOk = false;
    } else if (!Number.isInteger(v)) {
      errors.push(`${label}.${c} must be an integer.`);
      shapeOk = false;
    } else if (Math.abs(v) > MAX_BOARD_COORD) {
      errors.push(`${label}.${c}=${v} exceeds the ${MAX_BOARD_COORD}-coordinate bound.`);
      shapeOk = false;
    }
  }
  if (!shapeOk) return null;
  return { x: value.x as number, y: value.y as number, z: value.z as number };
}

/**
 * Validates an already-parsed fixed-board definition (`{hexes, iron}`, e.g. from
 * `JSON.parse` of a designer paste, or the `def` of an imported record's
 * `boardSource`): hex shape, the cube invariant, duplicates, iron-subset
 * membership, and the `MAX_FIXED_HEXES` cap — the caps `loadBoard` would
 * otherwise enforce by throwing. Returns flat strings (see the
 * `BoardSourceValidation` docblock for why `fixed` errors aren't field-keyed).
 */
function validateFixedDef(parsed: unknown): { hexes: Hex[]; iron: Hex[] } | { errors: string[] } {
  if (!isPlainObject(parsed)) {
    return { errors: ["The pasted board must be a JSON object with hexes and iron fields."] };
  }

  const knownKeys = new Set(["hexes", "iron"]);
  const unknownKeys = Object.keys(parsed).filter((k) => !knownKeys.has(k));
  if (unknownKeys.length > 0) {
    return { errors: [`Unknown field(s) in pasted board: ${unknownKeys.join(", ")}.`] };
  }

  const errors: string[] = [];

  if (!Array.isArray(parsed.hexes)) {
    errors.push("hexes must be an array.");
    return { errors };
  }
  if (!Array.isArray(parsed.iron)) {
    errors.push("iron must be an array.");
    return { errors };
  }

  if (parsed.hexes.length === 0) {
    errors.push("hexes must not be empty.");
  }
  if (parsed.iron.length === 0) {
    errors.push("iron must not be empty.");
  }
  if (errors.length > 0) {
    return { errors };
  }

  if (parsed.hexes.length > MAX_FIXED_HEXES) {
    return { errors: [`Too many hexes: ${parsed.hexes.length} exceeds the ${MAX_FIXED_HEXES}-hex cap.`] };
  }

  const hexes: Hex[] = [];
  const seenHexKeys = new Set<string>();
  for (let i = 0; i < parsed.hexes.length; i++) {
    const hex = validateHexShape(parsed.hexes[i], `hexes[${i}]`, errors);
    if (hex === null) continue;
    if (hex.x + hex.y + hex.z !== 0) {
      errors.push(`hexes[${i}] ${formatHex(hex)} violates the cube invariant x + y + z === 0.`);
      continue;
    }
    const k = hexKey(hex);
    if (seenHexKeys.has(k)) {
      errors.push(`Duplicate hex ${formatHex(hex)} in hexes.`);
      continue;
    }
    seenHexKeys.add(k);
    hexes.push(hex);
  }

  if (errors.length > 0) {
    return { errors };
  }

  const iron: Hex[] = [];
  const seenIronKeys = new Set<string>();
  for (let i = 0; i < parsed.iron.length; i++) {
    const hex = validateHexShape(parsed.iron[i], `iron[${i}]`, errors);
    if (hex === null) continue;
    const k = hexKey(hex);
    if (seenIronKeys.has(k)) {
      errors.push(`Duplicate hex ${formatHex(hex)} in iron.`);
      continue;
    }
    if (!seenHexKeys.has(k)) {
      errors.push(`iron hex ${formatHex(hex)} is not a member of hexes.`);
      continue;
    }
    seenIronKeys.add(k);
    iron.push(hex);
  }

  if (errors.length > 0) {
    return { errors };
  }

  return { hexes, iron };
}

function parseFixedSource(raw: string): BoardSourceValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      kind: "fixed",
      errors: ["Couldn't parse JSON — check for a stray comma or bracket."],
    };
  }

  const result = validateFixedDef(parsed);
  if ("errors" in result) {
    return { ok: false, kind: "fixed", errors: result.errors };
  }
  return { ok: true, source: { kind: "fixed", def: result } };
}

/**
 * Validates a designer-supplied `BoardSource` before any call to `loadBoard`
 * (the engine re-validates server-side at game-creation time — P4's defense
 * in depth — this is the client's friendly-error gate that runs first, so a
 * bad paste never surfaces an engine exception in the UI).
 *
 * `fixed`-kind input is treated as fully untrusted: unknown top-level keys
 * are rejected (an explicit allowlist of `hexes`/`iron` — see
 * `BoardDefinition` in `src/engine/types.ts`, which has no other fields),
 * hex shape is checked field-by-field before any geometry math runs on it,
 * and the pasted hex count is capped (`MAX_FIXED_HEXES`) before the
 * per-hex validation loop, so a pathological paste fails fast instead of
 * hanging.
 *
 * Failure shapes differ by input kind — field-keyed for `generate`, flat
 * strings for `fixed` — see the `BoardSourceValidation` docblock for the
 * rationale.
 */
export function parseBoardSource(input: BoardSourceInput): BoardSourceValidation {
  if (input.kind === "generate") {
    return parseGenerateSource(input);
  }
  return parseFixedSource(input.raw);
}

/**
 * Validates an already-JSON-parsed `BoardSource` value — the shape an imported `SessionRecord`
 * carries (unlike `parseBoardSource`'s `fixed` arm, which owns its own `JSON.parse` of a raw
 * textarea string; this function starts one step later, at the parsed value). Reuses the exact
 * same caps as `parseBoardSource`: `BOARD_SIZE_RANGE` / `IRON_COUNT_MIN` for `generate`, and
 * `MAX_FIXED_HEXES` + the per-hex integer/bound/invariant/duplicate/iron-membership checks for
 * `fixed` — so an import can't bypass any check the designer's own paste path enforces. Errors
 * are flat strings regardless of kind: an imported record has no form field to key errors to.
 */
export function validateBoardSource(value: unknown): { ok: true; source: BoardSource } | { ok: false; errors: string[] } {
  if (!isPlainObject(value)) {
    return { ok: false, errors: ['Field "boardSource" must be an object.'] };
  }

  const kind = value.kind;
  if (kind === "generate") {
    const size = value.size;
    const ironCount = value.ironCount;
    if (typeof size !== "number" || typeof ironCount !== "number") {
      return { ok: false, errors: ['boardSource.size and boardSource.ironCount must be numbers.'] };
    }
    const fieldErrors = validateGenerateFields({ size, ironCount });
    if (fieldErrors.length > 0) {
      return { ok: false, errors: fieldErrors.map((e) => `boardSource.${e.field}: ${e.message}`) };
    }
    return { ok: true, source: { kind: "generate", size, ironCount } };
  }

  if (kind === "fixed") {
    const result = validateFixedDef(value.def);
    if ("errors" in result) {
      return { ok: false, errors: result.errors.map((e) => `boardSource.def.${e}`) };
    }
    return { ok: true, source: { kind: "fixed", def: result } };
  }

  return {
    ok: false,
    errors: [`boardSource.kind must be "generate" or "fixed", got ${JSON.stringify(kind)}.`],
  };
}
