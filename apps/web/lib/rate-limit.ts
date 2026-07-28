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

/**
 * Identity for rate-limiting purposes. A signed-in user is rate-limited as
 * themselves; anyone else falls back to source address, which is weaker but
 * still stops the naive loop. Never trust x-forwarded-for without a proxy in
 * front that overwrites it.
 */
export function rateLimitIdentity(userId: string | null, request: Request): string {
  if (userId) return `u:${userId}`;
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";
  return `ip:${ip}`;
}
