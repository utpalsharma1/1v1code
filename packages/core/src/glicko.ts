/* ============================================================================
   Glicko-2 (§8)

   Glicko-2 is defined over rating *periods*, not per-game updates. We apply it
   per match, which is fine, but it makes one thing mandatory:

     RD MUST GROW WITH TIME SINCE A PLAYER'S LAST MATCH.

   In the original formulation that happens automatically because every player
   is processed once per period whether they played or not. Applied per match,
   an inactive player is simply never touched — so their RD stays frozen at
   whatever it was, and the system remains maximally confident about someone it
   has not observed in a year. They then return, beat a stranger, and the
   ratings barely move because the model thinks it already knows them.

   `decayedDeviation` below is what restores that, and it is applied to both
   players before every match update.
   ========================================================================= */

const SCALE = 173.7178;
const DEFAULT_RATING = 1500;

/** Glickman's system constant: how volatile volatility itself is allowed to be.
 *  Smaller is steadier. 0.5 is the paper's suggested range midpoint. */
export const TAU = 0.5;

/** One rating period. A day is short enough that RD recovers at a human pace
 *  and long enough that a normal evening's play is one period. */
export const RATING_PERIOD_MS = 24 * 60 * 60 * 1000;

/** RD ceiling. Beyond this the rating carries no information anyway, and an
 *  unbounded RD makes matchmaking pair a returning player with anyone at all. */
export const MAX_RD = 350;
/** RD floor. Zero uncertainty is never true and makes ratings unable to move. */
export const MIN_RD = 30;

export interface Rating {
  rating: number;
  deviation: number;
  volatility: number;
}

export interface MatchResult {
  opponent: Rating;
  /** 1 win, 0 loss, 0.5 draw. */
  score: number;
}

export const DEFAULT_GLICKO: Rating = {
  rating: DEFAULT_RATING,
  deviation: MAX_RD,
  volatility: 0.06,
};

/**
 * Grow RD for time elapsed since the player's last rated match.
 *
 * phi* = sqrt(phi^2 + sigma^2 * t), with t in rating periods. This is the
 * pre-period step from the paper, applied lazily instead of on a schedule.
 */
export function decayedDeviation(rating: Rating, msSinceLastMatch: number): number {
  if (msSinceLastMatch <= 0) return rating.deviation;
  const periods = msSinceLastMatch / RATING_PERIOD_MS;
  const phi = rating.deviation / SCALE;
  const grown = Math.sqrt(phi * phi + rating.volatility * rating.volatility * periods);
  return Math.min(MAX_RD, grown * SCALE);
}

const g = (phi: number): number => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));

const expected = (mu: number, muJ: number, phiJ: number): number =>
  1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

/**
 * Solve for the new volatility by Illinois-variant regula falsi, exactly as
 * Glickman specifies. This is the only part of Glicko-2 that is iterative and
 * the only part that is easy to get subtly wrong.
 */
function solveVolatility(phi: number, sigma: number, v: number, delta: number): number {
  const a = Math.log(sigma * sigma);
  const f = (x: number): number => {
    const ex = Math.exp(x);
    const num = ex * (delta * delta - phi * phi - v - ex);
    const den = 2 * (phi * phi + v + ex) ** 2;
    return num / den - (x - a) / (TAU * TAU);
  };

  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0 && k < 100) k++;
    B = a - k * TAU;
  }

  let fA = f(A);
  let fB = f(B);
  let guard = 0;
  while (Math.abs(B - A) > 1e-6 && guard++ < 100) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }
  return Math.exp(A / 2);
}

/**
 * Update one player against a set of results from a single rating period.
 *
 * `msSinceLastMatch` grows RD first, which is the correction that makes
 * per-match application legitimate.
 */
export function updateRating(
  player: Rating,
  results: MatchResult[],
  msSinceLastMatch = 0,
): Rating {
  const startingRd = decayedDeviation(player, msSinceLastMatch);

  // No games this period: RD grows and nothing else changes.
  if (results.length === 0) {
    return { ...player, deviation: Math.min(MAX_RD, Math.max(MIN_RD, startingRd)) };
  }

  const mu = (player.rating - DEFAULT_RATING) / SCALE;
  const phi = startingRd / SCALE;

  let vInv = 0;
  let deltaSum = 0;
  for (const { opponent, score } of results) {
    const muJ = (opponent.rating - DEFAULT_RATING) / SCALE;
    const phiJ = opponent.deviation / SCALE;
    const gJ = g(phiJ);
    const e = expected(mu, muJ, phiJ);
    vInv += gJ * gJ * e * (1 - e);
    deltaSum += gJ * (score - e);
  }

  const v = 1 / vInv;
  const delta = v * deltaSum;

  const sigmaPrime = solveVolatility(phi, player.volatility, v, delta);
  const phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime);
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muPrime = mu + phiPrime * phiPrime * deltaSum;

  return {
    rating: muPrime * SCALE + DEFAULT_RATING,
    deviation: Math.min(MAX_RD, Math.max(MIN_RD, phiPrime * SCALE)),
    volatility: sigmaPrime,
  };
}

export interface HeadToHead {
  p1: Rating;
  p2: Rating;
  /** 1 = p1 won, 0 = p2 won, 0.5 = draw (nobody solved). */
  p1Score: number;
  p1MsSinceLastMatch?: number;
  p2MsSinceLastMatch?: number;
}

/** Both sides of one match, each updated against the other's *pre-match* rating. */
export function rateMatch(input: HeadToHead): { p1: Rating; p2: Rating } {
  return {
    p1: updateRating(
      input.p1,
      [{ opponent: input.p2, score: input.p1Score }],
      input.p1MsSinceLastMatch ?? 0,
    ),
    p2: updateRating(
      input.p2,
      [{ opponent: input.p1, score: 1 - input.p1Score }],
      input.p2MsSinceLastMatch ?? 0,
    ),
  };
}
