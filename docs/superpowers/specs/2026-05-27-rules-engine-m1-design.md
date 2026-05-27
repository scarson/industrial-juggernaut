# Design Spec — Industrial Juggernaut Rules Engine (Milestone 1)

**Date:** 2026-05-27
**Status:** Draft for review
**Source rules:** `industrial-juggernaut-rules-v10.md`
**Companion docs:** `2026-05-18-design-critique.md`, `2026-05-18-code-representation-options.md`, `2026-05-27-agent-roadmap.md`

## 1. Goal & Definition of Done

Deliver a **pure, deterministic, headless TypeScript rules engine** for Industrial Juggernaut, plus a **greedy-weighted archetype agent** and a **driver** that plays full games to completion.

**Done when:**

1. The engine can play a complete game from setup to a terminal state (a winner, or all-but-one eliminated) with no illegal states reachable through the public API.
2. Given a `(seed, action-sequence)`, a game replays bit-for-bit.
3. The greedy-weighted agent drives full games autonomously across 2–6 players without manual intervention.
4. Property-based tests pass (Section 13).
5. A driver run of N games emits structured result records (winner, length, victory-type, per-player iron-over-time).

This milestone validates the engine and surfaces **gross** imbalance and structural signals (termination, seat/turn-order bias). It deliberately does **not** settle subtle balance — see Non-Goals.

## 2. Non-Goals (deferred)

- The **stronger agent** (N-player max^n MCTS, threat map, alliance/diplomacy, learned variant) — fully specified in `2026-05-27-agent-roadmap.md`.
- The **balance-simulator harness** (parameter sweeps, statistics, parallel runner) — its own later spec.
- **Persistence / multiplayer** (Cloudflare Durable Objects, WebSockets, D1).
- **Frontend / board rendering.**
- Natural-language **alliance negotiation.**

M1 includes only the *mechanics* of alliances (combined iron toward victory, loaned bases in attacks) as engine rules — not any agent policy for forming them. The M1 agent treats alliances as absent.

## 3. Architecture

Layered, each layer depending only on those below it. All layers are pure except the driver's RNG threading.

```
driver         (plays full games, emits result records)
  └─ agent     (greedy-weighted archetype policy)
       └─ rules engine   (applyAction, legalActions, status)
            └─ territory  (control: radiating / perimeter)
                 └─ geometry (cube math, hull, hex-line, sight-line)
                      └─ board (generator + fixed loader)
```

## 4. Core Data Model

Cube coordinates throughout (`x + y + z = 0`).

```ts
type Hex = { x: number; y: number; z: number };          // invariant x+y+z=0

type PlayerId = number;                                    // 0..5
type PieceKind = "factory" | "base";
type BaseState = "fresh" | "fatigued";

type Base = { owner: PlayerId; hex: Hex; state: BaseState; order: number };
            // `order` = placement sequence; base with min order is the player's "first/oldest"
type Factory = { hex: Hex };                               // factories are unowned board state

type Board = {
  hexes: Hex[];                                            // the oval landmass
  iron: Hex[];                                             // subset, 14 by default
};

type Player = {
  id: PlayerId;
  basesInHand: number;                                     // of 12, how many not yet on board
  alliance: PlayerId[];                                    // ids in the same coalition (incl. self)
  eliminated: boolean;
};

type Phase = {
  turn: number;                                            // full cycles completed + 1
  order: PlayerId[];                                       // this turn's round order
  indexInOrder: number;                                    // whose round it is
};

type GameState = {
  board: Board;
  bases: Base[];
  factories: Factory[];
  players: Player[];
  phase: Phase;
  factorySupply: number;                                   // remaining of 36
  config: RuleConfig;                                      // all tunable parameters (Section 12)
  rngState: RngState;                                      // explicit PRNG state (Section 11)
};
```

Actions and events are tagged unions:

```ts
type Action =
  | { kind: "build"; pieces: ({ type: "factory" | "base"; hex: Hex })[] }   // one type only per round
  | { kind: "attack"; attacks: AttackDecl[] }                               // 1+ (multi-attack)
  | { kind: "pass" };                                                       // see Section 8 note

type AttackDecl = { target: Hex; attackers: Hex[]; defender: Hex };          // attackers: 3..6 bases

type GameEvent =
  | { kind: "placed"; piece: PieceKind; hex: Hex; owner: PlayerId }
  | { kind: "combat"; target: Hex; committed: number; attackerWon: boolean }
  | { kind: "baseDestroyed"; hex: Hex; owner: PlayerId }
  | { kind: "baseReplaced"; hex: Hex; from: PlayerId; to: PlayerId }
  | { kind: "eliminated"; player: PlayerId; cause: EliminationCause; bountyTo: PlayerId | null }
  | { kind: "victory"; players: PlayerId[] };
```

## 5. Geometry Layer (pure)

