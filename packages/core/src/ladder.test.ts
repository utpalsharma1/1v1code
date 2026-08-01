import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import {
  DIVISIONS,
  PLACEMENT_MATCHES,
  TIERS,
  auraOf,
  ladderChange,
  rankOf,
  standingOf,
  tierFloor,
} from "./ladder.ts";

describe("the ladder", () => {
  test("the worked example from the brief", () => {
    /* §8 wants "Gold II, N to Platinum" where the product used to show 1442. */
    const rank = rankOf(1442);
    assert.equal(rank.label, "Gold II");
    assert.equal(rank.nextTier, "platinum");
    assert.equal(rank.toNextTier, 58);
  });

  test("every tier boundary lands in the tier it opens", () => {
    for (const tier of TIERS) {
      const floor = tierFloor(tier);
      if (!Number.isFinite(floor)) continue;
      assert.equal(rankOf(floor).tier, tier, `${floor} should open ${tier}`);
      assert.equal(
        rankOf(floor - 1).tier,
        TIERS[TIERS.indexOf(tier) - 1],
        `${floor - 1} should still be the tier below ${tier}`,
      );
    }
  });

  test("a tier's bottom is division IV and its top is division I", () => {
    assert.equal(rankOf(1300).division, "IV");
    assert.equal(rankOf(1499).division, "I");
    /* Divisions must not skip: walking a tier hits all four in order. */
    const seen = [1300, 1350, 1400, 1450].map((r) => rankOf(r).division);
    assert.deepEqual(seen, [...DIVISIONS]);
  });

  test("rating is monotonic in rank — more rating never means a worse tier", () => {
    let previous = -1;
    for (let rating = 0; rating <= 3000; rating += 7) {
      const index = TIERS.indexOf(rankOf(rating).tier);
      assert.ok(index >= previous, `rank went backwards at ${rating}`);
      previous = index;
    }
  });

  test("Iron is open-ended downward and never produces a negative or NaN progress", () => {
    for (const rating of [-500, 0, 100, 500, 899]) {
      const rank = rankOf(rating);
      assert.equal(rank.tier, "iron");
      assert.ok(rank.progress >= 0 && rank.progress <= 1, `progress out of range at ${rating}`);
      assert.ok(Number.isFinite(rank.toNextTier!), `toNextTier not finite at ${rating}`);
    }
  });

  test("Legend has no division and no next tier", () => {
    const rank = rankOf(5000);
    assert.equal(rank.tier, "legend");
    assert.equal(rank.division, null);
    assert.equal(rank.nextTier, null);
    assert.equal(rank.toNextTier, null);
    assert.equal(rank.label, "Legend");
  });

  test("progress is a fraction of the tier, not of the ladder", () => {
    assert.equal(rankOf(1300).progress, 0);
    assert.equal(rankOf(1400).progress, 0.5);
    assert.ok(rankOf(1499).progress > 0.99);
  });
});

describe("placements", () => {
  test("no badge until placements are done", () => {
    for (let played = 0; played < PLACEMENT_MATCHES; played++) {
      const standing = standingOf(1500, played);
      assert.equal(standing.kind, "placement");
      assert.equal(standing.remaining, PLACEMENT_MATCHES - played);
    }
    assert.equal(standingOf(1500, PLACEMENT_MATCHES).kind, "ranked");
  });

  test("the last placement reads as singular", () => {
    const standing = standingOf(1500, PLACEMENT_MATCHES - 1);
    assert.equal(standing.label, "1 placement left");
  });
});

describe("what earns a cinematic", () => {
  test("a tier change does", () => {
    const change = ladderChange(
      { rating: 1499, ratedMatches: 20 },
      { rating: 1505, ratedMatches: 21 },
    );
    assert.equal(change.kind, "tier");
    assert.equal(change.kind === "tier" && change.up, true);
  });

  test("a division change does NOT — it would fire four times per tier", () => {
    const change = ladderChange(
      { rating: 1340, ratedMatches: 20 },
      { rating: 1360, ratedMatches: 21 },
    );
    assert.equal(change.kind, "division");
  });

  test("drifting inside one division is nothing at all", () => {
    const change = ladderChange(
      { rating: 1310, ratedMatches: 20 },
      { rating: 1320, ratedMatches: 21 },
    );
    assert.equal(change.kind, "none");
  });

  test("finishing placements is a tier change — it is the first badge ever", () => {
    const change = ladderChange(
      { rating: 1500, ratedMatches: PLACEMENT_MATCHES - 1 },
      { rating: 1500, ratedMatches: PLACEMENT_MATCHES },
    );
    assert.equal(change.kind, "tier");
    assert.equal(change.kind === "tier" && change.from, null);
  });

  test("nothing fires while still placing", () => {
    const change = ladderChange(
      { rating: 1200, ratedMatches: 1 },
      { rating: 1600, ratedMatches: 2 },
    );
    assert.equal(change.kind, "none");
  });

  test("demotion is detected and is not reported as an ascent", () => {
    const change = ladderChange(
      { rating: 1505, ratedMatches: 20 },
      { rating: 1490, ratedMatches: 21 },
    );
    assert.equal(change.kind, "tier");
    assert.equal(change.kind === "tier" && change.up, false);
  });
});

describe("tier aura (§4)", () => {
  test("most tiers get none — that restraint is the point", () => {
    for (const tier of ["iron", "bronze", "silver", "gold"] as const) {
      assert.equal(auraOf(tier), "none");
    }
  });

  test("faint at Platinum and Diamond, full at Master and above", () => {
    assert.equal(auraOf("platinum"), "faint");
    assert.equal(auraOf("diamond"), "faint");
    assert.equal(auraOf("master"), "full");
    assert.equal(auraOf("grandmaster"), "full");
    assert.equal(auraOf("legend"), "full");
  });

  test("no tier is left unclassified", () => {
    for (const tier of TIERS) {
      assert.ok(["none", "faint", "full"].includes(auraOf(tier)), `${tier} unclassified`);
    }
  });
});
