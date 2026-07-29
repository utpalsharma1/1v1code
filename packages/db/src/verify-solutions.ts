/* ============================================================================
   Runs every bot solution through the REAL judge.

   The bot submits these in live matches, so "probably correct" is not a
   standard. A solution that fails its own problem's tests would make the bot
   lose matches it should win, silently and unreproducibly.

   Requires Postgres, Redis, the judge worker and both images.
   Run with:  pnpm db:solutions
   ========================================================================= */

import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { PrismaClient } from "@prisma/client";
import { SOLUTIONS } from "./solutions.ts";

const REDIS_URL = process.env["REDIS_URL"] ?? "redis://localhost:6379";
const prisma = new PrismaClient();
const producer = new Redis(REDIS_URL);
const subscriber = new Redis(REDIS_URL);

interface Outcome {
  slug: string;
  verdict: string;
  passed: number;
  total: number;
  ms: number;
}

async function judge(slug: string): Promise<Outcome> {
  const problem = await prisma.problem.findUnique({
    where: { slug },
    select: {
      timeLimitMs: true,
      memoryLimitMb: true,
      testCases: {
        orderBy: { ordinal: "asc" },
        select: { ordinal: true, input: true, expected: true },
      },
    },
  });
  if (!problem) return { slug, verdict: "NO_SUCH_PROBLEM", passed: 0, total: 0, ms: 0 };

  const jobId = randomUUID();
  const channel = `judge:events:${jobId}`;
  const started = Number(process.hrtime.bigint() / 1_000_000n);

  const done = new Promise<Outcome>((resolve) => {
    const onMessage = (ch: string, payload: string) => {
      if (ch !== channel) return;
      const event = JSON.parse(payload) as Record<string, unknown>;
      if (event["kind"] === "done") {
        subscriber.off("message", onMessage);
        resolve({
          slug,
          verdict: String(event["verdict"]),
          passed: Number(event["passed"]),
          total: Number(event["total"]),
          ms: Number(process.hrtime.bigint() / 1_000_000n) - started,
        });
      }
    };
    subscriber.on("message", onMessage);
  });

  await subscriber.subscribe(channel);
  await producer.lpush(
    "judge:jobs",
    JSON.stringify({
      jobId,
      submissionId: null,
      language: "PYTHON3",
      source: SOLUTIONS[slug],
      tests: problem.testCases,
      timeLimitMs: problem.timeLimitMs,
      memoryLimitMb: problem.memoryLimitMb,
    }),
  );

  const outcome = await Promise.race([
    done,
    new Promise<Outcome>((r) =>
      setTimeout(() => r({ slug, verdict: "TIMED_OUT_WAITING", passed: 0, total: 0, ms: 0 }), 90_000),
    ),
  ]);
  await subscriber.unsubscribe(channel);
  return outcome;
}

const slugs = Object.keys(SOLUTIONS);
console.log(`Running ${slugs.length} bot solutions through the judge\n`);

let failures = 0;
for (const slug of slugs) {
  const outcome = await judge(slug);
  const ok = outcome.verdict === "ACCEPTED" && outcome.passed === outcome.total;
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${slug.padEnd(32)} ${outcome.verdict.padEnd(16)} ${outcome.passed}/${outcome.total}  ${String(outcome.ms).padStart(5)}ms`,
  );
}

console.log(
  failures === 0
    ? `\nAll ${slugs.length} bot solutions are ACCEPTED by the real judge.`
    : `\n${failures} bot solution(s) failed — the bot would lose matches it should win.`,
);

await prisma.$disconnect();
await producer.quit();
await subscriber.quit();
process.exit(failures === 0 ? 0 : 1);
