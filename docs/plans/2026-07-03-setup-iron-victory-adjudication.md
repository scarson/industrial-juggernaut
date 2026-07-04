# Setup-phase iron-victory — adjudication (decision material for Sam)

_2026-07-03. Adjudication of a verified, reproducible finding: with the NewGame designer's default
settings, a game can be won instantly during the setup phase (before anyone takes a real turn). This
document is **decision material, not a fix.** It presents the fidelity question, quantified balance
data, and options with trade-offs; the **ruling is Sam's.** No engine, session, or board code is
changed by this branch._

Related tracks (coordinate, do not collide): the **balance-redesign** effort
(`docs/superpowers/specs/2026-07-02-balance-redesign-design.md`) owns the iron-vs-elimination
imbalance under strong play on big/sparse boards. This finding is a **distinct** phenomenon (setup
phase, small default board, any player count) but shares config knobs with that track — see
§7 (Interaction with the balance-redesign track).

---

## 1. The finding + minimal repro

### 1.1 What happens

With the NewGame designer's DEFAULT settings — a generated 96-hex board (`ironCount 14`),
`defaultConfig()` (`radius 5`, `victoryThreshold 10`), 2 human seats, seed 1 — the **second**
first-base placement wins the game instantly. The session reducer broadcasts
`gameOver{winners:[1], cause:"iron"}` immediately after seat 1's `placeFirstBase`, before turn 1
begins and before either player takes a real action.

The UI is uninvolved: this is pure engine + session-reducer behavior.

### 1.2 Minimal repro (engine)

A single radius-5 control disk over the right outer-ring hex covers ≥ 10 of the 14 iron hexes, so
`status()` reports an iron victory the moment the placement lands:

```ts
import { initGame } from "src/engine/init";
import { placeFirstBase } from "src/engine/turn";
import { control } from "src/engine/control";
import { status } from "src/engine/status";
import { defaultConfig } from "src/engine/config";

let g = initGame({
  seed: 1n,
  boardSource: { kind: "generate", size: 96, ironCount: 14 },
  nPlayers: 2,
  config: defaultConfig(),
});
// board: 93 hexes, 14 iron; victoryThreshold 10; radius 5
g = placeFirstBase(g, 0, { x: -5, y: 6, z: -1 }); // seat 0: controls 5 iron → status "ongoing"
g = placeFirstBase(g, 1, { x: 1, y: 3, z: -4 });  // seat 1: controls 10 iron
status(g); // → { kind: "victory", players: [1], reason: "iron" }
```

### 1.3 Minimal repro (session reducer — matches the finding exactly)

`openSession` with that header, then the two `placeFirstBase` commands, produces on seat 1's command:

```
seat0 broadcasts: ["applied"]
seat1 broadcasts: ["applied", { type: "gameOver", winners: [1], cause: "iron" }]
```

(`SessionHeader.seed` is a `bigint` — `1n` — in the in-memory shape; the decimal-string form is only
the encoded `SessionRecord`.)

### 1.4 Where `cause:"iron"` originates (code path)

1. `src/session/session.ts:143` (`placeFirstBase` handler) → `commitEntries`.
2. `src/session/agent-drive.ts:119` `commitEntries` → `applyEntry` (`src/session/round.ts:30`) →
   engine `placeFirstBase` (`src/engine/turn.ts:112`). A placement **never closes a round**, so
   `applyEntry` returns `terminal: null` (`round.ts:32`).
3. Back in `commitEntries`, **`src/session/agent-drive.ts:160-171`** — the *mid-setup victory branch*
   — runs `status(game)` on the post-placement state and, on victory, broadcasts `gameOver`:
   ```ts
   } else if (terminal === null && entries.some((e) => e.kind === "placeFirstBase")) {
     const setupStatus = status(game);          // agent-drive.ts:167
     if (setupStatus.kind === "victory") {
       terminal = setupStatus;
       broadcast.push({ type: "gameOver", winners: setupStatus.players, cause: setupStatus.reason });
     }
   }
   ```
4. `status()` (`src/engine/status.ts:96`) checks iron victory first (`status.ts:87`, `:100-113`): any
   coalition controlling ≥ `victoryThreshold` distinct iron wins with `reason:"iron"`. `coalitionIron`
   (`status.ts:72`) unions each member's `control(state, m).iron`.
5. `control()` (`src/engine/control.ts:47-67`) in the radiating regime is the union of radius-disks:
   a board hex is controlled iff within cube distance `radius` (5) of any base. One base → one disk.

