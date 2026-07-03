// ABOUTME: The attack composer — target selection, eligible-attacker candidates, a commitment
// ABOUTME: slider whose odds read live from config.combatTable, and the Commit action. NO local
// ABOUTME: combat resolution: the RNG draw belongs to the reducer/server (honest tension, PRODUCT.md #5).
import { useState } from "react";
import * as Slider from "@radix-ui/react-slider";
import { distance, representativeDefender } from "../engine-client/barrel";
import { highlightSets } from "../board/highlight";
import { hexKey, keyToHex } from "../board/projection";
import { explainError } from "../rules/error-explanations";
import { ComposerPanel, RuleLine, HexButtonList } from "./shell";
import type { HexButtonItem } from "./shell";
import type { GameState, PlayerId, Hex, Base } from "../engine-client/barrel";
import type { GameDriver } from "../game/driver";
import type { GameStore } from "../game/store";

export interface AttackComposerProps {
  /** The authoritative state to attack against. */
  readonly state: GameState;
  /** The acting player — the seat whose attack this is. Callers gate mounting on
   *  `currentPlayer(state) === player` and `player` being one of `driver.controllableSeats()`. */
  readonly player: PlayerId;
  /** Submits the eventual `{type:"attack", decl}` command. */
  readonly driver: GameDriver;
  /** Read/write access to clear any stale optimistic preview on target-select/commit — attacks
   *  never themselves produce a preview state (combat is unresolved client-side; see the module
   *  doc comment's G1 note), so `store` is used only for `clearPreview`, never `setPreview`. */
  readonly store: GameStore;
}

const MIN_COMMITMENT = 3;
const MAX_COMMITMENT = 6;
type Commitment = 3 | 4 | 5 | 6;

/**
 * Target select → eligible-attacker candidates (this player's fresh in-range bases, nearest-first
 * — the same deterministic ordering `legalActions` uses to build its representative attacker
 * subsets) → a commitment slider whose odds read from `state.config.combatTable[commitment]` →
 * Commit.
 *
 * The target list renders every enemy (non-alliance) base, not just `highlightSets().attackTargets`
 * — targets outside that legal set (e.g. DER #4's no-eligible-defender case) are still shown, but
 * greyed out with the rule's explanation instead of being silently omitted, so selecting one
 * teaches the rule it breaks rather than looking like a missing button.
 *
 * `AttackDecl.defender` is a PROPOSAL: `representativeDefender(state, target, defenderOwner)`.
 * The reducer/server substitutes a human defender's actual choice via the prompt flow — this
 * composer never resolves who defends, only who is asked to attack and with how much force.
 *
 * Hex selection here is a highlighted-hex-button list (`data-testid="attack-target-<key>"`), NOT
 * the SVG board — routing a real `Board` click into this composer is P3.11's job, same split as
 * BuildComposer (P3.4).
 */
export function AttackComposer({ state, player, driver, store }: AttackComposerProps) {
  const [targetKey, setTargetKey] = useState<string | null>(null);
  const [commitment, setCommitment] = useState<Commitment>(MIN_COMMITMENT);

  const attackTargets = highlightSets(state).attackTargets;
  const candidateTargets = enemyBases(state, player);
  const target = targetKey !== null ? keyToHex(targetKey) : null;

  const eligibleAttackers = target !== null ? eligibleAttackersFor(state, player, target) : [];
  const defenderOwner = target !== null ? ownerAt(state, target) : null;
  const defender =
    target !== null && defenderOwner !== null
      ? representativeDefender(state, target, defenderOwner)
      : null;

  const maxCommitment = Math.min(MAX_COMMITMENT, eligibleAttackers.length) as Commitment;
  const effectiveCommitment = Math.min(commitment, Math.max(MIN_COMMITMENT, maxCommitment)) as Commitment;
  const attackers = eligibleAttackers.slice(0, effectiveCommitment).map((b) => b.hex);

  const prob = state.config.combatTable[effectiveCommitment];
  const noEligibleDefender = target !== null && defender === null;
  const canCommit = target !== null && defender !== null && attackers.length >= MIN_COMMITMENT;

  function selectTarget(key: string) {
    setTargetKey(key);
    setCommitment(MIN_COMMITMENT);
    store.getState().clearPreview();
  }

  function handleCommit() {
    if (!canCommit || target === null || defender === null) return;
    driver.submit({ type: "attack", decl: { target, attackers, defender } });
    setTargetKey(null);
    setCommitment(MIN_COMMITMENT);
    store.getState().clearPreview();
  }

  const targetItems: HexButtonItem[] = candidateTargets.map((base) => {
    const key = hexKey(base.hex);
    const legal = attackTargets.has(key);
    return {
      key,
      hex: base.hex,
      pressed: key === targetKey,
      ariaDisabled: !legal,
      style: legal ? undefined : TARGET_ILLEGAL_STYLE,
    };
  });

  return (
    <ComposerPanel ariaLabel="Attack">
      <HexButtonList
        ariaLabel="Attack targets"
        testIdPrefix="attack-target"
        items={targetItems}
        onSelect={(hex) => selectTarget(hexKey(hex))}
      />

      {target !== null && noEligibleDefender && <RuleLine>{explainError("NO_ELIGIBLE_DEFENDER")}</RuleLine>}

      {target !== null && !noEligibleDefender && (
        <>
          <div role="group" aria-label="Eligible attackers" style={HEX_LIST_STYLE}>
            {eligibleAttackers.map((base, i) => {
              const key = hexKey(base.hex);
              return (
                <span
                  key={key}
                  className="mono"
                  data-testid={`attack-attacker-${key}`}
                  style={i < effectiveCommitment ? ATTACKER_COMMITTED_STYLE : ATTACKER_STYLE}
                >
                  {key}
                </span>
              );
            })}
          </div>

          <div style={SLIDER_ROW_STYLE}>
            <Slider.Root
              className="ij-slider-root"
              style={SLIDER_ROOT_STYLE}
              min={MIN_COMMITMENT}
              max={Math.max(MIN_COMMITMENT, maxCommitment)}
              step={1}
              value={[effectiveCommitment]}
              onValueChange={([v]) => setCommitment(v as Commitment)}
              aria-label="Commitment"
            >
              <Slider.Track style={SLIDER_TRACK_STYLE}>
                <Slider.Range style={SLIDER_RANGE_STYLE} />
              </Slider.Track>
              <Slider.Thumb style={SLIDER_THUMB_STYLE} aria-label="Commitment" />
            </Slider.Root>
            <span className="mono" data-testid="attack-commitment">
              {effectiveCommitment}
            </span>
            <span className="mono" data-testid="attack-odds">
              {formatOdds(prob)}
            </span>
          </div>
        </>
      )}

      <div>
        <button
          type="button"
          className="chrome-button brass-accent-bg"
          disabled={!canCommit}
          onClick={handleCommit}
        >
          Commit
        </button>
      </div>
    </ComposerPanel>
  );
}

