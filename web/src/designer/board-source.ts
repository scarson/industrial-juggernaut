// ABOUTME: Validates a designer-supplied BoardSource before it ever reaches loadBoard() —
// ABOUTME: friendly errors for generate-kind numeric ranges and fixed-kind untrusted JSON paste.
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatHex(h: { x: unknown; y: unknown; z: unknown }): string {
  return `(${h.x}, ${h.y}, ${h.z})`;
}

function parseGenerateSource(input: {
  kind: "generate";
  size: number;
  ironCount: number;
}): BoardSourceValidation {
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

  if (errors.length > 0) {
    return { ok: false, kind: "generate", errors };
  }
  return {
    ok: true,
    source: { kind: "generate", size: input.size, ironCount: input.ironCount },
  };
}

// Validates one hex's shape (three finite-number fields) before any geometric invariant is
// checked. `label` identifies which array + index the hex came from, for friendly messages.
function validateHexShape(value: unknown, label: string, errors: string[]): Hex | null {
  if (!isPlainObject(value)) {
    errors.push(`${label} must be an object with x, y, z fields.`);
    return null;
  }
  const coords: (keyof Hex)[] = ["x", "y", "z"];
  let shapeOk = true;
  for (const c of coords) {
    if (typeof value[c] !== "number" || !Number.isFinite(value[c] as number)) {
      errors.push(`${label}.${c} must be a number.`);
      shapeOk = false;
    }
  }
  if (!shapeOk) return null;
  return { x: value.x as number, y: value.y as number, z: value.z as number };
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

  if (!isPlainObject(parsed)) {
    return {
      ok: false,
      kind: "fixed",
      errors: ["The pasted board must be a JSON object with hexes and iron fields."],
    };
  }

  const knownKeys = new Set(["hexes", "iron"]);
  const unknownKeys = Object.keys(parsed).filter((k) => !knownKeys.has(k));
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      kind: "fixed",
      errors: [`Unknown field(s) in pasted board: ${unknownKeys.join(", ")}.`],
    };
  }

  const errors: string[] = [];

  if (!Array.isArray(parsed.hexes)) {
    errors.push("hexes must be an array.");
    return { ok: false, kind: "fixed", errors };
  }
  if (!Array.isArray(parsed.iron)) {
    errors.push("iron must be an array.");
    return { ok: false, kind: "fixed", errors };
  }

  if (parsed.hexes.length === 0) {
    errors.push("hexes must not be empty.");
  }
  if (parsed.iron.length === 0) {
    errors.push("iron must not be empty.");
  }
  if (errors.length > 0) {
    return { ok: false, kind: "fixed", errors };
  }

  if (parsed.hexes.length > MAX_FIXED_HEXES) {
    return {
      ok: false,
      kind: "fixed",
      errors: [`Too many hexes: ${parsed.hexes.length} exceeds the ${MAX_FIXED_HEXES}-hex cap.`],
    };
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
    return { ok: false, kind: "fixed", errors };
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
    return { ok: false, kind: "fixed", errors };
  }

  return { ok: true, source: { kind: "fixed", def: { hexes, iron } } };
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
