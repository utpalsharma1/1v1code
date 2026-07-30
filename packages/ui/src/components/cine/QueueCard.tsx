"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { cn } from "../../lib/cn";
import { useMotion } from "../../lib/motion-tuning";
import type { Division, Tier } from "../../lib/types";
import { Button } from "../Button";
import { RankBadge } from "../RankBadge";

/**
 * §6.1. The PLAY button transforms in place into this card rather than
 * navigating. The radar sweep is the one piece of ambient looping motion in the
 * entire product — waiting needs a heartbeat.
 */
/** A thin bar showing how wide the search is against how wide it can get.
 *  Transform-only (§5): scaleX on a fixed element, never an animated width. */
function BandProgress({ half, ceiling }: { half: number; ceiling: number }) {
  const m = useMotion();
  const fraction = Math.max(0, Math.min(1, half / ceiling));
  return (
    <span className="border-line relative mt-2 block h-1 w-full overflow-hidden border">
      <motion.span
        className="bg-player absolute inset-0 origin-left"
        initial={false}
        animate={{ scaleX: fraction }}
        transition={m.reduced ? m.t({}) : m.spring.bar}
      />
    </span>
  );
}

/** How long "you are the only one here" must hold before we say so. Short
 *  enough not to waste the player's time, long enough that a normal pairing
 *  race never trips it. */
const ALONE_AFTER_S = 20;

export function QueueCard({
  rating,
  tier,
  division,
  onCancel,
  live,
}: {
  rating: number;
  tier: Tier;
  division?: Division;
  onCancel: () => void;
  /** Real queue state from the gateway. Omitted on /dev/hud, which simulates. */
  live?: {
    elapsedMs: number;
    band: [number, number];
    widening: boolean;
    inQueue: number;
    alone: boolean;
    /** Ceiling half-width, so the card can show progress toward it. */
    ceiling?: number;
    /** ms until the band widens again. Null at the ceiling. */
    nextStepMs?: number | null;
  };
}) {
  const m = useMotion();
  const [simulated, setSimulated] = useState(0);

  useEffect(() => {
    if (live) return; // real data is driving; do not also invent it
    const id = window.setInterval(() => setSimulated((v) => v + 1), 1000 / m.speed);
    return () => window.clearInterval(id);
  }, [m.speed, live]);

  const elapsed = live ? Math.floor(live.elapsedMs / 1000) : simulated;

  /* THE EMPTY QUEUE (2B-4).

     With the bot fallback gone there is nothing to pair with in an empty pool,
     and a radar sweeping forever over nobody is the dishonest version: §5 only
     permits a loop that encodes live state, and "searching" stops being the
     useful reading once there is provably no one to find. The queue is NOT
     cancelled — you stay in it, and the moment someone joins you pair. What
     changes is the claim: the sweep stops, and the card says what is true. */
  const stalled = (live?.alone ?? false) && elapsed >= ALONE_AFTER_S;

  // Band widens every 10s, and we say so — §6.1 and §8's adaptive spread.
  const widenings = Math.floor(elapsed / 10);
  const simBand = 30 + widenings * 25;
  const lo = live ? live.band[0] : rating - simBand;
  const hi = live ? live.band[1] : rating + simBand;
  const widening = live ? live.widening : widenings > 0;
  const justWidened = elapsed > 0 && elapsed % 10 < 2;
  const inQueue = live ? live.inQueue : 47 + widenings * 13;
  const half = live ? Math.round((live.band[1] - live.band[0]) / 2) : simBand;
  const ceiling = live?.ceiling ?? 400;
  // Falls back to the 10s cadence §6.1 specifies when the server omits it.
  const nextStepS = (live?.nextStepMs ?? (10 - (elapsed % 10)) * 1000) / 1000;

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <motion.div
      className="clip-lean border-player relative w-full max-w-md overflow-hidden border bg-surface p-6"
      initial={m.reduced ? { opacity: 0 } : { opacity: 0, scaleY: 0.7 }}
      animate={m.reduced ? { opacity: 1 } : { opacity: 1, scaleY: 1 }}
      exit={{
        opacity: 0,
        ...(m.reduced ? {} : { scaleY: 0.7 }),
        transition: m.t(m.tween(m.dur.base, m.ease.in)),
      }}
      style={{ transformOrigin: "top" }}
      transition={m.reduced ? m.t({}) : m.spring.heavy}
    >
      <div className="flex items-center gap-5">
        <div className="relative grid size-20 shrink-0 place-items-center">
          {/* Radar sweep. Loops because it encodes a live search (§5), so it
              stops the instant the search cannot succeed. */}
          {!m.reduced && !stalled && (
            <motion.span
              aria-hidden
              className="ambient absolute inset-0"
              style={{
                background:
                  "conic-gradient(from 0deg, transparent 0deg, var(--player-glow) 55deg, transparent 70deg)",
              }}
              animate={{ rotate: 360 }}
              transition={{ duration: m.sec(2400), repeat: Infinity, ease: "linear" }}
            />
          )}
          <RankBadge tier={tier} division={division} size="lg" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="font-display text-fg text-20 font-extrabold tracking-[var(--track-display)] uppercase">
            {stalled ? "Queue is empty" : "Searching"}
          </p>
          <p className="tabular text-fg-dim mt-1 text-26 leading-none">
            {mm}:{ss}
          </p>
          {stalled ? (
            <p className="text-fg-dim mt-2 text-12 leading-relaxed">
              Nobody else is queuing. You are still in the queue and will be matched the moment
              someone joins — there is just no one to find right now.
            </p>
          ) : (
            /* PROGRESS, NOT REASSURANCE.

               "Widening search…" was true and carried no information, and the
               cost of that was real: the band widens over more than two
               minutes, so a player who cannot see it moving concludes nothing
               is happening and cancels. Show the band, the next step, and how
               far there is left to go. */
            <>
              <p className="tabular text-fg-dim mt-2 text-12">
                Scanning <span className="text-fg">{lo}–{hi}</span>
                <span className="text-fg-faint">
                  {" · "}
                  {inQueue} {inQueue === 1 ? "player" : "players"} in queue
                </span>
              </p>
              <BandProgress half={half} ceiling={ceiling} />
              <p className="tabular text-fg-faint mt-1.5 text-12">
                {widening ? (
                  <>
                    Next widen in{" "}
                    <span className="text-info">{Math.max(0, Math.ceil(nextStepS))}s</span>
                    {" · "}up to ±{ceiling}
                  </>
                ) : (
                  <>Widest search reached (±{ceiling}) · still looking</>
                )}
              </p>
            </>
          )}
        </div>
      </div>

      <Button variant="outline" tone="neutral" full className="mt-5" onClick={onCancel}>
        {stalled ? "Leave queue" : "Cancel"}
      </Button>
    </motion.div>
  );
}
