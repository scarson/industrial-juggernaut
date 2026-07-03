// ABOUTME: Pure form-state logic for the designer's new-game instrument — the seat-list reducer,
// ABOUTME: seed-string parsing, and SessionHeader assembly. No React, no I/O (TDD'd separately).
import type { RuleConfig, SeatConfig, SessionHeader, BoardSource } from "../engine-client/barrel";
// Type-only import (erased at build): brings the Archetype union in for typing WITHOUT pulling
// src/agent into the client value graph — the load-bearing bundle-purity discipline for P2.4.
// The runtime option list is declared locally below (GREEDY_ARCHETYPES).
import type { Archetype } from "../../../src/agent/archetypes";

/**
 * The three greedy-agent archetypes, as a runtime value list for the seat picker. Declared
 * locally (not imported from src/agent) so `src/agent` never enters the client bundle's value
 * graph; the `satisfies readonly Archetype[]` keeps it in lock-step with the engine's union —
 * a new archetype in `src/agent/archetypes.ts` that isn't added here fails the type check.
 */
export const GREEDY_ARCHETYPES = [
  "aggressive",
  "economic",
  "expansionist",
] as const satisfies readonly Archetype[];

/** The three ways a seat can be driven, as the seat-kind toggle's option list. */
export type SeatKind = "human" | "greedy" | "heuristic";

export const SEAT_KINDS = ["human", "greedy", "heuristic"] as const satisfies readonly SeatKind[];

/** Player-count bounds — Industrial Juggernaut is a 2–6 player game (identity ids 0–5). */
export const MIN_SEATS = 2;
export const MAX_SEATS = 6;

/**
 * The seat list's default archetype when a seat is first switched to the greedy agent. Kept as a
 * named constant so the reducer and the initial-seats factory agree on one value.
 */
const DEFAULT_ARCHETYPE: Archetype = "aggressive";

/** Actions the seat-list reducer understands. `index` is the seat's position (0-based player id). */
export type SeatAction =
  | { type: "addSeat" }
  | { type: "removeSeat"; index: number }
  | { type: "setKind"; index: number; kind: SeatKind }
  | { type: "setArchetype"; index: number; archetype: Archetype };

/** The default seat roster for a fresh game: two human seats (the minimum). */
export function initialSeats(): SeatConfig[] {
  return [{ kind: "human" }, { kind: "human" }];
}

/**
 * Builds the `SeatConfig` for a seat-kind selection, filling the greedy agent's archetype
 * (falling back to the default when switching INTO greedy from another kind). Centralizes the
 * kind→SeatConfig mapping so the reducer's `setKind`/`setArchetype`/`addSeat` all agree.
 */
function seatOfKind(kind: SeatKind, archetype: Archetype): SeatConfig {
  switch (kind) {
    case "human":
      return { kind: "human" };
    case "greedy":
      return { kind: "agent", agent: "greedy", archetype };
    case "heuristic":
      return { kind: "agent", agent: "heuristic" };
  }
}

/** The seat-kind discriminant for an existing `SeatConfig` (the inverse of `seatOfKind`). */
export function seatKindOf(seat: SeatConfig): SeatKind {
  if (seat.kind === "human") return "human";
  return seat.agent === "greedy" ? "greedy" : "heuristic";
}

/**
 * Reduces the seat list. Add/remove clamp to the 2–6 range (a no-op at the bounds rather than
 * throwing — the UI disables the affordances, this is defense in depth). `setArchetype` only
 * applies to a greedy seat; on any other kind it's a no-op (the archetype picker isn't shown).
 */
export function seatsReducer(seats: SeatConfig[], action: SeatAction): SeatConfig[] {
  switch (action.type) {
    case "addSeat":
      if (seats.length >= MAX_SEATS) return seats;
      return [...seats, { kind: "human" }];
    case "removeSeat":
      if (seats.length <= MIN_SEATS) return seats;
      return seats.filter((_, i) => i !== action.index);
    case "setKind":
      return seats.map((seat, i) =>
        i === action.index ? seatOfKind(action.kind, archetypeOf(seat)) : seat,
      );
    case "setArchetype":
      return seats.map((seat, i) => {
        if (i !== action.index) return seat;
        if (seat.kind !== "agent" || seat.agent !== "greedy") return seat;
        return { kind: "agent", agent: "greedy", archetype: action.archetype };
      });
  }
}

/** The greedy archetype carried by a seat, or the default for a non-greedy seat. */
function archetypeOf(seat: SeatConfig): Archetype {
  if (seat.kind === "agent" && seat.agent === "greedy") return seat.archetype;
  return DEFAULT_ARCHETYPE;
}

/** A parsed-seed result: either the decoded bigint or a friendly per-field error message. */
export type SeedParse = { ok: true; seed: bigint } | { ok: false; message: string };

/**
 * Parses the seed text field into the bigint `SessionHeader.seed` wants. The engine seed is an
 * unsigned integer; the field is digits-only (an empty or non-digit string is a friendly error,
 * not a thrown `BigInt()` SyntaxError). Leading zeros are tolerated (`"007"` → `7n`) since they
 * don't change the value. This is the client's friendly gate; the engine re-derives its own RNG
 * from the seed at game-creation time.
 */
export function parseSeed(raw: string): SeedParse {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: false, message: "Seed is required — enter a whole number." };
  }
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, message: "Seed must be digits only (a whole number)." };
  }
  return { ok: true, seed: BigInt(trimmed) };
}

/**
 * The current format/replay version the assembled header carries. Mirrors the engine's session
 * codec versioning — the local header for a freshly-designed game starts at the current version
 * (there's no older log to migrate). Kept here so the NewGame form doesn't hard-code it inline.
 */
export const HEADER_FORMAT_VERSION = 1;
export const HEADER_REPLAY_VERSION = "1";

export interface AssembleHeaderInput {
  seed: bigint;
  config: RuleConfig;
  boardSource: BoardSource;
  seats: SeatConfig[];
}

/**
 * Assembles the decoded `SessionHeader` the `onStart` prop hands to P2.7's viewer / P3's game
 * screen. `seed` is the DECODED bigint (not the wire's decimal string — see `SessionHeader` in
 * `src/session/types.ts`, whose `seed` field is `bigint`; the decimal-string form is the codec's
 * encoded wire shape, which the consumers encode into when they persist).
 */
export function assembleHeader(input: AssembleHeaderInput): SessionHeader {
  return {
    formatVersion: HEADER_FORMAT_VERSION,
    replayVersion: HEADER_REPLAY_VERSION,
    seed: input.seed,
    config: input.config,
    boardSource: input.boardSource,
    seats: input.seats,
  };
}
