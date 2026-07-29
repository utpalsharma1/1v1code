import type Redis from "ioredis";

/* ============================================================================
   Atomic matchmaking (§6.1, §8)

   THE WHOLE POINT IS THAT THIS IS ONE REDIS OPERATION.

   The obvious implementation — read the queue, pick a partner, write the match,
   remove both — is a race with three distinct losing outcomes:

     · two gateways both pick the same partner, and one player is in two matches
     · A pairs with B while B pairs with C, so B is double-booked and C is
       waiting for someone who has left
     · both sides remove each other and nobody creates the match, losing a player
       from the queue entirely with no error anywhere

   None of these show up in manual testing and all of them are visible to
   players. Redis runs Lua single-threaded to completion, so doing find /
   remove-both / create inside one script makes the whole sequence atomic.
   It is also why a second gateway process would be safe, which is not
   currently needed but is exactly the kind of thing that is impossible to
   retrofit.
   ========================================================================= */

/** ±30 to start: tight enough that an early match is a genuinely close one. */
export const BAND_START = 30;
export const BAND_STEP = 25;
export const BAND_INTERVAL_MS = 10_000;
/** Beyond this a "match" is a punishment for being at the edge of the ladder. */
export const BAND_CEILING = 400;
/** The same pair cannot meet again in ranked for this long. */
export const REMATCH_COOLDOWN_S = 180;

export const QUEUE_KEY = "mm:queue";
const playerKey = (userId: string) => `mm:player:${userId}`;
const cooldownKey = (a: string, b: string) =>
  a < b ? `mm:cd:${a}:${b}` : `mm:cd:${b}:${a}`;

/** Rating band for a player who has been queuing for `elapsedMs`. */
export function bandFor(elapsedMs: number): { half: number; widening: boolean } {
  const steps = Math.floor(elapsedMs / BAND_INTERVAL_MS);
  const half = Math.min(BAND_CEILING, BAND_START + steps * BAND_STEP);
  return { half, widening: half < BAND_CEILING };
}

/**
 * Join the queue, or pair with a waiting opponent — atomically, as one call.
 *
 * KEYS[1] queue sorted set (score = rating)
 * ARGV[1] userId  [2] rating  [3] band half-width  [4] now (monotonic ms)
 *
 * Returns {partnerId, partnerRating} or nil when enqueued.
 *
 * Candidates are scanned nearest-rating-first so an early match is a close one,
 * and each is checked against the rematch cooldown before being taken.
 */
const JOIN_OR_PAIR = `
local queue    = KEYS[1]
local userId   = ARGV[1]
local rating   = tonumber(ARGV[2])
local half     = tonumber(ARGV[3])
local now      = ARGV[4]

-- Never pair with yourself: a reconnect or a double-click can put the same
-- user id in flight twice, and matching them would deadlock the match.
redis.call('ZREM', queue, userId)

local lo = rating - half
local hi = rating + half
local candidates = redis.call('ZRANGEBYSCORE', queue, lo, hi)

local best, bestDelta = nil, nil
for i = 1, #candidates do
  local other = candidates[i]
  if other ~= userId then
    local a, b = userId, other
    if a > b then a, b = b, a end
    if redis.call('EXISTS', 'mm:cd:' .. a .. ':' .. b) == 0 then
      local otherRating = tonumber(redis.call('ZSCORE', queue, other))
      if otherRating then
        local delta = math.abs(otherRating - rating)
        if bestDelta == nil or delta < bestDelta then
          best, bestDelta = other, delta
        end
      end
    end
  end
end

if best then
  -- Remove BOTH inside the same script. This is the line the whole design
  -- exists for: after this returns, neither player can be paired again.
  redis.call('ZREM', queue, best)
  redis.call('DEL', 'mm:player:' .. best)
  redis.call('DEL', 'mm:player:' .. userId)
  local otherRating = redis.call('GET', 'mm:rating:' .. best) or '1200'
  return { best, otherRating }
end

redis.call('ZADD', queue, rating, userId)
redis.call('SET', 'mm:rating:' .. userId, rating)
redis.call('HSET', 'mm:player:' .. userId, 'joinedAt', now, 'rating', rating)
return nil
`;

export interface PairResult {
  partnerId: string;
  partnerRating: number;
}

export class Matchmaker {
  private readonly redis: Redis;
  private sha: string | null = null;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  private async script(): Promise<string> {
    this.sha ??= await this.redis.script("LOAD", JOIN_OR_PAIR) as string;
    return this.sha;
  }

  /** Atomically pair or enqueue. Returns null when the player is now waiting. */
  async joinOrPair(
    userId: string,
    rating: number,
    bandHalf: number,
    nowMs: number,
  ): Promise<PairResult | null> {
    const sha = await this.script();
    const result = (await this.redis.evalsha(
      sha,
      1,
      QUEUE_KEY,
      userId,
      String(rating),
      String(bandHalf),
      String(nowMs),
    )) as [string, string] | null;

    if (!result) return null;
    return { partnerId: result[0], partnerRating: Number(result[1]) };
  }

  async leave(userId: string): Promise<void> {
    await this.redis
      .multi()
      .zrem(QUEUE_KEY, userId)
      .del(playerKey(userId))
      .del(`mm:rating:${userId}`)
      .exec();
  }

  async size(): Promise<number> {
    return this.redis.zcard(QUEUE_KEY);
  }

  async isQueued(userId: string): Promise<boolean> {
    return (await this.redis.zscore(QUEUE_KEY, userId)) !== null;
  }

  /** Called after a ranked match so the pair cannot immediately rematch. */
  async setCooldown(a: string, b: string, seconds = REMATCH_COOLDOWN_S): Promise<void> {
    await this.redis.set(cooldownKey(a, b), "1", "EX", seconds);
  }

  async onCooldown(a: string, b: string): Promise<boolean> {
    return (await this.redis.exists(cooldownKey(a, b))) === 1;
  }

  /** Test hook: wipe all matchmaking state. */
  async reset(): Promise<void> {
    const keys = await this.redis.keys("mm:*");
    if (keys.length > 0) await this.redis.del(...keys);
  }
}
