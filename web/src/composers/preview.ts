// ABOUTME: Deterministic optimistic preview — computes what a DriverCommand WOULD do to the
// ABOUTME: authoritative state, without ever consuming RNG (an attack shows odds, not an outcome).
import { applyAction, placeFirstBase } from "../engine-client/barrel";
import type { GameState, PlayerId } from "../engine-client/barrel";
import type { DriverCommand } from "../game/driver";

/**
 * Preview a command's effect on `state` for the acting `player`. Pure — no store, no React, no
 * I/O. Callers (composers) must only preview a command that is currently legal for `player`
 * (gated upstream by highlightSets/legalActions); previewCommand does not catch or soften engine
 * throws on an illegal command, since that would hide a composer bug behind a swallowed error.
 *
 * `build` and `placeFirstBase` compute a real preview state — placement is not an engine `Action`
 * (`Action = build | attack | pass`), so it routes through `placeFirstBase` directly rather than
 * `applyAction`. `attack` NEVER pre-resolves combat: the authoritative draw belongs to the
 * reducer/server, and a locally-computed outcome could diverge from it (decision #6/G1). The
 * attack preview instead returns `state` unchanged plus `{combat: true}`, so the composer (P3.5)
 * shows the configured odds instead of a result. `endRound`/`resolveDecision`/`extendDecision`
 * carry no local preview and also return `state` unchanged.
 */
export function previewCommand(
  state: GameState,
  player: PlayerId,
  cmd: DriverCommand,
): { state: GameState; combat?: true } {
  switch (cmd.type) {
    case "build":
      return { state: applyAction(state, { kind: "build", pieces: cmd.pieces }).state };
    case "pass":
      return { state: applyAction(state, { kind: "pass" }).state };
    case "placeFirstBase":
      return { state: placeFirstBase(state, player, cmd.hex) };
    case "attack":
      return { state, combat: true };
    case "endRound":
    case "resolveDecision":
    case "extendDecision":
      return { state };
  }
}
