import Link from "next/link";
import { Handle, RankBadge, type Division, type Tier } from "@1v1/ui";
import { PLACEMENT_MATCHES, standingOf } from "@1v1/core/ladder";
import { prisma } from "@1v1/db";
import { currentUser } from "@/lib/auth";

/* ============================================================================
   The ladder (§7, Phase 3B).

   This is the screen the tier bands were recalibrated for. It is also the one
   place §4's league colour does most of its work: a page of handles in tier
   colour is how rank stops being a badge you click and becomes something you
   read at a glance, and it is where the aura rule earns its restraint — if
   every handle glowed, none of them would mean anything.

   WHO IS ON IT. Only accounts that have finished placements. Someone two
   matches in has a rating but not a rank, and putting them on a ladder would
   publish a number §8 deliberately hides until it means something. Guests never
   appear: they cannot earn rating at all (§7), so a guest on a ladder would be
   a row that can never move.

   NO PAGINATION YET, and that is a scale decision rather than an omission: at
   the populations this has, the top 100 IS the ladder. Pagination arrives when
   there is a hundredth player.
   ========================================================================= */

export const dynamic = "force-dynamic";

export default async function Leaderboard() {
  const me = await currentUser();

  const players = await prisma.user.findMany({
    where: { isGuest: false, placementsLeft: 0 },
    orderBy: [{ rating: "desc" }, { handle: "asc" }],
    take: 100,
    select: { id: true, handle: true, rating: true, placementsLeft: true },
  });

  /* Rank among the ranked, so the number beside a handle is its position on
     this ladder rather than its row index in a filtered query. */
  const myRow = me ? players.findIndex((p) => p.id === me.id) : -1;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
      <header>
        <h1 className="font-display text-fg text-26 font-extrabold tracking-[var(--track-display)] uppercase">
          Ladder
        </h1>
        <p className="text-fg-dim mt-1 text-13">
          Everyone who has finished their {PLACEMENT_MATCHES} placement matches, by rating.
        </p>
      </header>

      {players.length === 0 ? (
        /* The honest empty state. Nobody has finished placements yet — which on
           a new deployment is simply true, and says so without pretending the
           feature is broken. */
        <div className="border-line clip-corner border border-dashed bg-surface/40 px-5 py-8 text-center">
          <p className="text-fg text-14">Nobody has finished placements yet.</p>
          <p className="text-fg-dim mt-1.5 text-13">
            Five matches earns a rank.{" "}
            <Link href="/" className="text-p1 focus-ring underline underline-offset-2">
              Play one
            </Link>
            .
          </p>
        </div>
      ) : (
        <ol className="flex flex-col gap-1">
          {players.map((player, index) => {
            const standing = standingOf(player.rating, PLACEMENT_MATCHES - player.placementsLeft);
            if (standing.kind !== "ranked") return null;
            const isMe = player.id === me?.id;
            return (
              <li key={player.id}>
                <div
                  className={`clip-corner flex items-center gap-4 border px-4 py-2.5 transition-colors duration-[160ms] ${
                    isMe ? "border-[var(--p1)] bg-elevated" : "border-line bg-surface"
                  }`}
                >
                  {/* Position. Tabular so the column does not jitter, and dim
                      because it is an index, not an achievement. */}
                  <span className="font-display text-fg-faint tabular w-8 shrink-0 text-right text-13 font-bold">
                    {index + 1}
                  </span>

                  <RankBadge
                    tier={standing.tier as Tier}
                    division={(standing.division ?? undefined) as Division | undefined}
                    size="sm"
                  />

                  <span className="min-w-0 flex-1 truncate text-14">
                    <Handle handle={player.handle} tier={standing.tier as Tier} />
                    {isMe && (
                      <span className="font-display text-fg-faint ml-2 text-11 font-bold tracking-[var(--track-hud)] uppercase">
                        you
                      </span>
                    )}
                  </span>

                  <span className="font-display text-fg-dim hidden shrink-0 text-12 font-bold tracking-[var(--track-hud)] uppercase sm:block">
                    {standing.label}
                  </span>

                  <span className="text-fg tabular w-12 shrink-0 text-right text-13">
                    {player.rating}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {me && myRow === -1 && (
        <p className="text-fg-faint text-13">
          You are not on the ladder yet — finish your placement matches to appear here.
        </p>
      )}
    </main>
  );
}
