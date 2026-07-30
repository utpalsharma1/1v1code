import { randomBytes } from "node:crypto";
import { prisma } from "@1v1/db";
import { createSession } from "./auth";

/* ============================================================================
   Guests — credential-less, NOT session-less (§7).

   A guest gets an ordinary `User` row and an ordinary session cookie, so
   `createSession`, the socket ticket, queue intent, `match.resync` and the 45s
   grace all work with no new code. What a guest lacks is a password, not a
   session.

   The alternative — a guest-specific reconnect token — would be a second auth
   mechanism for one identity class, and the repeated lesson of this codebase is
   that a second path is where behaviour diverges quietly. So there is one auth
   mechanism and guests use it.

   Consequences that follow for free rather than needing code:
   · closing the tab and reopening resumes the match, like any player
   · `isRated` already returns false when either side is a guest, so Glicko,
     the RD gate and rating events skip them without a special case
   · CPU budget and rate limits key on user id, and a guest has a real id
   · the event log records them like anyone else

   Clearing cookies genuinely loses the identity. That is the honest consequence
   of having no credentials, and the claim prompt says so rather than implying a
   durability we cannot provide.
   ========================================================================= */

/** `guest-7f2a` — obviously a guest, stable for the match, not demeaning.
 *  Nobody is called "Anonymous" or "Player 2". The suffix keeps two guests
 *  distinguishable in one spectator's history. */
function guestHandle(): string {
  return `guest-${randomBytes(2).toString("hex")}`;
}

export interface GuestUser {
  id: string;
  handle: string;
}

/**
 * Create a guest and sign them in.
 *
 * The email is synthetic and in `.invalid` (RFC 2606) so it can never collide
 * with a real address and can never receive mail — a guest has no contactable
 * identity by construction, not by policy.
 */
export async function createGuest(): Promise<GuestUser> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const handle = guestHandle();
    try {
      const user = await prisma.user.create({
        data: {
          handle,
          email: `${handle}.${randomBytes(4).toString("hex")}@guest.invalid`,
          // No usable password. A guest is reachable only through their session.
          passwordHash: `guest$${randomBytes(32).toString("base64")}`,
          isGuest: true,
        },
        select: { id: true, handle: true },
      });
      await createSession(user.id);
      return user;
    } catch {
      // Handle collision on a 4-hex suffix. Retry rather than fail a redemption.
    }
  }
  throw new Error("could not allocate a guest handle");
}

/**
 * Claim a guest row: the SAME row becomes a registered account.
 *
 * Nothing is copied, so match history, submissions and rating events follow by
 * identity rather than migration — which is the entire reason to claim the row
 * instead of creating a second one.
 *
 * Authorised by holding the guest's session. Without it there is no way to
 * prove the claimant is that guest, and allowing a claim by handle alone would
 * let anyone adopt any guest's history.
 */
export async function claimGuest(
  guestId: string,
  input: { handle: string; email: string; passwordHash: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const existing = await prisma.user.findUnique({
    where: { id: guestId },
    select: { isGuest: true },
  });
  if (!existing) return { ok: false, error: "that guest no longer exists" };
  if (!existing.isGuest) return { ok: false, error: "this account is already registered" };

  try {
    await prisma.user.update({
      where: { id: guestId },
      data: {
        handle: input.handle,
        email: input.email.toLowerCase(),
        passwordHash: input.passwordHash,
        isGuest: false,
      },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "that handle or email is already taken" };
  }
}

/* ── The sweeper ────────────────────────────────────────────────────────────
   Guest rows accumulate one per opened challenge link, so they need a sweeper
   rather than a hope.

   · never played, unclaimed  -> garbage after 24h
   · played, unclaimed        -> kept 7 days, because that history is exactly
                                 what the claim flow offers them
   · claimed                  -> no longer a guest, never swept

   It deletes only guests with NO `Match` rows, which retains the played cohort
   by that rule rather than by a second check that could drift out of step. */

export const GUEST_UNPLAYED_TTL_MS = 24 * 60 * 60 * 1000;
export const GUEST_PLAYED_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function sweepGuests(now = Date.now()): Promise<{ deleted: number }> {
  const unplayedBefore = new Date(now - GUEST_UNPLAYED_TTL_MS);
  const playedBefore = new Date(now - GUEST_PLAYED_TTL_MS);

  // Unplayed: no match rows on either side, older than 24h.
  const unplayed = await prisma.user.deleteMany({
    where: {
      isGuest: true,
      createdAt: { lt: unplayedBefore },
      matchesAsP1: { none: {} },
      matchesAsP2: { none: {} },
    },
  });

  // Played: older than 7 days. Their matches go with them, which is why the
  // window is long — the history is the offer.
  const played = await prisma.user.deleteMany({
    where: { isGuest: true, createdAt: { lt: playedBefore } },
  });

  return { deleted: unplayed.count + played.count };
}
