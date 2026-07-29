/* Two simulated clients driving a real match through the gateway.
   Stands in for two browser tabs so the flow can be verified headlessly. */

import { readFileSync } from "node:fs";
import { io, type Socket } from "socket.io-client";

const GATEWAY = process.env["GATEWAY_URL"] ?? "http://localhost:4000";
const tokens = JSON.parse(readFileSync("/tmp/tokens.json", "utf8")) as {
  h: string;
  t: string;
}[];

const seen: string[] = [];
const mark = (who: string, what: string) => {
  seen.push(`${who}: ${what}`);
  console.log(`  ${who.padEnd(10)} ${what}`);
};

function client(handle: string, token: string): Socket {
  const socket = io(GATEWAY, {
    transports: ["websocket"],
    extraHeaders: { Cookie: `1v1_session=${token}` },
  });
  socket.on("connect", () => mark(handle, "connected"));
  socket.on("connect_error", (e) => mark(handle, `connect_error ${e.message}`));
  socket.on("queue.status", (p) => mark(handle, `queue.status band ±${(p.ratingBand[1] - p.ratingBand[0]) / 2}`));
  socket.on("match.found", (p) => {
    mark(handle, `match.found vs ${p.p1.handle === handle ? p.p2.handle : p.p1.handle}`);
    socket.emit("match.accept", { matchId: p.matchId });
    // Idempotency probe: accepting twice must not start the match twice.
    socket.emit("match.accept", { matchId: p.matchId });
  });
  socket.on("match.accept.progress", (p) => mark(handle, `accept p1=${p.p1} p2=${p.p2}`));
  socket.on("match.countdown", (p) => mark(handle, `countdown ${p.beat === 0 ? "GO" : p.beat}`));
  socket.on("match.start", (p) => mark(handle, `LIVE ${p.problem.slug} (${p.problem.rating})`));
  socket.on("match.clock", () => {});
  socket.on("match.end", (p) => mark(handle, `end ${p.outcome.kind}`));
  socket.on("error", (p) => mark(handle, `error ${p.code}`));
  return socket;
}

const a = client("arjun_dev", tokens.find((x) => x.h === "arjun_dev")!.t);
const b = client("rohan_x", tokens.find((x) => x.h === "rohan_x")!.t);

await new Promise((r) => setTimeout(r, 1200));
console.log("-- both queue --");
a.emit("queue.join", { mode: "RANKED" });
await new Promise((r) => setTimeout(r, 300));
b.emit("queue.join", { mode: "RANKED" });

await new Promise((r) => setTimeout(r, 17000));

console.log("\n-- assertions --");
const has = (re: RegExp) => seen.some((s) => re.test(s));
const checks: [string, boolean][] = [
  ["both clients authenticated via cookie", !has(/connect_error/)],
  ["match.found reached both players", seen.filter((s) => /match\.found/.test(s)).length === 2],
  ["accept progress reached both", has(/arjun_dev: accept p1=true p2=true/)],
  ["countdown ran 3-2-1-GO", has(/countdown 3/) && has(/countdown GO/)],
  ["match reached LIVE", seen.filter((s) => /LIVE/.test(s)).length === 2],
];
let bad = 0;
for (const [name, ok] of checks) {
  if (!ok) bad++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
}
a.close();
b.close();
process.exit(bad === 0 ? 0 : 1);
