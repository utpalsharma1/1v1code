/* ============================================================================
   The bug that made /play unmatchable, as a regression test.

   A queued player whose socket blipped was removed from the Redis pool and
   never put back. `queue.left` went to a socket that no longer existed, so the
   client kept rendering the queue card while the server had forgotten it
   entirely — /play looked like it was queueing forever and was invisible to
   everyone else. Any blip did it: a Next dev recompile, a laptop sleeping, the
   20s ping timeout.

   This drives that exact sequence: queue, drop the socket, reconnect, and then
   check that a second player can still find them.

   Run with:  pnpm probe:requeue
   ========================================================================= */

import { randomBytes } from "node:crypto";
import { deleteProbeUsers } from "./probe-cleanup.ts";
import { io, type Socket } from "socket.io-client";
import { prisma } from "@1v1/db";

const WEB = process.env["WEB_URL"] ?? "http://localhost:3000";
const GATEWAY = process.env["GATEWAY_URL"] ?? "http://localhost:4000";

const log = (...parts: unknown[]) => console.log(...parts);

async function account(): Promise<{ cookie: string; handle: string }> {
  const handle = `rq_${randomBytes(3).toString("hex")}`;
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
  const cookie = (response.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  return { cookie, handle };
}

async function socketFor(cookie: string): Promise<Socket> {
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

async function main(): Promise<void> {
  const failures: string[] = [];

  const one = await account();
  const two = await account();

  // Player one queues, exactly as /play does.
  let s1 = await socketFor(one.cookie);
  interface QueueStatus {
    inQueue: number;
    alone: boolean;
  }
  let lastStatus: QueueStatus | null = null;
  s1.on("queue.status", (p: QueueStatus) => {
    lastStatus = p;
  });
  s1.emit("queue.join", { mode: "RANKED" });
  await new Promise((r) => setTimeout(r, 1500));
  const seen = lastStatus as QueueStatus | null;
  log(`queued: inQueue=${seen?.inQueue} alone=${seen?.alone}`);
  if (seen?.inQueue !== 1) failures.push("player one was not in the pool after queueing");

  /* The blip. Not a deliberate "leave" — the socket simply goes away, which is
     what a dev-server recompile or a sleeping laptop looks like. */
  log("dropping player one's socket");
  s1.close();
  await new Promise((r) => setTimeout(r, 1200));

  log("reconnecting player one (no explicit re-queue)");
  s1 = await socketFor(one.cookie);
  let rejoined: QueueStatus | null = null;
  let found1 = false;
  s1.on("queue.status", (p: QueueStatus) => {
    rejoined = p;
  });
  s1.on("match.found", () => (found1 = true));
  await new Promise((r) => setTimeout(r, 2500));

  const back = rejoined as QueueStatus | null;
  if (!back) {
    failures.push("after reconnecting, the player received no queue.status at all — still forgotten");
  } else {
    log(`after reconnect: inQueue=${back.inQueue} alone=${back.alone}`);
  }

  // The real proof: somebody else can now find them.
  log("player two queues");
  const s2 = await socketFor(two.cookie);
  let found2 = false;
  s2.on("match.found", () => (found2 = true));
  s2.emit("queue.join", { mode: "RANKED" });

  await new Promise((r) => setTimeout(r, 6000));
  if (!found2) failures.push("player two never paired with the reconnected player");
  if (!found1) failures.push("the reconnected player was never told a match was found");

  s1.close();
  s2.close();

  await deleteProbeUsers(prisma, [
    `${one.handle}@example.com`,
    `${two.handle}@example.com`,
  ]);

  log("");
  if (failures.length > 0) {
    for (const f of failures) console.error(`FAIL: ${f}`);
    await prisma.$disconnect();
    process.exit(1);
  }
  log("PASS — a queued player survives a dropped socket and stays matchable.");
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
