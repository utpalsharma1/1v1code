/* ============================================================================
   1v1.code — motion system
   No component invents its own timing. Import from here or don't animate.
   Spec: CLAUDE.md §5.

   These values are considered proposals, not measured findings. The tuning
   surface at /dev/hud edits every one of them live and exports the result, so
   they can be checked against real pixels later.
   ========================================================================= */

import type { Transition } from "framer-motion";

export type Cubic = [number, number, number, number];

/** Durations in milliseconds. */
export const dur = {
  instant: 90,
  fast: 160,
  base: 240,
  slow: 420,
  cine: 900,

  /* §6 states these two literally and neither fits the scale above. */
  flash: 60, // the white plate flash on nameplate arrival (§6.2)
  decay: 200, // white-overlay decay, border flare, near-miss flash (§6.4, §6.5)

  /* Beat structure. Tension lives in the pause before a reveal, not in the
     reveal — a cinematic that starts the instant you press the button has
     nowhere to build from. */
  beat: 140, // held stillness before a big moment
  reveal: 165, // per-test cadence in the §6.6 sequential reveal
  breathe: 2400, // clutch-edge cycle (§6.5)
  victory: 2800, // mandatory portion of the victory cinematic (§6.7)
  defeat: 1600, // deliberately shorter — losing stings once and gets out of the way
  skip: 700, // after this, any input skips the remainder of a cinematic
} as const;

export const ease: Record<"out" | "in" | "inOut" | "snap" | "impact", Cubic> = {
  out: [0.22, 1, 0.36, 1], // default for entrances
  in: [0.55, 0, 1, 0.45], // exits accelerate away instead of drifting off
  inOut: [0.65, 0, 0.35, 1], // for moves/transforms
  snap: [0.34, 1.56, 0.64, 1], // slight overshoot — buttons, badges, pops
  impact: [0.16, 1, 0.3, 1], // expo-out: arrives hard, lands rather than settles
};

export const spring = {
  ui: { type: "spring", stiffness: 420, damping: 32, mass: 0.7 }, // ζ 0.93
  bar: { type: "spring", stiffness: 200, damping: 26, mass: 1 }, // ζ 0.92 — must read accurate
  heavy: { type: "spring", stiffness: 130, damping: 22, mass: 1.15 }, // ζ 0.90 — weight, not bounce
  impact: { type: "spring", stiffness: 600, damping: 30, mass: 1.1 }, // ζ 0.58 — pops hard
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

/* ── Reduced motion (§5) ─────────────────────────────────────────────────
   "Replace all movement with 120ms opacity fades." That number is not on the
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

/**
 * Screen shake (§6.2, §6.6).
 *
 * Amplitude decays across the oscillation. Constant amplitude reads as a rumble
 * or as a rendering glitch; decaying amplitude reads as an impact, because that
 * is what a real impulse does.
 */
export const shake = { light: 3, hard: 5, cycles: 3, decay: 0.62 } as const;

/** Alternating, decaying keyframes: amplitude × decay^n over `cycles`. */
export function shakeFrames(amplitude: number, cycles: number, decay: number): number[] {
  const swings = Math.max(1, Math.round(cycles * 2));
  const frames: number[] = [0];
  for (let i = 0; i < swings; i++) {
    frames.push((i % 2 === 0 ? 1 : -1) * amplitude * decay ** i);
  }
  frames.push(0);
  return frames;
}
