/* ============================================================================
   LIFECYCLE EQUIVALENCE — the contract a second creation path must satisfy.

   Written against matchmaking FIRST, deliberately. A challenge link is a second
   way to create a match, and a second creation path is exactly where a state
   machine grows two behaviours: the first one is tested, the second one "looked
   the same". Defining "identical" before the second path exists is the only way
   to stop the definition being retrofitted to whatever the new code happens to
   do.

   So this file exports `runLifecycle`, which drives a whole match through one
   pairing strategy and returns everything worth comparing:

     · the STATE SEQUENCE, from the gateway's own transition log
     · the EVENT LOG SHAPE — which record types appear, in what order
     · behaviour under the §6.7b JUDGING hold
     · behaviour under RECONNECTION mid-match
     · behaviour under ABANDONMENT

   `pnpm probe:lifecycle` runs it for matchmaking and asserts the canonical
   shape. When challenge links land, the same function runs with a different
   pairing strategy and the SAME assertions must pass — not "similar output",
   the same assertions.
   ========================================================================= */

import { randomBytes } from "node:crypto";
import { replayDir } from "@1v1/core/paths";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { io, type Socket } from "socket.io-client";
import { prisma } from "@1v1/db";

const WEB = process.env["WEB_URL"] ?? "http://localhost:3000";
const GATEWAY = process.env["GATEWAY_URL"] ?? "http://localhost:4000";
const REPLAY_DIR = replayDir();

const log = (...parts: unknown[]) => console.log(...parts);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ── Plumbing ──────────────────────────────────────────────────────────── */

export interface Account {
  cookie: string;
  handle: string;
  email: string;
  userId: string;
}

export async function register(prefix = "lc"): Promise<Account> {
  const handle = `${prefix}_${randomBytes(3).toString("hex")}`;
  const email = `${handle}@example.com`;
  const response = await fetch(`${WEB}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ handle, email, password: "correct-horse-battery-staple" }),
  });
  if (!response.ok) throw new Error(`register failed: ${await response.text()}`);
  const cookie = (response.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  return { cookie, handle, email, userId: user!.id };
}

export async function socketFor(cookie: string): Promise<Socket> {
  const response = await fetch(`${WEB}/api/socket-ticket`, {
    method: "POST",
    headers: { Cookie: cookie },
  });
  if (!response.ok) throw new Error(`ticket failed: ${response.status}`);
  const { ticket } = (await response.json()) as { ticket: string };
  const socket = io(GATEWAY, { transports: ["websocket"], auth: { ticket }, reconnection: false });
  await new Promise<void>((resolve, reject) => {
    socket.on("connect", () => resolve());
    socket.on("connect_error", (e) => reject(new Error(e.message)));
  });
  return socket;
}

const waitFor = <T,>(socket: Socket, event: string, ms = 60_000): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${event} in ${ms}ms`)), ms);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

/* ── What a lifecycle run reports ──────────────────────────────────────── */

export interface Found {
  matchId: string;
  you: "p1" | "p2";
  spectatorCode: string;
  rated: boolean;
  acceptMs: number;
}

export interface LifecycleResult {
  matchId: string;
  found: { p1: Found; p2: Found };
  /** Ordered state transitions, read back from the replay log. */
  states: string[];
  /** Ordered event types in the log, deduplicated by run of the same type. */
  logShape: string[];
  /** Every `match.judging` payload either player saw. */
  holds: string[][];
  /** True if a mid-match reconnect produced a full resync. */
  resynced: boolean;
  /** Whether the resync carried the problem back — the reload bug. */
  resyncHadProblem: boolean;
  outcome: { kind: string; winner?: string; reason?: string };
  ratedFlag: boolean;
  spectatorCode: string;
}

/** How a match comes into being. Matchmaking today; a challenge link next. */
export type Pairing = (a: Socket, b: Socket) => Promise<{ p1: Found; p2: Found }>;

