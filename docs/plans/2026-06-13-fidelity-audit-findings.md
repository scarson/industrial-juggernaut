# Industrial Juggernaut — Engine vs. Rulebook Fidelity Audit (2026-06-13)

## Framing: code is the source of truth, NOT the rules doc

`industrial-juggernaut-rules-v10.md` (labeled "Rules Draft v9" in its header) is the
**original starting point**. It predates thousands of rounds of self-play / balance
iteration that drove design changes, and it was **not kept in sync**. The engine code
plus its simulation-validated test suite is the **authoritative specification of the
game**.

Therefore:

- A code/rules-doc **mismatch is, by default, a candidate Digital Edition Ruling (DER)**
  — an intentional, documented divergence — **not** an engine bug.
- Something is classified **BUG** only when the code violates clear *design intent*: an
  internal contradiction, a balance/correctness error, or a determinism/geometry (GEO)
  safety violation — never merely because it departs from the printed rules.

Classification buckets used below: **MATCH**, **DER**, **BUG candidate**, **UNCERTAIN**.

**Bottom line:** Zero BUG candidates found. The engine is internally consistent and
GEO-safe across every mechanic audited. All divergences from the printed rules are
intentional digital-edition rulings (the 7 known ones are all present and correct; a
handful of additional, smaller DERs are catalogued below). A short UNCERTAIN list is
flagged for Sam — none are defects, they are "should this printed rule be modeled at all
in the digital edition?" judgment calls.

---

## Part 1 — Confirmation of the 7 known DERs

| # | Known DER | Present? | Code location | Matches description? |
|---|-----------|----------|---------------|----------------------|
| 1 | Territory = **convex hull** of all bases (not visibility polygons); stranded bases still count toward the hull and block placements | YES | `src/engine/control.ts:30-61` (hull interior at 4+ non-degenerate bases); `src/geometry/hull.ts` (`convexHull`, `hexInHull`, `hullArea`) | YES |
| 2 | Stranded-base **rescue window unmodeled** — stranding persists until rescue or encirclement (no "this turn or next" clock) | YES | `src/engine/stranded.ts:63-80` (`strandedBases` = degree-<2 in visibility graph, recomputed each call); `:98-141` (`removeEncircledStrandedBases`). Rescue is implicit (a base that regains degree≥2 is simply no longer stranded) | YES |
| 3 | **Maxed-out capture is destroy-only** (no relocate option) | YES | `src/engine/apply.ts:226-241` — `applyOneAttack` win branch: `basesInHand>0` ⇒ place replacement; else `baseDestroyed` with no relocation | YES — comment at `:233-239` explicitly documents the deferral |
| 4 | **No-eligible-defender targets are unattackable** | YES | `src/engine/legal.ts:18-40` (`representativeDefender` returns `null` when no fresh, in-range, non-target base of the owner exists); `legal.ts:129-130` skips the target when defender is null. `apply.ts:182-196` would also throw if a defenderless attack were submitted | YES |
| 5 | **Voluntary pass is illegal** (`allowPass:false` default) | YES | `src/engine/config.ts:19` (`allowPass:false`); `src/engine/legal.ts:140-142` (pass emitted only if `allowPass` OR no other action exists, i.e. forced-stuck) | YES |
| 6 | **First-base placement: free choice on the outer ring** in a drawn order; agent auto-pick | YES | `src/engine/turn.ts:99-129` (`legalFirstBaseHexes` = unoccupied outer-ring; `placeFirstBase` validates outer ring + unoccupied + correct placer); `:75-84` (`representativeFirstBase` agent auto-pick, evenly spaced by angle). Setup is `phase.turn===0` | YES — note the seating is **outer ring anywhere** (free), not "near where the player sits" |
| 7a | Per-player **factory-death clock**, threshold 8 | YES | `src/engine/status.ts:162,177-184` — `baseCount<4 && control(state,p).factories.length >= brokenPerimeterDeathAtFactories`; `config.ts:18` default `brokenPerimeterDeathAtFactories: 8` | YES — matches GEO-6 |
| 7b | Triangle rule applies to the **perimeter-establishing 4th+ base only** | YES | `src/engine/build.ts:189-225` — `isLegalBasePlacement`; `:213` short-circuits when `friendly.length < 3` (radiating 2nd/3rd base needs only proximity + not-in-opponent-perimeter); the two-visible-bases triangle test (`:215-224`) runs only at `friendly.length >= 3` | YES — matches the 2026-05-27 rulebook clarification (lines 138) and GEO-7 framing |

