export {
  JUDGE_QUEUE_KEY,
  JudgeEventSchema,
  JudgeJobSchema,
  JudgeTestSchema,
  LanguageSchema,
  VerdictSchema,
  judgeChannel,
  type JudgeEvent,
  type JudgeJob,
  type JudgeTest,
  type Language,
  type Verdict,
  // Explicit .ts extension: apps/judge runs under bare Node ESM, which does not
  // do extensionless resolution the way a bundler does. Without it the worker
  // dies at startup with ERR_MODULE_NOT_FOUND.
} from "./judge.ts";
