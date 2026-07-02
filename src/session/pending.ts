// ABOUTME: Pending defender decisions (spec §3) — eligibleDefenders / validateAttackers / open / resolve / extend.
// ABOUTME: Pure; opens the durable write-lock pending, resolves it atomically (append + tombstone in ONE put), re-arms the deadline.
import { distance, key } from "../geometry/cube";
import { legalActions } from "../engine/legal";
import { applyEntry } from "./round";
import { commitEntries, type DriveResult } from "./agent-drive";
import { validateAttackDecl } from "./validation";
import { PENDING_KEY } from "./keys";
import { NO_EFFECTS, PENDING_TOMBSTONE, type CommandCtx, type Effects, type Pending, type SessionState } from "./session-types";
import type { SessionError } from "./validation";
import type { AttackDecl, GameState, Hex, PlayerId } from "../engine/types";
import type { LogEntry } from "./types";
import type { EncodedPending } from "../wire/protocol";

// Attacker-count commitment bounds. There is NO exported engine/config constant for the 3..6 range — the values
// are private in src/engine/apply.ts (applyOneAttack, MIN_ATTACKERS=3/MAX_ATTACKERS=6) and src/engine/legal.ts
// (legalActions, MIN_ATTACKERS=3/MAX_ATTACKERS=6). CONFIRMED both files still use 3 (min) and 6 (auto-win),
// pinned by the combat table (DER #8: 3→3/4, 4→5/6, 5→8/9, 6→auto). If the engine ever exports them, switch here.
const MIN_ATTACKERS = 3;
const MAX_ATTACKERS = 6;

/**
 * The DERIVED set of bases the client may pick as the defender (spec §3 sanctioned
 * existence/eligibility check): bases owned by `defenderOwner` that are `fresh`,
 * within `config.attackRange` of `target`, and NOT the target itself. Sorted by the
 * same deterministic order as `representativeDefender` (distance asc, tie by
 * ascending canonical key) so the client's greyed-out set and the engine's auto-pick
 * cannot disagree. Recomputes from `game.bases` at the point of use (GEO-5); never
 * cached. Call with explicit args at every site.
 */
export function eligibleDefenders(game: GameState, target: Hex, defenderOwner: PlayerId): Hex[] {
  const range = game.config.attackRange;
  return game.bases
    .filter(
      (b) =>
        b.owner === defenderOwner &&
        b.state === "fresh" &&
        key(b.hex) !== key(target) &&
        distance(b.hex, target) <= range,
    )
    .slice()
    .sort((a, b) => {
      const da = distance(a.hex, target);
      const db = distance(b.hex, target);
      if (da !== db) return da - db;
      return key(a.hex) < key(b.hex) ? -1 : key(a.hex) > key(b.hex) ? 1 : 0;
    })
    .map((b) => b.hex);
}

/**
 * ATTACKER-side pre-check (defense-in-depth backing the engine's apply-time enforcement in
 * src/engine/apply.ts). MUST run BEFORE the write-lock is acquired — a bad attacker set that
 * opened a pending would wedge the room (the deferred apply throws forever). Checks, in order:
 * count in [MIN_ATTACKERS, MAX_ATTACKERS] (INVALID_ATTACKERS), all hexes distinct (DUP_ATTACKERS),
 * every hex an `attacker`-owned `fresh` base within `config.attackRange` of `target` (INVALID_ATTACKERS).
 */
export function validateAttackers(
  game: GameState,
  attacker: PlayerId,
  target: Hex,
  attackers: Hex[],
): SessionError | null {
  if (attackers.length < MIN_ATTACKERS || attackers.length > MAX_ATTACKERS) {
    return {
      code: "INVALID_ATTACKERS",
      message: `Attack must commit ${MIN_ATTACKERS}..${MAX_ATTACKERS} attacker bases; got ${attackers.length}.`,
    };
  }
  const attackerKeys = attackers.map((h) => key(h));
  if (new Set(attackerKeys).size !== attackerKeys.length) {
    return { code: "DUP_ATTACKERS", message: "Attack declaration contains duplicate attacker hexes." };
  }
  const range = game.config.attackRange;
  for (const h of attackers) {
    const attackerBase = game.bases.find((b) => b.owner === attacker && key(b.hex) === key(h));
    if (!attackerBase) {
      return { code: "INVALID_ATTACKERS", message: `No base owned by the attacker at ${h.x},${h.y},${h.z}.` };
    }
    if (attackerBase.state !== "fresh") {
      return { code: "INVALID_ATTACKERS", message: `Attacker base at ${h.x},${h.y},${h.z} is fatigued.` };
    }
    if (distance(attackerBase.hex, target) > range) {
      return { code: "INVALID_ATTACKERS", message: `Attacker base at ${h.x},${h.y},${h.z} is out of attack range ${range}.` };
    }
  }
  return null;
}

