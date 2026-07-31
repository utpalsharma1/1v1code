/* ============================================================================
   Probe teardown that does not print an error after passing.

   Every probe ended by deleting its throwaway accounts, and every probe that
   had actually played a match printed this immediately after `PASS`:

     prisma:error Invalid `prisma.user.deleteMany()` invocation:
     Foreign key constraint violated on the constraint: `Match_p1Id_fkey`

   The `.catch(() => undefined)` around it swallowed the rejection, so the probe
   still exited 0 — but Prisma logs through its own logger before the promise
   ever rejects, so the message printed anyway. A passing probe that prints a
   database error is precisely where a real failure hides, and this project has
   now shipped several bugs whose entire nature was output that looked like
   something else.

   The cause is not a race or a flake: `Match.p1`/`p2` are the only relations to
   `User` WITHOUT `onDelete: Cascade`, deliberately, because a match is a
   historical record that should not evaporate when an account is removed. So
   the matches have to go first, and everything hanging off them (RatingEvent,
   Replay, Submission → TestResult) cascades from there.
   ========================================================================= */

/* Through @1v1/db, which is what the probes themselves import — the gateway
   has no direct dependency on @prisma/client. */
import type { prisma as PrismaLike } from "@1v1/db";

/**
 * Removes throwaway probe accounts and everything that references them, in
 * dependency order. Returns what it deleted so a probe can say so.
 */
export async function deleteProbeUsers(
  prisma: typeof PrismaLike,
  emails: string[],
): Promise<{ users: number; matches: number }> {
  const users = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { id: true },
  });
  const ids = users.map((u: { id: string }) => u.id);
  if (ids.length === 0) return { users: 0, matches: 0 };

  /* Matches first — the one relation that does not cascade. Submissions point
     at matches with `onDelete: SetNull`, so they survive this and are removed
     with the user below. */
  const matches = await prisma.match.deleteMany({
    where: { OR: [{ p1Id: { in: ids } }, { p2Id: { in: ids } }] },
  });
  const deleted = await prisma.user.deleteMany({ where: { id: { in: ids } } });
  return { users: deleted.count, matches: matches.count };
}