So the mechanism is: **one radius-5 disk on a small dense board covers most of the iron, and the
setup-phase victory branch surfaces that as an immediate game-over.**

---

## 2. Fidelity analysis — should victory be checked during setup at all?

### 2.1 What the printed rules say

`industrial-juggernaut-rules-v10.md` (repo root) is the printed source of truth for the physical game.
On victory it is consistent and explicit that victory is an **end-of-round** event:

- §Overview (line 25): "The first player — or alliance — to have 10 iron hexes under their control
  **at the end of a round** wins."
- §Winning (line 233): "The game ends when any player — or alliance — controls 10 or more iron hexes
  **at the end of a round**."
- §Quick reference (line 252): "Victory | 10 Iron hexes (solo or alliance) **at end of a round**."

§Setup (lines 50-59) describes setup as a **distinct pre-play phase**: place the board, hand out
tokens, "Each player places their first base on any hex in the outermost ring… near where they are
sitting", place turn-order tokens in the bag. There is **no "round" during setup** in the printed
model — the first round begins after setup, when players draw turn order and start building/attacking.

**The printed rules are therefore silent on whether victory is checked during setup — because in the
physical game the situation cannot arise.** Two independent reasons:

1. **No round boundary exists during setup.** Victory is defined only "at the end of a round"; setup
   is not a round; so no victory check occurs there by construction.
2. **Radiating control is materially weaker at the table.** The digital engine models territory as a
   simple radius-5 disk (radiating) / convex hull (perimeter) — **DER #1**, the single most
   consequential documented divergence. The printed radiating rule is a "5-hex radius **semi-circle**
   from your first base **at the edge of the board**" (rules line 70, §Territory table). A semicircle
   at the board edge covers roughly half the hexes a full disk covers, so the printed first base
   controls far less iron than the engine's full disk. The instant-win geometry is partly an artifact
   of the engine's disk model, which is itself a Sam-authorized ruling.

**Silence is what Digital Edition Rulings (DERs) exist for.** The rules-reference module states the
policy directly (`web/src/rules/rules-content.ts:3-16`): the printed v10 text "in several places
describes behavior the Digital Edition engine deliberately diverges from"; each divergence is a
numbered DER. A setup-phase victory is precisely such a gap — the printed rules don't address it
because the physical game can't reach it, and the engine reaches it through a documented divergence
(the disk model, DER #1).

### 2.2 What the existing DER registry says

The registry (`web/src/rules/rules-content.ts`; canonical list
`docs/superpowers/specs/2026-06-12-web-client-design.md:226-247`) currently runs **DER #1 through #17**.
A new ruling here would be **DER #18**. The registry entries that bear on this finding:

- **DER #14 — end-of-round resolution order** (`rules-content.ts:234-242`;
  spec DER #14). States "iron victory (meeting the iron threshold) is checked **before**
  last-player-standing… **at round-end**." This is the closest existing ruling — and it frames the
  victory check as a **round-end** event, consistent with the printed rules. It does **not** address
  or authorize a **setup-phase** check. The setup check in `agent-drive.ts:160` is an *engine
  implementation detail that no DER covers.*
- **DER #6 — first-base placement** (`rules-content.ts:48-55`; spec DER #6). Humans get free choice of
  any outer-ring hex (the printed "near where you sit" is a physical-table convention with no screen
  analog). This is what makes the pathological hex *reachable*: a human can deliberately pick the
  iron-blanketing hex. (Agents auto-pick via even spacing, but even auto-pick triggers setup-victory
  frequently — see §3.4.)
- **DER #17 — overlapping iron is not subtracted across regimes** (`rules-content.ts:202-211`;
  spec DER #17). ⚠️ Already flagged (Sam, 2026-06-13) as a possible balance bug for a future balance
  pass. `control()` is a pure per-player function, so a radiating disk over-counts iron a stronger
  reading of the printed "no longer available to adjacent players" would deny. DER #17 is about the
  *radiating ↔ perimeter* boundary; the setup finding is a degenerate case of the same "radiating
  disks over-count iron" family, but at the extreme of a **single** disk on a small board with **no
  opponent perimeter to subtract**. DER #17's fix (if pursued) would not touch this — the setup
  winner's disk is the only claim on that iron.
- **DER #16 — board size is a tunable** (`rules-content.ts:114-119`; spec DER #16). A size-96 request
  yields ~93 hexes; iron is exactly 14. Confirms the board is small and iron-dense by default.

### 2.3 Was the setup check intentional? (code-over-rules-doc)

Yes — and the code comment tells us *why*, which is load-bearing for the options below. Per the
project lesson that **engine code + sim-validated tests are the source of truth over the stale
rules doc**, the setup-victory branch is not an accident:

`agent-drive.ts:160-166` documents the intent precisely:

> "Mid-setup victory: applyEntry's placeFirstBase branch cannot report terminal (placements never
> close a round…), so a victory decided mid-setup — **reachable in 3+ player games where an early
> placement already controls the iron threshold** — would otherwise end the game with NO gameOver ever
> broadcast."

