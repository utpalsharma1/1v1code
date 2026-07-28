"use client";

/* ============================================================================
   Live motion tuning (§5, Phase 1)

   motion.ts stays the single source of truth for the *defaults*. This layer
   lets /dev/hud override them at runtime so timings can be tuned by feel, then
   exported back into motion.ts as code. No component invents its own timing —
   they read from here, and here reads from motion.ts.

   Without a provider every consumer gets the motion.ts values unchanged, so
   /dev/kitchen-sink and every product surface behave exactly as before.
   ========================================================================= */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Transition } from "framer-motion";
import {
  dur as DEFAULT_DUR,
  ease as DEFAULT_EASE,
  spring as DEFAULT_SPRING,
  REDUCED_MS,
  sec,
  shake as DEFAULT_SHAKE,
  shakeFrames,
  STAGGER_CAP,
  STAGGER_STEP,
  type Cubic,
} from "../../motion";
import { useReducedMotion } from "./motion-pref";

export type { Cubic };
export type DurKey = keyof typeof DEFAULT_DUR;
export type EaseKey = keyof typeof DEFAULT_EASE;
export type SpringKey = keyof typeof DEFAULT_SPRING;

export interface SpringValue {
  stiffness: number;
  damping: number;
  mass?: number;
}

export interface MotionValues {
  dur: Record<DurKey, number>;
  ease: Record<EaseKey, Cubic>;
  spring: Record<SpringKey, SpringValue>;
  staggerStep: number;
  staggerCap: number;
  shake: { light: number; hard: number; cycles: number; decay: number };
}

export const DEFAULT_VALUES: MotionValues = {
  dur: { ...DEFAULT_DUR },
  ease: {
    out: [...DEFAULT_EASE.out] as Cubic,
    in: [...DEFAULT_EASE.in] as Cubic,
    inOut: [...DEFAULT_EASE.inOut] as Cubic,
    snap: [...DEFAULT_EASE.snap] as Cubic,
    impact: [...DEFAULT_EASE.impact] as Cubic,
  },
  spring: {
    ui: { ...DEFAULT_SPRING.ui },
    bar: { ...DEFAULT_SPRING.bar },
    heavy: { ...DEFAULT_SPRING.heavy },
    impact: { ...DEFAULT_SPRING.impact },
  },
  staggerStep: STAGGER_STEP,
  staggerCap: STAGGER_CAP,
  shake: { ...DEFAULT_SHAKE },
};

interface TuningContext {
  values: MotionValues;
  speed: number;
  setValues: (next: MotionValues) => void;
  setSpeed: (next: number) => void;
  reset: () => void;
}

const Ctx = createContext<TuningContext>({
  values: DEFAULT_VALUES,
  speed: 1,
  setValues: () => {},
  setSpeed: () => {},
  reset: () => {},
});

