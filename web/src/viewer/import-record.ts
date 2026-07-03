// ABOUTME: parseSessionRecord — validates a PASTED SessionRecord as untrusted input (testing-pitfalls §4)
// ABOUTME: and decodes it to the { header, log } buildFrames consumes, or returns friendly errors.
import { decodeRecord } from "../engine-client/barrel";
import { HEADER_FORMAT_VERSION, MAX_SEATS, MIN_SEATS } from "../designer/new-game-form";
import { validateBoardSource } from "../designer/board-source";
import { configGroups, validateConfig } from "../designer/config-form";
import type { LogEntry, RuleConfig, SessionHeader, SessionRecord } from "../engine-client/barrel";

/**
 * The largest log we will decode from a paste. A real recorded game is a few hundred entries
 * (`buildFrames` precomputes O(log · state) frames up front — a couple of MB at ~300 entries per
 * its own note); a malicious paste of millions of entries would exhaust memory before the user
 * saw anything. This ceiling is defense in depth against that DoS, well above any honest game and
 * checked BEFORE decoding so a hostile log is rejected without allocating a frame per entry.
 */
export const MAX_IMPORT_LOG_ENTRIES = 100_000;

/** The known log-entry discriminants (the closed v1 union in `src/session/types.ts`). */
const KNOWN_ENTRY_KINDS: ReadonlySet<string> = new Set([
  "placeFirstBase",
  "build",
  "attack",
  "endRound",
  "pass",
  "roundSkipped",
]);

export type ParseResult =
  | { ok: true; record: { header: SessionHeader; log: LogEntry[] } }
  | { ok: false; errors: string[] };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Every `RuleConfig` key, flattened from `configGroups()` — the same list its own exhaustiveness test pins. */
const RULE_CONFIG_KEYS: readonly string[] = Object.values(configGroups()).flat();

/**
 * Guards that an imported `config` is shaped closely enough to call `validateConfig` on without
 * `validateConfig` itself throwing: a non-null plain object carrying every `RuleConfig` key, with
 * `combatTable` (the one knob `validateConfig` index-accesses without a prior typeof check) a
 * non-null object if present. Anything short of that is reported here, before `validateConfig`
 * ever runs, rather than letting a hostile `config` (null, a string, a sparse object) throw inside it.
 */
function validateConfigShape(config: unknown): string[] {
  if (!isObject(config)) {
    return ['Field "config" must be an object.'];
  }
  const missing = RULE_CONFIG_KEYS.filter((key) => !(key in config));
  if (missing.length > 0) {
    return [`Field "config" is missing required key(s): ${missing.join(", ")}.`];
  }
  const combatTable = config.combatTable;
  if (!isObject(combatTable)) {
    return ['Field "config.combatTable" must be an object.'];
  }
  return [];
}

/**
 * Parses and validates a pasted `SessionRecord` JSON string, returning the decoded
 * `{ header, log }` (bigint seed, decoded LogEntry[]) ready for `buildFrames`, or a list of
 * friendly, human-readable errors. Every failure mode a paste can hit — unparseable JSON, a
 * non-object root, a missing/wrong-typed field, a wrong formatVersion, an undecodable bigint
 * (seed or per-entry rng), an unknown entry kind, an oversized log, a hostile `config` or
 * `boardSource` (wrong shape, out-of-range knobs, a pathological `generate` size, an invariant-
 * violating fixed board) — is a returned error, never a thrown exception. This is the client's
 * untrusted-input gate; the engine re-validates on replay.
 */
