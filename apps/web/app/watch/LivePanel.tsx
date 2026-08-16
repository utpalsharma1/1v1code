import Link from "next/link";
import { Handle, type Tier } from "@1v1/ui";
import { PLACEMENT_MATCHES, standingOf } from "@1v1/core/ladder";
import { prisma } from "@1v1/db";

/* ============================================================================
   The live match panel (§7) — "the site should look inhabited even when it
   isn't".

   TWO ORDERINGS, AND THE EMPTY STATE IS THE COMMON CASE.

   §7 asks for matches sorted by TENSION rather than recency, and names what
   tension is: both players deep into their test cases, close ratings, high
   rank. With single-digit traffic that ranking is academic — but it is written
   now, deliberately, because "newest first" is what a panel defaults to and
   nobody ever revisits it. The scoring is below and it is explicit about which
   part is a guess.

   WHAT IT SHOWS WHEN THERE ARE NONE, which is most of the time. Not an empty
   frame and not "no live matches" alone: recently FINISHED matches, with
   replays. Those exist, they are watchable, and they are the honest version of
   "look, people play here" — a panel that is blank most of the time reads as
   broken, and one that pretends otherwise is worse.

   VISIBILITY. Only `PUBLIC` matches are listed. `UNLISTED` is reachable by code
   and must never appear here — §7 is explicit that unlisted is not private, but
   listing it would make the distinction meaningless.
   ========================================================================= */

interface Row {
  id: string;
  spectatorCode: string;
  p1: { handle: string; rating: number; placementsLeft: number };
  p2: { handle: string; rating: number; placementsLeft: number };
  problem: { title: string; rating: number };
}

/**
 * §7's tension score. Higher is more worth watching.
 *
 * Three terms, and the honest note is that only the first is measured — the
 * others are proxies:
 *
 *  - CLOSENESS of rating, which is the strongest single signal that the match
 *    is undecided and the one we can actually compute before it ends.
 *  - RANK, because a match between two strong players matters more to a
 *    stranger than the same margin lower down.
 *  - PROBLEM RATING as a weak stand-in for "deep into test cases", which is
 *    what §7 actually asks for. Live progress lives in the gateway's memory,
 *    not the database, so this component cannot see it. When the panel has a
 *    socket of its own, replace this term rather than adding to it.
 */
export function tension(row: Row): number {
  const gap = Math.abs(row.p1.rating - row.p2.rating);
  const closeness = Math.max(0, 1 - gap / 400);
  const strength = (row.p1.rating + row.p2.rating) / 2 / 2000;
  const depth = row.problem.rating / 2000;
  return closeness * 3 + strength * 2 + depth;
}

export async function LivePanel() {
  const live = await prisma.match.findMany({
    where: { state: "LIVE", visibility: "PUBLIC" },
    take: 12,
    select: {
      id: true,
      spectatorCode: true,
      p1: { select: { handle: true, rating: true, placementsLeft: true } },
      p2: { select: { handle: true, rating: true, placementsLeft: true } },
      problem: { select: { title: true, rating: true } },
    },
  });

  /* Sorted in memory, because tension is not expressible as a SQL ordering and
     twelve rows is nothing. If this ever needs a thousand, it needs a socket
     first — see the note on `depth`. */
  const ranked = [...live].sort((a, b) => tension(b) - tension(a));

  if (ranked.length > 0) {
    return (
      <section>
        <h2 className="font-display text-fg-faint mb-2.5 text-12 font-bold tracking-[var(--track-hud)] uppercase">
          Live now
        </h2>
        <ul className="flex flex-col gap-1.5">
          {ranked.map((match) => (
            <li key={match.id}>
              <Link
                href={`/watch/${match.spectatorCode}`}
                className="focus-ring border-line hover:border-line-hot clip-corner flex items-center gap-3 border bg-surface px-4 py-3 transition-colors duration-[160ms]"
              >
                <span className="bg-p1 h-2 w-2 shrink-0 rotate-45" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-14">
                  <PlayerName {...match.p1} /> <span className="text-fg-faint">vs</span>{" "}
                  <PlayerName {...match.p2} />
                </span>
                <span className="text-fg-faint hidden min-w-0 flex-1 truncate text-12 sm:block">
                  {match.problem.title}
                </span>
                <span className="text-fg-faint tabular shrink-0 text-12">
                  {match.problem.rating}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  /* --- Nobody is playing. Show what does exist. ------------------------- */
  const recent = await prisma.match.findMany({
    where: { state: "FINISHED", visibility: "PUBLIC" },
    orderBy: { finishedAt: "desc" },
    take: 5,
    select: {
      id: true,
      p1: { select: { handle: true, rating: true, placementsLeft: true } },
      p2: { select: { handle: true, rating: true, placementsLeft: true } },
      problem: { select: { title: true, rating: true } },
    },
  });

  return (
    <section>
      <h2 className="font-display text-fg-faint mb-2.5 text-12 font-bold tracking-[var(--track-hud)] uppercase">
        {recent.length > 0 ? "Nobody playing right now — watch a finished match" : "Live now"}
      </h2>

      {recent.length === 0 ? (
        <div className="border-line clip-corner border border-dashed bg-surface/40 px-5 py-7 text-center">
          <p className="text-fg text-14">No matches yet.</p>
          <p className="text-fg-dim mt-1.5 text-13">
            Every match is watchable live, and replayable after.{" "}
            <Link href="/" className="text-p1 focus-ring underline underline-offset-2">
              Play the first one
            </Link>
            .
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {recent.map((match) => (
            <li key={match.id}>
              <Link
                href={`/replay/${match.id}`}
                className="focus-ring border-line hover:border-line-hot clip-corner flex items-center gap-3 border bg-surface/60 px-4 py-3 transition-colors duration-[160ms]"
              >
                <span className="font-display text-fg-faint w-12 shrink-0 text-11 font-bold tracking-[var(--track-hud)] uppercase">
                  replay
                </span>
                <span className="min-w-0 flex-1 truncate text-14">
                  <PlayerName {...match.p1} /> <span className="text-fg-faint">vs</span>{" "}
                  <PlayerName {...match.p2} />
                </span>
                <span className="text-fg-faint hidden min-w-0 flex-1 truncate text-12 sm:block">
                  {match.problem.title}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** §4: tier colour outside a match. This panel is a lobby, not a HUD. */
function PlayerName({
  handle,
  rating,
  placementsLeft,
}: {
  handle: string;
  rating: number;
  placementsLeft: number;
}) {
  const standing = standingOf(rating, PLACEMENT_MATCHES - placementsLeft);
  return <Handle handle={handle} tier={standing.kind === "ranked" ? (standing.tier as Tier) : null} />;
}
