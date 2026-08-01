import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { Hub } from "./Hub";

/* ============================================================================
   Signed in, this is the Hub (§7). Signed out, it is the pitch.

   WHAT WAS REMOVED, and why it mattered. This screen used to open with
   `CURRENT_PHASE.label` and `CURRENT_PHASE.summary` — "Phase 2E — Deployment"
   followed by a sentence about what had been built that session — and then
   listed four links, three of which went to /dev/judge, /dev/hud and
   /dev/kitchen-sink.

   That is a build log and a developer's toolbox, addressed to the person
   writing the code, printed above the product name. It was the first thing
   every visitor read, and it told them accurately that they were looking at
   something unfinished.
   ========================================================================= */

export default async function Home() {
  const user = await currentUser();
  if (user) return <Hub user={user} />;

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-10 px-6 py-16">
      <div>
        <h1 className="font-display text-fg text-48 leading-none font-extrabold tracking-[var(--track-display)] uppercase">
          1v1<span className="text-player">.</span>code
        </h1>
        <p className="text-fg-dim mt-4 max-w-lg text-16 leading-relaxed">
          Two people, one problem, one clock. Solve it faster than your opponent while
          spectators watch both editors live.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          href="/register"
          className="clip-p1 focus-ring font-display text-ink bg-p1 px-7 py-4 text-16 font-extrabold tracking-[var(--track-display)] uppercase transition-transform duration-[160ms] hover:scale-[1.02] active:scale-[0.97]"
        >
          Create an account
        </Link>
        <Link
          href="/login"
          className="focus-ring border-line hover:border-line-hot font-display text-fg border bg-surface px-7 py-4 text-16 font-bold tracking-[var(--track-display)] uppercase transition-colors duration-[160ms]"
        >
          Sign in
        </Link>
      </div>

      <p className="text-fg-faint text-13">
        Got a challenge link? Open it — you can play without an account.
      </p>
    </main>
  );
}
