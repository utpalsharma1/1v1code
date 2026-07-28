/* ============================================================================
   Judge worker

   Pulls jobs off Redis, runs one container per submission, and publishes each
   test result as it lands. Section 11: results stream individually -- section
   6.6's sequential reveal is built on that, and a worker that batches silently
   kills it.
   ========================================================================= */

import Redis from "ioredis";
import {
  JUDGE_QUEUE_KEY,
  JudgeJobSchema,
  judgeChannel,
  type JudgeEvent,
  type JudgeJob,
  type Verdict,
} from "@1v1/proto";
import {
  CONTAINER_WALL_CLOCK_MS,
  IMAGES,
  dockerAvailable,
  monotonicMs,
  runSandboxed,
} from "./sandbox.ts";

const REDIS_URL = process.env["REDIS_URL"] ?? "redis://localhost:6379";
const STRICT = process.env["JUDGE_STRICT"] !== "0";

/* ── Concurrency (see section 11) ────────────────────────────────────────
   Every slot can hold a container at the full per-submission memory limit, so
   concurrency is a straight multiplier on worst-case RAM: 256 MB x slots. The
   cap exists because the failure mode of getting this wrong is not a slow
   judge, it is the host swapping or the OOM killer picking a victim at random
   — and once that happens the queue is the least of your problems.

   The default of 4 is deliberately conservative (1 GB worst case). Raise it
   only against measured free memory, not against core count: these workloads
   are memory-bound long before they are CPU-bound, and each container is
   already pinned to half a core. */
const MAX_CONCURRENCY = 16;
const CONCURRENCY = Math.max(
  1,
  Math.min(MAX_CONCURRENCY, Number(process.env["JUDGE_CONCURRENCY"] ?? "4")),
);

const publisher = new Redis(REDIS_URL);
const consumer = new Redis(REDIS_URL);

async function publish(event: JudgeEvent): Promise<void> {
  await publisher.publish(judgeChannel(event.jobId), JSON.stringify(event));
}

async function judge(job: JudgeJob): Promise<void> {
  const image = IMAGES[job.language];
  // Monotonic: a backward system-clock step would otherwise report a negative
  // runtime, and in 2B elapsed time decides matches.
  const started = monotonicMs();

  // Held in an object rather than as locals: these are written from the
  // streaming callback, and TypeScript's control-flow analysis can't see
  // assignments across that boundary -- it would narrow `final` to whatever the
  // outer scope assigns and then reject the comparisons below as impossible.
  const state = {
    passed: 0,
    failedAt: null as number | null,
    final: "INTERNAL_ERROR" as Verdict,
    sawTerminal: false,
  };

  const payload = JSON.stringify({
    language: job.language,
    source: job.source,
    tests: job.tests,
    timeLimitMs: job.timeLimitMs,
    memoryLimitMb: job.memoryLimitMb,
  });

  const pending: Promise<void>[] = [];

  const result = await runSandboxed(
    {
      image,
      memoryLimitMb: job.memoryLimitMb,
      wallClockMs: Math.min(
        CONTAINER_WALL_CLOCK_MS,
        job.timeLimitMs * job.tests.length + 20_000,
      ),
    },
    payload,
    (line) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return; // the runner emits strict JSONL; anything else is noise
      }
      const message = parsed as Record<string, unknown>;

      switch (message["kind"]) {
        case "compiling":
          pending.push(publish({ kind: "compiling", jobId: job.jobId }));
          break;
        case "compile-failed": {
          // A template bomb or an OOM during compilation is resource
          // exhaustion, not malformed source. Reporting either as
          // COMPILE_ERROR would tell a player their correct code is broken.
          const raw = String(message["verdict"] ?? "COMPILE_ERROR");
          const compileVerdict: Verdict =
            raw === "COMPILE_TIMEOUT" || raw === "COMPILE_MEMORY"
              ? (raw as Verdict)
              : "COMPILE_ERROR";
          state.sawTerminal = true;
          state.final = compileVerdict;
          pending.push(
            publish({
              kind: "compile-failed",
              jobId: job.jobId,
              verdict: compileVerdict,
              message: String(message["message"] ?? "").slice(0, 4000),
            }),
          );
          break;
        }
        case "running":
          pending.push(
            publish({ kind: "running", jobId: job.jobId, total: job.tests.length }),
          );
          break;
        case "test": {
          const verdict = String(message["verdict"]) as Verdict;
          if (verdict === "ACCEPTED") state.passed++;
          else if (state.failedAt === null) {
            state.failedAt = Number(message["ordinal"]);
            state.final = verdict;
            state.sawTerminal = true;
          }
          pending.push(
            publish({
              kind: "test",
              jobId: job.jobId,
              ordinal: Number(message["ordinal"]),
              verdict,
              runtimeMs: Number(message["runtimeMs"] ?? 0),
              memoryKb: null,
            }),
          );
          break;
        }
        case "error":
          state.sawTerminal = true;
          state.final = "INTERNAL_ERROR";
          break;
        default:
          break;
      }
    },
  );

  await Promise.allSettled(pending);

  if (result.outputCapped) state.final = "OUTPUT_LIMIT";
  else if (result.timedOut && !state.sawTerminal) state.final = "TIME_LIMIT";
  else if (!state.sawTerminal) {
    state.final = state.passed === job.tests.length ? "ACCEPTED" : "INTERNAL_ERROR";
  }

  if (
    state.final === "COMPILE_ERROR" ||
    state.final === "COMPILE_TIMEOUT" ||
    state.final === "COMPILE_MEMORY"
  ) {
    await publish({
      kind: "done",
      jobId: job.jobId,
      verdict: state.final,
      passed: 0,
      total: job.tests.length,
      failedAt: null,
      runtimeMs: monotonicMs() - started,
    });
    return;
  }

  await publish({
    kind: "done",
    jobId: job.jobId,
    verdict: state.final,
    passed: state.passed,
    total: job.tests.length,
    failedAt: state.failedAt,
    runtimeMs: monotonicMs() - started,
  });
}

