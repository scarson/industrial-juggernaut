// ABOUTME: Pins eventLine — one human sentence per GameEvent kind + EliminationCause, with bounty
// ABOUTME: phrasing when the elimination carries a recipient. Boils the lake: every kind, every cause.
import { describe, expect, test } from "vitest";
import { eventLine } from "./event-copy";
import type { EliminationCause, GameEvent, PlayerId } from "../engine-client/barrel";

const hex = { x: 0, y: 0, z: 0 };

// Every GameEvent kind at least once — the discriminant is the map key so a new kind added to the
// engine union (without a matching entry here) is a visible gap, not a silent placeholder.
const oneOfEachKind: Record<GameEvent["kind"], GameEvent> = {
  placed: { kind: "placed", piece: "base", hex, owner: 0 },
  combat: { kind: "combat", target: hex, committed: 5, attackerWon: true },
  baseDestroyed: { kind: "baseDestroyed", hex, owner: 1 },
  baseReplaced: { kind: "baseReplaced", hex, from: 1, to: 0 },
  eliminated: { kind: "eliminated", player: 2, cause: "noBases", bountyTo: 0 },
  victory: { kind: "victory", players: [0] },
};

// The four elimination causes per spec §8 — the union in src/engine/types.ts. `emptyPerimeter` is
// self-inflicted (no bounty); the other three can carry a bounty recipient.
const ALL_CAUSES: EliminationCause[] = [
  "noBases",
  "brokenPerimeterAt18Factories",
  "noIron",
  "emptyPerimeter",
];

