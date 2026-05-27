# Industrial Juggernaut Rules Engine (M1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pure, deterministic, headless TypeScript rules engine for Industrial Juggernaut plus a greedy-weighted archetype agent and a driver that plays full games to completion.

**Architecture:** Layered and pure (geometry → board → territory → engine → agent → driver), with all randomness routed through one explicit seeded PRNG carried in `GameState`. Immutable state; `applyAction` / `legalActions` / `status` are total functions over legal inputs. Source of truth is `docs/superpowers/specs/2026-05-27-rules-engine-m1-design.md`.

**Tech Stack:** TypeScript (strict), Node ≥ 20, Vitest (test runner), fast-check (property-based testing), tsx (dev runner). Package manager: npm. No runtime dependencies in the engine itself.

## Living Document Contract

This plan is a living document. Every executing agent MUST update it as
execution progresses, not only at completion.

- **On phase claim:** the executor MUST flip the banner to 🚧 IN PROGRESS
  with a claim timestamp (ISO 8601 UTC) and the active branch name. The
  banner MUST NOT include an expected-completion estimate — agents cannot
  reliably estimate their own wall-clock, and a fabricated duration
  becomes a stale anchor that misleads future readers. Followers
  encountering a 🚧 banner determine liveness by observable signals (PR
  existence, recent branch commits), not by arithmetic on expected times.
  See Step 5's stale-claim reclaim protocol.
- **On phase ship:** the executor MUST update that phase's **Execution
  Status** banner with the shipped commit SHA(s) and date. If a PR is
  open, the PR number and URL MUST appear in the top-of-plan Execution
  Status table.
- **On phase defer:** the executor MUST update the banner with ⏸ status
  AND a prose description of the unblock condition + a link to the
  likely-unblocker artifact (plan page, task, or PR whose own Execution
  Status banner will signal completion). Prose + link is durable across
  paraphrases and scope edits; exact-string coordination between agents
  is not.
- **On PR merge:** the executor MUST record the merge SHA in the banner
  + the top-of-plan Execution Status table.
- **On deviation from the written plan** (scope edits, structural
  refactors, dropped tasks, reordered phases): the executor MUST
  inline-document the deviation in the affected task AND summarize it
  in the top-of-plan Execution Status as a "Deviations" subsection.
  Deviation state MUST NOT live only in PR notes or status reports.
- **On discovery** (pre-existing drift surfaced during execution, new
  bugs found, architectural issues noted): the executor MUST add a
  "Discoveries" subsection at the top of the plan with pointers to the
  files/lines affected. Follow-up dispatches read this subsection to
  avoid duplicate discovery work.

The plan SHOULD reflect reality at the end of every session that touches
it. Anything worth putting in a status report to the user is worth
putting in the plan.

Rationale: `/writing-plans-enhanced` Step 5. Writing at ship time is
cheap; reconstruction by downstream readers is expensive, compounds
across dispatches, and fails silently when state is split across PR
notes and commit messages.

---

## Execution Status

**Overall:** ✅ 8/8 phases shipped — M1 complete. 219 tests green, strict typecheck clean. 1000-game acceptance (2–6 players): all terminate (0 cap hits), 0 illegal actions, 242 iron victories / 758 empty-coalition mutual-eliminations, max 3 turns.

| Phase | Status | Ship SHA(s) | Notes |
|---|---|---|---|
| 0 — Project scaffold + conventions | ✅ Shipped | `46a710b`,`8aac650`,`cea5532`,`60b9405` | scaffold, lockfile, pitfalls, types+config |
| 1 — RNG | ✅ Shipped | `7e1872b` | PCG32, reference-verified |
| 2 — Geometry | ✅ Shipped | `01a6013`,`c4dba16`,`70291d6`,`244cdcd` | cube, hexline, hull (R1/R3), sightline (R2) |
| 3 — Board | ✅ Shipped | `87f56f4`,`1ad4633`,`98dc3fc` | shape, iron-CSP (200-seed property test), generate/load |
| 4 — Territory / control | ✅ Shipped | `4051191`,`bbb08df` | control() both regimes (board-bounded), mkState helper |
| 5 — Rules engine | ✅ Shipped | `93c0271`,`92855dc`,`86277b2`,`7cb4e7d`,`029782e`,`6249299`,`543b34b`,`50f62a4` | build, combat, apply(build/attack), stranded, status/victory, legalActions, turn |
| 6 — Greedy-weighted agent | ✅ Shipped | `360550a`,`a9795ee` | move scoring, archetype agent (softmax, greedy multi-placement, defensive reserve) |
| 7 — Driver + acceptance | ✅ Shipped | `082da5b`,`9fa25ed` | driver + result records, 1000-game acceptance (all terminate, 0 illegal) |

