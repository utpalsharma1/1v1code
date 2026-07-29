import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  initialContext,
  isTerminal,
  transition,
  type MatchContext,
  type MatchEvent,
} from "./match-machine.ts";

/** Drive a sequence, asserting every step is accepted. */
function drive(events: MatchEvent[], from: MatchContext = initialContext()): MatchContext {
  let ctx = from;
  for (const event of events) {
    const result = transition(ctx, event);
    assert.ok(result.ok, `${event.type} rejected in ${ctx.state}: ${result.rejected}`);
    ctx = result.context;
  }
  return ctx;
}

const toLive = (): MatchContext =>
  drive([
    { type: "MATCH_FOUND" },
    { type: "ACCEPT_WINDOW_OPEN" },
    { type: "PLAYER_ACCEPTED", side: "p1" },
    { type: "PLAYER_ACCEPTED", side: "p2" },
    { type: "COUNTDOWN_COMPLETE" },
  ]);

describe("match lifecycle", () => {
  test("the happy path reaches LIVE through every state", () => {
    const ctx = toLive();
    assert.equal(ctx.state, "LIVE");
  });

  test("illegal transitions are rejected as data, never thrown", () => {
    const fresh = initialContext();
    const result = transition(fresh, { type: "COUNTDOWN_COMPLETE" });
    assert.equal(result.ok, false);
    assert.match(result.rejected ?? "", /not legal in QUEUED/);
    assert.equal(result.context.state, "QUEUED", "a rejected event must not mutate state");
  });

  test("accept is idempotent — a double accept cannot start the match twice", () => {
    let ctx = drive([{ type: "MATCH_FOUND" }, { type: "ACCEPT_WINDOW_OPEN" }]);
    ctx = drive([{ type: "PLAYER_ACCEPTED", side: "p1" }], ctx);
    const again = transition(ctx, { type: "PLAYER_ACCEPTED", side: "p1" });
    assert.ok(again.ok, "a duplicate accept must be tolerated");
    assert.equal(again.changed, false, "it must not advance the match");
    assert.equal(again.context.state, "ACCEPTING");
  });

  test("submission is idempotent — the same id cannot be counted twice", () => {
    let ctx = toLive();
    const event: MatchEvent = {
      type: "SUBMISSION_RECEIVED",
      submissionId: "s1",
      side: "p1",
      receiptMs: 1000,
    };
    ctx = drive([event], ctx);
    const dup = transition(ctx, event);
    assert.ok(dup.ok);
    assert.equal(dup.context.outstanding.size, 1, "duplicate must not add a second entry");
  });

  test("receipt order decides the match, not verdict order", () => {
    // THE FAIRNESS TEST (§6.9). p1 submits first, but p2's verdict returns
    // first — which is exactly what happens when p1 wrote C++ (~5.5s) and p2
    // wrote Python (~1.8s). p1 must still win.
    let ctx = toLive();
    ctx = drive(
      [
        { type: "SUBMISSION_RECEIVED", submissionId: "p1-sub", side: "p1", receiptMs: 1000 },
        { type: "SUBMISSION_RECEIVED", submissionId: "p2-sub", side: "p2", receiptMs: 1200 },
        // p2's verdict lands first
        { type: "VERDICT", submissionId: "p2-sub", accepted: true },
      ],
      ctx,
    );
    assert.equal(ctx.state, "JUDGING", "must hold — p1's submission is still outstanding");
    assert.equal(ctx.outcome, null, "must not resolve on the first ACCEPTED");

    ctx = drive([{ type: "VERDICT", submissionId: "p1-sub", accepted: true }], ctx);
    assert.equal(ctx.state, "ENDED");
    assert.deepEqual(ctx.outcome, { kind: "WIN", winner: "p1", reason: "SOLVED" });
  });

  test("a wrong submission returns the match to LIVE", () => {
    let ctx = toLive();
    ctx = drive(
      [
        { type: "SUBMISSION_RECEIVED", submissionId: "s1", side: "p1", receiptMs: 500 },
        { type: "VERDICT", submissionId: "s1", accepted: false },
      ],
      ctx,
    );
    assert.equal(ctx.state, "LIVE", "a failed submit puts the player back in the editor");
    assert.equal(ctx.outcome, null);
  });

  test("nobody solves — the clock expiring is a draw, not a hang", () => {
    let ctx = toLive();
    ctx = drive([{ type: "CLOCK_EXPIRED" }], ctx);
    assert.equal(ctx.state, "ENDED");
    assert.deepEqual(ctx.outcome, { kind: "DRAW", reason: "NOBODY_SOLVED" });
  });

  test("the clock expiring mid-judge still honours the outstanding submission", () => {
    // Submitted at 4:59 with the verdict landing at 5:01. The submission was
    // received while the clock was running and is entitled to its verdict.
    let ctx = toLive();
    ctx = drive(
      [
        { type: "SUBMISSION_RECEIVED", submissionId: "s1", side: "p2", receiptMs: 299_000 },
        { type: "CLOCK_EXPIRED" },
      ],
      ctx,
    );
    assert.equal(ctx.state, "JUDGING", "must not end while a verdict is owed");

    ctx = drive([{ type: "VERDICT", submissionId: "s1", accepted: true }], ctx);
    assert.deepEqual(ctx.outcome, { kind: "WIN", winner: "p2", reason: "SOLVED" });
  });

  test("a disconnect alone is not a forfeit — only grace expiry is", () => {
    let ctx = toLive();
    ctx = drive([{ type: "PLAYER_DISCONNECTED", side: "p1" }], ctx);
    assert.equal(ctx.state, "LIVE", "the match continues during the grace period");
    assert.equal(ctx.connected.p1, false);

    ctx = drive([{ type: "PLAYER_RECONNECTED", side: "p1" }], ctx);
    assert.equal(ctx.connected.p1, true);
    assert.equal(ctx.state, "LIVE");
  });

  test("grace expiry forfeits to the connected opponent", () => {
    let ctx = toLive();
    ctx = drive(
      [{ type: "PLAYER_DISCONNECTED", side: "p1" }, { type: "GRACE_EXPIRED", side: "p1" }],
      ctx,
    );
    assert.equal(ctx.state, "ENDED");
    assert.deepEqual(ctx.outcome, { kind: "WIN", winner: "p2", reason: "FORFEIT" });
  });

  test("both players gone cancels the match rather than crowning a ghost", () => {
    let ctx = toLive();
    ctx = drive(
      [
        { type: "PLAYER_DISCONNECTED", side: "p1" },
        { type: "PLAYER_DISCONNECTED", side: "p2" },
        { type: "GRACE_EXPIRED", side: "p1" },
      ],
      ctx,
    );
    assert.equal(ctx.state, "ABANDONED");
    assert.deepEqual(ctx.outcome, { kind: "CANCELED", reason: "BOTH_ABANDONED" });
  });

  test("declining the accept window hands the match to whoever accepted", () => {
    let ctx = drive([
      { type: "MATCH_FOUND" },
      { type: "ACCEPT_WINDOW_OPEN" },
      { type: "PLAYER_ACCEPTED", side: "p1" },
    ]);
    ctx = drive([{ type: "ACCEPT_TIMEOUT" }], ctx);
    assert.equal(ctx.state, "ABANDONED");
    assert.deepEqual(ctx.outcome, {
      kind: "WIN",
      winner: "p1",
      reason: "OPPONENT_ABANDONED",
    });
  });

  test("neither player accepting cancels rather than awarding", () => {
    let ctx = drive([{ type: "MATCH_FOUND" }, { type: "ACCEPT_WINDOW_OPEN" }]);
    ctx = drive([{ type: "ACCEPT_TIMEOUT" }], ctx);
    assert.deepEqual(ctx.outcome, { kind: "CANCELED", reason: "NEVER_STARTED" });
  });

  test("VOID is reserved for infrastructure failure and nothing else reaches it", () => {
    /* §6.9 gives VOID one meaning: our infrastructure failed, so nobody's
       rating moves and it is recorded as a no-contest. It fires rarely and it
       is supposed to be alarming.

       "Nobody accepted" is routine — it fired on the very first real
       two-browser match — and folding it into VOID made a genuine no-contest
       indistinguishable from an abandoned queue pop. No ordinary path may
       produce VOID; only a judge INTERNAL_ERROR may. */
    const ordinary: MatchEvent[][] = [
      [{ type: "MATCH_FOUND" }, { type: "ACCEPT_WINDOW_OPEN" }, { type: "ACCEPT_TIMEOUT" }],
      [
        { type: "MATCH_FOUND" },
        { type: "ACCEPT_WINDOW_OPEN" },
        { type: "PLAYER_ACCEPTED", side: "p1" },
        { type: "ACCEPT_TIMEOUT" },
      ],
    ];
    for (const path of ordinary) {
      assert.notEqual(drive(path).outcome?.kind, "VOID", `${JSON.stringify(path)} produced VOID`);
    }

    // Both disconnecting mid-match, and the clock simply running out.
    assert.notEqual(
      drive(
        [
          { type: "PLAYER_DISCONNECTED", side: "p1" },
          { type: "PLAYER_DISCONNECTED", side: "p2" },
          { type: "GRACE_EXPIRED", side: "p1" },
        ],
        toLive(),
      ).outcome?.kind,
      "VOID",
    );
    assert.deepEqual(drive([{ type: "CLOCK_EXPIRED" }], toLive()).outcome, {
      kind: "DRAW",
      reason: "NOBODY_SOLVED",
    });
  });

  test("a verdict for an unknown submission is refused", () => {
    const ctx = drive(
      [{ type: "SUBMISSION_RECEIVED", submissionId: "real", side: "p1", receiptMs: 1 }],
      toLive(),
    );
    const bogus = transition(ctx, { type: "VERDICT", submissionId: "ghost", accepted: true });
    assert.equal(bogus.ok, false);
    assert.match(bogus.rejected ?? "", /unknown submission/);
  });

  test("terminal states accept nothing further", () => {
    const ended = drive([{ type: "CLOCK_EXPIRED" }], toLive());
    assert.ok(isTerminal(ended.state));
    for (const event of [
      { type: "SUBMISSION_RECEIVED", submissionId: "x", side: "p1", receiptMs: 1 },
      { type: "CLOCK_EXPIRED" },
      { type: "PLAYER_ACCEPTED", side: "p1" },
    ] as MatchEvent[]) {
      assert.equal(transition(ended, event).ok, false, `${event.type} must be refused when ENDED`);
    }
  });
});