// A line that would betray a missing/lazy implementation: empty, whitespace, a bare discriminant,
// an object dump, an undefined leak, or a TODO/placeholder marker.
function assertHumanLine(line: string, event: GameEvent): void {
  const ctx = JSON.stringify(event);
  expect(line, ctx).toBeTypeOf("string");
  expect(line.trim(), ctx).not.toBe("");
  expect(line, ctx).not.toMatch(/undefined|null|\[object|NaN/i);
  expect(line, ctx).not.toMatch(/todo|placeholder|tbd|fixme/i);
  // Not a bare discriminant echoed back (e.g. "placed" / "combat") — the copy must add words.
  expect(line.trim().toLowerCase(), ctx).not.toBe(event.kind.toLowerCase());
  // A real sentence has more than one word.
  expect(line.trim().split(/\s+/).length, ctx).toBeGreaterThan(1);
}

describe("eventLine — every kind yields a human line", () => {
  for (const [kind, event] of Object.entries(oneOfEachKind)) {
    test(`${kind} narrates to a non-placeholder human line`, () => {
      assertHumanLine(eventLine(event), event);
    });
  }
});

describe("eventLine — placed", () => {
  test("names the piece and the owning player", () => {
    const base = eventLine({ kind: "placed", piece: "base", hex, owner: 0 });
    expect(base).toMatch(/base/i);
    expect(base).toMatch(/1/); // player 0 shown 1-based as "Player 1"

    const factory = eventLine({ kind: "placed", piece: "factory", hex, owner: 3 });
    expect(factory).toMatch(/factory/i);
    expect(factory).toMatch(/4/); // player 3 → "Player 4"
  });
});

describe("eventLine — combat", () => {
  test("a win includes the committed count and reads as a capture/win", () => {
    const line = eventLine({ kind: "combat", target: hex, committed: 4, attackerWon: true });
    expect(line).toMatch(/4/); // committed count is honest, on screen
    expect(line).toMatch(/win|won|captured|takes|seizes/i);
  });

  test("a loss includes the committed count and reads as a repel/loss", () => {
    const line = eventLine({ kind: "combat", target: hex, committed: 6, attackerWon: false });
    expect(line).toMatch(/6/);
    expect(line).toMatch(/lost|loses|repelled|held|fails|failed/i);
  });

  test("the committed count is stated for every commitment level 3..6", () => {
    for (const committed of [3, 4, 5, 6]) {
      const line = eventLine({ kind: "combat", target: hex, committed, attackerWon: true });
      expect(line, `committed ${committed}`).toMatch(new RegExp(String(committed)));
    }
  });
});

describe("eventLine — baseDestroyed / baseReplaced", () => {
  test("baseDestroyed names the losing player and reads as a loss/destruction", () => {
    const line = eventLine({ kind: "baseDestroyed", hex, owner: 2 });
    expect(line).toMatch(/3/); // player 2 → "Player 3"
    expect(line).toMatch(/destroy|razed|lost|falls|eliminated base|wiped/i);
  });

  test("baseReplaced names both the losing and the capturing player", () => {
    const line = eventLine({ kind: "baseReplaced", hex, from: 4, to: 1 });
    expect(line).toMatch(/5/); // from player 4 → "Player 5"
    expect(line).toMatch(/2/); // to player 1 → "Player 2"
  });
});

describe("eventLine — eliminated (all causes + bounty)", () => {
  for (const cause of ALL_CAUSES) {
    test(`cause ${cause}: names the eliminated player and the cause`, () => {
      const line = eventLine({ kind: "eliminated", player: 2, cause, bountyTo: null });
      expect(line, cause).toMatch(/3/); // player 2 → "Player 3"
      // The cause is human-readable (not the raw camelCase discriminant leaked verbatim).
      expect(line, cause).not.toContain(cause);
      expect(line.trim(), cause).not.toBe("");
    });
  }

  test("noBases reads as running out of bases", () => {
    const line = eventLine({ kind: "eliminated", player: 0, cause: "noBases", bountyTo: null });
    expect(line).toMatch(/base/i);
  });

  test("brokenPerimeterAt18Factories reads as a broken perimeter / late-game death", () => {
    const line = eventLine({
      kind: "eliminated",
      player: 0,
      cause: "brokenPerimeterAt18Factories",
      bountyTo: null,
    });
    expect(line).toMatch(/perimeter/i);
  });

  test("noIron reads as losing iron", () => {
    const line = eventLine({ kind: "eliminated", player: 0, cause: "noIron", bountyTo: null });
    expect(line).toMatch(/iron/i);
  });

  test("emptyPerimeter reads as an empty/self-inflicted perimeter", () => {
    const line = eventLine({ kind: "eliminated", player: 0, cause: "emptyPerimeter", bountyTo: null });
    expect(line).toMatch(/perimeter/i);
  });

  test("a bounty recipient is named when present", () => {
    const withBounty = eventLine({ kind: "eliminated", player: 2, cause: "noBases", bountyTo: 0 });
    expect(withBounty).toMatch(/bounty/i);
    expect(withBounty).toMatch(/1/); // bounty to player 0 → "Player 1"
  });

  test("no bounty phrasing when bountyTo is null", () => {
    const noBounty = eventLine({ kind: "eliminated", player: 2, cause: "noBases", bountyTo: null });
    expect(noBounty).not.toMatch(/bounty/i);
  });

  test("emptyPerimeter never carries a bounty even if a recipient is (wrongly) supplied", () => {
    // Spec §8: emptyPerimeter is self-inflicted and yields no bounty. Defense in depth — the copy
    // must not announce a bounty for a self-inflicted cause regardless of the event's bountyTo.
    const line = eventLine({
      kind: "eliminated",
      player: 2,
      cause: "emptyPerimeter",
      bountyTo: 0 as PlayerId,
    });
    expect(line).not.toMatch(/bounty/i);
  });
});

describe("eventLine — victory", () => {
  test("a solo victory names the winner", () => {
    const line = eventLine({ kind: "victory", players: [3] });
    expect(line).toMatch(/4/); // player 3 → "Player 4"
    expect(line).toMatch(/victor|wins|won/i);
  });

  test("a coalition victory names every winner", () => {
    const line = eventLine({ kind: "victory", players: [0, 2] });
    expect(line).toMatch(/1/); // player 0 → "Player 1"
    expect(line).toMatch(/3/); // player 2 → "Player 3"
    expect(line).toMatch(/victor|wins|won/i);
  });
});