/** This player's fresh bases within `attackRange` of `target`, nearest-first (distance ascending,
 *  tie by ascending hexKey) — the same deterministic ordering `legalActions` (src/engine/legal.ts)
 *  uses to build its representative attacker subsets, so the candidate list here matches exactly
 *  what a commitment level N would select as attackers N through the engine's own logic.
 *
 *  Filters by strict ownership (`b.owner === player`), which is behaviorally equal to the engine's
 *  alliance-based `isAlly` filter ONLY because alliances are singletons in this phase
 *  (`Player.alliance: [id]`; `allianceOp` composition is Phase-3, out of scope here — see
 *  `docs/plans/2026-06-29-spa-client-plan.md`'s P3 Discoveries). If Phase-3 alliance work grows
 *  alliances beyond singletons, this strict-owner filter would silently under-populate allied
 *  attackers. Remediation when that lands: consume an engine `legalAttackers(state, target)`
 *  export instead of re-deriving eligibility here. */
function eligibleAttackersFor(state: GameState, player: PlayerId, target: Hex): Base[] {
  const range = state.config.attackRange;
  return state.bases
    .filter((b) => b.owner === player && b.state === "fresh" && distance(b.hex, target) <= range)
    .slice()
    .sort((a, b) => {
      const da = distance(a.hex, target);
      const db = distance(b.hex, target);
      if (da !== db) return da - db;
      const ka = hexKey(a.hex);
      const kb = hexKey(b.hex);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
}

/** The owner of the base sitting at `hex`, or `null` if no base occupies it. */
function ownerAt(state: GameState, hex: Hex): PlayerId | null {
  const key = hexKey(hex);
  return state.bases.find((b) => hexKey(b.hex) === key)?.owner ?? null;
}

/** Every base not in `player`'s alliance — the full target-candidate universe the composer
 *  offers, before narrowing to what `highlightSets().attackTargets` says is actually legal. */
function enemyBases(state: GameState, player: PlayerId): Base[] {
  const alliance = state.players.find((p) => p.id === player)?.alliance ?? [player];
  return state.bases.filter((b) => !alliance.includes(b.owner));
}

/** `combatTable` probabilities are fractions (e.g. `5/6`); this renders the ACTUAL configured
 *  value, never a hardcoded literal — commitment 6's default probability is exactly 1, which
 *  reads "auto" (DER #8) rather than "100%". */
function formatOdds(prob: number | undefined): string {
  if (prob === undefined) return "—";
  if (prob === 1) return "auto";
  return `${Math.round(prob * 100)}%`;
}

const HEX_LIST_STYLE: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: "0.35rem" };
const TARGET_ILLEGAL_STYLE: React.CSSProperties = {
  color: "var(--color-ink-700)",
  borderColor: "var(--hairline)",
  opacity: 0.5,
};
const ATTACKER_STYLE: React.CSSProperties = {
  padding: "0.15rem 0.4rem",
  // Longhand (not the `border` shorthand) so ATTACKER_COMMITTED_STYLE's override can replace only
  // `borderColor` without a shorthand/longhand reconciliation conflict when a span reverts to
  // uncommitted (the slider lowering).
  borderWidth: "1px",
  borderStyle: "solid",
  borderColor: "var(--hairline)",
  color: "var(--color-ink-700)",
};
const ATTACKER_COMMITTED_STYLE: React.CSSProperties = {
  ...ATTACKER_STYLE,
  color: "var(--text-on-chrome)",
  borderColor: "var(--accent)",
};
const SLIDER_ROW_STYLE: React.CSSProperties = { display: "flex", alignItems: "center", gap: "0.75rem" };
const SLIDER_ROOT_STYLE: React.CSSProperties = {
  position: "relative",
  display: "flex",
  alignItems: "center",
  flex: 1,
  height: "1.25rem",
  touchAction: "none",
  userSelect: "none",
};
const SLIDER_TRACK_STYLE: React.CSSProperties = {
  position: "relative",
  flex: 1,
  height: "2px",
  background: "var(--hairline)",
};
const SLIDER_RANGE_STYLE: React.CSSProperties = {
  position: "absolute",
  height: "100%",
  background: "var(--accent)",
};
const SLIDER_THUMB_STYLE: React.CSSProperties = {
  display: "block",
  width: "0.7rem",
  height: "0.7rem",
  background: "var(--accent)",
  border: "1px solid var(--color-ink-900)",
};
