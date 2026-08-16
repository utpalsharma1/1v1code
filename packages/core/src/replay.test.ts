import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { SUPPORTED_SCHEMA, documentsAt, markersOf, parseReplay, progressAt } from "./replay.ts";

const line = (seq: number, offsetMs: number, type: string, payload: unknown): string =>
  JSON.stringify({ seq, offsetMs, wallMs: 1_700_000_000_000 + offsetMs, type, payload });

const player = { handle: "a", rating: 1200, tier: null, division: null, isBot: false, isGuest: false };
const created = (schemaVersion = SUPPORTED_SCHEMA) =>
  line(1, 0, "match.created", {
    schemaVersion,
    mode: "RANKED",
    durationMs: 480_000,
    p1: player,
    p2: { ...player, handle: "b" },
    problem: { title: "T", rating: 1200, statement: "s", inputFormat: "i", outputFormat: "o", constraints: "c", note: "n" },
  });

describe("parsing", () => {
  test("a torn final line is normal, not corruption", () => {
    /* §10: append-only behind a buffer, so a killed process leaves one torn
       line. Refusing to play that log would lose the whole match. */
    const log = [created(), line(2, 10, "match.started", {}), '{"seq":3,"offse'].join("\n");
    const result = parseReplay(log);
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.events.length, 2);
  });

  test("corruption anywhere else is refused", () => {
    const log = [created(), "{not json", line(3, 10, "match.started", {})].join("\n");
    const result = parseReplay(log);
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.reason : "", /not the final line/);
  });

  test("a pre-denormalisation log is refused, not rendered wrong", () => {
    /* The whole reason schemaVersion exists: those logs reference players and
       problems by id, so names would be whatever the rows say today. */
    const result = parseReplay(created(0));
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.reason : "", /schema version 0/);
  });

  test("a log with no beginning is refused", () => {
    assert.equal(parseReplay(line(1, 0, "match.started", {})).ok, false);
  });

  test("events are ordered by seq, never by time", () => {
    /* A host clock can move backwards; seq cannot. */
    const log = [created(), line(3, 50, "match.started", {}), line(2, 900, "match.accepted", { side: "p1" })].join("\n");
    const result = parseReplay(log);
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.events.map((e) => e.seq), [1, 2, 3]);
  });
});

describe("documents at a moment", () => {
  const events = [
    { seq: 1, offsetMs: 0, wallMs: 0, type: "editor.snapshot", payload: { side: "p1", seq: 0, text: "abc" } },
    { seq: 2, offsetMs: 100, wallMs: 0, type: "editor.delta", payload: { side: "p1", seq: 1, changes: [{ offset: 3, length: 0, text: "d" }] } },
    { seq: 3, offsetMs: 200, wallMs: 0, type: "editor.delta", payload: { side: "p1", seq: 2, changes: [{ offset: 0, length: 1, text: "X" }] } },
  ];

  test("rebuilds the document by applying deltas onto a snapshot", () => {
    assert.equal(documentsAt(events, 0).p1, "abc");
    assert.equal(documentsAt(events, 100).p1, "abcd");
    assert.equal(documentsAt(events, 200).p1, "Xbcd");
  });

  test("scrubbing BACKWARDS gives the same answer as arriving forwards", () => {
    /* The reason this rebuilds from the start each time: an incremental cursor
       that has to rewind is where drift gets in. */
    const forwards = documentsAt(events, 200).p1;
    documentsAt(events, 0);
    assert.equal(documentsAt(events, 200).p1, forwards);
    assert.equal(documentsAt(events, 100).p1, "abcd");
  });

  test("a side with no events is empty, not undefined", () => {
    assert.equal(documentsAt(events, 999).p2, "");
  });
});

describe("markers", () => {
  test("an idle pause over the threshold is marked at its start", () => {
    const events = [
      { seq: 1, offsetMs: 1_000, wallMs: 0, type: "editor.delta", payload: { side: "p1", changes: [] } },
      { seq: 2, offsetMs: 40_000, wallMs: 0, type: "editor.delta", payload: { side: "p1", changes: [] } },
    ];
    const idle = markersOf(events).filter((m) => m.kind === "idle");
    assert.equal(idle.length, 1);
    assert.equal(idle[0]!.offsetMs, 1_000, "the mark belongs where the pause BEGAN");
    assert.match(idle[0]!.label, /39s/);
  });

  test("a short gap is not a pause", () => {
    const events = [
      { seq: 1, offsetMs: 1_000, wallMs: 0, type: "editor.delta", payload: { side: "p1", changes: [] } },
      { seq: 2, offsetMs: 3_000, wallMs: 0, type: "editor.delta", payload: { side: "p1", changes: [] } },
    ];
    assert.equal(markersOf(events).filter((m) => m.kind === "idle").length, 0);
  });

  test("markers come out in time order whatever order events arrive", () => {
    const events = [
      { seq: 1, offsetMs: 500, wallMs: 0, type: "match.started", payload: {} },
      { seq: 2, offsetMs: 9_000, wallMs: 0, type: "match.ended", payload: {} },
      { seq: 3, offsetMs: 4_000, wallMs: 0, type: "submission.received", payload: { side: "p2" } },
    ];
    assert.deepEqual(markersOf(events).map((m) => m.offsetMs), [500, 4_000, 9_000]);
  });
});

describe("progress", () => {
  test("reports the latest verdict per side at that moment", () => {
    const events = [
      { seq: 1, offsetMs: 100, wallMs: 0, type: "submission.verdict", payload: { side: "p1", passed: 3, total: 10 } },
      { seq: 2, offsetMs: 200, wallMs: 0, type: "submission.verdict", payload: { side: "p1", passed: 10, total: 10 } },
    ];
    assert.deepEqual(progressAt(events, 150).p1, { passed: 3, total: 10 });
    assert.deepEqual(progressAt(events, 999).p1, { passed: 10, total: 10 });
    assert.deepEqual(progressAt(events, 999).p2, { passed: 0, total: 0 });
  });
});
