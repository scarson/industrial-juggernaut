// ABOUTME: rulesSections — the curated rules-reference structure rendered by RulesReference.tsx,
// ABOUTME: with all 17 Digital Edition Rulings merged inline at the section each ruling modifies.
/**
 * Curation choice (documented per the P2.8 plan): this module CURATES the printed rules rather
 * than embedding `industrial-juggernaut-rules-v10.md` in full. The v10 text is long, written for
 * a physical velvet-bag-and-tokens table, and in several places describes behavior the Digital
 * Edition engine deliberately diverges from (see each Digital Edition Ruling below). Reproducing
 * it verbatim would teach rules the engine does not enforce.
 *
 * `industrial-juggernaut-rules-v10.md` at the repo root REMAINS the source of truth for the
 * printed game — this screen's job is teaching the DIGITAL edition specifically: the seven
 * sections below (setup, rounds, building, combat, territory/perimeter, elimination, victory)
 * carry faithful prose summaries of the printed rule, and every Digital Edition Ruling (DER
 * #1-17, `docs/superpowers/specs/2026-06-12-web-client-design.md` "Digital Edition Rulings")
 * is attached as a callout on the section it modifies — so a player reading one section sees
 * both the printed rule and how the engine actually enforces it, in one place.
 *
 * DER #1 (convex-hull territory) is the highest-stakes divergence — it changes how the board
 * plays relative to the physical game — so it is pinned first among the Territory & Perimeter
 * section's callouts (see the "DER #1 first" test in rules-content.test.ts).
 */

/** One Digital Edition Ruling callout, attached to the section it modifies. */
export interface DerCallout {
  /** The DER number (1-17) from the design spec's "Digital Edition Rulings" list. */
  readonly n: number;
  readonly title: string;
  readonly body: string;
}

/** One curated rules section: prose summary + the DER callouts relevant to it. */
export interface RulesSection {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly ders: readonly DerCallout[];
}

