import { randomBytes } from "node:crypto";
import Redis from "ioredis";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ============================================================================
   Socket ticket — the fix for the cross-origin handshake

   The page is on :3000 and the gateway is on :4000. Those are different
   origins, so every cookie-based handshake depends on the browser choosing to
   attach a cookie to a cross-origin WebSocket upgrade. That is governed by
   SameSite rules, third-party-cookie policy and per-browser behaviour we do not
   control, and it is invisible from the server when it goes wrong.

   So we stop depending on it. This endpoint is same-origin, where the session
   cookie is unambiguously sent, and it mints a short-lived single-use ticket
   that the client hands to the gateway in the Socket.IO auth payload.

   This is also what production needs: the gateway will be on a different host
   than the web app, which is unambiguously cross-site, where cookie-based
   socket auth is on a path browsers are actively closing off.
   ========================================================================= */

const REDIS_URL = process.env["REDIS_URL"] ?? "redis://localhost:6379";

/** Long enough to survive a page load, short enough to be worthless if leaked. */
const TICKET_TTL_SECONDS = 60;

let client: Redis | null = null;
function redis(): Redis {
  client ??= new Redis(REDIS_URL, { maxRetriesPerRequest: 2 });
  return client;
}

export async function POST(): Promise<Response> {
  const user = await currentUser();
  if (!user) {
    return Response.json({ error: "not signed in" }, { status: 401 });
  }

  const ticket = randomBytes(32).toString("base64url");
  await redis().set(`socket:ticket:${ticket}`, user.id, "EX", TICKET_TTL_SECONDS);

  return Response.json({
    ticket,
    expiresInSeconds: TICKET_TTL_SECONDS,
    handle: user.handle,
  });
}
