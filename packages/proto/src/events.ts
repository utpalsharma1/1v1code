import { z } from "zod";
import { LanguageSchema } from "./judge.ts";

/* ============================================================================
   Socket protocol (§10)

   Defined once, imported by both the gateway and the client. §13.5.

   Everything is keyed on **user id, never socket id**. A reconnecting player
   gets a new socket, and if identity were the socket they would arrive as a
   stranger rather than as the person who was mid-match. Socket ids appear
   nowhere in this file on purpose.
   ========================================================================= */

export const SideSchema = z.enum(["p1", "p2"]);
export type Side = z.infer<typeof SideSchema>;

export const MatchStateSchema = z.enum([
  "QUEUED",
  "MATCHED",
  "ACCEPTING",
  "COUNTDOWN",
  "LIVE",
  "JUDGING",
  "ENDED",
  "ABANDONED",
]);

/* The internal card. `userId` never goes on the wire — see PlayerCardViewSchema
   and the constructor in apps/gateway/src/relay.ts. */
export const PlayerCardSchema = z.object({
  userId: z.string(),
  handle: z.string(),
  rating: z.number().int(),
  /** NULL DURING PLACEMENTS. §8 gives a player a rating from match one and a
   *  TIER only after five, so this is nullable by design — a non-null tier for
   *  an unplaced player would publish the number the ladder exists to hide. */
  tier: z.string().nullable(),
  division: z.string().nullable(),
  isBot: z.boolean().default(false),
  isGuest: z.boolean().default(false),
});
export type PlayerCard = z.infer<typeof PlayerCardSchema>;

/** What a client actually receives. No `userId`: an internal identifier the
 *  client never reads has no business on the wire. Built by one constructor so
 *  `match.found` and `match.resync` cannot drift apart. */
export const PlayerCardViewSchema = z.object({
  handle: z.string(),
  rating: z.number().int(),
  /** NULL DURING PLACEMENTS. §8 gives a player a rating from match one and a
   *  TIER only after five, so this is nullable by design — a non-null tier for
   *  an unplaced player would publish the number the ladder exists to hide. */
  tier: z.string().nullable(),
  division: z.string().nullable(),
  isBot: z.boolean().default(false),
  isGuest: z.boolean().default(false),
});
export type PlayerCardView = z.infer<typeof PlayerCardViewSchema>;

/* ── client → server ──────────────────────────────────────────────────── */

export const QueueJoinSchema = z.object({ mode: z.enum(["RANKED", "CASUAL"]).default("RANKED") });
export const QueueLeaveSchema = z.object({});
export const MatchAcceptSchema = z.object({ matchId: z.string().min(1) });

/** 256 KB, matching the judge's own protocol cap. */
export const MAX_SOURCE_BYTES = 256 * 1024;

export const CodeSubmitSchema = z.object({
  matchId: z.string().min(1),
  language: LanguageSchema,
  source: z.string().max(MAX_SOURCE_BYTES),
});

/** Opponent keystroke *rate* only — never a character of code (§6.4). */
export const PulseReportSchema = z.object({
  matchId: z.string().min(1),
  /** Keystrokes in the last sampling window. */
  keys: z.number().int().nonnegative().max(10_000),
});

/* ── editor relay (§10, 2C-1) ──────────────────────────────────────────
   One change from Monaco's onDidChangeModelContent, reduced to what an
   applier and a paste detector both need.

   `offset` and `length` are absolute character offsets rather than
   line/column, so applying a change is a pure string splice and needs no model
   of the document. Monaco emits the changes of one event in DESCENDING offset
   order, which is what makes applying them in array order correct. */
export const EditorChangeSchema = z.object({
  offset: z.number().int().nonnegative(),
  /** Characters replaced. 0 for a pure insertion. */
  length: z.number().int().nonnegative(),
  text: z.string(),
});

/** §10: enough to make a paste visible after the fact. No enforcement. */
export const EditorOriginSchema = z.enum(["type", "paste", "undo", "redo", "other"]);

