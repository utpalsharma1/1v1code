import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { PULSE_FULL_SCALE, pulseSeries, pulseStep } from "./pulse.ts";

/* The §6.4 pulse line's whole job is the comparison between a burst and a
   pause, so these pin the properties that comparison depends on. They are
   deliberately about SHAPE, not exact values — the constants are tuned by eye
   and should be free to move without breaking a test. */

describe("pulse level from real keystrokes", () => {
  test("attack is faster than release — the burst onset is the signal", () => {
    // From silence, one busy sample must move much further than one idle
    // sample moves back from the same level.
    const up = pulseStep(0, 3);
    const down = pulseStep(up, 0);
    assert.ok(up > 0.5, `one busy sample should register, got ${up}`);
    assert.ok(up - down < up * 0.25, "release must be gentler than attack");
  });

  test("a burst is clearly separable from ordinary typing", () => {
    const ordinary = pulseSeries(Array(40).fill(1)).at(-1)!;
    const burst = pulseSeries(Array(40).fill(3)).at(-1)!;
    assert.ok(burst - ordinary > 0.3, `burst ${burst} vs ordinary ${ordinary}`);
  });

  test("sustained silence reaches the floor, so a flatline means stuck", () => {
    const settled = pulseSeries(Array(40).fill(4)).at(-1)!;
    const quiet = pulseSeries(Array(40).fill(0), settled).at(-1)!;
    assert.ok(quiet < 0.05, `silence should flatline, got ${quiet}`);
  });

  test("ordinary typing does not pin the graph", () => {
    // If a normal typist already sits at full scale a burst has nowhere to go,
    // which is what full scale 1.0 got wrong.
    const ordinary = pulseSeries(Array(60).fill(1)).at(-1)!;
    assert.ok(ordinary < 0.85, `ordinary typing pinned the graph at ${ordinary}`);
  });

  test("levels stay inside 0–1 for absurd input", () => {
    for (const k of [0, 1, 50, 10_000]) {
      const v = pulseStep(0.5, k);
      assert.ok(v >= 0 && v <= 1, `${k} keystrokes produced ${v}`);
    }
    assert.ok(PULSE_FULL_SCALE > 0);
  });
});
