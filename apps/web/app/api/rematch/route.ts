import { generateCode } from "@1v1/core";
import { prisma } from "@1v1/db";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ============================================================================
   One-click rematch (§7).

   A loser wanting an immediate rematch is the strongest retention moment in the
   product, and it previously required minting and re-sharing a link.

   FIND-OR-CREATE, keyed on the finished match. Whoever presses first creates the
   challenge; whoever presses second finds the same one. Both sides get "one
   click" without a new socket protocol and without two rival challenges.

   A NEW Challenge row, never the old one. `consumedAt`/`consumedById` on the
   original are the record of who took THAT invitation; reusing the row would
   destroy the audit trail and make the second match indistinguishable from the
   first.

   IF THE OTHER SIDE HAS LEFT this degrades into the ordinary link flow rather
   than a special case: the presser lands on the challenge waiting screen holding
   a real code, which is exactly what minting a link does. Nothing new to
   maintain, and if their opponent returns it simply works.
   ========================================================================= */

export async function POST(request: Request): Promise<Response> {
  const user = await currentUser();
  if (!user) return Response.json({ error: "not signed in" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const matchId = (body as { matchId?: unknown }).matchId;
  if (typeof matchId !== "string") {
    return Response.json({ error: "matchId is required" }, { status: 400 });
  }

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: { p1Id: true, p2Id: true, problem: { select: { rating: true } } },
  });
  if (!match) return Response.json({ error: "unknown match" }, { status: 404 });
  if (user.id !== match.p1Id && user.id !== match.p2Id) {
    return Response.json({ error: "you did not play in that match" }, { status: 403 });
  }

  const opponentId = user.id === match.p1Id ? match.p2Id : match.p1Id;

  // Second presser: it already exists, so take it rather than making a rival.
  const existing = await prisma.challenge.findUnique({
    where: { rematchOfId: matchId },
    select: { code: true },
  });
  if (existing) return Response.json({ code: existing.code, created: false });

  /* Same difficulty as the match just played, so a rematch is a rematch rather
     than a different fight. */
  const rating = match.problem.rating;
  try {
    const challenge = await prisma.challenge.create({
      data: {
        code: generateCode(),
        hostId: user.id,
        /* Pre-consumed BY THE OPPONENT. This invitation is for one named person,
           so nobody holding the code can barge in, and the gateway's membership
           check (hostId or consumedById) already enforces that. */
        consumedAt: new Date(),
        consumedById: opponentId,
        rematchOfId: matchId,
        mode: "CASUAL",
        visibility: "UNLISTED",
        ratingMin: Math.max(800, rating - 50),
        ratingMax: Math.min(2000, rating + 50),
        allowGuest: true,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
      select: { code: true },
    });
    return Response.json({ code: challenge.code, created: true });
  } catch {
    // Both pressed at the same instant; the unique index decided. Take theirs.
    const raced = await prisma.challenge.findUnique({
      where: { rematchOfId: matchId },
      select: { code: true },
    });
    if (raced) return Response.json({ code: raced.code, created: false });
    return Response.json({ error: "could not create a rematch" }, { status: 500 });
  }
}