export const EditorDeltaSchema = z.object({
  matchId: z.string().min(1),
  /** Per-side, monotonic, starting at 1. A gap means resync, never guess. */
  seq: z.number().int().positive(),
  changes: z.array(EditorChangeSchema).min(1).max(200),
  origin: EditorOriginSchema.default("type"),
});

/** Sent by a client to establish or re-establish ground truth. */
export const EditorSnapshotSchema = z.object({
  matchId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  text: z.string().max(MAX_SOURCE_BYTES),
});

export const EditorResyncSchema = z.object({
  matchId: z.string().min(1),
  /** Whose editor. Omitted means every side the caller may see. */
  side: SideSchema.optional(),
});

/** §7 Phase 2D: join a challenge by its code. The gateway pairs whoever is
 *  waiting on it — one creation path, reached two ways. */
export const ChallengeJoinSchema = z.object({
  code: z.string().min(4).max(32),
});

/** §7: `/watch/<code>` resolves by SPECTATOR CODE, never by match id.
 *  The code is the shareable thing; the id is an internal handle. */
export const SpectateWatchSchema = z.object({
  code: z.string().min(4).max(32),
});

export interface ClientToServer {
  "queue.join": (payload: z.infer<typeof QueueJoinSchema>) => void;
  "queue.leave": (payload: z.infer<typeof QueueLeaveSchema>) => void;
  "match.accept": (payload: z.infer<typeof MatchAcceptSchema>) => void;
  "code.submit": (payload: z.infer<typeof CodeSubmitSchema>) => void;
  "pulse.report": (payload: z.infer<typeof PulseReportSchema>) => void;
  "editor.delta": (payload: z.infer<typeof EditorDeltaSchema>) => void;
  "editor.snapshot": (payload: z.infer<typeof EditorSnapshotSchema>) => void;
  "editor.resync": (payload: z.infer<typeof EditorResyncSchema>) => void;
  "spectate.join": (payload: z.infer<typeof EditorResyncSchema>) => void;
  "spectate.watch": (payload: z.infer<typeof SpectateWatchSchema>) => void;
  "challenge.join": (payload: z.infer<typeof ChallengeJoinSchema>) => void;
  /** §10: "am I still in this?" — see MatchRejoinSchema. */
  "match.rejoin": (payload: z.infer<typeof MatchRejoinSchema>) => void;
}

/* ── server → client ──────────────────────────────────────────────────── */

export const QueueStatusSchema = z.object({
  /** Monotonic ms since the player joined the queue. */
  elapsedMs: z.number().int().nonnegative(),
  ratingBand: z.tuple([z.number().int(), z.number().int()]),
  /** False once the band has hit its ceiling — the UI must stop claiming to widen. */
  widening: z.boolean(),
  inQueue: z.number().int().nonnegative(),
  /** True when nobody else is in the pool. With no bot fallback (2B-4) this is
   *  what lets the client stop performing a search it cannot win, rather than
   *  spinning a radar sweep against an empty queue. */
  alone: z.boolean().default(false),
  /** Widest the band will ever get (§6.1), so the UI can show progress. */
  ceiling: z.number().int().positive().default(400),
  /** ms until the next widening step, or null at the ceiling. */
  nextStepMs: z.number().int().nonnegative().nullable().default(null),
});

export const MatchFoundSchema = z.object({
  matchId: z.string(),
  /** §7: shown as a copyable chip so a player can share the match. */
  spectatorCode: z.string().default(""),
  you: SideSchema,
  p1: PlayerCardViewSchema,
  p2: PlayerCardViewSchema,
  /** Disclosed BEFORE the countdown, never after — §8's rule generalised. */
  rated: z.boolean().default(true),
  problemRating: z.number().int(),
  /** Milliseconds left to accept. */
  acceptMs: z.number().int(),
  headToHead: z.string(),
});

