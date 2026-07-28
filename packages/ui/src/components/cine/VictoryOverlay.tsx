"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import { useMotion } from "../../lib/motion-tuning";
import type { Division, Side, Tier } from "../../lib/types";
import { Button } from "../Button";
import { RankBadge } from "../RankBadge";
import { Particles } from "../hud/Particles";

/**
 * §6.7 — budget 3s, and the only full-screen takeover in the product.
 */
export interface VictoryOverlayProps {
  /** Which side won. The viewer is always P1, so this decides VICTORY/DEFEAT. */
  winner: Side;
  ratingFrom: number;
  ratingTo: number;
  burstKey: number;
  rankUp?: { from: Tier; to: Tier; division?: Division } | null;
  /** Fired when the player skips the remainder of the cinematic. */
  onSkip?: () => void;
  onRematch?: () => void;
  onQueue?: () => void;
  onReplay?: () => void;
  onHub?: () => void;
}

export function VictoryOverlay({
  winner,
  ratingFrom,
  ratingTo,
  burstKey,
  rankUp = null,
  onSkip,
  onRematch,
  onQueue,
  onReplay,
  onHub,
}: VictoryOverlayProps) {
  const m = useMotion();
  const won = winner === "p1";
  const rematchRef = useRef<HTMLButtonElement>(null);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    rematchRef.current?.focus();
  }, []);

  /* Defeat is deliberately shorter than victory. Losing should sting once and
     get out of the way. Under reduced motion neither holds at all. */
  const mandatory = m.reduced ? m.dur.slow : won ? m.dur.victory : m.dur.defeat;

  useEffect(() => {
    const id = window.setTimeout(() => setSettled(true), mandatory);
    return () => window.clearTimeout(id);
  }, [mandatory]);

  /* After dur.skip any input drops the rest of the cinematic. This is the real
     fix for a sequence that is great once and tiring on the fiftieth rematch —
     the answer is not a shorter cinematic, it is a skippable one. */
  useEffect(() => {
    if (settled) return;
    let armed = false;
    const arm = window.setTimeout(() => {
      armed = true;
    }, m.dur.skip);

    const skip = (event: Event) => {
      if (!armed) return;
      // Don't treat activating the focused Rematch button as a skip.
      if (event instanceof KeyboardEvent && ["Enter", " ", "Tab"].includes(event.key)) return;
      if (event.target instanceof Element && event.target.closest("button")) return;
      setSettled(true);
      onSkip?.();
    };

    window.addEventListener("keydown", skip);
    window.addEventListener("pointerdown", skip);
    return () => {
      window.clearTimeout(arm);
      window.removeEventListener("keydown", skip);
      window.removeEventListener("pointerdown", skip);
    };
  }, [settled, m.dur.skip, onSkip]);

  return (
    <motion.div
      data-side={winner}
      className="fixed inset-0 z-50 grid place-items-center overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: m.tween(m.dur.base, m.ease.in) }}
      transition={m.tween(m.dur.base)}
    >
      <div className="absolute inset-0 bg-[var(--scrim)]" />

      <Particles
        fireKey={burstKey}
        count={200}
        color="var(--player)"
        life={1600}
        className="pointer-events-none absolute inset-0 size-full"
      />

      <div className="relative flex flex-col items-center gap-6 px-6 text-center">
        <motion.h1
          className={cn(
            "font-display relative overflow-hidden text-72 leading-none font-extrabold tracking-[var(--track-display)]",
            won ? "text-player" : "text-fg-faint",
          )}
          initial={m.reduced ? { opacity: 0 } : { opacity: 0, scale: 1.25 }}
          animate={m.reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
          transition={m.reduced ? m.t({}) : { ...m.spring.heavy }}
        >
          {won ? "VICTORY" : "DEFEAT"}
          {/* Light sweep across the letterforms. Skipped once settled. */}
          {!m.reduced && !settled && (
            <motion.span
              aria-hidden
              className="absolute inset-y-0 w-1/3"
              style={{
                background:
                  "linear-gradient(90deg, transparent, rgb(255 255 255 / 0.5), transparent)",
              }}
              initial={{ x: "-150%" }}
              animate={{ x: "350%" }}
              transition={{
                duration: m.sec(m.dur.cine),
                ease: m.ease.inOut,
                delay: m.sec(m.dur.base),
              }}
            />
          )}
        </motion.h1>

        <RatingDelta from={ratingFrom} to={ratingTo} settled={settled} />

        {rankUp && <RankUp rankUp={rankUp} />}

        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <Button ref={rematchRef} variant="solid" tone="player" onClick={onRematch}>
            Rematch
          </Button>
          <Button variant="outline" onClick={onQueue}>
            Queue again
          </Button>
          <Button variant="outline" onClick={onReplay}>
            Watch replay
          </Button>
          <Button variant="ghost" onClick={onHub}>
            Back to Hub
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

/** Counts up (or down) digit by digit in tabular figures, with the delta floating. */
function RatingDelta({
  from,
  to,
  settled,
}: {
  from: number;
  to: number;
  settled: boolean;
}) {
  const m = useMotion();
  const [shown, setShown] = useState(from);
  const delta = to - from;

  useEffect(() => {
    // Skipping jumps the counter to its final value rather than leaving it
    // mid-count — the number is the payload, the count-up is the flourish.
    if (m.reduced || settled) {
      setShown(to);
      return;
    }
    const steps = Math.abs(delta);
    if (steps === 0) return;
    const stepMs = Math.max(16, (m.dur.cine / steps) * 1);
    let current = from;
    const id = window.setInterval(() => {
      current += Math.sign(delta);
      setShown(current);
      if (current === to) window.clearInterval(id);
    }, stepMs);
    return () => window.clearInterval(id);
  }, [from, to, delta, m.reduced, m.dur.cine, settled]);

  return (
    <div className="relative flex items-center gap-3">
      <span className="tabular text-fg text-34">{shown}</span>
      <motion.span
        className={cn("tabular text-20", delta >= 0 ? "text-player" : "text-fail")}
        initial={m.reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
        animate={m.reduced ? { opacity: 1 } : { opacity: [0, 1, 1, 0], y: -22 }}
        transition={m.t({
          duration: m.sec(m.dur.cine * 2),
          ease: m.ease.out,
          delay: m.sec(m.dur.base),
        })}
      >
        {delta >= 0 ? "+" : ""}
        {delta}
      </motion.span>
    </div>
  );
}

/**
 * The rank-up chain (§6.7). The old badge shatters, the new one assembles from
 * fragments with a radial burst in the new tier's color. Rank-ups should feel
 * like they cost something to earn.
 */
function RankUp({
  rankUp,
}: {
  rankUp: { from: Tier; to: Tier; division?: Division };
}) {
  const m = useMotion();
  const [phase, setPhase] = useState<"old" | "new">("old");

  useEffect(() => {
    const id = window.setTimeout(() => setPhase("new"), m.dur.slow);
    return () => window.clearTimeout(id);
  }, [m.dur.slow]);

  return (
    <div className="relative mt-2 grid place-items-center gap-3">
      <p className="font-display text-fg-faint text-12 font-bold tracking-[var(--track-hud)] uppercase">
        Rank up
      </p>
      <div className="relative grid size-24 place-items-center">
        {phase === "old" ? (
          <motion.div
            initial={{ opacity: 1, scale: 1 }}
            animate={m.reduced ? { opacity: 0 } : { opacity: 0, scale: 1.35, rotate: 8 }}
            transition={m.t({ duration: m.sec(m.dur.slow), ease: m.ease.inOut })}
          >
            <RankBadge tier={rankUp.from} division={rankUp.division} size="lg" />
          </motion.div>
        ) : (
          <motion.div
            initial={m.reduced ? { opacity: 0 } : { opacity: 0, scale: 0.4 }}
            animate={m.reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
            // spring.impact: the new badge should slam together, not ease in.
            transition={m.reduced ? m.t({}) : m.spring.impact}
          >
            <RankBadge tier={rankUp.to} division={rankUp.division} size="lg" showLabel />
          </motion.div>
        )}
      </div>
    </div>
  );
}
