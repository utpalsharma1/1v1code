import { prisma } from "@1v1/db";

/* ============================================================================
   Handshake identity (§12 Phase 2B-2)

   Auth's UI lands in 2B-3, but the gateway needs real identity NOW. So exactly
   one piece is pulled forward: verifying the session cookie and resolving it to
   a user id.

   Deliberately not a query parameter. A `?userId=` stub is trivial to add, is
   indistinguishable from working, and becomes permanent the moment anything is
   built on top of it — at which point it is an authentication bypass that ships.

   The cookie carries an opaque 32-byte token, not a signed claim. That is
   stronger than a signature for this purpose: a signed cookie is valid until it
   expires and cannot be withdrawn, whereas deleting the row logs the session out
   everywhere, immediately.
   ========================================================================= */

const COOKIE_NAME = "1v1_session";

export interface Identity {
  userId: string;
  handle: string;
  rating: number;
  ratingDeviation: number;
  volatility: number;
  isBot: boolean;
  /** A credential-less account (§7, challenge links). Plays, never rated,
   *  cannot create challenge links. NOT the same as `isAnonymous`: an
   *  anonymous socket may only watch, a guest may play. */
  isGuest?: boolean;
  /** §7: spectating requires no account. An anonymous socket may watch and do
   *  nothing else — no queue, no accept, no submit, no editor writes. The
   *  gateway refuses those by this flag rather than by hoping the client
   *  behaves, because a registration wall in front of a shared live match
   *  converts our best growth path into a bounce. */
  isAnonymous?: boolean;
}

/** A viewer with no account. Never persisted, never rated, never in a match. */
export function anonymousIdentity(id: string): Identity {
  return {
    userId: `anon:${id}`,
    handle: "spectator",
    rating: 0,
    ratingDeviation: 0,
    volatility: 0,
    isBot: false,
    isAnonymous: true,
  };
}

/** Minimal, allocation-light cookie header parse. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/**
 * Resolve a handshake cookie header to a user, or null.
 *
 * An expired session is deleted on sight rather than merely rejected, so the
 * table does not accumulate dead rows that still look like valid tokens.
 */
const SELECT = {
  id: true,
  handle: true,
  rating: true,
  ratingDev: true,
  volatility: true,
} as const;

/** Resolve a user id straight to an Identity, for the ticket path. */
export async function identifyById(userId: string): Promise<Identity | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: SELECT });
  if (!user) return null;
  return {
    userId: user.id,
    handle: user.handle,
    rating: user.rating,
    ratingDeviation: user.ratingDev,
    volatility: user.volatility,
    isBot: user.handle.startsWith("bot_"),
  };
}

export async function identify(cookieHeader: string | undefined): Promise<Identity | null> {
  const token = readCookie(cookieHeader, COOKIE_NAME);
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { id: token },
    select: {
      expiresAt: true,
      user: {
        select: {
          id: true,
          handle: true,
          rating: true,
          ratingDev: true,
          volatility: true,
        },
      },
    },
  });

  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.deleteMany({ where: { id: token } });
    return null;
  }

  return {
    userId: session.user.id,
    handle: session.user.handle,
    rating: session.user.rating,
    ratingDeviation: session.user.ratingDev,
    volatility: session.user.volatility,
    isBot: session.user.handle.startsWith("bot_"),
  };
}
