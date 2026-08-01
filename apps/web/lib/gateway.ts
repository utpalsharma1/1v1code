/* ============================================================================
   Where is the gateway? One answer, in one place.

   `NEXT_PUBLIC_*` is INLINED AT BUILD TIME. That is the trap this file exists
   to close: four components each read `NEXT_PUBLIC_GATEWAY_URL` and fell back to
   `http://localhost:4000`, so one image built once and deployed twice points
   both environments at whichever gateway was configured during the build. A
   staging deploy quietly talking to the production gateway is the kind of bug
   that is discovered by a user, not by a test.

   THE FIX IS TOPOLOGICAL, NOT CONFIGURATIONAL. In every deployed environment
   the gateway is reached through the SAME ORIGIN as the page, under `/socket.io`,
   with a reverse proxy in front doing the routing. Then there is nothing to
   configure and nothing to inline:

     - Returning `undefined` makes socket.io connect to the page's own origin.
     - The protocol is derived from `location`, so an HTTPS page produces `wss://`
       automatically. Mixed content stops being a mistake anyone can make rather
       than one everyone has to remember.
     - Same origin means no CORS preflight and no SameSite question.
     - The same shape works behind a Cloudflare Tunnel and behind Caddy on a
       real host, so the local rehearsal is the deployed topology.

   `NEXT_PUBLIC_GATEWAY_URL` survives for exactly one case: local development
   with no proxy in front, where the gateway really is on another port. Set it
   empty (or leave the proxy in place) and that special case disappears.
   ========================================================================= */

/**
 * The socket.io target, or `undefined` to mean "this page's own origin".
 *
 * Pass it straight to `io(target)` — socket.io treats `undefined` as
 * same-origin, which is what every proxied deployment wants.
 */
export function gatewayTarget(): string | undefined {
  const configured = process.env["NEXT_PUBLIC_GATEWAY_URL"];
  /* Empty string is a DELIBERATE value meaning same-origin, so this cannot use
     `??` — an empty string is not nullish and would be passed through as a
     URL. That distinction is the whole point of the helper. */
  if (configured === undefined || configured.trim() === "") return undefined;
  return configured;
}

/** For display and for building absolute links (challenge, spectate). */
export function publicOrigin(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return process.env["WEB_URL"] ?? process.env["WEB_ORIGIN"] ?? "http://localhost:3000";
}
