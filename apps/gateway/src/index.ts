import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import Redis from "ioredis";
import { Server, type Socket } from "socket.io";
import { generateCode, monotonicMs, normaliseCode, requireEnv } from "@1v1/core";
import { prisma } from "@1v1/db";
import {
  CodeSubmitSchema,
  EditorDeltaSchema,
  EditorResyncSchema,
  EditorSnapshotSchema,
  MatchAcceptSchema,
  PulseReportSchema,
  ChallengeJoinSchema,
  QueueJoinSchema,
  SpectateWatchSchema,
  type Language,
  type PlayerCard,
  type Side,
} from "@1v1/proto";
import { LiveMatch, type MatchProblem } from "./live-match.ts";
import { BAND_CEILING, BAND_INTERVAL_MS, Matchmaker, bandFor } from "./matchmaking.ts";
import { applyOutcome, isRated, snapshot, type RatingSnapshot } from "./rating.ts";
import { canSpectate, opponentVerdictView, type Viewer } from "./relay.ts";
import { SubmissionRunner, isInFlight, receipt } from "./submissions.ts";
import { anonymousIdentity, identify, identifyById, type Identity } from "./session.ts";

/* ============================================================================
   Gateway (§10, §12 Phase 2B-2)

   EVERYTHING IS KEYED ON USER ID, NEVER SOCKET ID. A reconnect produces a new
   socket; if identity were the socket, a returning player would arrive as a
   stranger instead of as the person who is mid-match. Socket ids are used only
   to address a transport.
   ========================================================================= */

/* Refuse to start without what we need, rather than failing on first use.
   The gateway reads Postgres for users, matches and challenges, and Redis for
   matchmaking, presence and tickets — a missing one is not survivable. */
requireEnv("DATABASE_URL", "REDIS_URL");

const PORT = Number(process.env["GATEWAY_PORT"] ?? "4000");
const REDIS_URL = process.env["REDIS_URL"] ?? "redis://localhost:6379";
import { WEB_ORIGINS, originAllowed } from "./origin.ts";

const redis = new Redis(REDIS_URL);
const matchmaker = new Matchmaker(redis);

/* ── Presence, keyed on user id ───────────────────────────────────────── */

interface Session {
  identity: Identity;
  sockets: Set<string>;
  queuedAt: number | null;
  queueTimer: NodeJS.Timeout | null;
  matchId: string | null;
  /** Survives a dropped socket so a reconnect can put the player back in the
   *  pool. See the note on the disconnect handler — without this a transient
   *  blip silently un-queues someone whose screen still says "Searching". */
  wantsQueue: boolean;
}

/** Sessions outlive their sockets, so a reconnect can restore queue intent. */
const queueIntent = new Map<string, boolean>();

const sessions = new Map<string, Session>();
const matches = new Map<string, LiveMatch>();
/** user id -> match id, so a reconnecting socket finds its match. */
const userMatch = new Map<string, string>();

const http = createServer();
const io = new Server(http, {
  cors: {
    origin: (origin, cb) =>
      originAllowed(origin ?? undefined)
        ? cb(null, true)
        : cb(new Error(`origin not allowed: ${origin ?? "(none)"}`)),
    credentials: true,
  },
  // A reconnect must land within the grace period, not be refused at the door.
  pingTimeout: 20_000,
});

/** Send to every socket a user currently has open. */
function toUser(userId: string, event: string, payload: unknown): void {
  const session = sessions.get(userId);
  if (!session) return;
  for (const socketId of session.sockets) io.to(socketId).emit(event, payload);
}

function toMatch(match: LiveMatch, event: string, payload: unknown): void {
  toUser(match.players.p1.userId, event, payload);
  toUser(match.players.p2.userId, event, payload);
}

function emitToSide(match: LiveMatch, side: Side, event: string, payload: unknown): void {
  toUser(match.players[side].userId, event, payload);
}

/** Everyone watching but not playing. Never carries source text by itself —
 *  the relay's own fanout is the only path for that, and it checks §10. */
function toSpectators(match: LiveMatch, event: string, payload: unknown): void {
  for (const socketId of match.spectators) io.to(socketId).emit(event, payload);
}

/** Match-wide news: both players AND everyone watching. */
function toEveryone(match: LiveMatch, event: string, payload: unknown): void {
  toMatch(match, event, payload);
  toSpectators(match, event, payload);
}

/* ── Relay fanout (§10) ───────────────────────────────────────────────────
   The ONLY two places source text leaves a match, and both consult the
   visibility rule per recipient.

   The opponent is not merely omitted from the UI — their socket is never
   written to. §7's tiered spectator batching (200ms, 500ms ranked) is 2C-2;
   today there is one dev spectator and the player cadence is what it gets. */

function fanOutDelta(match: LiveMatch, side: Side, delta: unknown): void {
  const payload = { ...(delta as object), side };
  for (const socketId of match.spectators) io.to(socketId).emit("editor.delta", payload);

  // The opposing PLAYER gets this only once the match is over.
  const other: Side = side === "p1" ? "p2" : "p1";
  if (match.mayView({ kind: "player", side: other }, side)) {
    emitToSide(match, other, "editor.delta", payload);
  }
}

function fanOutSnapshot(match: LiveMatch, side: Side): void {
  const doc = match.relay.doc(side);
  const payload = { matchId: match.id, side, seq: doc.seq, text: doc.text };
  for (const socketId of match.spectators) io.to(socketId).emit("editor.snapshot", payload);
  const other: Side = side === "p1" ? "p2" : "p1";
  if (match.mayView({ kind: "player", side: other }, side)) {
    emitToSide(match, other, "editor.snapshot", payload);
  }
}