export function parseSessionRecord(text: string): ParseResult {
  // 1) JSON parse — friendly error instead of a thrown SyntaxError.
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["Could not read the pasted text as JSON. Check for a copy/paste truncation."] };
  }

  // 2) Root must be an object (not an array/number/string/null).
  if (!isObject(parsed)) {
    return { ok: false, errors: ["The pasted JSON must be a session-record object, not an array or primitive."] };
  }

  const errors: string[] = [];

  // 3) Presence of every required top-level field (per the SessionRecord shape in
  //    src/session/types.ts). A missing field is reported by name so the paster can find it.
  const REQUIRED_FIELDS = ["formatVersion", "replayVersion", "seed", "config", "boardSource", "seats", "log"] as const;
  for (const name of REQUIRED_FIELDS) {
    if (!(name in parsed)) errors.push(`Missing required field "${name}".`);
  }
  if (errors.length > 0) return { ok: false, errors };

  // 4) formatVersion must be the number this client understands.
  const formatVersion = parsed.formatVersion;
  if (typeof formatVersion !== "number") {
    errors.push(`Field "formatVersion" must be a number.`);
  } else if (formatVersion !== HEADER_FORMAT_VERSION) {
    errors.push(
      `Unsupported format version ${formatVersion}. This client reads version ${HEADER_FORMAT_VERSION}.`,
    );
  }

  // 5) seed must be a decimal-string bigint.
  const seed = parsed.seed;
  if (typeof seed !== "string") {
    errors.push(`Field "seed" must be a decimal string.`);
  } else if (!/^\d+$/.test(seed.trim()) || seed.trim() === "") {
    errors.push(`Field "seed" is not a valid whole-number string.`);
  }

  // 6) seats + log must be arrays; the log size cap is a pre-decode guard.
  if (!Array.isArray(parsed.seats)) {
    errors.push(`Field "seats" must be an array.`);
  } else if (parsed.seats.length < MIN_SEATS || parsed.seats.length > MAX_SEATS) {
    // The game is defined for 2-6 players; a record outside that range is invalid rather than
    // a giant-but-legal state (`setupPhaseState` would happily build an N-player board).
    errors.push(
      `Field "seats" must hold ${MIN_SEATS}-${MAX_SEATS} seats (got ${parsed.seats.length}).`,
    );
  }
  if (!Array.isArray(parsed.log)) {
    errors.push(`Field "log" must be an array.`);
  } else if (parsed.log.length > MAX_IMPORT_LOG_ENTRIES) {
    errors.push(
      `The log is too large (${parsed.log.length} entries; the import cap is ${MAX_IMPORT_LOG_ENTRIES}).`,
    );
  } else {
    // 7) Each entry must be an object carrying a KNOWN kind before we try to decode it.
    parsed.log.forEach((entry, i) => {
      if (!isObject(entry)) {
        errors.push(`Log entry ${i} is not an object.`);
        return;
      }
      const kind = entry.kind;
      if (typeof kind !== "string" || !KNOWN_ENTRY_KINDS.has(kind)) {
        errors.push(`Log entry ${i} has an unknown kind ${JSON.stringify(kind)}.`);
      }
    });
  }

  // 7.5) config must be shaped closely enough to validate, then must pass the same knob-range
  //      checks the designer's own NewGame form enforces (`validateConfig`) — a hostile config
  //      (null, wrong type, missing knobs, out-of-range values) is rejected here rather than
  //      reaching `initGame`/`buildFrames` unchecked.
  const configShapeErrors = validateConfigShape(parsed.config);
  if (configShapeErrors.length > 0) {
    errors.push(...configShapeErrors);
  } else {
    const configErrors = validateConfig(parsed.config as RuleConfig);
    errors.push(...configErrors.map((e) => `config.${e.knob}: ${e.message}`));
  }

  // 7.6) boardSource must pass the same caps `parseBoardSource` enforces on the designer's own
  //      paste path (BOARD_SIZE_RANGE / IRON_COUNT_MIN for `generate`, MAX_FIXED_HEXES + per-hex
  //      integer/bound/invariant/duplicate/iron-membership checks for `fixed`) — checked and
  //      rejected here, BEFORE `buildFrames` ever calls `initGame`, so a pathological `generate`
  //      size can't reach `ovalHexes`'s O(size) search loop (a synchronous-hang DoS) and an
  //      invariant-violating `fixed` def can't reach `loadBoard`'s uncaught throw.
  const boardSourceResult = validateBoardSource(parsed.boardSource);
  if (!boardSourceResult.ok) {
    errors.push(...boardSourceResult.errors);
  }

  if (errors.length > 0 || !boardSourceResult.ok) return { ok: false, errors };

  // 8) Structurally valid enough to attempt the real decode. `decodeRecord` runs BigInt()/decodeRng
  //    on the seed and every entry's rng — an undecodable string throws SyntaxError, which we catch
  //    and surface as a friendly per-decode error rather than letting it escape. `boardSource` is
  //    swapped for `validateBoardSource`'s reconstructed value (built only from validated fields)
  //    rather than decoding the original untrusted reference.
  try {
    const decoded = decodeRecord({ ...parsed, boardSource: boardSourceResult.source } as unknown as SessionRecord);
    return { ok: true, record: decoded };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      errors: [`Could not decode the record — a numeric field is malformed (${detail}).`],
    };
  }
}
