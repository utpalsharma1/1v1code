/* ============================================================================
   Fake keystroke-rate signal for the pulse line (§6.4).

   The first version of this rolled a fresh Bernoulli "burst?" every tick, which
   produced smooth-ish noise — a shape that never occurs in reality. Tuning the
   rendering against that would have meant tuning it against a lie.

   Real typing during a solve has structure, and the structure IS the feature:
   long dead air while someone thinks, a sharp burst when they work it out,
   choppy medium-rate editing while they debug, short pauses between lines. A
   flatline that suddenly spikes is the moment your stomach drops, and it only
   exists if the signal has persistent states rather than per-tick randomness.

   Replaced in Phase 2 by real `opponent.pulse` events off the socket.
   ========================================================================= */

export type TypingPhase = "think" | "burst" | "edit" | "pause";

/** Sampled at ~8fps, so one tick is ~125ms. Durations below are in ticks. */
interface PhaseSpec {
  ticks: [number, number];
  level: [number, number];
  /** Per-tick chance of re-rolling the level — how choppy the phase reads. */
  churn: number;
}

const PHASES: Record<TypingPhase, PhaseSpec> = {
  // Reading, staring, thinking. 5–25s of near-nothing.
  think: { ticks: [40, 200], level: [0.0, 0.04], churn: 0.05 },
  // They worked it out. 1.5–6s of sustained high rate.
  burst: { ticks: [12, 48], level: [0.62, 1.0], churn: 0.25 },
  // Debugging: medium rate, visibly choppy. 2–8s.
  edit: { ticks: [16, 64], level: [0.18, 0.48], churn: 0.5 },
  // Between lines. Under 2s.
  pause: { ticks: [3, 13], level: [0.0, 0.06], churn: 0.1 },
};

const TRANSITIONS: Record<TypingPhase, [TypingPhase, number][]> = {
  // Thinking almost always breaks into a burst — that's the breakthrough.
  think: [["burst", 0.75], ["edit", 0.25]],
  burst: [["edit", 0.5], ["pause", 0.35], ["think", 0.15]],
  edit: [["pause", 0.4], ["burst", 0.3], ["think", 0.3]],
  pause: [["burst", 0.45], ["edit", 0.45], ["think", 0.1]],
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);

function pick(from: TypingPhase): TypingPhase {
  const table = TRANSITIONS[from];
  let roll = Math.random();
  for (const [phase, weight] of table) {
    roll -= weight;
    if (roll <= 0) return phase;
  }
  return table[table.length - 1]![0];
}

export interface TypistOptions {
  /** >1 lengthens thinking phases and sharpens bursts. */
  spikiness?: number;
}

export class FakeTypist {
  private phase: TypingPhase = "think";
  private ticksLeft = 0;
  private target = 0;
  private level = 0;
  private spikiness: number;

  constructor({ spikiness = 1 }: TypistOptions = {}) {
    this.spikiness = spikiness;
    this.enter("think");
  }

  private enter(phase: TypingPhase) {
    this.phase = phase;
    const spec = PHASES[phase];
    const stretch = phase === "think" ? this.spikiness : 1;
    this.ticksLeft = Math.round(rand(spec.ticks[0], spec.ticks[1]) * stretch);
    this.roll();
  }

  private roll() {
    const spec = PHASES[this.phase];
    const boost = this.phase === "burst" ? this.spikiness : 1;
    this.target = Math.min(1, rand(spec.level[0], spec.level[1]) * boost);
  }

  get currentPhase(): TypingPhase {
    return this.phase;
  }

  /** One ~125ms sample, 0–1. */
  next(): number {
    if (this.ticksLeft-- <= 0) this.enter(pick(this.phase));
    else if (Math.random() < PHASES[this.phase].churn) this.roll();

    // Asymmetric smoothing: bursts start hard, silence arrives gently. A
    // symmetric filter rounds the leading edge off every burst and throws away
    // the only thing the graph exists to show.
    const rising = this.target > this.level;
    this.level += (this.target - this.level) * (rising ? 0.6 : 0.18);
    return Math.max(0, Math.min(1, this.level));
  }

  /** A plausible 60-sample history, so the graph is alive on first paint. */
  history(n: number): number[] {
    return Array.from({ length: n }, () => this.next());
  }
}