/* ── Submissions (§6.6, §6.9) ─────────────────────────────────────────── */

const runner = new SubmissionRunner();

/**
 * Drives one submission from receipt to verdict.
 *
 * Per-test results are relayed the instant they arrive and are never batched —
 * §6.6's sequential reveal is the drama, and batching would delete it. The
 * opponent gets a *count*, never a test's content or the source.
 */
async function runSubmission(
  match: LiveMatch,
  side: Side,
  userId: string,
  language: Language,
  source: string,
  receiptMs: bigint,
): Promise<void> {
  const other: Side = side === "p1" ? "p2" : "p1";
  /* One id per submission, derived from the receipt stamp so the state machine
     and the wire agree without a second round trip. */
  const submissionId = `${match.id}:${side}:${receiptMs}`;
  let accepted = false;
  let internalError = false;

  /* Register with the state machine FIRST, before any I/O.

     This was in the `onQueued` callback, which meant a database failure threw
     before the machine had ever heard of the submission — and then the verdict
     that followed was refused as belonging to an unknown submission, so the
     §6.7b hold never resolved and the match hung until the clock ran out.
     Registering here means every path that can fail is already inside a hold
     that something will resolve. */
  await match.submissionReceived(side, submissionId, Number(receiptMs));

  try {
    await runner.run(
      {
        matchId: match.id,
        userId,
        problemId: match.problem.id,
        problemSlug: match.problem.slug,
        language,
        source,
        receiptMs,
      },
      {
        onQueued: (total) => {
          emitToSide(match, side, "submission.ack", {
            matchId: match.id,
            submissionId,
            side,
            total,
          });
          const submitted = { matchId: match.id, side, status: "submitted", passed: 0, total };
          emitToSide(match, other, "opponent.status", submitted);
          toSpectators(match, "opponent.status", submitted);
        },
        onStatus: (status) => {
          // §6.5 compile pulse: the opponent feels it, without seeing anything.
          const pulse = { matchId: match.id, side, status, passed: 0, total: 0 };
          emitToSide(match, other, "opponent.status", pulse);
          toSpectators(match, "opponent.status", pulse);
        },
        onTest: (ordinal, verdict, passed, total) => {
          emitToSide(match, side, "test.result", {
            matchId: match.id,
            submissionId,
            side,
            ordinal,
            verdict,
            passed,
            total,
          });
          // The opponent's bar fills from counts alone (§6.4). A spectator
          // needs the same counts for BOTH sides to render two test bars.
          const running = { matchId: match.id, side, status: "running", passed, total };
          emitToSide(match, other, "opponent.status", running);
          toSpectators(match, "opponent.status", running);
        },
        onVerdict: (result) => {
          accepted = result.verdict === "ACCEPTED";
          // §6.9: our failure, not theirs. Voids the match, costs nobody rating.
          internalError = result.verdict === "INTERNAL_ERROR";
          /* THREE AUDIENCES, THREE VIEWS.

             The submitter gets everything. Spectators get everything, because
             they may already read the whole document — nothing in a verdict
             tells them more than the source does.

             The OPPONENT gets a constructed view, not a filtered one: see
             `opponentVerdictView` in relay.ts for the allowlist rule and the
             four fields that had to be argued out of it. */
          const full = {
            matchId: match.id,
            submissionId,
            side,
            verdict: result.verdict,
            passed: result.passed,
            total: result.total,
            failedAt: result.failedAt,
            message: result.message,
          };
          emitToSide(match, side, "submission.verdict", full);
          toSpectators(match, "submission.verdict", full);
          emitToSide(
            match,
            other,
            "opponent.verdict",
            opponentVerdictView({ matchId: match.id, side, verdict: result.verdict, passed: result.passed, total: result.total }),
          );
        },
      },
    );
  } catch (error) {
    console.error(`[match ${match.id}] submission failed:`, error);
    // A thrown submission is indistinguishable, from the player's seat, from a
    // judge that died. Both are ours, so both void rather than count as a loss.
    internalError = true;
  }

  /* Resolve the hold whatever happened, including on a thrown error. A
     submission that never resolves would hang the match forever, which §6.7b
     forbids — the hold must be bounded. */
  await match.verdictArrived(side, submissionId, accepted, internalError);
}

/* ── Problem selection (§8) ───────────────────────────────────────────── */

/**
 * mean − 120, sampled rather than fixed.
 *
 * Selecting at the mean means each player solves it about half the time, so
 * roughly a quarter of matches end with neither solving — a dead match, which
 * is the worst outcome in the product. The offset makes it likely both can
 * land it and the match is decided by speed and nerve.
 */
/** Rename `testCases` to `samples`, so nothing downstream can mistake the
 *  public set for the full one. */
function shape(row: {
  testCases: { input: string; expected: string }[];
} & Omit<MatchProblem, "samples">): MatchProblem {
  const { testCases, ...rest } = row;
  return { ...rest, samples: testCases };
}