This is a **real** scenario, not dead defensive code (§3.5 measures it: in 4-player default games,
9/24 seeds have a *non-final* placer already at ≥ threshold mid-setup). And `record.ts:43` (the
recording path) independently checks born-terminal after setup: `if (status(state).kind === "victory")
return finalize(false)`. So the engine has **two** places that treat a post-setup victory as
terminal, and `drive-vs-recordgame.test.ts` asserts they agree (see §6).

**The nuance the original author did not foreground:** the branch was written to avoid *silent
hangs* (a decided-but-never-announced game). It correctly announces the victory. But it announces a
victory that — per §2.1 — **the printed rules never intended to be reachable**, because the printed
rules have no setup-phase check and a weaker radiating model. So the check is doing exactly what it
was coded to do; the question is whether *deciding* a game during setup is faithful at all, or whether
the faithful behavior is "no one wins during setup — the earliest a win can be declared is the first
real round-end."

**Conclusion (fidelity):** The printed rules are **silent** on setup-phase victory, and where they
speak, they define victory as an **end-of-round** event and describe setup as a pre-round phase. The
existing registry (DER #14) reinforces round-end resolution and does not authorize a setup check. The
setup check is an undocumented engine behavior that produces games the physical rules cannot produce.
This is squarely a DER-shaped gap: it needs an explicit ruling (either "setup can decide a game" or
"victory is suspended until setup completes"), not a silent status quo. **My recommendation is in
§8; the ruling is Sam's.**

---

## 3. Quantified balance data

All numbers below are from throwaway probe scripts run in this worktree (bun; not committed — they are
not regression fixtures, see §9). Seeds 1–24 (24 seeds), generated boards, `defaultConfig()` unless a
knob is stated. "Instant-win" = a single first-base radius-5 disk controls ≥ `victoryThreshold` (10)
distinct iron.

### 3.1 The degeneracy is a small-board phenomenon and it is severe

2-player, per board size (14 iron):

| Board (req size / iron) | Board hexes | Disk hexes (r=5) | Avg max disk-iron | Seeds where **someone** can instant-win at setup |
|---|---|---|---|---|
| **96 / 14 (DEFAULT)** | ~93 | ~36 | **10.2** | **21 / 24 (87.5%)** |
| 200 / 14 | ~197 | ~39 | 6.0 | 0 / 24 (0%) |
| 300 / 14 | ~295 | ~40 | 4.5 | 0 / 24 (0%) |

A radius-5 disk covers ~36-40 hexes regardless of board size (the disk is a fixed geometric
footprint). On the **default 93-hex board that is ~40% of the entire board** — enough to blanket
10+ of 14 iron. On 197/295-hex boards the same disk is a small fraction and never reaches the
threshold. **The default board is the degenerate case; larger boards are clean.**

### 3.2 (a) Fraction of legal last-placer placements that instant-win

For the **last** placer (earlier seats auto-placed), the fraction of that seat's legal outer-ring hexes
that instantly win, averaged over 24 seeds:

| Board | Avg last-placer instant-win fraction | Seeds where last placer CAN instant-win |
|---|---|---|
| **96 / 14 (DEFAULT)** | **7.8%** | **21 / 24** |
| 200 / 14 | 0.0% | 0 / 24 |
| 300 / 14 | 0.0% | 0 / 24 |

On the default board, ~8% of a placer's legal hexes are instant wins — not a majority, but a human
NewGame-designer poking at the map will find one, and a deliberate exploit trivially so.

### 3.3 (b) The FIRST placer can also instant-win — it is not a last-placer privilege

The opening move can already win. On a fresh board, the best radius-5 disk over any outer-ring hex:

| Board | Seeds where the FIRST placer's best disk ≥ threshold | Avg max first-disk iron | Avg # of winning outer hexes for placer 1 |
|---|---|---|---|
| **96 / 14 (DEFAULT)** | **21 / 24** | **10.2** | **2.4** |
| 200 / 14 | 0 / 24 | 6.0 | 0.0 |
| 300 / 14 | 0 / 24 | 4.5 | 0.0 |

On 21/24 default-board seeds, **player 1's opening placement can already meet the threshold** (avg 2.4
winning hexes to choose from). The finding's repro happens to be the *second* placement, but the
degeneracy is not about placement order — it is about board density. This rules out "later placement
order privileges the last placer" as the explanation.

