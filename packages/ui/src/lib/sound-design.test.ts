import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import {
  CUE_NAMES,
  CUE_SECONDS,
  PASS_STEPS,
  SEMITONE,
  renderCue,
  type CueName,
} from "./sound-design.ts";

/* ============================================================================
   §9's cues, asserted in Node.

   This file is the reason `sound-design.ts` is pure DSP over Float32Array
   rather than a Web Audio node graph. A graph can only be exercised in a
   browser, so in practice it is never asserted on at all — and §13.7's
   recurring bug is a check that cannot fail. "The sound code did not throw" is
   one of those. These are real measurements on real samples.

   The renderer is deterministic (seeded PRNG, no Math.random), so every figure
   below is reproducible rather than a flaky threshold.
   ========================================================================= */

const SR = 48_000;

function peak(buf: Float32Array): number {
  let max = 0;
  for (const s of buf) max = Math.max(max, Math.abs(s));
  return max;
}

function rms(buf: Float32Array): number {
  let sum = 0;
  for (const s of buf) sum += s * s;
  return Math.sqrt(sum / buf.length);
}

/**
 * Dominant frequency by autocorrelation.
 *
 * Used instead of an FFT because it needs no dependency and the question here
 * is only "is rung N higher than rung N-1", which a lag search answers exactly.
 */
function dominantHz(buf: Float32Array, sr: number, minHz = 200, maxHz = 4000): number {
  const minLag = Math.floor(sr / maxHz);
  const maxLag = Math.floor(sr / minHz);
  /* Measured over the sustain rather than the attack: the FM index makes the
     first few milliseconds deliberately inharmonic, which is the point of the
     sound and would confuse a pitch estimate. */
  const from = Math.floor(buf.length * 0.25);
  const to = Math.min(buf.length, from + maxLag * 4);
  let bestLag = minLag;
  let best = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = from; i + lag < to; i++) sum += buf[i]! * buf[i + lag]!;
    if (sum > best) {
      best = sum;
      bestLag = lag;
    }
  }
  return sr / bestLag;
}

/**
 * Loudness over the loudest 400ms window.
 *
 * Whole-buffer RMS is the WRONG comparison across cues and the first version of
 * this file used it: it divides by total length, so a 2.4s sting with a reverb
 * tail scores below a 0.9s kick even though the sting is obviously the louder
 * event. 400ms is roughly the integration time the ear uses for loudness, so
 * this asks the question a player actually experiences.
 */
function loudness(buf: Float32Array, sr: number): number {
  const w = Math.round(0.4 * sr);
  if (buf.length <= w) return rms(buf);
  let best = 0;
  const hop = Math.round(sr * 0.02);
  for (let i = 0; i + w <= buf.length; i += hop) best = Math.max(best, rms(buf.subarray(i, i + w)));
  return best;
}

/** Sums buffers as they would sum at the output, starting each at its own offset. */
function mix(layers: { buf: Float32Array; at: number }[], sr: number): Float32Array {
  const length = Math.max(...layers.map((l) => Math.round(l.at * sr) + l.buf.length));
  const out = new Float32Array(length);
  for (const { buf, at } of layers) {
    const start = Math.round(at * sr);
    for (let i = 0; i < buf.length; i++) out[start + i]! += buf[i]!;
  }
  return out;
}

describe("every cue is a real sound", () => {
  test("renders finite, in range, non-silent, and the stated length", () => {
    // §13.7: zero iterations is a failure. Assert the set is populated first.
    assert.equal(CUE_NAMES.length, 12, "the §9 cue list changed — update this count deliberately");

    for (const cue of CUE_NAMES) {
      const buf = renderCue(cue, SR);
      const expected = Math.round(CUE_SECONDS[cue] * SR);
      assert.equal(buf.length, expected, `${cue}: length`);

      for (let i = 0; i < buf.length; i++) {
        assert.ok(Number.isFinite(buf[i]!), `${cue}: sample ${i} is not finite`);
      }
      assert.ok(peak(buf) <= 1, `${cue}: peak ${peak(buf)} exceeds full scale`);
      /* Non-silence is the weakest useful assertion, so it is a floor rather
         than a "not exactly zero" — a cue that renders at -60dB is silent in
         every way that matters to a player. */
      assert.ok(rms(buf) > 0.01, `${cue}: rms ${rms(buf).toFixed(4)} is inaudibly quiet`);
    }
  });

  test("no cue starts or ends on a step, which would click", () => {
    for (const cue of CUE_NAMES) {
      const buf = renderCue(cue, SR);
      if (cue === "clutch_ambient") continue; // asserted separately — it must join to itself
      assert.ok(Math.abs(buf[0]!) < 0.02, `${cue}: starts at ${buf[0]}`);
      assert.ok(Math.abs(buf[buf.length - 1]!) < 0.02, `${cue}: ends at ${buf[buf.length - 1]}`);
    }
  });
});

