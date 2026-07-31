/* ============================================================================
   ADVERSARIAL: try to steal the opponent's source. Fail to.

   A test that asserts "the opponent's socket received no deltas" is the same
   shape as the containment suite asserting no escape while nothing executed —
   it passes trivially if the attacker never actually tried. So this one
   attacks:

     · subscribes with a wildcard to EVERY event the socket can deliver, not a
       list of names we happened to think of
     · asks for the opponent's editor directly via editor.resync
     · asks for BOTH sides via editor.resync with no side, the greedy form
     · tries to join its own live match as a spectator, which would be the
       one-click bypass
     · sends a snapshot claiming to be the opponent's editor, to check the
       gateway attributes by identity rather than by payload
     · makes the victim fail three different ways — compile error, runtime
       traceback, wrong-answer stdout — each with a secret embedded, and checks
       the verdict channel discloses none of it
     · uses its OWN MATCH'S SPECTATOR CODE against the /watch path, which is
       the obvious bypass now that the code is printed on the player's screen —
       a competitor holds it by construction
     · mints an ANONYMOUS watch ticket and tries the same code from it, in case
       identity is only checked on the signed-in path

   Then it asserts that a distinctive string typed by the victim appears in
   NOTHING the attacker received, from any of those paths.

   Positive control: run with BREAK_VISIBILITY=1 and the gateway relays deltas
   to the opponent, and this must fail. A green result against an enforcement
   that was never exercised is worth nothing.

   Run with:  pnpm probe:visibility
   ========================================================================= */

import { randomBytes } from "node:crypto";
import { deleteProbeUsers } from "./probe-cleanup.ts";
import { io, type Socket } from "socket.io-client";
import { prisma, solutionFor } from "@1v1/db";

const WEB = process.env["WEB_URL"] ?? "http://localhost:3000";
const GATEWAY = process.env["GATEWAY_URL"] ?? "http://localhost:4000";

/** If this ever reaches the attacker, by any route, the rule has failed. */
const SECRET = `SECRET_${randomBytes(8).toString("hex")}`;

const log = (...parts: unknown[]) => console.log(...parts);