export const AcceptProgressSchema = z.object({
  matchId: z.string(),
  p1: z.boolean(),
  p2: z.boolean(),
});

export const CountdownSchema = z.object({
  matchId: z.string(),
  /** 3, 2, 1, then 0 for GO. */
  beat: z.number().int().min(0).max(3),
});

export const MatchStartSchema = z.object({
  matchId: z.string(),
  problem: z.object({
    slug: z.string(),
    title: z.string(),
    rating: z.number().int(),
    statement: z.string(),
    constraints: z.string(),
  }),
  durationMs: z.number().int(),
});

/** Server is authoritative on the clock (§10); the client re-syncs on every tick. */
export const ClockSchema = z.object({
  matchId: z.string(),
  remainingMs: z.number().int().nonnegative(),
  paused: z.boolean(),
});

export const OpponentPresenceSchema = z.object({
  matchId: z.string(),
  side: SideSchema,
  connected: z.boolean(),
  /** Milliseconds of grace left before it becomes a forfeit. */
  graceRemainingMs: z.number().int().nonnegative(),
});

/** Sent with match.end so the victory screen can count the delta up (§6.7). */
export const RatingDeltaSchema = z.object({
  side: SideSchema,
  before: z.number().int(),
  after: z.number().int(),
  /** THE §6.7 RANK-UP TRIGGER, and null unless the match crossed a TIER.
   *
   *  Computed on the server because it needs the PRE-match rating and the
   *  PRE-match placement count, and both are gone from the row by the time the
   *  client hears anything. A division change is deliberately NOT reported:
   *  firing the full cinematic four times per tier is how a moment stops being
   *  one (§2 rule 3). */
  ladder: z
    .object({
      kind: z.literal("tier"),
      up: z.boolean(),
      to: z.string(),
      label: z.string(),
    })
    .nullable(),
});

export const MatchEndSchema = z.object({
  matchId: z.string(),
  /** Empty when nothing was rated — a bot match above the RD gate, a guest, or
   *  any CANCELED/VOID ending. The victory screen shows no delta then. */
  ratings: z.array(RatingDeltaSchema).default([]),
  /** Final elapsed per side, for the §6.8 tiebreak and the summary. */
  elapsedMs: z.number().int().nonnegative().default(0),
  outcome: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("WIN"),
      winner: SideSchema,
      reason: z.enum(["SOLVED", "FORFEIT", "OPPONENT_ABANDONED"]),
    }),
    z.object({ kind: z.literal("DRAW"), reason: z.literal("NOBODY_SOLVED") }),
    // Routine, nobody's fault, no rating change.
    z.object({
      kind: z.literal("CANCELED"),
      reason: z.enum(["BOTH_ABANDONED", "NEVER_STARTED"]),
    }),
    // §6.9 no-contest: OUR failure. Kept distinct so it stays alarming.
    z.object({ kind: z.literal("VOID"), reason: z.literal("INTERNAL_ERROR") }),
  ]),
});

/** Sent on reconnect: everything needed to rebuild the screen from scratch. */
export const MatchResyncSchema = z.object({
  matchId: z.string(),
  spectatorCode: z.string().default(""),
  state: MatchStateSchema,
  you: SideSchema,
  p1: PlayerCardViewSchema,
  p2: PlayerCardViewSchema,
  rated: z.boolean().default(true),
  remainingMs: z.number().int().nonnegative(),
  accepted: z.object({ p1: z.boolean(), p2: z.boolean() }),
  connected: z.object({ p1: z.boolean(), p2: z.boolean() }),
  problem: MatchStartSchema.shape.problem.nullable(),
});

/* ── submission stream (§6.6) ──────────────────────────────────────────
   Per-test results arrive individually and are never batched: §6.6's
   sequential reveal is the drama, and batching would delete it. */

