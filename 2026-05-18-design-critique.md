# Industrial Juggernaut — Design Critique

**Date:** 2026-05-18
**Subject:** Rules draft v9 / file `industrial-juggernaut-rules-v10.md`

## Summary

Industrial Juggernaut is an ambitious, mostly elegant design with a strong central mechanic, but it has a handful of balance and friction issues that would need playtesting to resolve. The core engine (perimeter geometry + shared factories + dual-track economy) is genuinely novel and worth developing. The edges (elimination bounties, 2P turn order, brittle iron-loss condition, auto-win attacks) are where the design is still rough.

## What's Well Designed

### The radiating-to-perimeter pivot is the standout idea
Most territory games use one model; this uses two, hinged on a single decision (your 4th base). That creates a genuine moment of agonized choice — commit too early and you may *shrink*, wait too long and you get overrun. Few games make a phase transition into a player-driven lever. This is the core that makes the game interesting.

### Resource math is clean
`Iron + Factories → half rounded down` is the kind of formula you can teach in 10 seconds and that scales smoothly from bootstrap (1 factory) to runaway production. Build/attack as a binary on each round prevents fiddly micro-actions.

### The shared 36-factory pool is a quiet masterstroke
A tragedy-of-the-commons baked into the economy: factories are *board state*, not personal inventory, and the supply is finite. This rewards early aggression and creates indirect interaction even when nobody is fighting.

### Combat is fast and meaningful
Single-draw resolution with 3/4/5/6 commitment tiers (75/83/89/100%) gives you risk-tuning without spreadsheets. Fatigue prevents one player from chain-attacking, and the "defender commits exactly 1" rule keeps defense from becoming a stalling tactic.

### Multiple loss conditions create real strategic texture
No bases / no iron / broken perimeter (late) / self-destruct on empty perimeter — these aren't redundant; they reward different aggressive playstyles. The 18-factory threshold is a nice **soft clock** that makes the late game more dangerous than the early game.

### Alliances with shared victory threshold
Combining iron counts toward 10 is a strong diplomatic lever. The unilateral-dissolution rule keeps it tense — every alliance is provisional.

## What's Questionable

### 6-base attack = 100% auto-win is anticlimactic
It collapses the most dramatic moment of the game into a math check. Even 95% with a "miracle defense" possibility would preserve narrative tension. Right now, once a player can mass 6 bases in range, the defender has *no agency at all*.

### Eliminating a player hands you their 12 bases — runaway leader problem
The first kill nearly guarantees the second. There's no rubberbanding here; the snowball is steep. Combined with "no iron → instant elimination," a single bad battle can cascade into removal, and the killer doubles in strength.

### The 2-player turn order rule is the opposite — rich-get-richer
Iron-weighted bag draws mean the leader gets *more* first-player odds. This compounds an advantage instead of compensating for it. The 3–6P version (last-place plays first next turn) does the right thing; the 2P rule does the wrong thing.

### Geometry rules are elegant in writing, fiddly in practice
"Unobscured triangle via straightedge from center to center, not crossing any perimeter hex" is precise but invites table arguments every placement. Hex-corner edge cases (does the line *touch* the perimeter?) will need a tiebreaker rule. Stranded bases, perimeter reassessment after a loss, and "maxed-out base relocation" all compound this.

### "No iron → instant loss" is brittle
A single perimeter shift from an adjacent rival can end your game without combat. That's a lot of weight on iron placement, which is *random*. Bad iron RNG can doom a seat before play even starts.

### Build-or-attack as a strict binary can produce dead turns
If you can't profitably build (nowhere good to place) and can't profitably attack (out of range or under-committed), your round is wasted. Many games solve this with a "pass and gain something small" option.

### Random turn order each turn adds variance to a fairly deterministic combat system
The game is otherwise low-randomness (one bag draw per battle); re-rolling initiative every turn injects swing that may overwhelm careful positioning, especially at 5–6 players.

## What's Unresolved

The author's own "Variables to Test" table is honest about this — base radius, attack range, factory count, and victory threshold are all tagged as untested. That's the right list. Two additions:

1. **Kill bounty (12 bases)** — probably too large. Half their bases, or none, would test better.
2. **Auto-win at 6 commit** — try 95% / 8-tokens-to-1 and see if games feel better.

## Verdict

The game reads like a v9 draft that has solved its hardest problem (territory representation) and is now working through second-order balance — which is exactly where a strategy game *should* be at this stage. The radiating-circles → enclosed-polygon transition is a publishable idea; the surrounding economy and combat systems support it without overcomplicating it. The next round of revisions should focus on **rubberbanding** (kill bounty, auto-win), **RNG fragility** (iron placement, 2P turn order), and **geometry adjudication** (a clear tiebreaker for sight-line edge cases).