async function account(): Promise<{ cookie: string; handle: string; email: string }> {
  const handle = `vis_${randomBytes(3).toString("hex")}`;
  const email = `${handle}@example.com`;
  const response = await fetch(`${WEB}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ handle, email, password: "correct-horse-battery-staple" }),
  });
  if (!response.ok) throw new Error(`register failed: ${await response.text()}`);
  const cookie = (response.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  return { cookie, handle, email };
}

async function connect(cookie: string): Promise<Socket> {
  const response = await fetch(`${WEB}/api/socket-ticket`, {
    method: "POST",
    headers: { Cookie: cookie },
  });
  const { ticket } = (await response.json()) as { ticket: string };
  const socket = io(GATEWAY, { transports: ["websocket"], auth: { ticket }, reconnection: false });
  await new Promise<void>((resolve, reject) => {
    socket.on("connect", () => resolve());
    socket.on("connect_error", (e) => reject(new Error(e.message)));
  });
  return socket;
}

/** A viewer with no account, exactly as /watch/<code> creates one. */
async function anonymousSocket(): Promise<Socket> {
  const response = await fetch(`${WEB}/api/watch-ticket`, { method: "POST" });
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

async function main(): Promise<void> {
  const failures: string[] = [];

  const victimAccount = await account();
  const attackerAccount = await account();
  const victim = await connect(victimAccount.cookie);
  const attacker = await connect(attackerAccount.cookie);

  /* THE ATTACKER'S NET: catch every event this socket can ever deliver, by
     name and payload, without naming any of them in advance. */
  const caught: { event: string; payload: string }[] = [];
  attacker.onAny((event: string, ...args: unknown[]) => {
    caught.push({ event, payload: JSON.stringify(args) });
  });

  const victimFound = waitFor<{ matchId: string; you: string }>(victim, "match.found");
  const attackerFound = waitFor<{ matchId: string; you: string }>(attacker, "match.found");
  victim.emit("queue.join", { mode: "RANKED" });
  await new Promise((r) => setTimeout(r, 300));
  attacker.emit("queue.join", { mode: "RANKED" });

  const [vf, af] = await Promise.all([victimFound, attackerFound]);
  const matchId = vf.matchId;
  log(`match ${matchId}: victim is ${vf.you}, attacker is ${af.you}`);

  const started = waitFor<{ problem: { slug: string } }>(victim, "match.start", 30_000);
  victim.emit("match.accept", { matchId });
  attacker.emit("match.accept", { matchId });
  const start = await started;
  log(`live on ${start.problem.slug}`);

  /* The victim types something unmistakable, through the real relay: a
     snapshot to establish ground truth, then deltas exactly as the editor
     sends them. */
  const secretLine = `# ${SECRET}\n`;
  victim.emit("editor.snapshot", { matchId, seq: 0, text: "" });
  await new Promise((r) => setTimeout(r, 200));
  victim.emit("editor.delta", {
    matchId,
    seq: 1,
    changes: [{ offset: 0, length: 0, text: secretLine }],
    origin: "type",
  });
  await new Promise((r) => setTimeout(r, 300));
  victim.emit("editor.delta", {
    matchId,
    seq: 2,
    changes: [{ offset: secretLine.length, length: 0, text: solutionFor(start.problem.slug) }],
    origin: "paste",
  });
  await new Promise((r) => setTimeout(r, 500));

  /* ── The attacks ──────────────────────────────────────────────────── */

  const victimSide = vf.you as "p1" | "p2";

  log("attack 1: ask for the opponent's editor directly");
  attacker.emit("editor.resync", { matchId, side: victimSide });
  await new Promise((r) => setTimeout(r, 400));

  log("attack 2: ask for every side at once");
  attacker.emit("editor.resync", { matchId });
  await new Promise((r) => setTimeout(r, 400));

  log("attack 3: spectate my own live match");
  attacker.emit("spectate.join", { matchId });
  await new Promise((r) => setTimeout(r, 600));

  log("attack 4: after 'spectating', ask again");
  attacker.emit("editor.resync", { matchId });
  await new Promise((r) => setTimeout(r, 600));

  log("attack 5: claim to be the opponent's editor, then read it back");
  attacker.emit("editor.snapshot", { matchId, seq: 99, text: "attacker owned this" });
  attacker.emit("editor.resync", { matchId, side: victimSide });
  await new Promise((r) => setTimeout(r, 600));

  /* The spectator code is on the attacker's own screen — they are playing in
     the match — so `/watch/<code>` is the path a competitor would actually
     reach for. It must be refused by identity exactly like spectate.join. */
  const code = (vf as unknown as { spectatorCode?: string }).spectatorCode ?? "";
  log(`attack 6: watch my own match by its spectator code (${code || "none sent"})`);
  if (!code) failures.push("match.found carried no spectatorCode — cannot test the /watch bypass");
  attacker.emit("spectate.watch", { code });
  await new Promise((r) => setTimeout(r, 700));

  log("attack 7: same code, from a fresh anonymous watch ticket");
  const anon = await anonymousSocket();
  const anonCaught: string[] = [];
  anon.onAny((event: string, ...args: unknown[]) => anonCaught.push(`${event} ${JSON.stringify(args)}`));
  anon.emit("spectate.watch", { code });
  await new Promise((r) => setTimeout(r, 900));

  /* An anonymous viewer SHOULD see the source — that is the product pitch, and
     §7 says watching needs no account. What it must not be able to do is play.
     So this asserts both halves: it got the code's stream, and every player
     action it tried was refused. */
  const anonSawSource = anonCaught.some((c) => c.includes(SECRET));
  if (!anonSawSource) {
    failures.push("an anonymous viewer could NOT see the match — §7 says watching needs no account");
  }
  for (const [event, payload] of [
    ["queue.join", { mode: "RANKED" }],
    ["code.submit", { matchId, language: "PYTHON3", source: "print(1)" }],
    ["editor.delta", { matchId, seq: 1, changes: [{ offset: 0, length: 0, text: "x" }], origin: "type" }],
  ] as const) {
    anonCaught.length = 0;
    anon.emit(event as never, payload as never);
    await new Promise((r) => setTimeout(r, 250));
    if (!anonCaught.some((c) => c.includes("SPECTATOR_ONLY"))) {
      failures.push(`an anonymous socket was not refused ${event}`);
    }
  }
  anon.close();

  /* ── The VERDICT channel, attacked on its own terms ─────────────────
     The compile-error leak had siblings, and each was a field that looked
     harmless. So the victim now deliberately fails in three different ways
     while printing a secret, and we assert none of it reaches the attacker. */

  log("attack 8: victim compile-fails with the secret in the source");
  const compileFail = `def main(  # ${SECRET}\n    this is not python`;
  victim.emit("code.submit", { matchId, language: "PYTHON3", source: compileFail });
  await new Promise((r) => setTimeout(r, 12_000));

  log("attack 9: victim runtime-fails with the secret in the traceback");
  const runtimeFail = `raise ValueError("${SECRET}")\n`;
  victim.emit("code.submit", { matchId, language: "PYTHON3", source: runtimeFail });
  await new Promise((r) => setTimeout(r, 15_000));

  log("attack 10: victim prints the secret as wrong-answer output");
  const wrongOut = `print("${SECRET}")\n`;
  victim.emit("code.submit", { matchId, language: "PYTHON3", source: wrongOut });
  await new Promise((r) => setTimeout(r, 15_000));

  /* The allowlist means the attacker should have received `opponent.verdict`
     and NOT `submission.verdict` for the victim's side. Assert both halves:
     the signal §6.5 needs did arrive, and the fields it must not carry did
     not exist at all. */
  const oppVerdicts = caught.filter((c) => c.event === "opponent.verdict");
  if (oppVerdicts.length === 0) {
    failures.push("the opponent never learned the other side had submitted — §6.5 needs that");
  }
  for (const v of oppVerdicts) {
    for (const banned of ["failedAt", "message", "submissionId", "verdict\"", "runtimeMs", "memoryKb"]) {
      if (v.payload.includes(banned)) {
        failures.push(`opponent.verdict carried a disallowed field: ${banned} in ${v.payload}`);
      }
    }
  }
  const leakedVerdict = caught.find(
    (c) => c.event === "submission.verdict" && c.payload.includes(`"side":"${victimSide}"`),
  );
  if (leakedVerdict) {
    failures.push("the attacker received the victim's full submission.verdict");
  }

  /* ── The verdict ──────────────────────────────────────────────────── */

  const leaked = caught.filter((c) => c.payload.includes(SECRET));
  if (leaked.length > 0) {
    failures.push(
      `THE OPPONENT'S SOURCE LEAKED via ${[...new Set(leaked.map((l) => l.event))].join(", ")}`,
    );
  }

  // Both self-spectate attempts must have been refused, explicitly. Two are
  // expected: one via spectate.join, one via the /watch code path.
  const refusals = caught.filter((c) => c.event === "error" && c.payload.includes("SELF_SPECTATE"));
  if (refusals.length < 2) {
    failures.push(
      `expected SELF_SPECTATE on both spectate.join and spectate.watch, saw ${refusals.length}`,
    );
  }

  // And the attacker's forged snapshot must not have corrupted the victim.
  const forged = caught.some((c) => c.payload.includes("attacker owned this"));
  if (forged) failures.push("the attacker's forged snapshot came back as the opponent's editor");

  log(`\ncaught ${caught.length} events across ${new Set(caught.map((c) => c.event)).size} names`);
  log(`event names seen: ${[...new Set(caught.map((c) => c.event))].sort().join(", ")}`);

  victim.close();
  attacker.close();

  /* Verdict BEFORE cleanup. Cleanup is best-effort — these accounts are
     referenced by the Match row the probe just created, so deleting them is
     not always possible, and a tidy-up failure must never mask the result. */
  const verdict = failures.length === 0;
  if (!verdict) for (const f of failures) console.error(`FAIL: ${f}`);
  else log("\nPASS — the opponent's source was unobtainable through every route tried.");

  await deleteProbeUsers(prisma, [victimAccount.email, attackerAccount.email]).catch(
    (error: unknown) => console.error(`teardown failed: ${String(error)}`),
  );
  await prisma.$disconnect();
  if (!verdict) process.exit(1);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
