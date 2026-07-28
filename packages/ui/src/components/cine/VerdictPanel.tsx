"use client";

import { motion } from "framer-motion";
import { cn } from "../../lib/cn";
import { useMotion } from "../../lib/motion-tuning";
import type { CellState, Side } from "../../lib/types";
import { Particles } from "../hud/Particles";

/**
 * §6.6 — the highest-stakes second in the product.
 *
 * Test cases resolve sequentially, ~120ms apart. Do not resolve them at once:
 * the staggered reveal *is* the drama. This is a slot machine and it should be
 * treated like one.
 *
 * On failure the panel leaves in 240ms. Never make a losing player wait on an
 * animation.
 */
export interface VerdictPanelProps {
  side: Side;
  cells: CellState[];
  /** Index currently being spotlit while others dim, on failure. */
  failedIndex: number | null;
  /** null while still resolving. */
  outcome: "pass" | "fail" | null;
  burstKey: number;
}

export function VerdictPanel({
  side,
  cells,
  failedIndex,
  outcome,
  burstKey,
}: VerdictPanelProps) {
  const m = useMotion();
  const resolved = cells.filter((c) => c !== "idle").length;

  return (
    <motion.div
      data-side={side}
      className="pointer-events-none fixed inset-x-0 top-0 z-50 grid place-items-center px-6 pt-6"
      initial={m.reduced ? { opacity: 0 } : { opacity: 0, y: -80 }}
      animate={m.reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
      exit={m.reduced ? { opacity: 0 } : { opacity: 0, y: -40 }}
      transition={m.reduced ? m.t({}) : m.spring.heavy}
    >
      <div
        className={cn(
          "clip-lean relative w-full max-w-2xl overflow-hidden border bg-elevated px-6 py-5",
          outcome === "fail" ? "border-fail" : "border-player",
        )}
      >
        {/* Pass: floods from the center outward. */}
        {outcome === "pass" && (
          <motion.span
            aria-hidden
            className="bg-player absolute inset-0 origin-center"
            initial={{ scaleX: 0, opacity: 0.85 }}
            animate={{ scaleX: 1, opacity: 0.18 }}
            transition={m.t({ duration: m.sec(m.dur.slow), ease: m.ease.out })}
          />
        )}

        <Particles
          fireKey={outcome === "pass" ? burstKey : 0}
          count={90}
          color="var(--player)"
          originY={0.5}
          life={1200}
          className="pointer-events-none absolute inset-0 size-full"
        />

        <div className="relative flex items-center justify-between gap-4">
          <p
            className={cn(
              "font-display text-16 font-extrabold tracking-[var(--track-display)] uppercase",
              outcome === "fail" ? "text-fail" : outcome === "pass" ? "text-fg" : "text-fg-dim",
            )}
          >
            {outcome === "pass"
              ? "Accepted"
              : outcome === "fail"
                ? `Wrong answer · test ${(failedIndex ?? 0) + 1}`
                : "Running tests"}
          </p>
          <p className="tabular text-fg-dim text-13">
            {resolved}/{cells.length}
          </p>
        </div>

        <div className="relative mt-4 flex gap-1.5">
          {cells.map((state, i) => {
            const dimmed = outcome === "fail" && failedIndex !== null && i !== failedIndex;
            return (
              <motion.span
                key={i}
                className={cn(
                  "h-8 flex-1",
                  state === "idle" && "border-line border",
                  state === "pass" && "fill-player",
                  state === "fail" && "bg-fail",
                )}
                initial={false}
                animate={{
                  opacity: dimmed ? 0.25 : 1,
                  scaleY: !m.reduced && state !== "idle" ? [0.6, 1] : 1,
                }}
                transition={m.t({ duration: m.sec(m.dur.instant), ease: m.ease.snap })}
              />
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
