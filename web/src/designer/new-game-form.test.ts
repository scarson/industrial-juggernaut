// ABOUTME: Pins the pure new-game form logic — seat-list reducer transitions, seed-string parsing,
// ABOUTME: and SessionHeader assembly (bigint seed). No React; the component tests live in NewGame.test.tsx.
import { describe, expect, test } from "vitest";
import {
  GREEDY_ARCHETYPES,
  MAX_SEATS,
  MIN_SEATS,
  assembleHeader,
  initialSeats,
  parseSeed,
  seatKindOf,
  seatsReducer,
} from "./new-game-form";
import { defaultConfig } from "../engine-client/barrel";
import type { SeatConfig } from "../engine-client/barrel";

describe("initialSeats", () => {
  test("starts with the minimum two human seats", () => {
    const seats = initialSeats();
    expect(seats).toHaveLength(MIN_SEATS);
    expect(seats.every((s) => s.kind === "human")).toBe(true);
  });
});

describe("seatsReducer — add/remove", () => {
  test("addSeat appends a human seat", () => {
    const seats = seatsReducer(initialSeats(), { type: "addSeat" });
    expect(seats).toHaveLength(3);
    expect(seats[2]).toEqual({ kind: "human" });
  });

  test("addSeat is a no-op at the 6-seat ceiling", () => {
    let seats = initialSeats();
    while (seats.length < MAX_SEATS) seats = seatsReducer(seats, { type: "addSeat" });
    expect(seats).toHaveLength(MAX_SEATS);
    const after = seatsReducer(seats, { type: "addSeat" });
    expect(after).toHaveLength(MAX_SEATS);
  });

  test("removeSeat drops the seat at the given index", () => {
    const three = seatsReducer(initialSeats(), { type: "addSeat" });
    const seats = seatsReducer(three, { type: "removeSeat", index: 1 });
    expect(seats).toHaveLength(2);
  });

  test("removeSeat is a no-op at the 2-seat floor", () => {
    const seats = seatsReducer(initialSeats(), { type: "removeSeat", index: 0 });
    expect(seats).toHaveLength(MIN_SEATS);
  });
});

describe("seatsReducer — kind + archetype", () => {
  test("setKind to greedy produces a greedy agent seat with a default archetype", () => {
    const seats = seatsReducer(initialSeats(), { type: "setKind", index: 0, kind: "greedy" });
    expect(seats[0]).toEqual({
      kind: "agent",
      agent: "greedy",
      archetype: GREEDY_ARCHETYPES[0],
    });
  });

  test("setKind to heuristic produces a heuristic agent seat (no archetype field)", () => {
    const seats = seatsReducer(initialSeats(), { type: "setKind", index: 1, kind: "heuristic" });
    expect(seats[1]).toEqual({ kind: "agent", agent: "heuristic" });
  });

  test("setKind back to human clears the agent fields", () => {
    const greedy = seatsReducer(initialSeats(), { type: "setKind", index: 0, kind: "greedy" });
    const seats = seatsReducer(greedy, { type: "setKind", index: 0, kind: "human" });
    expect(seats[0]).toEqual({ kind: "human" });
  });

  test("setArchetype updates a greedy seat's archetype", () => {
    const greedy = seatsReducer(initialSeats(), { type: "setKind", index: 0, kind: "greedy" });
    const seats = seatsReducer(greedy, {
      type: "setArchetype",
      index: 0,
      archetype: "economic",
    });
    expect(seats[0]).toEqual({ kind: "agent", agent: "greedy", archetype: "economic" });
  });

  test("setArchetype on a human seat is a no-op", () => {
    const seats = seatsReducer(initialSeats(), {
      type: "setArchetype",
      index: 0,
      archetype: "economic",
    });
    expect(seats[0]).toEqual({ kind: "human" });
  });

  test("setKind touches only the targeted seat", () => {
    const seats = seatsReducer(initialSeats(), { type: "setKind", index: 0, kind: "greedy" });
    expect(seats[1]).toEqual({ kind: "human" });
  });
});

describe("seatKindOf", () => {
  test("maps each SeatConfig arm back to its kind discriminant", () => {
    expect(seatKindOf({ kind: "human" })).toBe("human");
    expect(seatKindOf({ kind: "agent", agent: "greedy", archetype: "aggressive" })).toBe("greedy");
    expect(seatKindOf({ kind: "agent", agent: "heuristic" })).toBe("heuristic");
  });
});

describe("parseSeed", () => {
  test("parses a digit string to the matching bigint", () => {
    const result = parseSeed("42");
    expect(result).toEqual({ ok: true, seed: 42n });
  });

  test("tolerates surrounding whitespace and leading zeros", () => {
    expect(parseSeed("  007  ")).toEqual({ ok: true, seed: 7n });
  });

  test("parses a value beyond Number.MAX_SAFE_INTEGER without precision loss", () => {
    const big = "9007199254740993"; // 2^53 + 1
    expect(parseSeed(big)).toEqual({ ok: true, seed: BigInt(big) });
  });

  test("rejects an empty string with a friendly message", () => {
    const result = parseSeed("");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.message).toMatch(/required/i);
  });

  test("rejects a non-digit string with a friendly message", () => {
    const result = parseSeed("0x9f3a");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.message).toMatch(/digits/i);
  });

  test("rejects a negative sign (seed is an unsigned whole number)", () => {
    expect(parseSeed("-5").ok).toBe(false);
  });
});

describe("assembleHeader", () => {
  test("assembles a SessionHeader-shaped object with the decoded bigint seed", () => {
    const config = defaultConfig();
    const boardSource = { kind: "generate", size: 96, ironCount: 14 } as const;
    const seats: SeatConfig[] = [{ kind: "human" }, { kind: "agent", agent: "heuristic" }];
    const header = assembleHeader({ seed: 123n, config, boardSource, seats });

    expect(header.seed).toBe(123n);
    expect(typeof header.seed).toBe("bigint");
    expect(header.config).toBe(config);
    expect(header.boardSource).toBe(boardSource);
    expect(header.seats).toBe(seats);
    expect(typeof header.formatVersion).toBe("number");
    expect(typeof header.replayVersion).toBe("string");
  });
});
