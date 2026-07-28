"use client";

import { motion, type Variants } from "framer-motion";
import { useMemo } from "react";
import { shakeX } from "../../motion";
import { cn } from "../lib/cn";
import { useMotion } from "../lib/motion-tuning";
import type { CellState, Side } from "../lib/types";

/**
 * Above this many test cases the segmented bar stops being readable — cells
 * would be sub-pixel. The bar degrades to a continuous fill that still races
 * toward the center. §6.4 doesn't bound the cell count; this does.
 */
export const MAX_CELLS = 20;

export interface TestBarProps {
  side: Side;
  total: number;
  /** Explicit per-cell state. Wins over `passed` when both are given. */
  cells?: CellState[];
  /** Convenience: the first `passed` cells are green, the rest idle. */
  passed?: number;
  showCount?: boolean;
  size?: "sm" | "md";
  /**
   * Bump to fire the near-miss shatter (§6.5): the opponent submitted and
   * failed, so their filled cells crack and fall. The best spectator moment in
   * the product — enormous relief for you, well-earned pain for them.
   */
  shatterKey?: number;
  className?: string;
}

export function TestBar({
  side,
  total,
  cells,
  passed = 0,
  showCount = true,
  size = "md",
  shatterKey = 0,
  className,
}: TestBarProps) {
  const m = useMotion();
  const isP2 = side === "p2";

  const resolved = useMemo<CellState[]>(
    () =>
      cells ?? Array.from({ length: total }, (_, i): CellState => (i < passed ? "pass" : "idle")),
    [cells, total, passed],
  );

  const passCount = resolved.filter((c) => c === "pass").length;
  const segmented = total <= MAX_CELLS;

  return (
    <div
      data-side={side}
      className={cn(
        "flex items-center gap-2.5",
        // Mirror the whole row so P2's count sits outboard and its bar fills
        // inward, toward the center of the HUD.
        isP2 ? "flex-row-reverse" : "flex-row",
        className,
      )}
    >
      <div
        className={cn(
          "flex min-w-0 flex-1",
          size === "md" ? "h-3.5 gap-[3px]" : "h-2.5 gap-[2px]",
          isP2 ? "flex-row-reverse" : "flex-row",
        )}
        role="meter"
        aria-valuenow={passCount}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`${side === "p1" ? "P1" : "P2"} tests passed`}
      >
        {segmented ? (
          resolved.map((state, i) => (
            <Cell key={i} state={state} index={i} shatterKey={shatterKey} />
          ))
        ) : (
          <ContinuousBar passed={passCount} total={total} />
        )}
      </div>

      {showCount && (
        <span className="tabular text-fg-dim text-13 leading-none whitespace-nowrap">
          <span className={cn(passCount > 0 && "text-player")}>{passCount}</span>
          <span className="text-fg-faint">/{total}</span>
        </span>
      )}
    </div>
  );
}

/* ── One test case ───────────────────────────────────────────────────────
   Pass: 90ms scale-Y pop plus a 40% white overlay decaying over 200ms.
   Fail: --fail flash, a 2px horizontal shake, then it settles to a dim
   outline so the failure stays legible without staying loud. (§6.4)
   Shatter: the whole filled bar cracks and falls (§6.5). */

function Cell({
  state,
  index,
  shatterKey,
}: {
  state: CellState;
  index: number;
  shatterKey: number;
}) {
  const m = useMotion();
  const shattering = shatterKey > 0 && state === "pass";

  const cellVariants: Variants = useMemo(
    () => ({
      idle: { scaleY: 1, x: 0, y: 0, rotate: 0, opacity: 1 },
      pass: {
        scaleY: [1, 1.3, 1],
        x: 0,
        y: 0,
        rotate: 0,
        opacity: 1,
        transition: { duration: m.sec(m.dur.instant), ease: m.ease.snap },
      },
      fail: {
        scaleY: 1,
        y: 0,
        rotate: 0,
        opacity: 1,
        x: shakeX,
        transition: { duration: m.sec(m.dur.base), ease: m.ease.inOut },
      },
      shatter: {
        y: 46,
        rotate: (index % 2 === 0 ? 1 : -1) * (12 + (index % 5) * 4),
        opacity: 0,
        scaleY: 1,
        transition: {
          duration: m.sec(m.dur.slow),
          ease: m.ease.inOut,
          delay: m.stagger(index),
        },
      },
    }),
    [m, index],
  );

  const overlays: Record<string, Variants> = useMemo(
    () => ({
      white: {
        idle: { opacity: 0 },
        pass: {
          opacity: [0.4, 0],
          transition: { duration: m.sec(m.dur.decay), ease: m.ease.out },
        },
        fail: { opacity: 0 },
        shatter: { opacity: 0 },
      },
      fail: {
        idle: { opacity: 0 },
        pass: { opacity: 0 },
        fail: {
          opacity: [1, 0],
          transition: { duration: m.sec(m.dur.decay), ease: m.ease.out },
        },
        // The 200ms red flash that precedes the fall.
        shatter: {
          opacity: [0.9, 0],
          transition: { duration: m.sec(m.dur.decay), ease: m.ease.out },
        },
      },
    }),
    [m],
  );

  // Under reduced motion nothing moves: state changes read through color and
  // the same overlays, faded rather than popped or thrown.
  const staticVariants: Variants = {
    idle: { opacity: 1 },
    pass: { opacity: 1 },
    fail: { opacity: 1 },
    shatter: { opacity: 0.2 },
  };

  const target = shattering ? "shatter" : state;

  return (
    <motion.div
      data-state={state}
      initial={false}
      animate={target}
      variants={m.reduced ? staticVariants : cellVariants}
      transition={m.reduced ? m.t({}) : undefined}
      className={cn(
        "relative h-full min-w-0 flex-1 overflow-hidden",
        "border transition-colors duration-[160ms]",
        state === "idle" && "border-line bg-transparent",
        state === "pass" && "border-transparent fill-player",
        state === "fail" && "border-fail/50 bg-transparent",
      )}
    >
      <motion.span
        aria-hidden
        variants={overlays["white"]}
        className="absolute inset-0 bg-[var(--flash)]"
      />
      <motion.span
        aria-hidden
        variants={overlays["fail"]}
        className="bg-fail absolute inset-0"
      />
    </motion.div>
  );
}

/* ── Continuous fallback ─────────────────────────────────────────────────
   Scales on X with the origin on the owning player's side, so it still grows
   toward the center. No width animation — §5. */
function ContinuousBar({ passed, total }: { passed: number; total: number }) {
  const m = useMotion();
  return (
    <div className="border-line relative h-full flex-1 border">
      <motion.div
        initial={false}
        animate={{ scaleX: total > 0 ? passed / total : 0 }}
        transition={m.reduced ? { duration: m.sec(m.dur.fast) } : m.spring.bar}
        style={{ transformOrigin: "var(--player-origin)" }}
        className="fill-player h-full w-full"
      />
    </div>
  );
}