- `distance(a, b)` = `(|ax−bx| + |ay−by| + |az−bz|) / 2`.
- `disk(center, r)` = `{ h ∈ board : distance(center, h) ≤ r }`.
- `neighbors(h)` = the six cube-direction offsets.
- `convexHull(points: Hex[])` — Graham scan in continuous (x, y) projected coordinates (hex centers). Returns hull vertices CCW.
- `hexInHull(h, hull)` — point-in-polygon on the hex center; inside-or-on counts as inside. **(Resolution R1.)**
- `hexLine(a, b)` — cube lerp + cube-round, returns the hex sequence the center-to-center segment passes through.
- `segmentBlocked(a, b, blockers: Set<Hex>)` — true iff the open segment a→b crosses the **interior** of any blocker hex; grazing a vertex/edge does not block. **(Resolution R2.)**

## 6. Board Sources

The engine consumes a `Board` value; it is agnostic to origin.

- `generateBoard(rng, params): Board`
  - Builds the oval: a parameterized hex oval totaling ~`params.size` (default 96).
  - Iron CSP: choose `params.ironCount` (default 14) hexes such that (a) none lie in the outer two rings, (b) the iron-adjacency subgraph has **max degree ≤ 1** (no three-in-a-row clusters). Implemented by sequential placement with rejection: draw a candidate, accept iff it adds no degree-2 node and respects the ring constraint; backtrack-free retry.
- `loadBoard(def: BoardDefinition): Board`
  - A `BoardDefinition` is a serializable literal (explicit hex list + iron list). This is how a **fixed** board — including a future digitized canonical board — is supplied without code changes.

Both return the same `Board` type. The driver picks a source per run.

## 7. Territory / Control

`control(state, player): { hexes: Set<Hex>; iron: Hex[]; factories: Hex[] }`

- **Radiating** (`basesOnBoard(player) < 4`): union of `disk(base, config.radius)` over the player's bases. Overlapping radii: a hex/iron/factory in the intersection of two still-radiating players counts for **both**.
- **Perimeter** (`≥ 4` bases): `hexInHull` over the player's base centers. A resource enclosed by a perimeter is exclusive to that player and removed from any adjacent radiating player's credit.
- **Degenerate hull** (colinear bases, zero area): no enclosed territory; the player reverts to the radiating model until a non-colinear configuration exists. **(Resolution R3.)**

`resourceCount(state, player)` = `|control.iron| + |control.factories|`.

## 8. Rules Engine

`applyAction(state, action): { state, events }` — validates then applies (the PRNG rides inside `state`; see §10). Illegal actions throw (callers must pre-check via `legalActions`); this keeps the engine a total function over *legal* inputs.

**Build:**
- Build budget = `floor(resourceCount / 2)`, with the bootstrap exception: a player with `< 4` bases controlling ≥1 iron and 0 factories may build 1 factory even at resource count 1.
- One *type* per round (all factories or all bases).
- **Factory placement:** empty non-iron hex, within `config.placeRange` (default 5) of the player's **farthest base**. Farthest-base ties → within range of *any* tied base. **(Resolution R4.)** Decrements `factorySupply`; illegal if supply is 0.
- **Base placement (outside perimeter):** within `placeRange` of a friendly base; not inside any opponent perimeter; forms an unobstructed triangle with two existing friendly bases (`segmentBlocked` false to two of them). A base visible to only one is illegal.
- **Base placement (inside own perimeter):** legal anywhere empty in territory; fortifies, claims nothing.

**Attack:**
- Target must be on the **outer** hull of an opponent (or opponent-coalition) perimeter.
- Attackers: 3–6 friendly/allied bases, all within `config.attackRange` (default 6) of target; defender commits exactly 1 base within range.
- **Combat resolution:** outcome is a single Bernoulli with `p` from `config.combatTable` (3→0.75, 4→0.833, 5→0.889, 6→1.0). Draw via the engine PRNG. All committed bases (attack + defense) become `fatigued`.
- **Win:** defeated base replaced by an attacker's base; both perimeters recomputed. If the attacker is at 12 bases on board, relocate one existing base to the captured hex (only if the resulting perimeter still meets an opponent perimeter) or destroy with no replacement.
- **Multi-attack:** permitted while the player has ≥3 fresh bases in range; the agent may stop early to keep defenders.
- **Loss:** only fatigue changes.

**Perimeter reassessment & stranded bases:** after any base change, recompute each affected player's hull. A surviving base visible to only one friendly base is **stranded** (outside the perimeter); it may be rescued by a later base granting it two-base visibility, and is removed if an opponent fully encircles it.

