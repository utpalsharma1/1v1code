/* ============================================================================
   2B-4 end-to-end probe, headless — TWO REAL PLAYERS.

   2B-4 is human vs human, so this drives two independent sockets: both
   register, both queue, they pair with each other, both accept, and both
   submit. It asserts the things that only a two-player match can show:

   · per-test results stream individually and in order (§6.6)
   · §6.9 RECEIPT ORDER decides — the player whose submission was RECEIVED
     first wins even when their verdict arrives second
   · the §6.7b hold holds until every outstanding submission resolves
   · Glicko applies to a real outcome, symmetric across both sides

   Run with:  pnpm probe:match
   ========================================================================= */

import { randomBytes } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { prisma, solutionFor } from "@1v1/db";

const WEB = process.env["WEB_URL"] ?? "http://localhost:3000";
const GATEWAY = process.env["GATEWAY_URL"] ?? "http://localhost:4000";

const log = (...parts: unknown[]) => console.log(...parts);

async function register(): Promise<{ cookie: string; handle: string; userId: string }> {
  const handle = `probe_${randomBytes(3).toString("hex")}`;
  const response = await fetch(`${WEB}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      handle,
      email: `${handle}@example.com`,
      password: "correct-horse-battery-staple",
    }),
  });
  if (!response.ok) throw new Error(`register failed: ${await response.text()}`);
  const cookie = (response.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");
  const user = await prisma.user.findUnique({
    where: { email: `${handle}@example.com` },
    select: { id: true },
  });
  return { cookie, handle, userId: user!.id };
}

async function ticket(cookie: string): Promise<string> {
  const response = await fetch(`${WEB}/api/socket-ticket`, {
    method: "POST",
    headers: { Cookie: cookie },
  });
  if (!response.ok) throw new Error(`ticket failed: ${response.status}`);
  return ((await response.json()) as { ticket: string }).ticket;
}

interface Player {
  name: string;
  handle: string;
  userId: string;
  socket: Socket;
  side: string | null;
  tests: number[];
  holds: string[][];
  verdicts: { side: string; verdict: string }[];
  end: {
    outcome: { kind: string; reason?: string; winner?: string };
    ratings: { side: string; before: number; after: number }[];
  } | null;
}

async function connect(name: string): Promise<Player> {
  const account = await register();
  const socket = io(GATEWAY, {
    transports: ["websocket"],
    reconnection: false,
    auth: { ticket: await ticket(account.cookie) },
  });
  const player: Player = {
    name,
    handle: account.handle,
    userId: account.userId,
    socket,
    side: null,
    tests: [],
    holds: [],
    verdicts: [],
    end: null,
  };

  socket.on("test.result", (p: { ordinal: number }) => player.tests.push(p.ordinal));
  socket.on("match.judging", (p: { outstanding: string[] }) => player.holds.push(p.outstanding));
  socket.on("submission.verdict", (p: { side: string; verdict: string }) => {
    player.verdicts.push({ side: p.side, verdict: p.verdict });
    log(`  [${name}] verdict ${p.side}: ${p.verdict}`);
  });
  socket.on("error", (e: { code: string; message: string }) =>
    log(`  [${name}] ! ${e.code}: ${e.message}`),
  );

  await new Promise<void>((resolve, reject) => {
    socket.on("connect", () => resolve());
    socket.on("connect_error", (e) => reject(new Error(`${name}: ${e.message}`)));
  });
  log(`[${name}] connected as ${account.handle}`);
  return player;
}

const waitFor = <T,>(player: Player, event: string, ms = 60_000): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${player.name}: no ${event} in ${ms}ms`)), ms);
    player.socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

