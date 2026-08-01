import Link from "next/link";
import { Handle, RankBadge, type Division, type Tier } from "@1v1/ui";
import { standingOf } from "@1v1/core/ladder";
import { prisma } from "@1v1/db";
import { HubPlay } from "./HubPlay";

/* ============================================================================
   The Hub (§7) — one screen that answers "what do I do right now".

   What was here before was a Play button and a socket event log, which answers
   the question only if the answer is "read some JSON". §7 asks for the giant
   PLAY as the primary action with the mode selector attached, rank and progress
   beside it, recent matches, and a way to challenge someone.

   THE LAYOUT IS AN ARGUMENT ABOUT PRIORITY. PLAY is the largest element on the
   screen by a wide margin and sits top-left where reading starts; rank sits
   beside it because "where am I" is the second question, never the first;
   history is below the fold's centre of gravity because it is context, not an
   action. Anything that is not one of those three is smaller than all of them.

   MOTION (§2 rule 3): nothing on this screen animates on load. The Hub is not
   one of the five moments — it is the place you pass through on the way to one,
   and a screen that performs on every visit is tiring by the third.
   ========================================================================= */

const TIER_LABEL: Record<string, string> = {
  iron: "Iron",
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
  diamond: "Diamond",
  master: "Master",
  grandmaster: "Grandmaster",
  legend: "Legend",
};

