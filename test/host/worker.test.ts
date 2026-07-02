// ABOUTME: Workers-pool tests for the host Worker fetch — POST /api/games room-create + WS upgrade routing.
// ABOUTME: Asserts human-only seat-token minting, untrusted-body schema validation, host version stamping, and 4xx routing.
import { describe, expect, test } from "vitest";
import { SELF } from "cloudflare:test";
import { ALPHABET } from "../../src/host/ids";
import { REPLAY_VERSION } from "../../src/host/version";
import { defaultConfig } from "../../src/index";

const inAlphabet = (s: string) => [...s].every((c) => ALPHABET.includes(c));

/** A minimal, always-valid create body — a 2-seat human+agent room on a generated board. */
function validBody(overrides: Record<string, unknown> = {}) {
  return {
    seats: [{ kind: "human" }, { kind: "agent", agent: "heuristic" }],
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    seed: "12345678901234567890",
    ...overrides,
  };
}

async function create(body: unknown): Promise<Response> {
  return SELF.fetch("https://host.test/api/games", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/games — happy path", () => {
  test("valid human+agent body → 200 with roomId + human-only seatTokens", async () => {
    const res = await create(validBody());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { roomId: string; seatTokens: (string | null)[] };

    // roomId: 20-char Crockford base32.
    expect(json.roomId).toHaveLength(20);
    expect(inAlphabet(json.roomId)).toBe(true);

    // THE load-bearing assertion: human seat gets a 26-char token, agent seat gets null.
    expect(json.seatTokens).toHaveLength(2);
    expect(json.seatTokens[0]).toHaveLength(26);
    expect(inAlphabet(json.seatTokens[0]!)).toBe(true);
    expect(json.seatTokens[1]).toBeNull();
  });

  test("all-human 3-seat room mints a token per seat", async () => {
    const res = await create(
      validBody({ seats: [{ kind: "human" }, { kind: "human" }, { kind: "human" }] }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { seatTokens: (string | null)[] };
    expect(json.seatTokens.map((t) => (t === null ? null : t!.length))).toEqual([26, 26, 26]);
  });

  test("greedy agent seat with a valid archetype → 200, that seat null", async () => {
    const res = await create(
      validBody({
        seats: [{ kind: "human" }, { kind: "agent", agent: "greedy", archetype: "aggressive" }],
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { seatTokens: (string | null)[] };
    expect(json.seatTokens[1]).toBeNull();
  });

  test("fixed board accepted by the engine loader → 200", async () => {
    // A tiny valid board: three cube-invariant hexes, one iron among them.
    const def = {
      hexes: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: -1, z: 0 },
        { x: -1, y: 1, z: 0 },
      ],
      iron: [{ x: 0, y: 0, z: 0 }],
    };
    const res = await create(validBody({ boardSource: { kind: "fixed", def } }));
    expect(res.status).toBe(200);
  });

  test("explicit config subset of RuleConfig keys → 200", async () => {
    const res = await create(validBody({ config: { baseLimit: 10, allowPass: true } }));
    expect(res.status).toBe(200);
  });

  test("explicit roomOptions.defenderTimeout → 200", async () => {
    const res = await create(
      validBody({ roomOptions: { defenderTimeout: { enabled: true, seconds: 90 } } }),
    );
    expect(res.status).toBe(200);
  });
});

describe("POST /api/games — untrusted body validation (400 names the field)", () => {
  const cases: { name: string; body: unknown; field: string }[] = [
    { name: "too few seats", body: validBody({ seats: [{ kind: "human" }] }), field: "seats" },
    {
      name: "too many seats",
      body: validBody({ seats: Array.from({ length: 7 }, () => ({ kind: "human" })) }),
      field: "seats",
    },
    { name: "seats not an array", body: validBody({ seats: "nope" }), field: "seats" },
    {
      name: "bad seat kind",
      body: validBody({ seats: [{ kind: "robot" }, { kind: "human" }] }),
      field: "seats",
    },
    {
      name: "bad archetype",
      body: validBody({
        seats: [{ kind: "human" }, { kind: "agent", agent: "greedy", archetype: "berserker" }],
      }),
      field: "archetype",
    },
    {
      name: "unknown agent kind",
      body: validBody({ seats: [{ kind: "human" }, { kind: "agent", agent: "mcts" }] }),
      field: "seats",
    },
    {
      name: "boardSource.kind unknown",
      body: validBody({ boardSource: { kind: "download" } }),
      field: "boardSource",
    },
    {
      name: "generate size below range",
      body: validBody({ boardSource: { kind: "generate", size: 10, ironCount: 14 } }),
      field: "size",
    },
    {
      name: "generate size above range",
      body: validBody({ boardSource: { kind: "generate", size: 500, ironCount: 14 } }),
      field: "size",
    },
    {
      name: "generate ironCount not positive",
      body: validBody({ boardSource: { kind: "generate", size: 96, ironCount: 0 } }),
      field: "ironCount",
    },
    {
      name: "fixed def rejected by loadBoard (iron not a member)",
      body: validBody({
        boardSource: {
          kind: "fixed",
          def: { hexes: [{ x: 0, y: 0, z: 0 }], iron: [{ x: 5, y: -5, z: 0 }] },
        },
      }),
      field: "def",
    },
    {
      name: "fixed def malformed (hexes missing)",
      body: validBody({ boardSource: { kind: "fixed", def: { iron: [] } } }),
      field: "def",
    },
    { name: "seed not a decimal string", body: validBody({ seed: "0xdeadbeef" }), field: "seed" },
    { name: "seed not a string", body: validBody({ seed: 123 }), field: "seed" },
    {
      name: "unknown config key",
      body: validBody({ config: { baseLimit: 10, nonsense: true } }),
      field: "nonsense",
    },
    {
      name: "config key wrong type",
      body: validBody({ config: { baseLimit: "ten" } }),
      field: "baseLimit",
    },
    {
      name: "roomOptions bad shape (seconds not positive)",
      body: validBody({ roomOptions: { defenderTimeout: { enabled: true, seconds: -5 } } }),
      field: "defenderTimeout",
    },
    {
      name: "roomOptions bad shape (enabled not boolean)",
      body: validBody({ roomOptions: { defenderTimeout: { enabled: "yes", seconds: 90 } } }),
      field: "defenderTimeout",
    },
    {
      name: "unknown top-level key",
      body: validBody({ replayVersion: "client-supplied-garbage" }),
      field: "replayVersion",
    },
    { name: "not a JSON object", body: [1, 2, 3], field: "body" },
  ];

  for (const c of cases) {
    test(`${c.name} → 400 naming "${c.field}"`, async () => {
      const res = await create(c.body);
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string; field: string };
      expect(json.field).toBe(c.field);
    });
  }

  test("malformed JSON (not parseable) → 400", async () => {
    const res = await SELF.fetch("https://host.test/api/games", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/games — host stamping (client cannot influence versions)", () => {
  test("client-supplied replayVersion/formatVersion are rejected as unknown top-level keys", async () => {
    // Consistency with the config-key rule: unknown top-level keys are rejected,
    // so a client cannot even attempt to set replayVersion/formatVersion.
    const resReplay = await create(validBody({ replayVersion: "9".repeat(16) }));
    expect(resReplay.status).toBe(400);
    const resFormat = await create(validBody({ formatVersion: 999 }));
    expect(resFormat.status).toBe(400);
  });

  test("REPLAY_VERSION is a non-empty committed constant (host stamps it, never the client)", () => {
    expect(REPLAY_VERSION).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("routing", () => {
  test("GET /api/games/:id/ws without Upgrade → 426", async () => {
    const res = await SELF.fetch("https://host.test/api/games/ABC123/ws");
    expect(res.status).toBe(426);
  });

  test("unknown /api/* path → 404 JSON", async () => {
    const res = await SELF.fetch("https://host.test/api/unknown");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  test("wrong method on /api/games (GET) → 404/405", async () => {
    const res = await SELF.fetch("https://host.test/api/games");
    expect([404, 405]).toContain(res.status);
  });

  test("GET /api/games/:id/ws WITH Upgrade forwards to the DO stub (B3 stub 501s)", async () => {
    // Create a real room so idFromName resolves to the room's stub.
    const created = await create(validBody());
    const { roomId } = (await created.json()) as { roomId: string };
    const res = await SELF.fetch(`https://host.test/api/games/${roomId}/ws?seat=0&token=x`, {
      headers: { Upgrade: "websocket" },
    });
    // Mechanism assertion: the request reached the DO stub, which returns 501 until B3.
    // The 501 + its stub body passing through PROVES the Worker forwarded rather than
    // short-circuiting (a 426/404 would mean it never reached the DO). Real upgrade
    // acceptance (101) is B4/B6.2 once the DO does the WebSocketPair + token auth.
    expect(res.status).toBe(501);
    expect(await res.text()).toContain("not implemented until B3");
  });
});
