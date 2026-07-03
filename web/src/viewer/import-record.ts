// ABOUTME: parseSessionRecord — validates a PASTED SessionRecord as untrusted input (testing-pitfalls §4)
// ABOUTME: and decodes it to the { header, log } buildFrames consumes, or returns friendly errors.
import { decodeRecord } from "../engine-client/barrel";
import { HEADER_FORMAT_VERSION } from "../designer/new-game-form";
import type { LogEntry, SessionHeader, SessionRecord } from "../engine-client/barrel";

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

/**
 * Parses and validates a pasted `SessionRecord` JSON string, returning the decoded
 * `{ header, log }` (bigint seed, decoded LogEntry[]) ready for `buildFrames`, or a list of
 * friendly, human-readable errors. Every failure mode a paste can hit — unparseable JSON, a
 * non-object root, a missing/wrong-typed field, a wrong formatVersion, an undecodable bigint
 * (seed or per-entry rng), an unknown entry kind, an oversized log — is a returned error, never a
 * thrown exception. This is the client's untrusted-input gate; the engine re-validates on replay.
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
  if (!Array.isArray(parsed.seats)) errors.push(`Field "seats" must be an array.`);
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

  if (errors.length > 0) return { ok: false, errors };

  // 8) Structurally valid enough to attempt the real decode. `decodeRecord` runs BigInt()/decodeRng
  //    on the seed and every entry's rng — an undecodable string throws SyntaxError, which we catch
  //    and surface as a friendly per-decode error rather than letting it escape.
  try {
    const decoded = decodeRecord(parsed as unknown as SessionRecord);
    return { ok: true, record: decoded };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      errors: [`Could not decode the record — a numeric field is malformed (${detail}).`],
    };
  }
}