async function pickProblem(
  r1: number,
  r2: number,
  spread: number,
  /* §8: an EXPLICIT band REPLACES mean − 120 entirely. It does not blend,
     adjust or average with it.

     A guest has no rating — the 1200 on their row is the schema default, written
     because the column is non-null, and it is not evidence about anything.
     Feeding it into a mean gives (1200 + host)/2 − 120, which for a 1200 host is
     1080: a plausible-looking number derived from a value that means nothing,
     and plausible-and-wrong is worse than absent because nobody re-examines a
     reasonable number. So when a band is supplied, neither rating is read. */
  band?: { min: number; max: number },
): Promise<MatchProblem | null> {
  if (band) {
    const inBand = await prisma.problem.findMany({
      where: { rating: { gte: band.min, lte: band.max } },
      select: {
        id: true,
        slug: true,
        title: true,
        rating: true,
        statement: true,
        inputFormat: true,
        outputFormat: true,
        constraints: true,
        note: true,
        timeLimitMs: true,
        memoryLimitMb: true,
        // isSample true ONLY. The hidden set never leaves the judge.
        testCases: {
          where: { isSample: true },
          orderBy: { ordinal: "asc" },
          select: { input: true, expected: true },
        },
      },
    });
    if (inBand.length === 0) return null;
    return shape(inBand[Math.floor(Math.random() * inBand.length)]!);
  }

  const target = (r1 + r2) / 2 - 120;
  const lo = target - spread;
  const hi = target + spread;

  const inBand = await prisma.problem.findMany({
    where: { rating: { gte: lo, lte: hi } },
    select: {
        id: true,
        slug: true,
        title: true,
        rating: true,
        statement: true,
        inputFormat: true,
        outputFormat: true,
        constraints: true,
        note: true,
        timeLimitMs: true,
        memoryLimitMb: true,
        // isSample true ONLY. The hidden set never leaves the judge.
        testCases: {
          where: { isSample: true },
          orderBy: { ordinal: "asc" },
          select: { input: true, expected: true },
        },
      },
  });

  const pool = inBand.length > 0
    ? inBand
    : await prisma.problem.findMany({
        take: 5,
        orderBy: { rating: "asc" },
        select: {
        id: true,
        slug: true,
        title: true,
        rating: true,
        statement: true,
        inputFormat: true,
        outputFormat: true,
        constraints: true,
        note: true,
        timeLimitMs: true,
        memoryLimitMb: true,
        // isSample true ONLY. The hidden set never leaves the judge.
        testCases: {
          where: { isSample: true },
          orderBy: { ordinal: "asc" },
          select: { input: true, expected: true },
        },
      },
      });

  if (pool.length === 0) return null;
  return shape(pool[Math.floor(Math.random() * pool.length)]!);
}

async function cardFor(identity: Identity): Promise<PlayerCard> {
  return {
    userId: identity.userId,
    handle: identity.handle,
    rating: identity.rating,
    tier: "gold",
    division: "II",
    isBot: identity.isBot,
    isGuest: identity.isGuest ?? false,
  };
}

/** Writes the Match row at LIVE, so submissions have something to reference. */
async function persistMatch(match: LiveMatch, problemId: string): Promise<void> {
  try {
    await prisma.match.create({
      data: {
        id: match.id,
        spectatorCode: match.spectatorCode,
        p1Id: match.players.p1.userId,
        p2Id: match.players.p2.userId,
        problemId,
        state: "LIVE",
        startedAt: new Date(),
      },
    });
  } catch (error) {
    console.error(`[match ${match.id}] could not create match row:`, error);
  }
}

/* ── Challenge pairing (§7 Phase 2D) ──────────────────────────────────────
   Whoever arrives first WAITS; the second arrival pairs them. Held in memory
   keyed by code, so a challenge behaves like a two-person queue with a fixed
   membership rather than a new lifecycle. */

/* A challenge has exactly TWO known members — `hostId` and `consumedById` — so
   pairing needs no waiting slot at all. Whoever emits `challenge.join` triggers
   a check: are both parties connected right now? If yes, create the match; if
   no, say who we are waiting for.

   The first version DID keep a slot, and it broke for a reason worth recording:
   React StrictMode double-mounts effects in dev, so the first socket connects,
   emits, and is immediately torn down — which deleted the session and left a
   slot pointing at an identity that no longer existed. The second arrival then
   found a stale partner and took its place, and both sides waited forever.

   Deriving membership from the row instead of accumulating it in memory removes
   the state that could go stale. There is nothing to invalidate. */

async function joinChallenge(session: Session, code: string): Promise<void> {
  if (session.matchId) return;
  const me = session.identity.userId;

  const challenge = await prisma.challenge.findUnique({
    where: { code },
    select: {
      hostId: true,
      consumedById: true,
      expiresAt: true,
      ratingMin: true,
      ratingMax: true,
      host: { select: { handle: true } },
    },
  });
  if (!challenge) {
    toUser(me, "error", { code: "NO_CHALLENGE", message: "unknown code" });
    return;
  }
  if (challenge.expiresAt.getTime() < Date.now() && !challenge.consumedById) {
    toUser(me, "error", { code: "EXPIRED", message: "this link has expired" });
    return;
  }

  const isHost = me === challenge.hostId;
  const isTaker = me === challenge.consumedById;
  if (!isHost && !isTaker) {
    // Holding the code is not membership; taking it through the redemption
    // route is. Otherwise a forwarded link would let a third party barge in.
    toUser(me, "error", {
      code: "NOT_YOURS",
      message: "this challenge belongs to two other players",
    });
    return;
  }
  challengeIntent.add(me);

  if (!challenge.consumedById) {
    toUser(me, "challenge.waiting", { code, host: challenge.host.handle, youAreHost: isHost });
    return;
  }

  const hostSession = sessions.get(challenge.hostId);
  const takerSession = sessions.get(challenge.consumedById);

  // Both connected? Go. Otherwise wait, and name who we are waiting for.
  if (!hostSession || !takerSession || hostSession.matchId || takerSession.matchId) {
    toUser(me, "challenge.waiting", { code, host: challenge.host.handle, youAreHost: isHost });
    return;
  }

  // Guard against both sides racing the same check.
  if (challengeStarting.has(code)) return;
  challengeStarting.add(code);
  try {
    stopQueueTimers(hostSession);
    stopQueueTimers(takerSession);
    /* The HOST is always p1, so the link's creator keeps the left corner. A
       presentation choice — the machine is symmetric — but it makes a shared
       match read the same way for both people.

       §7: no spectator delay on a challenge match. §8: the band REPLACES
       mean − 120 rather than adjusting it. */
    challengeIntent.delete(challenge.hostId);
    challengeIntent.delete(challenge.consumedById);
    await createMatch(hostSession.identity, takerSession.identity, {
      band: { min: challenge.ratingMin, max: challenge.ratingMax },
      spectatorDelayMs: 0,
    });
  } finally {
    challengeStarting.delete(code);
  }
}

