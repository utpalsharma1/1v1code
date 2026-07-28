import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  MatchEventLog,
  MemorySink,
  checkSequence,
  parseLog,
  replay,
  type LoggedEvent,
} from "./event-log.ts";

describe("match event log", () => {
  test("assigns gapless sequence numbers starting at 1", async () => {
    const sink = new MemorySink();
    const log = new MatchEventLog(sink);
    for (let i = 0; i < 25; i++) await log.append("tick", { i });

    const { events, malformed } = parseLog(sink.lines.join(""));
    assert.equal(malformed, 0);
    assert.equal(events.length, 25);
    assert.deepEqual(checkSequence(events), { ok: true });
  });

  test("carries three time fields with three different jobs", async () => {
    const sink = new MemorySink();
    const log = new MatchEventLog(sink);
    const event = await log.append("submission", { side: "p1" });

    assert.equal(event.seq, 1);
    assert.ok(event.offsetMs >= 0, "offset must be non-negative");
    assert.ok(event.wallMs > 1_600_000_000_000, "wallMs must be a real epoch timestamp");
    assert.notEqual(event.offsetMs, event.wallMs, "offset and wall clock are not the same thing");
  });

  test("ORDERING SURVIVES A BACKWARD CLOCK STEP", async () => {
    // The property this whole design exists for. This host was measured
    // stepping its clock backward 2514ms; a replay that sorts by timestamp
    // would silently reorder itself. Here events 3 and 4 carry wall clocks
    // *earlier* than events 1 and 2, and replay order must be unaffected.
    const lines = [
      { seq: 1, offsetMs: 0, wallMs: 1_000_000, type: "start", payload: {} },
      { seq: 2, offsetMs: 100, wallMs: 1_000_100, type: "typing", payload: {} },
      { seq: 3, offsetMs: 200, wallMs: 997_500, type: "submit", payload: {} },
      { seq: 4, offsetMs: 300, wallMs: 997_600, type: "verdict", payload: {} },
    ].map((e) => JSON.stringify(e));

    const { events } = parseLog(lines.join("\n"));
    assert.deepEqual(
      events.map((e) => e.type),
      ["start", "typing", "submit", "verdict"],
      "replay order must follow seq, not the wall clock",
    );

    // Prove the naive implementation would have been wrong.
    const byWallClock = [...events].sort((a, b) => a.wallMs - b.wallMs).map((e) => e.type);
    assert.deepEqual(
      byWallClock,
      ["submit", "verdict", "start", "typing"],
      "sanity: sorting by timestamp really does corrupt this log",
    );
  });

  test("restores order from a shuffled file", async () => {
    const sink = new MemorySink();
    const log = new MatchEventLog(sink);
    for (const t of ["a", "b", "c", "d"]) await log.append(t, {});

    const shuffled = [...sink.lines].reverse().join("");
    const { events } = parseLog(shuffled);
    assert.deepEqual(events.map((e) => e.type), ["a", "b", "c", "d"]);
  });

  test("detects a gap rather than tolerating it", () => {
    const events: LoggedEvent[] = [
      { seq: 1, offsetMs: 0, wallMs: 1, type: "a", payload: {} },
      { seq: 3, offsetMs: 2, wallMs: 3, type: "c", payload: {} },
    ];
    const check = checkSequence(events);
    assert.equal(check.ok, false, "a missing event must not pass silently");
    assert.match(check.problem ?? "", /expected seq 2/);
  });

  test("survives a truncated final line", () => {
    // Normal for an append-only file whose process was killed mid-write.
    const good = JSON.stringify({ seq: 1, offsetMs: 0, wallMs: 1, type: "a", payload: {} });
    const { events, malformed } = parseLog(`${good}\n{"seq":2,"offse`);
    assert.equal(events.length, 1, "the intact events must still be readable");
    assert.equal(malformed, 1, "the torn line must be reported, not hidden");
  });

  test("replay is a pure function of the log", async () => {
    const sink = new MemorySink();
    const log = new MatchEventLog(sink);
    await log.append("pass", { ordinal: 0 });
    await log.append("pass", { ordinal: 1 });
    await log.append("fail", { ordinal: 2 });
    await log.append("pass", { ordinal: 3 });

    const { events } = parseLog(sink.lines.join(""));
    const fold = (state: { passed: number; failed: number }, e: LoggedEvent) =>
      e.type === "pass"
        ? { ...state, passed: state.passed + 1 }
        : { ...state, failed: state.failed + 1 };

    const first = replay(events, { passed: 0, failed: 0 }, fold);
    const second = replay(events, { passed: 0, failed: 0 }, fold);

    assert.deepEqual(first, { passed: 3, failed: 1 });
    assert.deepEqual(first, second, "same log must always produce the same state");
  });

  test("offsets increase monotonically across a match", async () => {
    const sink = new MemorySink();
    const log = new MatchEventLog(sink);
    await log.append("a", {});
    await new Promise((r) => setTimeout(r, 12));
    await log.append("b", {});

    const { events } = parseLog(sink.lines.join(""));
    assert.ok(
      events[1]!.offsetMs >= events[0]!.offsetMs,
      "offsets must never go backward — they are the scrub timeline",
    );
  });
});