### 3.4 (d) Player count barely matters

Last-placer instant-win rate across player counts (default board):

| Players | Seeds where last placer CAN instant-win (of 24) | Avg last-placer win-fraction | Avg max disk-iron |
|---|---|---|---|
| 2P | 21 / 24 | 7.8% | 10.2 |
| 3P | 21 / 24 | 8.1% | 10.2 |
| 4P | 21 / 24 | 7.0% | 10.2 |
| 5P | 21 / 24 | 7.3% | 10.2 |
| 6P | 21 / 24 | 8.5% | 10.2 |

(200/300 boards: 0/24 at every player count.) The rate is ~7-9% and 21/24 seeds regardless of player
count. **The privilege is board density, not seat order.** More players slightly changes which outer
hexes remain free but not the fundamental reachability.

### 3.5 Even balanced auto-placement triggers setup-victory

The mid-setup check in `agent-drive.ts:160` exists for a real reason. Under **all-agent even-spacing
auto-pick** (no adversarial human choice), default-board games *already end in setup*:

| Players (all auto-pick) | Seeds ending setup already in victory (of 24) |
|---|---|
| 2P | 0 / 24 |
| 3P | 2 / 24 |
| **4P** | **14 / 24 (58%)** |
| 5P | 10 / 24 |
| 6P | 3 / 24 |

And the *non-final*-placer mid-setup victory the code comment cites is real: 4P has 9/24 seeds, 5P
9/24, 6P 3/24 where a placer *other than the last* already controls ≥ threshold while turn is still 0.
**So the setup-victory branch is not removable without a replacement** — 4-6 player default games
routinely decide during setup even with the game's own balanced seating.

### 3.6 Config-space: what each single knob change costs (default board)

Fraction of 24 seeds where the first placer can instant-win, varying one knob at a time from the
default (96 / 14 / r5 / vt10 → 88%):

| Knob change | Setup instant-win rate | Avg max disk-iron | Note |
|---|---|---|---|
| **baseline (vt 10, r 5, size 96)** | **88%** | 10.2 | the finding |
| victoryThreshold 11 | 29% | 10.2 | partial |
| **victoryThreshold 12** | **0%** | 10.2 | one disk maxes at ~10 iron; 12 is out of single-disk reach |
| victoryThreshold 13 / 14 | 0% | 10.2 | — |
| **control radius 4** | **0%** | 6.9 | disk shrinks below threshold |
| control radius 3 / 2 | 0% | 4.2 / 2.0 | — |
| **board size 120** | **0%** | 8.2 | first size that clears it |
| board size 150 / 200 / 300 | 0% | 7.4 / 6.0 / 4.5 | — |

Every single-knob change (vt ≥ 12, radius ≤ 4, size ≥ 120) removes the setup degeneracy on the default
board. **But each knob has different downstream consequences for the balance-redesign track (§7).**

---

## 4. Root-cause summary

Two independent contributing causes, both required for the degeneracy:

1. **A victory check runs during setup** (`agent-drive.ts:160`, mirrored by `record.ts:43`). Without
   this, no placement could *announce* a win — the earliest announcement would be the first real
   round-end. (Fidelity axis — §2.)
2. **The default board is small and iron-dense enough that one radius-5 disk covers the threshold**
   (§3.1). A 93-hex board, 14 iron, radius-5 disk ≈ 36 hexes ≈ 40% of the board. (Balance axis — §3.)

Cause 1 is a **fidelity** question (should setup decide a game?). Cause 2 is a **balance/config**
question (is the default board degenerate?). They are separable — you can fix either, both, or neither,
and the trade-offs differ. That separation is why the options below are not mutually exclusive.

---

## 5. What each option would invalidate (blast radius)

