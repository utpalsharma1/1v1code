/* ============================================================================
   Match lifecycle (§12 Phase 2B)

   Explicit states and an explicit transition table, not ad-hoc booleans. The
   reason is not tidiness: a match has genuinely tricky corners — both players
   submitting while one is still judging, a disconnect during the countdown, an
   accept arriving twice — and every one of them is a question about *which
   transitions are legal from here*. Booleans scattered across a socket handler
   answer that question implicitly and differently in each place.

   This module is pure. It takes a state and an event and returns the next
   state or an explicit rejection. It performs no I/O, reads no clock, and has
   no opinion about sockets, so it can be tested exhaustively.
   ========================================================================= */

export const MATCH_STATES = [
  "QUEUED",
  "MATCHED",
  "ACCEPTING",
  "COUNTDOWN",
  "LIVE",
  "JUDGING",
  "ENDED",
  "ABANDONED",
] as const;

export type MatchState = (typeof MATCH_STATES)[number];

export type MatchEvent =
  | { type: "MATCH_FOUND" }
  | { type: "ACCEPT_WINDOW_OPEN" }
  | { type: "PLAYER_ACCEPTED"; side: "p1" | "p2" }
  | { type: "ACCEPT_TIMEOUT" }
  | { type: "COUNTDOWN_COMPLETE" }
  | { type: "SUBMISSION_RECEIVED"; submissionId: string; side: "p1" | "p2"; receiptMs: number }
  | { type: "VERDICT"; submissionId: string; accepted: boolean }
  | { type: "CLOCK_EXPIRED" }
  | { type: "PLAYER_DISCONNECTED"; side: "p1" | "p2" }
  | { type: "PLAYER_RECONNECTED"; side: "p1" | "p2" }
  | { type: "GRACE_EXPIRED"; side: "p1" | "p2" };

export interface Accepted {
  submissionId: string;
  side: "p1" | "p2";
  receiptMs: number;
}

export interface MatchContext {
  state: MatchState;
  accepted: { p1: boolean; p2: boolean };
  connected: { p1: boolean; p2: boolean };
  /** Submissions queued or judging, keyed by id. The match cannot leave
   *  JUDGING while this is non-empty (§6.9). */
  outstanding: Map<string, { side: "p1" | "p2"; receiptMs: number }>;
  /** Correct submissions, in the order the gateway received them (§6.9). */
  solved: Accepted[];
  /** Set once the clock runs out; the match still has to drain JUDGING. */
  clockExpired: boolean;
  /** Which side forfeited, if any. */
  forfeited: "p1" | "p2" | null;
  /** Where the match came to rest, once ENDED or ABANDONED. */
  outcome: MatchOutcome | null;
}

export type MatchOutcome =
  | { kind: "WIN"; winner: "p1" | "p2"; reason: "SOLVED" | "FORFEIT" | "OPPONENT_ABANDONED" }
  | { kind: "DRAW"; reason: "NOBODY_SOLVED" }
  /* CANCELED and VOID are both "no rating change", and they are still separate
     kinds on purpose.

     §6.9 gives VOID exactly one meaning: OUR infrastructure failed, so the
     match is a no-contest. That is a claim about us, it is rare, and it is
     supposed to be alarming when it shows up in match history.

     "Neither player accepted" and "both players disconnected" are neither rare
     nor our fault — they are routine, and the first one fires constantly during
     development. Folding them into VOID would make a genuine no-contest
     indistinguishable from an ordinary abandoned queue pop, which is precisely
     the signal VOID exists to carry. So routine cancellation is CANCELED. */
  | { kind: "CANCELED"; reason: "BOTH_ABANDONED" | "NEVER_STARTED" }
  | { kind: "VOID"; reason: "INTERNAL_ERROR" };

export interface Transition {
  ok: boolean;
  context: MatchContext;
  /** Why an event was refused. Never thrown — an illegal transition is data,
   *  and the gateway needs to log it rather than crash on a stale client. */
  rejected?: string;
  /** True when this event changed the state, for the transition log. */
  changed: boolean;
}

export function initialContext(): MatchContext {
  return {
    state: "QUEUED",
    accepted: { p1: false, p2: false },
    connected: { p1: true, p2: true },
    outstanding: new Map(),
    solved: [],
    clockExpired: false,
    forfeited: null,
    outcome: null,
  };
}

/** Which states each event is even meaningful in. */
const LEGAL_IN: Record<MatchEvent["type"], MatchState[]> = {
  MATCH_FOUND: ["QUEUED"],
  ACCEPT_WINDOW_OPEN: ["MATCHED"],
  PLAYER_ACCEPTED: ["ACCEPTING"],
  ACCEPT_TIMEOUT: ["ACCEPTING"],
  COUNTDOWN_COMPLETE: ["COUNTDOWN"],
  SUBMISSION_RECEIVED: ["LIVE", "JUDGING"],
  VERDICT: ["JUDGING"],
  CLOCK_EXPIRED: ["LIVE", "JUDGING"],
  PLAYER_DISCONNECTED: ["MATCHED", "ACCEPTING", "COUNTDOWN", "LIVE", "JUDGING"],
  PLAYER_RECONNECTED: ["MATCHED", "ACCEPTING", "COUNTDOWN", "LIVE", "JUDGING"],
  GRACE_EXPIRED: ["MATCHED", "ACCEPTING", "COUNTDOWN", "LIVE", "JUDGING"],
};

