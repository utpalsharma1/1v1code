import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { monotonicMs } from "@1v1/core";
import { prisma } from "@1v1/db";
import {
  JUDGE_QUEUE_KEY,
  type Language,
  JudgeEventSchema,
  JudgeJobSchema,
  judgeChannel,
  type JudgeEvent,
} from "@1v1/proto";

/* ============================================================================
   Submissions — receipt order, the in-flight lock, and the judge stream.

   THE RECEIPT STAMP IS THE WHOLE POINT OF THIS FILE (§6.9).

   `receipt()` is called the instant a submission arrives and BEFORE anything
   else happens — before validation, before the database, before the job is
   queued. That value is the sole authority for who won and for the
   elapsed-time tiebreak.

   Why it cannot be anything else:

   · Not the verdict time. The judge is a queue with finite slots and a C++ job
     takes ~5.5s against Python's ~1.8s, so once there is any queue depth the
     order verdicts return is not the order submissions were made. Deciding on
     verdict order means a player loses because someone else's job was ahead of
     theirs in a queue they cannot see — indistinguishable from cheating, from
     the losing player's seat.
   · Not `Date.now()`. The wall clock is not monotonic and has been measured
     stepping backward 2514ms on this host. An ordering key that can move
     backward is not an ordering key.

   Queue wait and judge duration are recorded as diagnostics and are never
   inputs to the result.
   ========================================================================= */

const REDIS_URL = process.env["REDIS_URL"] ?? "redis://localhost:6379";

/** Stamp first. Everything else can fail; this must already have happened. */
export const receipt = (): bigint => BigInt(Math.round(monotonicMs()));

export interface SubmissionStreamHandlers {
  onQueued: (total: number) => void;
  onTest: (ordinal: number, verdict: string, passed: number, total: number) => void;
  onStatus: (status: "compiling" | "running") => void;
  onVerdict: (result: {
    verdict: string;
    passed: number;
    total: number;
    failedAt: number | null;
    message: string | null;
  }) => void;
}

export interface SubmitRequest {
  matchId: string;
  userId: string;
  problemId: string;
  problemSlug: string;
  language: Language;
  source: string;
  receiptMs: bigint;
}

/** One outstanding submission per player (§6.8b). The cost of a wrong answer
 *  is this lock, which is self-balancing: it scales with the language you chose
 *  and the judge's real behaviour rather than an invented penalty constant. It
 *  also bounds judge load at two concurrent jobs per match no matter how hard
 *  anyone mashes submit. */
const inFlight = new Set<string>();
const lockKey = (matchId: string, userId: string) => `${matchId}:${userId}`;

export const isInFlight = (matchId: string, userId: string): boolean =>
  inFlight.has(lockKey(matchId, userId));

export class SubmissionRunner {
  private readonly publisher = new Redis(REDIS_URL);

  async close(): Promise<void> {
    await this.publisher.quit().catch(() => undefined);
  }

  /**
   * Persists the submission, queues the job, and streams verdicts back.
   * Resolves when the submission reaches a terminal verdict.
   */
  async run(request: SubmitRequest, handlers: SubmissionStreamHandlers): Promise<string> {
    const key = lockKey(request.matchId, request.userId);
    inFlight.add(key);

    try {
      const problem = await prisma.problem.findUnique({
        where: { id: request.problemId },
        select: {
          timeLimitMs: true,
          memoryLimitMb: true,
          testCases: {
            orderBy: { ordinal: "asc" },
            select: { ordinal: true, input: true, expected: true },
          },
        },
      });
      if (!problem) throw new Error(`unknown problem ${request.problemId}`);

      const submission = await prisma.submission.create({
        data: {
          userId: request.userId,
          problemId: request.problemId,
          matchId: request.matchId,
          language: request.language,
          source: request.source,
          verdict: "PENDING",
          total: problem.testCases.length,
          // The ordering key, written with the row (§6.9).
          receiptMs: request.receiptMs,
        },
        select: { id: true },
      });

      handlers.onQueued(problem.testCases.length);

      const queuedAt = monotonicMs();
      const result = await this.judge(
        {
          jobId: randomUUID(),
          submissionId: submission.id,
          language: request.language,
          source: request.source,
          tests: problem.testCases,
          timeLimitMs: problem.timeLimitMs,
          memoryLimitMb: problem.memoryLimitMb,
        },
        handlers,
      );

      await prisma.submission.update({
        where: { id: submission.id },
        data: {
          verdict: result.verdict as never,
          passed: result.passed,
          failedAt: result.failedAt,
          message: result.message,
          // Diagnostics. Never inputs to the result (§6.9).
          judgeMs: Math.round(monotonicMs() - queuedAt),
        },
      });

      handlers.onVerdict(result);
      return submission.id;
    } finally {
      inFlight.delete(key);
    }
  }

