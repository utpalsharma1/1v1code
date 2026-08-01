"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@1v1/ui";

/* ============================================================================
   The PLAY control — the largest element on the Hub, with the mode selector
   attached (§7).

   §6.1 says PLAY transforms in place into a queue card rather than navigating.
   That transformation lives on /play, which owns the socket; this is the
   entry point, and pressing it goes there and queues immediately so the
   player never presses PLAY twice for one intent.

   The mode selector REMEMBERS THE LAST MODE (§7), in localStorage rather than
   on the server: it is a preference about this browser, it must be readable
   before first paint to avoid the control flickering from one mode to another,
   and it is not worth a round trip.

   Blitz and Bo3 are Phase 4 and DEFERRED IN FULL (§12). They appear disabled
   rather than hidden for the same reason the rail shows Phase 3B items: a
   control that changes shape as features land teaches players to re-read it.
   ========================================================================= */

const MODES = [
  { id: "ranked", label: "Ranked", hint: "Rated. Counts toward your ladder." },
  { id: "blitz", label: "Blitz", hint: "Coming later", soon: true },
  { id: "bo3", label: "Best of 3", hint: "Coming later", soon: true },
] as const;

const STORAGE_KEY = "1v1.mode";

export function HubPlay() {
  const router = useRouter();
  const [mode, setMode] = useState<string>(() => {
    if (typeof window === "undefined") return "ranked";
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved === "ranked" ? saved : "ranked";
  });
  const [going, setGoing] = useState(false);

  const start = () => {
    setGoing(true);
    window.localStorage.setItem(STORAGE_KEY, mode);
    router.push("/play?queue=1");
  };

  return (
    <div className="border-line clip-corner flex flex-col border bg-surface">
      <button
        type="button"
        onClick={start}
        disabled={going}
        className="focus-ring group font-display text-ink bg-p1 hover:bg-p1 flex-1 px-8 py-10 text-[48px] font-extrabold leading-none tracking-[var(--track-display)] uppercase transition-transform duration-[160ms] hover:scale-[1.02] active:scale-[0.97] disabled:opacity-70"
      >
        {going ? "…" : "Play"}
      </button>

      <div className="border-line flex border-t">
        {MODES.map((m) => {
          const active = m.id === mode;
          return (
            <button
              key={m.id}
              type="button"
              disabled={"soon" in m && m.soon}
              onClick={() => setMode(m.id)}
              title={m.hint}
              aria-pressed={active}
              className={`focus-ring font-display flex-1 px-3 py-2.5 text-11 font-bold tracking-[var(--track-hud)] uppercase transition-colors duration-[160ms] ${
                active
                  ? "text-fg bg-elevated"
                  : "text-fg-faint hover:text-fg-dim disabled:hover:text-fg-faint disabled:opacity-40"
              }`}
            >
              {m.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