export const rulesSections: readonly RulesSection[] = [
  {
    id: "setup",
    title: "Setup",
    body:
      "Each player takes 12 base tokens and 8 battle tokens in their color. Factories start in a " +
      "shared central supply, available to all players. Each player places their first base on any " +
      "hex in the outermost ring of the board, near where they are seated.",
    ders: [
      {
        n: 6,
        title: "First-base placement",
        body:
          "Human players get a free choice of any hex on the outer ring, offered in a drawn " +
          "placement order — the printed rule's \"near where they are sitting\" is a physical-table " +
          "convention that does not translate to a screen. Agent seats auto-pick their first base.",
      },
    ],
  },
  {
    id: "rounds",
    title: "Turn Order & Rounds",
    body:
      "At the start of each turn, players draw to determine round order and keep that order for " +
      "the whole turn. On your round you do exactly one thing: build or attack.",
    ders: [
      {
        n: 12,
        title: "2-player turn order",
        body:
          "First-player draw is iron-proportional, matching the printed battle-token-per-iron-hex " +
          "method. When both players control zero iron (an empty-bag case the printed rules don't " +
          "address), the engine picks the first player uniformly at random.",
      },
      {
        n: 13,
        title: "3+ player turn order",
        body:
          "The previous turn's last and second-to-last surviving players take the first two round " +
          "slots, in random order between themselves; remaining players follow in random order. If " +
          "the previous last or second-to-last player has since been eliminated, the next-latest " +
          "surviving player fills that slot instead.",
      },
    ],
  },
  {
    id: "building",
    title: "Building",
    body:
      "Your resource count is your iron hexes under control plus your factories under control. You " +
      "may build one factory or one base for every two resources, rounded down, and must choose one " +
      "piece type per round — never both. New factories must be placed within 5 hexes of your " +
      "farthest base. New bases outside your perimeter must be within 5 hexes of a friendly base, " +
      "outside any opponent's perimeter, and must form a new triangle with two existing bases once " +
      "you have 3 or more bases on the board (the radiating phase, with fewer bases, only needs the " +
      "first two conditions).",
    ders: [
      {
        n: 7,
        title: "Factory-death clock and the triangle rule",
        body:
          "Two standing Sam-authorized divergences: elimination via broken perimeter while " +
          "industrialized uses a per-player controlled-factory threshold of 8 (not a shared, " +
          "board-wide factory count), and the triangle-visibility rule applies specifically to the " +
          "perimeter-establishing 4th base and beyond.",
      },
      {
        n: 10,
        title: "Factory range on tied-farthest bases",
        body:
          "When multiple bases tie for farthest-from-oldest, a new factory may be placed within 5 " +
          "hexes of any one of the tied bases — the engine's symmetric resolution of a tie the " +
          "printed rules leave unspecified.",
      },
      {
        n: 16,
        title: "Board size is a tunable",
        body:
          "Board size is configurable with an oval-fit tolerance: a requested size of 96 yields " +
          "roughly 93 hexes (±6 for the oval shape), and iron is placed exactly per the 14-hex " +
          "constraint regardless of requested board size.",
      },
    ],
  },
  {
    id: "combat",
    title: "Combat",
    body:
      "Only bases on the outside of an opponent's perimeter may be targeted. The attacker commits " +
      "3, 4, 5, or 6 bases; the defender commits exactly 1. Battle tokens go into the bag for each " +
      "side and a single draw decides the winner — at 6 committed bases, the attacker wins " +
      "automatically with no draw. A voluntary pass is not offered: every round must build or attack.",
    ders: [
      {
        n: 5,
        title: "Voluntary pass is illegal",
        body:
          "The Digital Edition disables passing by default (`allowPass: false`) and enforces it at " +
          "session validation — a round must build or attack whenever a legal action exists.",
      },
      {
        n: 8,
        title: "Exact combat win-probabilities",
        body:
          "The engine computes win chances as exact bag-ratio fractions — 3 bases → 3/4, 4 → 5/6, " +
          "5 → 8/9, 6 → automatic — rather than the printed rules' rounded 83%/89% figures. Same " +
          "token math, exact rather than rounded odds.",
      },
      {
        n: 3,
        title: "Maxed-out capture is destroy-only",
        body:
          "When all 12 of your bases are already on the board and you win an attack, the printed " +
          "rules offer a choice to relocate a base or simply destroy the defeated one. The current " +
          "engine only destroys — the relocate choice is reserved for a future phase under the log " +
          "kind `captureResolution`.",
      },
      {
        n: 4,
        title: "No-eligible-defender targets are unattackable",
        body:
          "If a base has no eligible defender, the engine treats it as unattackable rather than " +
          "forcing a defenderless resolution — the printed rules are silent on this case.",
      },
    ],
  },
  {
    id: "territory",
    title: "Territory & Perimeter",
    body:
      "With fewer than 4 bases, each base radiates a 5-hex circle of control, and territory is the " +
      "union of those circles. Placing a 4th base sets your perimeter: territory becomes everything " +
      "enclosed by the polygon formed by your outermost bases, and bases stop radiating. A " +
      "perimeter must contain at least 1 iron hex. Two players' perimeters can never touch or cross.",
    ders: [
      {
        n: 1,
        title: "Territory is the convex hull of all bases",
        body:
          "⚑ The engine models a player's perimeter as the convex hull of all their bases — the " +
          "printed rules' reassessed visibility-polygons and stranded-base territory exclusion are " +
          "NOT modeled. Stranded bases still count toward the hull and still block opponent " +
          "placements. This is a committed Sam-authorized design decision, not an oversight: it " +
          "plays differently from the physical board, and this is the single most consequential " +
          "divergence in this document.",
      },
      {
        n: 2,
        title: "Stranded-base rescue window is unmodeled",
        body:
          "The printed rules give a stranded base a rescue window (\"this turn or next\"). The " +
          "engine does not model that window — a stranding persists until the base is rescued by a " +
          "later placement or is encircled and removed.",
      },
      {
        n: 11,
        title: "Attackable bases are convex-hull vertices",
        body:
          "A facet of the convex-hull ruling above: a perimetered opponent exposes only the bases " +
          "that sit at hull vertices as legal attack targets. A base lying on a hull edge — " +
          "colinear between two vertices — is treated as interior and cannot be targeted.",
      },
      {
        n: 17,
        title: "Overlapping iron is not subtracted across regimes",
        body:
          "⚠️ Flagged for a future balance review: `control()` is computed independently per player, " +
          "so a radiating neighbor's 5-hex circle and a perimetered player's hull can both count the " +
          "same iron hex. Exclusivity is enforced only by placement bans, not by subtracting a " +
          "perimetered player's claimed iron from a still-radiating neighbor's count — the printed " +
          "\"no longer available to adjacent players that are still radiating\" wording may be " +
          "stronger than the current implementation. Whether this distorts iron races is an open " +
          "question, deferred rather than fixed here.",
      },
    ],
  },
  {
    id: "elimination",
    title: "Elimination",
    body:
      "A player is eliminated by losing their last base, by controlling 8 or more factories when " +
      "their perimeter breaks, by losing all controlled iron, or by placing a 4th base whose " +
      "perimeter encloses no iron at all. Eliminated players' remaining bases go to whoever caused " +
      "the elimination, except self-inflicted empty-perimeter losses, which pay no one.",
    ders: [
      {
        n: 9,
        title: "An iron-less perimeter is legal-but-fatal",
        body:
          "Placing a 4th base that encloses no iron is not blocked at placement time — it is a " +
          "legal move that resolves as self-elimination (cause `emptyPerimeter`, no bounty paid) " +
          "during the post-action elimination pass, matching the printed rules' framing of " +
          "\"destroying yourself absentmindedly.\"",
      },
      {
        n: 14,
        title: "End-of-round resolution order is deterministic",
        body:
          "Round-end resolves in a fixed order: iron victory (meeting the iron threshold) is " +
          "checked before last-player-standing, with ties broken by most controlled iron and then " +
          "lowest player id. Within a single elimination pass, causes resolve as no-bases before " +
          "broken-perimeter before no-iron. A board where every player is eliminated in the same " +
          "pass ends as a victory with no winner.",
      },
      {
        n: 15,
        title: "Alliances are data-model-ready but not yet a player action",
        body:
          "The engine's state already supports coalitions, allied attackers, and allied-aware " +
          "stranding, but there is no in-game action to form or dissolve an alliance yet — that " +
          "negotiation layer is planned for a later phase.",
      },
    ],
  },
  {
    id: "victory",
    title: "Victory",
    body:
      "The game ends the moment any player — or alliance — controls 10 or more iron hexes at the " +
      "end of a round. Alliance members' iron counts combine toward that threshold.",
    ders: [],
  },
];
