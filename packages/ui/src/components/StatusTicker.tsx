"use client";

import { AnimatePresence, motion } from "framer-motion";
import { dur, ease, transitionFor, tween } from "../../motion";
import { cn } from "../lib/cn";
import { useReducedMotion } from "../lib/motion-pref";
import type { Side } from "../lib/types";

/**
 * What the opponent is doing — never what they are writing. The ticker leaks
 * activity, not content (§6.4).
 */
export type Status =
  | { kind: "idle" }
  | { kind: "typing" }
  | { kind: "compiling" }
  | { kind: "running" }
  | { kind: "result"; passed: number; total: number }
  | { kind: "submitted" }
  | { kind: "failed" };

export interface StatusTickerProps {
  status: Status;
  side?: Side;
  align?: "start" | "end";
  className?: string;
}

function describe(status: Status): { text: string; tone: string } {
  switch (status.kind) {
    case "idle":
      return { text: "idle", tone: "text-fg-faint" };
    case "typing":
      return { text: "typing…", tone: "text-fg-dim" };
    case "compiling":
      return { text: "compiling", tone: "text-info" };
    case "running":
      return { text: "running tests", tone: "text-info" };
    case "result":
      return { text: `${status.passed}/${status.total} passed`, tone: "text-player" };
    case "submitted":
      return { text: "submitted", tone: "text-player" };
    case "failed":
      return { text: "compile error", tone: "text-fail" };
  }
}

export function StatusTicker({ status, side, align = "start", className }: StatusTickerProps) {
  const reduced = useReducedMotion();
  const { text, tone } = describe(status);

  return (
    // Fixed height and relative positioning: the ticker cross-fades in place
    // and must never move the HUD around it.
    <div
      data-side={side}
      className={cn(
        "relative h-4 overflow-hidden",
        align === "end" ? "text-right" : "text-left",
        className,
      )}
      aria-live="polite"
    >
      <AnimatePresence initial={false}>
        <motion.span
          key={text}
          initial={{ opacity: 0, y: reduced ? 0 : 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduced ? 0 : -4 }}
          transition={transitionFor(reduced, tween(dur.fast, ease.out))}
          className={cn(
            "font-display absolute inset-0 text-12 leading-4 font-bold",
            "tracking-[var(--track-hud)] uppercase",
            align === "end" ? "text-right" : "text-left",
            tone,
          )}
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

/** Exported so the kitchen sink and Phase 1's simulator can cycle every state. */
export const ALL_STATUSES: Status[] = [
  { kind: "idle" },
  { kind: "typing" },
  { kind: "compiling" },
  { kind: "running" },
  { kind: "result", passed: 4, total: 10 },
  { kind: "submitted" },
  { kind: "failed" },
];
