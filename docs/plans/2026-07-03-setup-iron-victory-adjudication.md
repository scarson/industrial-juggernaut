# Setup-phase iron-victory — adjudication (decision material for Sam)

_2026-07-03. Adjudication of a verified, reproducible finding: with the NewGame designer's default
settings, a game can be won instantly during the setup phase (before anyone takes a real turn). This
document is **decision material, not a fix.** It presents the fidelity question, quantified balance
data, and options with trade-offs; the **ruling is Sam's.** No engine, session, or board code is
changed by this branch._

_Revised same-day after an independent adversarial review (three blockers, all verified against the
engine — see §10 Review record). The quantitative data of the first draft reproduced exactly; the
fidelity reading stands; the "lossless / identical winner" claim, the replay-versioning omission, and
a misquote-derived open question are corrected below._

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

These ARE the shipped defaults, not a designer corner case: `NewGame.tsx` seeds its form from
`defaultConfig()` (`web/src/designer/NewGame.tsx:52-58`) and `initialSeats()` returns two human seats
(`web/src/designer/new-game-form.ts:44-46`). The UI is otherwise uninvolved: this is pure engine +
session-reducer behavior.

Setup placement order is seat-id order — seat 0 places first, the highest seat places last
(`src/engine/turn.ts:94`, `phase.order = players.map(p => p.id)`). This matters for §6 Option A's
last-placer analysis. (Side observation: the DER #6 registry text says placements are "offered in a
drawn placement order" — the code uses id order; the *turn-1* order is what gets drawn. Registry-text
drift, noted in §9.3, out of scope here.)

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
   (`status.ts:72`) unions each member's `control(state, m).iron`. Multiple qualifying coalitions
   resolve by **most iron, then lowest player id** (`status.ts:101-113` — the DER #14 rule).
5. `control()` (`src/engine/control.ts:47-67`) in the radiating regime is the union of radius-disks:
   a board hex is controlled iff within cube distance `radius` (5) of any base. One base → one disk.

So the mechanism is: **one radius-5 disk on a small dense board covers most of the iron, and the
setup-phase victory branch surfaces that as an immediate game-over.**

### 1.5 The current semantics are FIRST-TO-CLINCH

An important consequence of the code path above, load-bearing for §6 Option A: the mid-setup branch
fires on the **clinching placement**, and from that moment `status()` reports victory, so the
command envelope rejects **every** later mutating command with `GAME_OVER`
(`src/session/session.ts:90`) — including the remaining seats' own first-base placements. Seats after
the clincher **never place**. If two different placements could each reach the threshold, whoever
places *first* wins outright; the DER #14 most-iron resolution never gets to compare them, because
only one qualifier ever exists. This "first-to-clinch" property is not stated anywhere in the DER
registry — it is an emergent consequence of running the check mid-placement.

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
  implementation detail that no DER covers* — and the first-to-clinch property (§1.5) means the
  mid-setup check also **bypasses** DER #14's multi-qualifier resolution (only one qualifier can ever
  exist when the game ends on the first clinch).
- **DER #6 — first-base placement** (`rules-content.ts:48-55`; spec DER #6). Humans get free choice of
  any outer-ring hex (the printed "near where you sit" is a physical-table convention with no screen
  analog). This is what makes the pathological hex *reachable*: a human can deliberately pick the
  iron-blanketing hex. (Agents auto-pick via even spacing, but even auto-pick triggers setup-victory
  frequently — see §3.5.)
- **DER #17 — overlapping iron is not subtracted across regimes** (`rules-content.ts:202-211`;
  spec DER #17). ⚠️ Already flagged (Sam, 2026-06-13) as a possible balance bug for a future balance
  pass. `control()` is a pure per-player function, so a radiating disk over-counts iron a stronger
  reading of the printed "no longer available to adjacent players" would deny. DER #17 is about the
  *radiating ↔ perimeter* boundary; the setup finding is a degenerate case of the same "radiating
  disks over-count iron" family, but at the extreme of a **single** disk on a small board. DER #17's
  fix (if pursued) **cannot** touch setup outcomes: the perimeter regime requires 4 bases
  (`control.ts:36`, exclusion applies only against a standing opponent hull, `control.ts:79-93`),
  which is unreachable during setup at 1 base per player. Any winner selection at the setup boundary
  is DER #14 resolution, not DER #17 reduction.
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
terminal, and `drive-vs-recordgame.test.ts` asserts they agree (see §5).

**The nuance the original author did not foreground:** the branch was written to avoid *silent
hangs* (a decided-but-never-announced game). It correctly announces the victory. But it announces a
victory that — per §2.1 — **the printed rules never intended to be reachable**, because the printed
rules have no setup-phase check and a weaker radiating model. And it silently establishes the
first-to-clinch semantics of §1.5, cutting off later seats' placements — a resolution rule no DER
documents. So the check is doing exactly what it was coded to do; the questions are (a) whether
*deciding* a game during setup is faithful at all, and (b) if a game IS decided by setup geometry,
*when and among whom* the winner is resolved.

