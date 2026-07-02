// ABOUTME: The host Worker fetch handler — room creation (POST /api/games) + WS-upgrade routing to the GameRoom DO.
// ABOUTME: Untrusted-body validation lives in room-create.ts; GameRoom is a B2 stub the DO phase (B3) fills in.

import { DurableObject } from "cloudflare:workers";
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
async function handleCreate(request: Request, env: Env): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
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
  // B3 implements /init and this returns 2xx; until then the stub 501s. The create
  // flow's contract is exercised end-to-end in B3/B7, so a non-2xx here is expected
  // and ignored (the room is addressable by roomId regardless).
  await stub.fetch("https://do.internal/init", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(initPayload),
  });

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

/**
 * B2 stub. B3 fills this in with the real storage layout, critical section, hibernation,
 * and per-seat auth. For now it exists so the Worker compiles and `wrangler deploy
 * --dry-run` passes its entry check; every request returns 501.
 */
export class GameRoom extends DurableObject {
  override fetch(_request: Request): Response {
    return new Response("GameRoom not implemented until B3", { status: 501 });
  }
}
