/* ============================================================================
   Append-only match event log (§10)

   "Every match writes an append-only JSONL event log to disk/S3 — this file IS
   the replay. Replay playback must be a pure function of that log."

   Two consequences that shape everything here:

   1. THE LOG MUST BE COMPLETE BEFORE ANYTHING READS IT. It is written from the
      first commit rather than retrofitted, because a log that was added after
      the fact is a log with holes in exactly the places nobody thought about.

   2. ORDER COMES FROM `seq`, NEVER FROM A TIMESTAMP. §11: the wall clock can
      step backward — it was measured doing so on this host by 2.5 seconds. A
      replay that sorts by timestamp reorders itself when the host clock drifts,
      which would be an unexplainable bug six months from now. Every event
      carries three time fields with three different jobs:

        seq       monotonic integer assigned at ingest, gapless. SORT BY THIS.
        offsetMs  monotonic ms since match start. For scrubbing and the timeline.
        wallMs    wall clock. DISPLAY ONLY. Never sort, diff, or compare it.
   ========================================================================= */

import { monotonicMs, wallMs } from "./time.ts";

/** The envelope every logged event shares. Payloads are defined in proto. */
export interface LoggedEvent<T = unknown> {
  seq: number;
  offsetMs: number;
  wallMs: number;
  type: string;
  payload: T;
}

export interface AppendSink {
  write(line: string): void | Promise<void>;
}

/**
 * Assigns sequence numbers and offsets, and serialises to JSONL.
 *
 * The writer is the only thing allowed to assign `seq`, which is what makes the
 * ordering authoritative: if two subsystems could both stamp events the numbers
 * would collide or gap, and a gap is indistinguishable from a lost event.
 */
export class MatchEventLog {
  private seq = 0;
  private readonly startedAt: number;
  // Declared and assigned rather than a constructor parameter property:
  // parameter properties are not erasable syntax, and this repo runs .ts
  // directly through Node's strip-only loader, which rejects them at runtime.
  private readonly sink: AppendSink;

  constructor(
    sink: AppendSink,
    /** Match start on the monotonic clock. Defaults to construction time. */
    startedAtMonotonic?: number,
  ) {
    this.sink = sink;
    this.startedAt = startedAtMonotonic ?? monotonicMs();
  }

  /** Appends one event and returns exactly what was written. */
  async append<T>(type: string, payload: T): Promise<LoggedEvent<T>> {
    const event: LoggedEvent<T> = {
      seq: ++this.seq,
      offsetMs: monotonicMs() - this.startedAt,
      wallMs: wallMs(),
      type,
      payload,
    };
    await this.sink.write(`${JSON.stringify(event)}\n`);
    return event;
  }

  get count(): number {
    return this.seq;
  }
}

/** Collects into memory. Used by tests and by the bot; production writes files. */
export class MemorySink implements AppendSink {
  readonly lines: string[] = [];
  write(line: string): void {
    this.lines.push(line);
  }
}

export interface ParsedLog {
  events: LoggedEvent[];
  /** Lines that could not be parsed. A truncated final line is normal for an
   *  append-only file that was being written when the process died. */
  malformed: number;
}

/**
 * Parse a JSONL log into ordered events.
 *
 * Sorting is by `seq` and only by `seq`. Gaps are reported rather than
 * silently tolerated: a gap means an event was lost, and a replay missing an
 * event is a replay that shows something that did not happen.
 */
export function parseLog(jsonl: string): ParsedLog {
  const events: LoggedEvent[] = [];
  let malformed = 0;

  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as LoggedEvent;
      if (typeof parsed.seq !== "number" || typeof parsed.type !== "string") {
        malformed++;
        continue;
      }
      events.push(parsed);
    } catch {
      malformed++;
    }
  }

  events.sort((a, b) => a.seq - b.seq);
  return { events, malformed };
}

/** Sequence numbers must be 1..n with no gaps and no repeats. */
export function checkSequence(events: LoggedEvent[]): { ok: boolean; problem?: string } {
  for (let i = 0; i < events.length; i++) {
    const expected = i + 1;
    const actual = events[i]!.seq;
    if (actual !== expected) {
      return { ok: false, problem: `expected seq ${expected} at index ${i}, found ${actual}` };
    }
  }
  return { ok: true };
}

/**
 * Fold a log into a state. THIS is the "replay is a pure function of the log"
 * property, made executable: same log in, same state out, with no clock read
 * and no I/O anywhere in the fold.
 */
export function replay<S>(
  events: LoggedEvent[],
  initial: S,
  step: (state: S, event: LoggedEvent) => S,
): S {
  return events.reduce(step, initial);
}
