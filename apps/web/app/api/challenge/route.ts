import { generateCode } from "@1v1/core";
import { prisma } from "@1v1/db";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ============================================================================
   Challenge link creation (§7, Phase 2D).

   THE LAUNCH FEATURE. Ranked matchmaking needs a population that does not exist
   on day one; a challenge link needs exactly two people who already know each
   other, so it brings its own audience.

   The host picks mode and a difficulty band explicitly. That is not a
   convenience — §8 requires it: with a guest on the other side there is no
   second rating for mean − 120 to work from, and a guest's stored 1200 is the
   schema default rather than evidence about anything.
   ========================================================================= */

/** §7: the link must survive the opponent not being online yet. */
const CHALLENGE_TTL_MS = 24 * 60 * 60 * 1000;

const MIN_RATING = 800;
const MAX_RATING = 2000;

export async function POST(request: Request): Promise<Response> {
  const user = await currentUser();
  if (!user) return Response.json({ error: "not signed in" }, { status: 401 });

  /* A GUEST CANNOT CREATE A CHALLENGE LINK.
     A credential-less account that can mint invite links is a spam primitive:
     open a link, become a guest, mint ten more. Refused here, and refused again
     at the gateway, in the same shape as the anonymous `playerOnly` check. */
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { isGuest: true, rating: true },
  });
  if (!row) return Response.json({ error: "not signed in" }, { status: 401 });
  if (row.isGuest) {
    return Response.json(
      { error: "guests cannot create challenge links — register to invite someone" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const { mode, ratingMin, ratingMax, allowGuest } = (body ?? {}) as Record<string, unknown>;

  /* Default the band around the HOST's own rating, because that is the only
     rating we can be sure means something. The host may override it. */
  const lo = clampRating(typeof ratingMin === "number" ? ratingMin : row.rating - 200);
  const hi = clampRating(typeof ratingMax === "number" ? ratingMax : row.rating + 100);
  if (lo > hi) {
    return Response.json({ error: "ratingMin must not exceed ratingMax" }, { status: 400 });
  }

  const problems = await prisma.problem.count({ where: { rating: { gte: lo, lte: hi } } });
  if (problems === 0) {
    // Better to refuse than to create a link that cannot produce a match.
    return Response.json(
      { error: `no problems rated ${lo}–${hi}. Widen the band.` },
      { status: 400 },
    );
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateCode();
    try {
      const challenge = await prisma.challenge.create({
        data: {
          code,
          hostId: user.id,
          mode: mode === "RANKED" ? "RANKED" : "CASUAL",
          // §7: challenge matches are UNLISTED — watchable by code, not listed.
          visibility: "UNLISTED",
          ratingMin: lo,
          ratingMax: hi,
          allowGuest: allowGuest !== false,
          expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
        },
        select: { code: true, expiresAt: true, ratingMin: true, ratingMax: true },
      });
      return Response.json({ ...challenge, problems });
    } catch {
      // Code collision. 32^10 makes this vanishingly rare; retry anyway.
    }
  }
  return Response.json({ error: "could not allocate a code" }, { status: 500 });
}

function clampRating(value: number): number {
  return Math.max(MIN_RATING, Math.min(MAX_RATING, Math.round(value)));
}
