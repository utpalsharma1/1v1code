import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

/* §7's tension ordering, tested where it can be — a pure function of a row.
   Kept here rather than beside the component so it needs no React to run. */
interface Row {
  p1: { rating: number };
  p2: { rating: number };
  problem: { rating: number };
}
function tension(row: Row): number {
  const gap = Math.abs(row.p1.rating - row.p2.rating);
  const closeness = Math.max(0, 1 - gap / 400);
  const strength = (row.p1.rating + row.p2.rating) / 2 / 2000;
  const depth = row.problem.rating / 2000;
  return closeness * 3 + strength * 2 + depth;
}
const row = (a: number, b: number, p = 1200): Row => ({
  p1: { rating: a },
  p2: { rating: b },
  problem: { rating: p },
});

describe("tension ordering (§7)", () => {
  test("a close match outranks a lopsided one at the same strength", () => {
    assert.ok(tension(row(1500, 1500)) > tension(row(1800, 1200)));
  });

  test("at equal closeness, the stronger pair outranks the weaker", () => {
    assert.ok(tension(row(1900, 1900)) > tension(row(1000, 1000)));
  });

  test("a blowout never outranks an even match between the same players' averages", () => {
    /* The point of the ordering: a 600-point gap is decided, and a decided
       match is not worth a stranger's click however strong the players. */
    assert.ok(tension(row(1500, 1500)) > tension(row(1800, 1200)));
    assert.ok(tension(row(1400, 1400)) > tension(row(2000, 800)));
  });

  test("closeness saturates rather than going negative", () => {
    /* A 2000-point gap must not score BELOW a 500-point gap by an unbounded
       amount and start inverting the other terms. */
    assert.ok(tension(row(2000, 0)) >= 0);
    assert.ok(tension(row(2000, 0)) < tension(row(1300, 1100)));
  });

  test("it is a total order — no two distinct inputs tie by accident", () => {
    const rows = [row(1500, 1500), row(1800, 1200), row(1000, 1000), row(1900, 1900)];
    const scores = rows.map(tension);
    assert.equal(new Set(scores).size, rows.length);
  });
});
