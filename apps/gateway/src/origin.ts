/* ============================================================================
   Which browser origins may open a socket?

   Its own module rather than a corner of index.ts, because index.ts boots the
   gateway on import — connects to Redis, binds the port — so a test that wanted
   this function got a running server instead and hung. A pure check belongs
   somewhere it can be called without side effects.
   ========================================================================= */

/* WEB_ORIGIN accepts a COMMA-SEPARATED list, and an entry may start with `*.`
   to match a hostname suffix.

   The wildcard exists for exactly one situation: a Cloudflare quick tunnel
   hands out a random `*.trycloudflare.com` hostname at startup, so the origin
   the browser will send is not knowable when this process boots. The
   alternatives were reflecting any origin (which is not an allowlist at all) or
   restarting the gateway once the tunnel prints its URL (which makes the tunnel
   own the gateway's lifecycle).

   The suffix match is deliberately narrow — it matches a hostname ending, never
   a substring, and the scheme must still match — so `*.trycloudflare.com` cannot
   be satisfied by `trycloudflare.com.evil.test`. It is still looser than naming
   one origin, which is why it belongs to Stage 0 and not to a real host: on a
   real hostname WEB_ORIGIN is a single exact origin and the wildcard is unused. */
export const WEB_ORIGINS = (process.env["WEB_ORIGIN"] ?? "http://localhost:3000")
  .split(",")
  .map((o) => o.trim())
  .filter((o) => o.length > 0);

export function originAllowed(origin: string | undefined, allowed = WEB_ORIGINS): boolean {
  // No Origin header at all: a non-browser client, which the socket ticket
  // still has to satisfy. CORS is not the control that stops those.
  if (origin === undefined) return true;
  for (const entry of allowed) {
    if (entry === origin) return true;
    const star = entry.indexOf("*.");
    if (star === -1) continue;
    const scheme = entry.slice(0, star);
    const suffix = entry.slice(star + 1); // ".trycloudflare.com"
    if (!origin.startsWith(scheme)) continue;
    const host = origin.slice(scheme.length);
    if (host.endsWith(suffix) && host.length > suffix.length) return true;
  }
  return false;
}