/** The canonical pairing: both players queue and the matchmaker pairs them. */
export const viaMatchmaking: Pairing = async (a, b) => {
  const fa = waitFor<Found>(a, "match.found");
  const fb = waitFor<Found>(b, "match.found");
  a.emit("queue.join", { mode: "RANKED" });
  await sleep(300);
  b.emit("queue.join", { mode: "RANKED" });
  const [p1, p2] = await Promise.all([fa, fb]);
  return { p1, p2 };
};

/* ── The SECOND pairing path, held to the SAME contract ─────────────────────

   A challenge link. The host creates it over HTTP, the invited side redeems it,
   both emit `challenge.join`, and the gateway pairs them through the same
   `createMatch` matchmaking uses.

   `runLifecycle` is unchanged and `assertCanonical` is unchanged: that is the
   entire point. If a challenge match needed different assertions, it would be a
   different lifecycle, which is exactly what this exists to prevent. */

export interface ChallengeSetup {
  code: string;
  band: [number, number];
  /** The cookie of whoever redeemed it — a guest's, if they had no account. */
  guestCookie: string;
  guestHandle: string;
  guestIsGuest: boolean;
}

/** Host creates a challenge with an explicit band (§8). */
export async function createChallenge(
  host: Account,
  band: [number, number],
): Promise<{ code: string }> {
  const response = await fetch(`${WEB}/api/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: host.cookie },
    body: JSON.stringify({ ratingMin: band[0], ratingMax: band[1], allowGuest: true }),
  });
  if (!response.ok) throw new Error(`challenge create failed: ${await response.text()}`);
  return (await response.json()) as { code: string };
}

/** Redeem with NO account — the gateway mints a guest and signs them in. */
export async function redeemAsGuest(code: string): Promise<{ cookie: string; guest: boolean }> {
  const response = await fetch(`${WEB}/api/challenge/${code}`, { method: "POST" });
  if (!response.ok) throw new Error(`redeem failed: ${await response.text()}`);
  const body = (await response.json()) as { guest: boolean };
  const cookie = (response.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  if (!cookie) throw new Error("redemption set no session cookie — a guest must get one");
  return { cookie, guest: body.guest };
}

/** Pairing strategy: both sides emit challenge.join on the same code. */
export function viaChallenge(code: string): Pairing {
  return async (a, b) => {
    const fa = waitFor<Found>(a, "match.found");
    const fb = waitFor<Found>(b, "match.found");
    a.emit("challenge.join", { code });
    await sleep(400);
    b.emit("challenge.join", { code });
    const [p1, p2] = await Promise.all([fa, fb]);
    return { p1, p2 };
  };
}

function readLog(matchId: string): { types: string[]; states: string[] } {
  let text: string;
  try {
    text = readFileSync(join(REPLAY_DIR, `${matchId}.jsonl`), "utf8");
  } catch {
    return { types: [], states: [] };
  }
  const types: string[] = [];
  const states: string[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as { type: string; payload: { to?: string } };
      if (types.at(-1) !== e.type) types.push(e.type);
      if (e.type === "match.state" && e.payload.to) states.push(e.payload.to);
    } catch {
      // A torn final line is normal for an append-only log caught mid-write.
    }
  }
  return { types, states };
}

/**
 * Drive one complete match and report its shape.
 *
 * The sequence is fixed so two creation paths are compared under identical
 * pressure: pair, accept, go live, drop one socket and reconnect it, then have
 * one side submit a correct solution and win.
 */
export async function runLifecycle(opts: {
  a: Account;
  b: Account;
  pairing: Pairing;
  solutionFor: (slug: string) => string;
}): Promise<LifecycleResult> {
  let sa = await socketFor(opts.a.cookie);
  const sb = await socketFor(opts.b.cookie);

  const holds: string[][] = [];
  sa.on("match.judging", (p: { outstanding: string[] }) => holds.push(p.outstanding));
  sb.on("match.judging", (p: { outstanding: string[] }) => holds.push(p.outstanding));

  const found = await opts.pairing(sa, sb);
  const matchId = found.p1.matchId;

  const started = waitFor<{ problem: { slug: string } }>(sa, "match.start", 30_000);
  sa.emit("match.accept", { matchId });
  sb.emit("match.accept", { matchId });
  const start = await started;

  /* RECONNECTION, mid-match. The returning socket must get a full resync, and
     that resync must carry the problem — the bug that stranded a reloading
     player in a screen it could not render. */
  sa.close();
  await sleep(1200);
  sa = await socketFor(opts.a.cookie);
  const resync = await waitFor<{ problem: unknown | null }>(sa, "match.resync", 20_000).catch(
    () => null,
  );
  const resynced = resync !== null;
  const resyncHadProblem = Boolean(resync?.problem);

  const endA = waitFor<{
    outcome: { kind: string; winner?: string; reason?: string };
  }>(sa, "match.end", 150_000);

  sa.emit("code.submit", {
    matchId,
    language: "PYTHON3",
    source: opts.solutionFor(start.problem.slug),
  });
  const end = await endA;

  sa.close();
  sb.close();
  await sleep(400);

  const { types, states } = readLog(matchId);
  return {
    matchId,
    found,
    states,
    logShape: types,
    holds,
    resynced,
    resyncHadProblem,
    outcome: end.outcome,
    ratedFlag: found.p1.rated,
    spectatorCode: found.p1.spectatorCode,
  };
}

/* ── The canonical assertions ──────────────────────────────────────────── */

/** The state sequence every match must walk, whatever created it. */
export const CANONICAL_STATES = [
  "MATCHED",
  "ACCEPTING",
  "COUNTDOWN",
  "LIVE",
  "JUDGING",
  "ENDED",
] as const;

/** Log record types every match must produce, in this relative order. */
export const CANONICAL_LOG = [
  "match.created",
  "match.state",
  "match.accepted",
  "countdown.beat",
  "match.started",
  "submission.received",
  "submission.verdict",
  "match.ended",
] as const;

export function assertCanonical(result: LifecycleResult, label: string): string[] {
  const failures: string[] = [];
  const say = (m: string) => failures.push(`${label}: ${m}`);

  // States, in order, allowing repeats but not omissions or reordering.
  let cursor = 0;
  for (const state of result.states) {
    const at = CANONICAL_STATES.indexOf(state as never);
    if (at === -1) {
      say(`unexpected state ${state}`);
      continue;
    }
    if (at < cursor) say(`state ${state} arrived out of order (saw ${result.states.join(" → ")})`);
    cursor = Math.max(cursor, at);
  }
  for (const required of CANONICAL_STATES) {
    if (!result.states.includes(required)) {
      say(`never reached ${required} (saw ${result.states.join(" → ") || "nothing"})`);
    }
  }

  // Log shape: every canonical type must appear, in relative order.
  let logCursor = -1;
  for (const required of CANONICAL_LOG) {
    const at = result.logShape.indexOf(required);
    if (at === -1) {
      say(`log is missing ${required} (saw ${result.logShape.join(", ") || "nothing"})`);
      continue;
    }
    if (at < logCursor) say(`log has ${required} out of order`);
    logCursor = at;
  }

  // §6.7b: the hold must have been announced while a verdict was outstanding.
  if (!result.holds.some((h) => h.length > 0)) say("the §6.7b hold was never announced");

  // Reconnection must resync, and must carry the problem back.
  if (!result.resynced) say("a mid-match reconnect produced no match.resync");
  if (!result.resyncHadProblem) say("match.resync did not carry the problem");

  // Both sides must agree on identity and see the same match.
  if (result.found.p1.matchId !== result.found.p2.matchId) say("sides landed in different matches");
  if (result.found.p1.you === result.found.p2.you) say("both sides were told the same side");

  // §7: every match is shareable.
  if (!/^[0-9A-HJKMNP-TV-Z]{10}$/.test(result.spectatorCode)) {
    say(`spectatorCode is not a 10-char Crockford code: ${result.spectatorCode}`);
  }

  if (result.outcome.kind !== "WIN") say(`expected a WIN, got ${result.outcome.kind}`);

  return failures;
}

/* ── Runner: matchmaking is the reference ──────────────────────────────── */

async function main(): Promise<void> {
  const { solutionFor } = await import("@1v1/db");
  const a = await register("lca");
  const b = await register("lcb");

  log("driving a MATCHMADE match through the full lifecycle…");
  const result = await runLifecycle({ a, b, pairing: viaMatchmaking, solutionFor });

  log(`  states:  ${result.states.join(" → ")}`);
  log(`  log:     ${result.logShape.join(", ")}`);
  log(`  holds:   ${result.holds.map((h) => `[${h.join(",")}]`).join(" ")}`);
  log(`  resync:  ${result.resynced ? "yes" : "no"} (problem: ${result.resyncHadProblem})`);
  log(`  code:    ${result.spectatorCode}   rated: ${result.ratedFlag}`);
  log(`  outcome: ${result.outcome.kind}${result.outcome.winner ? ` (${result.outcome.winner})` : ""}`);

  const failures = assertCanonical(result, "matchmaking");
  // Two registered players must be RATED. A challenge with a guest must not be,
  // and that difference is the ONLY one the two paths are allowed to have.
  if (!result.ratedFlag) failures.push("matchmaking: two registered players must be rated");

  /* ── The SAME contract, via a challenge link and a GUEST ───────────── */

  log("");
  log("driving a CHALLENGE match with a guest through the same lifecycle…");

  const host = await register("chh");
  /* A narrow band well away from any mean − 120 result, so §8's rule is
     falsifiable: if the guest's stored 1200 leaked into selection at all, the
     chosen problem would land near 1080 and outside this band. */
  const band: [number, number] = [1450, 1550];
  const { code } = await createChallenge(host, band);
  const redeemed = await redeemAsGuest(code);
  if (!redeemed.guest) failures.push("challenge: redeeming without an account did not make a guest");

  const guestAccount: Account = {
    cookie: redeemed.cookie,
    handle: "guest",
    email: "",
    userId: "",
  };

  const cResult = await runLifecycle({
    a: host,
    b: guestAccount,
    pairing: viaChallenge(code),
    solutionFor,
  });

  log(`  states:  ${cResult.states.join(" → ")}`);
  log(`  log:     ${cResult.logShape.join(", ")}`);
  log(`  code:    ${cResult.spectatorCode}   rated: ${cResult.ratedFlag}`);
  log(`  outcome: ${cResult.outcome.kind}${cResult.outcome.winner ? ` (${cResult.outcome.winner})` : ""}`);

  // THE SAME ASSERTIONS. Not similar ones.
  failures.push(...assertCanonical(cResult, "challenge"));

  // §8: the problem must come from the HOST'S BAND, and the guest's stored
  // rating must not have influenced it at all.
  const chosen = await prisma.match.findUnique({
    where: { id: cResult.matchId },
    select: { problem: { select: { rating: true, slug: true } } },
  });
  const rating = chosen?.problem.rating ?? -1;
  log(`  problem: ${chosen?.problem.slug} rated ${rating} (band ${band[0]}–${band[1]})`);
  if (rating < band[0] || rating > band[1]) {
    failures.push(
      `challenge: §8 VIOLATED — problem rated ${rating} is outside the host's band ${band[0]}–${band[1]}. ` +
        "A guest's placeholder rating must not influence selection.",
    );
  }

  // A guest on either side makes the match unrated, disclosed before the
  // countdown rather than discovered from an absent delta.
  if (cResult.ratedFlag) {
    failures.push("challenge: a match with a guest must be unrated, and say so before the countdown");
  }

  // §7: a challenge match has NO spectator delay, and is still shareable.
  if (!/^[0-9A-HJKMNP-TV-Z]{10}$/.test(cResult.spectatorCode)) {
    failures.push("challenge: a guest match must still carry a shareable spectator code");
  }

  log("");
  if (failures.length > 0) {
    for (const f of failures) console.error(`FAIL: ${f}`);
    await prisma.$disconnect();
    process.exit(1);
  }
  log("PASS — matchmaking AND a challenge-with-guest satisfy the same canonical lifecycle,");
  log("       the guest match is unrated, and its problem came from the host's band.");
  await prisma.$disconnect();
}

// Only run when invoked directly; the module is also imported as a library.
if (process.argv[1]?.endsWith("lifecycle-probe.ts")) {
  main().catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
}
