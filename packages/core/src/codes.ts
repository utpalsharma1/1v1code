import { randomBytes } from "node:crypto";

/* ============================================================================
   Shareable codes — spectator links and challenge links

   Generated from a CSPRNG, never from a cuid. The session-token lesson applies
   directly: a cuid embeds a timestamp and a counter, so it is partially
   predictable, and a walkable code makes UNLISTED mean nothing at all.

   Alphabet is Crockford Base32 — digits and uppercase letters minus I, L, O and
   U — chosen so a code can be read aloud without spelling it out. There is no
   "was that a one or an el" and no accidental profanity from the missing U.
   ========================================================================= */

export const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_LENGTH = 10;

/**
 * 32^10 = 1.126 × 10^15 codes.
 *
 * Collisions, handled by the unique constraint plus a retry, so these are
 * insert retries rather than bugs:
 *
 *   birthday collision at    10k matches   4.4 × 10^-8
 *   birthday collision at     1M matches   4.4 × 10^-4   (1 in ~2,250)
 *   birthday collision at    10M matches   4.4 × 10^-2
 *
 * Enumeration — expected time for a blind attacker to find ONE live unlisted
 * match, at 1000 guesses/second, against the number of matches live at once:
 *
 *      300 live (today)     119 years
 *    5,000 live               7.1 years
 *  100,000 live             130 days
 *  1,000,000 live            13 days
 *
 * The last figure is the one that matters, and it is why the code space is NOT
 * the defence on its own: the attack gets easier exactly as the product
 * succeeds. `/watch/<code>` must be rate-limited per IP with failed lookups
 * weighted heavily — at 20 failed lookups/minute the same attack takes over a
 * century from one address. See §7.
 *
 * (An earlier version of this comment claimed 35 years at 1M live. That was
 * expected *guesses* misread as seconds — a 1000× error in the safe direction,
 * which is the direction that gets believed.)
 *
 * Ten characters is two spoken groups of five — comparable to a meeting ID, and
 * short enough to give someone over a call.
 */
export function generateCode(length = CODE_LENGTH): string {
  // Rejection-free because 256 is a multiple of 32: every byte maps to exactly
  // one symbol with no modulo bias.
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i]! & 31];
  return out;
}

/** Display form: two groups of five, `K7M2X-9QRT4`. */
export function formatCode(code: string): string {
  return code.length === 10 ? `${code.slice(0, 5)}-${code.slice(5)}` : code;
}

/** Accepts either form, and is forgiving about the characters people mistype. */
export function normaliseCode(input: string): string | null {
  const cleaned = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    // The four excluded letters are excluded precisely because people confuse
    // them; map them to what the speaker almost certainly meant.
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0")
    .replace(/U/g, "V");
  if (cleaned.length !== CODE_LENGTH) return null;
  for (const char of cleaned) if (!CODE_ALPHABET.includes(char)) return null;
  return cleaned;
}