  /** Publishes the job and relays each judge event as it lands. */
  private judge(
    job: unknown,
    handlers: SubmissionStreamHandlers,
  ): Promise<{
    verdict: string;
    passed: number;
    total: number;
    failedAt: number | null;
    message: string | null;
  }> {
    const parsed = JudgeJobSchema.safeParse(job);
    if (!parsed.success) {
      return Promise.resolve({
        verdict: "INTERNAL_ERROR",
        passed: 0,
        total: 0,
        failedAt: null,
        message: "malformed job",
      });
    }

    return new Promise((resolve) => {
      const subscriber = new Redis(REDIS_URL);
      let passed = 0;
      let settled = false;

      const finish = (result: {
        verdict: string;
        passed: number;
        total: number;
        failedAt: number | null;
        message: string | null;
      }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void subscriber.quit().catch(() => undefined);
        resolve(result);
      };

      /* §6.7b: the hold must be bounded. A verdict that never arrives — a dead
         worker, a lost Redis message — cannot hang the match forever. A hold
         with no timeout is a bug wearing a design. */
      const timer = setTimeout(() => {
        finish({
          verdict: "INTERNAL_ERROR",
          passed,
          total: parsed.data.tests.length,
          failedAt: null,
          message: "the judge did not respond in time",
        });
      }, JUDGE_CEILING_MS);

      subscriber.on("message", (_channel, raw) => {
        let event: JudgeEvent;
        try {
          event = JudgeEventSchema.parse(JSON.parse(raw as string));
        } catch {
          return; // Malformed payloads are ignored, never fatal.
        }

        switch (event.kind) {
          case "compiling":
            handlers.onStatus("compiling");
            break;
          case "running":
            handlers.onStatus("running");
            break;
          case "test": {
            if (event.verdict === "ACCEPTED") passed += 1;
            handlers.onTest(event.ordinal, event.verdict, passed, parsed.data.tests.length);
            break;
          }
          case "compile-failed":
            finish({
              verdict: event.verdict,
              passed: 0,
              total: parsed.data.tests.length,
              failedAt: null,
              message: event.message ?? null,
            });
            break;
          case "done":
            finish({
              verdict: event.verdict,
              passed: event.passed,
              total: event.total,
              failedAt: event.failedAt ?? null,
              message: null,
            });
            break;
          case "error":
            finish({
              verdict: "INTERNAL_ERROR",
              passed,
              total: parsed.data.tests.length,
              failedAt: null,
              message: event.message,
            });
            break;
        }
      });

      void (async () => {
        await subscriber.subscribe(judgeChannel(parsed.data.jobId));
        // Subscribe BEFORE queueing, or a fast job publishes into the void.
        await this.publisher.lpush(JUDGE_QUEUE_KEY, JSON.stringify(parsed.data));
      })();
    });
  }
}

/** Container wall clock plus generous slack (§6.7b). Compilation alone gets
 *  10s, and a full test set can legitimately take a while, so this is a
 *  backstop against a dead worker rather than a performance limit. */
const JUDGE_CEILING_MS = 90_000;
