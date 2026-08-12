import Link from "next/link";
import { notFound } from "next/navigation";
import { Handle, RankBadge, type Division, type Tier } from "@1v1/ui";
import { PLACEMENT_MATCHES, standingOf } from "@1v1/core/ladder";
import { prisma } from "@1v1/db";
import { currentUser } from "@/lib/auth";
import { TopicBreakdown, MIN_PER_TOPIC, MIN_TOPICS } from "./TopicBreakdown";

/* ============================================================================
   A player's profile (§7, Phase 3B).

   PROFILES ARE PUBLIC, and that is a decision rather than a default. This is
   the natural thing to link to — "here's me" — and §7 already establishes that
   watching needs no account, because a link reaching a stranger is the best
   growth path this product has. A profile a friend cannot open is a feature
   built halfway.

   SO IT IS A NEW CHANNEL, AND §10'S ALLOWLIST RULE APPLIES. Every leak found in
   this project so far was a field nobody thought to check — the compiler output
   quoting source lines, `failedAt` disclosing test data, `submissionId`
   embedding a receipt stamp. So the public view is CONSTRUCTED here rather than
   filtered: a fresh object is built from named fields, and adding a column to
   `User` cannot leak it.

   What an anonymous visitor sees is what the owner sees. There is currently no
   owner-only section, and that is deliberate — a profile whose content changes
   depending on who is looking is two screens to keep correct, and nothing on it
   is private. What is NOT on it, on purpose:

     email               obviously
     ratingDev, volatility   Glicko internals. §8 hides rating behind a tier;
                         publishing the uncertainty invites reading the number
                         everyone was told not to read.
     placementsLeft      exposed only as "N placements left", never as a
                         countdown someone could farm against.
     LIVE MATCHES        the important one. A profile listing an in-progress
                         match with its spectator code would hand anyone a
                         route into a live game — bypassing §7's mandatory
                         45-second ranked delay and §10's rule that a player
                         may not spectate their own live match. Only finished
                         matches appear, and that is enforced in the query
                         rather than in the render.
   ========================================================================= */

export const dynamic = "force-dynamic";

