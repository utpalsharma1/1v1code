/* The one place a phase label may exist.

   The landing page sat on "Phase 0 · Foundation — nothing is playable yet" for
   three phases, and /play said "Phase 2B-2 · gateway" while 2B-4 was being
   built. Both were found by eye, which is the failure mode this project keeps
   paying for. A hardcoded phase string is stale the moment the phase advances,
   and nothing reports it.

   So there is exactly one constant, and `phase-labels.test.ts` fails if any
   other source file hardcodes one. Advancing a phase is a single edit here. */

export const CURRENT_PHASE = {
  /** Matches the phase headings in CLAUDE.md §12. */
  id: "2B-4",
  /** Short label for the eyebrow line above a heading. */
  label: "Phase 2B-4 · the match",
  /** One sentence: what a visitor can actually do right now. */
  summary:
    "Register, queue, and play a real match: Monaco, the real judge, verdicts streaming one test at a time, and a rating that moves.",
} as const;
