/* ============================================================================
   Paste profile — a post-match diagnostic, and nothing else (§11).

   NO ENFORCEMENT, NO VERDICT, NO UI. This reads the delta records already in
   the replay log and reduces them to a handful of numbers per side.

   The reason to collect it from day one is that we do not yet know what normal
   looks like. §11 wants paste detection eventually, and the only way to set a
   threshold that is not invented is to have a corpus of honest matches first.
   Judging before measuring is how you end up accusing people of cheating for
   using an editor snippet.

   What the numbers mean, and what they deliberately do not:

   · A large single insertion is the clearest signal, but it is NOT proof. A
     player who types a template from memory produces small insertions; one who
     pastes their own boilerplate produces a big one and has cheated at nothing.
   · `origin: "paste"` comes from Monaco and is a fact about the editor, not
     about intent — it fires for pasting inside the same document, which is just
     moving code around.
   · Nothing here can see WHERE text came from. That is the whole limitation and
     it is why this is a diagnostic rather than a control.
   ========================================================================= */

/** The shape of a logged `editor.delta` payload that this reads. */
export interface DeltaRecord {
  side: string;
  seq: number;
  inserted: number;
  removed: number;
  origin: string;
  changes?: { offset: number; length: number; text: string }[];
}

/** Insertions at or above this size are counted separately (§11's threshold). */
export const LARGE_INSERTION_CHARS = 100;

export interface PasteProfile {
  /** Every character inserted, however it arrived. The denominator. */
  totalInserted: number;
  /** Characters in batches Monaco reported as a paste. */
  pastedChars: number;
  /** The single biggest insertion in one change, in characters. */
  largestInsertion: number;
  /** Insertions of >= LARGE_INSERTION_CHARS, whatever their origin. */
  largeInsertions: number;
  /** Batches Monaco attributed to a paste. */
  pasteEvents: number;
  /** Delta batches in total, for context on how much editing happened. */
  batches: number;
}

const empty = (): PasteProfile => ({
  totalInserted: 0,
  pastedChars: 0,
  largestInsertion: 0,
  largeInsertions: 0,
  pasteEvents: 0,
  batches: 0,
});

/**
 * Reduce a match's delta records to one profile per side.
 *
 * Pure and order-independent, so it can run over a live stream or over a log
 * read back from disk and give the same answer either way.
 */
export function pasteProfile(records: DeltaRecord[]): Record<string, PasteProfile> {
  const out: Record<string, PasteProfile> = {};

  for (const record of records) {
    const profile = (out[record.side] ??= empty());
    profile.batches += 1;
    profile.totalInserted += record.inserted;

    if (record.origin === "paste") {
      profile.pasteEvents += 1;
      profile.pastedChars += record.inserted;
    }

    /* Per CHANGE, not per batch. A batch can hold several changes — Monaco
       emits one per cursor on a multi-cursor edit — and summing them would
       report a single large insertion where there were several small ones,
       which is exactly the false positive this is supposed to avoid. */
    const sizes = record.changes?.map((c) => c.text.length) ?? [record.inserted];
    for (const size of sizes) {
      if (size > profile.largestInsertion) profile.largestInsertion = size;
      if (size >= LARGE_INSERTION_CHARS) profile.largeInsertions += 1;
    }
  }

  return out;
}

/** One line per side, for the post-match summary and the gateway log. */
export function describeProfile(side: string, p: PasteProfile): string {
  const share = p.totalInserted === 0 ? 0 : Math.round((p.pastedChars / p.totalInserted) * 100);
  return (
    `${side}: ${p.totalInserted} chars in ${p.batches} batches · ` +
    `pasted ${p.pastedChars} (${share}%) in ${p.pasteEvents} event(s) · ` +
    `largest single insertion ${p.largestInsertion} · ` +
    `${p.largeInsertions} insertion(s) >= ${LARGE_INSERTION_CHARS}`
  );
}
