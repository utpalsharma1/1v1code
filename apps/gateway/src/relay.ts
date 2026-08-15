import type { EditorChange, EditorDelta, EditorOrigin, Side } from "@1v1/proto";

/* ============================================================================
   The keystroke relay (§10, 2C-1)

   THE VISIBILITY RULE IS ENFORCED HERE, NOT IN THE UI.

   A competing player never receives the opposing side's editor content while
   the match is live. Hiding it client-side is not a control: if the gateway
   writes a delta to an opposing socket, a modified client reads it, and the
   advantage is total, silent, and available to anyone who opens devtools. So
   `audienceFor()` is the single place that decides who may be sent source
   text, and every send goes through it.

   The gateway keeps the authoritative text per side by splicing changes on
   absolute offsets. That is what makes snapshots, late joiners and gap
   recovery all free — there is always a current, correct document to hand out,
   and nothing has to replay a stream to produce one.
   ========================================================================= */

/** §10: periodic full snapshots, so a late joiner never replays an hour. */
export const SNAPSHOT_INTERVAL_MS = 30_000;

/** Beyond this a "document" is not a solution, it is an attack. */
const MAX_DOC_CHARS = 256 * 1024;

export interface RelayDoc {
  text: string;
  /** Highest applied seq. A client's next delta must be exactly this + 1. */
  seq: number;
  /** seq at the last snapshot written to the log. */
  snapshotSeq: number;
}

export interface AppliedDelta {
  side: Side;
  seq: number;
  changes: EditorChange[];
  origin: EditorOrigin;
  /** Characters inserted by this batch — the paste signal (§10). */
  inserted: number;
  /** Characters replaced or deleted by this batch. */
  removed: number;
}

/**
 * Applies one change set to a document.
 *
 * Monaco emits the changes of a single event in DESCENDING offset order, which
 * is exactly what makes applying them in array order correct: every splice is
 * to the right of the ones that follow, so no earlier edit shifts a later
 * offset. Do not sort them.
 */
export function applyChanges(text: string, changes: EditorChange[]): string {
  let next = text;
  for (const change of changes) {
    const start = Math.min(change.offset, next.length);
    const end = Math.min(start + change.length, next.length);
    next = next.slice(0, start) + change.text + next.slice(end);
    if (next.length > MAX_DOC_CHARS) {
      next = next.slice(0, MAX_DOC_CHARS);
      break;
    }
  }
  return next;
}

export class EditorRelay {
  private readonly docs = new Map<Side, RelayDoc>();

  constructor() {
    for (const side of ["p1", "p2"] as const) {
      this.docs.set(side, { text: "", seq: 0, snapshotSeq: 0 });
    }
  }

  doc(side: Side): RelayDoc {
    return this.docs.get(side)!;
  }

  /** Ground truth from a client — on join, or after a desync. */
  reset(side: Side, seq: number, text: string): void {
    this.docs.set(side, {
      text: text.slice(0, MAX_DOC_CHARS),
      seq,
      snapshotSeq: seq,
    });
  }

  /**
   * Apply a delta, or refuse it.
   *
   * Returns null when the seq does not follow, which is the caller's cue to
   * ask that client for a snapshot. NEVER apply a non-contiguous delta:
   * splicing onto the wrong base produces plausible code that was never
   * written, which is strictly worse than a visible gap because nothing
   * downstream can tell it happened.
   */
  apply(side: Side, delta: EditorDelta): AppliedDelta | null {
    const doc = this.doc(side);
    if (delta.seq !== doc.seq + 1) return null;

    let inserted = 0;
    let removed = 0;
    for (const change of delta.changes) {
      inserted += change.text.length;
      removed += change.length;
    }

    doc.text = applyChanges(doc.text, delta.changes);
    doc.seq = delta.seq;

    return { side, seq: delta.seq, changes: delta.changes, origin: delta.origin, inserted, removed };
  }

  /** True when this side is due a periodic full snapshot (§10). */
  needsSnapshot(side: Side): boolean {
    const doc = this.doc(side);
    return doc.seq > doc.snapshotSeq;
  }

  markSnapshotted(side: Side): void {
    const doc = this.doc(side);
    doc.snapshotSeq = doc.seq;
  }
}

/* ── The visibility rule ──────────────────────────────────────────────── */

/** Deliberate break, for the probe's positive control only. */
const VISIBILITY_BROKEN = process.env["BREAK_VISIBILITY"] === "1";

export type Viewer =
  | { kind: "player"; side: Side }
  | { kind: "spectator" }
  | { kind: "none" };

/**
 * May `viewer` be sent `side`'s editor content right now?
 *
 * §10, stated as code so there is exactly one answer and one place to change
 * it:
 *
 *  · A player always sees their own editor.
 *  · A player NEVER sees the opponent's while the match is live. They get the
 *    pulse line and status ticker — derived signals, never content.
 *  · Once the match has ended there is nothing left to cheat at, so both sides
 *    become visible to both players.
 *  · Spectators see everything, because they are not competing. That asymmetry
 *    is the product pitch.
 */
