import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { JUDGE_QUEUE_KEY, JudgeJobSchema, judgeChannel, type JudgeEvent } from "@1v1/proto";
import { prisma } from "@1v1/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* Enqueues a submission and streams the judge's events straight back over SSE.
   The stream is the point: §11 requires per-test results to arrive individually
   so §6.6's sequential reveal has something real to reveal. */

const REDIS_URL = process.env["REDIS_URL"] ?? "redis://localhost:6379";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { problemSlug, language, source } = (body ?? {}) as Record<string, unknown>;
  if (typeof problemSlug !== "string" || typeof language !== "string" || typeof source !== "string") {
    return Response.json({ error: "problemSlug, language and source are required" }, { status: 400 });
  }

  const problem = await prisma.problem.findUnique({
    where: { slug: problemSlug },
    select: {
      id: true,
      timeLimitMs: true,
      memoryLimitMb: true,
      testCases: { orderBy: { ordinal: "asc" }, select: { ordinal: true, input: true, expected: true } },
    },
  });
  if (!problem) return Response.json({ error: "unknown problem" }, { status: 404 });

  const jobId = randomUUID();
  const job = JudgeJobSchema.safeParse({
    jobId,
    submissionId: null,
    language,
    source,
    tests: problem.testCases,
    timeLimitMs: problem.timeLimitMs,
    memoryLimitMb: problem.memoryLimitMb,
  });
  if (!job.success) {
    return Response.json({ error: job.error.issues[0]?.message ?? "invalid job" }, { status: 400 });
  }

  const subscriber = new Redis(REDIS_URL);
  const producer = new Redis(REDIS_URL);
  const channel = judgeChannel(jobId);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      const send = (event: JudgeEvent | { kind: "queued"; jobId: string }) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      const shutdown = async () => {
        if (closed) return;
        closed = true;
        await subscriber.quit().catch(() => {});
        await producer.quit().catch(() => {});
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // Subscribe before enqueueing, or a fast judge can publish the first
      // event into the void before anyone is listening.
      await subscriber.subscribe(channel);
      subscriber.on("message", (_channel, payload) => {
        try {
          const event = JSON.parse(payload) as JudgeEvent;
          send(event);
          if (event.kind === "done" || event.kind === "error") void shutdown();
        } catch {
          /* ignore malformed */
        }
      });

      await producer.lpush(JUDGE_QUEUE_KEY, JSON.stringify(job.data));
      send({ kind: "queued", jobId });

      // If no worker is running, don't hold the connection open forever.
      setTimeout(() => {
        send({ kind: "error", jobId, message: "judge did not respond within 90s" });
        void shutdown();
      }, 90_000);
    },
    cancel() {
      void subscriber.quit().catch(() => {});
      void producer.quit().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