/** In-flight guard only. Not membership — that comes from the row. */
const challengeStarting = new Set<string>();

/** Who is currently waiting on a challenge, so `queue.join` can refuse them.
 *  Cleared when the match starts or when they explicitly leave. */
const challengeIntent = new Set<string>();

/* ── Settlement ───────────────────────────────────────────────────────── */

/**
 * Writes the Match row, applies Glicko-2, and sends the deltas with `match.end`.
 *
 * The row is written at the END rather than at creation, because until a match
 * finishes there is nothing durable to say about it — and a row created at
 * queue-pop time would leave a `PENDING` match behind for every abandoned
 * accept window, which is most of them in development.
 */
async function settleMatch(
  match: LiveMatch,
  p1: RatingSnapshot | null,
  p2: RatingSnapshot | null,
  problemId: string,
): Promise<void> {
  const outcome = match.context.outcome ?? { kind: "CANCELED" as const, reason: "NEVER_STARTED" as const };

  try {
    // The row exists from the moment the match went LIVE. A match that never
    // started has none, which is correct: there is nothing to record.
    await prisma.match.updateMany({
      where: { id: match.id },
      data: {
        state: outcome.kind === "CANCELED" ? "ABANDONED" : "FINISHED",
        outcomeKind: outcome.kind,
        outcomeReason: outcome.reason,
        winnerId: outcome.kind === "WIN" ? match.players[outcome.winner].userId : null,
        finishedAt: new Date(),
        p1ElapsedMs: Math.round(match.elapsedFor("p1")),
        p2ElapsedMs: Math.round(match.elapsedFor("p2")),
      },
    });
  } catch (error) {
    console.error(`[match ${match.id}] could not persist:`, error);
  }

  let ratings: { side: Side; before: number; after: number }[] = [];
  if (p1 && p2) {
    try {
      ratings = await applyOutcome({ matchId: match.id, p1, p2, outcome });
    } catch (error) {
      console.error(`[match ${match.id}] rating update failed:`, error);
    }
  }

  toEveryone(match, "match.end", {
    matchId: match.id,
    outcome,
    ratings,
    elapsedMs: Math.round(Math.max(match.elapsedFor("p1"), match.elapsedFor("p2"))),
  });
}

/* ── Match creation ───────────────────────────────────────────────────── */

async function createMatch(
  a: Identity,
  b: Identity,
  /** Set by a challenge link. §8: this REPLACES mean − 120, never adjusts it. */
  opts?: { band?: { min: number; max: number }; spectatorDelayMs?: number },
): Promise<void> {
  const spread = 150;
  const problem = await pickProblem(a.rating, b.rating, spread, opts?.band);
  if (!problem) {
    toUser(a.userId, "error", { code: "NO_PROBLEM", message: "No problems seeded." });
    toUser(b.userId, "error", { code: "NO_PROBLEM", message: "No problems seeded." });
    return;
  }

  /* Rating snapshots are taken NOW, before a single keystroke.

     §6.7 counts the delta up on the victory screen, and that delta must belong
     to this match. Reading the rating back at the end would pick up any other
     match that resolved in between — rare today, routine the moment a player
     has two tabs or a rematch fires quickly. */
  const [p1Snapshot, p2Snapshot] = await Promise.all([snapshot(a.userId), snapshot(b.userId)]);

  /* Decided HERE, before anyone sees a nameplate, and sent with match.found.
     §8 disclosed the bot before the countdown for exactly this reason: players
     work out that nothing moved either way, and finding out afterwards feels
     like being tricked in a way that losing never does. A guest on either side
     makes the match unrated for BOTH. */
  const rated = p1Snapshot && p2Snapshot ? isRated(p1Snapshot, p2Snapshot) : true;

  const id = randomUUID();
  const spectatorCode = generateCode();
  const problemRow = problem;
  const match: LiveMatch = new LiveMatch({
    id,
    spectatorCode,
    rated,
    /* §7: challenge matches have NO spectator delay. Friends watching friends
       is the entire point of them, and a 45-second delay ruins the experience it
       exists to enable. Ranked keeps its mandatory 45s. */
    ...(opts?.spectatorDelayMs !== undefined ? { spectatorDelayMs: opts.spectatorDelayMs } : {}),
    players: { p1: await cardFor(a), p2: await cardFor(b) },
    problem,
    emitTo: (side, event, payload) => emitToSide(match, side, event, payload),
    emit: (event, payload) => {
      // Match-wide news reaches spectators as well as players. None of these
      // carry source text — that only moves through the relay's own fanout,
      // which checks §10 per recipient.
      toEveryone(match, event, payload);
      // The bot starts when the match actually goes live, not when it is
      // created — the countdown has to finish first or its clock is wrong.
    },
    /* The Match row is written HERE, and awaited before LIVE.

       Not at queue pop: most accept windows are abandoned in development and
       that would leave a PENDING row behind for each one. Not at settlement,
       which is where this started and which was wrong — Submission.matchId is
       a foreign key, so a submission during a live match violated it. Going
       LIVE is the first moment the match is real and the last moment before
       anything can reference it. */
    onBeforeLive: (): Promise<void> => persistMatch(match, problemRow.id),
    onFinished: (finished) => {
      void settleMatch(finished, p1Snapshot, p2Snapshot, problemRow.id);
      matches.delete(finished.id);
      userMatch.delete(finished.players.p1.userId);
      userMatch.delete(finished.players.p2.userId);
      for (const card of [finished.players.p1, finished.players.p2]) {
        const session = sessions.get(card.userId);
        if (session) session.matchId = null;
      }
      void matchmaker.setCooldown(finished.players.p1.userId, finished.players.p2.userId);
    },
  });

  matches.set(id, match);
  userMatch.set(a.userId, id);
  userMatch.set(b.userId, id);
  for (const userId of [a.userId, b.userId]) {
    queueIntent.delete(userId);
    const session = sessions.get(userId);
    if (session) {
      session.matchId = id;
      session.wantsQueue = false;
      stopQueueTimers(session);
    }
  }

  console.log(
    `[gateway] match ${id}: ${a.handle} (${a.rating}) vs ${b.handle} (${b.rating}) on ${problem.slug} (${problem.rating})`,
  );
  await match.open();
}

