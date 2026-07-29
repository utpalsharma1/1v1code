import {
  Deadline,
  Stopwatch,
  initialContext,
  isTerminal,
  monotonicMs,
  transition,
  type MatchContext,
  type MatchEvent,
  type MatchState,
} from "@1v1/core";
import type { PlayerCard, Side } from "@1v1/proto";
import { ReplayLog } from "./replay-log.ts";

/* ============================================================================
   A live match: the state machine plus the timers it cannot own.

   The machine in packages/core is pure — no clock, no I/O — which is what makes
   it testable. This class is the impure half: real timers, the replay log, and
   the callback that pushes to sockets. Keeping the split sharp means the hard
   logic stays exhaustively tested and this file stays boring.

   RECONNECTION, decided rather than improvised:

   · Grace period is 45s from the socket dropping.
   · The MATCH CLOCK KEEPS RUNNING. Pausing it would reward pulling your network
     cable when behind — the clock is the shared resource and stopping it buys
     free thinking time. Grace protects you from a blip; it does not protect you
     from the cost of the blip. You lose the seconds, not the match.
   · The opponent sees the disconnected player's nameplate go to a disconnected
     state with the grace countdown visible. Not hidden: knowing your opponent
     dropped is part of the match, and concealing it would make the eventual
     forfeit feel arbitrary.
   · On return the server sends `match.resync` with the whole state — phase,
     sides, remaining clock, accept flags, presence, problem. The client rebuilds
     from that snapshot rather than replaying deltas, because a client that has
     been away has no reliable idea what it missed.
   · Grace expiry forfeits to the connected opponent. Both gone voids the match.
   ========================================================================= */

export const GRACE_MS = 45_000;
export const ACCEPT_MS = 12_000;
export const COUNTDOWN_BEAT_MS = 1_000;
export const DEFAULT_MATCH_MS = 8 * 60 * 1000;

export interface LiveMatchPlayers {
  p1: PlayerCard;
  p2: PlayerCard;
}

export interface MatchProblem {
  slug: string;
  title: string;
  rating: number;
  statement: string;
  constraints: string;
}

type Emit = (event: string, payload: unknown) => void;

export class LiveMatch {
  readonly id: string;
  readonly players: LiveMatchPlayers;
  readonly problem: MatchProblem;
  readonly durationMs: number;

  private ctx: MatchContext = initialContext();
  private readonly log: ReplayLog;
  private readonly emit: Emit;
  private readonly onFinished: (match: LiveMatch) => void;

  private clock: Stopwatch | null = null;
  private acceptDeadline: Deadline | null = null;
  private timers = new Set<NodeJS.Timeout>();
  private grace = new Map<Side, { deadline: Deadline; timer: NodeJS.Timeout }>();

  constructor(opts: {
    id: string;
    players: LiveMatchPlayers;
    problem: MatchProblem;
    emit: Emit;
    onFinished: (match: LiveMatch) => void;
    durationMs?: number;
  }) {
    this.id = opts.id;
    this.players = opts.players;
    this.problem = opts.problem;
    this.emit = opts.emit;
    this.onFinished = opts.onFinished;
    this.durationMs = opts.durationMs ?? DEFAULT_MATCH_MS;
    this.log = new ReplayLog(this.id);
  }

  get state(): MatchState {
    return this.ctx.state;
  }
  get context(): MatchContext {
    return this.ctx;
  }
  get logPath(): string {
    return this.log.path;
  }

  sideOf(userId: string): Side | null {
    if (this.players.p1.userId === userId) return "p1";
    if (this.players.p2.userId === userId) return "p2";
    return null;
  }

  remainingMs(): number {
    if (!this.clock) return this.durationMs;
    return Math.max(0, this.durationMs - this.clock.elapsed());
  }

