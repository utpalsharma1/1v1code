"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { cn } from "../../lib/cn";
import { useMotion } from "../../lib/motion-tuning";

const CHARS_PER_SEC = 28;

/**
 * §6.3 — the problem statement unfolds from the center and the title types
 * itself in at ~28 chars/sec.
 *
 * This is the only typewriter effect in the product. On a competitive coding
 * arena it is thematically earned; anywhere else it would be decoration. Do not
 * reuse it.
 */
export function ProblemPanel({
  title,
  rating,
  statement,
  revealed,
  className,
}: {
  title: string;
  /** On the player scale (§8). Never a bucket, never color-coded. */
  rating: number;
  statement: string;
  revealed: boolean;
  className?: string;
}) {
  const m = useMotion();
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (!revealed) {
      setTyped("");
      return;
    }
    if (m.reduced) {
      setTyped(title);
      return;
    }
    let i = 0;
    const step = 1000 / CHARS_PER_SEC / m.speed;
    const id = window.setInterval(() => {
      i += 1;
      setTyped(title.slice(0, i));
      if (i >= title.length) window.clearInterval(id);
    }, step);
    return () => window.clearInterval(id);
  }, [revealed, title, m.reduced, m.speed]);

  return (
    <motion.section
      className={cn(
        "clip-p1 border-line flex min-h-0 flex-col border bg-surface",
        className,
      )}
      initial={m.reduced ? { opacity: 0 } : { opacity: 0, scaleY: 0.2 }}
      animate={
        revealed
          ? m.reduced
            ? { opacity: 1 }
            : { opacity: 1, scaleY: 1 }
          : { opacity: 0 }
      }
      transition={m.reduced ? m.t({}) : m.spring.heavy}
      style={{ transformOrigin: "center" }}
    >
      <header className="border-line flex items-baseline justify-between gap-3 border-b px-4 py-3">
        <h2 className="font-display text-fg min-h-[1.2em] text-16 font-bold tracking-[var(--track-display)] uppercase">
          {typed}
          {!m.reduced && typed.length < title.length && (
            <span className="text-player">▌</span>
          )}
        </h2>
        <span className="tabular text-fg-faint shrink-0 text-13">{rating}</span>
      </header>
      <div className="text-fg-dim overflow-y-auto px-4 py-3 text-13 leading-relaxed whitespace-pre-line">
        {statement}
      </div>
    </motion.section>
  );
}