export const VerdictNameSchema = z.enum([
  "PENDING", "RUNNING", "ACCEPTED", "WRONG_ANSWER", "TIME_LIMIT", "MEMORY_LIMIT",
  "RUNTIME_ERROR", "COMPILE_ERROR", "COMPILE_TIMEOUT", "COMPILE_MEMORY",
  "OUTPUT_LIMIT", "INTERNAL_ERROR",
]);

export const SubmissionAckSchema = z.object({
  matchId: z.string(),
  submissionId: z.string(),
  side: SideSchema,
  total: z.number().int().nonnegative(),
});

export const TestResultSchema = z.object({
  matchId: z.string(),
  submissionId: z.string(),
  side: SideSchema,
  ordinal: z.number().int(),
  verdict: VerdictNameSchema,
  passed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

export const SubmissionVerdictSchema = z.object({
  matchId: z.string(),
  submissionId: z.string(),
  side: SideSchema,
  verdict: VerdictNameSchema,
  passed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  failedAt: z.number().int().nullable(),
  message: z.string().nullable(),
});

/** What the OPPONENT sees when the other side's submission resolves.
 *  Constructed, not filtered — §10's allowlist rule. Pass/fail and counts, the
 *  two things §6.4 and §6.5 actually need, and nothing else. */
export const OpponentVerdictSchema = z.object({
  matchId: z.string(),
  side: SideSchema,
  outcome: z.enum(["pass", "fail"]),
  passed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

/** §6.7b: your verdict is in, theirs is not. The hold is a beat, not a spinner. */
export const JudgingHoldSchema = z.object({
  matchId: z.string(),
  /** Sides still awaiting a verdict. Empty means the hold is over. */
  outstanding: z.array(SideSchema),
});

/** §6.4 pulse line — rate only, never content. */
export const OpponentPulseSchema = z.object({
  matchId: z.string(),
  side: SideSchema,
  keys: z.number().int().nonnegative(),
});

/** §6.5 compile pulse — a shockwave across that player's half of the HUD. */
export const OpponentStatusSchema = z.object({
  matchId: z.string(),
  side: SideSchema,
  status: z.enum(["typing", "compiling", "running", "submitted", "idle"]),
  /** Filled cells, for the opponent's test bar and the clutch threshold. */
  passed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

/* ── server → client: the relay ────────────────────────────────────────
   These carry SOURCE TEXT, so §10's visibility rule governs every send: a
   competing player never receives them for the opposing side while the match
   is live. The rule is enforced in the gateway, not here — a schema cannot
   stop a socket being written to. */

export const EditorDeltaOutSchema = EditorDeltaSchema.extend({
  side: SideSchema,
});

export const EditorSnapshotOutSchema = z.object({
  matchId: z.string(),
  side: SideSchema,
  /** The seq this text already includes. Deltas above it still apply. */
  seq: z.number().int().nonnegative(),
  text: z.string(),
});

/** Sent to a client whose deltas arrived with a gap: send us a snapshot. */
export const EditorDesyncSchema = z.object({
  matchId: z.string(),
  expected: z.number().int().nonnegative(),
  got: z.number().int().nonnegative(),
});

/** Sent when a watch code resolves, so the viewer knows what they are seeing. */
export const SpectateReadySchema = z.object({
  matchId: z.string(),
  code: z.string(),
  p1: PlayerCardSchema,
  p2: PlayerCardSchema,
  problem: z.object({ title: z.string(), rating: z.number().int() }).nullable(),
  /** §7: ranked matches are delayed. Shown openly as a badge, never hidden. */
  delayMs: z.number().int().nonnegative(),
  state: MatchStateSchema,
});

/** A valid code whose match has already finished. Distinct from an unknown
 *  code on purpose — see the gateway's note on the oracle argument. */
export const SpectateEndedSchema = z.object({
  code: z.string(),
  p1: z.string(),
  p2: z.string(),
  problem: z.string(),
  outcomeKind: z.string(),
  finishedAt: z.string().nullable(),
});

/** Waiting on the other side of a challenge link. */
export const ChallengeWaitingSchema = z.object({
  code: z.string(),
  host: z.string(),
  youAreHost: z.boolean(),
});

/* A CLIENT ASKING WHETHER ITS MATCH STILL EXISTS.
 *
 * A LiveMatch lives only in gateway memory, so a gateway that dies mid-match
 * and comes back has no record of it — and the reconnecting browser was told
 * NOTHING. Both players sat on a match screen, clock running, for a match with
 * nothing behind it. The server-side row is reconciled at startup, which is
 * correct and completely invisible to the two people looking at it.
 *
 * The client holds the match id, so the client is what has to ask. The gateway
 * answers with a resync if the match is live, or with `match.end` carrying the
 * outcome the reconciliation already wrote. */
export const MatchRejoinSchema = z.object({ matchId: z.string() });

export const ErrorSchema = z.object({ code: z.string(), message: z.string() });

export interface ServerToClient {
  "queue.status": (payload: z.infer<typeof QueueStatusSchema>) => void;
  "queue.left": (payload: Record<string, never>) => void;
  "match.found": (payload: z.infer<typeof MatchFoundSchema>) => void;
  "match.accept.progress": (payload: z.infer<typeof AcceptProgressSchema>) => void;
  "match.countdown": (payload: z.infer<typeof CountdownSchema>) => void;
  "match.start": (payload: z.infer<typeof MatchStartSchema>) => void;
  "match.clock": (payload: z.infer<typeof ClockSchema>) => void;
  "match.presence": (payload: z.infer<typeof OpponentPresenceSchema>) => void;
  "match.resync": (payload: z.infer<typeof MatchResyncSchema>) => void;
  "match.end": (payload: z.infer<typeof MatchEndSchema>) => void;
  "submission.ack": (payload: z.infer<typeof SubmissionAckSchema>) => void;
  "test.result": (payload: z.infer<typeof TestResultSchema>) => void;
  "submission.verdict": (payload: z.infer<typeof SubmissionVerdictSchema>) => void;
  "opponent.verdict": (payload: z.infer<typeof OpponentVerdictSchema>) => void;
  "match.judging": (payload: z.infer<typeof JudgingHoldSchema>) => void;
  "opponent.pulse": (payload: z.infer<typeof OpponentPulseSchema>) => void;
  "opponent.status": (payload: z.infer<typeof OpponentStatusSchema>) => void;
  "editor.delta": (payload: z.infer<typeof EditorDeltaOutSchema>) => void;
  "editor.snapshot": (payload: z.infer<typeof EditorSnapshotOutSchema>) => void;
  "editor.desync": (payload: z.infer<typeof EditorDesyncSchema>) => void;
  "spectate.ready": (payload: z.infer<typeof SpectateReadySchema>) => void;
  "spectate.ended": (payload: z.infer<typeof SpectateEndedSchema>) => void;
  "challenge.waiting": (payload: z.infer<typeof ChallengeWaitingSchema>) => void;
  error: (payload: z.infer<typeof ErrorSchema>) => void;
}

/* ── Event log types ──────────────────────────────────────────────────────
   What gets written to the JSONL. These are the replay's vocabulary. */

export const LOG_EVENT_TYPES = [
  "match.created",
  "match.accepted",
  "match.state",
  "countdown.beat",
  "match.started",
  "presence.changed",
  "submission.received",
  "submission.verdict",
  "editor.delta",
  "editor.snapshot",
  "paste.profile",
  "match.ended",
] as const;
export type RatingDelta = z.infer<typeof RatingDeltaSchema>;
export type MatchOutcomeWire = z.infer<typeof MatchEndSchema>["outcome"];
export type EditorChange = z.infer<typeof EditorChangeSchema>;
export type EditorDelta = z.infer<typeof EditorDeltaSchema>;
export type EditorOrigin = z.infer<typeof EditorOriginSchema>;
export type VerdictName = z.infer<typeof VerdictNameSchema>;
export type LogEventType = (typeof LOG_EVENT_TYPES)[number];