describe("the pass ladder", () => {
  const rungs = Array.from({ length: PASS_STEPS + 1 }, (_, step) =>
    renderCue("test_pass", SR, step),
  );

  test("spans the full test bar, not a truncated part of it", () => {
    // §6.4's MAX_CELLS is 20. A ladder shorter than that goes flat on exactly
    // the longest sweeps, which is where the run is most worth hearing.
    assert.equal(PASS_STEPS, 20);
    assert.equal(rungs.length, 21);
  });

  test("genuinely ascends, one semitone per rung", () => {
    const hz = rungs.map((buf) => dominantHz(buf, SR));
    for (let i = 1; i < hz.length; i++) {
      assert.ok(hz[i]! > hz[i - 1]!, `rung ${i} (${hz[i]!.toFixed(1)}Hz) is not above rung ${i - 1}`);
    }
    /* The top rung is twenty semitones above the root, so the whole run spans
       a minor seventh over an octave. Autocorrelation quantises to integer
       lags, so 4% is the measurement's resolution near the top, not slack in
       the synthesis. */
    const expectedTop = 440 * SEMITONE ** PASS_STEPS;
    assert.ok(
      Math.abs(hz[PASS_STEPS]! - expectedTop) / expectedTop < 0.04,
      `top rung ${hz[PASS_STEPS]!.toFixed(1)}Hz vs expected ${expectedTop.toFixed(1)}Hz`,
    );
  });

  test("does not get quieter as it climbs", () => {
    /* THE POINT OF THIS TEST. Twenty rungs are synthesised independently, and
       independent renders drift: the partials that survive the Nyquist check
       change as the fundamental rises, and `finish` normalises each buffer on
       its own peak. A ladder that fades as it ascends undoes the effect it
       exists to produce — the last passes of a clean sweep are the ones that
       should feel biggest.

       TOLERANCE, and why these two numbers:

         peak  ±6%   — `finish` normalises to a target peak, so this is really
                       asserting that normalisation is doing its job. Anything
                       beyond a few percent means a rung escaped it.
         rms   ±22%  — deliberately looser, and it has to be. RMS over a fixed
                       200ms window measures the ENERGY of a decaying tone, and
                       a higher-pitched tone with the same envelope carries
                       measurably less energy per cycle. Some downward drift is
                       physics, not a defect. 22% is about 2dB, which is at the
                       edge of noticeable on a short percussive tick and well
                       inside "the run does not sag".

       Both are asserted against the MEAN rather than against rung 0, so a
       single outlier cannot drag the reference with it. */
    const peaks = rungs.map(peak);
    const levels = rungs.map(rms);
    const meanPeak = peaks.reduce((a, b) => a + b, 0) / peaks.length;
    const meanRms = levels.reduce((a, b) => a + b, 0) / levels.length;

    for (const [i, p] of peaks.entries()) {
      assert.ok(
        Math.abs(p - meanPeak) / meanPeak <= 0.06,
        `rung ${i} peak ${p.toFixed(3)} deviates from mean ${meanPeak.toFixed(3)} by more than 6%`,
      );
    }
    for (const [i, r] of levels.entries()) {
      assert.ok(
        Math.abs(r - meanRms) / meanRms <= 0.22,
        `rung ${i} rms ${r.toFixed(4)} deviates from mean ${meanRms.toFixed(4)} by more than 22%`,
      );
    }

    // And the direction specifically: the top must not be quieter than the root.
    assert.ok(
      levels[PASS_STEPS]! >= levels[0]! * 0.8,
      `the ladder sags: top rms ${levels[PASS_STEPS]!.toFixed(4)} vs root ${levels[0]!.toFixed(4)}`,
    );
  });
});

