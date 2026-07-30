import Link from "next/link";
import { currentUser } from "@/lib/auth";

/* ============================================================================
   A minimal persistent nav.

   The Hub is Phase 3. This is not it — it is the smallest thing that makes the
   product a site rather than a set of URLs somebody memorised. Until now the
   only way to reach spectating was to know the path, which is a strange thing
   to ship alongside a feature whose entire premise is that strangers arrive
   from a shared link and look around.

   Deliberately three items and no more. §7 says the Hub's left rail is capped
   at six; this is the pre-Hub version and adding to it is how it quietly
   becomes the Hub without being designed as one.
   ========================================================================= */

export async function Nav() {
  const user = await currentUser();

  return (
    <header className="border-line sticky top-0 z-40 border-b bg-ink/90 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
        <Link href="/" className="focus-ring font-display text-fg text-16 font-extrabold tracking-[var(--track-display)] uppercase">
          1v1<span className="text-player">.</span>code
        </Link>

        <div className="flex items-center gap-1">
          <NavLink href="/play">Play</NavLink>
          <NavLink href="/watch">Spectate</NavLink>
          {user ? (
            <form action="/api/auth/logout" method="post">
              <button
                type="submit"
                className="focus-ring font-display text-fg-faint hover:text-fg px-3 py-1.5 text-12 font-bold tracking-[var(--track-hud)] uppercase transition-colors duration-[160ms]"
              >
                Sign out
              </button>
            </form>
          ) : (
            <NavLink href="/login">Sign in</NavLink>
          )}
        </div>
      </nav>
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="focus-ring font-display text-fg-faint hover:text-fg px-3 py-1.5 text-12 font-bold tracking-[var(--track-hud)] uppercase transition-colors duration-[160ms]"
    >
      {children}
    </Link>
  );
}
