# Design — DER #18 implementation (no victory during the setup phase)

**Date:** 2026-07-04
**Status:** design, pending Sam review → `/writing-plans-enhanced`
**Ruling (authoritative):** `docs/plans/2026-07-03-setup-iron-victory-adjudication.md` §Ruling (PR #64, merged). This design implements legs 1 and 2 of that ruling; leg 3 (default-knob change) is the balance-redesign track and is NOT in scope here.

## Problem (one paragraph)

With the shipped default config (generated 96-hex board, ironCount 14, controlRadius 5, ironHexesToWin 10, 2 human seats), a single first-base placement can win the game during the setup phase: a radius-5 control disk covers ≥10 of the 14 irons, so `status()` returns an iron victory before any player takes a real turn. Under human free placement (DER #6) ~87% of default seeds are instant-winnable, and even the first placer can win. The ruling adopted three legs; this design implements the two near-term ones.

## Ruling recap (what was decided)

1. **DER #18** — no victory is decided during setup. Every seat places; one `status()` resolution runs at the setup→play transition, with DER #14's ordering (most iron, then lowest player id) resolving multiple qualifiers. Implement **engine-level** via a turn-0 guard in `status()`. Accept the forced `REPLAY_VERSION` bump. Old mid-setup-terminal rooms freeze as **mutation-final** (not presentation-final — see §Old rooms).
2. **Designer degeneracy warning** — ship now, frontend-only, computable at form time.
3. **(Balance track, not here)** — escalate the default-knob change with raised urgency.

This is a **deliberate semantic change**: current behavior is *first-to-clinch* (the clinching placement ends the game and `session.ts:90` rejects later commands with `GAME_OVER`, so later seats never place). The new behavior lets all seats place, then resolves at the boundary. Under free placement the winner **flips on 7/24 default 2P seeds** (a sub-maximal clinch answered by a higher-iron response), and the placement-order privilege moves from the first-clincher to the last placer (an information advantage). Adopted with eyes open because the alternative — a victory before a player's first turn — is worse.

## Engine facts (verified against the code, 2026-07-04)

- `status()` (`src/engine/status.ts:96`) is the single victory check. **The DER #14 tie-break already lives there** (`iron > best.iron || (iron === best.iron && comp[0] < best.players[0]`), so the boundary resolution reuses existing logic — no new selection code.
- `phase.turn` is **0 through every setup placement** and becomes **1 on the final placement** (`src/engine/turn.ts` — the setup `openSession`/`setupGame` state is `{turn: 0, …}`; the last `placeFirstBase` "draws the turn-1 order and transitions to turn 1"). So `state.phase.turn === 0` is exactly "still in setup".
- `src/engine` **is inside the replay closure** (`scripts/compute-replay-version.ts:21` `REPLAY_CLOSURE_GLOBS = ["src/engine", …]`) → editing `status.ts` forces a `REPLAY_VERSION` recompute. `test/version.test.ts` gates this (asserts `src/host/version.ts` matches the computed hash), so the plan MUST recompute + commit `version.ts` or CI fails.
- The four setup-victory enforcement points all consume `status()`: `src/session/agent-drive.ts:160-171` (the mid-setup victory branch), `src/session/session.ts:90` (the `GAME_OVER` command guard), `needsDrive` (`agent-drive.ts:27`), and `src/session/record.ts:43`. The round-2 blind adversarial review (in the ruling doc) applied the guard and drove live 2P/3-6P sessions: exactly one `gameOver` per game, always at the setup→play transition, never mid-setup, no stall, no double-emit — so the single guard is coherent with all four at **zero per-site edits**.

## Architecture

### Phase 1 — engine (Review-class)

**The change is one line** at the top of `status()`:

```ts
export function status(state: GameState): Status {
  // DER #18: no victory is decided during the setup phase (turn 0). Every seat places
  // first; the setup→play transition (final placement advances phase.turn to 1) is the
  // first moment a victory can resolve, so a mid-setup iron majority is not yet terminal.
  if (state.phase.turn === 0) return { kind: "ongoing" };
  // … existing iron / last-standing checks unchanged …
```

Then:
- **Recompute `REPLAY_VERSION`:** `bun scripts/compute-replay-version.ts`, update `src/host/version.ts`. Verify `test/version.test.ts` (`--check`) passes.
- **Test remediation (the delicate part):** existing tests that encode the *old* mid-setup-victory timing must be **re-expressed** to the boundary timing — coverage moves to the new truth, never deleted. Candidates the plan must audit (grep `placeFirstBase` + `cause:"iron"` + `gameOver` under `test/session/`): `drive-vs-recordgame.test.ts`, `agent-drive.test.ts`, `record.test.ts`, `part-a-integration.test.ts`, `place-first-base-command.test.ts`. Each assertion that "a mid-setup placement produces a victory" becomes "a mid-setup placement stays ongoing; the transition resolves it". This is a re-expression of intent, not a weakening — call out every touched assertion in the PR.
- **New tests pin the new behavior:** (a) a mid-setup placement covering ≥threshold irons → `status()` ongoing; (b) the setup→play transition resolves the qualified winner; (c) multiple qualifiers at the boundary → DER #14 tie-break; (d) a full drive (2P and a 4P-with-agents) emits exactly one `gameOver` at the transition, none mid-setup, no stall; (e) the deliberate winner-flip, documented (seed 4: seat0 clinches 10 iron at `(1,3,-4)`, seat1 answers 11 iron at `(2,2,-4)` → boundary picks seat1).

### Phase 2 — designer degeneracy warning (Routine, frontend, independent of Phase 1)

In `web/src/designer/NewGame.tsx`, a **memoized predicate** over the config fields that determine reachability (`boardSize`, `ironCount`, `radius`, `victoryThreshold`, `seed`, `boardSource` — the REAL `RuleConfig` field names: "Control radius" is `config.radius`, "Iron hexes to win" is `config.victoryThreshold`; `controlRadius`/`ironHexesToWin` do NOT exist on the type and would fail typecheck): generate the board via the client engine barrel, then check whether **any single first-base control disk covers ≥ `config.victoryThreshold` irons** (max over `legalFirstBaseHexes` of the iron count within that hex's radius-`config.radius` control disk). If yes → surface an advisory note through the existing note mechanism (`presets.ts` `BALANCE_IN_PROGRESS_NOTE` sibling / the `balance-note` render slot at `NewGame.tsx:169-170`): *"With these settings a single first base can win instantly — raise the board size or the iron-victory threshold, or lower the control radius."*

- **Feasibility (verified in the ruling's round-2 review):** the client barrel already exports `initGame`/`generateBoard`/`legalFirstBaseHexes`/`control`/`status`/`distance`; the predicate is ~30-40 `control()`/disk-coverage calls on a generated board, cheap at form time. Memoize on the config-field tuple so it does not run per keystroke; the board generation is the dominant cost.
- Bundle discipline: the predicate uses only pure barrel exports (no `src/agent`), so it does not affect the entry-chunk guard.

### Old rooms (the round-2 clarification)

The `REPLAY_VERSION` bump freezes any room recorded under the old semantics that has no snapshot and a non-empty log — i.e. every mid-setup-terminal room — on its next wake (`src/host/game-room.ts` freeze path). This is **mutation-final**: no re-resolution, no winner change (the safety property, which holds). It is **not presentation-final**: such a room persisted only its placement log (no snapshot, no terminal/winner marker — the winner was only ever a live broadcast), so a returning viewer sees a frozen board with **no victory screen**. Per the ruling this is **accepted as-is** for the affected population (pre-1.0 degenerate instant-win rooms on the default board). The optional client-derives-terminal-via-`status()` follow-up is **not** in scope.

## Alternatives considered and ruled out

- **Session-level implementation (`agent-drive.ts`) instead of engine-level (`status.ts`).** Rejected by the ruling: `agent-drive.ts`/`session.ts` are **excluded** from the replay closure (`compute-replay-version.ts:17`), so a session-level guard forces **no** version bump → concluded mid-setup rooms rehydrate as **live** games after redeploy (the new code no longer treats setup-victory as terminal → placements resume), and a concluded room's **winner can change** post-redeploy with no version gate catching it. Engine-level forces the bump → old rooms freeze safely. Engine-level wins on data integrity.
- **Per-enforcement-point edits at the four setup-victory sites.** Rejected: the single `status()` guard is verified coherent with all four (they all consume `status()`), and one change is far less error-prone than four coordinated edits (an implementer following a four-site list would risk the silent-stall bug the ruling warns about).
- **First-round-end boundary instead of the setup→play transition.** Rejected: after a full round of real play, positions change (bases built/destroyed), so a first-round-end resolution is not winner-invariant against the transition — a different game. The transition is the earliest, cleanest boundary.
- **Client-derives-terminal follow-up for old frozen rooms.** Deferred: not required by the ruling; the freeze-as-mutation-final is accepted for the pre-1.0 degenerate population.
- **Bundling leg 3 (default-knob change).** Out of scope: it belongs to the balance-redesign track, whose board-gen iron-reachability constraint may subsume the knob fix. This plan flags the interaction; it does not pre-empt it.

## Uncertainties / decisions for Sam

- **Merge authority for Phase 1.** Phase 1 carries a `REPLAY_VERSION` bump (data-integrity, replay-compat blast radius) and changes winner semantics. The `balance-redesign-merge-authorization` covers the balance effort's PRs after a blind Fable-tier adversarial review; DER #18 is the *fidelity* leg (adjacent to but distinct from balance-knob tuning). **Decision for Sam:** does that authority extend to this version-bumping change, or do you want to merge Phase 1 yourself? Default in the plan: treat Phase 1 as Review-class, run the blind adversarial gate, and STOP for Sam's confirmation before merge.
- **Golden-corpus / replay-compat gate** does not exist yet (it is part of the deferred, Sam-gated production-cutover plan). The version bump invalidates old stored replays (intended — the setup-victory timing changed); with no real stored games beyond degenerate staging rooms, this is acceptable pre-1.0. No golden corpus to gate against yet.
- **Exact test-remediation set** — the plan's Phase-1 task must open with a grep to enumerate every test asserting the old timing, so none is missed and each re-expression is deliberate.

## Success criteria

- No victory resolves while `phase.turn === 0`, for any seat count; the setup→play transition resolves a qualified winner via DER #14; a full 2P and 4P-with-agents drive emits exactly one `gameOver` at the transition, none mid-setup, no stall.
- `REPLAY_VERSION` recomputed + committed; `test/version.test.ts` green; full root suite green with the re-expressed assertions.
- The designer warning fires for the degenerate default (96/14/radius5/threshold10) and is absent for a clean config (threshold ≥12, or size ≥120, or radius ≤4); memoized, no per-keystroke board gen.
- Old mid-setup-terminal rooms freeze safely on redeploy (no winner change); the accepted presentation gap is documented, not fixed.
