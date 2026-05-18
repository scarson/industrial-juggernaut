# Representing Industrial Juggernaut in Code

**Date:** 2026-05-18
**Subject:** Options for modeling the game's state and logic, with mathematical underpinnings
**Companion doc:** `2026-05-18-design-critique.md`

The game decomposes into **six mathematically distinct subsystems**. Picking the right primitives for each is more consequential than picking a language or framework.

## 1. The Hex Grid — Cube Coordinates

Every other system rides on this choice. The right answer is **cube coordinates** `(x, y, z)` with the invariant `x + y + z = 0`.

```
distance((x,y,z), (x',y',z')) = (|x-x'| + |y-y'| + |z-z'|) / 2
```

Why cube over offset or doubled:

- Distance is a single closed-form expression — no special cases for odd/even rows.
- Rotation, reflection, and neighbor-lookup are vector arithmetic.
- The 5-hex disk (radiating territory) is just `{h : dist(base, h) ≤ 5}` — an O(1) membership test.
- Line drawing between two hexes is linear interpolation in cube space, then rounding back to the integer lattice.

Red Blob Games' hex guide is the canonical reference and is essentially a spec.

## 2. Territory — Two Regimes, Two Algorithms

The radiating-vs-perimeter split maps cleanly onto two well-understood mathematical objects:

| Regime | Object | Algorithm |
|---|---|---|
| 1–3 bases | **Union of hex disks** | `⋃ disk(b, 5)` — set union, O(B · \|disk\|) |
| 4+ bases | **Convex hull, rasterized to hexes** | Graham scan / QuickHull in continuous (x, y) space, then point-in-polygon test per hex |

A useful observation: **the rules text is mathematically imprecise about the 4+ regime.** It says "any hex touched by a line between two perimeter bases is inside." Taken literally, that's only the *boundary* of the convex hull, not the interior — a triangle's interior points don't lie on any vertex-to-vertex chord. The clear *intent* is convex-hull interior, but a code implementation would force the rules to disambiguate. This is a design win of writing the code: it surfaces latent ambiguities.

A single function `control(player, state) → Set<Hex>` with two branches on `|bases(player)|` is the whole abstraction.

## 3. Sight Lines & "Unobscured Triangle"

The new-base placement rule and the stranded-base rule both reduce to **line-segment vs. hex-set intersection**:

```
visible(h1, h2, blockers) := no hex in line(h1, h2) ∈ blockers
```

`line(h1, h2)` is the hex-rasterization of the segment between centers — a deterministic, well-defined sequence of hexes via cube-coordinate lerp + rounding. The "two-base triangle" rule then becomes a graph predicate:

```
canPlaceBase(p, h) := ∃ b1, b2 ∈ bases(p), b1 ≠ b2 :
                       visible(h, b1, opponentPerimeters) ∧
                       visible(h, b2, opponentPerimeters)
```

**Stranded-base detection** is the same primitive: build the player's *base visibility graph* (edges = pairs that can see each other), and a base is stranded iff its degree < 2 (or, more strictly, if it participates in no triangle).

The one edge case that **will** cause table arguments and needs an explicit rule: what if a sight line **grazes a corner** between two hexes? In code you must pick a convention (e.g., "line passes through a hex iff its center-to-center segment intersects the open interior of that hex"). Forcing this decision in the rules text would prevent disputes at the physical table too.

## 4. Combat — Closed-Form Bernoulli

The combat table is just `P(win) = A / (A + D)`:

| Commit | A | D | A/(A+D) |
|---|---|---|---|
| 3 | 3 | 1 | 0.750 |
| 4 | 5 | 1 | 0.833 |
| 5 | 8 | 1 | 0.889 |
| 6 | ∞ | 0 | 1.000 |

Aside: the attacker token sequence is **3, 5, 8 — Fibonacci**. Almost certainly coincidence, but it suggests a natural extrapolation (`13, 21, ...`) if commitment ever scales beyond 6.

In code this is one function: `resolveCombat(commit) → Bool` with a single random draw. No bag simulation needed unless you want to model the physical experience.

## 5. Iron Hex Placement — Constraint Satisfaction

The setup rule "no iron hex touches more than one other iron hex" + "no iron in outer 2 rings" is a **constraint satisfaction problem** with a clean graph formulation:

