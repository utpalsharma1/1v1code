/* ============================================================================
   1v1.code — motion system
   No component invents its own timing. Import from here or don't animate.
   Spec: CLAUDE.md §5.
   ========================================================================= */

import type { Transition } from "framer-motion";

type Cubic = [number, number, number, number];

/** Durations in milliseconds. */
export const dur = {
  instant: 90,
  fast: 160,
  base: 240,
  slow: 420,
  cine: 900,

  /* ADDITIONS beyond §5, per rule §13.2. §6 states these two literally and
     neither is expressible on the scale above:
       flash — the 60ms white plate flash on nameplate arrival (§6.2 step 3)
       decay — the 200ms decay on a passing cell's white overlay, the nameplate
               border flare, and the near-miss red flash (§6.4, §6.5) */
  flash: 60,
  decay: 200,
} as const;

export const ease: Record<"out" | "inOut" | "snap", Cubic> = {
  out: [0.22, 1, 0.36, 1], // default for entrances
  inOut: [0.65, 0, 0.35, 1], // for moves/transforms
  snap: [0.34, 1.56, 0.64, 1], // slight overshoot — buttons, badges, pops
};

export const spring = {
  ui: { type: "spring", stiffness: 420, damping: 32, mass: 0.7 },
  bar: { type: "spring", stiffness: 180, damping: 22 }, // health/test bars
  heavy: { type: "spring", stiffness: 120, damping: 18 }, // big cinematic panels
} satisfies Record<string, Transition>;

/* ── Helpers ─────────────────────────────────────────────────────────────
   Framer Motion counts in seconds, CSS counts in milliseconds, and the spec
   is written in milliseconds. Convert here, once, so nobody divides by 1000
   in a component and quietly gets it wrong. */

/** ms → s, for handing a spec duration to Framer Motion. */
export const sec = (ms: number): number => ms / 1000;

/** A tween transition from a spec duration. Defaults to the entrance ease. */
export const tween = (ms: number, curve: Cubic = ease.out): Transition => ({
  duration: sec(ms),
  ease: curve,
});

/* ── Staggering (§5) ─────────────────────────────────────────────────────
   40ms between children, capped at 8. Past the cap the delay stops growing,
   so a long list fades as a group instead of trickling in for two seconds. */
export const STAGGER_STEP = 40;
export const STAGGER_CAP = 8;

export const stagger = (index: number): number =>
  sec(Math.min(index, STAGGER_CAP) * STAGGER_STEP);

/* ── Interactive states (§5) ─────────────────────────────────────────────
   Every interactive element has three visible states. These are the only
   values any of them may use. */
export const interactive = {
  rest: { scale: 1 },
  hover: { scale: 1.02 },
  press: { scale: 0.97 },
} as const;

export const interactiveTransition = {
  hover: tween(dur.fast, ease.out),
  press: tween(dur.instant, ease.snap),
} as const;

/* ── Reduced motion (§5) ─────────────────────────────────────────────────
   "Replace all movement with 120ms opacity fades." That number is not in the
   §5 duration scale and cannot be derived from it, so it is named here rather
   than typed inline in a dozen components. */
export const REDUCED_MS = 120;
export const reducedTransition: Transition = { duration: sec(REDUCED_MS), ease: "linear" };

/**
 * Resolve a transition against the user's motion preference.
 * Pair with `motionSafe` below, which strips the movement from the target.
 */
export const transitionFor = (reduced: boolean, t: Transition): Transition =>
  reduced ? reducedTransition : t;

/**
 * Strip every movement property from an animation target, leaving opacity and
 * color to carry the state change. Use for entrances and one-shot cinematics
 * so a reduced-motion user still sees *that* something happened.
 */
export function motionSafe<T extends Record<string, unknown>>(
  reduced: boolean,
  target: T,
): Partial<T> {
  if (!reduced) return target;
  const moving = new Set([
    "x",
    "y",
    "z",
    "scale",
    "scaleX",
    "scaleY",
    "rotate",
    "rotateX",
    "rotateY",
    "skew",
    "skewX",
    "skewY",
    "filter",
  ]);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(target)) {
    if (!moving.has(key)) out[key] = value;
  }
  return out as Partial<T>;
}

/* ── Named motions used by more than one primitive ───────────────────── */

/** The 2px horizontal shake on a failing test cell (§6.4). */
export const shakeX = [0, -2, 2, -2, 0];

/** Screen shake amplitudes, in px. Queue pop is 3, submit-pass is 5 (§6.2, §6.6). */
export const shake = { light: 3, hard: 5 } as const;