**Bootstrap gate (already-captured reference, re-confirmed):** `src/engine/build.ts:86-96`
`isBootstrapOnly` is gated on `baseCount === 1` (founding single base) per GEO-7, while
`buildBudget` (`:65-71`) still grants the +1 bootstrap term to any `<4`-base player. The
deliberate asymmetry is present and matches the pitfalls doc.

All 7 known DERs (and the bootstrap gate) are **present and faithful to their
descriptions**. No drift found.

---

## Part 2 — New DER candidates (rule text → code behavior → rationale)

These are additional code/rulebook divergences not in the known-7 list. Each is a
*candidate* DER: the code is authoritative, so the recommended action is to **document
the divergence**, not change the code. None is a bug. Several are simply the natural
consequence of the convex-hull territory model (DER #1) and could reasonably be folded
under it.

### DER-N1 — Combat win-probabilities are exact fractions, not the printed percentages

- **Rule text (lines 164-169):** commit 3 = 75%, **4 = 83%**, **5 = 89%**, 6 = 100% (auto).
- **Code behavior:** `src/engine/config.ts:15` `combatTable: { 3: 0.75, 4: 5/6, 5: 8/9, 6: 1 }`.
  `5/6 = 0.8333…` and `8/9 = 0.8888…`. The combat resolution (`src/engine/combat.ts:7-17`)
  draws one uniform float and compares `< table[commit]`.
- **Rationale:** The printed 83% / 89% are rounded presentations of the true bag odds the
  designer intended (the velvet-bag token ratios produce clean fractions). The code uses
  the exact fractions, which is *more* faithful to the physical bag mechanic than the
  rounded display values. Empirically pinned in `test/engine/combat.test.ts:10-16`.
- **Proposed DER wording:** "Combat win probabilities are the exact bag-ratio fractions
  3→3/4, 4→5/6, 5→8/9, 6→auto. The rulebook's 83% / 89% are rounded displays of 5/6 and
  8/9; the engine uses the exact values."

### DER-N2 — "Perimeter must contain ≥1 iron" is enforced post-hoc by elimination, not as a placement precondition

- **Rule text (lines 66, 228):** "A perimeter must contain at least 1 iron hex." / "Empty
  Perimeter. A player can destroy *themselves* by absentmindedly creating a perimeter that
  contains no iron hex when they place their 4th Base."
- **Code behavior:** `isLegalBasePlacement` (`src/engine/build.ts:189-225`) does **not**
  reject a 4th-base placement that yields an iron-less perimeter — it is geometrically
  legal. The consequence is applied *after the fact* by `applyEliminations`
  (`src/engine/status.ts:185-188`): a player with ≥1 base controlling 0 iron is eliminated
  (`noIron`), reclassified to `emptyPerimeter` with no bounty when the player did it to
  themselves (`:212-214`).
- **Rationale:** The rule is self-punishing by design ("destroy *themselves*"). The engine
  models the *consequence* (self-elimination) rather than forbidding the move. This is
  faithful to intent and arguably *more* faithful than a placement ban, since the rulebook
  explicitly frames it as a self-inflicted loss, not an illegal move. Note the digital
  edition still does not *prevent* the player from making the mistake — consistent with the
  printed "absentmindedly" framing.
- **Proposed DER wording:** "Creating an iron-less perimeter is a legal-but-fatal move:
  the engine permits the placement and resolves it as self-elimination (`emptyPerimeter`,
  no bounty) at the post-action elimination pass, rather than forbidding the placement."

### DER-N3 — Factory placement range keys on the 5-hex `placeRange`, applied to **every** tied farthest base

- **Rule text (lines 121, 242):** "New Factories must be placed within 5 hexes of your
  Farthest Base — the base that is farthest from your first (oldest) Base."
- **Code behavior:** `src/engine/build.ts:103-115` (`farthestBases`) returns **all** bases
  tied for max distance from the oldest base (R4), and `isLegalFactoryPlacement`
  (`:124-133`) allows a factory within `placeRange` (=5) of **any** tied farthest base.
  The rulebook's singular "the Farthest Base" implies one base; ties are unspecified.
- **Rationale:** A tie-break rule had to be chosen; "any tied-farthest base counts" is the
  permissive, symmetric resolution (no arbitrary key-order tiebreak that would make
  identical-distance bases behave differently). This is a gap-filling DER, not a
  contradiction. Pinned by `test/engine/build.test.ts:104-116`.
- **Proposed DER wording:** "When multiple bases tie for farthest-from-oldest, a new
  factory may be placed within 5 hexes of *any* of them."

### DER-N4 — Outer-perimeter targeting/attackability uses **convex-hull vertices**

- **Rule text (lines 150):** "Only bases that make up the outside of the opponent's
  perimeter may be targeted. Bases lying within an opponent's perimeter may not be attacked."
- **Code behavior:** `src/engine/apply.ts:137-150` and `src/engine/legal.ts:59-64`
  (`isOuterTarget`): a perimetered opponent (≥4 bases, positive-area hull) exposes **only
  its hull vertices**; bases interior to the hull (including non-vertex bases that lie on a
  hull *edge* but are not vertices) are unattackable. A radiating opponent (<4 bases, or
  degenerate/colinear hull) exposes every base.
- **Rationale:** This is the direct corollary of the convex-hull territory model (DER #1).
  "Outside of the perimeter" = "on the hull boundary"; the monotone-chain hull
  (`src/geometry/hull.ts:37-93`) drops colinear points, so a base sitting *on* an edge
  between two vertices is treated as interior (non-vertex) and is unattackable. Pinned by
  `test/engine/apply-attack.test.ts:176-198`.
- **Proposed DER wording:** "A perimetered opponent's attackable bases are exactly its
  convex-hull *vertices*. A base lying on a hull edge (colinear between two vertices) is
  treated as interior and is not a legal target."
- **Note:** This is really a facet of DER #1 and could be merged into it. Listed separately
  because it governs *attack legality* specifically, which a reader auditing combat rules
  would look for under "Combat Requirements," not under "Perimeter."

### DER-N5 — 2-player iron-weighted turn order uses controlled-iron, drawn proportionally

- **Rule text (lines 89-90):** "Instead of turn order tokens, each player places battle
  tokens into the velvet bag equal to the number of iron hexes currently in their control.
  whoever's token is drawn from the velvet bag plays first that turn."
- **Code behavior:** `src/engine/turn.ts:194-210` — exactly proportional draw on controlled
  iron (`control(state,a).iron.length`), with a **uniform fallback when both have 0 iron**
  (`:200-204`). The rulebook does not specify what happens when both players have 0 iron
  (an empty bag).
- **Rationale:** Faithful to the bag mechanic, plus a gap-filling fallback for the
  unspecified empty-bag case (both at 0 iron). The fallback is necessary — an empty bag has
  no defined draw. Pinned by `test/engine/turn.test.ts:275-298`.
- **Proposed DER wording:** "2-player turn order is an iron-proportional first-player draw;
  when both players control 0 iron (empty bag, unspecified by the rules) the first player
  is chosen uniformly at random."

### DER-N6 — Multi-player turn order: "last & second-to-last go first" modeled as those two filling slots 0–1 in random order

- **Rule text (lines 86-87):** "place only tokens #1 and #2 in the velvet bag. The two
  players who played last and second-to-last in the previous turn draw first. Then place
  remaining tokens in the velvet bag and all other players draw to define the order."
- **Code behavior:** `src/engine/turn.ts:212-231` — the last and second-to-last *live*
  players occupy slots 0 and 1 in a uniformly-random order; everyone else fills the rest
  uniformly. Eliminated last/second-to-last fall back to the next-latest live player
  (`:214-217`).
- **Rationale:** The code comment (`turn.ts:175-178`) flags this as an interpretation: with
  exactly the two of them in the sub-bag, the faithful reading is that they occupy the first
  two slots in random order. The elimination fallback is a gap-fill (rules don't cover a
  dead last-player). Pinned by `test/engine/turn.test.ts:167-219`.
- **Proposed DER wording:** "Multi-player (3+) turn order: the previous turn's last and
  second-to-last *surviving* players take the first two slots in random order; remaining
  players follow in random order. If a last/second-to-last player was eliminated, the
  next-latest surviving player takes the slot."

### DER-N7 — Iron victory / elimination checked at **end of each round**, with a defined precedence and a degenerate all-eliminated terminal

- **Rule text (lines 25, 233):** "The first player — or alliance — to have 10 iron hexes
  under their control at the end of a round wins." Plus the four elimination causes
  (lines 221-230).
- **Code behavior:** `src/engine/status.ts:96-121` — iron victory is checked **before**
  last-standing; ties on iron broken by lowest player id; an all-eliminated board returns a
  victory with empty `players` so the driver always terminates (`:116`). `src/driver/run.ts`
  runs `status()` after each round. Elimination ordering inside a pass is `noBases` →
  per-player broken-perimeter → `noIron` (`status.ts:169-190`), single pass, driver
  re-invokes for cascades.
- **Rationale:** These are all gap-filling determinism choices the rulebook leaves open
  (precedence between simultaneous victories, tie-breaks, the empty-board terminal, the
  order of simultaneous elimination causes). Each is needed to make `(seed, actions) →
  outcome` deterministic. Pinned across `test/engine/status.test.ts`.
- **Proposed DER wording:** "End-of-round resolution order is deterministic: (1) iron
  victory (≥threshold distinct controlled iron) takes precedence over last-standing, with
  most-iron then lowest-player-id tie-breaks; (2) elimination causes within a pass resolve
  noBases → broken-perimeter → noIron; (3) an all-eliminated board terminates as a
  victory with no winner."

---

## Part 3 — BUG candidates

**None.**

Every mechanic audited is internally consistent, GEO-safe (epsilon-banded geometry per
GEO-1, cube-rounding per GEO-2, threaded PRNG per GEO-3, canonical-key hex membership per
GEO-4, derived-never-cached perimeter per GEO-5), and matches the simulation-validated
test suite. The divergences from the printed rules are all intentional digital-edition
rulings (the catalogued DERs above and the known-7). I went looking specifically for:

- **Internal contradictions** between `legalActions` (move-gen) and `applyAction`
  (validation): none — `isOuterTarget`/`representativeDefender` in `legal.ts` exactly mirror
  the target/defender validation in `apply.ts`, and `test/engine/legal.test.ts:36-50`
  ("every returned action is accepted by applyAction without throwing") is the load-bearing
  guard. The duplicate-attacker and self-defender holes were already closed
  (`apply.ts:158-161,179-181`; `test/engine/apply-attack-validation.test.ts`).
- **Determinism / GEO violations:** none — no `Math.random` in the engine; all randomness
  threads `RngState` (combat, shuffles, iron CSP, turn order); geometry uses the shared
  fixed projection + `EPS=1e-9`.
- **Balance/correctness regressions:** none — the two balance-tuned values
  (per-player factory clock = 8, triangle-only-at-4th-base) are present and pinned, and the
  1000-game acceptance suite (`test/acceptance/play-many.test.ts`) terminates with no
  illegal actions and <50 turn-cap hits.

If the story being clean with one clear conclusion feels suspicious (per the project's
comparative-evaluation discipline): I treated it as such and specifically hunted for a
move-gen/validation mismatch, a fatigue/PRNG threading error in multi-attack, and an
off-by-one in the hull-vertex targeting. All held up under the existing tests and a manual
read. The engine is genuinely tight.

---

## Part 4 — UNCERTAIN (needs Sam's judgment)

These are not defects. They are "is this printed mechanic *intended* to be modeled in the
digital edition, or intentionally dropped?" calls that only Sam can make. Each is currently
**unmodeled** in the engine; the question is whether that's a deliberate DER (likely) or an
acknowledged-not-yet-built gap.

1. **Alliances are a data structure but no agent forms them, and there is no in-engine
   alliance-formation/dissolution *action*.** The rules (lines 217-219) describe alliances
   formed "at any time by mutual agreement and dissolved unilaterally," combined attacks
   capped at 6 bases, and bounty going to the attack-caller. The engine *supports* alliances
   structurally — `coalitions`/`coalitionIron` (`status.ts:18-78`), allied attackers in
   `apply.ts:122-124`, allied-aware blockers in `stranded.ts` — and `status.test.ts` exercises
   coalition iron victory via hand-set alliances. But there is **no `Action` to form/dissolve
   an alliance** (`types.ts:63-66` has only build/attack/pass) and the agents never ally.
   *Question for Sam:* is "alliances are a supported board state but not an agent-playable
   action in M1" the intended DER, or a planned-but-unbuilt feature? (I lean DER — the data
   model is deliberately alliance-ready; the negotiation layer is just out of M1 scope.)

2. **The 6-base combined-attack cap is enforced per-AttackDecl, not across an alliance's
   pooled commitment.** `apply.ts:153-156` caps a single declaration at 3–6 attackers, and
   allied bases may fill that 3–6 (`apply.ts:162-174`). The rules (line 219) say "the total
   bases involved does not exceed 6 in attack." Since each declaration already caps at 6 and
   includes allied bases, this matches for a single attack. *Question for Sam:* is there any
   intended alliance scenario where two allies' *separate* declarations in the same round
   should share a 6-base pool? (I believe not — the cap is per-attack and the code is correct
   — but flagging because "total bases involved" is ambiguous in the printed text.)

3. **Board size is ~93 hexes, not the printed 96; iron is exactly 14.** `shape.ts:33-53`
   (`ovalHexes`) targets `size` within ±6 and the seed-1n/size-96 board lands at 93 hexes
   (per the test fixtures' "93-hex oval" comments). The rulebook says "96 hexes" (line 44)
   but also lists it under "Variables to Test" (line 279). Iron count is exactly 14 via the
   CSP (`iron-csp.ts`). *Question for Sam:* is the ±6 oval-fit tolerance (yielding 93 for a
   96 request) the intended behavior, or should the generator hit exactly 96? (I lean
   intended — board size is explicitly a tunable, and the oval-fit search is deterministic —
   but it's a printed-number mismatch worth a one-line DER if you want it recorded.)

4. **"Under control" early-game radius is a *uniform* 5-hex disk per base, with overlaps
   shared.** Matches the rulebook (lines 18, 64, 75-76) including shared overlaps for
   still-radiating players (`control.ts:47-55`, `status.ts:72-78` dedups shared iron). No
   uncertainty about correctness — flagging only because the rulebook's "Overlapping Radii"
   section (line 76) says a player who *establishes a perimeter* makes interior resources
   "no longer available to adjacent players that are still radiating," and the engine models
   exclusivity purely via the hull-vs-disk regimes (a radiating player's disk can still
   overlap a perimetered neighbor's hull and both would count the iron). *Question for Sam:*
   should a perimetered player's territory actively *subtract* overlapping iron from a
   radiating neighbor's controlled set? Currently it does not — both can count an iron hex
   that falls in both a radiating disk and a perimeter. (I lean "current behavior is the DER":
   exclusivity is enforced by *placement* bans, not by control subtraction, which keeps
   `control` a pure per-player function. But this is the one place where the printed
   "no longer available to adjacent players" wording is arguably stronger than the code.)

---

## Part 5 — Rulebook coverage (sections audited)

Every section of `industrial-juggernaut-rules-v10.md` was mapped to engine code:

| Rulebook section (lines) | Mapped engine code | Result |
|--------------------------|--------------------|--------|
| Definitions (7-22) | `types.ts`, `control.ts`, `build.ts` (`oldestBase`/`farthestBases`) | MATCH / DER #1 (perimeter=hull) |
| Overview / victory (24-25) | `status.ts` (`status`, `coalitionIron`) | MATCH + DER-N7 (precedence) |
| Components (27-37) | `config.ts` (`baseLimit:12`, `factorySupply:36`); battle tokens abstracted into `combatTable` | MATCH (token bag → closed-form, DER-N1) |
| The Map (40-48) | `board/shape.ts`, `board/iron-csp.ts` | MATCH + UNCERTAIN #3 (93 vs 96) |
| Setup (50-59) | `turn.ts` (`setupPhaseState`, `placeFirstBase`, `representativeFirstBase`) | DER #6 (free outer-ring seating) |
| Perimeter / Radiating / Overlap (61-79) | `control.ts`, `hull.ts`, `build.ts` (placement bans) | DER #1 + UNCERTAIN #4 (overlap exclusivity) |
| Turn Order (81-90) | `turn.ts` (`drawTurnOrder`) | DER-N5 (2P), DER-N6 (3+P) |
| Build Action / budget / bootstrap (92-115) | `build.ts` (`buildBudget`, `isBootstrapOnly`) | MATCH + GEO-7 bootstrap gate |
| Placing Factories/Bases (117-142) | `build.ts` (`isLegalFactoryPlacement`, `isLegalBasePlacement`) | DER #7b (triangle@4th), DER-N3 (factory tie) |
| Attack Action / Combat Requirements (144-156) | `apply.ts` (`applyOneAttack`), `legal.ts` | DER #4 (defenderless), DER-N4 (hull-vertex targeting) |
| Combat Resolution / win table (158-173) | `combat.ts`, `config.ts` (`combatTable`) | DER-N1 (exact fractions) |
| Fresh/Fatigued (175-177) | `apply.ts` (fatigue on commit), `turn.ts:259` (start-of-turn refresh) | MATCH |
| Victory / Perimeter Reassessment / Stranded (179-193) | `control.ts` (derived), `stranded.ts` | DER #1, #2 (rescue window unmodeled) |
| Catastrophic Perimeter Loss (195-197) | `status.ts` (per-player factory clock) | DER #7a (threshold 8, GEO-6) |
| Maxed-out Bases (199-201) | `apply.ts:226-241` | DER #3 (destroy-only) |
| Multiple Attacks (207-209) | `apply.ts` (`applyAttack` fold), `legal.ts` (single-decl gen; agent chains) | MATCH |
| Base Limits / Elimination (211-215) | `status.ts` (`applyEliminations`, bounty) | MATCH |
| Alliances (217-219) | `status.ts` (coalitions), `apply.ts` (allied attackers) | UNCERTAIN #1, #2 (no formation action) |
| Ways to be defeated (221-230) | `status.ts` (4 causes + self-destruct) | DER-N2 (empty perimeter post-hoc), DER #7a |
| Winning (232-233) | `status.ts` | MATCH + DER-N7 |
| Quick Reference (235-252) | cross-checked against all of the above | consistent |
| Strategy Notes / Variables to Test (254-281) | informational; `config.ts` exposes every "Variable to Test" as a tunable knob | MATCH (all tunables present) |

---

## Summary counts

- **Known DERs confirmed present & faithful:** 7 / 7 (plus the bootstrap-gate reference).
- **New DER candidates:** 7 (DER-N1 … DER-N7) — all documentation-only; code is authoritative.
- **BUG candidates:** 0.
- **UNCERTAIN (need Sam's sign-off):** 4 — all "model this printed rule or intentionally
  drop it?" judgment calls, none are defects.

---

## Part 6 — Sam sign-off (2026-06-13)

Sam reviewed the audit and signed off:

- **All 7 new DER candidates (DER-N1…N7) APPROVED** → appended to the spec's Digital Edition
  Rulings section as rulings **#8–#14** (`docs/superpowers/specs/2026-06-12-web-client-design.md`).
  Documentation-only; no engine changes.
- **UNCERTAIN #1** (alliances are board state, no agent form/dissolve action in M1) → documented
  as DER **#15** (negotiation layer lands in Phase 3, spec §5 item 10).
- **UNCERTAIN #2** (6-base combined-attack cap is per-declaration) → **confirmed code-correct**;
  the per-attack cap already satisfies "total bases involved ≤ 6" for a single attack. No DER
  needed — recorded here as a confirmation, not a divergence.
- **UNCERTAIN #3** (size-96 request → ~93 hexes; ±6 oval-fit tolerance) → documented as DER **#16**.
- **UNCERTAIN #4** (overlapping iron not subtracted across the radiating↔perimeter boundary) →
  documented as DER **#17** AND **flagged as a possible balance bug for future review** (Sam's
  call: "flag for future balance review AND as possible bug — document, don't investigate now").
  A follow-up was spun off for a future balance pass. `control()` stays pure for now.

**Phase 7 is COMPLETE:** audit done + Sam sign-off obtained. 0 engine bugs → no fix-tasks/PRs.

---

## Addendum (2026-07-02) — Base-economy lever: defeated bases are not returned to hand

Surfaced after the 2026-06-13 audit, while root-causing a reported "40 bases on board + 19 in hand at turn 10" state. That state is expected behavior — `baseLimit` (12) is only the starting hand; kill bounty inflates `basesInHand` above 12 by design (rules-v10 line 251, "+12 when you eliminate a player"), and there is no on-board cap. The false alarm was an artifact of an artificially raised `victoryThreshold=40` (> `ironCount`, so iron victory is impossible — the elimination-only regime the sweep prunes) used to lengthen test games. Recorded here as a new UNCERTAIN item of the same "model this printed rule or intentionally drop it?" kind as Part 4, now with Sam's decision attached.

**The mechanic.** When a base is defeated *short of eliminating its owner* — captured (`baseReplaced`, `apply.ts:223-232`), destroyed by a maxed-out attacker (`baseDestroyed`, `apply.ts:233-241`), or removed as encircled-stranded (`stranded.ts:98-141`) — the base leaves the board but the owner's `basesInHand` is **not** credited back. So every non-eliminating loss permanently shrinks the loser's total army. Verified invariant (holds for every non-eliminated player, ironCount 10–16):

`onBoard + inHand == 12 + 12·bountyKills − capturedFromMe − destroyedOfMine`

— the loss terms are never returned. (Elimination is separate and now consistent: an eliminated player's on-board bases are removed AND its in-hand bases are zeroed — see `applyEliminations` in `status.ts`.)

**Rules reading.** rules-v10 never states what happens to a defeated (non-eliminating) base's token. The *natural physical reading* conserves 12 colored tokens per player (a removed colored token can't be used by anyone else, so it returns to its owner to redeploy) — under which the engine is too punitive. But per this doc's §Framing (code is the source of truth, not the rules doc) this may be an intentional attrition model. It is a design lever, **not** a confirmed bug.

**Measured gameplay implications** (30 seeds per config, heuristic agent, board 300):

| Config | Avg length | Outcomes | Active rounds at hand==0 | Perm. losses / survivor |
|--------|-----------|----------|--------------------------|-------------------------|
| `victoryThreshold=10` (realistic) | 4.9 turns | 30 iron | 15.5% | 0.74 |
| `victoryThreshold=12` (big300 near-miss) | 7.4 turns | 28 iron, 2 cap-hit | 46.6% | 0.70 |
| `victoryThreshold=40` (degenerate, elim-only) | 43.9 turns | 10 last-standing, 20 cap-hit | 70.6% | 9.72 |

Read: players are hand-constrained *often* (15–47% of rounds at healthy configs), but healthy games resolve by iron in ~5–7 turns before permanent loss compounds, so per-survivor loss stays ~0.7 and outcomes barely move (28–30/30 iron). The effect scales hard with game length / combat intensity (9.7 losses/survivor in 44-turn games). **Caveat:** measured under the weak heuristic agent (short, iron-decided games); the elimination-dominance this could aggravate — where strong play resolves big300 by elimination rather than iron victory, `ironVictoryFraction` 0.32 vs the 0.50 gate — appears under MCTS (longer, combat-heavier games; see `docs/sweeps/mcts-big300/2026-06-30-big300-mcts-rerun.md` §Findings). So these numbers are a lower bound for the regime that matters. Directionally, permanent base loss is snowbally / anti-comeback and is *aligned with* — but not shown to be the primary driver of — the iron-victory/elimination imbalance on big300.

**Sam's decision (2026-07-02):** log as a **design-lever candidate for the balance redesign**; do not fix or investigate further now. If pursued, the decisive test is an A/B (credit defeated tokens back to hand vs. current) on the same seeds, ideally under MCTS — gated on MCTS perf (full-strength big-board MCTS is infeasible at sweep scale). The `apply.ts` / `stranded.ts` base economy stays as-is for now. This follows the same handling as the earlier fidelity finding about overlapping iron near perimeter boundaries (Part 4 item 4, signed off in Part 6 on 2026-06-13): document it and flag it for a future balance pass, but don't investigate or change the engine now.
