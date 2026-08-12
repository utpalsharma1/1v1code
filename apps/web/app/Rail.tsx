"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/* ============================================================================
   The persistent left rail (§7).

   The three-item top bar was a stopgap and said so. This is the shape the
   product is supposed to have: a fixed set of places, always visible, so the
   site reads as somewhere you are rather than as a set of URLs you navigated
   to.

   SIX ITEMS, CAPPED, per §7. The cap is the design — a rail that grows becomes
   a menu, and a menu is what you build when you have not decided what the
   product is for. Profile is still shown-but-disabled rather than hidden: a
   rail that changes shape as features land teaches players to re-read it every
   time, so the slot exists from the start and only its state changes.

   MOTION BUDGET (§2 rule 3). Nothing here animates beyond the 160ms hover and
   the active marker, and the marker moves with a transform rather than a
   layout change. Navigation is not one of the five moments; it should be fast
   and get out of the way.
   ========================================================================= */

interface Item {
  href: string;
  label: string;
  /** Rendered as the glyph. Kept to simple geometry — no icon dependency. */
  glyph: React.ReactNode;
  /** Phase 3B. Shown, dimmed, and not a link. */
  soon?: boolean;
}

const ITEMS: Item[] = [
  { href: "/", label: "Hub", glyph: <Glyph d="M3 9.5 10 4l7 5.5V16a1 1 0 0 1-1 1h-4v-4H8v4H4a1 1 0 0 1-1-1z" /> },
  { href: "/play", label: "Play", glyph: <Glyph d="M6 4l10 6-10 6z" /> },
  { href: "/watch", label: "Spectate", glyph: <Glyph d="M10 5c4 0 7 3.2 8 5-1 1.8-4 5-8 5s-7-3.2-8-5c1-1.8 4-5 8-5zm0 2.5A2.5 2.5 0 1 0 10 12.5 2.5 2.5 0 0 0 10 7.5z" /> },
  { href: "/profile", label: "Profile", glyph: <Glyph d="M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-6 7c0-3 2.7-5 6-5s6 2 6 5z" /> },
  { href: "/leaderboard", label: "Ladder", glyph: <Glyph d="M3 16h4V9H3zm5 0h4V3H8zm5 0h4v-5h-4z" /> },
];

function Glyph({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-[18px] w-[18px]">
      <path d={d} fill="currentColor" />
    </svg>
  );
}

export function Rail() {
  const pathname = usePathname();

  /* The match screen takes the viewport. §6.4 fixes the HUD to the top and
     §6.7 is a full-screen takeover; a navigation rail alongside either is
     clutter competing with the thing the player is actually doing. */
  const hidden =
    pathname.startsWith("/watch/") || pathname.startsWith("/c/") || pathname.startsWith("/dev/");
  if (hidden) return null;

  return (
    <nav
      aria-label="Primary"
      className="border-line bg-surface/40 fixed inset-y-0 left-0 z-40 hidden w-[68px] flex-col items-center gap-1 border-r py-4 md:flex"
    >
      <Link
        href="/"
        aria-label="1v1.code home"
        className="focus-ring font-display text-fg mb-3 text-16 font-extrabold tracking-[var(--track-display)]"
      >
        1<span className="text-player">v</span>1
      </Link>

      {ITEMS.map((item) => {
        const active =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        if (item.soon) {
          return (
            <span
              key={item.href}
              title={`${item.label} — coming soon`}
              aria-disabled="true"
              className="text-fg-faint/40 relative flex w-full cursor-default flex-col items-center gap-1 py-2.5"
            >
              {item.glyph}
              <span className="font-display text-[9px] font-bold tracking-[var(--track-hud)] uppercase">
                {item.label}
              </span>
            </span>
          );
        }
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`focus-ring relative flex w-full flex-col items-center gap-1 py-2.5 transition-colors duration-[160ms] ${
              active ? "text-fg" : "text-fg-faint hover:text-fg-dim"
            }`}
          >
            {/* The active marker. A 2px bar on the rail edge in the player
                colour — the same ownership signal §4 uses everywhere else. */}
            <span
              aria-hidden="true"
              className={`bg-player absolute left-0 top-1/2 h-7 w-[2px] origin-center -translate-y-1/2 transition-transform duration-[160ms] ${
                active ? "scale-y-100" : "scale-y-0"
              }`}
            />
            {item.glyph}
            <span className="font-display text-[9px] font-bold tracking-[var(--track-hud)] uppercase">
              {item.label}
            </span>
          </Link>
        );
      })}

      <div className="flex-1" />

      <form action="/api/auth/logout" method="post" className="w-full">
        <button
          type="submit"
          title="Sign out"
          className="focus-ring text-fg-faint hover:text-fail flex w-full flex-col items-center gap-1 py-2.5 transition-colors duration-[160ms]"
        >
          <Glyph d="M8 4H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3v-2H6V6h2zm3.3 1.3 3.9 3.9a1 1 0 0 1 0 1.4l-3.9 3.9-1.4-1.4L11.6 11H8V9h3.6L9.9 6.7z" />
          <span className="font-display text-[9px] font-bold tracking-[var(--track-hud)] uppercase">
            Out
          </span>
        </button>
      </form>
    </nav>
  );
}
