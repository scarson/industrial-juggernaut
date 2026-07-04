// ABOUTME: Pins createRoom — the POST /api/games create call — against an injected fetch: the exact
// ABOUTME: designer-config body (no version fields), the 200 parse, and the typed error on a 400.
import { describe, expect, test } from "vitest";
import { CreateRoomError, createRoom } from "./rooms";
import type { CreateRoomRequest } from "./rooms";
import { defaultConfig } from "../engine-client/barrel";

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────────
/** A one-human-plus-agents request — the Phase-1 online roster. `seed` is the DECIMAL STRING the
 *  host re-parses with BigInt(); `config`/`boardSource`/`seats`/`roomOptions` match validateCreateBody. */
function request(): CreateRoomRequest {
  return {
    seats: [{ kind: "human" }, { kind: "agent", agent: "heuristic" }],
    config: defaultConfig(),
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    seed: "42",
    roomOptions: { defenderTimeout: { enabled: false, seconds: 120 } },
  };
}

/** A fetch stub returning `body` with `status`. Records the single call's url + init for assertions. */
function stubFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

describe("createRoom", () => {
  test("POSTs /api/games with EXACTLY the designer config (no version fields, seed as string)", async () => {
    const { fetchFn, calls } = stubFetch(200, { roomId: "room-1", seatTokens: ["tok-0", null] });

    await createRoom(request(), fetchFn);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/games");
    const init = calls[0]!.init!;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");

    const sent = JSON.parse(init.body as string);
    // EXACTLY the allowed create-body keys — no formatVersion/replayVersion (the host stamps them;
    // sending an unknown top-level key is a 400 from validateCreateBody).
    expect(Object.keys(sent).sort()).toEqual(["boardSource", "config", "roomOptions", "seats", "seed"]);
    expect(sent).not.toHaveProperty("formatVersion");
    expect(sent).not.toHaveProperty("replayVersion");
    // seed rides as the decimal STRING (JSON can't carry a bigint).
    expect(sent.seed).toBe("42");
    expect(typeof sent.seed).toBe("string");
    expect(sent.seats).toEqual([{ kind: "human" }, { kind: "agent", agent: "heuristic" }]);
    expect(sent.boardSource).toEqual({ kind: "generate", size: 96, ironCount: 14 });
    expect(sent.roomOptions).toEqual({ defenderTimeout: { enabled: false, seconds: 120 } });
  });

  test("omits roomOptions from the body when the request doesn't set it (host defaults it)", async () => {
    const { fetchFn, calls } = stubFetch(200, { roomId: "room-1", seatTokens: ["tok-0", null] });
    const req = request();
    delete req.roomOptions;

    await createRoom(req, fetchFn);

    const sent = JSON.parse(calls[0]!.init!.body as string);
    // roomOptions is optional in validateCreateBody (omitted → DEFAULT_ROOM_OPTIONS). Omitting the key
    // is correct — it must NOT be sent as undefined (JSON.stringify drops it) nor as an empty object.
    expect(Object.keys(sent).sort()).toEqual(["boardSource", "config", "seats", "seed"]);
  });

  test("parses the 200 { roomId, seatTokens } response", async () => {
    const { fetchFn } = stubFetch(200, { roomId: "room-xyz", seatTokens: ["tok-human", null] });

    const result = await createRoom(request(), fetchFn);

    expect(result).toEqual({ roomId: "room-xyz", seatTokens: ["tok-human", null] });
  });

  test("throws a typed CreateRoomError carrying the host's message + field on a 400", async () => {
    const { fetchFn } = stubFetch(400, { error: 'unknown top-level key "formatVersion"', field: "formatVersion" });

    await expect(createRoom(request(), fetchFn)).rejects.toThrow(CreateRoomError);
    await expect(createRoom(request(), fetchFn)).rejects.toMatchObject({
      message: 'unknown top-level key "formatVersion"',
      field: "formatVersion",
      status: 400,
    });
  });

  test("throws a typed CreateRoomError with a fallback message on a non-2xx with no JSON body", async () => {
    // A 500 "room init failed" carries { error } with no field; an opaque 5xx may not even be JSON.
    const fetchFn = (async () => ({
      ok: false,
      status: 500,
      json: async () => {
        throw new SyntaxError("Unexpected end of JSON input");
      },
    } as unknown as Response)) as unknown as typeof fetch;

    const err = await createRoom(request(), fetchFn).catch((e) => e);
    expect(err).toBeInstanceOf(CreateRoomError);
    expect((err as CreateRoomError).status).toBe(500);
    expect((err as CreateRoomError).field).toBeNull();
    expect((err as CreateRoomError).message).toMatch(/create.*failed|500/i);
  });

  // The 200 body is an UNTRUSTED boundary — validate its shape before returning (same class + precedent
  // as P3's validateBoardSource). A malformed 200 must land in the SAME catch path as a non-2xx (a typed
  // CreateRoomError surfaced on the designer), never a corrupt token / undefined roomId that strands the
  // UI in an unrecoverable "Loading game…".
  test("throws when seatTokens is a bare string (JS string-indexing would forge per-seat tokens)", async () => {
    // seatTokens "tok" → seatTokens[0] === "t" passes a naive `!= null` guard → doomed PlayView.
    const { fetchFn } = stubFetch(200, { roomId: "room-1", seatTokens: "tok" });

    const err = await createRoom(request(), fetchFn).catch((e) => e);
    expect(err).toBeInstanceOf(CreateRoomError);
    expect((err as CreateRoomError).message).toMatch(/malformed room-creation response/i);
    expect((err as CreateRoomError).status).toBe(200);
  });

  test("throws when roomId is missing/non-string (would connect to /api/games/undefined/ws)", async () => {
    const { fetchFn } = stubFetch(200, { seatTokens: ["tok-0", null] });

    const err = await createRoom(request(), fetchFn).catch((e) => e);
    expect(err).toBeInstanceOf(CreateRoomError);
    expect((err as CreateRoomError).message).toMatch(/malformed room-creation response/i);
  });

  test("throws when a seatTokens element is neither string nor null", async () => {
    const { fetchFn } = stubFetch(200, { roomId: "room-1", seatTokens: ["tok-0", 42] });

    await expect(createRoom(request(), fetchFn)).rejects.toThrow(/malformed room-creation response/i);
  });

  test("returns the parsed result for a well-shaped 200 body (happy path unchanged)", async () => {
    const { fetchFn } = stubFetch(200, { roomId: "room-ok", seatTokens: ["tok-human", null] });

    await expect(createRoom(request(), fetchFn)).resolves.toEqual({
      roomId: "room-ok",
      seatTokens: ["tok-human", null],
    });
  });
});