export default async function Profile({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const me = await currentUser();

  const user = await prisma.user.findFirst({
    where: { handle: { equals: decodeURIComponent(handle), mode: "insensitive" } },
    select: {
      id: true,
      handle: true,
      rating: true,
      placementsLeft: true,
      isGuest: true,
      createdAt: true,
    },
  });
  if (!user) notFound();

  /* A guest has no rating, cannot appear on a ladder, and their row is swept
     after 7 days (§7). A profile page for one would be a link that dies. */
  if (user.isGuest) notFound();

  const standing = standingOf(user.rating, PLACEMENT_MATCHES - user.placementsLeft);

  /* FINISHED ONLY. See the allowlist note above — this is the line that keeps a
     live match off a public page. */
  const matches = await prisma.match.findMany({
    where: {
      state: { in: ["FINISHED", "ABANDONED"] },
      OR: [{ p1Id: user.id }, { p2Id: user.id }],
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      createdAt: true,
      outcomeKind: true,
      winnerId: true,
      spectatorCode: true,
      p1: { select: { id: true, handle: true, rating: true, placementsLeft: true } },
      p2: { select: { id: true, handle: true, rating: true, placementsLeft: true } },
      problem: { select: { title: true, rating: true, topic: true } },
    },
  });

  const decided = matches.filter((m) => m.outcomeKind === "WIN");
  const wins = decided.filter((m) => m.winnerId === user.id).length;
  const losses = decided.length - wins;
  const isMe = me?.id === user.id;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-7 px-6 py-10">
      <header className="flex flex-wrap items-center gap-5">
        {standing.kind === "ranked" ? (
          <RankBadge
            tier={standing.tier as Tier}
            division={(standing.division ?? undefined) as Division | undefined}
            progress={standing.progress}
            size="lg"
          />
        ) : (
          <div className="border-line flex h-[104px] w-[104px] shrink-0 items-center justify-center rounded-[8px] border border-dashed">
            <span className="font-display text-fg-faint text-20 font-extrabold tabular">
              {standing.played}/{PLACEMENT_MATCHES}
            </span>
          </div>
        )}

        <div className="min-w-0">
          <h1 className="font-display text-26 font-extrabold tracking-[var(--track-display)]">
            <Handle
              handle={user.handle}
              tier={standing.kind === "ranked" ? (standing.tier as Tier) : null}
            />
          </h1>
          <p className="text-fg-dim mt-1 text-14">
            {standing.kind === "ranked" ? (
              <>
                <span className="text-fg font-semibold">{standing.label}</span>
                <span className="text-fg-faint"> · </span>
                <span className="tabular">{user.rating}</span>
                {standing.nextTier && (
                  <span className="text-fg-faint">
                    {" "}
                    · <span className="tabular">{standing.toNextTier}</span> to next tier
                  </span>
                )}
              </>
            ) : (
              <>Unranked · {standing.label}</>
            )}
          </p>
          <p className="text-fg-faint mt-1 text-12">
            <span className="tabular">{wins}</span>W{" "}
            <span className="tabular">{losses}</span>L
            {decided.length > 0 && (
              <> · {Math.round((wins / decided.length) * 100)}% over {decided.length}</>
            )}
            {" · since "}
            {user.createdAt.toLocaleDateString("en-GB", { month: "short", year: "numeric" })}
          </p>
        </div>

        {isMe && (
          <span className="font-display text-fg-faint ml-auto text-11 font-bold tracking-[var(--track-hud)] uppercase">
            this is you
          </span>
        )}
      </header>

      <TopicBreakdown
        matches={matches.map((m) => ({
          topic: m.problem.topic,
          won: m.outcomeKind === "WIN" && m.winnerId === user.id,
          decided: m.outcomeKind === "WIN",
        }))}
      />

      <section>
        <h2 className="font-display text-fg-faint mb-2.5 text-12 font-bold tracking-[var(--track-hud)] uppercase">
          Match history
        </h2>
        {matches.length === 0 ? (
          <div className="border-line clip-corner border border-dashed bg-surface/40 px-5 py-7 text-center">
            <p className="text-fg-dim text-13">
              No finished matches yet.
              {isMe && (
                <>
                  {" "}
                  <Link href="/" className="text-p1 focus-ring underline underline-offset-2">
                    Play one
                  </Link>
                  .
                </>
              )}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {matches.slice(0, 20).map((match) => {
              const opponent = match.p1.id === user.id ? match.p2 : match.p1;
              const oppStanding = standingOf(
                opponent.rating,
                PLACEMENT_MATCHES - opponent.placementsLeft,
              );
              const result = resultOf(match.outcomeKind, match.winnerId, user.id);
              return (
                <li key={match.id}>
                  <Link
                    href={`/watch/${match.spectatorCode}`}
                    className="focus-ring border-line hover:border-line-hot flex items-center gap-4 border bg-surface px-4 py-3 transition-colors duration-[160ms]"
                  >
                    <span
                      className={`font-display w-[46px] shrink-0 text-12 font-extrabold tracking-[var(--track-hud)] uppercase ${result.tone}`}
                    >
                      {result.label}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-14">
                      vs{" "}
                      <Handle
                        handle={opponent.handle}
                        tier={oppStanding.kind === "ranked" ? (oppStanding.tier as Tier) : null}
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
        {matches.length > 20 && (
          <p className="text-fg-faint mt-2 text-12">
            Showing the last 20 of {matches.length}.
          </p>
        )}
      </section>

      <p className="text-fg-faint text-12">
        A topic appears above once it has {MIN_PER_TOPIC} decided matches; the radar appears once{" "}
        {MIN_TOPICS} topics do.
      </p>
    </main>
  );
}

/** §6.9: VOID and CANCELED are different things and must not read the same. */
function resultOf(
  outcome: string | null,
  winnerId: string | null,
  who: string,
): { label: string; tone: string } {
  if (outcome === "VOID") return { label: "Void", tone: "text-info" };
  if (outcome === "CANCELED") return { label: "—", tone: "text-fg-faint" };
  if (winnerId === null) return { label: "Draw", tone: "text-fg-dim" };
  return winnerId === who
    ? { label: "Win", tone: "text-p1" }
    : { label: "Loss", tone: "text-fail" };
}
