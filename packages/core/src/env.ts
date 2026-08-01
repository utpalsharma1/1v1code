/* ============================================================================
   requireEnv — an entry point states what it needs, and refuses without it.

   The bug this exists for: a production web server started with no
   DATABASE_URL, because the script launching it never sourced `.env`. Every
   GET worked, because none of them touch Postgres, and the first route that
   did returned a 500 with an empty body. The failure surfaced to a stranger
   trying to sign up, three hops and a session away from its cause.

   A process that cannot do its job should say so on the line where that becomes
   knowable, not on the first request that happens to need the missing piece.
   And it should name EVERY missing variable at once — failing on whichever is
   alphabetically first turns one restart into three.

   The shell equivalent, for scripts, is `require_env` in scripts/lib/check.sh.
   ========================================================================= */

export class MissingEnvironment extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    super(
      `missing required environment: ${missing.join(", ")}. ` +
        "Expected in .env at the repo root. This process would have started and " +
        "then failed on first use, which puts the failure in front of a user " +
        "instead of in front of you.",
    );
    this.name = "MissingEnvironment";
    this.missing = missing;
  }
}

/**
 * Throws unless every named variable is set and non-empty.
 *
 * Call it at module top level, before anything connects to anything.
 */
export function requireEnv(...names: string[]): void {
  const missing = names.filter((name) => {
    const value = process.env[name];
    return value === undefined || value.trim() === "";
  });
  if (missing.length > 0) throw new MissingEnvironment(missing);
}
