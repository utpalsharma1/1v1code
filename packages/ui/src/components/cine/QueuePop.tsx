"use client";

import { motion } from "framer-motion";
import { cn } from "../../lib/cn";
import { useMotion } from "../../lib/motion-tuning";
import type { Division, Tier } from "../../lib/types";
import { Button } from "../Button";
import { Nameplate } from "../Nameplate";

/**
 * §6.2 — the first cinematic and the dopamine moment. Budget 1.4s.
 *
 * The 60ms arrival offset between the two plates is the whole trick: it reads
 * as a collision rather than a symmetric fade. Do not make it symmetric.
 */
export interface QueuePopPlayer {
  handle: string;
  rating: number;
  tier: Tier;
  division?: Division;
  accepted: boolean;
}

export function QueuePop({
  p1,
  p2,
  head2head,
  flashKey,
  you,
  onAccept,
  acceptRemainingMs,
}: {
  p1: QueuePopPlayer;
  p2: QueuePopPlayer;
  head2head: string;
  flashKey: number;
  /** Which side the viewer is, so the accept control knows whose pip it owns. */
  you?: "p1" | "p2";
  /** Omitted on the /dev/hud playback, where there is nothing to accept. */
  onAccept?: () => void;
  acceptRemainingMs?: number;
}) {
  const m = useMotion();
  // ease.impact, not spring.heavy: the plates should *land*, not settle. An
  // expo-out curve arrives hard with no rebound, which is what a collision
  // looks like. The 60ms offset is what makes it read as a collision at all.
  const plateIn = (side: "p1" | "p2") => ({
    initial: m.reduced
      ? { opacity: 0 }
      : { opacity: 0, x: side === "p1" ? -220 : 220 },
    animate: m.reduced ? { opacity: 1 } : { opacity: 1, x: 0 },
    transition: m.reduced
      ? m.t({})
      : {
          duration: m.sec(m.dur.slow),
          ease: m.ease.impact,
          delay: m.sec(side === "p2" ? m.dur.flash : 0),
        },
  });

  return (
    <motion.div
      className="fixed inset-0 z-50 grid place-items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: m.tween(m.dur.base, m.ease.in) }}
      transition={m.tween(m.dur.fast)}
    >
      {/* 1 — screen dims to 85% ink */}
      <motion.div
        className="absolute inset-0 bg-[var(--scrim)]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={m.tween(120)}
      />

      {/* 2 — hard horizontal light sweep, 220ms, left to right */}
      {!m.reduced && (
        <motion.div
          aria-hidden
          className="absolute inset-y-0 w-1/3"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgb(255 255 255 / 0.55), transparent)",
          }}
          initial={{ x: "-120vw" }}
          animate={{ x: "220vw" }}
          transition={{ duration: m.sec(220), ease: m.ease.inOut }}
        />
      )}

      <div className="relative flex w-full max-w-5xl items-center justify-between gap-8 px-8 max-md:flex-col">
        <motion.div {...plateIn("p1")} className="flex flex-col items-start gap-3">
          <Nameplate
            side="p1"
            handle={p1.handle}
            rating={p1.rating}
            tier={p1.tier}
            division={p1.division}
            state="active"
            size="lg"
            flashKey={flashKey}
          />
          <Meta delay={0} accepted={p1.accepted} side="p1" text={head2head} />
        </motion.div>

        {/* 5 — VS scales 1.6 → 1.0 with overshoot, both glows bleeding behind */}
        <motion.div
          className="relative grid place-items-center"
          initial={m.reduced ? { opacity: 0 } : { opacity: 0, scale: 1.6 }}
          animate={m.reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
          transition={m.reduced ? m.t({}) : m.spring.impact}
        >
          <span
            aria-hidden
            className="absolute size-40 blur-2xl"
            style={{
              background:
                "linear-gradient(90deg, var(--p1-glow), transparent 45%, transparent 55%, var(--p2-glow))",
            }}
          />
          <span className="font-display text-fg relative text-48 font-extrabold tracking-[var(--track-display)]">
            VS
          </span>
        </motion.div>

        <motion.div {...plateIn("p2")} className="flex flex-col items-end gap-3">
          <Nameplate
            side="p2"
            handle={p2.handle}
            rating={p2.rating}
            tier={p2.tier}
            division={p2.division}
            state="active"
            size="lg"
            flashKey={flashKey}
          />
          <Meta delay={1} accepted={p2.accepted} side="p2" text={head2head} />
        </motion.div>
      </div>

      {onAccept && you && (
        <AcceptControl
          you={you}
          accepted={you === "p1" ? p1.accepted : p2.accepted}
          onAccept={onAccept}
          remainingMs={acceptRemainingMs}
        />
      )}
    </motion.div>
  );
}

/* The accept control lives INSIDE the cinematic, and that is load-bearing.

   This overlay is `fixed inset-0 z-50`, so any accept button rendered by the
   page behind it is covered and unclickable. That is not hypothetical: it is
   why the first real two-browser match died — both players watched the plates
   collide, neither could accept, and the window timed out at 12s. §6.2 puts the
   accept pips here anyway, so the control belongs here with them. */
function AcceptControl({
  you,
  accepted,
  onAccept,
  remainingMs,
}: {
  you: "p1" | "p2";
  accepted: boolean;
  onAccept: () => void;
  remainingMs?: number;
}) {
  const m = useMotion();
  const seconds = remainingMs === undefined ? null : Math.max(0, Math.ceil(remainingMs / 1000));

  return (
    <motion.div
      data-side={you}
      className="absolute inset-x-0 bottom-[12%] flex flex-col items-center gap-3"
      initial={m.reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
      animate={m.reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={
        m.reduced ? m.t({}) : { duration: m.sec(m.dur.base), ease: m.ease.out, delay: m.stagger(6) }
      }
    >
      {accepted ? (
        <p className="font-display text-fg-dim text-13 font-bold tracking-[var(--track-hud)] uppercase">
          Waiting for opponent
        </p>
      ) : (
        <Button variant="solid" tone="player" size="lg" side={you} onClick={onAccept} autoFocus>
          Accept
        </Button>
      )}
      {seconds !== null && (
        <p className="tabular text-fg-faint text-12">
          {accepted ? "they have" : "you have"} {seconds}s
        </p>
      )}
    </motion.div>
  );
}

/** Ratings / H2H / accept pip, faded up beneath each plate, staggered 40ms. */
function Meta({
  delay,
  accepted,
  side,
  text,
}: {
  delay: number;
  accepted: boolean;
  side: "p1" | "p2";
  text: string;
}) {
  const m = useMotion();
  return (
    <motion.div
      data-side={side}
      className={cn("flex items-center gap-3", side === "p2" && "flex-row-reverse")}
      initial={m.reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={m.reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={
        m.reduced
          ? m.t({})
          : { duration: m.sec(m.dur.base), ease: m.ease.out, delay: m.stagger(delay + 4) }
      }
    >
      {/* Accept pip — watching the other one fill is free drama (§6.2). */}
      <span className="border-line relative h-1.5 w-16 overflow-hidden border">
        <motion.span
          className="bg-player absolute inset-0 origin-left"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: accepted ? 1 : 0 }}
          transition={m.t({ duration: m.sec(m.dur.cine), ease: m.ease.out })}
        />
      </span>
      <span className="text-fg-faint text-12">{text}</span>
    </motion.div>
  );
}
