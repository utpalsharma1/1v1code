"use client";

/* ============================================================================
   §9's cues, driven by the real match rather than by a dev button.

   THE MATCH SCREEN HAD NO SOUND AT ALL until now. The placeholder tones were
   wired only into `/dev/hud`, which is exactly what §12 Phase 1 intended — that
   route exists to tune the feel — but it meant every cue in the product fired
   in a simulator and none of them had ever fired on a real match.

   WHOSE TESTS MAKE A SOUND: yours, and only yours.

   §6.4 puts both test bars on screen, so firing a tick for the opponent's cells
   too is the obvious reading — and it is wrong. §9's tick rises in pitch with
   each consecutive pass, and two interleaved ladders is not two runs, it is
   noise with no run in it at all. Your own ladder is the thing worth hearing.

   The opponent is not silent, though: §6.5 gives them the compile pulse and the
   clutch sub-bass, which are exactly the "feeling the opponent" signals that
   section is about. That division is §6.5's, not an economy — you hear THAT
   they are moving and how close they are, never their individual passes.

   NOTHING HERE IS THE ONLY CHANNEL. Every cue below accompanies a visual state
   change that stands on its own: cells fill and flash, the pulse line moves,
   the clutch edge breathes, the verdict panel drops. Sound is a second reading
   of a state the screen already shows.
   ========================================================================= */

import { useEffect, useRef } from "react";
import { sound, type CellState, type Side } from "@1v1/ui";

/** §6.5: the opponent crossing this fraction of their tests is clutch. */
const CLUTCH_AT = 0.8;

interface MatchSoundInput {
  you: Side;
  opponent: Side;
  cells: { p1: CellState[]; p2: CellState[] };
  compileKeys: { p1: number; p2: number };
  opponentProgress: number;
  inFlight: boolean;
  ending: { kind: string; winner?: Side; ratings: { side: Side; ladder?: unknown }[] } | null;
}

export function useMatchSound({
  you,
  opponent,
  cells,
  compileKeys,
  opponentProgress,
  inFlight,
  ending,
}: MatchSoundInput): void {
  /* --- Your cells resolving (§6.6's sequential reveal) ------------------
     Compared against the previous render rather than driven by an event,
     because `cells` is owned by the page so that a resync can replace it
     wholesale — and a resync must not replay forty ticks. Only a cell that
     moved from unresolved to resolved makes a sound, so a wholesale
     replacement that lands already-passed cells is silent, which is correct:
     nothing just happened, we merely learned about it. */
  const previous = useRef<CellState[]>([]);
  useEffect(() => {
    const now = cells[you];
    const before = previous.current;
    /* A shorter array means a new submission reset the bar; treat it as a
       fresh start rather than diffing against a stale longer one. */
    const base = before.length === now.length ? before : [];
    for (let i = 0; i < now.length; i++) {
      const was = base[i];
      const is = now[i];
      if (was === is) continue;
      if (is === "pass") sound.play("test_pass");
      else if (is === "fail") sound.play("test_fail");
    }
    previous.current = [...now];
  }, [cells, you]);

  /* --- The opponent compiling (§6.5's compile pulse) ------------------- */
  const lastCompile = useRef(compileKeys[opponent]);
  useEffect(() => {
    const key = compileKeys[opponent];
    if (key !== lastCompile.current) {
      lastCompile.current = key;
      sound.play("compile");
    }
  }, [compileKeys, opponent]);

  /* --- Clutch (§6.5) ---------------------------------------------------
     A loop that encodes live state, per §5: it runs while the fact is true and
     stops the instant it is not. Nothing here decays or lingers. */
  useEffect(() => {
    if (ending) {
      sound.stopLoop("clutch_ambient");
      return;
    }
    if (opponentProgress >= CLUTCH_AT) sound.startLoop("clutch_ambient");
    else sound.stopLoop("clutch_ambient");
  }, [opponentProgress, ending]);

  /* --- Your submission leaving (§6.6 step 1) --------------------------- */
  const wasInFlight = useRef(false);
  useEffect(() => {
    if (inFlight && !wasInFlight.current) sound.play("submit");
    wasInFlight.current = inFlight;
  }, [inFlight]);

  /* --- §6.7 ------------------------------------------------------------
     The rank-up chord is delayed to land with the badge assembling rather than
     stacking on the victory sting's attack — §6.7 chains the two cinematics,
     and two stings on the same frame is one muddy noise instead of two events. */
  const ended = useRef(false);
  useEffect(() => {
    if (!ending || ended.current) return;
    ended.current = true;
    sound.stopLoop("clutch_ambient");
    if (ending.kind !== "WIN") return;
    const won = ending.winner === you;
    sound.play(won ? "victory" : "defeat");
    const ladder = ending.ratings.find((r) => r.side === you)?.ladder;
    if (won && ladder) {
      const id = window.setTimeout(() => sound.play("rank_up"), 1200);
      return () => window.clearTimeout(id);
    }
    return;
  }, [ending, you]);

  /* Leaving the match screen stops everything. A victory sting playing over the
     Hub, or a clutch loop surviving a navigation, is the sound of a bug. */
  useEffect(() => () => sound.stopAll(), []);
}
