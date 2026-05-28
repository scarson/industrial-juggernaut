// ABOUTME: Core data-model type declarations for the Industrial Juggernaut rules engine.
// ABOUTME: Transcribed from the M1 design spec §4; declarations only, no runtime logic.

import type { RuleConfig } from "./config";
import type { RngState } from "../rng/pcg";

export type { RngState };

export type Hex = { x: number; y: number; z: number }; // invariant x+y+z=0

export type PlayerId = number; // 0..5
export type PieceKind = "factory" | "base";
export type BaseState = "fresh" | "fatigued";

export type Base = { owner: PlayerId; hex: Hex; state: BaseState; order: number };
// `order` = placement sequence; base with min order is the player's "first/oldest"
export type Factory = { hex: Hex }; // factories are unowned board state

export type Board = {
  hexes: Hex[]; // the oval landmass
  iron: Hex[]; // subset, 14 by default
};

// A serializable board literal (explicit hex list + iron list) — how a fixed
// board is supplied to `loadBoard` without code changes (spec §6).
export type BoardDefinition = {
  hexes: Hex[];
  iron: Hex[];
};

export type Player = {
  id: PlayerId;
  basesInHand: number; // of 12, how many not yet on board
  alliance: PlayerId[]; // ids in the same coalition (incl. self)
  eliminated: boolean;
  /**
   * Consecutive end-of-turn checks at which this player's coalition has held ≥`victoryThreshold` iron.
   * Drives variant-(b)/P2 `victoryIronHoldRounds` (default 1 = one-shot victory; values >1 require this
   * many consecutive holds before iron victory fires). Updated by `advanceRound` at the turn boundary.
   */
  victoryStreak: number;
  /**
   * Alliance-layer cooldown: when > 0, the player CANNOT enter new alliances (`ally` action is illegal).
   * Set to 1 by a `break-alliance` action (success OR failure path); decremented at each turn rollover
   * by `advanceRound`. Default 0 means no cooldown active.
   */
  allianceCooldownTurns: number;
};

export type Phase = {
  turn: number; // full cycles completed + 1
  order: PlayerId[]; // this turn's round order
  indexInOrder: number; // whose round it is
};

// RngState is owned by `../rng/pcg` (the canonical PCG32 implementation) and
// re-exported above so existing `./types` importers keep working.

export type GameState = {
  board: Board;
  bases: Base[];
  factories: Factory[];
  players: Player[];
  phase: Phase;
  factorySupply: number; // remaining of 36
  config: RuleConfig; // all tunable parameters (Section 12)
  rngState: RngState; // explicit PRNG state (Section 11)
};

export type Action =
  | { kind: "build"; pieces: { type: "factory" | "base"; hex: Hex }[] } // one type only per round
  | { kind: "attack"; attacks: AttackDecl[] } // 1+ (multi-attack)
  | { kind: "pass" } // see Section 8 note
  | { kind: "ally"; target: PlayerId } // mutual alliance commitment (alliance layer; gated by config.alliancesEnabled)
  | { kind: "break-alliance"; target: PlayerId }; // attempt to leave an existing alliance (weighted 2/3 success; cooldown either way)

export type AttackDecl = { target: Hex; attackers: Hex[]; defender: Hex }; // attackers: 3..6 bases

export type GameEvent =
  | { kind: "placed"; piece: PieceKind; hex: Hex; owner: PlayerId }
  | { kind: "combat"; target: Hex; committed: number; attackerWon: boolean }
  | { kind: "baseDestroyed"; hex: Hex; owner: PlayerId }
  | { kind: "baseReplaced"; hex: Hex; from: PlayerId; to: PlayerId }
  | { kind: "eliminated"; player: PlayerId; cause: EliminationCause; bountyTo: PlayerId | null }
  | { kind: "victory"; players: PlayerId[] };

// Elimination causes per spec §8. `emptyPerimeter` is self-inflicted and yields no bounty.
export type EliminationCause =
  | "noBases"
  | "brokenPerimeterAt18Factories"
  | "noIron"
  | "emptyPerimeter";
