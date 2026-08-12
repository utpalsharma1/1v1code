/* ============================================================================
   The ladder — Glicko numbers become a rank somebody can feel.

   §8 hides rating behind a tier ladder, and until now nothing implemented it:
   Glicko produced 1442 and the product showed 1442. A number is a measurement;
   a tier is an identity, and the whole reason §8 specifies one is that "Gold II,
   58 to Platinum" tells a player where they stand and what to do next, while
   "1442" tells them neither.

   THE BANDS. Nine tiers of 150 rating points, four divisions inside every tier
   except Legend. The width is derived from the distribution it has to produce
   rather than picked — see the block above TIER_FLOOR, which shows the working.

   Iron is open-ended downward: rating floors around 100 in practice, and a
   player below the bank's easiest problem still needs a rank to stand on.

   PLACEMENTS. A new account plays 5 matches before it has a tier at all (§8).
   Before that it shows progress through placements, not a badge — showing
   somebody Bronze IV after one match and Gold II after five is worse than
   showing them nothing, because the first badge is the one they remember.
   ========================================================================= */

/** Low to high. Legend is the open-ended top. */
export const TIERS = [
  "iron",
  "bronze",
  "silver",
  "gold",
  "platinum",
  "diamond",
  "master",
  "grandmaster",
  "legend",
] as const;
export type Tier = (typeof TIERS)[number];

/** Displayed IV → I as rating rises, so I is the top of a tier. */
export const DIVISIONS = ["IV", "III", "II", "I"] as const;
export type Division = (typeof DIVISIONS)[number];

/* THE BANDS ARE PRESENTATION OVER GLICKO, and they were re-derived once.
   Nobody's rating changes when these move, which is exactly why they can be
   recalibrated from real data later — §8's own "ratings converge on real data"
   applied to the mapping rather than the numbers.

   THE FIRST ATTEMPT WAS 200 WIDE and put nine tiers across 1800 rating points.
   Modelling the player base as N(1200, 300) — everyone starts at 1200, and the
   spread is taken from comparable competitive-programming ladders — that gives
   Grandmaster 0.12% and Legend 0.012%, which is 1 player in 8,139.

   That is the defect. At the populations this will actually have, those badges
   are not rare, they are UNREACHABLE:

                       N=50        N=200       N=1000
     200-wide   3 badges dead   2 dead      1 dead
     150-wide   2 badges dead   1 dead      0 dead

   A ladder whose top third is decorative is worse than a shorter ladder, so the
   bands narrowed to 150 and nine tiers now span 1350. Master becomes 3.3% and
   Legend 0.4% — still the top of the mountain, but a mountain somebody in a
   room of 250 people has climbed.

   THE START STAYS AT 1200. It is a measurement prior, not a reward, and moving
   it distorts matchmaking for everyone rather than changing what a badge says.
   A new account lands mid-ladder, and the thing that makes early rank feel
   earned is PLACEMENTS (below): no badge exists at all until five matches are
   done, so the first badge is a result rather than a starting position. */
export const TIER_FLOOR = 950;
export const TIER_WIDTH = 150;
export const DIVISION_WIDTH = TIER_WIDTH / DIVISIONS.length;

/** §8: five matches before a rank exists. */
export const PLACEMENT_MATCHES = 5;

export interface Rank {
  tier: Tier;
  /** `null` for Legend, which §8 gives no divisions. */
  division: Division | null;
  /** 0–1 through the current tier. 1 at the top of Legend's first band. */
  progress: number;
  /** Rating needed to reach the next tier, or null at Legend. */
  toNextTier: number | null;
  /** What the next tier is called, for "340 to Platinum". */
  nextTier: Tier | null;
  /** `Gold II`, or `Legend`. */
  label: string;
}

export interface Placement {
  kind: "placement";
  played: number;
  remaining: number;
  label: string;
}

export type LadderStanding = (Rank & { kind: "ranked" }) | Placement;

/** The rating at which `tier` begins. Iron has no floor. */
export function tierFloor(tier: Tier): number {
  const index = TIERS.indexOf(tier);
  return index === 0 ? Number.NEGATIVE_INFINITY : TIER_FLOOR + (index - 1) * TIER_WIDTH;
}

/**
 * Rating to rank. Pure, total, and deliberately independent of Glicko's
 * internals — it takes a number, not a `Rating`, so the ladder can be tested
 * and rendered without a rating system anywhere near it.
 */
