/* ============================================================================
   Replay — a log becomes a watchable match.

   §10 says "this file IS the replay" and that playback must be a pure function
   of it. This is that function, and it is deliberately in `core` rather than in
   the viewer: a pure reducer over events can be tested without a browser, and
   the claim is then checkable rather than asserted.

   NOTHING HERE READS THE DATABASE. Since schemaVersion 1 the log carries the
   handles, ratings, tiers and the problem as shown, so a replay renders from
   the file alone. A log without `schemaVersion` predates that and cannot be
   rendered faithfully — it is reported as unsupported rather than rendered
   wrong, which is the entire reason the integer exists.

   ORDERING IS BY `seq`, ONLY. `offsetMs` positions the scrubber and `wallMs` is
   for display; neither may order anything, because a host clock can move
   backwards and a replay that sorts by timestamp reorders itself when it does.
   ========================================================================= */

export const SUPPORTED_SCHEMA = 1;

export interface LogEvent {
  seq: number;
  offsetMs: number;
  wallMs: number;
  type: string;
  payload: Record<string, unknown>;
}

export interface ReplayPlayer {
  handle: string;
  rating: number;
  /** Null during placements — §8 gives a rank only after five matches. */
  tier: string | null;
  division: string | null;
  isBot: boolean;
  isGuest: boolean;
}

export interface ReplayMeta {
  schemaVersion: number;
  mode: string;
  durationMs: number;
  p1: ReplayPlayer;
  p2: ReplayPlayer;
  problem: {
    title: string;
    rating: number;
    statement: string;
    inputFormat: string;
    outputFormat: string;
    constraints: string;
    note: string;
  };
}

/** A moment worth a mark on the scrubber (§7). */
export interface Marker {
  offsetMs: number;
  kind: "start" | "submit" | "verdict" | "idle" | "end" | "disconnect";
  side: "p1" | "p2" | null;
  label: string;
}

export type ReplayLoad =
  | { ok: true; meta: ReplayMeta; events: LogEvent[]; endMs: number; markers: Marker[] }
  | { ok: false; reason: string };

/** §10: an idle pause worth marking on the timeline. */
export const IDLE_MARK_MS = 20_000;

/**
 * Parses a JSONL log.
 *
 * A TRUNCATED FINAL LINE IS NORMAL, not an error: the log is append-only and
 * written behind a buffer, so a process killed mid-write leaves one torn line.
 * §10 requires a consumer to tolerate that and render the recording as ending
 * there, never to refuse to play it and never to invent a terminal event.
 */
export function parseReplay(jsonl: string): ReplayLoad {
  const events: LogEvent[] = [];
  const lines = jsonl.split("\n");
  for (const [index, line] of lines.entries()) {
    if (line.trim().length === 0) continue;
    try {
      const parsed = JSON.parse(line) as LogEvent;
      if (typeof parsed.seq === "number" && typeof parsed.type === "string") events.push(parsed);
    } catch {
      /* Only the LAST line may be torn. Anything else is real corruption and
         the log stops being trustworthy from that point. */
      if (index !== lines.length - 1) {
        return { ok: false, reason: `corrupt at line ${index + 1}, which is not the final line` };
      }
    }
  }
  if (events.length === 0) return { ok: false, reason: "the log is empty" };

  events.sort((a, b) => a.seq - b.seq);

  const created = events.find((e) => e.type === "match.created");
  if (!created) return { ok: false, reason: "no match.created event — this log has no beginning" };

  const schemaVersion = Number(created.payload["schemaVersion"] ?? 0);
  if (schemaVersion < SUPPORTED_SCHEMA) {
    return {
      ok: false,
      reason:
        `this log is schema version ${schemaVersion} and the viewer needs ${SUPPORTED_SCHEMA}. ` +
        "Logs written before handle and problem denormalisation cannot be rendered " +
        "faithfully — they reference players and problems by id, so the names and the " +
        "statement would be whatever those rows say TODAY rather than what the players saw.",
    };
  }

  const meta = created.payload as unknown as ReplayMeta;
  const endMs = events[events.length - 1]!.offsetMs;
  return { ok: true, meta, events, endMs, markers: markersOf(events) };
}

/** Judge verdicts as a person would say them. */
function describeVerdict(verdict: string): string {
  switch (verdict) {
    case "ACCEPTED":
      return "passed";
    case "WRONG_ANSWER":
      return "wrong answer";
    case "TIME_LIMIT":
      return "time limit";
    case "MEMORY_LIMIT":
      return "memory limit";
    case "RUNTIME_ERROR":
      return "runtime error";
    case "COMPILE_ERROR":
      return "compile error";
    case "COMPILE_TIMEOUT":
      return "compile timeout";
    case "COMPILE_MEMORY":
      return "compiler ran out of memory";
    case "OUTPUT_LIMIT":
      return "output limit";
    /* §11 makes this unreachable from user code, and if it ever appears in a
       replay it is worth naming plainly rather than dressing up. */
    case "INTERNAL_ERROR":
      return "internal error";
    default:
      return verdict.toLowerCase().replace(/_/g, " ");
  }
}