/**
 * Project a storage `Pending` to its wire `EncodedPending` — OMITS the storage-only crash-recovery fields
 * (`proposed.attackers`, `preDecisionLogLength`, `rngBeforeApply`) and ADDS the client-rendered eligible set.
 */
export function toWirePending(p: Pending, eligible: Hex[]): EncodedPending {
  return {
    decisionId: p.decisionId,
    kind: p.kind,
    round: p.round,
    declaringPlayer: p.declaringPlayer,
    promptedSeat: p.promptedSeat,
    target: p.proposed.target,
    eligibleDefenders: eligible,
    deadlineEpochMs: p.deadlineEpochMs,
  };
}

/**
 * Open a durable pending defender decision — builds the `Pending`, the prompt message to the defender seat,
 * and the alarm intent. Does NOT apply the attack (no log entry). Called when the defending seat is HUMAN.
 * PRECONDITION: `validateAttackers` + `validateTargetAttackable` already passed (the caller guarantees this).
 * The alarm is set ONLY when `roomOptions.defenderTimeout.enabled`.
 */
export function openDefenderDecision(
  s: SessionState,
  proposed: AttackDecl,
  defenderOwner: PlayerId,
  ctx: CommandCtx,
): { pending: Pending; effects: Effects } {
  const timeout = s.roomOptions.defenderTimeout;
  const deadlineEpochMs = timeout.enabled ? ctx.nowEpochMs + timeout.seconds * 1000 : null;
  const pending: Pending = {
    decisionId: ctx.decisionId,
    kind: "defenderChoice",
    round: s.game.phase.turn,
    declaringPlayer: ctx.actingSeat, // the attacker (the acting seat that declared the attack)
    promptedSeat: defenderOwner,
    proposed,
    preDecisionLogLength: s.logLength,
    rngBeforeApply: s.game.rngState, // installed when the resolved attack entry applies (GEO-3)
    deadlineEpochMs,
  };
  const effects: Effects = {
    ...NO_EFFECTS,
    persist: { put: { [PENDING_KEY]: pending } }, // raw storage pending (bigints native in DO storage)
    toSeat: [
      {
        seat: defenderOwner,
        message: { type: "prompt", pending: toWirePending(pending, eligibleDefenders(s.game, proposed.target, defenderOwner)) },
      },
    ],
    alarm: deadlineEpochMs !== null ? { action: "set", atEpochMs: deadlineEpochMs } : null,
  };
  return { pending, effects };
}

/**
 * Land an attack round in ONE atomic commit: the attack entry AND its auto-close `endRound` (when no legal
 * attack remains for the actor). SHARED by all three attack-apply paths (the session.ts human-vs-agent-defender
 * path, `driveOneStep`'s agent attack, and `resolveDefender`) so the attack+auto-close composition lives in one
 * place. Applies the attack to a THROWAWAY post-state first to evaluate `autoCloseIfNoAttack` (per its post-attack
 * PRECONDITION), then runs the SINGLE `commitEntries(s, [attack, ...(autoClose ? [endRound] : [])])` on the REAL
 * state. The attack applies twice — once throwaway, once inside commitEntries — but `applyEntry` is pure, so both
 * yield the same post-attack state. When no legal attack remains the endRound closes the round (snapshot +
 * turnRollover/gameOver via commitEntries); otherwise the round stays open (the chain continues).
 */
export function commitAttackRound(s: SessionState, attackEntry: LogEntry): DriveResult {
  // attackEntry.player is the attacker == the current player (attack never advanceRound); the throwaway
  // post-attack state is the actor's remaining-attack surface autoCloseIfNoAttack must inspect (GEO-5: recompute).
  const throwaway = applyEntry(s.game, attackEntry);
  const autoClose = autoCloseIfNoAttack(throwaway.state, attackEntry.player);
  return commitEntries(s, autoClose === null ? [attackEntry] : [attackEntry, autoClose]);
}

