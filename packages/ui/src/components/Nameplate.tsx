"use client";

import { motion, useAnimationControls } from "framer-motion";
import { useEffect } from "react";
import { dur, ease, REDUCED_MS, sec, transitionFor, tween } from "../../motion";
import { cn } from "../lib/cn";
import { useReducedMotion } from "../lib/motion-pref";
import type { Division, Side, Tier } from "../lib/types";
import { RankBadge } from "./RankBadge";

export type NameplateState = "idle" | "active" | "winner" | "loser";

export interface NameplateProps {
  side: Side;
  handle: string;
  rating: number;
  tier: Tier;
  division?: Division;
  state?: NameplateState;
  /** Bump this number to fire the 60ms white flash from §6.2 step 3. */
  flashKey?: number;
  size?: "md" | "lg";
  className?: string;
}

export function Nameplate({
  side,
  handle,
  rating,
  tier,
  division,
  state = "idle",
  flashKey = 0,
  size = "md",
  className,
}: NameplateProps) {
  const reduced = useReducedMotion();
  const flash = useAnimationControls();
  const isP2 = side === "p2";

  useEffect(() => {
    if (flashKey === 0) return;
    void flash.start({
      opacity: [1, 0],
      transition: reduced
        ? { duration: sec(REDUCED_MS), ease: "linear" }
        : { duration: sec(dur.flash), ease: ease.out },
    });
  }, [flashKey, flash, reduced]);

  return (
    <motion.div
      data-side={side}
      data-state={state}
      animate={{ scale: state === "winner" && !reduced ? 1.04 : 1 }}
      transition={transitionFor(reduced, tween(dur.base, ease.snap))}
      className={cn(
        "clip-lean relative flex items-center border bg-surface",
        // P2 mirrors the whole plate so the two lean into each other.
        isP2 ? "flex-row-reverse" : "flex-row",
        size === "lg" ? "gap-4 py-3 pr-5 pl-5" : "gap-3 py-2 pr-4 pl-4",
        state === "idle" && "border-line",
        state === "active" && "border-player shadow-[0_0_24px_var(--player-glow)]",
        state === "winner" && "border-player shadow-[0_0_40px_var(--player-glow)]",
        state === "loser" && "border-line opacity-60 grayscale",
        "transition-colors duration-[240ms]",
        className,
      )}
    >
      {/* Corner chip. Position + literal label are the two non-hue carriers of
          player identity required by the colorblind rule (§4). */}
      <span
        className={cn(
          "clip-lean-sm font-display text-ink text-12 font-extrabold",
          "tracking-[var(--track-hud)] bg-player px-1.5 py-0.5 leading-none",
        )}
      >
        {isP2 ? "P2" : "P1"}
      </span>

      <RankBadge tier={tier} division={division} size={size === "lg" ? "md" : "sm"} />

      <div className={cn("flex flex-col", isP2 ? "items-end" : "items-start")}>
        <span
          className={cn(
            "font-display font-bold tracking-[var(--track-display)] text-fg",
            size === "lg" ? "text-20" : "text-14",
          )}
        >
          {handle}
        </span>
        <span className="tabular text-fg-faint text-12 leading-tight">{rating}</span>
      </div>

      {/* The white impact flash. Sits above everything, ignores pointer events. */}
      <motion.span
        aria-hidden
        initial={{ opacity: 0 }}
        animate={flash}
        className="pointer-events-none absolute inset-0 bg-[var(--flash-hard)]"
      />
    </motion.div>
  );
}
