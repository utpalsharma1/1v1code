/* Browser-safe half of the spectator-code module.

   `codes.ts` imports node:crypto for `generateCode`, which webpack cannot
   bundle for a browser — importing it from a page 500s the whole route. The
   FORMATTING and DECODING rules are pure, and the /watch input needs exactly
   those, so they live here and `codes.ts` re-exports them. */

export const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_LENGTH = 10;

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