export function canSee(viewer: Viewer, side: Side, matchOver: boolean): boolean {
  /* POSITIVE CONTROL. `pnpm probe:visibility` asserts that an opponent cannot
     obtain source text by any route it can reach; that assertion is worth
     nothing unless it is known to fail when the enforcement is removed. This
     flag removes it, and exists so the probe can prove it detects the thing it
     claims to detect. It is read once, at module load, and is never set in any
     non-test invocation. */
  if (VISIBILITY_BROKEN) return true;

  switch (viewer.kind) {
    case "player":
      return viewer.side === side || matchOver;
    case "spectator":
      return true;
    case "none":
      return false;
  }
}

/**
 * Whether this identity may spectate this match at all.
 *
 * A player in a live match must NOT be able to spectate it. Otherwise the
 * spectator path is a one-click bypass of the rule above, and §7's mandatory
 * 45-second ranked delay does not close it: 45-second-old source is still an
 * enormous edge inside an eight-minute match, and unranked delay is zero.
 */
export function canSpectate(opts: {
  userId: string;
  p1UserId: string;
  p2UserId: string;
  matchOver: boolean;
}): boolean {
  const isCompetitor = opts.userId === opts.p1UserId || opts.userId === opts.p2UserId;
  return opts.matchOver || !isCompetitor;
}


/* ── The opponent channel is an ALLOWLIST ────────────────────────────────────

   THE RULE: a field is hidden from the opponent until someone argues it into
   visibility. Not the reverse.

   Every leak found so far has been a field nobody thought to check, and they
   were all found by accident rather than by review:

   · `message` on a COMPILE_ERROR is compiler output, and diagnostics QUOTE the
     offending source lines. Found while asking what a spectator receives.
   · `failedAt` is which test index broke them — intelligence about the test
     data, not about their code, which is worse because it helps against every
     future opponent on the same problem.
   · `submissionId` embeds the monotonic receipt stamp, so it discloses exactly
     when they submitted and by how much they led or trailed.
   · `verdict` discloses HOW they failed. TIME_LIMIT says "their approach is
     too slow", which is a strong hint that the intended solution needs better
     complexity. RUNTIME_ERROR says "they crashed". §6.5's near-miss only needs
     to know that they FAILED.

   A denylist would have shipped all four, because each was individually
   plausible and nobody was looking. So the opponent's view is CONSTRUCTED,
   never filtered: adding a field to the verdict payload cannot leak it,
   because it is simply not copied here.

   What the opponent legitimately sees is fixed by §6.4 and §6.5: the test
   count, whether the attempt passed, and derived activity signals. That is the
   whole list. */

export interface OpponentVerdictView {
  matchId: string;
  side: Side;
  /** PASS or FAIL only. Never the specific verdict — see above. */
  outcome: "pass" | "fail";
  passed: number;
  total: number;
}

export function opponentVerdictView(input: {
  matchId: string;
  side: Side;
  verdict: string;
  passed: number;
  total: number;
  failedAt?: number | null;
  message?: string | null;
}): OpponentVerdictView {
  /* POSITIVE CONTROL. The same flag that removes `canSee` also removes this
     allowlist, so the verdict attacks in probe:visibility are known to detect
     a regression rather than merely passing. An allowlist that has never been
     seen to fail is an assumption, not a control. */
  if (VISIBILITY_BROKEN) {
    return { ...input, outcome: "fail" } as unknown as OpponentVerdictView;
  }

  return {
    matchId: input.matchId,
    side: input.side,
    outcome: input.verdict === "ACCEPTED" ? "pass" : "fail",
    passed: input.passed,
    total: input.total,
  };
}


/* ── One constructor for the player cards on the wire ───────────────────────

   `match.found` and `match.resync` both carried the full internal PlayerCard,
   and `match.resync` had no constructor of its own — it simply re-sent
   `foundPayload`'s shape. That is the compile-error leak described in advance:
   ONE shape reachable through TWO paths, with only one of them ever audited. A
   field added to PlayerCard would have appeared in both and been reviewed in
   neither.

   So both go through here, and `userId` is dropped. It is an internal
   identifier the client never reads — the gateway resolves sides by identity
   server-side via `sideOf` — and an identifier with no client use has no
   business on the wire. */

export interface PlayerCardView {
  handle: string;
  rating: number;
  /** Null during placements. */
  tier: string | null;
  division: string | null;
  isBot: boolean;
  /** §8's disclosure rule, generalised: an unrated pairing is disclosed BEFORE
   *  the countdown, never after. A guest makes the match unrated for both. */
  isGuest: boolean;
}

export function playerCardView(card: {
  handle: string;
  rating: number;
  /** Null during placements — §8 gives a rating from match one, a tier from five. */
  tier: string | null;
  division: string | null;
  isBot: boolean;
  isGuest?: boolean;
}): PlayerCardView {
  return {
    handle: card.handle,
    rating: card.rating,
    tier: card.tier,
    division: card.division,
    isBot: card.isBot,
    isGuest: card.isGuest ?? false,
  };
}