/* ── Queue ────────────────────────────────────────────────────────────── */

function stopQueueTimers(session: Session): void {
  if (session.queueTimer) clearInterval(session.queueTimer);
  session.queueTimer = null;
  session.queuedAt = null;
}


/**
 * Queue until a human arrives.
 *
 * THE EMPTY QUEUE, DECIDED RATHER THAN LEFT IMPLICIT.
 *
 * With the bot fallback gone there is no automatic ending, so this is the
 * choice: **the queue never expires, but it stops pretending.**
 *
 * Three options were on the table. A hard timeout is wrong because it ejects a
 * player from a queue they may still want to be in, and nothing about an empty
 * pool makes waiting invalid — the cost of a queued socket is nil. Queueing
 * silently forever is worse: the radar sweep in §6.1 encodes "you are searching
 * right now", and while that stays literally true, letting it spin against an
 * empty pool implies a match is coming when nothing can produce one. That is
 * the version the player rightly hates.
 *
 * So the queue stays open indefinitely and the *claim* changes. `alone` says
 * whether this player is the only one in the pool; the client drops the radar
 * and states the fact once it has held for a while (see QueueCard). Nothing is
 * cancelled, nothing is invented, and the interface stops performing a search
 * it cannot win.
 */
async function joinQueue(session: Session): Promise<void> {
  if (session.matchId) return;
  session.wantsQueue = true;
  queueIntent.set(session.identity.userId, true);
  session.queuedAt = monotonicMs();

  const attempt = async (): Promise<void> => {
    if (session.matchId || session.queuedAt === null) return;
    const elapsed = monotonicMs() - session.queuedAt;
    const { half, widening } = bandFor(elapsed);

    const pair = await matchmaker.joinOrPair(
      session.identity.userId,
      session.identity.rating,
      half,
      monotonicMs(),
    );

    /* The ZADD inside the script races the disconnect handler's ZREM.

       `attempt()` is async and runs on a 2s interval. If the socket dies while
       one is in flight, the disconnect handler removes the player from Redis
       and then this call puts them straight back — a ghost with no session,
       who can never be matched but who makes the pool look non-empty forever.
       That is how `alone` stopped being true. So re-check after the await. */
    if (sessions.get(session.identity.userId) !== session || session.queuedAt === null) {
      await matchmaker.leave(session.identity.userId);
      return;
    }

    if (pair) {
      const partner = sessions.get(pair.partnerId);
      if (!partner) {
        // The partner vanished between joining and pairing. Evict them so the
        // ghost cannot be handed out again, then requeue rather than stranding
        // this player.
        await matchmaker.leave(pair.partnerId);
        await matchmaker.joinOrPair(
          session.identity.userId,
          session.identity.rating,
          half,
          monotonicMs(),
        );
        return;
      }
      stopQueueTimers(partner);
      stopQueueTimers(session);
      await createMatch(partner.identity, session.identity);
      return;
    }

    const inQueue = await matchmaker.size();
    toUser(session.identity.userId, "queue.status", {
      elapsedMs: elapsed,
      ratingBand: [session.identity.rating - half, session.identity.rating + half],
      widening,
      inQueue,
      // Authoritative, because the client must never have to infer it.
      alone: inQueue <= 1,
      /* The queue card shows PROGRESS, not just "widening…", so it needs both
         the ceiling and the time to the next step. Computed here because the
         schedule is §6.1's and the client must not re-derive it. */
      ceiling: BAND_CEILING,
      nextStepMs: widening ? BAND_INTERVAL_MS - (elapsed % BAND_INTERVAL_MS) : null,
    });
  };

  await attempt();
  session.queueTimer = setInterval(() => void attempt(), 2000);

  /* NO BOT FALLBACK. 2B-4 is human vs human.

     The bot's foundations — the solve model and rating gate in
     packages/core/src/bot.ts, the 20 verified solutions in
     packages/db/src/solutions.ts — are deliberately left in place and unused.
     They are correct and re-deriving them later would be waste. */
}

/** Explicit departure: the player asked, so the intent goes too. */
async function leaveQueue(session: Session): Promise<void> {
  session.wantsQueue = false;
  queueIntent.delete(session.identity.userId);
  stopQueueTimers(session);
  await matchmaker.leave(session.identity.userId);
  toUser(session.identity.userId, "queue.left", {});
}

