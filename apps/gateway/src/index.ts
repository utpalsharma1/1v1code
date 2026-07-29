import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import Redis from "ioredis";
import { Server, type Socket } from "socket.io";
import { monotonicMs } from "@1v1/core";
import { prisma } from "@1v1/db";
import { MatchAcceptSchema, QueueJoinSchema, type PlayerCard, type Side } from "@1v1/proto";
import { LiveMatch, type MatchProblem } from "./live-match.ts";
import { Matchmaker, bandFor } from "./matchmaking.ts";
import { identify, type Identity } from "./session.ts";

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
/** A pool of one is the normal case in development, not an edge case (§6.1). */
const BOT_AFTER_MS = Number(process.env["MM_BOT_AFTER_MS"] ?? "20000");

const redis = new Redis(REDIS_URL);
const matchmaker = new Matchmaker(redis);

/* ── Presence, keyed on user id ───────────────────────────────────────── */

interface Session {
  identity: Identity;
  sockets: Set<string>;
  queuedAt: number | null;
  queueTimer: NodeJS.Timeout | null;
  botTimer: NodeJS.Timeout | null;
  matchId: string | null;
}

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
    select: { slug: true, title: true, rating: true, statement: true, constraints: true },
  });

  const pool = inBand.length > 0
    ? inBand
    : await prisma.problem.findMany({
        take: 5,
        orderBy: { rating: "asc" },
        select: { slug: true, title: true, rating: true, statement: true, constraints: true },
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

/* ── Match creation ───────────────────────────────────────────────────── */

async function createMatch(a: Identity, b: Identity): Promise<void> {
  const spread = 150;
  const problem = await pickProblem(a.rating, b.rating, spread);
  if (!problem) {
    toUser(a.userId, "error", { code: "NO_PROBLEM", message: "No problems seeded." });
    toUser(b.userId, "error", { code: "NO_PROBLEM", message: "No problems seeded." });
    return;
  }

  const id = randomUUID();
  const match = new LiveMatch({
    id,
    players: { p1: await cardFor(a), p2: await cardFor(b) },
    problem,
    emit: (event, payload) => toMatch(match, event, payload),
    onFinished: (finished) => {
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
    const session = sessions.get(userId);
    if (session) {
      session.matchId = id;
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
  if (session.botTimer) clearTimeout(session.botTimer);
  session.queueTimer = null;
  session.botTimer = null;
  session.queuedAt = null;
}

async function botIdentity(): Promise<Identity | null> {
  const bot = await prisma.user.findFirst({
    where: { handle: { startsWith: "bot_" } },
    select: { id: true, handle: true, rating: true, ratingDev: true, volatility: true },
  });
  if (!bot) return null;
  return {
    userId: bot.id,
    handle: bot.handle,
    rating: bot.rating,
    ratingDeviation: bot.ratingDev,
    volatility: bot.volatility,
    isBot: true,
  };
}

async function joinQueue(session: Session): Promise<void> {
  if (session.matchId) return;
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

    if (pair) {
      const partner = sessions.get(pair.partnerId);
      if (!partner) {
        // The partner vanished between joining and pairing. Requeue rather
        // than stranding this player.
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

    toUser(session.identity.userId, "queue.status", {
      elapsedMs: elapsed,
      ratingBand: [session.identity.rating - half, session.identity.rating + half],
      widening,
      inQueue: await matchmaker.size(),
    });
  };

  await attempt();
  session.queueTimer = setInterval(() => void attempt(), 2000);

  // §6.1: a pool of one is our actual situation. Fall back to the bot rather
  // than leaving a solo developer staring at a spinner forever.
  session.botTimer = setTimeout(() => {
    void (async () => {
      if (session.matchId || session.queuedAt === null) return;
      const bot = await botIdentity();
      if (!bot || bot.userId === session.identity.userId) return;
      await matchmaker.leave(session.identity.userId);
      stopQueueTimers(session);
      console.log(`[gateway] ${session.identity.handle} -> bot fallback after ${BOT_AFTER_MS}ms`);
      await createMatch(session.identity, bot);
    })();
  }, BOT_AFTER_MS);
}

async function leaveQueue(session: Session): Promise<void> {
  stopQueueTimers(session);
  await matchmaker.leave(session.identity.userId);
  toUser(session.identity.userId, "queue.left", {});
}

/* ── Socket lifecycle ─────────────────────────────────────────────────── */

io.use(async (socket, next) => {
  const identity = await identify(socket.handshake.headers.cookie);
  if (!identity) {
    next(new Error("unauthenticated: no valid session cookie"));
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
      botTimer: null,
      matchId: userMatch.get(userId) ?? null,
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

    // The bot accepts immediately so a solo developer is never blocked.
    const other: Side = side === "p1" ? "p2" : "p1";
    if (match.players[other].isBot) void match.accept(other);
  });

  socket.on("disconnect", () => {
    session.sockets.delete(socket.id);
    if (session.sockets.size > 0) return; // another tab is still open

    console.log(`[gateway] ${identity.handle} disconnected`);
    void leaveQueue(session);

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
  console.log(`[gateway] listening on :${PORT}, origin ${WEB_ORIGIN}, bot after ${BOT_AFTER_MS}ms`);
});