### Deviations
- Task 0.1: also committed `package-lock.json` (the task's literal `git add` list omitted it). Reproducible installs need the lockfile; included it rather than leave it untracked.

### Discoveries
- **Generated board is a 93-hex asymmetric oval** (Task 3.1 used ASPECT 1.3, size 96 → 93 land hexes, max ring depth 4). Several hand-picked coordinates in plan test snippets are OFF-board — e.g. `(0,5,-5)` and `(8,-8,0)`. Phase 5 tasks that hand-pick hex coordinates in tests MUST either (a) pick interior on-board coords (known on-board: `(0,0,0)`,`(2,-2,0)`,`(4,-4,0)`,`(5,-5,0)`,`(0,4,-4)`; known off-board: `(0,5,-5)`,`(8,-8,0)`,`(6,-6,0)` is on-board), or (b) use `mkState`'s `iron`/base unioning so referenced hexes are guaranteed on-board. Off-board base coords still "work" for radiating-distance fixtures (control board-intersects), but assertions about controlled `hexes` must target on-board coords. Verify a coord is on-board before asserting it's controlled.
- Task 4.1: corrected `control()` to board-intersect the radiating disk per spec §7 (it initially returned the raw disk); R3 test target moved from off-board `(0,5,-5)` to on-board `(0,4,-4)` (commit `bbb08df`).
- **MAJOR (Task 7.1): greedy-agent games degenerate to turn-3 mutual elimination.** With the current greedy archetype agents, games end fast by *double-elimination*: agents spam factories (a myopic scorer treats a 4th base as iron-LOSING when switching from radiating disks to an enclosed hull, so it avoids the perimeter regime), the shared 36-factory pool crosses 18 placed factories within ~3 turns, and the `brokenPerimeterAt18Factories` rule eliminates every still-radiating (`<4`-base) player simultaneously → `status()` returns the empty-coalition `last-standing` terminal (`winnerOrCoalition: []`). This is NOT an engine bug (no illegal actions; legality guard never fires; spec-sanctioned terminal) — it is (a) the exact M1-agent limitation the agent-roadmap predicted ("myopic per-move scorer handles the 4th-base timing decision badly"), and (b) a genuine balance signal: the 18-factory death rule + shared pool + factory-preferring play → universal mutual elimination (relevant to the design-critique's concern about that rule). **Resolution for M1:** the acceptance test (7.2) asserts the engine-validation invariants (all games terminate within the cap, zero illegal actions across 2–6 players) and records the victory-type distribution as the finding; meaningful winners require the stronger (lookahead) agent or scoring re-tuning, both deferred per the roadmap. This is the simulator doing its job — surfacing a gross structural outcome. **Actual 1000-game result (2–6P):** 242 iron victories (24%, a real winner reaches 10 iron — concentrated in higher player counts) vs. 758 empty-coalition mutual-eliminations (76%, concentrated in 2-player), all by turn 3, 0 cap hits. So the degeneration is partial, not total — meaningful iron victories DO occur — but the turn-3 mass-elimination clock (18-factory rule + factory-spamming) dominates pacing. Concrete follow-ups when tuning the agent / revisiting balance: (a) give the scorer a forward-looking incentive to reach the 4-base perimeter even at a transient iron dip; (b) reconsider whether `brokenPerimeterAt18Factories` firing on the *shared* placed-factory count (vs. per-player) is intended — it couples all players' clocks.

---

## Conventions Applied to EVERY Task

These conventions are part of every task below by reference. Executors MUST apply them to each task; they are not repeated per-task to keep the plan scannable.

**TDD (mandatory, every task that writes code):**
```
BEFORE starting work:
1. Invoke /superpowers:test-driven-development
2. Read docs/pitfalls/testing-pitfalls.md
Follow TDD: write failing test → run it red → implement minimal code → run it green.

BEFORE marking this task complete:
1. Review the tests against docs/pitfalls/testing-pitfalls.md
2. Verify coverage (error paths? edge cases? boundary values?)
3. Run the full test suite and confirm green
```

**Assertion rigor (mandatory for any timing/property/randomized test):**
```
If a test assertion flakes or fails nondeterministically, the fix is
deterministic control of inputs (fix the seed, fix the board fixture) —
NOT assertion removal or weakening. Property tests that find a
counterexample MUST be investigated as real bugs, never silenced by
narrowing the generator to dodge the case. If you cannot make an
assertion pass deterministically, STOP and raise it. Commit subjects that
touch assertions MUST say "add" / "strengthen" / "preserve" / "weaken
(rationale)" — never vague "test stabilization".
```

**End of each phase (logical group):**
```
After completing this phase:
Review the batch from multiple perspectives. Minimum 3 review rounds.
If round 3 still finds issues, keep going until clean.
Then update this plan's Execution Status banner + table for the phase.
```

**Global do-NOT boundaries (apply everywhere):**
- Do NOT add runtime dependencies to the engine packages (geometry/board/engine). Test-only dev deps (vitest, fast-check) are fine.
- Do NOT introduce mutable shared state. State transitions return new `GameState` values.
- Do NOT use `Math.random()` anywhere. All randomness goes through the PRNG from Phase 1.
- Do NOT use floating-point hex coordinates in stored state. Cube coords are integers; floats appear only transiently inside geometry algorithms.
- Do NOT widen `tsconfig` strictness or disable lint rules to make code compile. Fix the types.

---

## Phase 0 — Project Scaffold + Conventions

**Execution Status:** ✅ SHIPPED on 2026-05-27 (commits `46a710b` scaffold, `8aac650` lockfile, `cea5532` pitfalls content, `60b9405` types+config; branch `claude/document-game-design-VpqqB`)

Establishes the buildable/testable project and the pitfalls docs the later phases' TDD mandate references.

### Task 0.1: Initialize the TypeScript project

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `src/index.ts` (empty barrel, `export {}`)

- [ ] **Step 1: Create `package.json`**
```json
{
  "name": "industrial-juggernaut-engine",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "fast-check": "^3.20.0",
    "tsx": "^4.16.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`** (strict)
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "outDir": "dist",
    "declaration": true,
    "skipLibCheck": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
```

- [ ] **Step 4: Create `.gitignore`** with `node_modules/` and `dist/`.

- [ ] **Step 5: Install and verify**

Run: `npm install && npm run typecheck`
Expected: install succeeds; typecheck passes with no errors.

- [ ] **Step 6: Commit**
```bash
git add package.json tsconfig.json vitest.config.ts .gitignore src/index.ts
git commit -m "chore: scaffold TypeScript engine project"
```

### Task 0.2: Populate project-specific sections of the existing pitfalls docs

`docs/pitfalls/implementation-pitfalls.md` and `docs/pitfalls/testing-pitfalls.md` ALREADY EXIST (created by `project-init` with the universal maintenance framework, the ORCH-1 orchestration entry, and seven universal testing disciplines). Do NOT recreate them. Add the engine-specific content into the TODO-placeholder sections, following the docs' own maintenance framework (assign IDs, update the TOC and Appendix B summary table in implementation-pitfalls.md).

**Files:**
- Modify: `docs/pitfalls/implementation-pitfalls.md` (replace the `Section 1: EXAMPLE-DOMAIN-1` placeholder with a real `Geometry & Engine` domain section; update TOC + Appendix B)
- Modify: `docs/pitfalls/testing-pitfalls.md` (replace the `## 8. TODO — Project-Specific Topic` placeholder with a real `## 8. Engine Determinism & Geometry` section)

- [ ] **Step 1: Add the implementation-pitfalls domain section.** Rename `Section 1: EXAMPLE-DOMAIN-1` to `Section 1: Geometry & Engine` and add these entries using the doc's `Flaw → Why → Fix → Lesson` (or condensed) format, with IDs `GEO-1`..`GEO-5`:
  - **GEO-1 Floating point in convex hull / point-in-polygon.** Hex centers project to floats; use epsilon `1e-9` on orientation tests and treat on-edge as inside (Resolution R1). Never compare projected floats with `===`.
  - **GEO-2 Hex rounding.** Cube-lerp endpoints must be rounded with standard cube-round (reset the component with the largest rounding delta) to stay on the integer lattice.
  - **GEO-3 PRNG state threading.** Every consumer of randomness returns the advanced PRNG state; never reuse a pre-draw state or two draws collide. No `Math.random()` anywhere.
  - **GEO-4 Set membership on `Hex`.** `Hex` is a value, not a reference — key sets/maps by canonical string `"x,y,z"`, never by object identity.
  - **GEO-5 Perimeter is derived, never stored.** Recompute from bases; do not cache a perimeter that base mutations could invalidate.
  Then update the TOC row (§1 → `Geometry & Engine`, entries `GEO-1 – GEO-5`) and add the five rows to the Appendix B summary table.

- [ ] **Step 2: Add the testing-pitfalls topic section.** Replace `## 8. TODO — Project-Specific Topic` with `## 8. Engine Determinism & Geometry`, containing these `- [ ]` checklist items:
  - **Seed every randomized test.** Any test touching the PRNG, board generation, or combat MUST pass a fixed seed; a test that passes only sometimes is a defect — never loosen the assertion to hide it.
  - **Property tests assert invariants, not example outputs.** Use fast-check for "for all legal states/actions, property P holds"; treat any counterexample as a real defect, never narrow the generator to dodge it.
  - **Structural assertions over substring.** Compare hex sets by normalized sorted arrays, not stringified blobs.
  - **Test regime-boundary values explicitly.** Resource counts 1/2/3/4; base counts 3↔4 (radiating↔perimeter switch); commitment levels 3/4/5/6; factory count crossing 18 (late-game elimination).
  - **Replay equivalence is asserted.** `(seed, action-sequence)` must reproduce an identical final state — assert structural equality of the whole `GameState`, not a hash alone.

- [ ] **Step 3: Commit**
```bash
git add docs/pitfalls/implementation-pitfalls.md docs/pitfalls/testing-pitfalls.md
git commit -m "docs: add engine-specific geometry/determinism pitfalls"
```

### Task 0.3: Define core types and `RuleConfig`

**Files:**
- Create: `src/engine/types.ts`
- Create: `src/engine/config.ts`
- Test: `test/engine/config.test.ts`

- [ ] **Step 1: Write the failing test** (`test/engine/config.test.ts`)
```ts
import { describe, it, expect } from "vitest";
import { defaultConfig } from "../../src/engine/config";

describe("defaultConfig", () => {
  it("matches the rules-faithful defaults", () => {
    const c = defaultConfig();
    expect(c.radius).toBe(5);
    expect(c.placeRange).toBe(5);
    expect(c.attackRange).toBe(6);
    expect(c.baseLimit).toBe(12);
    expect(c.factorySupply).toBe(36);
    expect(c.ironCount).toBe(14);
    expect(c.victoryThreshold).toBe(10);
    expect(c.brokenPerimeterDeathAtFactories).toBe(18);
    expect(c.autoWinAt6).toBe(true);
    expect(c.killBounty).toBe("full");
    expect(c.allowPass).toBe(false);
    expect(c.combatTable[3]).toBeCloseTo(0.75, 5);
    expect(c.combatTable[4]).toBeCloseTo(5 / 6, 5);
    expect(c.combatTable[5]).toBeCloseTo(8 / 9, 5);
    expect(c.combatTable[6]).toBe(1);
  });
});
```
Note the locked decisions: `allowPass=false` (spec §16 option b), `killBounty="full"`.

- [ ] **Step 2: Run it red.** Run: `npx vitest run test/engine/config.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/engine/types.ts`.** Open the committed spec `docs/superpowers/specs/2026-05-27-rules-engine-m1-design.md` §4 (it is in the repo — read it; do not reconstruct from memory) and transcribe its type declarations verbatim into `src/engine/types.ts`, exporting each: `Hex`, `PlayerId`, `PieceKind`, `BaseState`, `Base`, `Factory`, `Board`, `BoardDefinition`, `Player`, `Phase`, `GameState`, `Action`, `AttackDecl`, `GameEvent`, `EliminationCause`. Where the spec gives a field comment (e.g. `order` = placement sequence), keep it. Then write `src/engine/config.ts` with:
```ts
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
  victoryThreshold: 10, brokenPerimeterDeathAtFactories: 18,
  allowPass: false,
});
```

- [ ] **Step 4: Run it green.** Run: `npx vitest run test/engine/config.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/engine/types.ts src/engine/config.ts test/engine/config.test.ts
git commit -m "feat: core engine types and rules-faithful default config"
```

---

## Phase 1 — RNG

**Execution Status:** ✅ SHIPPED on 2026-05-27 (commit `7e1872b`; PCG32 verified against canonical reference vectors)

Deterministic seeded PRNG. Everything stochastic depends on this.

### Task 1.1: PCG32 PRNG with explicit state

**Files:**
- Create: `src/rng/pcg.ts`
- Test: `test/rng/pcg.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from "vitest";
import { seed, nextUint32, nextFloat, nextInt, type RngState } from "../../src/rng/pcg";

describe("pcg", () => {
  it("is deterministic for a seed", () => {
    const a = seq(seed(42n), 5);
    const b = seq(seed(42n), 5);
    expect(a).toEqual(b);
  });
  it("differs across seeds", () => {
    expect(seq(seed(1n), 5)).not.toEqual(seq(seed(2n), 5));
  });
  it("nextFloat is in [0,1)", () => {
    let s = seed(7n);
    for (let i = 0; i < 1000; i++) { const r = nextFloat(s); expect(r.value).toBeGreaterThanOrEqual(0); expect(r.value).toBeLessThan(1); s = r.state; }
  });
  it("nextInt(s,n) is in [0,n) and unbiased-ish over many draws", () => {
    let s = seed(9n); const counts = new Array(6).fill(0);
    for (let i = 0; i < 60000; i++) { const r = nextInt(s, 6); counts[r.value]++; s = r.state; }
    for (const c of counts) expect(c).toBeGreaterThan(8000); // each ~10000
  });
});
function seq(s0: RngState, n: number): number[] {
  let s = s0; const out: number[] = [];
  for (let i = 0; i < n; i++) { const r = nextUint32(s); out.push(r.value); s = r.state; }
  return out;
}
```

- [ ] **Step 2: Run it red.** Run: `npx vitest run test/rng/pcg.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/rng/pcg.ts`** — PCG32 with `RngState = { state: bigint; inc: bigint }`. Pure functions returning `{ value, state }`:
  - `seed(s: bigint, seq = 54n): RngState`
  - `nextUint32(s): { value: number; state: RngState }` — standard PCG32 advance.
  - `nextFloat(s): { value: number; state }` = `value / 2**32`.
  - `nextInt(s, n): { value: number; state }` — rejection sampling to avoid modulo bias.
  Do NOT use `Math.random`. Keep all 32/64-bit math in `bigint` masked to 64 bits.

- [ ] **Step 4: Run it green.** Run: `npx vitest run test/rng/pcg.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/rng/pcg.ts test/rng/pcg.test.ts
git commit -m "feat: deterministic PCG32 PRNG with explicit state"
```

---

## Phase 2 — Geometry

**Execution Status:** ⬜ NOT STARTED

Cube-coordinate math, hex line rasterization, convex hull, point-in-hull, and the sight-line blocking test. Resolutions R1 (hull interior, on-edge = inside) and R2 (block only on open-interior crossing) are implemented here.

**Execution Status:** ✅ SHIPPED on 2026-05-27 (commits `01a6013` cube, `c4dba16` hexline, `70291d6` hull/R1/R3, `244cdcd` sightline/R2; 30 tests green)

### Task 2.1: Cube coordinate math

**Files:**
- Create: `src/geometry/cube.ts`
- Test: `test/geometry/cube.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from "vitest";
import { hex, key, distance, neighbors, add } from "../../src/geometry/cube";

describe("cube", () => {
  it("enforces x+y+z=0 via constructor", () => {
    const h = hex(1, -1, 0); expect(h.x + h.y + h.z).toBe(0);
    expect(() => hex(1, 1, 1)).toThrow();
  });
  it("distance", () => {
    expect(distance(hex(0,0,0), hex(0,0,0))).toBe(0);
    expect(distance(hex(0,0,0), hex(3,-3,0))).toBe(3);
    expect(distance(hex(0,0,0), hex(2,-1,-1))).toBe(2);
  });
  it("has 6 neighbors all at distance 1", () => {
    const ns = neighbors(hex(0,0,0));
    expect(ns).toHaveLength(6);
    for (const n of ns) expect(distance(hex(0,0,0), n)).toBe(1);
  });
  it("key is canonical for value equality", () => {
    expect(key(hex(1,-1,0))).toBe(key(add(hex(0,-1,1), hex(1,0,-1))));
  });
});
```

- [ ] **Step 2: Run red, Step 3: implement `src/geometry/cube.ts`:**
  - `hex(x,y,z)` throws unless `x+y+z===0`.
  - `key(h) = ` `${h.x},${h.y},${h.z}``.
  - `distance(a,b) = (|ax-bx|+|ay-by|+|az-bz|)/2`.
  - `add(a,b)`, `subtract(a,b)`, `neighbors(h)` (six unit directions).
  Use `key` for all Set/Map membership (implementation-pitfall: never object identity).

- [ ] **Step 4: green. Step 5: commit** `feat: cube coordinate math`.

### Task 2.2: Hex line rasterization

**Files:**
- Create: `src/geometry/hexline.ts`
- Test: `test/geometry/hexline.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { hex, key } from "../../src/geometry/cube";
import { hexLine } from "../../src/geometry/hexline";

describe("hexLine", () => {
  it("includes both endpoints and is contiguous of length distance+1", () => {
    const line = hexLine(hex(0,0,0), hex(3,-3,0));
    expect(line.map(key)[0]).toBe(key(hex(0,0,0)));
    expect(line.map(key).at(-1)).toBe(key(hex(3,-3,0)));
    expect(line).toHaveLength(4);
  });
  it("is symmetric as a set", () => {
    const a = new Set(hexLine(hex(0,0,0), hex(2,-3,1)).map(key));
    const b = new Set(hexLine(hex(2,-3,1), hex(0,0,0)).map(key));
    expect(a).toEqual(b);
  });
});
```

- [ ] **Steps 2-4:** implement `hexLine(a,b)` via cube-lerp over `distance(a,b)+1` samples with cube-round (reset largest-delta component). See implementation-pitfalls "Hex rounding". Commit `feat: hex line rasterization`.

### Task 2.3: Convex hull + point-in-hull (R1)

**Files:**
- Create: `src/geometry/hull.ts`
- Test: `test/geometry/hull.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { hex } from "../../src/geometry/cube";
import { convexHull, hexInHull, hullArea } from "../../src/geometry/hull";

describe("hull", () => {
  const square = [hex(0,0,0), hex(3,-3,0), hex(3,0,-3), hex(0,3,-3)];
  it("on-edge counts as inside (R1)", () => {
    // a hex whose center lies on the hull boundary
    expect(hexInHull(hex(3,-3,0), convexHull(square))).toBe(true);
  });
  it("strictly interior point is inside", () => {
    expect(hexInHull(hex(1,-1,0), convexHull(square))).toBe(true);
  });
  it("exterior point is outside", () => {
    expect(hexInHull(hex(5,-5,0), convexHull(square))).toBe(false);
  });
  it("colinear points produce zero area (R3 signal)", () => {
    expect(hullArea(convexHull([hex(0,0,0), hex(1,-1,0), hex(2,-2,0)]))).toBe(0);
  });
});
```

- [ ] **Steps 2-4:** implement `convexHull(points)` (Graham scan over hex centers projected to the plane by the fixed pointy-top map `px = sqrt(3) * (x + z/2)`, `py = 1.5 * z`, where `(x,y,z)` is the cube coord; document this projection in a comment), `hexInHull(h, hull)` with on-edge = inside and epsilon `1e-9` (implementation-pitfall GEO-1: float orientation), `hullArea(hull)` (shoelace on the projected vertices; returns 0 for a degenerate/colinear hull). Commit `feat: convex hull, point-in-hull (R1), hull area`.

### Task 2.4: Sight-line blocking (R2)

**Files:**
- Create: `src/geometry/sightline.ts`
- Test: `test/geometry/sightline.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { hex, key } from "../../src/geometry/cube";
import { segmentBlocked } from "../../src/geometry/sightline";

describe("segmentBlocked (R2: block only on open-interior crossing)", () => {
  it("blocked when a blocker hex lies strictly between endpoints", () => {
    const blockers = new Set([key(hex(1,-1,0))]);
    expect(segmentBlocked(hex(0,0,0), hex(2,-2,0), blockers)).toBe(true);
  });
  it("endpoints themselves never count as blockers", () => {
    const blockers = new Set([key(hex(0,0,0)), key(hex(2,-2,0))]);
    expect(segmentBlocked(hex(0,0,0), hex(2,-2,0), blockers)).toBe(false);
  });
  it("a corner-grazing blocker does not block", () => {
    // choose a,b whose segment touches a hex vertex but does not cross its interior;
    // document the chosen geometry in a code comment.
    const blockers = new Set([key(hex(1,0,-1))]);
    expect(segmentBlocked(hex(0,0,0), hex(2,-1,-1), blockers)).toBe(false);
  });
});
```

- [ ] **Steps 2-4:** implement `segmentBlocked(a,b,blockerKeys)` testing whether the open segment crosses the *interior* of any blocker hex (exclude endpoints). Use a center-to-center segment vs. hex-cell interior test with epsilon. Document the corner-grazing convention inline. Commit `feat: sight-line blocking with corner-graze convention (R2)`.

**End of Phase 2:** run the 3-round phase review; update Execution Status.

---

## Phase 3 — Board

**Execution Status:** ⬜ NOT STARTED

Board as data: an oval generator + a fixed-board loader sharing one `Board` type. Iron CSP: 14 iron, none in outer two rings, max-degree-1 adjacency.

**Execution Status:** ✅ SHIPPED on 2026-05-27 (commits `87f56f4` shape, `1ad4633` iron-CSP, `98dc3fc` generate/load; 43 tests green, iron CSP property-tested over 200 seeds)

### Task 3.1: Oval board shape + ring computation

**Files:**
- Create: `src/board/shape.ts`
- Test: `test/board/shape.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { ovalHexes, ringDepthFromEdge } from "../../src/board/shape";

describe("board shape", () => {
  it("produces close to the requested hex count", () => {
    const hexes = ovalHexes(96);
    expect(hexes.length).toBeGreaterThanOrEqual(90);
    expect(hexes.length).toBeLessThanOrEqual(102);
  });
  it("ringDepthFromEdge is 0 on the boundary and grows inward", () => {
    const hexes = ovalHexes(96);
    const depths = hexes.map((h) => ringDepthFromEdge(h, hexes));
    expect(Math.min(...depths)).toBe(0);
    expect(Math.max(...depths)).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Steps 2-4:** implement `ovalHexes(size)` (parameterized oval over an axial bounding region, trimmed to an ellipse to hit ~size) and `ringDepthFromEdge(h, boardSet)` (BFS distance to the nearest non-board hex minus 1, i.e. how many rings in from the edge). Document the ellipse parameterization. Commit `feat: oval board shape and edge-ring depth`.

### Task 3.2: Iron CSP placement

**Files:**
- Create: `src/board/iron-csp.ts`
- Test: `test/board/iron-csp.test.ts`

- [ ] **Step 1: Failing test (property-based)**
```ts
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { seed } from "../../src/rng/pcg";
import { ovalHexes, ringDepthFromEdge } from "../../src/board/shape";
import { placeIron } from "../../src/board/iron-csp";
import { distance, key } from "../../src/geometry/cube";

describe("placeIron CSP", () => {
  const board = ovalHexes(96);
  it("for any seed: 14 iron, none in outer 2 rings, max-degree-1 adjacency", () => {
    fc.assert(fc.property(fc.bigInt({ min: 0n, max: 100000n }), (s) => {
      const { iron } = placeIron(seed(s), board, 14);
      expect(iron).toHaveLength(14);
      for (const h of iron) expect(ringDepthFromEdge(h, board)).toBeGreaterThanOrEqual(2);
      const set = new Set(iron.map(key));
      for (const h of iron) {
        const adj = iron.filter((o) => o !== h && distance(h, o) === 1);
        expect(adj.length).toBeLessThanOrEqual(1); // max degree 1
        void set;
      }
    }), { numRuns: 200 });
  });
});
```

- [ ] **Steps 2-4:** implement `placeIron(rng, boardHexes, count)` returning `{ iron, rng }` via sequential placement: shuffle eligible hexes (ringDepth ≥ 2) with the PRNG, accept a candidate iff it has ≤1 existing iron neighbor AND adding it keeps every existing neighbor at ≤1; restart with a fresh shuffle if it cannot reach `count` (bounded retries; throw after a documented cap so an impossible config fails loudly rather than looping). Commit `feat: iron CSP placement (max-degree-1, ring constraint)`.

### Task 3.3: `generateBoard` and `loadBoard`

**Files:**
- Create: `src/board/generate.ts`, `src/board/load.ts`
- Test: `test/board/board.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { seed } from "../../src/rng/pcg";
import { generateBoard } from "../../src/board/generate";
import { loadBoard } from "../../src/board/load";
import { key } from "../../src/geometry/cube";

describe("board sources", () => {
  it("generateBoard is deterministic for a seed", () => {
    const a = generateBoard(seed(5n), { size: 96, ironCount: 14 });
    const b = generateBoard(seed(5n), { size: 96, ironCount: 14 });
    expect(a.board.hexes.map(key)).toEqual(b.board.hexes.map(key));
    expect(a.board.iron.map(key)).toEqual(b.board.iron.map(key));
  });
  it("loadBoard round-trips a fixed definition", () => {
    const def = { hexes: [{x:0,y:0,z:0},{x:1,y:-1,z:0}], iron: [{x:1,y:-1,z:0}] };
    const board = loadBoard(def);
    expect(board.hexes.map(key)).toEqual(["0,0,0","1,-1,0"]);
    expect(board.iron.map(key)).toEqual(["1,-1,0"]);
  });
  it("loadBoard rejects iron not in hexes", () => {
    expect(() => loadBoard({ hexes: [{x:0,y:0,z:0}], iron: [{x:9,y:-9,z:0}] })).toThrow();
  });
});
```

- [ ] **Steps 2-4:** `generateBoard(rng, params)` composes `ovalHexes` + `placeIron`, returns `{ board, rng }`. `loadBoard(def)` validates (every hex satisfies `x+y+z=0`; iron ⊆ hexes; no duplicates) and returns `Board`. Commit `feat: generateBoard + loadBoard board sources`.

**End of Phase 3:** 3-round review; update Execution Status.

---

## Phase 4 — Territory / Control

**Execution Status:** ✅ SHIPPED on 2026-05-27 (commits `4051191` control+mkState, `bbb08df` board-intersect fix; 49 tests green)

`control(state, player)` for both regimes (R3 degenerate handling), plus `resourceCount`.

### Task 4.1: control() radiating + perimeter

**Files:**
- Create: `src/engine/control.ts`
- Test: `test/engine/control.test.ts`

- [ ] **Step 1: Failing test** (uses small hand-built states; helper `mkState` lives in `test/helpers/state.ts`, created in this task)
```ts
import { describe, it, expect } from "vitest";
import { hex, key } from "../../src/geometry/cube";
import { control, resourceCount } from "../../src/engine/control";
import { mkState } from "../helpers/state";

describe("control", () => {
  it("radiating: union of 5-hex disks for <4 bases", () => {
    const s = mkState({ board: 96, basesP0: [hex(0,0,0)] });
    const ctl = control(s, 0);
    expect(ctl.hexes.has(key(hex(0,0,0)))).toBe(true);
    expect(ctl.hexes.has(key(hex(5,-5,0)))).toBe(true);
    expect(ctl.hexes.has(key(hex(6,-6,0)))).toBe(false);
  });
  it("two still-radiating players both control a shared overlap iron", () => {
    // p0 base (0,0,0), p1 base (8,-8,0); iron (4,-4,0) is distance 4 from each (<= radius 5).
    const s = mkState({ board: 96, basesP0: [hex(0,0,0)], basesP1: [hex(8,-8,0)], iron: [hex(4,-4,0)] });
    expect(control(s, 0).iron.map(key)).toContain(key(hex(4,-4,0)));
    expect(control(s, 1).iron.map(key)).toContain(key(hex(4,-4,0)));
  });
  it("perimeter regime activates at 4 bases (R1 interior)", () => {
    const s = mkState({ board: 96, basesP0: [hex(0,0,0),hex(4,-4,0),hex(4,0,-4),hex(0,4,-4)] });
    expect(control(s,0).hexes.has(key(hex(2,-2,0)))).toBe(true);
  });
  it("R3: colinear 4 bases => no enclosed territory, falls back to radiating", () => {
    const s = mkState({ board: 96, basesP0: [hex(0,0,0),hex(1,-1,0),hex(2,-2,0),hex(3,-3,0)] });
    // radiating union should still include a hex off the line within radius
    expect(control(s,0).hexes.has(key(hex(0,5,-5)))).toBe(true);
  });
});
```

- [ ] **Steps 2-4:** implement `control(state, player)` → `{ hexes:Set<string>; iron:Hex[]; factories:Hex[] }`. If `basesOnBoard < 4` OR hull area is 0 (R3) → union of disks; else hull interior. Intersect with `state.board.hexes`. Iron/factories are board hexes/pieces whose key ∈ controlled set. Also write the `test/helpers/state.ts` `mkState(opts)` builder used by this and all Phase 5 tests; `opts` fields: `board` (size passed to `generateBoard` with a fixed seed), `basesP0`/`basesP1`/… (arrays of `Hex` placed as fresh bases for each player, `order` assigned by array index), `iron` (optional `Hex[]` overriding the generated iron for deterministic fixtures), `factories` (optional `Hex[]`), `config` (defaults to `defaultConfig()`). `resourceCount(state,player) = control.iron.length + control.factories.length`.
  - Do NOT make `control` exclusive for radiating players (overlaps are shared); exclusivity only applies when a perimeter encloses a resource (handled at the consumer level in Phase 5 victory/resource credit — for M1, shared radiating overlap is acceptable and matches spec §7).

- [ ] **Step 5: Commit** `feat: territory control for radiating and perimeter regimes`.

**End of Phase 4:** 3-round review; update Execution Status.

---

## Phase 5 — Rules Engine

**Execution Status:** ⬜ NOT STARTED

The heart: legality, `applyAction`, combat, victory/elimination, perimeter reassessment, stranded bases, move generation. Largest phase — split into ordered tasks; each consumes types/functions from earlier tasks.

**Execution Status:** ✅ SHIPPED on 2026-05-27 (commits `93c0271` build, `92855dc` combat, `86277b2` apply-build, `7cb4e7d` apply-attack, `029782e` stranded, `6249299` status/victory, `543b34b` legalActions, `50f62a4` turn; 182 tests green)

**Phase 5 task format.** Tasks 5.1, 5.3, 5.4, 5.5, 5.6, 5.8 are specified at the *behavior + signature* level rather than with full test code (a whole engine's worth of test code does not fit one plan). For each, the executor MUST first write complete failing tests covering EVERY enumerated behavior bullet (bite-sized TDD per the Conventions block) before implementing — using the `mkState` builder from Task 4.1 for fixtures, the seeded PRNG for any randomness, and the testing-pitfalls §8 checklist. Each task depends on the exports of all earlier Phase 5 tasks plus Phase 4 `control`; implement them in listed order. A task is not done until its tests are green AND every enumerated behavior has at least one asserting test.

### Task 5.1: Build legality + build budget

**Files:**
- Create: `src/engine/build.ts`
- Test: `test/engine/build.test.ts`

- [ ] **Step 1: Failing test** covering:
  - budget = `floor(resourceCount/2)`; bootstrap = 1 factory when `<4` bases, 1 iron controlled, 0 factories.
  - factory placement: empty non-iron hex within `placeRange` of farthest base; R4 ties → any tied base.
  - base placement outside perimeter: within `placeRange` of a friendly base, not inside opponent perimeter, forms an unobstructed triangle with two friendly bases (`segmentBlocked` false to two).
  - one-type-per-round enforced.
Provide concrete `mkState` fixtures and `expect(isLegalBuild(...))` true/false assertions for each.

- [ ] **Steps 2-4:** implement `buildBudget(state,player)`, `isLegalFactoryPlacement`, `isLegalBasePlacement`, `farthestBases(state,player)` (returns all tied). Commit `feat: build legality and budget`.

### Task 5.2: Combat resolution

**Files:**
- Create: `src/engine/combat.ts`
- Test: `test/engine/combat.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { seed } from "../../src/rng/pcg";
import { resolveCombat } from "../../src/engine/combat";
import { defaultConfig } from "../../src/engine/config";

describe("resolveCombat", () => {
  it("commit 6 is automatic", () => {
    expect(resolveCombat(seed(1n), 6, defaultConfig()).attackerWon).toBe(true);
  });
  it("empirical win-rate matches the table within tolerance", () => {
    for (const commit of [3,4,5] as const) {
      let s = seed(123n), wins = 0; const N = 20000;
      for (let i=0;i<N;i++){ const r = resolveCombat(s, commit, defaultConfig()); if (r.attackerWon) wins++; s = r.state; }
      expect(wins/N).toBeCloseTo(defaultConfig().combatTable[commit], 1);
    }
  });
});
```

- [ ] **Steps 2-4:** `resolveCombat(rng, commit, config) → { attackerWon, state }`. For commit 6 with `autoWinAt6`, return true without drawing. Else draw `nextFloat < combatTable[commit]`. Commit `feat: combat resolution (closed-form Bernoulli)`.

### Task 5.3: applyAction — build

**Files:** Create `src/engine/apply.ts`; Test `test/engine/apply-build.test.ts`.

- [ ] TDD: placing factories decrements `factorySupply` and adds `Factory`; placing bases decrements `basesInHand` and adds fresh `Base` with incremented `order`; illegal actions throw; emits `placed` events. Greedy multi-piece placement is the agent's job — `applyAction` applies the full `pieces[]` array atomically and re-validates each against the state *as mutated so far this action*. Commit `feat: applyAction for build actions`.

### Task 5.4: applyAction — attack, victory swap, maxed-out bases

**Files:** Modify `src/engine/apply.ts`; Test `test/engine/apply-attack.test.ts`.

- [ ] TDD: validates target is on the opponent outer hull; attackers 3–6 within `attackRange`; defender exactly 1 within range; calls `resolveCombat`; on win replaces base (or relocates one of the 12 / destroys per spec §8); fatigues all committed; emits `combat`/`baseReplaced`/`baseDestroyed`. Multi-attack: an `attack` action may carry multiple `AttackDecl`s applied in sequence while ≥3 fresh bases remain. Commit `feat: applyAction for attack, base swap, maxed-out relocation`.

### Task 5.5: Perimeter reassessment + stranded bases

**Files:** Create `src/engine/stranded.ts`; Test `test/engine/stranded.test.ts`.

- [ ] TDD: after a base change, a base visible to only one friendly base is `stranded` (outside perimeter); rescued when a new base grants two-base visibility; removed if opponent bases fully encircle it — defined as: every one of its six neighbor hexes is either occupied by an opponent base or off-board (board edge counts as a wall; document this interpretation inline, as the rules text leaves "fully encircle" unspecified at the board edge). Build the friendly-base visibility graph with `segmentBlocked` against opponent perimeters. Commit `feat: perimeter reassessment and stranded-base detection`.

### Task 5.6: Status, elimination, victory

**Files:** Create `src/engine/status.ts`; Test `test/engine/status.test.ts`.

- [ ] TDD: `status(state)` returns `{ kind: "ongoing" }` or `{ kind: "victory", players: PlayerId[], reason: "iron" | "last-standing" }`. Victory triggers when, at round end, EITHER (a) a player/coalition controls ≥ `victoryThreshold` iron (coalition = sum over members; `reason: "iron"`), OR (b) only one non-eliminated player/coalition remains (`reason: "last-standing"`). For (a) `players` is that coalition; for (b) the survivors. Check (a) before (b) when both hold in the same round. Elimination causes (`noBases`, `brokenPerimeterAt18Factories` once `36 - factorySupply ≥ 18`, `noIron`, `emptyPerimeter`) detected and applied. **Bounty:** on a non-self-destruct elimination, the player who caused it gains base tokens — `killBounty: "full"` → all 12, `"half"` → 6, `"none"` → 0 — added to the eliminator's `basesInHand`; the per-player 12 cap does NOT block bounty receipt (an eliminator's pool grows past 12, per the rules' "+12 when you eliminate a player"). `emptyPerimeter` self-destruct gives no bounty to anyone. Commit `feat: status, elimination causes, victory check`.

### Task 5.7: legalActions move generation

**Files:** Create `src/engine/legal.ts`; Test `test/engine/legal.test.ts`.

- [ ] **Step 1: Failing test** asserting, on small fixtures:
  - every returned action passes its own legality predicate;
  - build actions enumerate single legal placements (multi-piece composed by the agent, not here);
  - attacks enumerate `(target, attacker-subset by commitment level, defender)` tuples for valid targets;
  - `pass` is included **only if** `config.allowPass` OR the action set is otherwise empty (locked decision: `allowPass=false`, so pass appears only when no build/attack exists).
- [ ] **Steps 2-4:** implement `legalActions(state)`. To bound combinatorics, do NOT enumerate all attacker subsets: for each valid target and each commitment level `c` in 3..6 where the player has ≥`c` eligible bases (fresh, within `attackRange` of the target), emit ONE representative attack whose attacker subset is the `c` eligible bases nearest the target (ties broken by ascending `key(hex)`), and whose defender is the opponent's eligible base nearest the target (ties by `key(hex)`). Document this determinism rule inline. Commit `feat: legal move generation`.

### Task 5.8: Turn/round orchestration

**Files:** Create `src/engine/turn.ts`; Test `test/engine/turn.test.ts`.

- [ ] TDD: `setupGame(rng, board, nPlayers, config)` places first bases (deterministic seats spaced evenly around the outer ring); `beginTurn` draws turn order; `advanceRound` rotates to next player and refreshes all bases to fresh at the START of each turn; victory checked at the end of each round. Turn-order rules (transcribe precisely from the rules doc `industrial-juggernaut-rules-v10.md` §Turn Order — read it): **first turn** all players draw uniformly at random; **subsequent turns, 3–6P** the players who played last and second-to-last previous turn draw first from a bag of tokens #1/#2, then the rest draw for remaining slots; **2P** each player puts battle tokens into the bag equal to their current controlled-iron count and the drawn token's owner goes first. All draws use the seeded PRNG. Commit `feat: turn and round orchestration`.

**End of Phase 5:** 3-round review (this phase has the most cross-task type sharing — verify signatures match across 5.1–5.8); update Execution Status.

---

## Phase 6 — Greedy-Weighted Agent

**Execution Status:** ✅ SHIPPED on 2026-05-27 (commits `360550a` scoring, `a9795ee` archetype agent; 212 tests green)

### Task 6.1: Move scoring + static prunes

**Files:** Create `src/agent/score.ts`; Test `test/agent/score.test.ts`.

- [ ] **Step 1: Failing test** asserting:
  - `scoreMove` returns higher score for a build that increases controlled iron than one that does not;
  - the 4th-base-yielding-zero-iron move is hard-pruned (score `-Infinity`);
  - a move dropping a held iron hex is heavily penalized;
  - a factory landing outside the resulting perimeter is penalized.
- [ ] **Steps 2-4:** implement `scoreMove(state, player, move, weights)`. For **build/pass** moves, compute deltas by applying the move with `applyAction` and diffing `control()` before/after (pure; `applyAction` returns a new state and consumes no PRNG for builds). For **attack** moves, do NOT call `resolveCombat` (it draws from the PRNG and returns a random outcome) — instead compute the EXPECTED value: `P(win) = config.combatTable[commit]`; simulate the win-conditional base swap deterministically (replace the target with the attacker's base, recompute `control()`), take `resourcesGained = ΔcontrolledResources` under that win; `combat_term = P(win) * resourcesGained - fatigueCost` where `fatigueCost` is proportional to the number of committed bases. Scoring MUST be a pure function of `(state, move, weights)` with no PRNG consumption. Commit `feat: agent move scoring with static prunes`.

### Task 6.2: Archetypes, softmax choice, greedy multi-placement, defensive reserve

**Files:** Create `src/agent/greedy.ts`, `src/agent/archetypes.ts`; Test `test/agent/greedy.test.ts`.

- [ ] **Step 1: Failing test** asserting:
  - `chooseAction(state, player, archetype)` returns `{ action, state }` where `action` is a member of `legalActions(state)` (never an illegal action) and the returned `state` carries the PRNG advanced by the softmax draw (same in-`state` rng pattern as `applyAction`; the driver threads this returned state into the subsequent `applyAction`). `archetype` is the string union `"aggressive" | "economic" | "expansionist"`, resolved to a weight/temperature preset internally;
  - deterministic given seed;
  - for a multi-piece build budget, the chosen build composes placements greedily (N placements where N = budget) by repeatedly scoring single placements;
  - the defensive-reserve rule withholds one fresh base from an attack when any opponent has ≥3 fresh bases within `config.attackRange` of any of the acting player's perimeter bases (assert on a crafted fixture).
- [ ] **Steps 2-4:** implement archetype presets (the `"aggressive" | "economic" | "expansionist"` name union → weight vectors + temperature), softmax sampling via PRNG, greedy sequential placement, and the single reserve rule above. Commit `feat: greedy archetype agent`.

**End of Phase 6:** 3-round review; update Execution Status.

---

## Phase 7 — Driver + Acceptance

**Execution Status:** ✅ SHIPPED on 2026-05-27 (commits `082da5b` driver, `9fa25ed` acceptance; 219 tests green; 1000-game acceptance passes — all terminate, zero illegal actions)

### Task 7.1: Game driver + result records

**Files:** Create `src/driver/record.ts`, `src/driver/run.ts`; Test `test/driver/run.test.ts`.

**Depends on:** Task 5.8 (`setupGame`/`beginTurn`/`advanceRound`), Task 5.6 (`status`), Task 6.2 (`chooseAction`), Tasks 5.3/5.4 (`applyAction`), Task 5.7 (`legalActions`). The driver MUST assert each chosen action ∈ `legalActions(state)` before applying it (throw with the offending action + seed on violation) — this legality guarantee is what Task 7.2's acceptance check relies on.

- [ ] **Step 1: Failing test** asserting `runGame({ seed, boardSource, nPlayers, archetypes, config, turnCap })` returns a `GameResult { winnerOrCoalition: PlayerId[]; turns: number; victoryType: "iron" | "last-standing" | "none"; ironOverTime: number[][]; hitTurnCap: boolean }` (`victoryType` is `"none"` only when `hitTurnCap` is true; `ironOverTime[t][p]` = player `p`'s controlled-iron count at end of turn `t`), is deterministic for a seed, and that a 2-player game on a fixed small board terminates within the cap. `boardSource` is `{ kind: "generate", size, ironCount }` or `{ kind: "fixed", def: BoardDefinition }`. `archetypes` is a `string[]` of archetype names (see Task 6.2).
- [ ] **Steps 2-4:** implement the loop: setup → repeat (beginTurn → each player's round via the agent → victory check) until terminal or `turnCap`. Map `GameResult.victoryType` from `status().reason` on a terminal state (`"iron"`/`"last-standing"`), or `"none"` if the loop exits via `turnCap`. Record `ironOverTime` per turn (one entry per player). Commit `feat: game driver and result records`.

### Task 7.2: Acceptance — 1,000 seeded games, no illegal actions, all terminate

**Files:** Test `test/acceptance/play-many.test.ts`.

- [ ] **Step 1: Write the acceptance test**
```ts
import { describe, it, expect } from "vitest";
import { runGame } from "../../src/driver/run";
import { defaultConfig } from "../../src/engine/config";

describe("acceptance: agent plays full games", () => {
  it("1000 seeded games across 2-6 players reach a terminal state with no illegal actions", () => {
    let capHits = 0;
    for (let i = 0; i < 1000; i++) {
      const n = 2 + (i % 5);
      const res = runGame({ seed: BigInt(i), boardSource: { kind: "generate", size: 96, ironCount: 14 },
        nPlayers: n, archetypes: Array.from({length:n}, (_,k)=>["aggressive","economic","expansionist"][k%3]),
        config: defaultConfig(), turnCap: 300 });
      if (res.hitTurnCap) capHits++;
      // runGame MUST throw if the agent ever proposes an illegal action; reaching here means none did.
    }
    // cap-hits are a recorded signal, not a crash; surface the count, allow a small fraction.
    expect(capHits).toBeLessThan(50);
  });
});
```
The driver MUST assert each chosen action ∈ `legalActions` before applying (wire this assertion in `runGame`; on violation, throw with the offending action + seed).

- [ ] **Steps 2-3:** make it pass by fixing any engine/agent defects the run surfaces (do NOT raise the cap or loosen the `capHits` bound to dodge a real non-termination bug — that is the assertion-rigor rule; a stuck game is a defect to diagnose). Commit `test: acceptance harness — 1000 games terminate with legal actions`.

**End of Phase 7:** 3-round review; update Execution Status; mark Overall complete.

---

## Self-Review (writing-plans Step, completed at authoring time)

**Spec coverage:** geometry (§5)→Phase 2; board sources (§6)→Phase 3; control/regimes (§7, R1/R3)→Phases 2,4; build/attack/combat/victory/elimination/stranded (§8)→Phase 5; move-gen (§9)→Task 5.7; RNG/replay (§10)→Phases 1, all; agent (§11)→Phase 6; RuleConfig (§12)→Task 0.3; tests (§13)→every phase + Task 7.2; module layout (§14)→file paths throughout; R1–R5→2.3/2.4/4.1/5.1/5.6. Pass-action decision (§16 option b)→Task 0.3 (`allowPass=false`) + Task 5.7. No spec section is unmapped.

**Placeholder scan:** no "TBD/handle appropriately"; behavioral tests specify inputs/expected. Two tests intentionally leave coordinate selection to the helper (4.1 overlap, 2.4 corner-graze) with an explicit instruction to choose and document them — flagged, not silent.

**Type consistency:** `RngState`/`seed`/`nextFloat` (Phase 1) consumed unchanged in combat/agent/driver; `control` return shape `{hexes,iron,factories}` consistent across Phases 4–6; `GameResult` fields defined in 7.1 and consumed in 7.2; `Action`/`AttackDecl` from Task 0.3 used in 5.x and 6.x.