**Conclusion (fidelity):** The printed rules are **silent** on setup-phase victory, and where they
speak, they define victory as an **end-of-round** event and describe setup as a pre-round phase. The
existing registry (DER #14) reinforces round-end resolution and does not authorize a setup check —
nor the first-to-clinch resolution the current code implements. This is squarely a DER-shaped gap: it
needs an explicit ruling (either "setup can decide a game, first-to-clinch" or "victory is resolved
once, when setup completes"), not a silent status quo. **My recommendation is in §8; the ruling is
Sam's.**

---

## 3. Quantified balance data

All numbers below are from throwaway probe scripts run in this worktree (bun; not committed — they are
not regression fixtures, see Appendix). Seeds 1–24 (24 seeds), generated boards, `defaultConfig()`
unless a knob is stated. "Instant-win" = a single first-base radius-5 disk controls ≥
`victoryThreshold` (10) distinct iron.

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
order privileges the last placer" as the explanation *for the degeneracy itself* (the last placer does
gain a different, resolution-timing advantage under Option A — see §3.7 and §6A).

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
count. **The reachability of an instant win is board density, not seat order.** More players slightly
changes which outer hexes remain free but not the fundamental reachability.

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

### 3.7 First-to-clinch vs boundary-resolution: the winner can FLIP under free placement

(Added after adversarial review — the first draft claimed deferral preserved an "identical winner";
that claim was probed only under auto-placement and is **false under free human placement**, which is
exactly the regime under adjudication.)

Under today's semantics (§1.5), the first seat to place a ≥-threshold disk wins and later seats never
place. Under boundary resolution (§6 Option A), all seats place and multiple qualifiers resolve by
DER #14's most-iron-then-lowest-id. These select **different winners** whenever a first-placer clinch
with k iron leaves a later seat a response covering **> k** iron (ties go to the lower id, i.e. the
earlier placer). Probed exhaustively (2P, default board, seeds 1–24, every seat-0 clinching hex ×
every seat-1 response):

| Measure | Result |
|---|---|
| Seeds with any seat-0 clinching hex | 21 / 24 |
| Seeds where a **flip pair** exists (seat 1 can out-iron a seat-0 clinch) | **7 / 24** (seeds 4, 8, 10, 12, 14, 16, 17) |
| Flip pattern | always a 10-iron clinch answered by an 11-iron response |
| Seat-0 *best* clinch vs seat-1 best response | never flips (best-vs-best ties go to seat 0 on lowest-id) |

Worked example (seed 4): seat 0 places (1,3,-4) → 10 iron → **today**: `gameOver winners:[0]`, seat 1
never places. **Boundary resolution**: seat 1 places (2,2,-4) → 11 iron → DER #14 most-iron →
`winners:[1]`. Same shape on the other six seeds.

Two honest readings of this table:
- The flip requires the clincher to play a *sub-maximal* clinch (their best clinch never loses
  best-vs-best). A first placer who knows the rule and plays the max-iron clinch keeps the win under
  either semantics on all 24 seeds.
- But under boundary resolution the **last placer holds an information advantage**: they see every
  prior placement and only need to beat the standing maximum, while earlier placers must commit
  blind. Under first-to-clinch the advantage is inverted (earlier seats get first shot at the
  clinching hexes and later seats are cut off entirely). **Neither semantics is neutral; they
  privilege opposite ends of the placement order.** Option A must own this as a deliberate change,
  not a neutral fix (§6A).

Under **auto-placement** (all-agent even-spacing), the two semantics select the identical winner on
all 120 probed configs (2-6P × 24 seeds) — the flip is a free-placement phenomenon.

---

## 4. Root-cause summary

Two independent contributing causes, both required for the degeneracy:

1. **A victory check runs during setup, with emergent first-to-clinch resolution**
   (`agent-drive.ts:160`, locked in by `session.ts:90`; mirrored by `record.ts:43`). Without this, no
   placement could end the game mid-setup — the earliest resolution would be the setup→play boundary
   or the first round-end. (Fidelity axis — §2.)
2. **The default board is small and iron-dense enough that one radius-5 disk covers the threshold**
   (§3.1). A 93-hex board, 14 iron, radius-5 disk ≈ 36 hexes ≈ 40% of the board. (Balance axis — §3.)

Cause 1 is a **fidelity** question (should setup decide a game, and if so, resolved how?). Cause 2 is
a **balance/config** question (is the default board degenerate?). They are separable — you can fix
either, both, or neither, and the trade-offs differ. That separation is why the options below are not
mutually exclusive. But note what the separation does **not** buy: fixing cause 1 alone does not stop
the shipped default board from being *decided* by setup geometry — it only changes when/among whom the
decision is resolved (§6A, §8).

---

## 5. Enforcement-point inventory and blast radius

### 5.1 The four enforcement points (complete inventory)

Any change to setup-victory semantics must keep ALL FOUR of these coherent, or it ships either the
silent-stall bug (a decided game that never announces) or a zombie-room bug (a decided game that
keeps accepting commands):

1. **`src/session/agent-drive.ts:160-171`** — the mid-setup victory branch in `commitEntries`: runs
   `status()` after placement batches and broadcasts `gameOver`. (The announcer.)
2. **`src/session/session.ts:90`** — the command envelope's `GAME_OVER` guard: rejects every mutating
   command once `status()` reports victory. (What locks later seats out — the first-to-clinch
   mechanism, §1.5.)
3. **`src/session/agent-drive.ts:25-31`** (`needsDrive`, status check at `:27`) — returns false on
   victory, halting the agent drive loop. (What stops agent seats from continuing; if the announcer is
   suppressed but this still halts, the room stalls silently.)
4. **`src/session/record.ts:43`** — `recordGame`'s born-terminal check after all placements. (The
   record/replay mirror of the same semantics; `drive-vs-recordgame.test.ts` asserts the two paths
   agree.)

Plus one host-side documentation touchpoint: **`src/host/game-room.ts:253`** — a comment recording
that "a mid-setup victory emits its own gameOver through the drive results — no host special-case
needed." Any semantics change must keep that statement true or update it.

All four points share one input: **`status()`**. That is why the two implementation forks in §6A.3
differ so sharply — an engine-level change (inside `status()`) keeps all four coherent by
construction; a session-level change must hand-patch each one and a missed point ships one of the two
bugs above.

### 5.2 Tests and contracts that bake in the current semantics

