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
export function QueueCard({
  rating,
  tier,
  division,
  onCancel,
}: {
  rating: number;
  tier: Tier;
  division?: Division;
  onCancel: () => void;
}) {
  const m = useMotion();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setElapsed((v) => v + 1), 1000 / m.speed);
    return () => window.clearInterval(id);
  }, [m.speed]);

  // Band widens every 10s, and we say so — §6.1 and §8's adaptive spread.
  const widenings = Math.floor(elapsed / 10);
  const band = 30 + widenings * 25;
  const justWidened = elapsed > 0 && elapsed % 10 < 2;
  const inQueue = 47 + widenings * 13;

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <motion.div
      className="clip-lean border-player relative w-full max-w-md overflow-hidden border bg-surface p-6"
      initial={m.reduced ? { opacity: 0 } : { opacity: 0, scaleY: 0.7 }}
      animate={m.reduced ? { opacity: 1 } : { opacity: 1, scaleY: 1 }}
      exit={m.reduced ? { opacity: 0 } : { opacity: 0, scaleY: 0.7 }}
      style={{ transformOrigin: "top" }}
      transition={m.reduced ? m.t({}) : m.spring.heavy}
    >
      <div className="flex items-center gap-5">
        <div className="relative grid size-20 shrink-0 place-items-center">
          {/* Radar sweep. Loops by design; disabled under reduced motion. */}
          {!m.reduced && (
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
            Searching
          </p>
          <p className="tabular text-fg-dim mt-1 text-26 leading-none">
            {mm}:{ss}
          </p>
          <p className="text-fg-faint mt-2 text-12">
            Scanning {rating - band}–{rating + band} · {inQueue} players in queue
          </p>
          <p
            className={cn(
              "font-display mt-1 text-12 font-bold tracking-[var(--track-hud)] uppercase",
              justWidened && widenings > 0 ? "text-info" : "text-transparent",
            )}
          >
            Widening search…
          </p>
        </div>
      </div>

      <Button variant="outline" tone="neutral" full className="mt-5" onClick={onCancel}>
        Cancel
      </Button>
    </motion.div>
  );
}
