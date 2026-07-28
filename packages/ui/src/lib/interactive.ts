"use client";

import { dur, ease, interactive, tween } from "../../motion";
import { useReducedMotion } from "./motion-pref";

/**
 * The three visible states every interactive element must have (§5).
 * Returns Framer props; under reduced motion the movement is dropped and the
 * element relies on its CSS color transitions to show hover/press.
 */
export function useInteractive(disabled = false) {
  const reduced = useReducedMotion();
  if (disabled || reduced) return {};
  return {
    whileHover: { ...interactive.hover, transition: tween(dur.fast, ease.out) },
    whileTap: { ...interactive.press, transition: tween(dur.instant, ease.snap) },
  };
}