/** §7's timeline markers: submissions, verdicts, drops and idle pauses. */
export function markersOf(events: LogEvent[]): Marker[] {
  const out: Marker[] = [];
  const lastActivity: Record<string, number> = { p1: 0, p2: 0 };

  for (const event of events) {
    const side = (event.payload["side"] as "p1" | "p2" | undefined) ?? null;
    switch (event.type) {
      case "match.started":
        out.push({ offsetMs: event.offsetMs, kind: "start", side: null, label: "match started" });
        break;
      case "submission.received":
        out.push({ offsetMs: event.offsetMs, kind: "submit", side, label: "submitted" });
        break;
      case "submission.verdict": {
        /* Say what happened AND how far they got. "P1 wrong answer 7/10" is a
           moment somebody would scrub to; "verdict" is a tick. */
        const verdict = String(event.payload["verdict"] ?? "verdict");
        const passed = event.payload["passed"];
        const total = event.payload["total"];
        const counts =
          typeof passed === "number" && typeof total === "number" && total > 0
            ? ` ${passed}/${total}`
            : "";
        out.push({
          offsetMs: event.offsetMs,
          kind: "verdict",
          side,
          label: `${describeVerdict(verdict)}${counts}`,
        });
        break;
      }
      case "presence.changed":
        if (event.payload["connected"] === false) {
          out.push({ offsetMs: event.offsetMs, kind: "disconnect", side, label: "dropped" });
        }
        break;
      case "match.ended":
        out.push({ offsetMs: event.offsetMs, kind: "end", side: null, label: "match ended" });
        break;
      default:
        break;
    }

    /* An idle pause is the ABSENCE of editor traffic, so it can only be seen
       between two edits — which is why it is computed here rather than emitted
       by the gateway, which would have to guess when a pause ended. */
    if (event.type === "editor.delta" || event.type === "editor.snapshot") {
      const key = side ?? "p1";
      const gap = event.offsetMs - (lastActivity[key] ?? 0);
      if (lastActivity[key] && gap >= IDLE_MARK_MS) {
        out.push({
          offsetMs: lastActivity[key]!,
          kind: "idle",
          side,
          label: `paused ${Math.round(gap / 1000)}s`,
        });
      }
      lastActivity[key] = event.offsetMs;
    }
  }
  return out.sort((a, b) => a.offsetMs - b.offsetMs);
}

/**
 * Both documents as they stood at `atMs`.
 *
 * Rebuilt from the beginning every call rather than incrementally, because a
 * scrubber moves backwards as often as forwards and an incremental cursor that
 * has to handle rewinding is where drift gets in. A match is a few hundred
 * events; correctness is worth more than the microseconds.
 */
export function documentsAt(events: LogEvent[], atMs: number): { p1: string; p2: string } {
  const docs: Record<string, string> = { p1: "", p2: "" };
  for (const event of events) {
    if (event.offsetMs > atMs) break;
    const side = String(event.payload["side"] ?? "");
    if (side !== "p1" && side !== "p2") continue;

    if (event.type === "editor.snapshot") {
      docs[side] = String(event.payload["text"] ?? "");
    } else if (event.type === "editor.delta") {
      const changes = (event.payload["changes"] ?? []) as {
        offset: number;
        length: number;
        text: string;
      }[];
      for (const change of changes) {
        docs[side] =
          docs[side]!.slice(0, change.offset) +
          change.text +
          docs[side]!.slice(change.offset + change.length);
      }
    }
  }
  return { p1: docs["p1"]!, p2: docs["p2"]! };
}

/** Passed/total per side at `atMs`, for the HUD's test bar. */
export function progressAt(
  events: LogEvent[],
  atMs: number,
): { p1: { passed: number; total: number }; p2: { passed: number; total: number } } {
  const out = { p1: { passed: 0, total: 0 }, p2: { passed: 0, total: 0 } };
  for (const event of events) {
    if (event.offsetMs > atMs) break;
    if (event.type !== "submission.verdict") continue;
    const side = String(event.payload["side"] ?? "");
    if (side !== "p1" && side !== "p2") continue;
    out[side] = {
      passed: Number(event.payload["passed"] ?? 0),
      total: Number(event.payload["total"] ?? 0),
    };
  }
  return out;
}
