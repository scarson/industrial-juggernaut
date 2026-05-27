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
}
export const defaultConfig = (): RuleConfig => ({
  radius: 5, placeRange: 5, attackRange: 6, baseLimit: 12,
  combatTable: { 3: 0.75, 4: 5 / 6, 5: 8 / 9, 6: 1 },
  autoWinAt6: true, killBounty: "full",
  factorySupply: 36, ironCount: 14, boardSize: 96,
  victoryThreshold: 10, brokenPerimeterDeathAtFactories: 8,
  allowPass: false,
});
