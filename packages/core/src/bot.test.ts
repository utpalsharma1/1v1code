import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  botMatchIsRated,
  medianFraction,
  planBotMatch,
  solveProbability,
} from "./bot.ts";

/** Deterministic sequence so distribution tests do not flake. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe("bot solve probability", () => {
  test("an equal-rated problem is a coin flip", () => {
    assert.ok(Math.abs(solveProbability(1460, 1460) - 0.5) < 1e-9);
  });

  test("400 below is about 91%, 400 above about 9%", () => {
    assert.ok(Math.abs(solveProbability(1460, 1060) - 0.909) < 0.005);
    assert.ok(Math.abs(solveProbability(1460, 1860) - 0.091) < 0.005);
  });

  test("harder is always less likely", () => {
    let previous = 1;
    for (let r = 1000; r <= 2000; r += 100) {
      const p = solveProbability(1460, r);
      assert.ok(p < previous, `probability must fall as rating rises (at ${r})`);
      previous = p;
    }
  });
});

describe("bot solve time", () => {
  test("median scales with difficulty and stays bounded", () => {
    const easy = medianFraction(1460, 1060);
    const equal = medianFraction(1460, 1460);
    const hard = medianFraction(1460, 1860);
    assert.ok(easy < equal && equal < hard, "harder problems must take longer");
    assert.ok(easy >= 0.15 && hard <= 0.9, "must stay inside the clamp");
    assert.ok(Math.abs(equal - 0.5) < 1e-9, "an equal problem lands mid-match");
  });

  test("observed win rate matches the model over many matches", () => {
    // The property the two-stage design exists to guarantee: the bot's win
    // rate is correct by construction, not tuned.
    const random = seeded(12345);
    let solved = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const plan = planBotMatch({
        botRating: 1460,
        problemRating: 1340, // mean − 120, the actual selection rule
        matchDurationMs: 480_000,
        random,
      });
      if (plan.solves) solved++;
    }
    const observed = solved / N;
    const expected = solveProbability(1460, 1340);
    assert.ok(
      Math.abs(observed - expected) < 0.03,
      `observed ${observed.toFixed(3)} vs expected ${expected.toFixed(3)}`,
    );
  });

  test("submission times stay inside the match and vary between runs", () => {
    const random = seeded(999);
    const times: number[] = [];
    for (let i = 0; i < 500; i++) {
      const plan = planBotMatch({
        botRating: 1460,
        problemRating: 1340,
        matchDurationMs: 480_000,
        random,
      });
      if (plan.submitAtMs !== null) times.push(plan.submitAtMs);
    }
    assert.ok(times.length > 100, "the bot should solve often at mean − 120");
    assert.ok(Math.min(...times) >= 480_000 * 0.12, "never instant");
    assert.ok(Math.max(...times) <= 480_000 * 0.95, "never past the clock");
    assert.ok(new Set(times).size > times.length / 2, "two matches must not look identical");
  });

  test("a non-solving plan has no submission time", () => {
    const plan = planBotMatch({
      botRating: 1000,
      problemRating: 2000,
      matchDurationMs: 480_000,
      random: () => 0.99, // above any sane probability
    });
    assert.equal(plan.solves, false);
    assert.equal(plan.submitAtMs, null);
  });
});

describe("bot rating integrity", () => {
  test("rated during placements regardless of RD", () => {
    assert.equal(botMatchIsRated(40, 3), true, "placements must always count");
  });

  test("rated while the system is still uncertain", () => {
    assert.equal(botMatchIsRated(350, 0), true, "a fresh player must get placed");
    assert.equal(botMatchIsRated(150, 0), true);
  });

  test("unrated once the rating has converged — this is what closes the farm", () => {
    assert.equal(botMatchIsRated(80, 0), false);
    assert.equal(botMatchIsRated(30, 0), false);
  });

  test("the farm closes itself as RD falls", () => {
    // Each bot win lowers RD, which walks the player toward bot matches not
    // counting. The exploit has a ceiling and reaches it on its own.
    const path = [350, 250, 180, 130, 101, 99, 60];
    const rated = path.map((rd) => botMatchIsRated(rd, 0));
    assert.deepEqual(rated, [true, true, true, true, true, false, false]);
  });
});
