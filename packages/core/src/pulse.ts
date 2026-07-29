/* ============================================================================
   Turning real keystrokes into a §6.4 pulse level.

   The simulator produced a *level* directly — a smooth 0–1 signal with
   persistent states. Real typing is nothing like that at the wire: it is a
   sparse impulse train, mostly zeros and ones per 125ms sample, because a fast
   human types 4–5 characters a second and a 125ms window holds about half a
   character.

   So the shape of the pipeline matters more than the constants:

     keystroke counts  ->  normalise against a full-scale rate  ->  asymmetric EMA

   THE ASYMMETRIC SMOOTHING TRANSFERS, AND IT MATTERS MORE HERE THAN IT DID IN
   THE SIMULATOR. Rising 0.6 / falling 0.18 was chosen so bursts start hard and
   silence arrives gently, because a symmetric filter rounds the leading edge
   off every burst and throws away the only thing the graph exists to show.
   Against an impulse train that is not merely preserved, it is the mechanism:
   the fast attack turns the first keystroke of a burst into a visible onset
   within one sample, and the slow release is what makes a thinking pause read
   as a decline rather than a cliff.

   WHAT DID NOT TRANSFER IS THE SCALE, and one honest consequence.

   The simulator's `target` was already in level units, so it never needed a
   scale. Real counts do — see PULSE_FULL_SCALE, which was retuned by
   simulation rather than assumed.

   The consequence: real typing is 2–3× jaggier tick to tick than the
   simulator was (mean absolute step ~0.076 against ~0.026). That is not a
   defect to filter out. The simulator was smooth because it held a persistent
   `target` for dozens of ticks; a human does not, and the texture is the
   actual signal. Do not add smoothing to make it look like the simulator
   again — that would be tuning the instrument to match the model instead of
   the world.
   ========================================================================= */

/** ~8fps, matching §6.4's stated update rate and the simulator's tick. */
export const PULSE_SAMPLE_MS = 125;

/**
 * Keystrokes per sample that read as "flat out". RETUNED AGAINST REAL TYPING.
 *
 * The first value here was 2.5 (20 chars/sec), reasoned from headroom alone.
 * Simulating an eight-minute match at 8fps against Poisson keystrokes says
 * that is far too high — the trace hugs the floor for a normal typist:
 *
 *   full scale   5 c/s typist        9 c/s burst        slow 3 c/s
 *   2.5          mean 0.28  p50 0.29  mean 0.44          46% below 0.05
 *   1.5          mean 0.36  p50 0.40  mean 0.55 p95 0.95 54% below 0.05
 *   1.0          mean 0.45  p50 0.52  p95 0.999 (pinned) 54% below 0.05
 *
 * 1.5 is where ordinary typing sits mid-range, a real burst reaches p95 ≈ 0.95
 * with headroom left, and pauses still fall to the floor — which is the whole
 * comparison §6.4 exists to make. At 1.0 a merely normal typist already pins
 * the graph, so a burst has nowhere to go.
 */
export const PULSE_FULL_SCALE = 1.5;

/** Fast attack: a burst's leading edge is the signal. */
export const PULSE_RISE = 0.6;
/** Slow release: silence should arrive, not slam shut. */
export const PULSE_FALL = 0.18;

/** How many samples the HUD keeps — §6.4 asks for the last 60 seconds. */
export const PULSE_WINDOW = Math.round(60_000 / PULSE_SAMPLE_MS);

/**
 * Fold one sample's keystroke count into a running level.
 *
 * Pure, so it can be tested and so both the live HUD and any replay consumer
 * produce identical traces from identical input.
 */
export function pulseStep(level: number, keystrokes: number): number {
  const target = Math.min(1, keystrokes / PULSE_FULL_SCALE);
  const alpha = target > level ? PULSE_RISE : PULSE_FALL;
  const next = level + (target - level) * alpha;
  return Math.max(0, Math.min(1, next));
}

/** Convenience: fold a whole series, oldest first. */
export function pulseSeries(counts: number[], from = 0): number[] {
  let level = from;
  return counts.map((count) => (level = pulseStep(level, count)));
}
