import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { ensureWritable, replayDir } from "@1v1/core/paths";
import { dirname, join } from "node:path";
import { MatchEventLog, type AppendSink } from "@1v1/core";

/* ============================================================================
   File-backed replay log (§10)

   WRITE-BEHIND: the effect is applied first, then the event is appended.

   The log is a recording, not a recovery journal. Write-ahead would let a crash
   between the write and the apply leave a log claiming the countdown finished
   when it never did — and a consumer has no way to detect that. Losing the tail
   is bounded, detectable, and true; fabricating an event is none of those.

   Buffering: writes go through a stream and are flushed at every lifecycle
   transition. Worst-case loss on a hard kill is therefore the events since the
   last transition — a handful in 2B, at most one 50ms delta batch in 2C. The
   stream is closed (and so fully flushed) at match end, because a log that
   survives to ENDED is a complete replay and nothing later can need it.
   ========================================================================= */

/* THE REPLAY LOG'S SCHEMA VERSION.
 *
 * 1 — handles, ratings, tiers and the problem as shown are denormalised into
 *     `match.created`, so a replay renders without touching the database.
 *
 * Logs written before this field existed carry no `schemaVersion` at all, and a
 * reader must treat "absent" as version 0 rather than as "current". Those logs
 * ALSO have corrupted delta streams (the controlled-editor bug) and are being
 * discarded rather than supported — see PROGRESS.md. The field exists so the
 * NEXT format change is a version bump instead of an archaeology exercise. */
export const REPLAY_SCHEMA_VERSION = 1;

/* Absolute, and proven writable before any match runs. Resolved by the shared
   helper so the gateway, the probes, the calibrator and the web app all mean
   the same directory — they did not, and that cost every finished match its
   replay when read from a process with a different cwd. */
export const REPLAY_DIR = ensureWritable(replayDir());

class FileSink implements AppendSink {
  private readonly stream: WriteStream;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.stream = createWriteStream(path, { flags: "a" });
  }

  write(line: string): void {
    this.stream.write(line);
  }

  /** Resolve once the OS has the bytes. Not an fsync — see the header. */
  flush(): Promise<void> {
    return new Promise((resolve) => {
      if (this.stream.writableLength === 0) return resolve();
      this.stream.once("drain", () => resolve());
      // A zero-length write forces the drain event when the buffer is small.
      this.stream.write("", () => resolve());
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.stream.end(() => resolve()));
  }
}

export class ReplayLog {
  private readonly sink: FileSink;
  private readonly log: MatchEventLog;
  readonly path: string;

  constructor(matchId: string, startedAtMonotonic?: number) {
    this.path = join(REPLAY_DIR, `${matchId}.jsonl`);
    this.sink = new FileSink(this.path);
    this.log = new MatchEventLog(this.sink, startedAtMonotonic);
  }

  /** Append an event that has ALREADY taken effect. */
  async record<T>(type: string, payload: T): Promise<void> {
    await this.log.append(type, payload);
  }

  /** Called on every lifecycle transition — bounds worst-case loss. */
  async checkpoint(): Promise<void> {
    await this.sink.flush();
  }

  async close(): Promise<void> {
    await this.sink.close();
  }

  get count(): number {
    return this.log.count;
  }
}
