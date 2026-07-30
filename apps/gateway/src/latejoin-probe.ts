/* ============================================================================
   The late joiner — CORRECTNESS, not load.

   A shared watch link is opened mid-match by definition. That is the normal
   case for the feature, not an edge case, so a viewer arriving at minute four
   must land in a correct state from a SNAPSHOT and never from replayed deltas.

   This joins repeatedly at different points in a live match while a player
   keeps typing, and after each join diffs the spectator's reconstructed
   document against the gateway's authoritative text — the thing every other
   viewer is being kept in sync with. A mismatch of a single character is a
   failure, because a spectator seeing plausible code that was never written is
   exactly the silent corruption §10 refuses to allow.

   It also joins DURING a burst rather than only between them, because the
   interesting race is a snapshot being taken while deltas are in flight.

   Run with:  pnpm probe:latejoin
   ========================================================================= */

import { randomBytes } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { prisma } from "@1v1/db";

const WEB = process.env["WEB_URL"] ?? "http://localhost:3000";
const GATEWAY = process.env["GATEWAY_URL"] ?? "http://localhost:4000";

const log = (...parts: unknown[]) => console.log(...parts);

interface Change {
  offset: number;
  length: number;
  text: string;
}

/** The spectator's applier, identical to the page's and the gateway's. */
function applyChanges(text: string, changes: Change[]): string {
  let next = text;
  for (const change of changes) {
    const start = Math.min(change.offset, next.length);
    const end = Math.min(start + change.length, next.length);
    next = next.slice(0, start) + change.text + next.slice(end);
  }
  return next;
}

async function account(): Promise<{ cookie: string; email: string }> {
  const handle = `lj_${randomBytes(3).toString("hex")}`;
  const email = `${handle}@example.com`;
  const response = await fetch(`${WEB}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ handle, email, password: "correct-horse-battery-staple" }),
  });
  if (!response.ok) throw new Error(`register failed: ${await response.text()}`);
  return {
    cookie: (response.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; "),
    email,
  };
}

async function playerSocket(cookie: string): Promise<Socket> {
  const response = await fetch(`${WEB}/api/socket-ticket`, {
    method: "POST",
    headers: { Cookie: cookie },
  });
  const { ticket } = (await response.json()) as { ticket: string };
  return connect(ticket);
}

async function watcherSocket(): Promise<Socket> {
  const response = await fetch(`${WEB}/api/watch-ticket`, { method: "POST" });
  const { ticket } = (await response.json()) as { ticket: string };
  return connect(ticket);
}

function connect(ticket: string): Promise<Socket> {
  const socket = io(GATEWAY, { transports: ["websocket"], auth: { ticket }, reconnection: false });
  return new Promise((resolve, reject) => {
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (e) => reject(new Error(e.message)));
  });
}

const waitFor = <T,>(socket: Socket, event: string, ms = 60_000): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${event} in ${ms}ms`)), ms);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const failures: string[] = [];

  const one = await account();
  const two = await account();
  const p1 = await playerSocket(one.cookie);
  const p2 = await playerSocket(two.cookie);

  const foundA = waitFor<{ matchId: string; you: string; spectatorCode: string }>(p1, "match.found");
  const foundB = waitFor<{ matchId: string; you: string }>(p2, "match.found");
  p1.emit("queue.join", { mode: "RANKED" });
  await sleep(300);
  p2.emit("queue.join", { mode: "RANKED" });

  const [fa, fb] = await Promise.all([foundA, foundB]);
  const started = waitFor(p1, "match.start", 30_000);
  p1.emit("match.accept", { matchId: fa.matchId });
  p2.emit("match.accept", { matchId: fb.matchId });
  await started;

  const code = fa.spectatorCode;
  const typist = fa.you as "p1" | "p2";
  log(`live: match ${fa.matchId.slice(0, 8)}, code ${code}, typing as ${typist}`);

  /* The player types continuously, exactly as the editor would: one delta per
     ~50ms, each a small insertion at the end. `expected` is our own model of
     what the document must contain. */
  let expected = "";
  let seq = 0;
  p1.emit("editor.snapshot", { matchId: fa.matchId, seq: 0, text: "" });
  await sleep(150);

  let typing = true;
  const typer = (async () => {
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789 \n";
    while (typing) {
      const chunk = alphabet[Math.floor(Math.random() * alphabet.length)]!;
      seq += 1;
      p1.emit("editor.delta", {
        matchId: fa.matchId,
        seq,
        changes: [{ offset: expected.length, length: 0, text: chunk }],
        origin: "type",
      });
      expected += chunk;
      await sleep(50);
    }
  })();

  /* Join at several different points, including mid-burst. Each viewer must
     reconstruct the SAME document the gateway holds. */
  const JOINS = 6;
  for (let attempt = 1; attempt <= JOINS; attempt += 1) {
    await sleep(400 + Math.floor(Math.random() * 700));

    const watcher = await watcherSocket();
    const docs: Record<string, { text: string; seq: number }> = {};
    let gaps = 0;

    watcher.on("editor.snapshot", (p: { side: string; seq: number; text: string }) => {
      docs[p.side] = { text: p.text, seq: p.seq };
    });
    watcher.on("editor.delta", (p: { side: string; seq: number; changes: Change[] }) => {
      const doc = docs[p.side];
      if (!doc) return;
      if (p.seq !== doc.seq + 1) {
        // Never guess. Ask for ground truth, exactly as the page does.
        gaps += 1;
        watcher.emit("editor.resync", { matchId: fa.matchId, side: p.side });
        return;
      }
      doc.text = applyChanges(doc.text, p.changes);
      doc.seq = p.seq;
    });

    watcher.emit("spectate.watch", { code });
    await waitFor(watcher, "spectate.ready", 20_000);
    // Let a little more typing flow so the join is followed by live deltas.
    await sleep(500);

    /* Freeze the comparison: stop typing briefly so the watcher and the
       gateway are comparable at a single instant. Without this the diff races
       the next keystroke and reports a phantom failure. */
    typing = false;
    await typer.catch(() => undefined);
    await sleep(250);

    const seen = docs[typist]?.text ?? "";
    if (seen !== expected) {
      const at = [...expected].findIndex((c, i) => seen[i] !== c);
      failures.push(
        `join ${attempt}: spectator document differs at index ${at} — ` +
          `expected ${expected.length} chars, saw ${seen.length}`,
      );
    } else {
      log(`  join ${attempt}: exact match at ${expected.length} chars (${gaps} gap(s) recovered)`);
    }

    watcher.close();

    // Resume typing for the next join.
    if (attempt < JOINS) {
      typing = true;
      void (async () => {
        const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789 \n";
        while (typing) {
          const chunk = alphabet[Math.floor(Math.random() * alphabet.length)]!;
          seq += 1;
          p1.emit("editor.delta", {
            matchId: fa.matchId,
            seq,
            changes: [{ offset: expected.length, length: 0, text: chunk }],
            origin: "type",
          });
          expected += chunk;
          await sleep(50);
        }
      })();
    }
  }

  typing = false;
  await sleep(200);
  p1.close();
  p2.close();

  log("");
  const ok = failures.length === 0;
  if (!ok) for (const f of failures) console.error(`FAIL: ${f}`);
  else log(`PASS — ${JOINS} late joins, each reconstructed the gateway's document exactly.`);

  await prisma.user
    .deleteMany({ where: { email: { in: [one.email, two.email] } } })
    .catch(() => undefined);
  await prisma.$disconnect();
  if (!ok) process.exit(1);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
