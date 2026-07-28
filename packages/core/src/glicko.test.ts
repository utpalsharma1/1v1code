import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  DEFAULT_GLICKO,
  MAX_RD,
  RATING_PERIOD_MS,
  decayedDeviation,
  rateMatch,
  updateRating,
  type Rating,
} from "./glicko.ts";

describe("Glicko-2", () => {
  test("reproduces Glickman's published worked example", () => {
    // From "Example of the Glicko-2 system" (Glickman, 2013). A player at
    // 1500/200 plays three opponents: beats 1400/30, loses to 1550/100, loses
    // to 1700/300. The paper's answer is r' = 1464.06, RD' = 151.52,
    // sigma' = 0.05999. If the volatility solver is wrong this is where it
    // shows — every other part of the algorithm is closed-form.
    const player: Rating = { rating: 1500, deviation: 200, volatility: 0.06 };
    const updated = updateRating(player, [
      { opponent: { rating: 1400, deviation: 30, volatility: 0.06 }, score: 1 },
      { opponent: { rating: 1550, deviation: 100, volatility: 0.06 }, score: 0 },
      { opponent: { rating: 1700, deviation: 300, volatility: 0.06 }, score: 0 },
    ]);

    assert.ok(
      Math.abs(updated.rating - 1464.06) < 0.05,
      `rating ${updated.rating.toFixed(2)} != 1464.06`,
    );
    assert.ok(
      Math.abs(updated.deviation - 151.52) < 0.05,
      `deviation ${updated.deviation.toFixed(2)} != 151.52`,
    );
    assert.ok(
      Math.abs(updated.volatility - 0.05999) < 0.0001,
      `volatility ${updated.volatility.toFixed(5)} != 0.05999`,
    );
  });

  test("RD grows with inactivity — the per-match correction", () => {
    // The whole reason this function exists: applied per match, an inactive
    // player is never touched, so without this their RD stays frozen and the
    // system stays confident about someone it has not seen in a year.
    const settled: Rating = { rating: 1600, deviation: 60, volatility: 0.06 };

    const sameDay = decayedDeviation(settled, 0);
    const oneWeek = decayedDeviation(settled, 7 * RATING_PERIOD_MS);
    const oneYear = decayedDeviation(settled, 365 * RATING_PERIOD_MS);

    assert.equal(sameDay, 60, "no elapsed time must not change RD");
    assert.ok(oneWeek > sameDay, "a week must widen RD");
    assert.ok(oneYear > oneWeek, "a year must widen it further");
    assert.ok(oneYear <= MAX_RD, `RD must stay bounded, got ${oneYear}`);
  });

  test("an inactive player's rating moves further than a regular's", () => {
    const active: Rating = { rating: 1600, deviation: 60, volatility: 0.06 };
    const opponent: Rating = { rating: 1600, deviation: 60, volatility: 0.06 };

    const activeAfter = updateRating(active, [{ opponent, score: 1 }], 0);
    const rustyAfter = updateRating(active, [{ opponent, score: 1 }], 200 * RATING_PERIOD_MS);

    assert.ok(
      rustyAfter.rating - 1600 > activeAfter.rating - 1600,
      "a returning player's rating must be more responsive, not less",
    );
  });

  test("a win raises the winner and lowers the loser by comparable amounts", () => {
    const { p1, p2 } = rateMatch({
      p1: { rating: 1500, deviation: 80, volatility: 0.06 },
      p2: { rating: 1500, deviation: 80, volatility: 0.06 },
      p1Score: 1,
    });
    assert.ok(p1.rating > 1500, "winner must gain");
    assert.ok(p2.rating < 1500, "loser must lose");
    assert.ok(
      Math.abs(p1.rating - 1500 - (1500 - p2.rating)) < 0.5,
      "symmetric players must see symmetric swings",
    );
  });

  test("beating a much stronger player moves more than beating a peer", () => {
    const me: Rating = { rating: 1500, deviation: 80, volatility: 0.06 };
    const peer = rateMatch({ p1: me, p2: { ...me }, p1Score: 1 }).p1;
    const upset = rateMatch({
      p1: me,
      p2: { rating: 1900, deviation: 80, volatility: 0.06 },
      p1Score: 1,
    }).p1;
    assert.ok(upset.rating > peer.rating, "an upset must be worth more");
  });

  test("a draw between equals barely moves anything", () => {
    const { p1, p2 } = rateMatch({
      p1: { rating: 1500, deviation: 80, volatility: 0.06 },
      p2: { rating: 1500, deviation: 80, volatility: 0.06 },
      p1Score: 0.5,
    });
    // A dead match (nobody solved) is scored as a draw, and two equal players
    // drawing is exactly what the model predicted — so the ratings should not
    // move, only the confidence.
    assert.ok(Math.abs(p1.rating - 1500) < 0.001, `p1 moved to ${p1.rating}`);
    assert.ok(Math.abs(p2.rating - 1500) < 0.001, `p2 moved to ${p2.rating}`);
    assert.ok(p1.deviation < 80, "a played match must reduce uncertainty");
  });

  test("a placement player's rating moves much further than a settled one", () => {
    const fresh = updateRating(
      DEFAULT_GLICKO,
      [{ opponent: { rating: 1500, deviation: 60, volatility: 0.06 }, score: 1 }],
    );
    const settled = updateRating(
      { rating: 1500, deviation: 50, volatility: 0.06 },
      [{ opponent: { rating: 1500, deviation: 60, volatility: 0.06 }, score: 1 }],
    );
    assert.ok(
      fresh.rating - 1500 > (settled.rating - 1500) * 2,
      "high RD must mean fast convergence",
    );
  });

  test("no result still widens RD and never produces NaN", () => {
    const idle = updateRating(
      { rating: 1700, deviation: 55, volatility: 0.06 },
      [],
      30 * RATING_PERIOD_MS,
    );
    assert.ok(Number.isFinite(idle.rating), "rating must stay finite");
    assert.ok(idle.deviation > 55, "RD must widen");
    assert.equal(idle.rating, 1700, "an unplayed period must not move the rating");
  });
});
