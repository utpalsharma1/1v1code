/* Verifies the two behaviours that are timers rather than state transitions:
   the solo-player bot fallback, and reconnection inside the grace period.

   Usage:  node --experimental-strip-types src/reconnect-probe.ts [bot|reconnect]
   Each mode expects a freshly started gateway — a player already in a match
   cannot queue, so the two modes cannot share one gateway process. */

import { readFileSync } from "node:fs";
import { io, type Socket } from "socket.io-client";

const GATEWAY = process.env["GATEWAY_URL"] ?? "http://localhost:4000";
const tokens = JSON.parse(readFileSync("/tmp/tokens.json", "utf8")) as { h: string; t: string }[];
const tok = (h: string) => tokens.find((x) => x.h === h)!.t;

const seen: string[] = [];
const mark = (who: string, what: string) => {
  seen.push(`${who}: ${what}`);
  console.log(`  ${who.padEnd(10)} ${what}`);
};
const has = (re: RegExp) => seen.some((s) => re.test(s));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function client(handle: string, autoAccept = true): Socket {
  const socket = io(GATEWAY, {
    transports: ["websocket"],
    extraHeaders: { Cookie: `1v1_session=${tok(handle)}` },
    reconnection: false,
  });
  socket.on("match.found", (p) => {
    mark(handle, `found vs ${p.p1.handle === handle ? p.p2.handle : p.p1.handle}`);
    if (autoAccept) socket.emit("match.accept", { matchId: p.matchId });
  });
  socket.on("match.start", () => mark(handle, "LIVE"));
  socket.on("match.presence", (p) =>
    mark(
      handle,
      `presence ${p.side} connected=${p.connected} grace=${Math.round(p.graceRemainingMs / 1000)}s`,
    ),
  );
  socket.on("match.resync", (p) =>
    mark(handle, `resync state=${p.state} remaining=${Math.round(p.remainingMs / 1000)}s`),
  );
  socket.on("match.end", (p) => mark(handle, `end ${p.outcome.kind}`));
  return socket;
}

async function botFallback(): Promise<[string, boolean][]> {
  console.log("=== bot fallback (a pool of one is the normal dev case) ===");
  const solo = client("arjun_dev");
  await wait(800);
  solo.emit("queue.join", { mode: "RANKED" });
  await wait(26_000); // MM_BOT_AFTER_MS is 20s in dev
  solo.close();
  return [["solo player was matched against the bot", has(/found vs bot_/)]];
}

async function reconnection(): Promise<[string, boolean][]> {
  console.log("=== reconnection inside grace ===");
  const a = client("arjun_dev");
  const b = client("rohan_x");
  await wait(800);
  a.emit("queue.join", {});
  b.emit("queue.join", {});
  // Ratings differ by 36 and the band starts at ±30, so they pair once it
  // widens at 10s. That is the band doing its job, not a stall.
  await wait(16_000);
  const reachedLive = seen.filter((s) => /LIVE/.test(s)).length >= 2;

  console.log("  -- dropping rohan_x --");
  b.close();
  await wait(2500);
  const sawDrop = has(/presence p[12] connected=false grace=4[0-9]s/);

  console.log("  -- rohan_x returns --");
  const back = client("rohan_x", false);
  await wait(3000);

  const results: [string, boolean][] = [
    ["match reached LIVE with two humans", reachedLive],
    ["opponent was told about the drop, with grace remaining", sawDrop],
    ["returning player got a full resync snapshot", has(/rohan_x: resync state=LIVE/)],
    ["opponent was told about the return", has(/presence p[12] connected=true/)],
    ["reconnect inside grace did NOT forfeit", !has(/end WIN/)],
  ];
  a.close();
  back.close();
  return results;
}

const mode = process.argv[2] ?? "reconnect";
const checks = mode === "bot" ? await botFallback() : await reconnection();

console.log("\n-- assertions --");
let bad = 0;
for (const [name, ok] of checks) {
  if (!ok) bad++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
}
process.exit(bad === 0 ? 0 : 1);
