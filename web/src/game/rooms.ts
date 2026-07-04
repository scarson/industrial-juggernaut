// ABOUTME: createRoom — POST /api/games with the designer-instrument config (NOT a SessionRecord). The
// ABOUTME: host validates the body as untrusted + stamps the versions; this returns { roomId, seatTokens }.
import type { BoardSource, RuleConfig, SeatConfig } from "../engine-client/barrel";
import type { RoomOptions } from "../../../src/wire/protocol";

/**
 * The create-room body the client POSTs — the designer instrument's raw config, matching the host's
 * `validateCreateBody` accepted shape (src/host/room-create.ts). It carries ONLY the client-controllable
 * keys: `seats`, `config`, `boardSource`, `seed` (the DECIMAL STRING, since JSON can't carry a bigint),
 * and an optional `roomOptions` (omitted → the host defaults it). It deliberately does NOT carry
 * `formatVersion`/`replayVersion` — the host stamps those, and sending one is an unknown-top-level-key 400.
 */
export type CreateRoomRequest = {
  seats: SeatConfig[];
  config: RuleConfig;
  boardSource: BoardSource;
  seed: string;
  roomOptions?: RoomOptions;
};

/** The 200 response: the room id + the per-seat tokens (index-aligned with `seats`; human seats get a
 *  token, agent seats get null — the host mints tokens for human seats only). */
export type CreateRoomResult = {
  roomId: string;
  seatTokens: (string | null)[];
};

/**
 * A create-room failure carrying the host's 400 `{ error, field }` (or a synthesized message for a
 * non-2xx with no readable JSON body). The `field` mirrors `CreateBodyError.field` so the UI can point
 * at the offending designer control; it is null when the response carried no field.
 */
export class CreateRoomError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly field: string | null,
  ) {
    super(message);
    this.name = "CreateRoomError";
  }
}

/**
 * Create a room from the designer config. POSTs the {@link CreateRoomRequest} to `/api/games` (the host
 * validates it as untrusted and stamps the versions), and returns the `{ roomId, seatTokens }` the
 * SocketDriver connects with. On any non-2xx it throws a {@link CreateRoomError} carrying the host's
 * `error`/`field` so the caller can surface a friendly, field-anchored message.
 *
 * `fetchFn` is injected (the sanctioned boundary) so tests never touch the network; production passes
 * the global `fetch`.
 */
export async function createRoom(req: CreateRoomRequest, fetchFn: typeof fetch): Promise<CreateRoomResult> {
  // Build the body from the EXACT allowed keys. `roomOptions` is spread conditionally so an unset value
  // is OMITTED (not sent as `undefined`, which JSON.stringify would drop anyway, nor as an empty object).
  const body: CreateRoomRequest = {
    seats: req.seats,
    config: req.config,
    boardSource: req.boardSource,
    seed: req.seed,
    ...(req.roomOptions !== undefined ? { roomOptions: req.roomOptions } : {}),
  };

  const response = await fetchFn("/api/games", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw await createErrorFrom(response);
  }

  return (await response.json()) as CreateRoomResult;
}

/** Read a non-2xx response into a {@link CreateRoomError}, tolerating a missing/non-JSON error body. */
async function createErrorFrom(response: Response): Promise<CreateRoomError> {
  let error: unknown;
  try {
    error = await response.json();
  } catch {
    // A 5xx / opaque failure may not carry a JSON body — fall back to a status-anchored message.
    return new CreateRoomError(`create room failed (HTTP ${response.status})`, response.status, null);
  }
  const record = typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
  const message = typeof record.error === "string" ? record.error : `create room failed (HTTP ${response.status})`;
  const field = typeof record.field === "string" ? record.field : null;
  return new CreateRoomError(message, response.status, field);
}