/* ── Socket lifecycle ─────────────────────────────────────────────────── */

/* ── Handshake authentication ──────────────────────────────────────────
   TWO PATHS, and the order matters.

   1. TICKET (primary). The page fetches a short-lived single-use ticket from
      its OWN origin, where the session cookie is unambiguously sent, and hands
      it over in the Socket.IO auth payload. No cookie has to survive a
      cross-origin request, so none of this depends on SameSite behaviour,
      third-party cookie policy, or whether the browser attaches cookies to a
      cross-origin WebSocket upgrade.

   2. COOKIE (fallback). Kept so the headless probes and any same-origin
      deployment keep working unchanged.

   The log line below is deliberately permanent. When this broke, the one fact
   nobody could establish without a browser was whether a Cookie header arrived
   at all — so now the server says so on every attempt, including rejections. */
io.use(async (socket, next) => {
  const auth = socket.handshake.auth as { ticket?: unknown } | undefined;
  const ticket = typeof auth?.ticket === "string" ? auth.ticket : null;
  const cookieHeader = socket.handshake.headers.cookie;
  const origin = socket.handshake.headers.origin ?? "none";

  let identity: Identity | null = null;
  let via = "nothing";

  if (ticket) {
    // Single use: GETDEL so a ticket cannot be replayed if it leaks.
    const subject = await redis.getdel(`socket:ticket:${ticket}`);
    if (subject === "anon") {
      /* §7: watching requires no account. This identity may watch and do
         nothing else — every player action is refused by `playerOnly` below,
         server-side, because a registration wall in front of a shared live
         match converts our best growth path into a bounce. */
      identity = anonymousIdentity(randomUUID());
      via = "anonymous ticket";
    } else if (subject) {
      identity = await identifyById(subject);
      via = "ticket";
    }
  }
  if (!identity && cookieHeader) {
    identity = await identify(cookieHeader);
    if (identity) via = "cookie";
  }

  console.log(
    `[gateway] handshake transport=${socket.conn.transport.name} origin=${origin} ` +
      `cookie=${cookieHeader ? "present" : "ABSENT"} ticket=${ticket ? "present" : "absent"} ` +
      `-> ${identity ? `${identity.handle} via ${via}` : "REJECTED"}`,
  );

  if (!identity) {
    next(new Error("unauthenticated: no valid ticket or session cookie"));
    return;
  }
  (socket.data as { identity: Identity }).identity = identity;
  next();
});