const clone = (c: MatchContext): MatchContext => ({
  ...c,
  accepted: { ...c.accepted },
  connected: { ...c.connected },
  outstanding: new Map(c.outstanding),
  solved: [...c.solved],
});

const reject = (c: MatchContext, why: string): Transition => ({
  ok: false,
  context: c,
  rejected: why,
  changed: false,
});

/**
 * Decide whether a match that has drained JUDGING is over, and how.
 *
 * §6.9: resolution is by *receipt* order among correct submissions, never by
 * verdict order. The queue's scheduling must not decide a match.
 */
function resolve(next: MatchContext): MatchContext {
  if (next.outstanding.size > 0) return next;

  if (next.solved.length > 0) {
    const first = [...next.solved].sort((a, b) => a.receiptMs - b.receiptMs)[0]!;
    next.state = "ENDED";
    next.outcome = { kind: "WIN", winner: first.side, reason: "SOLVED" };
    return next;
  }

  if (next.clockExpired) {
    // A dead match still needs an ending (§6.7 has no path for "nothing
    // happened", so it is defined here): nobody solved, it is a draw, and both
    // ratings move only slightly because that is what a draw means.
    next.state = "ENDED";
    next.outcome = { kind: "DRAW", reason: "NOBODY_SOLVED" };
    return next;
  }

  // Submissions resolved, all wrong, clock still running: back to play.
  next.state = "LIVE";
  return next;
}

export function transition(context: MatchContext, event: MatchEvent): Transition {
  const legal = LEGAL_IN[event.type];
  if (!legal.includes(context.state)) {
    return reject(context, `${event.type} is not legal in ${context.state}`);
  }

  const next = clone(context);
  const before = next.state;

  switch (event.type) {
    case "MATCH_FOUND":
      next.state = "MATCHED";
      break;

    case "ACCEPT_WINDOW_OPEN":
      next.state = "ACCEPTING";
      break;

    case "PLAYER_ACCEPTED": {
      // Idempotent by construction: a second accept from the same side is a
      // no-op, not a second start. A double-click, a retry after a dropped
      // ack, and a malicious replay are indistinguishable at this layer, so
      // none of them may advance the match twice.
      if (next.accepted[event.side]) {
        return { ok: true, context: next, changed: false, rejected: "duplicate accept ignored" };
      }
      next.accepted[event.side] = true;
      if (next.accepted.p1 && next.accepted.p2) next.state = "COUNTDOWN";
      break;
    }

    case "ACCEPT_TIMEOUT": {
      const p1In = next.accepted.p1;
      const p2In = next.accepted.p2;
      next.state = "ABANDONED";
      if (p1In && !p2In) next.outcome = { kind: "WIN", winner: "p1", reason: "OPPONENT_ABANDONED" };
      else if (p2In && !p1In) next.outcome = { kind: "WIN", winner: "p2", reason: "OPPONENT_ABANDONED" };
      else next.outcome = { kind: "CANCELED", reason: "NEVER_STARTED" };
      break;
    }

    case "COUNTDOWN_COMPLETE":
      next.state = "LIVE";
      break;

    case "SUBMISSION_RECEIVED": {
      // Idempotent: the same submission id must never be counted twice.
      if (next.outstanding.has(event.submissionId)) {
        return { ok: true, context: next, changed: false, rejected: "duplicate submission ignored" };
      }
      next.outstanding.set(event.submissionId, {
        side: event.side,
        receiptMs: event.receiptMs,
      });
      next.state = "JUDGING";
      break;
    }

    case "VERDICT": {
      const pending = next.outstanding.get(event.submissionId);
      if (!pending) {
        return reject(next, `verdict for unknown submission ${event.submissionId}`);
      }
      next.outstanding.delete(event.submissionId);
      if (event.accepted) {
        next.solved.push({
          submissionId: event.submissionId,
          side: pending.side,
          receiptMs: pending.receiptMs,
        });
      }
      // §6.9: hold in JUDGING until every outstanding submission resolves.
      // Ending on first-verdict would let the judge queue decide the match.
      resolve(next);
      break;
    }

    case "CLOCK_EXPIRED":
      next.clockExpired = true;
      if (next.state === "LIVE") resolve(next);
      // In JUDGING we do nothing yet: the outstanding submissions were received
      // before the clock expired and are still entitled to a verdict.
      break;

    case "PLAYER_DISCONNECTED":
      next.connected[event.side] = false;
      break;

    case "PLAYER_RECONNECTED":
      next.connected[event.side] = true;
      break;

    case "GRACE_EXPIRED": {
      next.connected[event.side] = false;
      next.forfeited = event.side;
      const other = event.side === "p1" ? "p2" : "p1";
      if (!next.connected[other]) {
        next.state = "ABANDONED";
        next.outcome = { kind: "CANCELED", reason: "BOTH_ABANDONED" };
      } else {
        next.state = "ENDED";
        next.outcome = { kind: "WIN", winner: other, reason: "FORFEIT" };
      }
      break;
    }
  }

  return { ok: true, context: next, changed: next.state !== before };
}

export const isTerminal = (state: MatchState): boolean =>
  state === "ENDED" || state === "ABANDONED";
