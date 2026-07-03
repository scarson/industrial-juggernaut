// ABOUTME: Workers-pool tests for the host Worker fetch — POST /api/games room-create + WS upgrade routing.
// ABOUTME: Asserts human-only seat-token minting, untrusted-body schema validation, host version stamping, and 4xx routing.
import { describe, expect, test } from "vitest";
import { SELF } from "cloudflare:test";
import { ALPHABET } from "../../src/host/ids";
import { MAX_FIXED_HEXES } from "../../src/host/room-create";
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
  return createRaw(JSON.stringify(body));
}

/** POST a raw body string — for payloads JSON.stringify cannot express (1e999, "__proto__"). */
async function createRaw(body: string): Promise<Response> {
  return SELF.fetch("https://host.test/api/games", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

/** A straight line of n cube-valid hexes centered on the origin: {x:i, y:-i, z:0}. */
function lineHexes(n: number): { x: number; y: number; z: number }[] {
  const half = Math.floor(n / 2);
  return Array.from({ length: n }, (_, i) => ({ x: i - half, y: half - i, z: 0 }));
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
      name: "config numeric key negative",
      body: validBody({ config: { baseLimit: -5 } }),
      field: "baseLimit",
    },
    {
      name: "config numeric key fractional",
      body: validBody({ config: { victoryThreshold: 0.5 } }),
      field: "victoryThreshold",
    },
    {
      name: "config numeric key zero",
      body: validBody({ config: { factorySupply: 0 } }),
      field: "factorySupply",
    },
    {
      name: "combatTable probability above 1",
      body: validBody({ config: { combatTable: { 3: 1.5, 4: 5 / 6, 5: 8 / 9, 6: 1 } } }),
      field: "combatTable",
    },
    {
      name: "combatTable probability negative",
      body: validBody({ config: { combatTable: { 3: -0.1, 4: 5 / 6, 5: 8 / 9, 6: 1 } } }),
      field: "combatTable",
    },
    {
      name: "fixed def with fractional coords (cube-sum still 0)",
      body: validBody({
        boardSource: {
          kind: "fixed",
          def: { hexes: [{ x: 0.5, y: -0.5, z: 0 }], iron: [] },
        },
      }),
      field: "def",
    },
    {
      name: "fixed def with astronomically large coords (cube-sum still 0)",
      body: validBody({
        boardSource: {
          kind: "fixed",
          def: { hexes: [{ x: 1e308, y: -1e308, z: 0 }], iron: [] },
        },
      }),
      field: "def",
    },
    {
      name: "fixed def with more hexes than the cap",
      body: validBody({
        boardSource: {
          kind: "fixed",
          def: { hexes: lineHexes(MAX_FIXED_HEXES + 1), iron: [{ x: 0, y: 0, z: 0 }] },
        },
      }),
      field: "def",
    },
    {
      // Behaviorally 400 even pre-hardening (loadBoard: an iron array longer than
      // hexes must hit a dup/non-member) — the explicit pre-check bounds the work
      // BEFORE any per-entry loop runs. Regression-guards the field name.
      name: "fixed def with more iron entries than hexes",
      body: validBody({
        boardSource: {
          kind: "fixed",
          def: {
            hexes: [{ x: 0, y: 0, z: 0 }],
            iron: [
              { x: 0, y: 0, z: 0 },
              { x: 0, y: 0, z: 0 },
            ],
          },
        },
      }),
      field: "def",
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

describe("POST /api/games — adversarial hardening (review exploit bodies)", () => {
  test("Infinity via JSON 1e999 in numeric config keys → 400 naming the first offender", async () => {
    // JSON.parse("1e999") yields Infinity, which passes a bare `typeof === "number"`.
    // Raw string body: JSON.stringify would serialize Infinity as null, hiding the exploit.
    const res = await createRaw(
      '{"seats":[{"kind":"human"},{"kind":"human"}],' +
        '"boardSource":{"kind":"generate","size":96,"ironCount":14},"seed":"1",' +
        '"config":{"radius":1e999,"baseLimit":-5,"victoryThreshold":0.5,"placeRange":1e999}}',
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { field: string };
    expect(json.field).toBe("radius"); // first key in body order fails the integer gate
  });

  test('config {"__proto__": 5} → 400 unknown config key (not a prototype-chain false accept)', async () => {
    // Raw string body: a JS object literal {__proto__: 5} would set the prototype
    // instead of creating the own key. JSON.parse creates it as an OWN property.
    // A prototype-walking `in` check sees Object.prototype's __proto__ and falls
    // through to the wrong branch (where the __proto__ setter silently no-ops → 200).
    const res = await createRaw(
      '{"seats":[{"kind":"human"},{"kind":"human"}],' +
        '"boardSource":{"kind":"generate","size":96,"ironCount":14},"seed":"1",' +
        '"config":{"__proto__":5}}',
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; field: string };
    expect(json.field).toBe("__proto__");
    expect(json.error).toContain("unknown config key"); // the RIGHT rejection reason
  });

  test('config {"constructor": 5} → 400 unknown config key', async () => {
    const res = await create(validBody({ config: { constructor: 5 } }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; field: string };
    expect(json.field).toBe("constructor");
    expect(json.error).toContain("unknown config key");
  });

  test("request body over 256 KiB → 413 (unbounded-work guard)", async () => {
    // fetch sets content-length for a fixed-size string body, so this exercises the
    // pre-parse size gate. 262144-byte cap; this body is comfortably over it.
    const res = await createRaw(`{"pad":"${"x".repeat(262_200)}"}`);
    expect(res.status).toBe(413);
    const json = (await res.json()) as { field: string };
    expect(json.field).toBe("body");
  });

  test("boundary accept: the full defaultConfig supplied explicitly → 200", async () => {
    // Exercises every RuleConfig key through the per-key gates (numerics, booleans,
    // killBounty, combatTable) with known-legal values.
    const res = await create(validBody({ config: defaultConfig() }));
    expect(res.status).toBe(200);
  });

  test("boundary accept: extreme-but-legal custom config → 200", async () => {
    const res = await create(
      validBody({
        config: {
          radius: 7,
          baseLimit: 1,
          victoryThreshold: 1,
          combatTable: { 3: 0, 4: 0.5, 5: 1, 6: 1 }, // probabilities at both ends of [0,1]
        },
      }),
    );
    expect(res.status).toBe(200);
  });

  test("boundary accept: a fixed def at exactly the hex cap → 200", async () => {
    // lineHexes centers on the origin, so all coords stay far inside the coord bound.
    const hexes = lineHexes(MAX_FIXED_HEXES);
    const res = await create(
      validBody({ boardSource: { kind: "fixed", def: { hexes, iron: [hexes[0]] } } }),
    );
    expect(res.status).toBe(200);
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
