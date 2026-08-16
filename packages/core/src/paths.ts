import { existsSync, mkdirSync, accessSync, constants } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

/* ============================================================================
   Shared paths, resolved ABSOLUTELY and in one place.

   THE BUG THIS EXISTS FOR. `REPLAY_DIR` defaulted to the relative string
   `"var/replays"` in FOUR separate files — the gateway's log writer, the
   lifecycle probe, the pulse calibrator, and the web app's replay route. Each
   resolved it against its own working directory. The gateway runs from the repo
   root and the Next server runs from `apps/web`, so the same string named two
   different directories and every finished match reported "no log was
   recorded".

   It is the same class as the pidfile name mismatch: two things agree only
   while an unstated assumption holds, and nothing says so when it stops. Here
   the assumption was a shared working directory, which is exactly what changes
   on a real host — systemd units, containers and a reverse proxy all place
   processes differently, so this would have broken again on Oracle and looked
   like a different bug.

   So: one resolver, absolute, and it REFUSES rather than silently writing
   somewhere unexpected. A relative `REPLAY_DIR` is resolved against the repo
   root — never against `process.cwd()` — so the meaning of the configured value
   does not depend on who is asking.
   ========================================================================= */

/** Walks up to the directory holding the workspace manifest. */
export function repoRoot(from: string = process.cwd()): string {
  let dir = resolve(from);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  /* No manifest found: return the starting point rather than guessing. The
     caller's `ensureWritable` will then fail loudly on a wrong directory
     instead of creating one in a surprising place. */
  return resolve(from);
}

/**
 * Where match replay logs live. Absolute, always.
 *
 * An absolute `REPLAY_DIR` is used as given — that is how a real deployment
 * points it at a volume. A relative one is resolved against the repo root, so
 * every process means the same directory by it.
 */
export function replayDir(): string {
  const configured = process.env["REPLAY_DIR"];
  if (configured && configured.length > 0) {
    return isAbsolute(configured) ? configured : join(repoRoot(), configured);
  }
  return join(repoRoot(), "var", "replays");
}

/**
 * Creates the directory if needed and proves it is writable, or throws saying
 * which path and why.
 *
 * Called by whoever WRITES logs, at startup. A process that cannot record a
 * match should say so on the line where that becomes knowable, not on the first
 * match — §10 makes the log the replay, so silently failing to write it loses
 * the match's only record.
 */
export function ensureWritable(dir: string): string {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    return dir;
  } catch (cause) {
    throw new Error(
      `replay directory is not writable: ${dir}\n` +
        `  ${cause instanceof Error ? cause.message : String(cause)}\n` +
        "  Set REPLAY_DIR to a writable absolute path. Every match's event log " +
        "goes here, and §10 makes that log the replay — losing it loses the match.",
    );
  }
}
