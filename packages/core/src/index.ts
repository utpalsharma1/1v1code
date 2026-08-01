export { Deadline, Stopwatch, monotonicMs, wallMs } from "./time.ts";
export {
  DEFAULT_GLICKO,
  MAX_RD,
  MIN_RD,
  RATING_PERIOD_MS,
  TAU,
  decayedDeviation,
  rateMatch,
  updateRating,
  type HeadToHead,
  type MatchResult,
  type Rating,
} from "./glicko.ts";
export {
  MATCH_STATES,
  initialContext,
  isTerminal,
  transition,
  type MatchContext,
  type MatchEvent,
  type MatchOutcome,
  type MatchState,
  type Transition,
} from "./match-machine.ts";
export {
  MatchEventLog,
  MemorySink,
  checkSequence,
  parseLog,
  replay,
  type AppendSink,
  type LoggedEvent,
  type ParsedLog,
} from "./event-log.ts";
export {
  PLACEMENT_RD_THRESHOLD,
  botMatchIsRated,
  medianFraction,
  planBotMatch,
  solveProbability,
  type BotPlan,
} from "./bot.ts";
export {
  CODE_ALPHABET,
  CODE_LENGTH,
  formatCode,
  generateCode,
  normaliseCode,
} from "./codes.ts";

/* §6.4 pulse level from real keystrokes. Pure maths, so it lives here rather
   than in the UI package: the live HUD and any replay consumer must produce
   identical traces from identical input. */
export {
  PULSE_FALL,
  PULSE_FULL_SCALE,
  PULSE_RISE,
  PULSE_SAMPLE_MS,
  PULSE_WINDOW,
  pulseSeries,
  pulseStep,
} from "./pulse.ts";

/* §11 paste diagnostic. Reads the delta records the relay already logs and
   reduces them to numbers. No enforcement — see the file header. */
export {
  LARGE_INSERTION_CHARS,
  describeProfile,
  pasteProfile,
  type DeltaRecord,
  type PasteProfile,
} from "./paste-profile.ts";

export * from "./ladder.ts";

export * from "./env.ts";
