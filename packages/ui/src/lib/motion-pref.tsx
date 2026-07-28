"use client";

/* ============================================================================
   Motion preference (§5)
   Two inputs, one answer: the OS `prefers-reduced-motion` setting and a manual
   in-app toggle, because some users are on a weak laptop rather than a
   vestibular disorder and the OS knows nothing about that.

   The resolved answer is mirrored onto <html data-motion> so CSS-driven motion
   (ambient loops) can respond without a re-render.
   ========================================================================= */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/** `auto` follows the OS. `full` and `reduced` override it in either direction. */
export type MotionPref = "auto" | "full" | "reduced";

const STORAGE_KEY = "1v1.motion";
const QUERY = "(prefers-reduced-motion: reduce)";

interface MotionPrefValue {
  pref: MotionPref;
  setPref: (next: MotionPref) => void;
  /** The resolved answer. This is what components branch on. */
  reduced: boolean;
}

const MotionPrefContext = createContext<MotionPrefValue>({
  pref: "auto",
  setPref: () => {},
  reduced: false,
});

export function MotionPrefProvider({ children }: { children: ReactNode }) {
  // Both start at their SSR-safe defaults so hydration matches, then sync in
  // an effect. The inline script in the document head sets data-motion before
  // first paint, so CSS never flashes even though React starts at `false`.
  const [pref, setPrefState] = useState<MotionPref>("auto");
  const [systemReduced, setSystemReduced] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "full" || stored === "reduced" || stored === "auto") {
      setPrefState(stored);
    }
    const mq = window.matchMedia(QUERY);
    setSystemReduced(mq.matches);
    const onChange = (event: MediaQueryListEvent) => setSystemReduced(event.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const reduced = pref === "auto" ? systemReduced : pref === "reduced";

  useEffect(() => {
    document.documentElement.dataset["motion"] = reduced ? "reduced" : "full";
  }, [reduced]);

  const setPref = useCallback((next: MotionPref) => {
    setPrefState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const value = useMemo<MotionPrefValue>(
    () => ({ pref, setPref, reduced }),
    [pref, setPref, reduced],
  );

  return <MotionPrefContext.Provider value={value}>{children}</MotionPrefContext.Provider>;
}

export function useMotionPref(): MotionPrefValue {
  return useContext(MotionPrefContext);
}

/** Shorthand for the common case: "should I move things?" */
export function useReducedMotion(): boolean {
  return useContext(MotionPrefContext).reduced;
}

/**
 * Runs before first paint to stamp <html data-motion> from localStorage or the
 * media query, so ambient CSS animations never start and then stop.
 */
export const motionPrefBootstrapScript = `(function(){try{var p=localStorage.getItem(${JSON.stringify(
  STORAGE_KEY,
)});var r=p==='reduced'||(p!=='full'&&matchMedia(${JSON.stringify(
  QUERY,
)}).matches);document.documentElement.dataset.motion=r?'reduced':'full';}catch(e){}})();`;
