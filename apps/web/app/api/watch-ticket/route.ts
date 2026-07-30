import { randomBytes } from "node:crypto";
import Redis from "ioredis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ============================================================================
   An anonymous spectator ticket (§7).

   NO ACCOUNT REQUIRED TO WATCH. A shared link reaching a stranger who watches a
   live match is the best growth path the product has, and a registration wall
   in front of it converts that stranger into a bounce. So this mints a ticket
   for nobody in particular.

   The ticket resolves to `anon` rather than a user id, and the gateway gives it
   an identity that can watch and do nothing else — no queue, no accept, no
   submit, no editor writes. That restriction is enforced server-side, because
   the alternative is trusting a client we did not write.
   ========================================================================= */

const REDIS_URL = process.env["REDIS_URL"] ?? "redis://localhost:6379";
const TICKET_TTL_SECONDS = 60;

let client: Redis | null = null;
function redis(): Redis {
  client ??= new Redis(REDIS_URL, { maxRetriesPerRequest: 2 });
  return client;
}

export async function POST(): Promise<Response> {
  const ticket = randomBytes(32).toString("base64url");
  // `anon` is the sentinel the gateway recognises. Single use via GETDEL, the
  // same as a signed-in ticket, so a leaked one is worth one connection.
  await redis().set(`socket:ticket:${ticket}`, "anon", "EX", TICKET_TTL_SECONDS);
  return Response.json({ ticket, expiresInSeconds: TICKET_TTL_SECONDS });
}
