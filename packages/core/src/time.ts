/* ============================================================================
   Time discipline (§11)

   `Date.now()` is not monotonic. This host was measured stepping the system
   clock backward 2514ms inside a 20-second window. Every duration, ordering
   decision and timeout in the product therefore comes from a monotonic source;
   the wall clock is only ever a timestamp a human reads.

   Importing `Date.now` for a duration is the bug this module exists to prevent.
   ========================================================================= */

/** Monotonic milliseconds. Only ever increases, immune to clock steps. */
export const monotonicMs = (): number => Number(process.hrtime.bigint() / 1_000_000n);

/** Wall-clock milliseconds. DISPLAY ONLY — never sort, diff or compare with it. */
export const wallMs = (): number => Date.now();

/**
 * A stopwatch pinned to the monotonic clock.
 *
 * The server owns the match clock (§10) and the client's is display only, so
 * this is the single source of "how long has this match been running".
 */
export class Stopwatch {
  private readonly startedAt: number;
  private stoppedAt: number | null = null;

  constructor() {
    this.startedAt = monotonicMs();
  }

  /** Milliseconds since construction, frozen once stopped. */
  elapsed(): number {
    return (this.stoppedAt ?? monotonicMs()) - this.startedAt;
  }

  stop(): number {
    this.stoppedAt ??= monotonicMs();
    return this.elapsed();
  }

  get running(): boolean {
    return this.stoppedAt === null;
  }
}

/**
 * A deadline on the monotonic clock.
 *
 * setTimeout is already monotonic internally, but a deadline you can *query*
 * matters for the countdown and for reconnect grace: a client that reconnects
 * needs to be told how much time is left, not when the timer was set.
 */
export class Deadline {
  private readonly expiresAt: number;

  constructor(inMs: number) {
    this.expiresAt = monotonicMs() + inMs;
  }

  remaining(): number {
    return Math.max(0, this.expiresAt - monotonicMs());
  }

  get expired(): boolean {
    return this.remaining() === 0;
  }
}
