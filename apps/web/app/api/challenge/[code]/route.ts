import { normaliseCode } from "@1v1/core/codes";
import { prisma } from "@1v1/db";
import { currentUser } from "@/lib/auth";
import { createGuest } from "@/lib/guest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ============================================================================
   Challenge redemption (§7).

   GET  — what does this link show? Used by the page before anyone commits.
   POST — take it. The FIRST person to open it joins.

   §7's dead-end rule: a stale link does NOT 404. It shows who challenged whom,
   that it expired, and offers a one-click "send one back" aimed at the original
   host. A dead end here is a lost player, and this is the most likely way the
   feature gets used slightly wrong — a link opened tomorrow rather than tonight.
   ========================================================================= */

interface Params {
  params: Promise<{ code: string }>;
}

async function load(raw: string) {
  const code = normaliseCode(raw);
  if (!code) return null;
  return prisma.challenge.findUnique({
    where: { code },
    select: {
      id: true,
      code: true,
      mode: true,
      ratingMin: true,
      ratingMax: true,
      allowGuest: true,
      expiresAt: true,
      consumedAt: true,
      consumedById: true,
      hostId: true,
      host: { select: { handle: true, rating: true } },
      match: { select: { id: true } },
    },
  });
}

export async function GET(_request: Request, { params }: Params): Promise<Response> {
  const { code } = await params;
  const challenge = await load(code);
  if (!challenge) {
    // Unknown and malformed give the same answer — an oracle here would let
    // someone enumerate live challenges.
    return Response.json({ state: "unknown" }, { status: 404 });
  }

  const me = await currentUser();
  const expired = challenge.expiresAt.getTime() < Date.now();
  const taken = challenge.consumedAt !== null;

  return Response.json({
    state: expired && !taken ? "expired" : taken ? "taken" : "open",
    code: challenge.code,
    host: challenge.host.handle,
    hostRating: challenge.host.rating,
    mode: challenge.mode,
    band: [challenge.ratingMin, challenge.ratingMax],
    allowGuest: challenge.allowGuest,
    expiresAt: challenge.expiresAt.toISOString(),
    /** So the page can say "this is your own link" rather than inviting you to
     *  play yourself, which would deadlock the accept window. */
    youAreHost: me?.id === challenge.hostId,
    signedIn: Boolean(me),
    matchId: challenge.match?.id ?? null,
  });
}

export async function POST(_request: Request, { params }: Params): Promise<Response> {
  const { code } = await params;
  const challenge = await load(code);
  if (!challenge) return Response.json({ error: "unknown code" }, { status: 404 });

  if (challenge.expiresAt.getTime() < Date.now() && !challenge.consumedAt) {
    return Response.json({ error: "expired", host: challenge.host.handle }, { status: 410 });
  }

  let me = await currentUser();

  // The host cannot take their own link: both sides would be one identity and
  // the accept window could never complete.
  if (me && me.id === challenge.hostId) {
    return Response.json({ error: "this is your own challenge link" }, { status: 409 });
  }

  /* §7: GUESTS MAY PLAY WITHOUT REGISTERING. If registration were required
     before a first match, most invited people would never play, and that single
     decision probably costs more than every other growth feature combined. */
  if (!me) {
    if (!challenge.allowGuest) {
      return Response.json({ error: "this challenge requires an account" }, { status: 403 });
    }
    const guest = await createGuest();
    me = { id: guest.id, handle: guest.handle } as never;
  }

  /* Atomic take: `updateMany` with `consumedAt: null` in the WHERE means two
     people opening the link simultaneously cannot both win. The loser sees the
     "already taken" state rather than joining a match that has two opponents. */
  const taken = await prisma.challenge.updateMany({
    where: { id: challenge.id, consumedAt: null },
    data: { consumedAt: new Date(), consumedById: me!.id },
  });

  if (taken.count === 0) {
    return Response.json({ error: "someone else already took this challenge" }, { status: 409 });
  }

  return Response.json({
    ok: true,
    code: challenge.code,
    host: challenge.host.handle,
    /** The client now connects its socket and emits `challenge.join`. Match
     *  creation lives in the gateway, because that is where match creation has
     *  always lived — a second creation path in a second process is how two
     *  behaviours start. */
    guest: me!.handle.startsWith("guest-"),
  });
}
