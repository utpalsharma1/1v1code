"use client";

import { motion, useAnimationControls } from "framer-motion";
import { useCallback, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { useMotion } from "../../lib/motion-tuning";
import type { Side } from "../../lib/types";

/* ── Screen shake (§6.2, §6.6) ───────────────────────────────────────────
   Transform only, so it composites and never triggers layout. Disabled
   entirely under reduced motion, per §5. */

export function useScreenShake() {
  const controls = useAnimationControls();
  const m = useMotion();

  const fire = useCallback(
    (amplitude: number, ms: number) => {
      if (m.reduced) return;
      // Amplitude decays across the oscillation: a real impulse loses energy,
      // and constant amplitude reads as a rumble or a rendering glitch.
      const x = m.shakeFrames(amplitude);
      const y = m.shakeFrames(amplitude * 0.4).map((v, i) => (i % 2 ? -v : v));
      void controls.start({
        x,
        y,
        transition: { duration: m.sec(ms), ease: m.ease.out },
      });
    },
    [controls, m],
  );

  return { controls, fire };
}

export function ShakeStage({
  controls,
  className,
  children,
}: {
  controls: ReturnType<typeof useAnimationControls>;
  className?: string;
  children: ReactNode;
}) {
  // `initial` forces a transform onto the element from the first paint. Without
  // it the element only becomes a containing block *after* the first shake,
  // which would silently re-anchor every position:fixed overlay inside it
  // partway through a session.
  return (
    <motion.div initial={{ x: 0, y: 0 }} animate={controls} className={className}>
      {children}
    </motion.div>
  );
}

/* ── Clutch edge (§6.5) ──────────────────────────────────────────────────
   When the opponent passes 80% of their tests the viewport edge on their side
   develops a slow breathing glow. Peripheral by design — you feel it before
   you consciously see it. At 90% it doubles.

   This loops, which §5 otherwise reserves for the queue radar. It is sanctioned
   because §2 rule 3 names clutch state as one of the five moments that get real
   cinematics — it is a state alarm, not ambient decoration, and it only exists
   while someone is actually about to win. */

export function ClutchEdge({
  side,
  /** Fraction of tests passed, 0–1. Below 0.8 renders nothing at all. */
  progress,
}: {
  side: Side;
  progress: number;
}) {
  const m = useMotion();
  if (progress < 0.8) return null;

  const intense = progress >= 0.9;
  const peak = intense ? 0.85 : 0.4;

  return (
    <motion.div
      aria-hidden
      data-side={side}
      className={cn(
        "pointer-events-none fixed inset-y-0 z-30 w-[22vw] max-w-[280px]",
        side === "p1" ? "left-0" : "right-0",
      )}
      style={{
        background:
          side === "p1"
            ? "linear-gradient(to right, var(--player-glow), transparent)"
            : "linear-gradient(to left, var(--player-glow), transparent)",
      }}
      initial={{ opacity: 0 }}
      animate={
        m.reduced
          ? { opacity: peak * 0.7 }
          : { opacity: [peak * 0.35, peak, peak * 0.35] }
      }
      transition={
        m.reduced
          ? m.t({})
          : {
              // Slower reads as dread; faster reads as a notification. Clutch is
              // meant to be felt peripherally, not watched.
              duration: m.sec(m.dur.breathe),
              repeat: Infinity,
              ease: m.ease.inOut,
            }
      }
    />
  );
}

/* ── Compile pulse (§6.5) ────────────────────────────────────────────────
   A shockwave crossing that player's half of the HUD, 400ms. Keyed by a
   counter so firing it twice in a row replays it. */

export function CompilePulse({ side, fireKey }: { side: Side; fireKey: number }) {
  const m = useMotion();
  if (fireKey === 0 || m.reduced) return null;

  return (
    <motion.span
      key={fireKey}
      aria-hidden
      data-side={side}
      className="pointer-events-none absolute inset-y-0 w-1/2"
      style={{
        [side === "p1" ? "left" : "right"]: 0,
        background:
          "linear-gradient(90deg, transparent, var(--player-glow), transparent)",
      }}
      initial={{ x: side === "p1" ? "-100%" : "100%", opacity: 0.9 }}
      animate={{ x: side === "p1" ? "100%" : "-100%", opacity: 0 }}
      transition={{ duration: m.sec(400), ease: m.ease.out }}
    />
  );
}
