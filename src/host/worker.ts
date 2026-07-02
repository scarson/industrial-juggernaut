// ABOUTME: The host Worker fetch handler — room creation (POST /api/games) + WS-upgrade routing to the GameRoom DO.
// ABOUTME: Untrusted-body validation lives in room-create.ts; the GameRoom DO (game-room.ts) owns storage + the critical section.

import { newRoomId, newSeatToken, tokenDigest } from "./ids";
import { REPLAY_VERSION } from "./version";
import { CreateBodyError, validateCreateBody } from "./room-create";
import type { SessionHeader } from "../session";

/** The bindings this Worker + DO use (mirrors wrangler.jsonc). */
interface Env {
  GAME_ROOM: DurableObjectNamespace;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function isWebSocketUpgrade(request: Request): boolean {
  return (request.headers.get("Upgrade") ?? "").toLowerCase() === "websocket";
}

/**
 * POST /api/games — the designer instrument. Validates the untrusted body, HOST-STAMPS
 * the format/replay versions (never from the client), mints seat tokens for HUMAN seats
 * only (the agent-seat auth resolution: an agent seat has no capability to leak), inits
 * the room's DO, and returns `{ roomId, seatTokens }`.
 */
// Create-body byte cap. JSON.parse work scales with input size, so an uncapped body is
// unbounded work on an unauthenticated endpoint — this is the input-surface guard the
// create route needs on its own; the Phase-2 abuse floor adds rate-limiting on top.
// 256 KiB is ~7x the largest legitimate body (a MAX_FIXED_HEXES fixed def is ~36 KiB).
const MAX_BODY_BYTES = 262144;

async function handleCreate(request: Request, env: Env): Promise<Response> {
  // Declared-size gate first (rejects before reading), then an actual-size gate after
  // reading (covers chunked/undeclared-length bodies). text.length counts UTF-16 code
  // units, which never exceeds the UTF-8 byte count — so this bounds parse work within
  // a small constant factor of the cap.
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return jsonResponse({ error: "request body too large", field: "body" }, 413);
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return jsonResponse({ error: "request body too large", field: "body" }, 413);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return jsonResponse({ error: "malformed JSON body", field: "body" }, 400);
  }

  let spec;
  try {
    spec = validateCreateBody(raw);
  } catch (e) {
    if (e instanceof CreateBodyError) {
      return jsonResponse({ error: e.message, field: e.field }, 400);
    }
    throw e;
  }

  // Host stamps the versions — the client CANNOT influence replay/format compatibility.
  const header: SessionHeader = {
    formatVersion: 1,
    replayVersion: REPLAY_VERSION,
    // JSON can't carry a bigint; the header seed rides as the decimal STRING and the DO
    // re-parses it with BigInt() at init. (SessionHeader.seed is typed bigint in-memory,
    // so we carry the string in the init payload below, not on this typed value.)
    seed: BigInt(spec.seed),
    config: spec.config,
    boardSource: spec.boardSource,
    seats: spec.seats,
  };

  const roomId = newRoomId();

  // Mint tokens for HUMAN seats ONLY (binding auth resolution). Agent seats → null token
  // and null digest: no capability exists for an agent seat, so none can leak.
  const seatTokens: (string | null)[] = spec.seats.map((s) => (s.kind === "human" ? newSeatToken() : null));
  const authorizedDigests: (string | null)[] = await Promise.all(
    seatTokens.map((t) => (t === null ? Promise.resolve(null) : tokenDigest(t))),
  );

  // Init the room's DO. The seed rides as a decimal STRING (JSON can't carry bigints);
  // the DO re-parses it with BigInt() at init.
  const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(roomId));
  const initPayload = {
    header: { ...header, seed: spec.seed },
    roomOptions: spec.roomOptions,
    authorizedDigests,
  };
  const initRes = await stub.fetch("https://do.internal/init", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(initPayload),
  });
  // Init must succeed before tokens go out: an uninitialized room rejects joins, so a
  // 200-with-tokens for a failed init would strand the creator with dead capabilities.
  if (!initRes.ok) {
    return jsonResponse({ error: "room init failed" }, 500);
  }

  return jsonResponse({ roomId, seatTokens }, 200);
}

/**
 * GET /api/games/:id/ws — forward the WHOLE request to the room's DO stub, which owns the
 * WebSocketPair + per-seat token auth (B4/B6.2). Non-upgrade → 426. The seat token rides
 * as a query param (browsers can't set WS request headers); NEVER log the query string
 * (DO-AUTH-1).
 */
function handleWsUpgrade(request: Request, env: Env, roomId: string): Response | Promise<Response> {
  if (!isWebSocketUpgrade(request)) {
    return new Response("expected a websocket upgrade", { status: 426 });
  }
  const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(roomId));
  return stub.fetch(request);
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;

  if (path === "/api/games") {
    if (request.method !== "POST") {
      return jsonResponse({ error: "method not allowed", field: "method" }, 405);
    }
    return handleCreate(request, env);
  }

  // /api/games/:id/ws
  const wsMatch = /^\/api\/games\/([^/]+)\/ws$/.exec(path);
  if (wsMatch) {
    return handleWsUpgrade(request, env, wsMatch[1]!);
  }

  return jsonResponse({ error: "not found", field: "path" }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // Assets/SPA paths are served by the ASSETS binding via run_worker_first=["/api/*"];
    // this handler only ever sees /api/* requests.
    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, url);
    }
    return jsonResponse({ error: "not found", field: "path" }, 404);
  },
} satisfies ExportedHandler<Env>;

// The GameRoom Durable Object (storage layout + critical section) lives in game-room.ts; the
// wrangler binding resolves the class by this named export from the Worker entry module.
export { GameRoom } from "./game-room";