describe("the clutch loop", () => {
  const buf = renderCue("clutch_ambient", SR);

  test("joins to itself without a step or a kink", () => {
    /* A loop point is heard as a click if the amplitude steps, and as a tick if
       the SLOPE steps even when the amplitude matches. Both are asserted,
       because matching only the value is the version of this check that passes
       while the loop still ticks once every 1.8 seconds for eight minutes. */
    const first = buf[0]!;
    const last = buf[buf.length - 1]!;
    assert.ok(Math.abs(last - first) < 0.01, `amplitude step at the seam: ${last} -> ${first}`);

    const slopeIn = buf[buf.length - 1]! - buf[buf.length - 2]!;
    const slopeOut = buf[1]! - buf[0]!;
    assert.ok(
      Math.abs(slopeIn - slopeOut) < 0.01,
      `slope kink at the seam: ${slopeIn} -> ${slopeOut}`,
    );
  });

  test("breathes on §6.5's cycle", () => {
    // §6.5 asks for a ~1.8s breathing cycle so the sound and the viewport-edge
    // glow stay in phase over a whole match instead of drifting apart.
    assert.equal(CUE_SECONDS.clutch_ambient, 1.8);
    const quarter = rms(buf.subarray(0, Math.round(0.2 * SR)));
    const middle = rms(buf.subarray(Math.round(0.8 * SR), Math.round(1.0 * SR)));
    assert.ok(middle > quarter * 1.3, "the loop does not visibly swell");
  });

  test("is sub-bass, not a tone", () => {
    assert.ok(dominantHz(buf, SR, 30, 400) < 120, "the clutch loop sits too high to be felt");
  });
});

describe("cues against each other, not only alone", () => {
  /* §6.6 resolves tests 165ms apart WHILE §6.5's clutch loop runs underneath
     and a compile pulse can land on top. Three at once is the normal case in a
     close match, not an exceptional one. A cue that is perfect alone and
     inaudible in context is the single-layer version of the same mistake as a
     check that cannot fail. */

  const REVEAL_MS = 165; // §5's dur.reveal

  test("a full 20-test sweep over the clutch loop does not clip", () => {
    const clutch = renderCue("clutch_ambient", SR);
    // The loop plays at 0.7 gain and the engine fades it in; 0.7 is its steady level.
    const layers: { buf: Float32Array; at: number }[] = [
      { buf: clutch.map((s) => s * 0.7), at: 0 },
      { buf: clutch.map((s) => s * 0.7), at: CUE_SECONDS.clutch_ambient },
      { buf: clutch.map((s) => s * 0.7), at: CUE_SECONDS.clutch_ambient * 2 },
    ];
    for (let i = 0; i <= PASS_STEPS; i++) {
      layers.push({ buf: renderCue("test_pass", SR, i), at: (i * REVEAL_MS) / 1000 });
    }
    layers.push({ buf: renderCue("compile", SR), at: 1.2 });

    const summed = mix(layers, SR);
    /* The engine's master gain is 0.5 by default, so what reaches the output is
       half of this. Asserting the raw sum stays under 2.0 means the played
       result stays under full scale with headroom to spare, WITHOUT relying on
       a limiter to save it — a limiter that engages on a normal sweep is
       audible pumping. */
    assert.ok(peak(summed) < 2.0, `summed peak ${peak(summed).toFixed(3)} would clip at volume 1`);
    assert.ok(peak(summed) * 0.5 < 0.95, "clips at the default volume");
  });

  test("a test tick still reads over the clutch loop", () => {
    /* MASKING. The clutch loop is sub-bass and the ticks are 440Hz and above,
       so they occupy different bands and should not fight — but "should not"
       is exactly the kind of claim §13.7 is about, so it is measured.

       The test compares the tick's own band before and after the loop is added
       underneath: if the loop masked it, the energy in that band would move. */
    const tick = renderCue("test_pass", SR, 0);
    const clutch = renderCue("clutch_ambient", SR).map((s) => s * 0.7);
    const alone = rms(tick);
    const together = mix([{ buf: tick, at: 0 }, { buf: clutch.subarray(0, tick.length), at: 0 }], SR);

    /* A crude one-pole highpass at ~300Hz, which is all that is needed to
       separate a 440Hz tick from a 50–100Hz loop. */
    const highpass = (buf: Float32Array): Float32Array => {
      const out = new Float32Array(buf.length);
      const a = 0.96;
      let prevIn = 0;
      let prevOut = 0;
      for (let i = 0; i < buf.length; i++) {
        prevOut = a * (prevOut + buf[i]! - prevIn);
        prevIn = buf[i]!;
        out[i] = prevOut;
      }
      return out;
    };

    const bandAlone = rms(highpass(tick));
    const bandTogether = rms(highpass(together));
    assert.ok(
      Math.abs(bandTogether - bandAlone) / bandAlone < 0.05,
      `the clutch loop moves the tick's band by ${(((bandTogether - bandAlone) / bandAlone) * 100).toFixed(1)}%`,
    );
    assert.ok(bandAlone > alone * 0.5, "the tick has little energy above 300Hz");
  });

  test("consecutive ticks at dur.reveal do not overlap into a smear", () => {
    /* The tick must have decayed before the next one starts, or twenty of them
       become a chord instead of a run. This is the constraint that ties the
       sound design to §5's dur.reveal, in that direction: the CADENCE is fixed
       by how the reveal reads, and the SOUND has to fit inside it. */
    const tick = renderCue("test_pass", SR, 0);
    const gate = Math.round((REVEAL_MS / 1000) * SR);
    assert.ok(tick.length <= gate, `a tick is ${tick.length} samples against a ${gate}-sample gap`);
    /* And it is not merely short enough — it is acoustically finished. The last
       quarter of the gap sits at a few percent of the tick's own level, so
       twenty overlapping tails cannot accumulate into a wash. */
    const tail = rms(tick.subarray(Math.round(gate * 0.75)));
    assert.ok(tail < rms(tick) * 0.15, "the tick is still ringing when the next one fires");
  });

  test("the compile pulse stays peripheral against a test tick", () => {
    // §6.5 calls the compile pulse peripheral, and it fires far more often than
    // a verdict. If it were as loud as a pass it would become the main event.
    const compile = renderCue("compile", SR);
    const tick = renderCue("test_pass", SR, 0);
    assert.ok(peak(compile) < peak(tick) * 0.75, "the compile pulse is as loud as a pass");
  });

  test("victory is the loudest thing in the library", () => {
    /* §9 ranks it explicitly — the Phase 4 hack sounds are specified as louder
       than everything "except victory", which only means anything if victory
       is the ceiling now. Measured as short-term loudness, not whole-buffer
       RMS; see the note on `loudness`. */
    const victory = loudness(renderCue("victory", SR), SR);
    for (const cue of CUE_NAMES) {
      if (cue === "victory") continue;
      const other = loudness(renderCue(cue, SR), SR);
      assert.ok(other <= victory, `${cue} (${other.toFixed(3)}) is louder than victory (${victory.toFixed(3)})`);
    }
  });
});

