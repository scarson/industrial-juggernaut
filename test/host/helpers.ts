// ABOUTME: Shared integration toolkit for the DO-host end-to-end matrix — real Worker create + authenticated WS
// ABOUTME: upgrade, deterministic send/collect over a bounded timeout, and stub/eviction helpers keyed to the wire.
import { expect } from "vitest";
import { SELF, env } from "cloudflare:test";
import type { GameRoom } from "../../src/host/game-room";
import type { ClientCommand, ServerMessage } from "../../src/wire/protocol";

/** A create-flow seat spec (mirrors src/host/room-create's CreateSeat). Human seats mint a token; agent seats null. */
export type SeatSpec = { kind: "human" } | { kind: "agent"; agent: string; archetype?: string };

/** The POST /api/games body the Worker create flow accepts (see test/host/worker.test.ts:validBody). */
export type CreateSpec = {
  seats?: SeatSpec[];
  boardSource?: unknown;
  seed?: string;
  config?: Record<string, unknown>;
  roomOptions?: { defenderTimeout: { enabled: boolean; seconds: number } };
};

/** The parsed create response: the 20-char room id + one token per seat (human → 26-char token, agent → null). */
export type CreatedRoom = { roomId: string; seatTokens: (string | null)[] };

/** A default 2-human room on a generated board — the common integration substrate. Override any field via `spec`. */
function createBody(spec: CreateSpec): Record<string, unknown> {
  return {
    seats: spec.seats ?? [{ kind: "human" }, { kind: "human" }],
    boardSource: spec.boardSource ?? { kind: "generate", size: 96, ironCount: 14 },
    seed: spec.seed ?? "12345678901234567890",
    ...(spec.config !== undefined ? { config: spec.config } : {}),
    ...(spec.roomOptions !== undefined ? { roomOptions: spec.roomOptions } : {}),
  };
}

/**
 * Create a room through the REAL Worker create flow (POST /api/games via SELF.fetch) and return the parsed
 * `{ roomId, seatTokens }`. This exercises the full create path — room-create validation, id minting, DO /init,
 * per-seat human-token minting — so every downstream socket authenticates against a genuinely-minted token.
 */
export async function createRoom(spec: CreateSpec = {}): Promise<CreatedRoom> {
  const res = await SELF.fetch("https://host.test/api/games", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(createBody(spec)),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as CreatedRoom;
}

/** The DurableObjectStub for a room (for evict / runDurableObjectAlarm / runInDurableObject). idFromName(roomId). */
export function stubFor(roomId: string): DurableObjectStub<GameRoom> {
  return env.GAME_ROOM.get(env.GAME_ROOM.idFromName(roomId)) as DurableObjectStub<GameRoom>;
}

/**
 * Open an authenticated, hibernatable WebSocket to a seat through the real Worker WS route
 * (GET /api/games/:id/ws?seat=N&token=...). The upgrade forwards to the room's DO, which authenticates the token
 * against the seat's digest and mints a `seat:<n>`-tagged hibernatable socket. The returned CLIENT socket is
 * accepted and ready to send/receive, and SURVIVES `evictDurableObject(stub, { webSockets: "hibernate" })`.
 */
export async function openSocket(roomId: string, seat: number, token: string): Promise<WebSocket> {
  const res = await SELF.fetch(
    `https://host.test/api/games/${roomId}/ws?seat=${seat}&token=${encodeURIComponent(token)}`,
    { headers: { Upgrade: "websocket" } },
  );
  expect(res.status).toBe(101);
  const socket = res.webSocket;
  if (!socket) throw new Error(`expected a WebSocket on the 101 upgrade for seat ${seat}`);
  socket.accept();
  return socket;
}

/**
 * Attempt a WS upgrade that is expected to FAIL auth (wrong / absent token, or an agent seat). Returns the
 * Response so the caller can assert the exact status (403) and that NO socket was handed back.
 */
export async function openSocketExpectingReject(
  roomId: string,
  seat: number,
  token: string | null,
): Promise<Response> {
  const query = token === null ? `seat=${seat}` : `seat=${seat}&token=${encodeURIComponent(token)}`;
  return SELF.fetch(`https://host.test/api/games/${roomId}/ws?${query}`, {
    headers: { Upgrade: "websocket" },
  });
}

/** Send a typed ClientCommand over a client socket (JSON-encoded). */
export function send(ws: WebSocket, command: ClientCommand): void {
  ws.send(JSON.stringify(command));
}

/**
 * Collect messages from a client socket until either `count` messages arrive OR a predicate matches, then resolve
 * with everything collected so far (inclusive of the matching message). Rejects if `timeoutMs` elapses first — so
 * a scenario that never produces the awaited message FAILS LOUD rather than hanging. The pool controls the DO, so
 * every awaited message is produced by an explicit command/evict/alarm the test already issued; this timeout is a
 * safety net for a genuine integration break, never a substitute for synchronization.
 *
 * `until` is either a message count (collect exactly N) or a predicate on each parsed message (collect until it
 * returns true). Attach the listener BEFORE the command that triggers the messages to avoid a race.
 */
export function collect(
  ws: WebSocket,
  until: number | ((msg: ServerMessage) => boolean),
  timeoutMs = 5_000,
): Promise<ServerMessage[]> {
  const got: ServerMessage[] = [];
  const done = (msg: ServerMessage): boolean =>
    typeof until === "number" ? got.length >= until : until(msg);
  return new Promise<ServerMessage[]>((resolve, reject) => {
    if (typeof until === "number" && until === 0) {
      resolve(got);
      return;
    }
    const timer = setTimeout(() => {
      ws.removeEventListener("message", onMessage);
      reject(
        new Error(
          `collect timed out after ${timeoutMs}ms with ${got.length} message(s): ` +
            `[${got.map((m) => m.type).join(", ")}]`,
        ),
      );
    }, timeoutMs);
    function onMessage(event: MessageEvent): void {
      const msg = JSON.parse(event.data as string) as ServerMessage;
      got.push(msg);
      if (done(msg)) {
        clearTimeout(timer);
        ws.removeEventListener("message", onMessage);
        resolve(got);
      }
    }
    ws.addEventListener("message", onMessage);
  });
}

/** Send a command and collect the first message matching `until` (default: the first message of any kind). */
export async function sendAndCollect(
  ws: WebSocket,
  command: ClientCommand,
  until: number | ((msg: ServerMessage) => boolean) = 1,
  timeoutMs = 5_000,
): Promise<ServerMessage[]> {
  const collected = collect(ws, until, timeoutMs);
  send(ws, command);
  return collected;
}

/** Assert a client socket receives NOTHING within `windowMs` (a bounded negative assertion). Resolves either way. */
export function expectNoMessage(ws: WebSocket, windowMs = 250): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let received = false;
    const onMessage = (): void => {
      received = true;
    };
    ws.addEventListener("message", onMessage);
    setTimeout(() => {
      ws.removeEventListener("message", onMessage);
      resolve(received);
    }, windowMs);
  });
}