  private later(fn: () => void, ms: number): NodeJS.Timeout {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      void fn();
    }, ms);
    this.timers.add(timer);
    return timer;
  }

  /**
   * Apply an event, then record it. Write-behind (§10): the log must never
   * contain something that did not happen.
   */
  private async apply(event: MatchEvent): Promise<boolean> {
    const before = this.ctx.state;
    const result = transition(this.ctx, event);

    if (!result.ok) {
      console.warn(`[match ${this.id}] refused ${event.type} in ${before}: ${result.rejected}`);
      return false;
    }
    this.ctx = result.context;

    if (result.changed) {
      console.log(`[match ${this.id}] ${before} -> ${this.ctx.state} (${event.type})`);
      await this.log.record("match.state", {
        from: before,
        to: this.ctx.state,
        via: event.type,
      });
      // Flush at every transition: this is what bounds worst-case log loss.
      await this.log.checkpoint();
    }

    if (result.changed) await this.onEnter(this.ctx.state);
    return result.changed;
  }

  private async onEnter(state: MatchState): Promise<void> {
    switch (state) {
      case "ACCEPTING": {
        this.acceptDeadline = new Deadline(ACCEPT_MS);
        this.later(() => void this.apply({ type: "ACCEPT_TIMEOUT" }), ACCEPT_MS);
        this.emit("match.found", this.foundPayload());
        break;
      }
      case "COUNTDOWN":
        void this.runCountdown();
        break;
      case "LIVE":
        if (!this.clock) {
          this.clock = new Stopwatch();
          await this.log.record("match.started", {
            problem: this.problem.slug,
            durationMs: this.durationMs,
          });
          this.emit("match.start", {
            matchId: this.id,
            problem: this.problem,
            durationMs: this.durationMs,
          });
          this.later(() => void this.apply({ type: "CLOCK_EXPIRED" }), this.durationMs);
          this.tickClock();
        }
        break;
      case "ENDED":
      case "ABANDONED":
        await this.finish();
        break;
      default:
        break;
    }
  }

  private tickClock(): void {
    if (isTerminal(this.ctx.state)) return;
    this.emit("match.clock", {
      matchId: this.id,
      remainingMs: this.remainingMs(),
      // The clock never pauses — see the header. `paused` exists for Bo3
      // between-game breaks in Phase 4, not for disconnects.
      paused: false,
    });
    this.later(() => this.tickClock(), 1000);
  }

  private async runCountdown(): Promise<void> {
    for (const beat of [3, 2, 1, 0]) {
      if (this.ctx.state !== "COUNTDOWN") return;
      this.emit("match.countdown", { matchId: this.id, beat });
      await this.log.record("countdown.beat", { beat });
      await new Promise((r) => setTimeout(r, COUNTDOWN_BEAT_MS));
    }
    if (this.ctx.state === "COUNTDOWN") await this.apply({ type: "COUNTDOWN_COMPLETE" });
  }

  foundPayload() {
    return {
      matchId: this.id,
      p1: this.players.p1,
      p2: this.players.p2,
      problemRating: this.problem.rating,
      acceptMs: this.acceptDeadline?.remaining() ?? ACCEPT_MS,
      headToHead: "first meeting",
    };
  }

  resyncFor(side: Side) {
    return {
      matchId: this.id,
      state: this.ctx.state,
      you: side,
      p1: this.players.p1,
      p2: this.players.p2,
      remainingMs: this.remainingMs(),
      accepted: { ...this.ctx.accepted },
      connected: { ...this.ctx.connected },
      problem: this.ctx.state === "LIVE" || this.ctx.state === "JUDGING" ? this.problem : null,
    };
  }

  /* ── Public transitions ─────────────────────────────────────────────── */

  async open(): Promise<void> {
    await this.log.record("match.created", {
      p1: this.players.p1.userId,
      p2: this.players.p2.userId,
      problem: this.problem.slug,
    });
    await this.apply({ type: "MATCH_FOUND" });
    await this.apply({ type: "ACCEPT_WINDOW_OPEN" });
  }

  /** Idempotent by construction — see the state machine. */
  async accept(side: Side): Promise<void> {
    const changed = await this.apply({ type: "PLAYER_ACCEPTED", side });
    await this.log.record("match.accepted", { side });
    this.emit("match.accept.progress", {
      matchId: this.id,
      p1: this.ctx.accepted.p1,
      p2: this.ctx.accepted.p2,
    });
    void changed;
  }

  async disconnected(side: Side): Promise<void> {
    if (isTerminal(this.ctx.state)) return;
    await this.apply({ type: "PLAYER_DISCONNECTED", side });
    await this.log.record("presence.changed", { side, connected: false });

    const deadline = new Deadline(GRACE_MS);
    const timer = this.later(() => {
      this.grace.delete(side);
      void this.apply({ type: "GRACE_EXPIRED", side });
    }, GRACE_MS);
    this.grace.set(side, { deadline, timer });

    this.emit("match.presence", {
      matchId: this.id,
      side,
      connected: false,
      graceRemainingMs: GRACE_MS,
    });
  }

  async reconnected(side: Side): Promise<void> {
    const pending = this.grace.get(side);
    if (pending) {
      clearTimeout(pending.timer);
      this.timers.delete(pending.timer);
      this.grace.delete(side);
    }
    if (isTerminal(this.ctx.state)) return;
    await this.apply({ type: "PLAYER_RECONNECTED", side });
    await this.log.record("presence.changed", { side, connected: true });
    this.emit("match.presence", {
      matchId: this.id,
      side,
      connected: true,
      graceRemainingMs: 0,
    });
  }

  graceRemaining(side: Side): number {
    return this.grace.get(side)?.deadline.remaining() ?? 0;
  }

  private async finish(): Promise<void> {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const { timer } of this.grace.values()) clearTimeout(timer);
    this.grace.clear();
    this.clock?.stop();

    const outcome = this.ctx.outcome ?? { kind: "CANCELED" as const, reason: "NEVER_STARTED" as const };
    await this.log.record("match.ended", { outcome, elapsedMs: this.clock?.elapsed() ?? 0 });
    await this.log.close();

    this.emit("match.end", { matchId: this.id, outcome });
    console.log(
      `[match ${this.id}] finished: ${outcome.kind} — log ${this.log.path} (${this.log.count} events)`,
    );
    this.onFinished(this);
  }

  /** Used when the process is shutting down. */
  async abandonNow(): Promise<void> {
    if (isTerminal(this.ctx.state)) return;
    await this.log.record("match.ended", { outcome: { kind: "CANCELED", reason: "BOTH_ABANDONED" } });
    await this.log.close();
  }

  static monotonicNow = monotonicMs;
}
