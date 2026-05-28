// ABOUTME: Shared GameState fixture builder for engine tests — deterministic board (seed 1n) with placed bases/iron/factories.
// ABOUTME: Conforms exactly to src/engine/types.ts under exactOptionalPropertyTypes; the foundation fixture for Phase 5.

import { generateBoard } from "../../src/board/generate";
import { seed } from "../../src/rng/pcg";
import { key } from "../../src/geometry/cube";
import { defaultConfig, type RuleConfig } from "../../src/engine/config";
import type { Base, Factory, GameState, Hex, PlayerId } from "../../src/engine/types";

export interface MkStateOpts {
  board: number;
  basesP0?: Hex[];
  basesP1?: Hex[];
  basesP2?: Hex[];
  basesP3?: Hex[];
  basesP4?: Hex[];
  basesP5?: Hex[];
  iron?: Hex[];
  factories?: Hex[];
  config?: RuleConfig;
}

const BASE_LIMIT = 12;

export function mkState(opts: MkStateOpts): GameState {
  const config = opts.config ?? defaultConfig();

  // FIXED seed so fixtures are deterministic across runs/machines.
  const { board } = generateBoard(seed(1n), { size: opts.board, ironCount: 14 });

  // Per-player base lists, indexed by PlayerId.
  const perPlayer: ReadonlyArray<Hex[] | undefined> = [
    opts.basesP0,
    opts.basesP1,
    opts.basesP2,
    opts.basesP3,
    opts.basesP4,
    opts.basesP5,
  ];

  // Which players exist: any with a (possibly empty) base array, else default 2.
  const declared = perPlayer.reduce<number>((max, list, id) => (list !== undefined ? id + 1 : max), 0);
  const playerCount = Math.max(declared, 2);

  const bases: Base[] = [];
  for (let id = 0; id < playerCount; id++) {
    const list = perPlayer[id] ?? [];
    list.forEach((h, idx) => {
      // `order` monotonic per player so min order == first/oldest base.
      bases.push({ owner: id as PlayerId, hex: h, state: "fresh", order: idx });
    });
  }

  const players = Array.from({ length: playerCount }, (_, id) => {
    const onBoard = (perPlayer[id] ?? []).length;
    return {
      id: id as PlayerId,
      basesInHand: BASE_LIMIT - onBoard,
      alliance: [id as PlayerId],
      eliminated: false,
      victoryStreak: 0,
    };
  });

  // Override iron with deterministic fixture hexes when provided, and ensure
  // every such hex is on the board so control() can resolve it (GEO-4 keyed).
  if (opts.iron !== undefined) {
    const present = new Set(board.hexes.map(key));
    for (const h of opts.iron) {
      if (!present.has(key(h))) {
        board.hexes.push(h);
        present.add(key(h));
      }
    }
    board.iron = opts.iron;
  }

  const factories: Factory[] = (opts.factories ?? []).map((h) => ({ hex: h }));

  const order = Array.from({ length: playerCount }, (_, id) => id as PlayerId);

  return {
    board,
    bases,
    factories,
    players,
    phase: { turn: 1, order, indexInOrder: 0 },
    factorySupply: config.factorySupply - factories.length,
    config,
    rngState: seed(1n),
  };
}
