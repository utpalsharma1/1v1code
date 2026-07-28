import { z } from "zod";

/* ============================================================================
   Judge queue contract (Phase 2A)

   Defined once here, imported by both the web app and the judge worker. §13.5
   applies to every protocol in the product, not only socket events — a shape
   duplicated across a queue boundary drifts exactly as fast as one duplicated
   across a socket.

   Socket events land in this package in Phase 2B.
   ========================================================================= */

export const LanguageSchema = z.enum(["CPP17", "PYTHON3"]);
export type Language = z.infer<typeof LanguageSchema>;

export const VerdictSchema = z.enum([
  "ACCEPTED",
  "WRONG_ANSWER",
  "TIME_LIMIT",
  "MEMORY_LIMIT",
  "RUNTIME_ERROR",
  "COMPILE_ERROR",
  "COMPILE_TIMEOUT",
  "COMPILE_MEMORY",
  "OUTPUT_LIMIT",
  "INTERNAL_ERROR",
]);
export type Verdict = z.infer<typeof VerdictSchema>;

export const JudgeTestSchema = z.object({
  ordinal: z.number().int().nonnegative(),
  input: z.string(),
  expected: z.string(),
});
export type JudgeTest = z.infer<typeof JudgeTestSchema>;

export const JudgeJobSchema = z.object({
  jobId: z.string().min(1),
  submissionId: z.string().nullable(),
  language: LanguageSchema,
  source: z.string().max(256 * 1024, "source over 256 KB"),
  tests: z.array(JudgeTestSchema).min(1).max(200),
  /** Per-test wall clock. §11 caps this at 5s and the worker enforces the cap. */
  timeLimitMs: z.number().int().min(100).max(5000),
  memoryLimitMb: z.number().int().min(16).max(256),
});
export type JudgeJob = z.infer<typeof JudgeJobSchema>;

/* Results stream back one test at a time. §11 is explicit that they must not be
   batched — §6.6's sequential reveal is built on results arriving individually,
   and a judge that returns an array at the end silently kills that. */

export const JudgeEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("compiling"), jobId: z.string() }),
  z.object({
    kind: z.literal("compile-failed"),
    jobId: z.string(),
    /** COMPILE_ERROR, COMPILE_TIMEOUT or COMPILE_MEMORY — a template bomb is
     *  not a syntax error and must not be reported as one. */
    verdict: VerdictSchema,
    message: z.string(),
  }),
  z.object({ kind: z.literal("running"), jobId: z.string(), total: z.number().int() }),
  z.object({
    kind: z.literal("test"),
    jobId: z.string(),
    ordinal: z.number().int(),
    verdict: VerdictSchema,
    runtimeMs: z.number().int().nonnegative(),
    memoryKb: z.number().int().nonnegative().nullable(),
  }),
  z.object({
    kind: z.literal("done"),
    jobId: z.string(),
    verdict: VerdictSchema,
    passed: z.number().int(),
    total: z.number().int(),
    failedAt: z.number().int().nullable(),
    runtimeMs: z.number().int().nonnegative(),
  }),
  z.object({ kind: z.literal("error"), jobId: z.string(), message: z.string() }),
]);
export type JudgeEvent = z.infer<typeof JudgeEventSchema>;

/** Redis keys. One list for jobs, one pub/sub channel per job for results. */
export const JUDGE_QUEUE_KEY = "judge:jobs";
export const judgeChannel = (jobId: string): string => `judge:events:${jobId}`;