/**
 * Resolve a pending decision with the defender the prompted seat chose. Validates the completed declaration
 * (DUP_ATTACKERS / DEFENDER_IS_TARGET / DEFENDER_INELIGIBLE — no persist, no state change on error). On ok,
 * builds the final attack entry installing the STORED pre-decision rng (GEO-3 — NOT s.game.rngState), lands the
 * attack + its auto-close `endRound` (when the attack exhausts the actor) via `commitAttackRound`, and merges
 * `[PENDING_KEY]: PENDING_TOMBSTONE` into that same single `persist.put` so the resolving append(s) and the
 * pending-clear are ONE atomic put (never a separate delete). `next.pending = null`; `alarm: { action: "clear" }`.
 * `advanced` surfaces whether the resolved attack closed the round (auto-close) so the command layer can maintain
 * `chainAttacker` (cleared on close, else the attacker continues their chain).
 */
export function resolveDefender(
  s: SessionState,
  pending: Pending,
  chosenDefender: Hex,
): { next: SessionState; effects: Effects; advanced: boolean } | { error: SessionError } {
  const finalDecl: AttackDecl = { ...pending.proposed, defender: chosenDefender };
  const error = validateAttackDecl(s.game, pending.promptedSeat, finalDecl);
  if (error !== null) return { error };

  const entry: LogEntry = { player: pending.declaringPlayer, kind: "attack", decl: finalDecl, rngBeforeApply: pending.rngBeforeApply };
  const committed = commitAttackRound(s, entry);
  // Merge the pending-clear tombstone into the SAME atomic put built by commitAttackRound (the put already holds
  // the attack log:N — and the endRound log:N+1 + snapshot when the attack auto-closed the round).
  const put = { ...committed.effects.persist!.put, [PENDING_KEY]: PENDING_TOMBSTONE };
  const effects: Effects = { ...committed.effects, persist: { put }, alarm: { action: "clear" } };
  const next: SessionState = { ...committed.next, pending: null };
  return { next, effects, advanced: committed.advanced };
}

/**
 * Re-arm the defender-decision deadline. Validates FIRST that the acting seat IS the prompted seat —
 * `{ error: NOT_YOUR_TURN }` otherwise. The command layer (session.ts extendDecision handler) enforces the same
 * check before calling in; BOTH layers validate (defense in depth per plan Task A4.3) so a non-prompted seat can
 * never reset the defender's liveness clock even through a future caller that skips the command layer. When the
 * room's defender timeout is DISABLED this is a pure no-op — `{ next: s, effects: NO_EFFECTS }` — there is
 * nothing to extend, and arming an alarm or stamping a non-null deadline onto a pending opened with
 * `deadlineEpochMs: null` would create a spurious liveness clock. When enabled, pushes `deadlineEpochMs` to
 * `ctx.nowEpochMs + roomOptions.defenderTimeout.seconds*1000`, persists the updated pending, and sets the alarm.
 * No log entry (the attack is still deferred).
 */
export function extendDefender(
  s: SessionState,
  pending: Pending,
  ctx: CommandCtx,
): { next: SessionState; effects: Effects } | { error: SessionError } {
  if (ctx.actingSeat !== pending.promptedSeat) {
    return { error: { code: "NOT_YOUR_TURN", message: "Only the prompted defender may extend their decision." } };
  }
  const timeout = s.roomOptions.defenderTimeout;
  if (!timeout.enabled) return { next: s, effects: NO_EFFECTS };
  const deadlineEpochMs = ctx.nowEpochMs + timeout.seconds * 1000;
  const updated: Pending = { ...pending, deadlineEpochMs };
  const effects: Effects = {
    ...NO_EFFECTS,
    persist: { put: { [PENDING_KEY]: updated } },
    alarm: { action: "set", atEpochMs: deadlineEpochMs },
  };
  const next: SessionState = { ...s, pending: updated };
  return { next, effects };
}

/** Returns the auto-close endRound entry when the actor has no legal attack remaining, else null
 *  (round stays open for a human to continue their chain). Sanctioned existence check (spec §3):
 *  existence over legalActions, never membership-testing a specific action.
 *  PRECONDITION: `game` is the POST-ATTACK state (attack applied, attacker fatigue recorded, actor
 *  still the current player mid-round) — a pre-attack state silently overcounts remaining attacks.
 *  legalActions derives the actor internally, so `actor` must be `game`'s current player. */
export function autoCloseIfNoAttack(game: GameState, actor: PlayerId): LogEntry | null {
  const hasAttack = legalActions(game).some((a) => a.kind === "attack");
  return hasAttack ? null : { player: actor, kind: "endRound", rngBeforeApply: game.rngState };
}