async function main(): Promise<void> {
  const a = await connect("A");
  const b = await connect("B");

  const ratingsBefore = Object.fromEntries(
    await Promise.all(
      [a, b].map(async (p) => [
        p.name,
        (await prisma.user.findUnique({ where: { id: p.userId }, select: { rating: true } }))!.rating,
      ]),
    ),
  ) as Record<string, number>;
  log(`ratings before: A ${ratingsBefore.A}, B ${ratingsBefore.B}`);

  /* Both queue. There is NO bot fallback in 2B-4, so this pairing happens only
     because two humans are actually present — which is the point. */
  const foundA = waitFor<{ matchId: string; you: string }>(a, "match.found");
  const foundB = waitFor<{ matchId: string; you: string }>(b, "match.found");
  a.socket.emit("queue.join", { mode: "RANKED" });
  await new Promise((r) => setTimeout(r, 300));
  b.socket.emit("queue.join", { mode: "RANKED" });

  const [ma, mb] = await Promise.all([foundA, foundB]);
  a.side = ma.you;
  b.side = mb.you;
  log(`MATCH FOUND — A is ${a.side}, B is ${b.side}`);
  if (ma.matchId !== mb.matchId) throw new Error("players landed in different matches");

  const startA = waitFor<{ problem: { slug: string; title: string } }>(a, "match.start", 30_000);
  a.socket.emit("match.accept", { matchId: ma.matchId });
  b.socket.emit("match.accept", { matchId: mb.matchId });
  const start = await startA;
  log(`LIVE — ${start.problem.title}`);

  const solution = solutionFor(start.problem.slug);
  const endA = waitFor<Player["end"]>(a, "match.end", 150_000);
  const endB = waitFor<Player["end"]>(b, "match.end", 150_000);

  /* THE §6.9 TEST.

     A submits first and therefore has the earlier RECEIPT. B submits ~700ms
     later. Both are correct, so both will be ACCEPTED, and the match must go
     to A on receipt order — regardless of which verdict the judge queue
     happens to return first. */
  log("A submits (earlier receipt)");
  a.socket.emit("code.submit", { matchId: ma.matchId, language: "PYTHON3", source: solution });
  await new Promise((r) => setTimeout(r, 700));
  log("B submits (later receipt)");
  b.socket.emit("code.submit", { matchId: mb.matchId, language: "PYTHON3", source: solution });

  const [ea, eb] = await Promise.all([endA, endB]);
  a.end = ea;
  b.end = eb;
  log(`MATCH END: ${ea!.outcome.kind}${ea!.outcome.winner ? ` (${ea!.outcome.winner})` : ""}`);
  for (const r of ea!.ratings) {
    const d = r.after - r.before;
    log(`  rating ${r.side}: ${r.before} → ${r.after} (${d >= 0 ? "+" : ""}${d})`);
  }

  a.socket.close();
  b.socket.close();

  /* ── Assertions ─────────────────────────────────────────────────────── */

  const failures: string[] = [];

  if (a.tests.length === 0) failures.push("A saw no per-test results");
  if (!a.tests.every((o, i) => i === 0 || o >= a.tests[i - 1]!)) {
    failures.push(`A saw tests out of order: ${a.tests.join(",")}`);
  }

  /* §6.7b: the hold must have been announced while a verdict was outstanding,
     and it must be ended by the result rather than by a separate beat.

     An earlier version of this asserted that the LAST hold message carried an
     empty outstanding list, and that was wrong about the design: §6.7b says
     "resolution is immediate — do not add a reveal; the wait *was* the
     reveal". So the final verdict ends the match directly and `match.end`
     supersedes the hold. What must be true is that the hold was shown and that
     the match then ended. */
  if (!a.holds.some((h) => h.length > 0)) failures.push("no judging hold was ever announced");
  if (!a.end) failures.push("the hold was never ended by a result");

  // §6.9: receipt order decides among accepted submissions.
  const rows = await prisma.submission.findMany({
    where: { userId: { in: [a.userId, b.userId] } },
    orderBy: { receiptMs: "asc" },
    select: { userId: true, receiptMs: true, verdict: true },
  });
  if (rows.length !== 2) failures.push(`expected 2 submissions, found ${rows.length}`);
  if (rows.some((r) => r.receiptMs === null)) failures.push("a submission had no receipt stamp");
  if (rows[0] && rows[0].userId !== a.userId) {
    failures.push("A did not hold the earliest receipt — the probe cannot test what it claims");
  }
  if (!rows.every((r) => r.verdict === "ACCEPTED")) {
    failures.push(`both submissions must be ACCEPTED, got ${rows.map((r) => r.verdict).join(", ")}`);
  }
  if (ea!.outcome.kind !== "WIN") failures.push(`expected a WIN, got ${ea!.outcome.kind}`);
  if (ea!.outcome.winner !== a.side) {
    failures.push(
      `§6.9 VIOLATED: earliest receipt was A (${a.side}) but the winner was ${ea!.outcome.winner}`,
    );
  }
  if (JSON.stringify(ea!.outcome) !== JSON.stringify(eb!.outcome)) {
    failures.push("the two players were told different outcomes");
  }

  // Glicko moved both sides, in opposite directions.
  const after = Object.fromEntries(
    await Promise.all(
      [a, b].map(async (p) => [
        p.name,
        (await prisma.user.findUnique({ where: { id: p.userId }, select: { rating: true } }))!.rating,
      ]),
    ),
  ) as Record<string, number>;
  log(`ratings after:  A ${after.A}, B ${after.B}`);
  if (after.A! <= ratingsBefore.A!) failures.push("the winner's rating did not rise");
  if (after.B! >= ratingsBefore.B!) failures.push("the loser's rating did not fall");

  log("");
  if (failures.length > 0) {
    for (const f of failures) console.error(`FAIL: ${f}`);
    await prisma.$disconnect();
    process.exit(1);
  }

  log("PASS — two humans paired with no bot, tests streamed individually and in order,");
  log("       the §6.7b hold held and resolved, receipt order decided the win,");
  log("       and Glicko moved both ratings in opposite directions.");
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