Enumerated so the trade-offs are visible. The load-bearing test is
`test/session/drive-vs-recordgame.test.ts` — described in its own header as "the single highest-value
correctness anchor in Part A" — which **asserts the setup-victory `gameOver` mechanism as a
first-class contract** (`:160-176`): exactly one `gameOver` at the terminal step, `winners ==
terminal.players`, `cause == terminal.reason`, no `turnRollover`. Its default-config cases
(`2p-greedy-default`, `3p-heuristic-default`, `4p-mixed-default`) exercise the setup-victory path; its
`PROLONGED_CONFIG` (`victoryThreshold: 20`) exists *specifically to route around* setup-victory so
combat develops (`:126-134`). `record.ts:43` (born-terminal) is the other anchor.

- **`src/session/agent-drive.ts:160-171`** — the setup-victory branch itself.
- **`src/session/record.ts:43`** — `recordGame`'s born-terminal check.
- **`test/session/drive-vs-recordgame.test.ts`** — the parity anchor and its `assertParity`
  mid-setup reconciliation (`:151-177`).
- **`test/session/agent-drive.test.ts`** — setup-drive assertions (no premature `gameOver` on ongoing
  rounds; setup transition behavior).
- **Balance-redesign re-baseline set** (`.../2026-07-02-balance-redesign-design.md:§7`): the
  **board-96 shipping default** is a protected re-baseline coordinate — "no rule change may regress
  it." A config change to the default board interacts directly (§7).

---

## 6. Options with trade-offs

### Option A — New DER: victory checks suspended until setup completes

**What:** Rule that no player can win during the setup phase. The earliest a game can be declared over
is the **first real round-end** (or the setup→play transition, checked once). Add **DER #18** to the
registry; adjust the engine so the setup-victory branch does not *announce* a win mid-placement.

**Critical implementation nuance (from probes, §3.5 + the deferral probe):** you **cannot** simply
delete `agent-drive.ts:160` — 4-6 player default games decide during setup even under balanced
auto-placement (14/24 4P seeds), and deleting the branch resurrects the exact silent-hang bug the
comment warns about (a decided game with no `gameOver`). The faithful shape is: **suspend the check
*during* placements, then run `status()` once at the setup→play transition (turn-1 start)**, or at the
first round-close. Probe result: the winner is determined purely by base positions (`control()` is
position-only), so a transition-time check yields the **identical winner** — deferral is **lossless**,
not suppression (verified: 29 setup-end victories across 120 configs, `status()` idempotent, 0
mismatches). The last `placeFirstBase` already transitions the phase to turn 1, so the transition
point is a natural, already-existing boundary.

**Semantics this produces:** a born-terminal board (won by pure geometry, e.g. 4P default) is still
announced — but as a **first-round** event, not a setup event. It matches the printed "victory at end
of a round" wording. It does **not** by itself fix the *balance* problem: the game is still decided by
the opening geometry; it just isn't *announced* until round 1. On a degenerate default board, the
practical player experience ("I won before I did anything") barely changes — the announcement moves by
one boundary but the outcome is preset.

