"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import { useMotion } from "../../lib/motion-tuning";
import type { Side } from "../../lib/types";

/** The only six. No text chat during ranked play, ever (§6.5). */
export const EMOTES = ["👏", "🔥", "😅", "🤝", "🧠", "😱"] as const;
export type Emote = (typeof EMOTES)[number];

export const EMOTE_COOLDOWN_MS = 15_000;

export interface FloatingEmote {
  id: number;
  emote: Emote;
  side: Side;
}

/** Radial wheel on Ctrl+E, rate-limited to one per 15 seconds. */
export function EmoteWheel({
  onSend,
  side = "p1",
}: {
  onSend: (emote: Emote) => void;
  side?: Side;
}) {
  const m = useMotion();
  const [open, setOpen] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === "e") {
        event.preventDefault();
        setOpen((v) => !v);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [cooldownUntil]);

  const remaining = Math.max(0, cooldownUntil - now);
  const ready = remaining === 0;

  const send = useCallback(
    (emote: Emote) => {
      if (!ready) return;
      onSend(emote);
      setCooldownUntil(Date.now() + EMOTE_COOLDOWN_MS);
      setNow(Date.now());
      setOpen(false);
    },
    [ready, onSend],
  );

  const radius = 76;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          data-side={side}
          className="fixed inset-0 z-50 grid place-items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={m.t(m.tween(m.dur.fast))}
          onClick={() => setOpen(false)}
        >
          <div className="absolute inset-0 bg-[var(--scrim)]" />
          <div className="relative size-[220px]" onClick={(e) => e.stopPropagation()}>
            {EMOTES.map((emote, i) => {
              const angle = (i / EMOTES.length) * Math.PI * 2 - Math.PI / 2;
              const x = Math.cos(angle) * radius;
              const y = Math.sin(angle) * radius;
              return (
                <motion.button
                  key={emote}
                  type="button"
                  disabled={!ready}
                  onClick={() => send(emote)}
                  className={cn(
                    "focus-ring clip-lean-sm border-line absolute top-1/2 left-1/2 grid size-12 -translate-x-1/2 -translate-y-1/2",
                    "place-items-center border bg-elevated text-20",
                    "hover:border-[var(--player)] disabled:opacity-40",
                  )}
                  initial={m.reduced ? { opacity: 0 } : { opacity: 0, x: -24, y: -24, scale: 0.6 }}
                  animate={
                    m.reduced
                      ? { opacity: 1, x: x - 24, y: y - 24 }
                      : { opacity: 1, x: x - 24, y: y - 24, scale: 1 }
                  }
                  transition={m.reduced ? m.t({}) : { ...m.spring.ui, delay: m.stagger(i) }}
                >
                  {emote}
                </motion.button>
              );
            })}
            <p className="font-display text-fg-faint absolute top-1/2 left-1/2 w-40 -translate-x-1/2 -translate-y-1/2 text-center text-12 font-bold tracking-[var(--track-hud)] uppercase">
              {ready ? "Ctrl+E" : `${Math.ceil(remaining / 1000)}s`}
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Emotes drifting up the right edge, as spectators see them (§7). */
export function EmoteStream({ emotes }: { emotes: FloatingEmote[] }) {
  const m = useMotion();
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-40 flex w-16 flex-col items-center">
      <AnimatePresence>
        {emotes.map((e) => (
          <motion.span
            key={e.id}
            data-side={e.side}
            className="border-player absolute grid size-10 place-items-center border bg-elevated text-20"
            initial={{ opacity: 0, y: 0, scale: m.reduced ? 1 : 0.7 }}
            animate={{ opacity: 1, y: m.reduced ? 0 : -160, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={m.t({ duration: m.sec(m.dur.cine * 2), ease: m.ease.out })}
          >
            {e.emote}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}