The load-bearing test is `test/session/drive-vs-recordgame.test.ts` — described in its own header as
"the single highest-value correctness anchor in Part A" — which **asserts the setup-victory `gameOver`
mechanism as a first-class contract** (`:160-176`): exactly one `gameOver` at the terminal step,
`winners == terminal.players`, `cause == terminal.reason`, no `turnRollover`. Its default-config cases
(`2p-greedy-default`, `3p-heuristic-default`, `4p-mixed-default`) exercise the setup-victory path; its
`PROLONGED_CONFIG` (`victoryThreshold: 20`) exists *specifically to route around* setup-victory so
combat develops (`:126-134`). Also affected:

- **`test/session/agent-drive.test.ts`** — setup-drive assertions (no premature `gameOver` on ongoing
  rounds; setup transition behavior).
- **Balance-redesign re-baseline set** (`.../2026-07-02-balance-redesign-design.md:§7`): the
  **board-96 shipping default** is a protected re-baseline coordinate — "no rule change may regress
  it." A config change to the default board interacts directly (§7).

---

## 6. Options with trade-offs

### Option A — New DER #18: victory is resolved once, when setup completes

#### A.1 The ruling, stated precisely

**Proposed DER #18:** *No victory can be declared while first-base placements are in progress. Every
seat places its first base. When the final placement completes (the setup→play transition), `status()`
runs once on the full post-setup board; if any coalition meets the threshold, the game ends there,
with multiple qualifiers resolved by DER #14's most-iron-then-lowest-id rule. Otherwise play begins
and victory is checked at round-ends as today.*

**Boundary choice — the setup→play transition, NOT the first round-end.** These are **not**
equivalent (the first draft wrongly said they were): by the first round-end, the turn-1 first player
has already built or attacked, so the positions being evaluated differ from the post-setup board.
I argue for the transition boundary, for three reasons — **this is a flagged decision point; Sam
rules** (§8):

1. It is the earliest moment the printed model has a complete board — the closest faithful analog of
   "end of a round" for the pre-round phase, without letting a geometrically decided game run a full
   turn of dead play.
2. The engine already crosses it atomically: the final `placeFirstBase` transitions `phase.turn` 0→1
   inside the same call (`src/engine/turn.ts:126-128`), and the mid-setup branch already runs *after*
   that entry applies — so the transition check needs no new sequencing.
3. `recordGame`'s born-terminal check (`record.ts:43`) already sits at exactly this boundary — the
   record path needs **no change** under this choice, and record/interactive parity is preserved by
   construction.

#### A.2 This is a DELIBERATE semantic change, not a lossless deferral

The first draft claimed the deferral was "lossless — identical winner." **Corrected after adversarial
review (§3.7):** the true, narrower claim is:

- **No victory is suppressed.** Every game that ends under today's semantics still ends under DER #18
  — at the same command when the clincher is the final placer, at the transition otherwise. A game
  never silently continues past a decided board. (Probe-verified across 120 auto-placement configs
  and the exhaustive 2P free-placement sweep.)
- **The winner can differ.** Today is first-to-clinch (§1.5); DER #18 is
  everyone-places-then-resolve. On 7/24 default-board seeds a flip pair exists (§3.7). Under
  auto-placement the winner is identical everywhere probed; under free placement the semantics
  genuinely diverge.