**Trade-offs:**
- Faithful to the printed round-end victory definition; closes the documented DER gap cleanly.
- Lossless (no legitimate win is lost — deferred by one boundary at most).
- Does **not** fix balance — a board that's decided at setup is still decided at setup.
- **Invalidates:** `drive-vs-recordgame.test.ts` setup-victory assertions (`gameOver` now at
  round-1's first close, not the clinching placement); `record.ts:43` born-terminal semantics;
  `agent-drive.test.ts` setup assertions. These are *deliberate* golden/contract changes (the
  behavior is intentionally changing), so the tests are updated as part of the change, not "broken."
- Engine change → **TDD applies** (production `src/` code). This is a **Review-class** change
  (serialization/behavior contract touched, coordinate with balance track).

### Option B — Defaults change (fix the board, leave the check)

**What:** Change the NewGame designer's default config so a single disk can't blanket the threshold.
Candidate single knobs (each removes the degeneracy on the default board — §3.6):

| Knob | Change | What it fixes | What it risks / breaks |
|---|---|---|---|
| **boardSize** | 96 → **120+** | Disk covers < threshold; setup-win rate → 0% | The balance track's **board-96 is a protected re-baseline coordinate** (§7). Changing the *default* board size is the most direct collision with that track. Also: 96 was chosen as playable-small for 2/4P (rules line 279). |
| **victoryThreshold** | 10 → **12** | One disk maxes ~10 iron; 12 is unreachable by a single disk | Changes the *finish line* for **all** boards and the balance track's iron-vs-elimination tuning. vt is a live balance knob the redesign track's Phase-2 lever table lists. Direct collision. |
| **control radius** | 5 → **4** | Disk shrinks below threshold | radius drives the *entire early game's* territory scale (rules lines 245, 272 flag it as "revisit if territories feel too large/small"). A global feel change; touches every game, every board. |
| **ironCount** | keep 14, or lower | Fewer iron → harder to blanket | Iron distribution is CSP-constrained (DER #16); lowering it changes resource economy everywhere. |

**Trade-offs:**
- Fixes the actual balance problem (the game is no longer *decided* at setup), not just the
  announcement.
- **Every candidate knob is also a balance-redesign lever** (§7). Changing any of them *pre-empts* a
  decision that track has explicitly reserved for its Phase-2 session with Sam. High collision risk.
- Does **not** address the fidelity gap: even on a clean board, a born-terminal setup victory (rare
  but possible on some geometries) would still be *announced during setup*, which the printed rules
  don't sanction. Option B alone leaves DER #18 unwritten.
- If chosen, **boardSize 120** is the most surgical (touches only the default board, not the
  finish-line or territory-scale math that the balance track tunes) — but it still collides with the
  protected board-96 coordinate. **This choice must be made *with* the balance track, not around it.**
- Config-only change to `defaultConfig()` → **not** subject to TDD (config), but the *behavior* it
  changes is asserted in tests; expect golden churn.

### Option C — Both (DER #18 + a default-board fix)

**What:** Suspend setup-phase victory (Option A, the fidelity fix) **and** widen/retune the default
board (Option B, the balance fix), coordinated with the balance track.

**Trade-offs:**
- Addresses both axes: the game isn't decided at setup (balance) *and* isn't announced at setup
  (fidelity).
- Largest blast radius; a config change here **must** be sequenced with the balance-redesign track's
  Phase-2 decision to avoid double-churning goldens or contradicting a lever choice.
- Most work, most coordination; cleanest end state.

### Option D — Status quo + designer-instrument warning

**What:** Leave the engine and defaults as-is. Rule (DER-style) that setup-phase victory is *accepted
behavior on undersized boards*, and add a **designer-facing warning**: the NewGame designer surfaces a
non-blocking notice when the chosen `(boardSize, ironCount, radius, victoryThreshold)` admit a
single-disk instant win (computable cheaply — it's the §3.3 first-placer best-disk check). No engine or
default-config change.

**Trade-offs:**
- Zero collision with the balance track; zero golden churn.
- Treats the default board as a knowingly-degenerate *instrument* setting rather than a shipping game
  mode — consistent with the framing that board-96 is "a sweep near-miss coordinate, not a designed
  game mode" (balance design §7) and the web-client design's own note that "default config balance is
  known-broken (48/200 games won at setup)" (`.../2026-06-12-web-client-design.md:15`).
- **Does not fix the shipped default.** A player who opens NewGame with defaults and 2 seats can still
  win instantly with no warning unless the designer-warning is built. If the default board is genuinely
  shipped to real players, this is the weakest option — it documents the bug instead of fixing it.
- The designer-warning is a UI addition (frontend), separate from this engine question; it would be
  its own small piece of work.

---

## 7. Interaction with the balance-redesign track (coordinate, do not collide)

The balance-redesign effort (`docs/superpowers/specs/2026-07-02-balance-redesign-design.md`) is
**re-aimed at iron-victory/elimination balance** (user memory "balance-sweep-two-regime-finding"). It
is critical this adjudication **flags** the interaction rather than pre-empting that track's decisions:

1. **Different phenomenon, shared knobs.** The balance track's §1 problem statement is the *factory-
   clock death march under strong MCTS play on big/sparse boards (150/300)* — the opposite end of the
   board-size axis from this finding (small 96 board, setup phase, geometry-only, no search involved).
   These are two distinct defects. But **Options B and C touch knobs on that track's Phase-2 lever
   table** (`§7` of the balance design): `vt/ironCount ratio`, `board-gen iron-reachability
   constraint / iron-aware seating`, and `placeRange` are all listed there. A default-config change
   here would **pre-empt** a lever choice that track has reserved for a data-driven Phase-2 session.

2. **The board-96 default is a *protected* re-baseline coordinate.** Balance design §7: the re-baseline
   set includes "the board-96 shipping default (**no rule change may regress it**…)". Any Option-B/C
   change to the default board must be made **jointly** with that track — its Phase-2 re-baseline
   assumes board-96 stays fixed unless deliberately changed.

3. **A board-gen iron-reachability constraint could subsume the balance fix.** The balance track's
   lever table already contemplates a "board-gen iron-reachability constraint / iron-aware seating"
   lever. A constraint that *no single radius-5 disk covers ≥ threshold iron* would fix **this**
   finding's balance axis as a special case. If that lever is pursued there, Option B here may be
   unnecessary — another reason not to unilaterally change `defaultConfig()` from this branch.

4. **Option A (the DER) is *orthogonal* to the balance track and safe to pursue independently.**
   Suspending setup-phase victory is a fidelity/announcement change, not a balance-lever change; it
   doesn't touch vt/ironCount/board-size/placeRange. It can proceed without waiting on the balance
   track's Phase-2. This is the main reason the recommendation (§8) separates the fidelity fix from the
   balance fix.

**Coordination ask:** if any Option-B/C default-config change is chosen, route it through the balance-
redesign track's Phase-2 decision (or explicitly carve it out with Sam), and use the balance track's
merge protocol / golden-regeneration discipline. Do **not** land a `defaultConfig()` change from an
adjudication branch.

---

## 8. Recommendation (mine — the ruling is Sam's)

**Recommended: Option A now (fidelity), defer the balance knob to the balance-redesign track (do not
choose Option B here).** Concretely a two-part recommendation:

1. **Adopt DER #18 — victory is suspended during the setup phase; the earliest a game can be declared
   over is the setup→play transition (equivalently, the first round-end).** Implement as: keep a
   `status()` check, but move its *announcement* from mid-placement to the setup→play boundary (which
   the last `placeFirstBase` already crosses). This is faithful to the printed "victory at end of a
   round" definition, closes the DER gap DER #14 leaves open, and is **lossless** (probe-verified: the
   winner is position-only, so deferral preserves the identical winner and never suppresses a
   legitimate born-terminal victory). It removes the *worst* symptom — "you won before your first turn"
   — for the common 2P case, and makes 4-6P born-terminal boards announce as a first-round event.

2. **Route the balance axis (Option B's knobs) to the balance-redesign track — do not change
   `defaultConfig()` from this branch.** The default board *is* geometrically degenerate at setup
   (§3), but every fix knob (boardSize/vt/radius/ironCount) is a balance-redesign lever on a protected
   coordinate (§7). The right owner for "is board-96 a shippable default or an instrument coordinate,
   and which knob moves" is that track's Phase-2 data-driven decision with Sam — a board-gen
   iron-reachability constraint there may subsume it entirely (§7.3). Flag this finding *into* that
   track rather than pre-empting it.

**Why not the others:**
- **Not Option B alone:** it fixes balance but leaves the fidelity gap (a born-terminal board still
  *announced during setup* on some geometries), and unilaterally moves a protected balance knob.
- **Not Option C now:** correct end state, but the balance half must wait on the balance track's
  Phase-2; bundling them here forces a premature knob choice and double golden-churn.
- **Not Option D:** it documents the shipped default as knowingly-degenerate without fixing it. If
  board-96-with-defaults is ever put in front of a real player, "win before your first move with no
  warning" is not acceptable (Quality-matters / bugs-matter). Option A fixes the *announcement*
  cheaply and independently; the designer-warning from D is a fine *addition* to Option A but not a
  substitute.

If Sam wants the balance axis fixed *now* rather than deferred, the most surgical single knob is
**boardSize 96 → 120** (touches only the default board's density, not the finish-line or territory-
scale math the balance track tunes) — but even that must be confirmed *with* the balance track because
board-96 is a protected re-baseline coordinate.

---

## 9. Reasoning chain, alternatives ruled out, and uncertainties

Per CLAUDE.md §Thinking documentation (this is a reasoning-heavy adjudication).

### 9.1 How I approached it

I separated the finding into two orthogonal axes early — **fidelity** ("should setup decide a game?")
vs **balance** ("is the default board degenerate?") — because the fixes, owners, and blast radii
differ. That separation is the doc's spine and is what lets Option A proceed independently of the
balance track.

I treated the engine code as source of truth over the stale rules doc (project lesson
"code-over-rules-doc") but used the printed rules as *evidence of design intent*. The decisive fidelity
observation is that the printed rules are **silent** on setup victory *by construction* (no round
exists during setup), which is exactly the DER-shaped gap — not a contradiction to resolve but an
absence to rule on.

### 9.2 Alternatives considered and ruled out

- **"Just delete the setup-victory branch" (naive Option A).** Ruled out by probe §3.5: 4-6P default
  games decide during setup even under balanced auto-placement (14/24 4P seeds), and non-final placers
  reach threshold mid-setup (9/24 4P). Deleting the branch resurrects the silent-hang bug its own
  comment warns about. The correct Option A *moves* the announcement to the setup→play boundary rather
  than removing it.
- **"It's a last-placer-order exploit."** Ruled out by §3.3: the *first* placer can already win on
  21/24 default seeds (avg 2.4 winning opening hexes). It's board density, not seat order. The
  finding's "second placement" is incidental.
- **"It's a DER-#17 (overlapping-iron) manifestation, so let that fix cover it."** Partially related
  but ruled out as the *frame*: DER #17 is about *subtracting* a perimetered player's iron from a
  radiating neighbor. The setup winner's disk is the *only* claim on that iron (no opponent perimeter
  exists yet), so DER #17's subtraction fix would not touch it. Same "radiating disks over-count"
  family, different mechanism.
- **"Change the default config here and be done."** Ruled out by §7: every knob is a protected
  balance-redesign lever; changing `defaultConfig()` from an adjudication branch would pre-empt that
  track's Phase-2 decision and risk regressing its protected board-96 coordinate.
- **Blocking the pathological hex at placement time (a placement legality rule).** Considered and set
  aside: it would be a *new* engine rule the printed rules don't describe (DER #6 grants free outer-ring
  choice), it's brittle (which hexes are "too good" depends on vt/radius/board), and it doesn't
  generalize. A board-gen reachability constraint (balance track) is the cleaner home for "no
  single-disk instant win."

### 9.3 What I'm still uncertain about

- **Whether board-96 is actually shipped to real players or is only an instrument/sweep coordinate.**
  The balance design calls it "a sweep near-miss coordinate, not a designed game mode" (§7) yet also
  "the board-96 **shipping** default." If it's truly instrument-only, Option D's severity drops and
  Option A alone suffices. If it's a real default in the NewGame designer, the balance axis matters
  more. **This is a question for Sam** and it changes the weight between A-alone and C.
- **The exact right boundary for the deferred check in Option A** (setup→play transition vs first
  round-close). Probes show they're equivalent for the *winner* (position-only control), but the
  *implementation* and which test assertions move differ slightly. I'd confirm against
  `drive-vs-recordgame.test.ts`'s `assertParity` reconciliation before writing code.
- **Whether a born-terminal *first round* (won at the transition) should still count as a "round-end"
  victory or get its own reason.** The printed rules would call it a round-end win; I lean to reusing
  `reason:"iron"` unchanged, but that's a small ruling inside Option A.

### 9.4 What I'd probe with more time

- **CRN-paired**: does an Option-A implementation change any *golden* beyond the setup-victory cases?
  (Expected: only the setup-victory assertions move; confirm no play-phase golden shifts.)
- **The board-gen reachability constraint's cost**: how much does "no single radius-5 disk covers ≥
  threshold iron" shrink the space of generatable 96-hex boards? If it's cheap, it may be the single
  fix that serves both this finding and the balance track (§7.3) — worth a generation-yield probe
  before choosing between A-alone and coordinating a board-gen lever.
- **Human-placement adversarial worst case** vs the auto-pick numbers here: I measured auto-pick and
  best-single-disk; a deliberate 2-human exploit rate (both trying to grab the iron blanket) would
  sharpen the "how bad for real players" number.

### 9.5 Things I almost missed

- That **deleting** the setup check is not a valid Option A — the mid-setup branch catches real 4-6P
  born-terminal games (§3.5). Without the §3.5 probe I'd have recommended a fix that reintroduces a
  silent-hang bug.
- That the finding's "second placement" is a red herring — the *first* placer can already win (§3.3).
  The order in the repro is incidental to the mechanism.
- That `PROLONGED_CONFIG` in `drive-vs-recordgame.test.ts` exists *because* the test authors already
  route around setup-victory — independent corroboration that setup-victory is a known nuisance, not a
  designed feature.

---

## Appendix — probe provenance

All quantitative claims come from throwaway `bun run` scripts executed in this worktree against the
engine barrel (`src/index.ts` exports: `initGame`, `placeFirstBase`, `legalFirstBaseHexes`,
`representativeFirstBase`, `control`, `status`, `defaultConfig`). Scripts were **not committed** — they
are decision-support probes, not regression fixtures (per the task scope; if a fix lands, the
single-disk-reachability check in §3.3 is the natural regression assertion to promote). Seeds 1–24,
generated boards, `defaultConfig()` except where a knob is stated. The repro in §1 is reproducible
directly from the snippet against `origin/dev` at this branch's base.
