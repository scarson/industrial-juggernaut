// ABOUTME: Public API barrel for the rules engine — the surface a Worker/client imports.
// ABOUTME: Re-exports only; value exports must never pull in src/agent or src/driver.

export { initGame } from "./engine/init";
export { setupGame, currentPlayer, advanceRound, representativeFirstBase, placeFirstBase, legalFirstBaseHexes } from "./engine/turn";
export { applyAction } from "./engine/apply";
export { stepRound } from "./engine/round";
export { legalActions, representativeDefender } from "./engine/legal";
export { buildBudget } from "./engine/build";
export { status, applyEliminations } from "./engine/status";
export { removeEncircledStrandedBases, strandedBases } from "./engine/stranded";
export { control } from "./engine/control";
export type { Control } from "./engine/control";
export { generateBoard } from "./board/generate";
export { loadBoard } from "./board/load";
export { seed, nextUint32, nextFloat } from "./rng/pcg";
export { encodeRng, decodeRng } from "./rng/codec";
export { defaultConfig } from "./engine/config";
export type { RuleConfig, KillBounty } from "./engine/config";
export type {
  Hex, PlayerId, PieceKind, BaseState, Base, Factory, Board, BoardDefinition, BoardSource,
  Player, Phase, GameState, Action, AttackDecl, GameEvent, EliminationCause, RngState,
} from "./engine/types";
export type { EncodedRng } from "./rng/codec";