- **The change moves an order privilege from the front of the placement order to the back.** Today,
  early seats get first shot at clinching hexes and cut everyone else off. Under DER #18, the last
  placer sees all prior placements and only has to beat the standing maximum. Neither is neutral. My
  judgment: everyone-places-then-resolve is the *fairer* reading (every seat gets its guaranteed
  placement — the printed setup unconditionally gives each player a first base; and resolution uses
  the already-ruled DER #14 comparison instead of a race), but this is a genuine judgment call to
  rule on, not a correction of a bug.

**What Option A does NOT do (2P honesty):** in a 2-player game the second placement IS the setup→play
transition, so a last-placer clinch — the exact finding repro — announces `gameOver` on the **same
command as today**. And on any degenerate board the game is still *decided* by setup geometry; DER
#18 changes when/among-whom it resolves, not whether. Option A is a fidelity-and-resolution fix, not
a player-facing mitigation for the shipped default (that is §8's second and third legs).

#### A.3 Implementation cost and replay versioning (the fork)

`scripts/compute-replay-version.ts:14-29` defines the REPLAY_VERSION closure as the engine + rng +
board + geometry dirs plus four session files (`round.ts`, `hash.ts`, `codec.ts`, `replay.ts`) — and
**deliberately excludes** the interactive reducer files (`session.ts`, `agent-drive.ts`, `pending.ts`,
`seats.ts`). That exclusion forks the implementation into two shapes with very different consequences:

**Fork (i) — session-level** (change `agent-drive.ts` to suppress mid-setup announcement; leave
`status()` untouched):
- Files: `agent-drive.ts` (branch + `needsDrive`), `session.ts` (the `GAME_OVER` guard must
  special-case turn 0 or later placements are still locked out), `record.ts` if its semantics are to
  match. Every one of the four §5.1 points hand-patched.
- **No REPLAY_VERSION bump** (all changed files are outside the closure). Consequence: rooms that
  ended mid-setup under the OLD semantics — which broadcast `gameOver` but wrote **no snapshot**
  (`agent-drive.ts:165`: mid-setup victories are deliberately snapshot-less) and no terminal marker —
  **rehydrate as LIVE games** after redeploy: the log replays under the new reducer, no victory is
  recognized mid-setup, placements resume, and (per §3.7) **a concluded room's winner can change**.
- High defect surface: a missed enforcement point ships the silent-stall or zombie-room bug (§5.1).

**Fork (ii) — engine-level** (a turn-0 guard in `status()`: during setup — `phase.turn === 0` —
return `ongoing`):
- Files: `status.ts` only, for the semantics. All four §5.1 enforcement points cohere automatically,
  because they all consume `status()`: mid-setup placements no longer read as victory (no premature
  broadcast, no `GAME_OVER` lockout, drive keeps driving), while the **final** placement transitions
  `phase.turn` to 1 *before* the `commitEntries` check runs — so the existing `agent-drive.ts:160`
  branch fires at exactly the transition boundary **unchanged**, and `record.ts:43` likewise. The
  guard is safe against last-standing false-positives: eliminations are unreachable during setup
  (placements skip the elimination composition), so all players are live at turn 0 and no legitimate
  turn-0 victory exists other than the iron-by-geometry case being deliberately moved.
- `status.ts` is **inside** the replay closure → **forced REPLAY_VERSION bump**. Consequence for
  stored rooms, via the host's recovery gate (`game-room.ts:610` version-mismatch check →
  `canContinueUnderCurrentEngine`, `:616`/`:687-695`): a room with **no snapshot and a non-empty
  log** — which is precisely every room that ended (or sits) mid-setup — **freezes** on next wake
  rather than continuing under changed semantics.
- Cost: ANY in-flight room without a round-boundary snapshot + empty tail freezes on the bump — the
  standard, already-designed cost of an engine semantics change (this is the mechanism working as
  intended, not a new hazard).

**Rule for rooms recorded under the old timing (must be decided with the ruling):** I recommend —
flagged, Sam rules — **treat old mid-setup terminals as final and let the version bump freeze them.**
Their `gameOver` was broadcast under the semantics their `replayVersion` records; their
`SessionRecord` replays correctly under that version; freezing prevents both re-resolution (fork (ii))
and silent winner changes (the fork (i) hazard). Fork (i)'s no-bump path has no mechanism to protect
those rooms and should be rejected for that reason alone.

**"Frozen-as-final" means MUTATION-final, NOT presentation-final (round-2 clarification).** Verified
against the storage layout: a mid-setup-terminal room persists **only its placement log** — no
snapshot (`agent-drive.ts:165` writes none mid-setup) and **no terminal/winner marker of any kind**
(the storage keys are header / log:NNNNNN / snapshot / pending / roomOptions / initialized / frozen —
`src/session/keys.ts`; there is no winner or terminal key). The winner existed **only** as the live
`gameOver` broadcast, reconstructed on the drive path; it was never persisted. Two independent
confirmations that no persisted surface carries it: `resyncPayload` (`session.ts:311-325`) returns
`snapshot` / `logLength` / `pending` / `seats` / versions / `reason` — **no** `winners`/`cause`/
`terminal` field; and the client store's sync handler (`web/src/game/store.ts:112-124`) sets
`state`/`logLength`/`roster`/`pending` on resync and **never** a terminal field. Consequence: the
fork-(ii) bump correctly freezes such a room — the **mutation-safety property holds** (no
re-resolution, no winner change) — but a viewer returning to a *pre-bump* mid-setup-terminal room
sees a **frozen board with no victory screen**, because the win was never stored to re-derive from.
The affected population is bounded: pre-1.0 degenerate instant-win rooms on the default board (the
only rooms that reach a mid-setup terminal). Two ways to resolve, flagged for the ruling:

- **(c-accept)** Accept the frozen-board-without-victory-screen presentation for that pre-1.0
  population — it is a cosmetic gap on already-degenerate rooms that this ruling is retiring anyway.
- **(c-followup)** Budget a small **optional** client follow-up: on a frozen-room resync, the client
  runs `status()` on the resync `snapshot` to derive the terminal locally and render the victory
  screen. Frontend-only, no new persisted field, no engine change. Not required for the ruling to hold
  — a nice-to-have for the affected pre-1.0 rooms.

My recommendation within (c): **accept (c-accept)**; the follow-up is worth doing only if those
pre-1.0 rooms matter to anyone, which for a pre-release degenerate-config population they likely
don't.

**Recommendation within Option A: fork (ii), engine-level.** One choke point, four enforcement points
coherent by construction, record/replay parity preserved with zero `record.ts` change, and a
versioning story that protects concluded rooms. TDD applies (production `src/` code). This is a
**Review-class** change (engine victory semantics + forced replay-version bump).

#### A.4 Trade-offs summary

- Faithful to the printed round-end victory definition; closes the DER gap; replaces the undocumented
  first-to-clinch resolution with the already-ruled DER #14 comparison.
- No victory suppressed; every seat is guaranteed its placement.
- **Deliberately changes the winner in flip geometries (7/24 default seeds)** and moves the placement-
  order privilege from first-clincher to last-placer. Must be ruled on, not slipped in.
- Does **not** fix balance (a degenerate board is still decided at setup) and does **not** change the
  2P last-placer-clinch experience (same command announces).
- Forces a REPLAY_VERSION bump (fork (ii)); freezes snapshot-less in-flight rooms; old mid-setup
  terminals freeze-as-final.
- **Invalidates (deliberately):** `drive-vs-recordgame.test.ts`'s mid-setup reconciliation
  (`assertParity :151-177` — the truncation logic and the exit taxonomy change; the `gameOver`
  contract assertions themselves survive, now pinned at the transition step), `agent-drive.test.ts`
  setup assertions, and the `game-room.ts:253` comment. `record.ts` behavior is unchanged under
  fork (ii).

### Option B — Defaults change (fix the board, leave the check)

**What:** Change the NewGame designer's default config so a single disk can't blanket the threshold.
Candidate single knobs (each removes the degeneracy on the default board — §3.6):

| Knob | Change | What it fixes | What it risks / breaks |
|---|---|---|---|
| **boardSize** | 96 → **120+** | Disk covers < threshold; setup-win rate → 0% | The balance track's **board-96 is a protected re-baseline coordinate** (§7). Changing the *default* board size is the most direct collision with that track. Note the printed quick-reference (rules line 279) actually anticipates pressure in the *opposite* direction — "may need to use **smaller** board for 2 and 4 player games" — an intuition from the physical semicircle-control model that inverts under the digital full-disk model (DER #1): smaller boards are *more* degenerate digitally. |
| **victoryThreshold** | 10 → **12** | One disk maxes ~10 iron; 12 is unreachable by a single disk | Changes the *finish line* for **all** boards and the balance track's iron-vs-elimination tuning. vt is a live balance knob the redesign track's Phase-2 lever table lists. Direct collision. |
| **control radius** | 5 → **4** | Disk shrinks below threshold | radius drives the *entire early game's* territory scale (rules lines 245, 272 flag it as "revisit if territories feel too large/small"). A global feel change; touches every game, every board. |
| **ironCount** | keep 14, or lower | Fewer iron → harder to blanket | Iron distribution is CSP-constrained (DER #16); lowering it changes resource economy everywhere. |

**Trade-offs:**
- Fixes the actual balance problem (the game is no longer *decided* at setup), not just the
  resolution semantics.
- **Every candidate knob is also a balance-redesign lever** (§7). Changing any of them *pre-empts* a
  decision that track has explicitly reserved for its Phase-2 session with Sam. High collision risk.
- Does **not** address the fidelity gap: even on a clean board, a born-terminal setup victory (rare
  but possible on some geometries) would still resolve first-to-clinch mid-setup, which no DER
  sanctions. Option B alone leaves DER #18 unwritten.
- If chosen, **boardSize 120** is the most surgical (touches only the default board, not the
  finish-line or territory-scale math that the balance track tunes) — but it still collides with the
  protected board-96 coordinate. **This choice must be made *with* the balance track, not around it.**
- Config-only change to `defaultConfig()` → **not** subject to TDD (config), but the *behavior* it
  changes is asserted in tests; expect golden churn.

### Option C — Both (DER #18 + a default-board fix)

**What:** Resolve setup victory at the boundary (Option A, the fidelity fix) **and** widen/retune the
default board (Option B, the balance fix), coordinated with the balance track.

**Trade-offs:**
- Addresses both axes: the game isn't decided at setup (balance) *and* any born-terminal geometry
  resolves fairly at the boundary (fidelity).
- Largest blast radius; a config change here **must** be sequenced with the balance-redesign track's
  Phase-2 decision to avoid double-churning goldens or contradicting a lever choice.
- Most work, most coordination; cleanest end state.

### Option D — Status quo + designer-instrument warning

**What:** Leave the engine and defaults as-is. Rule (DER-style) that setup-phase victory is *accepted
behavior on undersized boards*, and add a **designer-facing warning**: the NewGame designer surfaces a
non-blocking notice when the chosen `(boardSize, ironCount, radius, victoryThreshold)` admit a
single-disk instant win (computable cheaply — it's the §3.3 first-placer best-disk check, one
`generateBoard` + one outer-ring sweep). The surface for this **already exists**: the designer renders
a single-sourced advisory note today (`BALANCE_IN_PROGRESS_NOTE`, `web/src/designer/presets.ts:10-11`,
rendered at `NewGame.tsx:127-128`, `data-testid="balance-note"`); a degeneracy warning is the same
mechanism keyed on the chosen config. No engine or default-config change.

**Trade-offs:**
- Zero collision with the balance track; zero golden churn; the warning itself is trivially cheap.
- **Does not fix the shipped default** — and the shipped default is real: `NewGame.tsx` seeds from
  `defaultConfig()` with 2 human seats (§1.1), and the web-client design already concedes "default
  config balance is known-broken (48/200 games won at setup)"
  (`docs/superpowers/specs/2026-06-12-web-client-design.md:15`). A player who opens NewGame with
  defaults can still win instantly; D only tells them so.
- As a *standalone* option, weakest — it documents the bug instead of fixing anything. As a
  **complement** (the warning bundled with A or C), it is nearly free and covers every degenerate
  config a user can compose, not just the shipped default. §8 promotes the warning into the
  recommendation on that basis.

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
   Resolving setup victory at the boundary is a fidelity/resolution change, not a balance-lever
   change; it doesn't touch vt/ironCount/board-size/placeRange. It can proceed without waiting on the
   balance track's Phase-2. (It does force a REPLAY_VERSION bump — §6A.3 — which is deploy
   coordination, not balance coordination.)

**Coordination ask:** if any Option-B/C default-config change is chosen, route it through the balance-
redesign track's Phase-2 decision (or explicitly carve it out with Sam) — **and flag to that track
that its protected coordinate is now a *known-shipped-defect* coordinate** (§8, Leg 3): "no rule
change may regress board-96" needs a caveat that board-96's setup behavior is itself the regression.
Do **not** land a `defaultConfig()` change from an adjudication branch.

---

## 8. Recommendation (mine — the ruling is Sam's)

Three legs, revised after adversarial review (the first draft's "Option A removes the worst symptom
for the common 2P case" was wrong — see §6A.2 — and board-96 with 2 human seats is confirmed as the
shipped default, §1.1, which raises the urgency of the balance leg):

**Leg 1 — Adopt DER #18 (Option A), engine-level (fork ii).** *No victory during placements; every
seat places; one `status()` resolution at the setup→play transition, multiple qualifiers resolved by
DER #14.* Implemented as the turn-0 guard in `status()` with the forced REPLAY_VERSION bump; old
mid-setup-terminal rooms freeze **mutation-final** — no re-resolution, no winner change (§6A.3). This
closes the fidelity gap, replaces the undocumented first-to-clinch race with the ruled DER #14
comparison, and keeps all four enforcement points coherent through one choke point. **Flagged decision
points inside this leg (I argue them in §6A; Sam rules): (a) the boundary (setup→play transition vs
first round-end); (b) accepting the deliberate winner-flip semantics (7/24 default seeds) and the
last-placer information advantage they encode; (c) the old-rooms rule — "frozen-as-final" is
MUTATION-final, not PRESENTATION-final: a pre-bump mid-setup-terminal room freezes safely but its
returning viewer sees a frozen board with no victory screen (the winner was never persisted —
`keys.ts`, `session.ts:311-325`, `store.ts:112-124`). I recommend accepting that for the bounded
pre-1.0 degenerate-room population; an optional client-derives-`status()`-on-resync follow-up is
available but not required (§6A.3).**

**Leg 2 — Bundle the designer-facing degeneracy warning now (the instrument half of Option D).**
Because board-96 + 2 humans is *shipped*, and Leg 1 does **not** change the player-facing outcome on
it (the 2P clinch announces on the same command; the game is still decided by setup geometry), the
cheapest honest mitigation available today is the warning: the advisory-note surface already exists
(`presets.ts:10-11` → `NewGame.tsx:127-128`), and the degeneracy predicate is the §3.3 best-disk
check. This is frontend-only, collides with nothing, and covers every degenerate config a user can
compose — not just the default.

**Leg 3 — Route the default-knob change (Option B) to the balance-redesign track, with raised
urgency.** The shipped default is instant-winnable on 87.5% of seeds; after Legs 1-2 that is a
*warned, fairly-resolved* defect, but still a defect. Every fix knob is a Phase-2 lever on that
track's protected board-96 coordinate (§7), and a board-gen iron-reachability constraint there may
subsume the fix. The flag to carry to that track: **the protected coordinate is itself the shipped
defect** — "no rule change may regress board-96" should not be read as "board-96's setup behavior is
acceptable."

**Why not the alternatives:**
- **Not A-alone (the first draft's position):** with board-96 confirmed shipped, my own Option-D
  rejection — "win before your first move with no warning is not acceptable" — cuts almost as hard
  against A-alone, since A does not change the shipped 2P experience. Hence Leg 2 is bundled, not
  optional.
- **Not fork (i) (session-level A):** no version bump → concluded rooms rehydrate live and their
  winners can change (§6A.3); four hand-patched enforcement points → silent-stall/zombie-room defect
  surface. Rejected on both grounds.
- **Not B or C from this branch:** every knob is a reserved balance-track lever on a protected
  coordinate; a unilateral change pre-empts that track's Phase-2 and double-churns goldens (§7).
- **Not D-alone:** documents the defect without fixing resolution semantics or the default; weakest as
  a standalone (§6D).

If Sam wants the balance axis fixed *now* rather than routed, the most surgical single knob is
**boardSize 96 → 120** (§3.6, §6B) — but even that should be a joint call with the balance track.

---

## 9. Reasoning chain, alternatives ruled out, and uncertainties

Per CLAUDE.md §Thinking documentation (this is a reasoning-heavy adjudication).

### 9.1 How I approached it

I separated the finding into two orthogonal axes early — **fidelity** ("should setup decide a game,
and resolved how?") vs **balance** ("is the default board degenerate?") — because the fixes, owners,
and blast radii differ. That separation survived adversarial review and remains the doc's spine. What
the review added: a third, previously invisible dimension inside the fidelity axis — the current
semantics are not merely "a check during setup" but **first-to-clinch resolution** (§1.5), so the fix
is a *semantic choice between resolution rules*, not a neutral timing correction.

I treated the engine code as source of truth over the stale rules doc (project lesson
"code-over-rules-doc") but used the printed rules as *evidence of design intent*. The decisive fidelity
observation is that the printed rules are **silent** on setup victory *by construction* (no round
exists during setup), which is exactly the DER-shaped gap — not a contradiction to resolve but an
absence to rule on.

### 9.2 Alternatives considered and ruled out

- **"Just delete the setup-victory branch" (naive Option A).** Ruled out by probe §3.5: 4-6P default
  games decide during setup even under balanced auto-placement (14/24 4P seeds), and non-final placers
  reach threshold mid-setup (9/24 4P). Deleting the branch resurrects the silent-hang bug its own
  comment warns about. The correct Option A *moves* the resolution to the setup→play boundary rather
  than removing it.
- **Session-level implementation of Option A (fork i).** Ruled out in round 2 (§6A.3): the replay-
  version closure excludes the reducer files, so no bump fires — concluded mid-setup rooms rehydrate
  as live games and their winners can change; and all four §5.1 enforcement points must be
  hand-patched, each miss shipping a silent-stall or zombie-room bug. Engine-level (fork ii) gets
  coherence and room protection for free.
- **First-round-end as the resolution boundary.** Ruled out (§6A.1): not equivalent to the transition
  (post-round positions differ after the turn-1 first player acts); lets a decided game run a round of
  dead play; and forfeits the free alignment with `record.ts:43`'s existing boundary.
- **"It's a last-placer-order exploit."** Ruled out by §3.3 for the *degeneracy* (the first placer can
  already win on 21/24 default seeds — board density, not seat order). Refined in round 2: placement
  order DOES matter for *resolution semantics* — first-to-clinch privileges early seats, boundary
  resolution privileges the last seat (§3.7). Two different order effects; the first draft conflated
  them.
- **"It's a DER-#17 (overlapping-iron) manifestation, so let that fix cover it."** Ruled out, now with
  a mechanism proof: DER #17's exclusivity subtraction requires a standing opponent *perimeter*
  (4 bases, `control.ts:36`, `:79-93`) — unreachable during setup at one base per player. Any winner
  selection at the setup boundary is DER #14 *resolution among qualifiers*, not DER #17 *reduction of
  counts*. Same "radiating disks over-count" family, provably disjoint mechanism.
- **"Change the default config here and be done."** Ruled out by §7: every knob is a protected
  balance-redesign lever; changing `defaultConfig()` from an adjudication branch would pre-empt that
  track's Phase-2 decision and risk regressing its protected board-96 coordinate.
- **Blocking the pathological hex at placement time (a placement legality rule).** Considered and set
  aside: it would be a *new* engine rule the printed rules don't describe (DER #6 grants free outer-ring
  choice), it's brittle (which hexes are "too good" depends on vt/radius/board), and it doesn't
  generalize. A board-gen reachability constraint (balance track) is the cleaner home for "no
  single-disk instant win."

### 9.3 What I'm still uncertain about

- **Whether the last-placer information advantage under DER #18 needs its own mitigation.** Boundary
  resolution lets the final placer counter-pick with full information (§3.7). On current data the
  exposure is bounded (flips need a sub-maximal clinch; best-vs-best never flips; the whole situation
  only exists on degenerate boards that Legs 2-3 address) — but I have not probed N-player
  free-placement flip rates, and a "simultaneous reveal" alternative was not designed. I judged it
  out of scope; Sam may weigh it differently.
- **How many live rooms would actually freeze on the fork-(ii) version bump.** The freeze rule is the
  designed mechanism, but I don't know the population of in-flight snapshot-less rooms on
  staging/production at deploy time. If it's nonzero, the deploy note should say so.
- **DER #6 registry-text drift (side observation, out of scope):** the registry says first-base
  placement is "offered in a **drawn** placement order" (`rules-content.ts:52-54`) and the design spec
  says the placement order is drawn (`2026-06-12-web-client-design.md:127`), but the code places in
  **seat-id order** (`turn.ts:94`). Whoever implements DER #18 will touch this text's neighborhood;
  the drift should be adjudicated then (it decides *who* holds the §3.7 last-placer advantage).
- **Whether `reason:"iron"` should be reused unchanged for a transition-boundary victory.** I lean
  yes (the printed rules would call it a round-end win); a distinct reason would leak implementation
  detail into the wire contract for no player value. Small ruling inside Option A.

### 9.4 What I'd probe with more time

- **N-player free-placement flip rates** (§3.7 is 2P-exhaustive only): with 3-6 seats, how often can
  the last placer out-iron the best standing qualifier? The information advantage grows with the
  number of visible placements.
- **CRN-paired**: does a fork-(ii) implementation change any golden beyond the setup-victory cases?
  (Expected: only the setup-victory assertions and the replay-version stamp move; confirm no
  play-phase golden shifts.)
- **The board-gen reachability constraint's cost**: how much does "no single radius-5 disk covers ≥
  threshold iron" shrink the space of generatable 96-hex boards? If it's cheap, it may be the single
  fix that serves both this finding and the balance track (§7.3) — worth a generation-yield probe
  before the balance track chooses its lever.
- **The live-room freeze census** (§9.3): enumerate stored rooms without snapshots before deploying a
  version bump.

### 9.5 Things I almost missed (and what caught them)

- That **deleting** the setup check is not a valid Option A — the mid-setup branch catches real 4-6P
  born-terminal games (§3.5). Caught by my own round-1 probe; without it I'd have recommended a fix
  that reintroduces a silent-hang bug.
- That the finding's "second placement" is a red herring for the degeneracy — the *first* placer can
  already win (§3.3). Caught in round 1.
- **That "deferral is lossless / identical winner" was false under free placement** — my round-1
  deferral probe used auto-placement only, and auto-placement (even-spacing, not iron-greedy) never
  produces competing qualifiers. Caught by the round-2 adversarial review (seed-4 counterexample);
  my re-probe confirmed and extended it (7 flip seeds, not 3). Lesson: a "lossless" claim about a
  semantics change must be probed under the *adversarial* input regime the change governs, not the
  cooperative one.
- **The replay-versioning fork** — I had not consulted `compute-replay-version.ts` at all in round 1,
  so the doc was silent on the concluded-room-winner-change hazard of a session-level fix and the
  freeze consequence of an engine-level fix. Caught by the round-2 review.
- **The board-96 "is it shipped?" question was manufactured by my own misquote** — I attributed
  "a sweep near-miss coordinate, not a designed game mode" to board-96 when the balance design's
  line 60 applies it to big300. The repo answers the question directly (`NewGame.tsx:52-58`,
  `new-game-form.ts:44-46`). Caught by the round-2 review; the correction re-weighted the
  recommendation (§8).
- That `PROLONGED_CONFIG` in `drive-vs-recordgame.test.ts` exists *because* the test authors already
  route around setup-victory — independent corroboration that setup-victory is a known nuisance, not a
  designed feature. Caught in round 1.

---

## 10. Review record

**Round 1 (initial adjudication, this session).** Lens: fidelity vs balance separation; probes for
degeneracy rates, config-space, mid-setup-branch reachability, and (flawed) deferral safety.
Produced the doc's structure, §1-§7 data, and an A-alone recommendation.

**Round 2 (independent adversarial review, same day).** Lens: adversarial verification of every
load-bearing claim against the engine. Three blockers, all verified by my own re-probes before
adoption:

1. **"Lossless / identical winner" refuted** (seed 4/8/10 counterexamples confirmed; my re-probe
   found 7 flip seeds total). Rework: §1.5 (first-to-clinch named), §3.7 (flip quantification), §6A
   rewritten as a deliberate semantic change with a precise DER statement, one chosen boundary, and
   scoped no-suppression claim; the false "(equivalently, the first round-end)" and the false §8
   "removes the worst 2P symptom" claims removed.
2. **Replay-versioning consequences added** (§6A.3): the closure exclusion
   (`compute-replay-version.ts:14-29`), the session-level vs engine-level fork, the
   concluded-room-winner-change hazard, the freeze gate (`game-room.ts:610/:616/:687-695`), and the
   frozen-as-final rule for old rooms. Enforcement-point inventory completed from 2 to 4 points +
   host touchpoint (§5.1).
3. **Board-96 shipped-status corrected** (misquote fixed in §6B/§6D; manufactured uncertainty deleted
   from §9.3; shipped-ness pinned to `NewGame.tsx:52-58` + `new-game-form.ts:44-46`). Recommendation
   re-weighted from A-alone to the three-leg form (§8): DER #18 + bundled designer warning + urgency-
   raised routing of the knob change.

   Also fixed per review: the §6B misreading of rules line 279 (it anticipates *smaller* boards for
   2/4P — the physical intuition that inverts under the digital disk model), and the DER #17
   winner-selection distinction now carries the mechanism proof (`control.ts:36/:79-93`).

Round-2 findings **not** adopted: none — every blocker verified cleanly; my re-probes extended
blocker 1 (7 flip seeds vs the review's 3) rather than narrowing it.

**Round 3 (fresh independent blind adversarial review, 2026-07-04).** A new reviewer with no access
to the prior rounds' framing re-derived the mechanism with live engine probes: the turn-0 guard, the
7 flip seeds, the freeze path, and the designer-warning feasibility all reproduced. **No blocker.**
One presentation concern on leg-1 decision (c): "freeze old mid-setup-terminal rooms as final"
over-specified — verified against the storage layout (`keys.ts`: no winner/terminal key; a
mid-setup-terminal room persists only its placement log, no snapshot), the winner was only ever a live
`gameOver` broadcast and is carried by **no** persisted surface (`resyncPayload` `session.ts:311-325`;
store sync handler `store.ts:112-124`). So the fork-(ii) bump freezes such rooms **mutation-safely**
(no re-resolution, no winner change) but a returning viewer sees a **frozen board with no victory
screen**. Folded in: §6A.3 and leg-1(c) now distinguish **MUTATION-final** (the safety property, which
holds) from **PRESENTATION-final** (which does not — the win was never stored), with the accept-as-is
vs optional-client-follow-up choice flagged for the ruling. I re-verified all three storage claims by
inspection before folding. The review has converged (blocker count: 3 → 0).

_Terminology note: this doc numbers its own initial adjudication as "Round 1"; the **Ruling** below
(which counts only the two *adversarial* rounds) calls the three-blocker review "round 1" and this
fresh clean review "round 2." Same two adversarial passes, offset labels._

---

## Appendix — probe provenance

All quantitative claims come from throwaway `bun run` scripts executed in this worktree against the
engine barrel (`src/index.ts` exports: `initGame`, `placeFirstBase`, `legalFirstBaseHexes`,
`representativeFirstBase`, `control`, `status`, `defaultConfig`). Scripts were **not committed** — they
are decision-support probes, not regression fixtures (per the task scope; if a fix lands, the
single-disk-reachability check in §3.3 and the §3.7 flip sweep are the natural regression assertions
to promote). Round-1 probes: exact-finding repro (engine + session reducer), degeneracy sweep
(§3.1-3.4), auto-placement setup-victory rates (§3.5), config-space sweep (§3.6), auto-placement
deferral check (superseded in scope by §3.7). Round-2 probes: exact seed-4 counterexample
verification, exhaustive 2P free-placement flip sweep (every seat-0 clinch × every seat-1 response,
seeds 1-24). Seeds 1–24, generated boards, `defaultConfig()` except where a knob is stated. The repro
in §1 is reproducible directly from the snippet against `origin/dev` at this branch's base.

---

## Ruling (2026-07-04, issued by Claude under Sam's delegation)

**Authority & process.** Sam delegated this ruling to Claude on the condition of a completed adversarial review. Two independent blind adversarial rounds were run against this document: round 1 found three blockers (the "lossless / identical winner" claim was false under human free placement; the REPLAY_VERSION / frozen-room implementation cost was absent; the "is board-96 shipped" uncertainty rested on a misquote the repo refutes), all fixed in the revision; round 2 used a fresh reviewer who re-derived the mechanism with live engine probes and found no blocker, only the leg-1(c) presentation clarification now folded in. The review has converged.

**Ruling: ADOPT all three legs.**

1. **DER #18 — no victory is decided during the setup (first-base placement) phase.** Every seat completes its placement; a single `status()` resolution runs at the setup→play transition, with DER #14's ordering (most iron, then lowest player id) resolving multiple qualifiers. Implement engine-level via the turn-0 guard in `status()`. This is a DELIBERATE semantic change from the current first-to-clinch behavior — it moves the placement-order privilege to the last placer (an information advantage) and flips the winner on 7/24 default 2P free-placement seeds; adopted with eyes open because the alternative (a victory before a player's first turn) is worse. Accept the forced REPLAY_VERSION bump.
   - **Old rooms (decision c):** "freeze mid-setup-terminal rooms as final" means MUTATION-final — the bump freezes them, preventing any re-resolution or winner change (the safety property, which holds). It is NOT presentation-final: a returning viewer of such a pre-bump room sees a frozen board with no victory screen (the winner was never persisted). ACCEPTED as-is for the affected population (pre-1.0 degenerate instant-win rooms on the default board); the optional client-derives-terminal-via-status() follow-up is not required by this ruling.

2. **Ship the designer-instrument degeneracy warning now** — frontend-only, computable at form time from the existing client barrel exports; warn when the configured board + control radius + iron-victory threshold makes a single first-base control disk instant-winnable.

3. **Escalate the default-knob fix to the balance-redesign track with raised urgency**, carrying the flag that the protected board-96 shipping-default coordinate is itself the degenerate surface.

**Scope.** This ruling records the DECISION only. The engine implementation of DER #18 (guard, version bump, freeze handling, tests), the designer warning, and the balance-knob change are SEPARATE efforts with their own TDD — NOT part of this documentation PR, and NOT part of the SPA client (Deliverable 2) track now in flight. They belong to the engine / balance-redesign track.
