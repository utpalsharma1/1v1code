import Redis from "ioredis";

/* ============================================================================
   Per-identity submission rate limit

   One person with a `while true` loop around a submit call should not be able
   to exhaust the judge pool. The pool is small by design (section 11), so it is
   cheap to saturate: a handful of requests per second is enough to make the
   queue unbounded for everybody else.

   Two windows, because they stop different things. The short one stops a stuck
   key or a retry loop. The long one stops someone deliberately grinding — which
   the short window alone would happily permit forever.
   ========================================================================= */

const REDIS_URL = process.env["REDIS_URL"] ?? "redis://localhost:6379";

let client: Redis | null = null;
function redis(): Redis {
  client ??= new Redis(REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false });
  return client;
}

export interface Window {
  seconds: number;
  max: number;
  label: string;
}

export const SUBMIT_LIMITS: Window[] = [
  { seconds: 10, max: 3, label: "3 per 10s" },
  { seconds: 300, max: 30, label: "30 per 5min" },
];

export interface RateVerdict {
  allowed: boolean;
  /** Seconds until the offending window frees up. */
  retryAfter: number;
  limit: string;
}

/**
 * Fixed-window counters via INCR + EXPIRE. A sliding window would be more
 * precise at the boundary, but fixed windows are atomic in one round trip and
 * the failure they permit — a short burst straddling a boundary — is bounded at
 * 2x, which the pool absorbs.
 */
export async function checkRateLimit(
  identity: string,
  windows: Window[] = SUBMIT_LIMITS,
): Promise<RateVerdict> {
  const r = redis();

  for (const window of windows) {
    const bucket = Math.floor(Date.now() / 1000 / window.seconds);
    const key = `rl:submit:${identity}:${window.seconds}:${bucket}`;
    const count = await r.incr(key);
    if (count === 1) await r.expire(key, window.seconds + 1);

    if (count > window.max) {
      const elapsed = Math.floor(Date.now() / 1000) % window.seconds;
      return {
        allowed: false,
        retryAfter: Math.max(1, window.seconds - elapsed),
        limit: window.label,
      };
    }
  }

  return { allowed: true, retryAfter: 0, limit: "" };
}

/* ============================================================================
   WHOSE ADDRESS IS THIS? The trusted-proxy switch.

   A proxy header is a claim made by whoever spoke to us last. Trusting it
   unconditionally means trusting the CLIENT, because a header the client sends
   arrives looking exactly like one the proxy added.

   The previous version took the first value of `X-Forwarded-For` with no notion
   of trust. Behind a proxy that APPENDS rather than overwrites — which is
   Caddy's and nginx's default — a request carrying its own `X-Forwarded-For:
   1.2.3.4` produces an attacker-chosen identity, so a per-IP limit becomes an
   unlimited supply of fresh buckets. Worse than absent: it looks like it works.

   So the deployment topology has to be declared, not sniffed:

     none        no proxy. Headers are ignored entirely. This is the DEFAULT,
                 because the safe failure is "everyone shares one bucket", not
                 "everyone gets their own".
     cloudflare  behind Cloudflare (tunnel or proxied DNS). `CF-Connecting-IP`
                 is authoritative: Cloudflare OVERWRITES it at its edge, so a
                 client cannot forge it. `X-Forwarded-For` is still ignored,
                 because Cloudflare appends to that one.
     local       behind our own reverse proxy on the same host, configured to
                 OVERWRITE `X-Forwarded-For` with the immediate peer. Only the
                 LAST value is read, never the first — the first is the part a
                 client controls.

   Getting this wrong is silent in both directions, so `TRUSTED_PROXY` is
   explicit and there is a test that forges the header against each setting.
   ========================================================================= */

export type TrustedProxy = "none" | "cloudflare" | "local";

export function trustedProxy(): TrustedProxy {
  const raw = process.env["TRUSTED_PROXY"];
  return raw === "cloudflare" || raw === "local" ? raw : "none";
}

/**
 * The client address, or null when nothing trustworthy says what it is.
 *
 * Exported so the positive control can drive it directly rather than through
 * the whole rate limiter.
 */
export function clientAddress(request: Request, mode: TrustedProxy = trustedProxy()): string | null {
  /* TEST-ONLY. Restores the old, forgeable behaviour so the positive control in
     rate-limit.test.ts can be shown to fail. Never set outside a test run. */
  if (process.env["BREAK_TRUSTED_PROXY"] === "1") {
    return (
      request.headers.get("cf-connecting-ip")?.trim() ||
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      null
    );
  }
  if (mode === "cloudflare") {
    const cf = request.headers.get("cf-connecting-ip")?.trim();
    return cf && cf.length > 0 ? cf : null;
  }
  if (mode === "local") {
    /* LAST value, not first. A client-supplied header survives as the leading
       entries; our own proxy's value is appended at the end. */
    const chain = request.headers.get("x-forwarded-for");
    const last = chain?.split(",").at(-1)?.trim();
    return last && last.length > 0 ? last : null;
  }
  return null;
}

/**
 * Identity for rate-limiting purposes. A signed-in user is rate-limited as
 * themselves; anyone else falls back to their address when — and only when — a
 * declared trusted proxy vouches for it.
 *
 * With `TRUSTED_PROXY=none` every anonymous caller shares one bucket. That is
 * deliberately strict: sharing a bucket throttles honest users together, which
 * is visible and complainable, whereas a forgeable identity throttles nobody
 * and looks fine.
 */
export function rateLimitIdentity(userId: string | null, request: Request): string {
  if (userId) return `u:${userId}`;
  const ip = clientAddress(request);
  return ip ? `ip:${ip}` : "ip:untrusted";
}
