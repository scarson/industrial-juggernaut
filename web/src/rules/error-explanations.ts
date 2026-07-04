// ABOUTME: explainError — turns a DriverErrorCode into one plain-English rule sentence, so a
// ABOUTME: rejected command teaches the rule it broke instead of surfacing a bare wire code.
import type { DriverErrorCode } from "../game/driver";

/**
 * One sentence per `DriverErrorCode` (the union in `web/src/game/driver.ts`). Keyed as a `Record`
 * rather than a `switch` so the compiler enforces totality: a new code added to the union without a
 * matching entry here fails typecheck immediately, before any test runs.
 *
 * Codes split into two families per the driver's own comment:
 *  - envelope/transport codes (socket-level: stale index, wrong turn, malformed traffic, etc.) —
 *    these aren't rule violations, so their sentences describe the transport condition in plain terms.
 *  - rule codes (setup placement, session validation, build rules) — genuine rule violations, phrased
 *    as the rule itself so the UI can surface "why was that rejected?" as a teaching moment.
 * Digital Edition Ruling callouts are referenced by number (see rules-content.ts) where a code's
 * explanation depends on a documented divergence from the printed rules.
 */
export const EXPLANATION: Record<DriverErrorCode, string> = {
  // --- envelope/transport (socket only) ---
  STALE_INDEX:
    "Your view of the game fell behind the server. Resyncing will bring you back to the current state.",
  NOT_YOUR_TURN: "It is not your round. Only the active player may act right now.",
  DECISION_PENDING: "A decision is already waiting to be resolved before any new command can be sent.",
  ALREADY_RESOLVED: "That decision has already been resolved and cannot be answered again.",
  SEAT_TAKEN: "That seat is already claimed by another player.",
  BAD_SEAT_TOKEN: "Your seat could not be verified, so this command was not accepted.",
  GAME_OVER: "The game has ended, so no further commands can be applied.",
  FROZEN: "The session is frozen and is not currently accepting commands.",
  MALFORMED: "The server could not read that command. Please try the action again.",
  UNKNOWN_TYPE: "The server did not recognize that command.",
  OVERSIZED: "That command was too large for the server to accept.",
  VERSION_MISMATCH:
    "This client is running an incompatible version of the game and needs to reload to continue.",
  ROOM_NOT_INITIALIZED: "This game room is not ready yet, so commands cannot be applied.",

  // --- setup placement ---
  NOT_IN_SETUP: "First-base placement can only happen during setup, before the first turn begins.",
  SETUP_PLACEMENT_REQUIRED:
    "Setup is still in progress — you must place your first base before taking any other action.",
  HEX_OFF_BOARD: "That hex is outside the board and cannot be built on.",
  HEX_NOT_OUTER:
    "Your first base must be placed on a hex in the outermost ring of the board, per setup rules.",
  HEX_OCCUPIED: "Only one piece may occupy a hex — that hex is already taken.",
  INVALID_ATTACKERS: "The attacking bases named are not a legal set for this attack.",

  // --- session validation (rule explanations) ---
  PASS_NOT_FORCED:
    "Voluntary pass is illegal in the Digital Edition (Ruling #5) — every round must build or attack when a legal action exists.",
  ATTACK_NOT_SINGLE_DECL: "An attack round must declare exactly one attack at a time.",
  DUP_ATTACKERS: "The same base cannot be committed to an attack twice — every attacker must be distinct.",
  DEFENDER_IS_TARGET: "The base being attacked cannot also be named as its own defender.",
  DEFENDER_INELIGIBLE: "The chosen defender is not eligible to defend this base under the rules.",
  NO_ELIGIBLE_DEFENDER:
    "This base has no eligible defender, which makes it unattackable under the Digital Edition (Ruling #4) — the rules are silent, so the engine treats defenderless bases as safe from attack.",
  MIXED_PIECE_TYPES: "A single build round must place one piece type only — factories and bases cannot mix.",
  DUP_PIECES: "The same piece cannot be placed at the same hex twice in one build.",

  // --- build rules (enforced by the engine at apply time) ---
  BUILD_EMPTY: "A build must place at least one piece.",
  BUILD_BOOTSTRAP_FACTORY_ONLY:
    "While founding, your first build must be a factory — a new base is not buildable until you earn real budget by building that factory or gaining a second iron.",
  BUILD_OVER_BUDGET:
    "You tried to place more pieces than your budget allows — you may build one piece for every two resources you control, rounded down.",
  BUILD_ILLEGAL_FACTORY:
    "A factory must be placed on an empty non-iron hex within 5 of your farthest base, and only while the central supply has factories left.",
  BUILD_NO_BASES_IN_HAND: "You have no bases left in hand to place.",
  BUILD_ILLEGAL_BASE:
    "A base outside your perimeter must sit within 5 hexes of a friendly base, outside every opponent's perimeter, and — once you have three or more bases — form a new triangle with two existing bases (the triangle rule applies from the perimeter-establishing 4th base on, Ruling #7).",
};

/** Returns the one-sentence rule explanation for a rejected command's `DriverErrorCode`. */
export function explainError(code: DriverErrorCode): string {
  return EXPLANATION[code];
}