export function MotionTuningProvider({ children }: { children: ReactNode }) {
  const [values, setValues] = useState<MotionValues>(() => structuredClone(DEFAULT_VALUES));
  const [speed, setSpeed] = useState(1);
  const reset = useCallback(() => {
    setValues(structuredClone(DEFAULT_VALUES));
    setSpeed(1);
  }, []);
  const value = useMemo(
    () => ({ values, speed, setValues, setSpeed, reset }),
    [values, speed, reset],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The tuning controls themselves need the raw, unscaled values. */
export function useMotionTuning(): TuningContext {
  return useContext(Ctx);
}

export interface Motion {
  dur: Record<DurKey, number>;
  ease: Record<EaseKey, Cubic>;
  spring: Record<SpringKey, Transition>;
  shake: { light: number; hard: number; cycles: number; decay: number };
  /** Decaying alternating keyframes for a screen shake of the given amplitude. */
  shakeFrames: (amplitude: number) => number[];
  /** Seconds of delay for the nth staggered child, capped per §5. */
  stagger: (index: number) => number;
  /** A tween from a duration in ms. */
  tween: (ms: number, curve?: Cubic) => Transition;
  /** ms → s, already speed-scaled. */
  sec: (ms: number) => number;
  /** Collapses a transition to a 120ms fade when the user wants less motion. */
  t: (transition: Transition) => Transition;
  reduced: boolean;
  speed: number;
}

/**
 * The hook every animating component uses.
 *
 * Speed scaling is done properly rather than by multiplying durations alone:
 * stretching time by T means a spring's natural frequency ω=√(k/m) must fall by
 * T, so stiffness scales with speed² while damping scales with speed, which
 * holds the damping ratio ζ=c/2√(km) constant. Scaling stiffness alone would
 * change the bounce as well as the tempo, and you would be tuning two things at
 * once without knowing it.
 */
export function useMotion(): Motion {
  const { values, speed } = useMotionTuning();
  const reduced = useReducedMotion();

  return useMemo<Motion>(() => {
    const scale = 1 / speed;
    const dur = Object.fromEntries(
      Object.entries(values.dur).map(([k, v]) => [k, v * scale]),
    ) as Record<DurKey, number>;

    const spring = Object.fromEntries(
      Object.entries(values.spring).map(([k, v]) => [
        k,
        {
          type: "spring" as const,
          stiffness: v.stiffness * speed * speed,
          damping: v.damping * speed,
          ...(v.mass === undefined ? {} : { mass: v.mass }),
        },
      ]),
    ) as Record<SpringKey, Transition>;

    const s = (ms: number) => ms / 1000;
    const tween = (ms: number, curve: Cubic = values.ease.out): Transition => ({
      duration: s(ms),
      ease: curve,
    });

    return {
      dur,
      ease: values.ease,
      spring,
      shake: values.shake,
      shakeFrames: (amplitude: number) =>
        shakeFrames(amplitude, values.shake.cycles, values.shake.decay),
      stagger: (index: number) =>
        s(Math.min(index, values.staggerCap) * values.staggerStep * scale),
      tween,
      sec: s,
      t: (transition: Transition) =>
        reduced ? { duration: s(REDUCED_MS * scale), ease: "linear" } : transition,
      reduced,
      speed,
    };
  }, [values, speed, reduced]);
}

/** Serialise the tuned values back into a motion.ts body, ready to paste. */
export function toMotionSource(values: MotionValues): string {
  const cubic = (c: Cubic) => `[${c.map((n) => Number(n.toFixed(3))).join(", ")}]`;
  const sp = (v: SpringValue) =>
    `{ type: 'spring', stiffness: ${Math.round(v.stiffness)}, damping: ${Math.round(
      v.damping,
    )}${v.mass === undefined ? "" : `, mass: ${Number(v.mass.toFixed(2))}` } }`;

  const d = (k: DurKey) => Math.round(values.dur[k]);

  return `export const dur = {
  instant: ${d("instant")},
  fast:    ${d("fast")},
  base:    ${d("base")},
  slow:    ${d("slow")},
  cine:    ${d("cine")},

  flash:   ${d("flash")},
  decay:   ${d("decay")},

  beat:    ${d("beat")},
  reveal:  ${d("reveal")},
  breathe: ${d("breathe")},
  victory: ${d("victory")},
  defeat:  ${d("defeat")},
  skip:    ${d("skip")},
} as const;

export const ease: Record<'out' | 'in' | 'inOut' | 'snap' | 'impact', Cubic> = {
  out:    ${cubic(values.ease.out)},
  in:     ${cubic(values.ease.in)},
  inOut:  ${cubic(values.ease.inOut)},
  snap:   ${cubic(values.ease.snap)},
  impact: ${cubic(values.ease.impact)},
};

export const spring = {
  ui:     ${sp(values.spring.ui)},
  bar:    ${sp(values.spring.bar)},
  heavy:  ${sp(values.spring.heavy)},
  impact: ${sp(values.spring.impact)},
} satisfies Record<string, Transition>;

export const STAGGER_STEP = ${Math.round(values.staggerStep)};
export const STAGGER_CAP  = ${Math.round(values.staggerCap)};

export const shake = { light: ${Number(values.shake.light.toFixed(1))}, hard: ${Number(
    values.shake.hard.toFixed(1),
  )}, cycles: ${Math.round(values.shake.cycles)}, decay: ${Number(
    values.shake.decay.toFixed(2),
  )} } as const;`;
}

export { sec };
