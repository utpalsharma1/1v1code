import assert from "node:assert/strict";
import test, { after, before, describe } from "node:test";
import Redis from "ioredis";
import { BAND_CEILING, BAND_START, Matchmaker, bandFor } from "./matchmaking.ts";

const redis = new Redis(process.env["REDIS_URL"] ?? "redis://localhost:6379");
const mm = new Matchmaker(redis);

before(async () => {
  try {
    await redis.ping();
  } catch {
    throw new Error("Redis unreachable — matchmaking cannot be verified");
  }
  await mm.reset();
});

after(async () => {
  await mm.reset();
  await redis.quit();
});

describe("band widening", () => {
  test("starts tight and widens on a schedule", () => {
    assert.equal(bandFor(0).half, BAND_START);
    assert.ok(bandFor(30_000).half > bandFor(0).half, "must widen with queue time");
  });

  test("stops at the ceiling and says so", () => {
    // An unbounded band eventually pairs a 900 with a 2400, which is not a
    // match. The UI must also stop claiming to widen once it has stopped.
    const long = bandFor(60 * 60 * 1000);
    assert.equal(long.half, BAND_CEILING);
    assert.equal(long.widening, false, "the queue copy must not lie about widening");
    assert.equal(bandFor(0).widening, true);
  });
});

describe("atomic pairing", () => {
  test("first player waits, second player pairs", async () => {
    await mm.reset();
    assert.equal(await mm.joinOrPair("alice", 1500, 100, 0), null, "first must enqueue");
    const pair = await mm.joinOrPair("bob", 1510, 100, 0);
    assert.deepEqual(pair, { partnerId: "alice", partnerRating: 1500 });
    assert.equal(await mm.size(), 0, "both must leave the queue");
  });

  test("a player outside the band is not taken", async () => {
    await mm.reset();
    await mm.joinOrPair("low", 1000, 30, 0);
    const pair = await mm.joinOrPair("high", 2000, 30, 0);
    assert.equal(pair, null, "2000 must not match 1000 on a ±30 band");
    assert.equal(await mm.size(), 2, "both must remain queued");
  });

  test("picks the nearest rating, not the first found", async () => {
    await mm.reset();
    // Band 1 so the three waiting players cannot pair with each other during
    // setup — joinOrPair pairs eagerly, which is the correct behaviour and was
    // quietly invalidating this fixture.
    await mm.joinOrPair("far", 1400, 1, 0);
    await mm.joinOrPair("near", 1495, 1, 0);
    await mm.joinOrPair("mid", 1450, 1, 0);
    assert.equal(await mm.size(), 3, "the three must all still be waiting");

    const pair = await mm.joinOrPair("seeker", 1500, 400, 0);
    assert.equal(pair?.partnerId, "near", "an early match should be a close one");
  });

  test("a player cannot pair with themselves", async () => {
    await mm.reset();
    await mm.joinOrPair("solo", 1500, 400, 0);
    // A reconnect or double-click puts the same id in flight twice.
    const again = await mm.joinOrPair("solo", 1500, 400, 0);
    assert.equal(again, null, "matching yourself would deadlock the match");
    assert.equal(await mm.size(), 1);
  });

  test("rematch cooldown blocks an immediate repeat", async () => {
    await mm.reset();
    await mm.setCooldown("ann", "ben", 60);
    await mm.joinOrPair("ann", 1500, 400, 0);
    const blocked = await mm.joinOrPair("ben", 1500, 400, 0);
    assert.equal(blocked, null, "a pair on cooldown must not rematch");
    assert.equal(await mm.size(), 2);
  });

  test("50 simultaneous joins produce 25 disjoint matches, nobody lost", async () => {
    // THE RACE TEST. Read-then-write matchmaking passes every sequential test
    // above and fails this one: the same partner gets handed to two callers, or
    // both sides remove each other and the match is never created.
    await mm.reset();
    const players = Array.from({ length: 50 }, (_, i) => `p${i}`);

    const results = await Promise.all(
      players.map((id) => mm.joinOrPair(id, 1500 + (Number(id.slice(1)) % 10), 400, 0)),
    );

    const pairs: [string, string][] = [];
    results.forEach((result, i) => {
      if (result) pairs.push([players[i]!, result.partnerId]);
    });

    assert.equal(pairs.length, 25, `expected 25 matches, got ${pairs.length}`);

    // Nobody appears twice — the double-booking failure.
    const seen = new Set<string>();
    for (const [a, b] of pairs) {
      assert.ok(!seen.has(a), `${a} was matched into two matches`);
      assert.ok(!seen.has(b), `${b} was matched into two matches`);
      assert.notEqual(a, b, "a player was matched with themselves");
      seen.add(a);
      seen.add(b);
    }

    // Nobody vanished — the lost-player failure.
    assert.equal(seen.size, 50, `${50 - seen.size} player(s) disappeared`);
    assert.equal(await mm.size(), 0, "queue must be empty afterwards");
  });

  test("51 simultaneous joins leave exactly one player waiting", async () => {
    // The odd-count case: the leftover must still be queued and matchable,
    // not silently dropped.
    await mm.reset();
    const players = Array.from({ length: 51 }, (_, i) => `q${i}`);
    const results = await Promise.all(players.map((id) => mm.joinOrPair(id, 1500, 400, 0)));

    const matched = results.filter(Boolean).length;
    assert.equal(matched, 25, `expected 25 pairings, got ${matched}`);
    assert.equal(await mm.size(), 1, "exactly one player should still be waiting");

    const straggler = await mm.joinOrPair("late", 1500, 400, 0);
    assert.ok(straggler, "the waiting player must still be matchable");
  });

  test("leaving removes every trace", async () => {
    await mm.reset();
    await mm.joinOrPair("ghost", 1500, 100, 0);
    assert.equal(await mm.isQueued("ghost"), true);
    await mm.leave("ghost");
    assert.equal(await mm.isQueued("ghost"), false);
    assert.equal(await mm.size(), 0);
  });
});