io.on("connection", (socket: Socket) => {
  const identity = (socket.data as { identity: Identity }).identity;
  const userId = identity.userId;

  let session = sessions.get(userId);
  if (!session) {
    session = {
      identity,
      sockets: new Set(),
      queuedAt: null,
      queueTimer: null,
      matchId: userMatch.get(userId) ?? null,
      wantsQueue: queueIntent.get(userId) ?? false,
    };
    sessions.set(userId, session);
  }
  session.sockets.add(socket.id);
  console.log(`[gateway] ${identity.handle} connected (${session.sockets.size} socket(s))`);

  // Reconnection: identity is the user, so a returning socket rejoins the
  // match in progress and gets a full snapshot rather than incremental deltas.
  const existingMatchId = userMatch.get(userId);
  if (existingMatchId) {
    const match = matches.get(existingMatchId);
    const side = match?.sideOf(userId);
    if (match && side) {
      void match.reconnected(side);
      socket.emit("match.resync", match.resyncFor(side));
    }
  } else if (session.wantsQueue && session.queuedAt === null) {
    /* THE SAME COURTESY FOR THE QUEUE, and it is not cosmetic.

       Disconnecting removes a player from the Redis pool, which is right — a
       socket that is gone must not be matched. But nothing put them back, and
       `queue.left` was emitted to a socket that no longer existed, so the
       client kept rendering the queue card while the server had forgotten it.
       The result: /play looked like it was queueing forever and was invisible
       to everyone else in the pool. Any blip did it — a Next dev recompile, a
       laptop sleeping, the 20s ping timeout.

       Queue intent now survives the socket, so coming back puts you back. */
    console.log(`[gateway] ${identity.handle} reconnected while queued — rejoining the pool`);
    void joinQueue(session);
  }

  /* §7: an anonymous viewer may watch and do nothing else.
     Enforced here rather than by hiding buttons — the client is not ours. */
  const playerOnly = (event: string): boolean => {
    if (!identity.isAnonymous) return true;
    socket.emit("error", { code: "SPECTATOR_ONLY", message: `${event} requires an account` });
    return false;
  };

  /* A guest may PLAY but may not INVITE. A credential-less account that can mint
     invite links is a spam primitive: open a link, become a guest, mint ten
     more. The HTTP route refuses this too — both, deliberately, because a
     defence that lives in one place is a defence that moves when code moves. */
  const registeredOnly = (event: string): boolean => {
    if (!identity.isGuest) return true;
    socket.emit("error", {
      code: "GUEST_FORBIDDEN",
      message: `${event} needs a registered account`,
    });
    return false;
  };

  socket.on("queue.join", (raw) => {
    if (!playerOnly("queue.join")) return;
    /* Holding a challenge must not also join OPEN matchmaking.
       Client-side the affordance is gone — a challenge arrival never reaches the
       lobby — but the affordance is not the control. A player waiting on a named
       opponent who also lands in the general pool can be paired with a stranger
       while their friend is still opening the link, and then the challenge can
       never start. Refused here so it cannot happen however the event arrives. */
    if (challengeIntent.has(userId)) {
      socket.emit("error", {
        code: "IN_CHALLENGE",
        message: "you are waiting on a challenge — leave it first to use matchmaking",
      });
      return;
    }
    const parsed = QueueJoinSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      socket.emit("error", { code: "BAD_PAYLOAD", message: "queue.join" });
      return;
    }
    void joinQueue(session);
  });

  socket.on("queue.leave", () => {
    if (!playerOnly("queue.leave")) return;
    challengeIntent.delete(userId);
    void leaveQueue(session);
  });

  socket.on("match.accept", (raw) => {
    if (!playerOnly("match.accept")) return;
    const parsed = MatchAcceptSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      socket.emit("error", { code: "BAD_PAYLOAD", message: "match.accept" });
      return;
    }
    const match = matches.get(parsed.data.matchId);
    const side = match?.sideOf(userId);
    if (!match || !side) {
      socket.emit("error", { code: "NO_MATCH", message: "unknown match" });
      return;
    }
    // Idempotent in the state machine: a double-click cannot start it twice.
    void match.accept(side);
  });

  socket.on("code.submit", (raw) => {
    if (!playerOnly("code.submit")) return;
    /* THE RECEIPT STAMP, TAKEN FIRST (§6.9).

       Before validation, before the database, before the job is queued. It is
       the sole authority for win order and for the elapsed-time tiebreak, and
       anything that happens between arrival and stamping is time the player is
       charged for through no fault of their own. */
    const receiptMs = receipt();

    const parsed = CodeSubmitSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      socket.emit("error", { code: "BAD_PAYLOAD", message: "code.submit" });
      return;
    }
    const match = matches.get(parsed.data.matchId);
    const side = match?.sideOf(userId);
    if (!match || !side) {
      socket.emit("error", { code: "NO_MATCH", message: "unknown match" });
      return;
    }
    if (match.state !== "LIVE" && match.state !== "JUDGING") {
      socket.emit("error", { code: "NOT_LIVE", message: `cannot submit in ${match.state}` });
      return;
    }
    // §6.8b: unlimited attempts, one outstanding at a time. The lock IS the
    // cost of a wrong answer — no invented time penalty, and it caps judge
    // load at two concurrent jobs per match however hard anyone mashes.
    if (isInFlight(match.id, userId)) {
      socket.emit("error", { code: "IN_FLIGHT", message: "a submission is already being judged" });
      return;
    }

    void runSubmission(match, side, userId, parsed.data.language, parsed.data.source, receiptMs);
  });

  /* ── The keystroke relay (§10) ──────────────────────────────────────
     Every send of source text goes through `match.mayView`. There is no
     second path, and there must never be one: a competing player who can
     receive the opposing side's deltas has won, silently. */

  /** Who this socket is, relative to a given match. */
  const viewerFor = (match: LiveMatch): Viewer => {
    const side = match.sideOf(userId);
    if (side) return { kind: "player", side };
    return match.spectators.has(socket.id) ? { kind: "spectator" } : { kind: "none" };
  };

  const sendSnapshot = (match: LiveMatch, side: Side): void => {
    if (!match.mayView(viewerFor(match), side)) return;
    const doc = match.relay.doc(side);
    socket.emit("editor.snapshot", { matchId: match.id, side, seq: doc.seq, text: doc.text });
  };

  socket.on("editor.snapshot", (raw) => {
    if (!playerOnly("editor.snapshot")) return;
    const parsed = EditorSnapshotSchema.safeParse(raw ?? {});
    if (!parsed.success) return;
    const match = matches.get(parsed.data.matchId);
    const side = match?.sideOf(userId);
    // Only a player may assert ground truth, and only for their OWN editor.
    if (!match || !side) return;
    match.relay.reset(side, parsed.data.seq, parsed.data.text);
    void match.recordSnapshot(side, parsed.data.seq, parsed.data.text);
    fanOutSnapshot(match, side);
  });

  socket.on("editor.delta", (raw) => {
    if (!playerOnly("editor.delta")) return;
    const parsed = EditorDeltaSchema.safeParse(raw ?? {});
    if (!parsed.success) return;
    const match = matches.get(parsed.data.matchId);
    const side = match?.sideOf(userId);
    if (!match || !side) return;

    const applied = match.relay.apply(side, parsed.data);
    if (!applied) {
      /* A gap. Do not guess and do not apply — ask for ground truth. Splicing
         onto the wrong base yields plausible code nobody wrote. */
      const doc = match.relay.doc(side);
      socket.emit("editor.desync", {
        matchId: match.id,
        expected: doc.seq + 1,
        got: parsed.data.seq,
      });
      return;
    }

    void match.recordDelta(applied);
    fanOutDelta(match, side, parsed.data);
  });

  socket.on("editor.resync", (raw) => {
    const parsed = EditorResyncSchema.safeParse(raw ?? {});
    if (!parsed.success) return;
    const match = matches.get(parsed.data.matchId);
    if (!match) return;
    const sides: Side[] = parsed.data.side ? [parsed.data.side] : ["p1", "p2"];
    for (const side of sides) sendSnapshot(match, side);
  });

  /** Attach this socket as a spectator, having already passed the identity check. */
  const attachSpectator = (match: LiveMatch): void => {
    match.spectators.add(socket.id);
    socket.emit("spectate.ready", {
      matchId: match.id,
      code: match.spectatorCode,
      p1: match.players.p1,
      p2: match.players.p2,
      problem: { title: match.problem.title, rating: match.problem.rating },
      delayMs: match.spectatorDelayMs,
      state: match.state,
    });
    for (const side of ["p1", "p2"] as const) sendSnapshot(match, side);
  };

  const refuseSpectate = (match: LiveMatch): boolean => {
    /* A player in their own live match may NOT watch it, by code or by id.
       This is the obvious bypass — a competitor holds their own match's
       spectator code by construction — and §7's 45s ranked delay does not
       close it, since 45-second-old source is still an enormous edge and
       unranked delay is zero. Refused by identity, at the gateway. */
    if (
      canSpectate({
        userId,
        p1UserId: match.players.p1.userId,
        p2UserId: match.players.p2.userId,
        matchOver: match.isOver,
      })
    ) {
      return false;
    }
    socket.emit("error", {
      code: "SELF_SPECTATE",
      message: "you cannot spectate a match you are playing in",
    });
    return true;
  };

  /* ── Challenge links (§7 Phase 2D) ───────────────────────────────────
     A SECOND PAIRING PATH INTO THE SAME createMatch. Not a second creation
     path: the lifecycle, the log, the accept window, the countdown, the hold
     and settlement are all the code matchmaking already uses, and
     probe:lifecycle asserts that under `viaChallenge` with the same
     assertions it uses for matchmaking. */
  socket.on("challenge.join", (raw) => {
    if (!playerOnly("challenge.join")) return;
    const parsed = ChallengeJoinSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      socket.emit("error", { code: "BAD_CODE", message: "malformed challenge code" });
      return;
    }
    const code = normaliseCode(parsed.data.code);
    if (!code) {
      socket.emit("error", { code: "BAD_CODE", message: "not a valid challenge code" });
      return;
    }
    void joinChallenge(session, code);
  });

  socket.on("spectate.watch", (raw) => {
    const parsed = SpectateWatchSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      socket.emit("error", { code: "BAD_CODE", message: "malformed code" });
      return;
    }
    const code = normaliseCode(parsed.data.code);
    if (!code) {
      socket.emit("error", { code: "BAD_CODE", message: "not a valid spectator code" });
      return;
    }
    const match = [...matches.values()].find((m) => m.spectatorCode === code);
    if (!match) {
      /* THE ORACLE ARGUMENT DOES NOT APPLY TO FINISHED MATCHES.

         Refusing access while confirming validity is what leaks — an attacker
         learns which codes are real without being able to use them. But a
         finished match's code GRANTS access (to the replay, once Phase 3 ships
         it), so confirming validity tells the holder nothing they are not
         already entitled to.

         And the cost of conflating the two is real: a friend who clicks a
         shared link three minutes late sees something indistinguishable from a
         broken link, which is the single most likely way this feature gets
         used. So a valid code for an ended match says so; unknown and
         malformed codes keep the identical response. */
      void (async () => {
        const finished = await prisma.match
          .findUnique({
            where: { spectatorCode: code },
            select: {
              finishedAt: true,
              outcomeKind: true,
              p1: { select: { handle: true } },
              p2: { select: { handle: true } },
              problem: { select: { title: true } },
            },
          })
          .catch(() => null);

        if (finished) {
          socket.emit("spectate.ended", {
            code,
            p1: finished.p1.handle,
            p2: finished.p2.handle,
            problem: finished.problem.title,
            outcomeKind: finished.outcomeKind ?? "UNKNOWN",
            finishedAt: finished.finishedAt?.toISOString() ?? null,
          });
        } else {
          socket.emit("error", { code: "NO_LIVE_MATCH", message: "no live match for that code" });
        }
      })();
      return;
    }
    if (refuseSpectate(match)) return;
    attachSpectator(match);
  });

  socket.on("spectate.join", (raw) => {
    const parsed = EditorResyncSchema.safeParse(raw ?? {});
    if (!parsed.success) return;
    const match = matches.get(parsed.data.matchId);
    if (!match) {
      socket.emit("error", { code: "NO_MATCH", message: "unknown match" });
      return;
    }
    if (refuseSpectate(match)) return;
    attachSpectator(match);
  });

  socket.on("pulse.report", (raw) => {
    if (!playerOnly("pulse.report")) return;
    const parsed = PulseReportSchema.safeParse(raw ?? {});
    if (!parsed.success) return;
    const match = matches.get(parsed.data.matchId);
    const side = match?.sideOf(userId);
    if (!match || !side) return;
    // Rate only, never content (§6.4). Relayed to the opponent, not echoed.
    emitToSide(match, side === "p1" ? "p2" : "p1", "opponent.pulse", {
      matchId: match.id,
      side,
      keys: parsed.data.keys,
    });
  });

  socket.on("disconnect", () => {
    for (const match of matches.values()) match.spectators.delete(socket.id);
    session.sockets.delete(socket.id);
    if (session.sockets.size > 0) return; // another tab is still open

    console.log(`[gateway] ${identity.handle} disconnected`);
    /* Leave the POOL but keep the INTENT. A socket that is gone must not be
       matched, and a player who is coming straight back should not have to
       re-queue by hand — least of all silently. */
    stopQueueTimers(session);
    void matchmaker.leave(userId);

    const matchId = userMatch.get(userId);
    const match = matchId ? matches.get(matchId) : undefined;
    const side = match?.sideOf(userId);
    if (match && side) void match.disconnected(side);
    else sessions.delete(userId);
  });
});

/* ── Lifecycle ────────────────────────────────────────────────────────── */

async function shutdown(): Promise<void> {
  console.log("[gateway] shutting down; closing open replay logs");
  await Promise.all([...matches.values()].map((m) => m.abandonNow()));
  await redis.quit();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
process.on("uncaughtException", (e) => console.error("[gateway] uncaught (continuing):", e));
process.on("unhandledRejection", (e) => console.error("[gateway] unhandled (continuing):", e));

http.listen(PORT, () => {
  console.log(`[gateway] listening on :${PORT}, origins ${WEB_ORIGINS.join(", ")}`);
});
