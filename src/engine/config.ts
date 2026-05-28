// ABOUTME: RuleConfig type and the rules-faithful default config factory for the engine.
// ABOUTME: All tunable parameters live here so future sweep harnesses vary them without engine changes.

export type KillBounty = "full" | "half" | "none";
export interface RuleConfig {
  radius: number; placeRange: number; attackRange: number; baseLimit: number;
  combatTable: Record<3 | 4 | 5 | 6, number>;
  autoWinAt6: boolean; killBounty: KillBounty;
  factorySupply: number; ironCount: number; boardSize: number;
  victoryThreshold: number; brokenPerimeterDeathAtFactories: number;
  allowPass: boolean;
  /**
   * Variant (a)/P3: when true, a player's iron counts toward the victory threshold
   * ONLY when inside their committed perimeter (≥4 non-colinear bases). Radiating iron
   * still counts toward `resourceCount` (economy/bootstrap). Default false (current behavior).
   */
  victoryIronRequiresPerimeter: boolean;
  /**
   * Variant (a) companion + variant (c): when true, the `noIron` elimination cause only
   * fires for players in the PERIMETER control regime (≥4 non-colinear bases). A radiating
   * player with 0 iron is NOT eliminated — they just can't build anything until they get iron.
   * Default false (current behavior — noIron fires on any player with ≥1 base and 0 iron).
   */
  noIronRequiresPerimeter: boolean;
  /**
   * Variant (b)/P2: iron victory requires the coalition to have held ≥`victoryThreshold` iron
   * across this many consecutive end-of-turn checks. Default 1 = current behavior (one-shot
   * victory the moment threshold is met). Higher values give the opponent rounds to deny.
   * Per-player streak; resets to 0 when below threshold.
   */
  victoryIronHoldRounds: number;
  /**
   * Alliance layer master toggle. When false (default), the `ally` and `break-alliance` action
   * types are never legal and the engine behavior is bit-identical to the pre-alliance baseline.
   * When true, players can ally (mutual iron sharing for victory + non-aggression) and break
   * alliances via the configured break mechanic. Anti-gang-up safeguard: see `allianceVictoryDelta`.
   */
  alliancesEnabled: boolean;
  /**
   * Anti-coalition victory-threshold scaling (Sam's anti-gang-up safeguard). A coalition of size N
   * must reach `victoryThreshold + (N - 1) * allianceVictoryDelta` iron to win by iron. Tunable;
   * default 4 is the initial-sweep midpoint and should be re-examined against alliance comparison
   * data. Has no effect when coalitions are size 1 (no alliances active).
   */
  allianceVictoryDelta: number;
}
export const defaultConfig = (): RuleConfig => ({
  radius: 5, placeRange: 5, attackRange: 6, baseLimit: 12,
  combatTable: { 3: 0.75, 4: 5 / 6, 5: 8 / 9, 6: 1 },
  autoWinAt6: true, killBounty: "full",
  factorySupply: 36, ironCount: 14, boardSize: 96,
  victoryThreshold: 10, brokenPerimeterDeathAtFactories: 8,
  allowPass: false,
  victoryIronRequiresPerimeter: false,
  noIronRequiresPerimeter: false,
  victoryIronHoldRounds: 1,
  alliancesEnabled: false,
  allianceVictoryDelta: 4,
});
