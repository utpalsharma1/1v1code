"use client";

/* ============================================================================
   §9's master control: one toggle, plus a volume slider.

   IT IS FIXED AND ALWAYS PRESENT, including during a match, because the moment
   somebody wants to mute is the moment something is loud — and on the match
   screen §7's rail is hidden, so a control that lived only in the rail would be
   unreachable exactly then.

   It sits BELOW the cinematic overlays in the stacking order on purpose. A
   victory takeover is three seconds and owns the screen; a mute button
   floating over it would be the one piece of chrome that ignores §6.7's
   "the only place in the product with a full-screen takeover".

   The label is a word, not only an icon. "SOUND ON" / "SOUND OFF" is legible to
   a screen reader and to somebody who has never seen a speaker glyph with a
   line through it, and it is two characters wider.
   ========================================================================= */

import { useEffect, useRef, useState } from "react";
import { useSoundPref } from "../lib/sound-pref";

export function SoundToggle() {
  const { muted, volume, setMuted, setVolume } = useSoundPref();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div ref={box} className="fixed bottom-3 right-3 z-30 flex items-center gap-2">
      {open && (
        <label className="border-line clip-corner flex items-center gap-2 border bg-elevated px-3 py-2">
          <span className="font-display text-fg-faint text-[9px] font-bold tracking-[var(--track-hud)] uppercase">
            Vol
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(volume * 100)}
            aria-label="Volume"
            onChange={(event) => setVolume(Number(event.target.value) / 100)}
            className="accent-p1 focus-ring h-1 w-24"
          />
          <span className="text-fg-faint w-7 text-right text-11 tabular">
            {Math.round(volume * 100)}
          </span>
        </label>
      )}

      <button
        type="button"
        aria-pressed={!muted}
        title={muted ? "Sound off — click to unmute" : "Sound on — click to mute"}
        onClick={(event) => {
          /* Shift-click, or a click on the already-unmuted button, opens the
             slider rather than muting — but plain click must stay one action,
             so the slider is opened by the caret and mute by the label. */
          if (event.shiftKey) {
            setOpen((v) => !v);
            return;
          }
          setMuted(!muted);
        }}
        className={`focus-ring border-line hover:border-line-hot clip-corner flex items-center gap-1.5 border bg-surface/80 px-2.5 py-1.5 backdrop-blur-sm transition-colors duration-[160ms] ${
          muted ? "text-fg-faint" : "text-fg-dim"
        }`}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true" className="h-[14px] w-[14px]">
          <path d="M4 8h3l4-3.5v11L7 12H4z" fill="currentColor" />
          {muted ? (
            <path
              d="M13 8l4 4M17 8l-4 4"
              stroke="currentColor"
              strokeWidth="1.6"
              fill="none"
              strokeLinecap="round"
            />
          ) : (
            <path
              d="M13.4 7.2a4 4 0 0 1 0 5.6M15.6 5.2a7 7 0 0 1 0 9.6"
              stroke="currentColor"
              strokeWidth="1.4"
              fill="none"
              strokeLinecap="round"
            />
          )}
        </svg>
        <span className="font-display text-[9px] font-bold tracking-[var(--track-hud)] uppercase">
          {muted ? "Off" : "On"}
        </span>
      </button>

      <button
        type="button"
        aria-label={open ? "Hide volume" : "Show volume"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="focus-ring border-line hover:border-line-hot text-fg-faint clip-corner border bg-surface/80 px-1.5 py-1.5 backdrop-blur-sm transition-colors duration-[160ms]"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true" className="h-[14px] w-[14px]">
          <path d={open ? "M6 12l4-4 4 4" : "M6 8l4 4 4-4"} stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