async function loop(slot: number): Promise<void> {
  for (;;) {
    try {
      const popped = await consumer.brpop(JUDGE_QUEUE_KEY, 0);
      if (!popped) continue;

      // Parse defensively rather than letting a throw reach the outer handler.
      // That path sleeps a second before retrying, so anyone who can push to
      // the queue could throttle the worker to one job per second just by
      // filling it with garbage.
      let raw: unknown;
      try {
        raw = JSON.parse(popped[1]);
      } catch {
        console.error(`[slot ${slot}] rejected unparseable job payload`);
        continue;
      }

      const parsed = JudgeJobSchema.safeParse(raw);
      if (!parsed.success) {
        console.error(`[slot ${slot}] rejected malformed job:`, parsed.error.issues[0]?.message);
        continue;
      }
      const job = parsed.data;
      console.log(`[slot ${slot}] ${job.jobId} ${job.language} ${job.tests.length} tests`);
      try {
        await judge(job);
      } catch (error) {
        await publish({
          kind: "error",
          jobId: job.jobId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } catch (error) {
      console.error(`[slot ${slot}] loop error:`, error);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

async function main(): Promise<void> {
  const hasDocker = await dockerAvailable();
  if (!hasDocker) {
    const message =
      "Docker is not reachable. The judge executes untrusted code and refuses to run without its sandbox.";
    if (STRICT) {
      console.error(`FATAL: ${message}`);
      process.exit(1);
    }
    console.warn(`WARNING: ${message}`);
  }

  /* No single submission may take down the worker, whatever it does. The
     per-job try/catch in loop() covers the expected paths; these two cover the
     unexpected ones. A judge that dies on a malformed job is a denial of
     service that any player can trigger on purpose. */
  process.on("uncaughtException", (error) => {
    console.error("uncaught exception (worker continues):", error);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("unhandled rejection (worker continues):", reason);
  });

  console.log(
    `Judge worker up: ${CONCURRENCY} slot(s) = ${CONCURRENCY * 256} MB worst case, queue "${JUDGE_QUEUE_KEY}"`,
  );
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => loop(i)));
}

void main();

