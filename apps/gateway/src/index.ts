import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import Redis from "ioredis";
import { Server, type Socket } from "socket.io";
import { generateCode, monotonicMs } from "@1v1/core";
import { prisma } from "@1v1/db";
import {
  CodeSubmitSchema,
  MatchAcceptSchema,
  PulseReportSchema,
  QueueJoinSchema,
  type Language,
  type PlayerCard,
  type Side,
} from "@1v1/proto";
import { LiveMatch, type MatchProblem } from "./live-match.ts";
import { Matchmaker, bandFor } from "./matchmaking.ts";
import { applyOutcome, snapshot, type RatingSnapshot } from "./rating.ts";
import { SubmissionRunner, isInFlight, receipt } from "./submissions.ts";
import { identify, identifyById, type Identity } from "./session.ts";

/* ============================================================================
   Gateway (§10, §12 Phase 2B-2)

   EVERYTHING IS KEYED ON USER ID, NEVER SOCKET ID. A reconnect produces a new
   socket; if identity were the socket, a returning player would arrive as a
   stranger instead of as the person who is mid-match. Socket ids are used only
   to address a transport.
   ========================================================================= */

const PORT = Number(process.env["GATEWAY_PORT"] ?? "4000");
const REDIS_URL = process.env["REDIS_URL"] ?? "redis://localhost:6379";
const WEB_ORIGIN = process.env["WEB_ORIGIN"] ?? "http://localhost:3000";

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
  cors: { origin: WEB_ORIGIN, credentials: true },
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
          emitToSide(match, other, "opponent.status", {
            matchId: match.id,
            side,
            status: "submitted",
            passed: 0,
            total,
          });
        },
        onStatus: (status) => {
          // §6.5 compile pulse: the opponent feels it, without seeing anything.
          emitToSide(match, other, "opponent.status", {
            matchId: match.id,
            side,
            status,
            passed: 0,
            total: 0,
          });
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
          // The opponent's bar fills from counts alone (§6.4).
          emitToSide(match, other, "opponent.status", {
            matchId: match.id,
            side,
            status: "running",
            passed,
            total,
          });
        },
        onVerdict: (result) => {
          accepted = result.verdict === "ACCEPTED";
          // §6.9: our failure, not theirs. Voids the match, costs nobody rating.
          internalError = result.verdict === "INTERNAL_ERROR";
          toMatch(match, "submission.verdict", {
            matchId: match.id,
            submissionId,
            side,
            verdict: result.verdict,
            passed: result.passed,
            total: result.total,
            failedAt: result.failedAt,
            message: result.message,
          });
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
async function pickProblem(r1: number, r2: number, spread: number): Promise<MatchProblem | null> {
  const target = (r1 + r2) / 2 - 120;
  const lo = target - spread;
  const hi = target + spread;

  const inBand = await prisma.problem.findMany({
    where: { rating: { gte: lo, lte: hi } },
    select: { id: true, slug: true, title: true, rating: true, statement: true, constraints: true },
  });

  const pool = inBand.length > 0
    ? inBand
    : await prisma.problem.findMany({
        take: 5,
        orderBy: { rating: "asc" },
        select: { id: true, slug: true, title: true, rating: true, statement: true, constraints: true },
      });

  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

async function cardFor(identity: Identity): Promise<PlayerCard> {
  return {
    userId: identity.userId,
    handle: identity.handle,
    rating: identity.rating,
    tier: "gold",
    division: "II",
    isBot: identity.isBot,
  };
}

/** Writes the Match row at LIVE, so submissions have something to reference. */
async function persistMatch(match: LiveMatch, problemId: string): Promise<void> {
  try {
    await prisma.match.create({
      data: {
        id: match.id,
        spectatorCode: generateCode(),
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

  toMatch(match, "match.end", {
    matchId: match.id,
    outcome,
    ratings,
    elapsedMs: Math.round(Math.max(match.elapsedFor("p1"), match.elapsedFor("p2"))),
  });
}

/* ── Match creation ───────────────────────────────────────────────────── */

async function createMatch(a: Identity, b: Identity): Promise<void> {
  const spread = 150;
  const problem = await pickProblem(a.rating, b.rating, spread);
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

  const id = randomUUID();
  const problemRow = problem;
  const match: LiveMatch = new LiveMatch({
    id,
    players: { p1: await cardFor(a), p2: await cardFor(b) },
    problem,
    emitTo: (side, event, payload) => emitToSide(match, side, event, payload),
    emit: (event, payload) => {
      toMatch(match, event, payload);
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
    const userId = await redis.getdel(`socket:ticket:${ticket}`);
    if (userId) {
      identity = await identifyById(userId);
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

  socket.on("queue.join", (raw) => {
    const parsed = QueueJoinSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      socket.emit("error", { code: "BAD_PAYLOAD", message: "queue.join" });
      return;
    }
    void joinQueue(session);
  });

  socket.on("queue.leave", () => void leaveQueue(session));

  socket.on("match.accept", (raw) => {
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

  socket.on("pulse.report", (raw) => {
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
  console.log(`[gateway] listening on :${PORT}, origin ${WEB_ORIGIN}`);
});
