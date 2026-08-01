import { PLACEMENT_MATCHES, botMatchIsRated, ladderChange, rateMatch, type Rating } from "@1v1/core";
import { prisma } from "@1v1/db";
import type { MatchOutcome } from "@1v1/core";
import type { RatingDelta, Side } from "@1v1/proto";

/* ============================================================================
   Glicko-2 applied to a real outcome.

   Two things here are easy to get wrong and both are load-bearing.

   1. BOTH SIDES UPDATE AGAINST THE OTHER'S PRE-MATCH RATING. `rateMatch` takes
      two snapshots and returns two results; it never feeds p1's new rating
      into p2's calculation. Sequencing the updates would make the result
      depend on which player we happened to process first.

   2. THE PRE-MATCH RATING IS CAPTURED WHEN THE MATCH STARTS, not read back at
      the end. A player can have another match resolve in between, and §6.7's
      delta must be the delta for THIS match.

   Nothing is rated when the outcome is CANCELED or VOID: routine cancellation
   is nobody's fault, and a VOID is our infrastructure failing, which §6.9 says
   must never cost a player rating.
   ========================================================================= */

export interface RatingSnapshot {
  userId: string;
  isBot: boolean;
  isGuest: boolean;
  rating: Rating;
  placementsLeft: number;
  lastMatchAt: Date | null;
}

export async function snapshot(userId: string): Promise<RatingSnapshot | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      handle: true,
      isGuest: true,
      rating: true,
      ratingDev: true,
      volatility: true,
      placementsLeft: true,
    },
  });
  if (!user) return null;

  const last = await prisma.match.findFirst({
    where: {
      finishedAt: { not: null },
      OR: [{ p1Id: userId }, { p2Id: userId }],
    },
    orderBy: { finishedAt: "desc" },
    select: { finishedAt: true },
  });

  return {
    userId: user.id,
    isBot: user.handle.startsWith("bot_"),
    isGuest: user.isGuest,
    rating: {
      rating: user.rating,
      deviation: user.ratingDev,
      volatility: user.volatility,
    },
    placementsLeft: user.placementsLeft,
    lastMatchAt: last?.finishedAt ?? null,
  };
}

/** §8: a bot match counts only while the system does not yet know where you
 *  belong — during placements or while RD > 100. Above that confidence it is
 *  unrated, which is what stops the bot being farmable while still letting a
 *  new player get placed. A guest never affects rating, for either side. */
export function isRated(p1: RatingSnapshot, p2: RatingSnapshot): boolean {
  if (p1.isGuest || p2.isGuest) return false;

  const bot = p1.isBot ? p1 : p2.isBot ? p2 : null;
  if (!bot) return true;

  const human = bot === p1 ? p2 : p1;
  return botMatchIsRated(human.rating.deviation, human.placementsLeft);
}

/**
 * Applies the outcome. Returns the deltas for the victory screen, or an empty
 * array when nothing was rated.
 */
export async function applyOutcome(opts: {
  matchId: string;
  p1: RatingSnapshot;
  p2: RatingSnapshot;
  outcome: MatchOutcome;
}): Promise<RatingDelta[]> {
  const { matchId, p1, p2, outcome } = opts;

  if (outcome.kind === "CANCELED" || outcome.kind === "VOID") return [];
  if (!isRated(p1, p2)) return [];

  const p1Score = outcome.kind === "DRAW" ? 0.5 : outcome.winner === "p1" ? 1 : 0;
  const now = Date.now();
  const since = (at: Date | null) => (at ? Math.max(0, now - at.getTime()) : 0);

  const next = rateMatch({
    p1: p1.rating,
    p2: p2.rating,
    p1Score,
    // RD grows with time away (§12): an inactive player's rating is not as
    // well known as it was, and pretending otherwise stops the ladder
    // self-correcting.
    p1MsSinceLastMatch: since(p1.lastMatchAt),
    p2MsSinceLastMatch: since(p2.lastMatchAt),
  });

  const sides: { side: Side; snap: RatingSnapshot; after: Rating }[] = [
    { side: "p1", snap: p1, after: next.p1 },
    { side: "p2", snap: p2, after: next.p2 },
  ];

  const deltas: RatingDelta[] = [];

  for (const { side, snap, after } of sides) {
    // §8: the bot is a measuring stick, not a competitor. Its rating is fixed
    // and never updated, or a coordinated group could drag the reference point
    // everyone else is measured against.
    if (snap.isBot) continue;

    await prisma.user.update({
      where: { id: snap.userId },
      data: {
        rating: Math.round(after.rating),
        ratingDev: after.deviation,
        volatility: after.volatility,
        placementsLeft: Math.max(0, snap.placementsLeft - 1),
      },
    });

    // Unique on (userId, matchId), so a replayed finish cannot double-count.
    await prisma.ratingEvent.upsert({
      where: { userId_matchId: { userId: snap.userId, matchId } },
      create: {
        userId: snap.userId,
        matchId,
        before: snap.rating.rating,
        after: Math.round(after.rating),
        devBefore: snap.rating.deviation,
        devAfter: after.deviation,
      },
      update: {},
    });

    /* THE LADDER CHANGE IS COMPUTED HERE, where the placement counts live.

       §6.7's rank-up cinematic has existed in /dev/hud since Phase 1 and has
       never fired on a real match, because nothing ever worked out that a match
       crossed a tier. It needs the PRE-match rating and the PRE-match placement
       count, and both are only in scope at this point — the row has already
       been overwritten by the update above.

       `ladderChange` decides what is worth a cinematic: a tier crossing yes, a
       division change no (§2 rule 3 — four per tier is how a moment stops being
       one), and finishing placements yes, because it is the first badge the
       player has ever had. */
    const change = ladderChange(
      { rating: snap.rating.rating, ratedMatches: PLACEMENT_MATCHES - snap.placementsLeft },
      {
        rating: Math.round(after.rating),
        ratedMatches: PLACEMENT_MATCHES - Math.max(0, snap.placementsLeft - 1),
      },
    );
    deltas.push({
      side,
      before: snap.rating.rating,
      after: Math.round(after.rating),
      ladder:
        change.kind === "tier"
          ? { kind: "tier", up: change.up, to: change.to.tier, label: change.to.label }
          : null,
    });
  }

  return deltas;
}
