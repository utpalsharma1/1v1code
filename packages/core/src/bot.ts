/* ============================================================================
   Bot behaviour model (§8, "The bot")

   Two stages, deliberately separated:

     1. WHETHER it solves comes from the Elo expectation against the problem, so
        the bot's win rate is correct by construction rather than tuned by hand.
     2. WHEN it solves, given that it does, is drawn from a lognormal whose
        median scales with difficulty.

   Doing it in one stage — "draw a time, solve if it fits" — couples the two and
   makes the win rate an emergent property of a timing curve nobody calibrated.
   A bot rated 1300 that always solves in four minutes is not rated 1300.
   ========================================================================= */

/** Probability the bot solves a problem at all, from the rating gap. */
export function solveProbability(botRating: number, problemRating: number): number {
  return 1 / (1 + 10 ** ((problemRating - botRating) / 400));
}

/**
 * Median solve time as a fraction of the match, from the rating gap.
 * −400 → a quarter of the way in; equal → halfway; +400 → late.
 */
export function medianFraction(botRating: number, problemRating: number): number {
  const d = problemRating - botRating;
  const f = 0.25 + (0.5 * (d + 400)) / 800;
  return Math.min(0.9, Math.max(0.15, f));
}

/** Box–Muller. Seeded so a match can be replayed deterministically. */
function gaussian(random: () => number): number {
  const u = Math.max(random(), Number.EPSILON);
  const v = Math.max(random(), Number.EPSILON);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface BotPlan {
  /** Whether the bot will solve within the match at all. */
  solves: boolean;
  /** Monotonic ms after match start at which it submits. Null when it never does. */
  submitAtMs: number | null;
  probability: number;
}

/**
 * Decide, once, what the bot will do this match.
 *
 * Planned up front rather than rolled during play so the outcome cannot drift
 * with server load, and so the plan is a single value the event log can record.
 */
export function planBotMatch(opts: {
  botRating: number;
  problemRating: number;
  matchDurationMs: number;
  random?: () => number;
}): BotPlan {
  const random = opts.random ?? Math.random;
  const probability = solveProbability(opts.botRating, opts.problemRating);

  if (random() >= probability) {
    return { solves: false, submitAtMs: null, probability };
  }

  const median = medianFraction(opts.botRating, opts.problemRating) * opts.matchDurationMs;
  // σ 0.25: enough that two matches on the same problem never look identical,
  // small enough that the median still means something.
  const jittered = median * Math.exp(0.25 * gaussian(random));

  // Never instant, never so late it is indistinguishable from not solving.
  const earliest = opts.matchDurationMs * 0.12;
  const latest = opts.matchDurationMs * 0.95;
  const submitAtMs = Math.round(Math.min(latest, Math.max(earliest, jittered)));

  return { solves: true, submitAtMs, probability };
}

/** Bot matches are rated only while the system does not know where you belong. */
export const PLACEMENT_RD_THRESHOLD = 100;

export function botMatchIsRated(playerRd: number, placementsLeft: number): boolean {
  return placementsLeft > 0 || playerRd > PLACEMENT_RD_THRESHOLD;
}
