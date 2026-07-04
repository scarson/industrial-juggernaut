// ABOUTME: The canonical no-mock live E2E — hits the REAL staging Worker + DO: createRoom (1 human +
// ABOUTME: agents), opens a real WebSocket, handshakes, and plays one scripted first-base placement.
//
// HOW TO RUN (from the repo root):
//   bun web/scripts/staging-e2e.ts
//   bun web/scripts/staging-e2e.ts --host https://<other-worker>.workers.dev   # override the target
//
// It uses the REAL global fetch + WebSocket (Bun provides both). It is deliberately NOT a *.test.ts file,
// so the fast offline `test:client` suite (which must stay deterministic and network-free) never runs it.
// A transient staging outage is reported as an INFRA failure (exit 2), distinct from an ASSERTION failure
// (exit 1) — a red assertion is a real regression; an INFRA red is "staging was unreachable, re-run".
import { createRoom } from "../src/game/rooms";
import { PROTOCOL_VERSION } from "../../src/wire/protocol";
import { REPLAY_VERSION } from "../../src/host/version";
import { decodeState } from "../../src/wire/codec";
import { defaultConfig, legalFirstBaseHexes } from "../../src/index";
import type { CreateRoomRequest } from "../src/game/rooms";
import type { ClientCommand, ServerMessage } from "../../src/wire/protocol";

const DEFAULT_HOST = "https://industrial-juggernaut-staging.samuel-carson.workers.dev";
const CONNECT_TIMEOUT_MS = 15_000;
const MESSAGE_TIMEOUT_MS = 15_000;

/** Parse `--host <url>` from argv; default to the staging Worker. */
function targetHost(): string {
  const i = process.argv.indexOf("--host");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : DEFAULT_HOST;
}

/**
 * `createRoom` POSTs the RELATIVE path `/api/games` (in the browser it resolves against the page origin).
 * A bun script has no page origin, so wrap the global fetch to prefix a root-relative path with the
 * staging host — exercising `createRoom`'s real POST logic verbatim, only supplying the missing origin.
 */
function hostPrefixedFetch(host: string): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => {
    const path = String(input);
    const url = path.startsWith("/") ? `${host}${path}` : path;
    return fetch(url, init);
  }) as typeof fetch;
}

/** An assertion failure — a real regression (exit 1). */
class AssertionError extends Error {}
/** An infrastructure failure — staging unreachable/transient (exit 2), NOT a regression. */
class InfraError extends Error {}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new AssertionError(message);
}

/**
 * Redact a seat-token array for logging: a token is a LIVE bearer credential (it authenticates a WebSocket
 * to a human seat until the room expires), so its VALUE must never reach stdout (a CI/shared-terminal log)
 * — only its presence and length, enough to prove the host minted the right shape. Each element becomes a
 * `<N-char token>` marker for a string or `null` for an agent seat (the host mints tokens for human seats
 * only), so a reader sees `[<26-char token>, null]` instead of the credential itself.
 */
function redactSeatTokens(seatTokens: readonly (string | null)[]): string {
  const marks = seatTokens.map((t) => (t === null ? "null" : `<${String(t.length)}-char token>`));
  return `[${marks.join(", ")}]`;
}

/**
 * Strip any `token=<value>` occurrence from a string before it is logged — defense in depth for the ONE
 * catch-all (`UNEXPECTED`) that prints a raw error stack. No normal path routes the ws URL into an error,
 * but a stack from an unforeseen throw could carry `?token=…`; this rewrites the value to `token=<redacted>`
 * so the credential can never reach the log even through a path this script did not anticipate.
 */
