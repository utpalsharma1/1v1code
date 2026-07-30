"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, cn } from "@1v1/ui";
import { formatCode, normaliseCode } from "@1v1/core/codes";

/* ============================================================================
   /watch — type a code.

   `/watch/<code>` stays the one-click path, because a direct link is what gets
   pasted into Discord. This is the other half: the code is ten characters
   precisely so it reads as two spoken groups of five, which only pays off if
   there is somewhere to type it.

   THE INPUT FORGIVES WHAT A SPEAKER GETS WRONG. `normaliseCode` applies
   Crockford's own decoding rules — uppercase, strip spaces and hyphens, O reads
   as 0, I and L read as 1, U reads as V. Those five characters are excluded
   from the alphabet exactly because people confuse them, so mapping them to
   what the speaker meant is the whole point of choosing Crockford. Someone
   reading a code down a phone should not be punished for saying "oh".
   ========================================================================= */

export default function WatchEntryPage() {
  const router = useRouter();
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);

  const normalised = normaliseCode(raw);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!normalised) {
      /* The SAME message for malformed, unknown and stale — see the gateway.
         Distinguishing them here would rebuild the oracle the code space
         exists to deny. (A *finished* match is different, and the watch page
         says so, because that code grants access anyway.) */
      setError("That code doesn't match a live game. Check it and try again.");
      return;
    }
    router.push(`/watch/${normalised}`);
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-6 py-16">
      <div>
        <p className="font-display text-fg-faint text-12 font-bold tracking-[var(--track-hud)] uppercase">
          spectate
        </p>
        <h1 className="font-display text-fg mt-2 text-34 leading-none font-extrabold tracking-[var(--track-display)] uppercase">
          Watch a match
        </h1>
        <p className="text-fg-dim mt-3 text-13 leading-relaxed">
          Enter the ten-character code from a player&apos;s screen. No account needed.
        </p>
      </div>

      <Card>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="font-display text-fg-dim text-12 font-bold tracking-[var(--track-hud)] uppercase">
              Match code
            </span>
            <input
              value={raw}
              onChange={(e) => {
                setRaw(e.target.value);
                setError(null);
              }}
              placeholder="0HENN5BPHX"
              autoFocus
              spellCheck={false}
              autoCapitalize="characters"
              autoComplete="off"
              className={cn(
                "focus-ring border-line text-fg tabular border bg-elevated px-3 py-3",
                "text-20 tracking-[0.18em] uppercase",
              )}
            />
            {/* Echo the accepted form back, so the forgiveness is visible
                rather than silent — someone who typed O sees it became 0. */}
            <span className="tabular text-fg-faint text-12">
              {raw.trim() === ""
                ? "Lowercase, spaces and hyphens are fine."
                : normalised
                  ? `Reading as ${formatCode(normalised)}`
                  : `${normaliseCode(raw + "0".repeat(10)) ? "" : ""}Ten characters needed`}
            </span>
          </label>

          {error && (
            <p className="text-fail text-13" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" variant="solid" tone="player" full disabled={!normalised}>
            Watch
          </Button>
        </form>
      </Card>

      <p className="text-fg-faint text-12">
        <a href="/" className="underline underline-offset-2">
          Back to 1v1.code
        </a>
      </p>
    </main>
  );
}
