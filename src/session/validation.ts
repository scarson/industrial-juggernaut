// ABOUTME: Session-layer defense-in-depth validation predicates (spec §3 checks 1, 4a, 3+4b, 5).
// ABOUTME: Pure predicates returning null (ok) or a structured SessionError — consumed by the interactive GameSession (plan 2).

import { distance, key } from "../geometry/cube";
import { legalActions, representativeDefender } from "../engine/legal";
import type { AttackDecl, GameState, Hex, PlayerId } from "../engine/types";
import type { Piece } from "./types";

/** A structured validation error with a machine-readable code and a human-readable message. */
export type SessionError = { code: string; message: string };

/**
 * Check 1: `pass` is only valid when `config.allowPass` is true OR the player is
 * forced-pass (every legal action is a pass). Uses `legalActions` ONLY for
 * forced-pass detection — the one sanctioned use.
 */
export function validatePass(state: GameState): SessionError | null {
  if (state.config.allowPass) return null;
  const actions = legalActions(state);
  const forced = actions.every((a) => a.kind === "pass");
  if (forced) return null;
  return { code: "PASS_NOT_FORCED", message: "Pass is only allowed when it is the only legal action (forced pass)." };
}

/**
 * Check 4a: Determines whether a target is attackable at all this round —
 * i.e. at least one eligible defender exists for the defending player.
 * Returns NO_ELIGIBLE_DEFENDER when `representativeDefender` returns null.
 * Used to grey out unattackable targets before a defender is proposed.
 */
export function validateTargetAttackable(
  state: GameState,
  target: Hex,
  defenderOwner: PlayerId,
): SessionError | null {
  if (representativeDefender(state, target, defenderOwner) === null) {
    return { code: "NO_ELIGIBLE_DEFENDER", message: "The target has no eligible defender this round and cannot be attacked." };
  }
  return null;
}

/**
 * Checks 3 + 4b on a complete proposed attack declaration.
 * First failing check wins (in order): DUP_ATTACKERS, DEFENDER_IS_TARGET, DEFENDER_INELIGIBLE.
 *
 * DEFENDER_INELIGIBLE mirrors src/engine/apply.ts:175-185: the submitted defender must be
 * owned by `defenderOwner`, `state === "fresh"`, within `config.attackRange` of target, and ≠ target.
 */
export function validateAttackDecl(
  state: GameState,
  defenderOwner: PlayerId,
  decl: AttackDecl,
): SessionError | null {
  // Check 3a: duplicate attacker hexes.
  const attackerKeys = decl.attackers.map((h) => key(h));
  if (new Set(attackerKeys).size !== attackerKeys.length) {
    return { code: "DUP_ATTACKERS", message: "Attack declaration contains duplicate attacker hexes." };
  }

  // Check 3b: defender cannot be the target.
  if (key(decl.defender) === key(decl.target)) {
    return { code: "DEFENDER_IS_TARGET", message: "The defender cannot be the target base itself." };
  }

  // Check 4b: re-validate the submitted/substituted defender.
  const defBase = state.bases.find((b) => b.owner === defenderOwner && key(b.hex) === key(decl.defender));
  if (!defBase || defBase.state !== "fresh" || distance(defBase.hex, decl.target) > state.config.attackRange) {
    return { code: "DEFENDER_INELIGIBLE", message: "The submitted defender is not eligible: must be owned by the defender owner, fresh, and within attack range of the target." };
  }

  return null;
}

/**
 * Check 5: build pieces must be a duplicate-free set of one piece type.
 * Budget checks are the engine's job at apply time; not validated here.
 */
export function validateBuildPieces(pieces: Piece[]): SessionError | null {
  const types = new Set(pieces.map((p) => p.type));
  if (types.size > 1) {
    return { code: "MIXED_PIECE_TYPES", message: "All pieces in a build action must be of the same type." };
  }
  const hexKeys = pieces.map((p) => key(p.hex));
  if (new Set(hexKeys).size !== hexKeys.length) {
    return { code: "DUP_PIECES", message: "Build action contains pieces with duplicate hex coordinates." };
  }
  return null;
}
