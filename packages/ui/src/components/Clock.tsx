"use client";

import { motion, useAnimationControls } from "framer-motion";
import { useEffect, useRef } from "react";
import { dur, ease, sec } from "../../motion";
import { cn } from "../lib/cn";
import { useReducedMotion } from "../lib/motion-pref";

const WARNING_MS = 60_000;
const CRITICAL_MS = 10_000;

export interface ClockProps {
  /** Remaining time. The server owns this value; the clock only draws it (§10). */
  ms: number;
  /** `hud` is the 72px match clock. It is the only 72px thing in the product (§4). */
  size?: "hud" | "sm";
  /** Before the reveal animation finishes, the clock is shown but not running (§6.3). */
  pending?: boolean;
  className?: string;
}

function format(ms: number): string {
  const clamped = Math.max(0, ms);
  const totalSeconds = Math.floor(clamped / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function Clock({ ms, size = "hud", pending = false, className }: ClockProps) {
  const reduced = useReducedMotion();
  const controls = useAnimationControls();
  const lastSecond = useRef(-1);

  const critical = !pending && ms <= CRITICAL_MS;
  const warning = !pending && ms <= WARNING_MS;
  const second = Math.floor(Math.max(0, ms) / 1000);

  // Inside the final ten seconds every tick gets a single 90ms pop. This is a
  // discrete state change, not an ambient loop — §5 allows exactly one looping
  // ambient animation in the product and it is the queue radar, not this.
  useEffect(() => {
    if (lastSecond.current === second) return;
    const changed = lastSecond.current !== -1;
    lastSecond.current = second;
    if (!changed || !critical || reduced) return;
    void controls.start({
      scale: [1, 1.06, 1],
      transition: { duration: sec(dur.instant), ease: ease.snap },
    });
  }, [second, critical, reduced, controls]);

  return (
    <motion.div
      animate={controls}
      role="timer"
      aria-live="off"
      className={cn(
        "tabular leading-none font-bold",
        size === "hud" ? "text-72" : "text-26",
        pending && "text-fg-faint",
        !pending && !warning && "text-fg",
        !pending && warning && "text-clock",
        // The only glow that persists at rest, and it lasts ten seconds by
        // definition. Halved with everything else rather than removed.
        critical && "drop-shadow-[0_0_var(--glow-r)_var(--clock)]",
        className,
      )}
    >
      {format(ms)}
    </motion.div>
  );
}