**Elimination causes** (each ends a player's game; bases bounty to the cause, except empty-perimeter self-destruct → no bounty):
- `noBases`, `brokenPerimeterAt18Factories` (active once `36 − factorySupply ≥ 18`), `noIron`, `emptyPerimeter` (self-inflicted on placing a 4th base enclosing no iron).

**Victory:** at the **end of a round**, if any player or coalition controls `≥ config.victoryThreshold` (default 10) iron, the game ends.

**Orphaned factories:** a factory enclosed by no perimeter counts for nobody, stays on its hex, and is re-controlled by whoever next encloses it; never returned to supply. **(Resolution R5.)**

**`pass`:** included because build-or-attack can both be unproductive on a round; pass ends the round with no effect. (Flagged for review — the rulebook has no explicit pass; we may instead require a legal build/attack when one exists.)

## 9. Move Generation

`legalActions(state): Action[]` enumerates concrete legal actions for the player to move:

- All legal single-piece placements (each becomes the building block; multi-piece builds are composed by the agent via greedy sequencing, Section 11).
- All legal attacks as `(target, attacker-subset, defender)` tuples per commitment level.
- `pass`.

At 96 hexes this is tractable. The agent samples among these; the harness uses the same function to assert no illegal action is ever applied.

## 10. Determinism & RNG Contract

A single explicit seeded PRNG (PCG/xorshift) carried in `GameState.rngState`. **Every** stochastic decision routes through it: board generation, turn-order draws, combat draws. `applyAction` returns the advanced RNG state inside the new `GameState`. Therefore `(seed, board-source, action-sequence)` reproduces a game exactly — the basis for replay and for variance-reduced sweeps later.

## 11. Greedy-Weighted Archetype Agent

Per `2026-05-27-agent-roadmap.md` Part 1.

```
score(move) =
    w_iron * Δcontrolled_iron
  + w_fact * Δcontrolled_factories
  + w_area * Δperimeter_area
  + w_aggr * combat_EV          // P(win)*resources_gained − fatigue_cost
choose = softmax-sample(scores, temperature)
```

- **Static hard-prunes:** 4th-base placement yielding zero iron → excluded; any move dropping a held iron hex → heavy penalty; factory landing outside resulting perimeter → penalty.
- **Archetypes** = weight presets + temperature: *Aggressive* (high `w_aggr`, low temp), *Economic* (high `w_fact`), *Expansionist* (high `w_area`).
- **Multi-piece placement:** greedy sequential — score all single placements, apply the best, recompute, repeat until budget spent.
- **One dynamic rule:** keep ≥1 fresh base near the frontier for defense (prevents distortion from over-commitment).

The agent calls `legalActions` and never constructs an action the engine would reject.

## 12. Configuration (`RuleConfig`)

All tunables live in one struct so the future sweep harness varies them without touching engine code:

`radius` (5), `placeRange` (5), `attackRange` (6), `baseLimit` (12), `combatTable` (the 3/5/8-token win odds), `autoWinAt6` (true), `killBounty` ("full" | "half" | "none", default "full"), `factorySupply` (36), `ironCount` (14), `boardSize` (96), `victoryThreshold` (10), `brokenPerimeterDeathAtFactories` (18), `allowPass` (true — see §8 note).

## 13. Testing Strategy

Property-based (fast-check) plus the agent acceptance test:

- `control` is monotone non-decreasing in base count during the radiating phase.
- A successful attack leaves **total** on-board base count unchanged (one removed, one placed).
- After reassessment, `control(p) ⊆ convexHull(bases(p))`.
- Combat win-rate over 10⁴ trials matches `combatTable` within CI.
- A rescued stranded base re-enters the perimeter iff visible to ≥2 friendly bases.
- Generated boards always satisfy the iron CSP (no outer-2-ring iron; max-degree-1).
- **Replay:** `(seed, actions)` produces identical final state.
- **Acceptance:** the greedy agent plays 1,000 seeded games across 2–6 players; every applied action is in `legalActions`; every game reaches a terminal state within a turn cap (cap-hits recorded as a failure-mode signal, not a crash).

## 14. Module Layout

```
src/
  geometry/   cube.ts  hull.ts  hexline.ts  sightline.ts
  board/      generate.ts  load.ts  iron-csp.ts
  engine/     state.ts  control.ts  actions.ts  combat.ts  legal.ts  status.ts
  agent/      greedy.ts  archetypes.ts
  driver/     run.ts  record.ts
  rng/        pcg.ts
test/         property/*  acceptance/*
```

## 15. Resolved Ambiguities (carried from code-rep doc)

| ID | Decision |
|----|----------|
| R1 | Perimeter = convex-hull interior, rasterized (center inside-or-on). |
| R2 | Sight-line blocked only on open-interior crossing; grazing doesn't block. |
| R3 | Degenerate/colinear hull encloses nothing → revert to radiating. |
| R4 | Farthest-base ties → factory range measured from any tied base. |
| R5 | Orphaned factory = uncontrolled, stays on board, never returns to supply. |

## 16. Open Question for Review

The `pass` action (§8) has no basis in the rulebook. Two options: (a) keep `pass` for when neither build nor attack is productive, or (b) require a legal build/attack whenever one exists and only allow pass when the action set is otherwise empty. Leaning (b) for fidelity. Flagged for your call.
