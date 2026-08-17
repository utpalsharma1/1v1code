"use client";

/* ============================================================================
   Sound preference (§9) — on by default, one toggle turns it off.

   THREE JOBS, and they are separated because two of them are easy to get wrong
   together:

     1. Restore the stored preference BEFORE anything can play, so a muted
        player never hears one cue on load before the setting is read.
     2. Prime the buffer pool on mount. This needs no user gesture and is why
        §6.2's queue pop — usually the first sound of a session — is not the one
        that pays for the load.
     3. Unlock the audio context on the first real gesture, which browsers do
        require. That is a different event from the pool being ready, and
        conflating them is what makes the first sound of a session silent.

   §5's reduced-motion rule does NOT mute sound, and that is deliberate.
   `prefers-reduced-motion` is about vestibular symptoms and weak hardware, not
   about audio, and a player who has turned motion down still needs the match to
   be legible — §5 says a reduced-motion state change stays legible "through
   colour and text alone", which is a floor, not a ceiling. Muting them as well
   would take away a channel they did not ask to lose.
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
import { sound } from "./sound";

interface SoundPrefValue {
  muted: boolean;
  volume: number;
  setMuted: (next: boolean) => void;
  setVolume: (next: number) => void;
  /** True once every cue is rendered into the pool. */
  ready: boolean;
}

const SoundPrefContext = createContext<SoundPrefValue>({
  muted: false,
  volume: 0.5,
  setMuted: () => {},
  setVolume: () => {},
  ready: false,
});

export function SoundPrefProvider({ children }: { children: ReactNode }) {
  /* Both start at the SSR default so hydration matches, then sync in an effect
     — the same shape as MotionPrefProvider. Unlike motion there is nothing to
     stamp before first paint, because sound cannot fire before a gesture. */
  const [muted, setMutedState] = useState(false);
  const [volume, setVolumeState] = useState(0.5);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const prefs = sound.loadPrefs();
    setMutedState(prefs.muted);
    setVolumeState(prefs.volume);
    void sound.prime().then(() => setReady(true));
  }, []);

  useEffect(() => {
    /* One-shot: browsers hold the context suspended until a gesture, and any
       gesture will do. `once` on all three so this costs nothing after the
       first click. */
    const unlock = () => sound.unlock();
    const opts = { once: true, passive: true } as const;
    window.addEventListener("pointerdown", unlock, opts);
    window.addEventListener("keydown", unlock, opts);
    window.addEventListener("touchstart", unlock, opts);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("touchstart", unlock);
    };
  }, []);

  const setMuted = useCallback((next: boolean) => {
    setMutedState(next);
    sound.setMuted(next);
  }, []);

  const setVolume = useCallback((next: number) => {
    setVolumeState(next);
    sound.setVolume(next);
  }, []);

  const value = useMemo<SoundPrefValue>(
    () => ({ muted, volume, setMuted, setVolume, ready }),
    [muted, volume, setMuted, setVolume, ready],
  );

  return <SoundPrefContext.Provider value={value}>{children}</SoundPrefContext.Provider>;
}

export function useSoundPref(): SoundPrefValue {
  return useContext(SoundPrefContext);
}