export async function Hub({ user }: { user: { id: string; handle: string; rating: number } }) {
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { rating: true, placementsLeft: true },
  });
  const rating = row?.rating ?? user.rating;
  const placementsLeft = row?.placementsLeft ?? 5;
  const standing = standingOf(rating, 5 - placementsLeft);

  /* §4: tier colour on handles everywhere OUTSIDE a match. The Hub is the
     screen where "a glowing handle just walked in" is supposed to land. */
  const myTier = standing.kind === "ranked" ? (standing.tier as Tier) : null;

  const matches = await prisma.match.findMany({
    where: {
      state: { in: ["FINISHED", "ABANDONED"] },
      OR: [{ p1Id: user.id }, { p2Id: user.id }],
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      createdAt: true,
      outcomeKind: true,
      winnerId: true,
      spectatorCode: true,
      p1: { select: { id: true, handle: true, rating: true, placementsLeft: true } },
      p2: { select: { id: true, handle: true, rating: true, placementsLeft: true } },
      problem: { select: { title: true, rating: true } },
    },
  });

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="font-display text-fg text-26 font-extrabold tracking-[var(--track-display)] uppercase">
          {greeting()},{" "}
          <Handle handle={user.handle} tier={myTier} />
        </h1>
        <p className="text-fg-faint text-12">
          {standing.kind === "ranked" ? `${rating} rating` : "unranked"}
        </p>
      </header>

      {/* --- The two things that matter, side by side --------------------- */}
      <section className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <HubPlay />

        <div className="border-line clip-corner flex flex-col items-center justify-center gap-3 border bg-surface px-6 py-7">
          {standing.kind === "ranked" ? (
            <>
              <RankBadge
                tier={standing.tier as Tier}
                division={(standing.division ?? undefined) as Division | undefined}
                progress={standing.progress}
                size="lg"
              />
              <div className="text-center">
                <p className="font-display text-fg text-20 font-extrabold tracking-[var(--track-display)] uppercase">
                  {standing.label}
                </p>
                {standing.nextTier ? (
                  <p className="text-fg-dim mt-1 text-13">
                    <span className="tabular text-fg">{standing.toNextTier}</span> to{" "}
                    {TIER_LABEL[standing.nextTier]}
                  </p>
                ) : (
                  <p className="text-fg-dim mt-1 text-13">The top of the ladder.</p>
                )}
              </div>
            </>
          ) : (
            /* No badge during placements (§8). The first badge somebody sees is
               the one they remember, so it is not shown until it means
               something. */
            <>
              <div className="border-line flex h-[104px] w-[104px] items-center justify-center rounded-[8px] border border-dashed">
                <span className="font-display text-fg-faint text-26 font-extrabold tabular">
                  {standing.played}/5
                </span>
              </div>
              <div className="text-center">
                <p className="font-display text-fg text-16 font-extrabold tracking-[var(--track-hud)] uppercase">
                  Placements
                </p>
                <p className="text-fg-dim mt-1 text-13">
                  {standing.label}. Your rank appears when they are done.
                </p>
              </div>
            </>
          )}
        </div>
      </section>

      {/* --- Challenge a friend (§7) ---------------------------------------
          Deliberately quieter than PLAY and deliberately present. It is the
          launch feature — a link brings its own opponent where matchmaking
          needs a population — but it is the second thing you do, not the
          first. The link itself is minted on /play, which owns the socket that
          registers you as the host; duplicating that flow here would be a
          second path to the same state, and §10's repeated lesson is that a
          second path is where behaviour diverges quietly. */}
      <section className="border-line clip-corner flex flex-col items-start gap-3 border bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-fg text-14 font-bold tracking-[var(--track-hud)] uppercase">
            Play someone you know
          </h2>
          <p className="text-fg-dim mt-1 text-13">
            Send a link. They do not need an account, and it works for 24 hours.
          </p>
        </div>
        <Link
          href="/play?challenge=new"
          className="focus-ring border-line hover:border-line-hot font-display text-fg shrink-0 border px-5 py-2.5 text-12 font-bold tracking-[var(--track-hud)] uppercase transition-colors duration-[160ms]"
        >
          Create a link
        </Link>
      </section>

      {/* --- Recent matches ------------------------------------------------ */}
      <section>
        <h2 className="font-display text-fg-faint mb-2.5 text-12 font-bold tracking-[var(--track-hud)] uppercase">
          Recent matches
        </h2>
        {matches.length === 0 ? (
          <div className="border-line clip-corner border border-dashed bg-surface/40 px-5 py-7 text-center">
            <p className="text-fg-dim text-13">
              No matches yet. Press PLAY, or send someone a challenge link.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {matches.map((match) => {
              const opponent = match.p1.id === user.id ? match.p2 : match.p1;
              const result = resultOf(match.outcomeKind, match.winnerId, user.id);
              return (
                <li key={match.id}>
                  <Link
                    href={`/watch/${match.spectatorCode}`}
                    className="focus-ring border-line hover:border-line-hot flex items-center gap-4 border bg-surface px-4 py-3 transition-colors duration-[160ms]"
                  >
                    <span
                      className={`font-display w-[52px] shrink-0 text-12 font-extrabold tracking-[var(--track-hud)] uppercase ${result.tone}`}
                    >
                      {result.label}
                    </span>
                    <span className="text-fg min-w-0 flex-1 truncate text-14">
                      vs{" "}
                      <Handle
                        handle={opponent.handle}
                        tier={tierOfOpponent(opponent)}
                      />
                    </span>
                    <span className="text-fg-faint hidden min-w-0 flex-1 truncate text-12 sm:block">
                      {match.problem.title}
                    </span>
                    <span className="text-fg-faint tabular shrink-0 text-12">
                      {match.problem.rating}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

/** A finished-placements opponent shows their tier; anyone else renders plain. */
function tierOfOpponent(o: { rating: number; placementsLeft: number }): Tier | null {
  const standing = standingOf(o.rating, 5 - o.placementsLeft);
  return standing.kind === "ranked" ? (standing.tier as Tier) : null;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Still up";
  if (hour < 12) return "Morning";
  if (hour < 18) return "Afternoon";
  return "Evening";
}

/** §6.9: VOID and CANCELED are different things and must not read the same. */
function resultOf(
  outcome: string | null,
  winnerId: string | null,
  me: string,
): { label: string; tone: string } {
  if (outcome === "VOID") return { label: "Void", tone: "text-info" };
  if (outcome === "CANCELED") return { label: "—", tone: "text-fg-faint" };
  if (winnerId === null) return { label: "Draw", tone: "text-fg-dim" };
  return winnerId === me
    ? { label: "Win", tone: "text-p1" }
    : { label: "Loss", tone: "text-fail" };
}