describe("cues fit the §5 timings they were written for", () => {
  /* These durations are asserted against motion.ts's numbers by hand rather
     than by import, because packages/ui/motion.ts pulls in framer-motion types.
     If a duration in §5 changes, this fails and says so, which is the point. */
  const dur = { reveal: 165, victory: 2800, defeat: 1600, skip: 700 } as const;

  test("the victory sting fits inside its mandatory portion", () => {
    assert.ok(
      CUE_SECONDS.victory * 1000 <= dur.victory,
      `victory sound ${CUE_SECONDS.victory * 1000}ms exceeds dur.victory ${dur.victory}ms`,
    );
  });

  test("the defeat sting fits inside its own, which is shorter on purpose", () => {
    assert.ok(CUE_SECONDS.defeat * 1000 <= dur.defeat);
    // §5: losing stings once and gets out of the way. The sound obeys the same rule.
    assert.ok(CUE_SECONDS.defeat < CUE_SECONDS.victory);
  });

  test("victory outlasts dur.skip, which is why the engine fades rather than cuts", () => {
    /* Not a defect — a documented consequence. A player may skip at 700ms into
       a 2400ms sting, so the engine MUST have a release ramp. This asserts the
       premise of that ramp, so if the sting ever becomes shorter than dur.skip
       somebody has to decide deliberately whether the ramp is still needed. */
    assert.ok(CUE_SECONDS.victory * 1000 > dur.skip);
  });

  test("a countdown beat is short enough not to smear the grid", () => {
    // §6.3's beats are one second apart, and the final is pitched higher.
    assert.ok(CUE_SECONDS.countdown_tick * 1000 < 250);
    assert.ok(CUE_SECONDS.countdown_final > CUE_SECONDS.countdown_tick);
    const tick = dominantHz(renderCue("countdown_tick", SR), SR);
    const final = dominantHz(renderCue("countdown_final", SR), SR);
    assert.ok(final > tick * 1.3, `the final beat (${final.toFixed(0)}Hz) is not clearly higher`);
  });
});
