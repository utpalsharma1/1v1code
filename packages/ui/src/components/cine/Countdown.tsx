"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useMotion } from "../../lib/motion-tuning";

/**
 * §6.3 — `3 · 2 · 1 · GO`, each beat at 72px with a ring pulse expanding
 * outward and fading. The clock does not start until the reveal that follows
 * this has finished.
 */
export function Countdown({ beat }: { beat: 3 | 2 | 1 | 0 | null }) {
  const m = useMotion();
  if (beat === null) return null;
  const label = beat === 0 ? "GO" : String(beat);

  return (
    <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center">
      <div className="absolute inset-0 bg-[var(--scrim)]" />
      <AnimatePresence mode="wait">
        <motion.div key={label} className="relative grid place-items-center">
          {/* Ring pulse */}
          {!m.reduced && (
            <motion.span
              aria-hidden
              className="border-player absolute size-40 rounded-full border-2"
              initial={{ scale: 0.4, opacity: 0.8 }}
              animate={{ scale: 2.2, opacity: 0 }}
              transition={{ duration: m.sec(m.dur.slow), ease: m.ease.out }}
            />
          )}
          <motion.span
            className="font-display text-fg relative text-72 leading-none font-extrabold tracking-[var(--track-display)] tabular-nums"
            initial={m.reduced ? { opacity: 0 } : { scale: 1.4, opacity: 0 }}
            animate={m.reduced ? { opacity: 1 } : { scale: 1, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={
              m.reduced ? m.t({}) : { duration: m.sec(m.dur.base), ease: m.ease.snap }
            }
          >
            {label}
          </motion.span>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