> Place 14 hexes in the interior region such that the induced subgraph on the hex-adjacency relation has **maximum degree ≤ 1** (i.e., the iron set is a matching — pairs and singletons only).

This is solvable by:

- **Rejection sampling** (simple, may be slow if interior is tight) — pick 14 random eligible hexes, retry if any has 2+ iron neighbors.
- **Sequential placement with backtracking** — place one at a time, skipping any hex that would create a degree-2 node.
- **ILP / SAT** — overkill but exact, useful if you want to enumerate all valid boards or pick adversarially balanced ones.

## 6. Alliances & Victory — Graph Operations

The alliance relation is an undirected graph on players. Victory checking is:

```
controlled_iron(alliance) := ⋃_{p ∈ alliance} (iron_hexes ∩ control(p))
win(p) := |controlled_iron(connected_component(p))| ≥ 10
```

Connected components: union-find or a one-pass DFS. Trivial at 6 nodes.

## State Representation — Three Architectural Options

### Option A: Pure functional immutable state

```
State = { board, bases, factories, players, alliances, phase, turnOrder }
applyAction : State → Action → State
isLegal     : State → Action → Bool
```

**Pros:** trivial undo/replay, free cloning for AI search (structural sharing), easy property-based testing, no aliasing bugs in perimeter recomputation.
**Cons:** verbose in languages without good immutable collections.
**Languages that shine:** Rust, F#, OCaml, Haskell, Clojure, TypeScript w/ Immer.

### Option B: Object-oriented mutable

The familiar default. **Risk:** the perimeter is a *derived* property that depends on a player's full base set; any base mutation must invalidate cached perimeters for that player *and* every opponent who shares a frontier. Bugs here are subtle and hard to test. If you go this route, treat the perimeter as a memoized pure function over the base set, not as mutable state.

### Option C: Logic / rules engine (declarative legality, procedural mutation)

Many rules are naturally predicates:

```prolog
can_place_base(P, H) :-
    base(P, B), distance(B, H, D), D =< 5,
    base(P, B1), base(P, B2), B1 \= B2,
    visible(H, B1), visible(H, B2),
    \+ inside_opponent_perimeter(P, H).
```

A Datalog or miniKanren layer for legality queries, sitting on top of an immutable state value, gives you the best of both worlds: declarative rules text that closely mirrors the rulebook, with procedural state transitions for performance.

**Recommendation:** **Option A with a small predicate DSL for legality** (the spirit of Option C without dragging in a logic-programming runtime). Immutable state because (a) the perimeter is a derived geometric object that's easier to recompute than to incrementally update correctly, and (b) any future AI work needs cheap cloning.

## What the Code Will Force You to Decide

Writing this game will surface at least five rules-text ambiguities the current draft glosses over:

1. **Convex hull interior vs. chord union** in the perimeter definition.
2. **Sight-line corner-grazing convention** — does a line that touches a hex vertex "pass through" that hex?
3. **Perimeter when bases are colinear** — convex hull degenerates to a line segment with zero interior.
4. **Tie-breaking for "farthest base"** when multiple bases are equidistant from the first base (factory placement reference).
5. **What happens to a factory** that ends up outside *all* perimeters after a perimeter reshuffle (rules mention it briefly but don't fully spec the reclaim mechanic).

Each of these is a one-line rules addendum, but you won't notice they're missing until you try to write the code.

## Validation Strategy

Property-based testing is the natural fit. Properties to assert:

- `control(p)` is monotone non-decreasing in `|bases(p)|` during the radiating phase.
- A successful attack leaves the board's *total* base count unchanged (one removed, one added).
- After perimeter reassessment, `control(p)` is a subset of the convex hull of `bases(p)`.
- Combat win-rate over 10,000 trials matches the published table within statistical bounds.
- A rescued stranded base re-enters the perimeter iff it's now visible to ≥2 friendly bases.

## Suggested Tech Stack

If you want one concrete recommendation: **Rust + the `hexx` crate** (or equivalent) for hex math, immutable game state via owned values + `Clone`, `geo` or a small hand-rolled module for convex hull and segment intersection, `proptest` for property-based tests. Rust's type system catches the perimeter-staleness bug class at compile time, and the resulting binary is fast enough for serious MCTS-based AI.

If you want fast iteration over correctness: **TypeScript + Immer** with the same architectural choices. Cheaper to prototype, slower for AI search.
