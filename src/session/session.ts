// ABOUTME: The interactive GameSession reducer core — openSession, applyCommand (A3), resyncPayload (A6).
// ABOUTME: Pure: every state-changing call returns { next, effects }; the host performs the effects.
import { initGame } from "../engine/init";
import type { SessionHeader } from "./types";
import type { RoomOptions } from "../wire/protocol";
import type { SessionState } from "./session-types";

export function openSession(header: SessionHeader, roomOptions: RoomOptions): SessionState {
  const game = initGame({
    seed: header.seed, boardSource: header.boardSource,
    nPlayers: header.seats.length, config: header.config,
  });
  return {
    header, roomOptions, game, logLength: 0, pending: null, chainAttacker: null,
    seats: header.seats.map((config, seat) => ({ seat, config, authorizedDigest: null, claimed: false, lastRequestId: null })),
  };
}