function stripToken(text: string): string {
  return text.replace(/token=[^&\s"')]+/gi, "token=<redacted>");
}

/** The ws(s) URL for a room+seat+token (token URL-encoded, exactly as the SocketDriver builds it). */
function wsUrl(host: string, roomId: string, seat: number, token: string): string {
  const scheme = host.startsWith("https:") ? "wss:" : "ws:";
  const origin = host.replace(/^https?:/, scheme);
  return `${origin}/api/games/${roomId}/ws?seat=${seat}&token=${encodeURIComponent(token)}`;
}

/**
 * Open the socket and collect ServerMessages, driving the handshake + one placeFirstBase. Resolves with
 * a transcript of every ServerMessage received, or rejects (Infra on connect/transport failure).
 */
async function playOneRound(url: string): Promise<ServerMessage[]> {
  return new Promise<ServerMessage[]>((resolve, reject) => {
    const transcript: ServerMessage[] = [];
    // `url` carries `?token=<seat token>`. A malformed URL makes the WebSocket constructor throw a
    // SyntaxError whose message/stack embeds the whole URL — the token with it. Catch that here and reject
    // with a token-FREE message so the credential can never reach the error log (it never leaves this scope).
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      reject(new InfraError(`could not open the socket: ${(err as Error).name}`));
      return;
    }

    let placed = false;
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(messageTimer);
      try {
        ws.close();
      } catch {
        // best-effort close; already-closed sockets throw nothing meaningful here
      }
      fn();
    };

    const connectTimer = setTimeout(
      () => done(() => reject(new InfraError(`no socket open within ${CONNECT_TIMEOUT_MS}ms`))),
      CONNECT_TIMEOUT_MS,
    );
    let messageTimer: ReturnType<typeof setTimeout> = setTimeout(() => {}, 0);
    clearTimeout(messageTimer);
    const armMessageTimer = () => {
      clearTimeout(messageTimer);
      messageTimer = setTimeout(
        () => done(() => reject(new InfraError(`no expected server message within ${MESSAGE_TIMEOUT_MS}ms`))),
        MESSAGE_TIMEOUT_MS,
      );
    };

    const send = (cmd: ClientCommand) => ws.send(JSON.stringify(cmd));

    ws.onopen = () => {
      clearTimeout(connectTimer);
      armMessageTimer();
      // The handshake, exactly as the SocketDriver does it: hello (the initial-sync trigger) then claimSeat.
      send({ type: "hello", protocolVersion: PROTOCOL_VERSION, replayVersion: REPLAY_VERSION });
      send({ type: "claimSeat", requestId: crypto.randomUUID(), seat: 0 });
    };

    ws.onmessage = (event: MessageEvent) => {
      const data = event.data;
      if (typeof data !== "string" || data === "pong") return; // ignore keepalive answers / binary
      let msg: ServerMessage;
      try {
        msg = JSON.parse(data) as ServerMessage;
      } catch {
        return; // the server never sends malformed frames; ignore rather than fail the pump
      }
      transcript.push(msg);
      armMessageTimer();

      // The hello reply IS the initial sync (a `resync`). Decode it, compute a legal first-base hex, and
      // submit placeFirstBase stamped with the resync's logLength as expectedLogIndex — one scripted move.
      if (msg.type === "resync" && !placed) {
        placed = true;
        const state = decodeState(msg.snapshot);
        const legal = legalFirstBaseHexes(state);
        if (legal.length === 0) {
          done(() => reject(new AssertionError("resync carried no legal first-base hexes")));
          return;
        }
        send({ type: "placeFirstBase", expectedLogIndex: msg.logLength, hex: legal[0]! });
        return;
      }

      // The scripted move's authoritative result: an `applied` for our placement (logIndex 0). Getting it
      // back over the real socket proves the create→connect→handshake→command→apply round trip end to end.
      if (msg.type === "applied") {
        done(() => resolve(transcript));
      }
    };

    ws.onerror = () => {
      // A WebSocket error is followed by close; treat it as an infra/transport failure if nothing resolved.
      done(() => reject(new InfraError("websocket error before the round completed")));
    };

    ws.onclose = () => {
      done(() => reject(new InfraError("socket closed before an applied event arrived")));
    };
  });
}

async function main(): Promise<void> {
  const host = targetHost();
  console.log(`staging-e2e: target ${host}`);

  // 1 human (the creator) + 1 heuristic agent — the Phase-1 online roster.
  const request: CreateRoomRequest = {
    seats: [{ kind: "human" }, { kind: "agent", agent: "heuristic" }],
    config: defaultConfig(),
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    seed: "424242",
  };

  let created;
  try {
    created = await createRoom(request, hostPrefixedFetch(host));
  } catch (err) {
    // A create failure could be a real 400 (assertion) or a network/5xx outage (infra). createRoom throws
    // CreateRoomError with a status; a 4xx is our bug, a 5xx / network throw is infra.
    const status = (err as { status?: number }).status;
    if (typeof status === "number" && status >= 400 && status < 500) {
      throw new AssertionError(`createRoom rejected with ${status}: ${(err as Error).message}`);
    }
    throw new InfraError(`createRoom failed: ${(err as Error).message}`);
  }

  console.log(`staging-e2e: created room ${created.roomId}, seatTokens=${redactSeatTokens(created.seatTokens)}`);
  assert(typeof created.roomId === "string" && created.roomId.length > 0, "roomId must be a non-empty string");
  assert(Array.isArray(created.seatTokens) && created.seatTokens.length === 2, "expected 2 seat tokens");
  const token = created.seatTokens[0];
  assert(typeof token === "string" && token.length > 0, "human seat 0 must have a token");
  assert(created.seatTokens[1] === null, "agent seat 1 must have a null token");

  const transcript = await playOneRound(wsUrl(host, created.roomId, 0, token));

  const kinds = transcript.map((m) => m.type);
  console.log(`staging-e2e: server messages = [${kinds.join(", ")}]`);
  assert(kinds.includes("resync"), "expected an initial resync (the hello reply)");
  assert(kinds.includes("applied"), "expected an applied event for the first-base placement");
  const applied = transcript.find((m) => m.type === "applied");
  assert(applied && applied.type === "applied" && applied.logIndex === 0, "the placement should apply at logIndex 0");

  console.log("staging-e2e: PASS — create → connect → handshake → placeFirstBase → applied round-trip verified");
}

main().catch((err: unknown) => {
  if (err instanceof AssertionError) {
    console.error(`staging-e2e: ASSERTION FAILED — ${err.message}`);
    process.exit(1);
  }
  if (err instanceof InfraError) {
    console.error(`staging-e2e: INFRA (staging unreachable/transient) — ${err.message}`);
    process.exit(2);
  }
  console.error(`staging-e2e: UNEXPECTED — ${stripToken((err as Error).stack ?? String(err))}`);
  process.exit(3);
});