export function rankOf(rating: number): Rank {
  const above = Math.floor((rating - TIER_FLOOR) / TIER_WIDTH) + 1;
  const index = Math.max(0, Math.min(TIERS.length - 1, above));
  const tier = TIERS[index]!;
  const isLegend = index === TIERS.length - 1;
  const floor = tierFloor(tier);

  if (index === 0) {
    /* Iron is open-ended downward, so "progress through the tier" is measured
       from its ceiling backwards rather than from a floor that does not exist. */
    const ceiling = TIER_FLOOR;
    const progress = Math.max(0, Math.min(1, (rating - (ceiling - TIER_WIDTH)) / TIER_WIDTH));
    const withinDivision = Math.floor(progress * DIVISIONS.length);
    const division = DIVISIONS[Math.min(DIVISIONS.length - 1, Math.max(0, withinDivision))]!;
    return {
      tier,
      division,
      progress,
      toNextTier: Math.max(0, Math.ceil(ceiling - rating)),
      nextTier: TIERS[1]!,
      label: `Iron ${division}`,
    };
  }

  if (isLegend) {
    return {
      tier,
      division: null,
      progress: 1,
      toNextTier: null,
      nextTier: null,
      label: "Legend",
    };
  }

  const into = rating - floor;
  const progress = Math.max(0, Math.min(1, into / TIER_WIDTH));
  const division = DIVISIONS[Math.min(DIVISIONS.length - 1, Math.floor(into / DIVISION_WIDTH))]!;
  const nextTier = TIERS[index + 1]!;
  return {
    tier,
    division,
    progress,
    toNextTier: Math.max(0, Math.ceil(floor + TIER_WIDTH - rating)),
    nextTier,
    label: `${titleCase(tier)} ${division}`,
  };
}

/** Rank, or placement progress when the account has not finished placements. */
export function standingOf(rating: number, ratedMatches: number): LadderStanding {
  if (ratedMatches < PLACEMENT_MATCHES) {
    const remaining = PLACEMENT_MATCHES - ratedMatches;
    return {
      kind: "placement",
      played: ratedMatches,
      remaining,
      label: `${remaining} placement${remaining === 1 ? "" : "s"} left`,
    };
  }
  return { kind: "ranked", ...rankOf(rating) };
}

/**
 * Did this rating change cross a boundary worth a cinematic?
 *
 * A TIER change is the §6.7 rank-up moment — badge shatters, new badge
 * assembles. A DIVISION change is real progress but not a cinematic; it gets
 * the quiet treatment, because firing the full sequence four times per tier is
 * how a moment stops being one (§2 rule 3).
 *
 * Finishing placements counts as a tier change: it is the first badge the
 * player has ever had.
 */
export type LadderChange =
  | { kind: "none" }
  | { kind: "division"; from: Rank; to: Rank; up: boolean }
  | { kind: "tier"; from: Rank | null; to: Rank; up: boolean };

export function ladderChange(
  before: { rating: number; ratedMatches: number },
  after: { rating: number; ratedMatches: number },
): LadderChange {
  const wasPlacing = before.ratedMatches < PLACEMENT_MATCHES;
  const isPlacing = after.ratedMatches < PLACEMENT_MATCHES;
  if (isPlacing) return { kind: "none" };

  const to = rankOf(after.rating);
  if (wasPlacing) return { kind: "tier", from: null, to, up: true };

  const from = rankOf(before.rating);
  if (from.tier !== to.tier) {
    return { kind: "tier", from, to, up: TIERS.indexOf(to.tier) > TIERS.indexOf(from.tier) };
  }
  if (from.division !== to.division) {
    const up =
      DIVISIONS.indexOf(to.division as Division) > DIVISIONS.indexOf(from.division as Division);
    return { kind: "division", from, to, up };
  }
  return { kind: "none" };
}

/**
 * §4: tier aura scales with tier and MOST TIERS GET NONE. Iron through Gold are
 * flat colour; Platinum and Diamond get the faint aura; Master and above get
 * the full one. A leaderboard where every handle glows is noise, and the
 * restraint is what makes the top of the ladder read as earned.
 */
export type AuraLevel = "none" | "faint" | "full";

export function auraOf(tier: Tier): AuraLevel {
  switch (tier) {
    case "platinum":
    case "diamond":
      return "faint";
    case "master":
    case "grandmaster":
    case "legend":
      return "full";
    default:
      return "none";
  }
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
