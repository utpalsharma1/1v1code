import { z } from "zod";

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

export const PlayerCardSchema = z.object({
  userId: z.string(),
  handle: z.string(),
  rating: z.number().int(),
  tier: z.string(),
  division: z.string().nullable(),
  isBot: z.boolean().default(false),
});
export type PlayerCard = z.infer<typeof PlayerCardSchema>;

/* ── client → server ──────────────────────────────────────────────────── */

export const QueueJoinSchema = z.object({ mode: z.enum(["RANKED", "CASUAL"]).default("RANKED") });
export const QueueLeaveSchema = z.object({});
export const MatchAcceptSchema = z.object({ matchId: z.string().min(1) });

export interface ClientToServer {
  "queue.join": (payload: z.infer<typeof QueueJoinSchema>) => void;
  "queue.leave": (payload: z.infer<typeof QueueLeaveSchema>) => void;
  "match.accept": (payload: z.infer<typeof MatchAcceptSchema>) => void;
}

/* ── server → client ──────────────────────────────────────────────────── */

export const QueueStatusSchema = z.object({
  /** Monotonic ms since the player joined the queue. */
  elapsedMs: z.number().int().nonnegative(),
  ratingBand: z.tuple([z.number().int(), z.number().int()]),
  /** False once the band has hit its ceiling — the UI must stop claiming to widen. */
  widening: z.boolean(),
  inQueue: z.number().int().nonnegative(),
});

export const MatchFoundSchema = z.object({
  matchId: z.string(),
  you: SideSchema,
  p1: PlayerCardSchema,
  p2: PlayerCardSchema,
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

export const MatchEndSchema = z.object({
  matchId: z.string(),
  outcome: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("WIN"),
      winner: SideSchema,
      reason: z.enum(["SOLVED", "FORFEIT", "OPPONENT_ABANDONED"]),
    }),
    z.object({ kind: z.literal("DRAW"), reason: z.literal("NOBODY_SOLVED") }),
    z.object({
      kind: z.literal("VOID"),
      reason: z.enum(["BOTH_ABANDONED", "NEVER_STARTED"]),
    }),
  ]),
});

/** Sent on reconnect: everything needed to rebuild the screen from scratch. */
export const MatchResyncSchema = z.object({
  matchId: z.string(),
  state: MatchStateSchema,
  you: SideSchema,
  p1: PlayerCardSchema,
  p2: PlayerCardSchema,
  remainingMs: z.number().int().nonnegative(),
  accepted: z.object({ p1: z.boolean(), p2: z.boolean() }),
  connected: z.object({ p1: z.boolean(), p2: z.boolean() }),
  problem: MatchStartSchema.shape.problem.nullable(),
});

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
  "match.ended",
] as const;
export type LogEventType = (typeof LOG_EVENT_TYPES)[number];
