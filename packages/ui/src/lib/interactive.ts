"use client";

import { interactive } from "../../motion";
import { useMotion } from "./motion-tuning";

/**
 * The three visible states every interactive element must have (§5).
 * Returns Framer props; under reduced motion the movement is dropped and the
 * element relies on its CSS color transitions to show hover/press.
 */
export function useInteractive(disabled = false) {
  const m = useMotion();
  if (disabled || m.reduced) return {};
  return {
    whileHover: { ...interactive.hover, transition: m.tween(m.dur.fast, m.ease.out) },
    whileTap: { ...interactive.press, transition: m.tween(m.dur.instant, m.ease.snap) },
  };
}
