"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { Button, Card, cn } from "@1v1/ui";
import { gatewayTarget } from "../../../lib/gateway.ts";

/* ============================================================================
   /dev/sparring — drive a second player on command.

   Same reasoning as /dev/hud: you cannot judge what you cannot reproduce.
   2B-4 is human vs human, so every beat needs two players, and some beats need
   two players doing specific things at specific times.

   THIS IS NOT A BOT. It has no solve model, no rating integrity rules, no
   labelling and no human-like typing. It does exactly what you click, when you
   click it. The bot's real foundations stay in packages/core/src/bot.ts and
   packages/db/src/solutions.ts, unused.

   The hard beat to stage by hand is §6.7b, the judging hold, because it needs
   two submissions outstanding at once with verdicts returning in a different
   order to their receipts. "Time limit" is the lever: it takes the full limit
   on every test, so submitting it here FIRST and a correct solution from your
   own window SECOND gives you a first receipt with a last verdict — the hold
   renders, and §6.9's rule that receipt order decides *among accepted
   submissions* is exercised rather than assumed.

   To test receipt order between two ACCEPTED submissions, click "Correct
   (reference)" in both windows within a second of each other: both pass, and
   the earlier receipt must win regardless of which verdict lands first.
   ========================================================================= */



/** Compiles, runs, and is wrong — the shape of a real near-miss, not a typo. */
const WRONG_PY = `import sys
print(0)
`;

/** Never terminates: forces TIME_LIMIT so you can see a non-WA failure. */
const TIMEOUT_PY = `while True:
    pass
`;

type Line = { at: string; text: string; tone?: "in" | "out" | "bad" };

export default function SparringPage() {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [handle, setHandle] = useState("");
  const [matchId, setMatchId] = useState<string | null>(null);
  const [state, setState] = useState("idle");
  const [problemSlug, setProblemSlug] = useState<string | null>(null);
  const [source, setSource] = useState(WRONG_PY);
  const [language, setLanguage] = useState<"PYTHON3" | "CPP17">("PYTHON3");
  const [log, setLog] = useState<Line[]>([]);

  const note = useCallback((text: string, tone?: Line["tone"]) => {
    setLog((prev) =>
      [{ at: new Date().toLocaleTimeString(), text, tone }, ...prev].slice(0, 60),
    );
  }, []);

  useEffect(() => {
    let socket: Socket | null = null;
    let cancelled = false;

    void (async () => {
      /* One identity per tab, stable across reloads of that tab, so two
         sparring windows never fight over one account. */
      let as = sessionStorage.getItem("sparring-as");
      if (!as) {
        as = Math.random().toString(36).slice(2, 8);
        sessionStorage.setItem("sparring-as", as);
      }
      const response = await fetch(`/api/dev/sparring-ticket?as=${as}`, { method: "POST" });
      if (!response.ok) {
        note(`could not mint a sparring ticket (${response.status})`, "bad");
        return;
      }
      const data = (await response.json()) as { ticket: string; handle: string };
      if (cancelled) return;
      setHandle(data.handle);

      socket = io(gatewayTarget(), { transports: ["websocket"], auth: { ticket: data.ticket } });
      socketRef.current = socket;

      socket.on("connect", () => {
        setConnected(true);
        note(`connected as ${data.handle}`);
      });
      socket.on("connect_error", (e) => {
        setConnected(false);
        note(`connect error: ${e.message}`, "bad");
      });
      socket.on("disconnect", () => {
        setConnected(false);
        setState("idle");
        note("disconnected");
      });

      socket.on("queue.status", (p: { inQueue: number; alone: boolean }) => {
        setState("queued");
        if (p.alone) note(`queued — alone in the pool (${p.inQueue})`);
      });
      socket.on("queue.left", () => {
        setState("idle");
        note("left queue");
      });
      socket.on("match.found", (p: { matchId: string; you: string; p1: { handle: string }; p2: { handle: string } }) => {
        setMatchId(p.matchId);
        setState(`matched as ${p.you}`);
        note(`match found: ${p.p1.handle} vs ${p.p2.handle} — you are ${p.you}`, "in");
      });
      socket.on("match.countdown", (p: { beat: number }) => setState(`countdown ${p.beat}`));
      socket.on("match.start", (p: { problem: { slug: string; title: string } }) => {
        setProblemSlug(p.problem.slug);
        setState("live");
        note(`LIVE — ${p.problem.title} (${p.problem.slug})`, "in");
      });
      socket.on("submission.ack", (p: { total: number }) => note(`submission queued, ${p.total} tests`));
      socket.on("test.result", (p: { ordinal: number; verdict: string; total: number }) =>
        note(`  test ${p.ordinal + 1}/${p.total}: ${p.verdict}`),
      );
      socket.on("submission.verdict", (p: { side: string; verdict: string; passed: number; total: number }) =>
        note(`VERDICT ${p.side}: ${p.verdict} ${p.passed}/${p.total}`, "in"),
      );
      socket.on("match.judging", (p: { outstanding: string[] }) =>
        note(p.outstanding.length ? `hold: awaiting ${p.outstanding.join(", ")}` : "hold resolved"),
      );
      socket.on(
        "match.end",
        (p: {
          outcome: { kind: string; winner?: string; reason?: string };
          ratings?: { side: string; before: number; after: number }[];
        }) => {
          setState("ended");
          setMatchId(null);
          note(
            `match end: ${p.outcome.kind}${p.outcome.winner ? ` (${p.outcome.winner})` : ""}${
              p.outcome.reason ? ` — ${p.outcome.reason}` : ""
            }`,
            "in",
          );
          /* Surface the rating delta. A match that ends with no visible change
             is indistinguishable from one where Glicko silently did not fire,
             and "no rating change" is itself a real outcome here — CANCELED,
             VOID and any unrated pairing all produce an empty array. Say which
             it is rather than showing nothing. */
          const ratings = p.ratings ?? [];
          if (ratings.length === 0) {
            note("  no rating change (canceled, void, or unrated)", "in");
          } else {
            for (const r of ratings) {
              const d = r.after - r.before;
              note(`  rating ${r.side}: ${r.before} → ${r.after} (${d >= 0 ? "+" : ""}${d})`, "in");
            }
          }
        },
      );
      socket.on("error", (p: { code: string; message: string }) =>
        note(`error ${p.code}: ${p.message}`, "bad"),
      );
    })();

    return () => {
      cancelled = true;
      socket?.close();
      socketRef.current = null;
    };
  }, [note]);

  const emit = (event: string, payload: unknown = {}) => {
    socketRef.current?.emit(event, payload);
    note(`→ ${event}`, "out");
  };

  const submit = (lang: "PYTHON3" | "CPP17", src: string, label: string) => {
    if (!matchId) {
      note("no match in progress", "bad");
      return;
    }
    note(`→ submit ${label}`, "out");
    socketRef.current?.emit("code.submit", { matchId, language: lang, source: src });
  };

  /** The real reviewed solution for whatever problem this match drew, so the
   *  sparring partner can genuinely win without anyone writing code mid-match. */
  const submitReference = async () => {
    if (!problemSlug) {
      note("no live problem yet", "bad");
      return;
    }
    const response = await fetch(`/api/dev/solution?slug=${encodeURIComponent(problemSlug)}`);
    if (!response.ok) {
      note(`no reference solution for ${problemSlug}`, "bad");
      return;
    }
    const data = (await response.json()) as { source: string };
    setSource(data.source);
    submit("PYTHON3", data.source, `reference solution for ${problemSlug}`);
  };

  /* TYPE THE SOLUTION INSTEAD OF PASTING IT — the delta path's only exercise.
   *
   * Sparring never touched the editor at all: it submits and nothing else. So
   * every `editor.delta` ever recorded came from a human in the other browser,
   * and the relay's incremental path — the one that silently dropped a third of
   * its characters through two separate bugs — has been exercised by exactly
   * one thing that is hard to automate.
   *
   * This streams the reference solution as real batched deltas: characters in
   * bursts with pauses, sequence-numbered per §10, so a replay of a sparring
   * match has TWO keystroke streams instead of one. Same reasoning as the
   * four-state typing model behind the pulse line — the point is not realism
   * for its own sake, it is that the path gets walked.
   *
   * It is not the bot (§13.6, held): no solve model, no rating rules, no
   * pretence of being human. Just characters going down the wire the way
   * characters actually do.
   */
  const typeReference = async () => {
    if (!problemSlug || !matchId) {
      note("no live problem yet", "bad");
      return;
    }
    const response = await fetch(`/api/dev/solution?slug=${encodeURIComponent(problemSlug)}`);
    if (!response.ok) {
      note(`no reference solution for ${problemSlug}`, "bad");
      return;
    }
    const { source } = (await response.json()) as { source: string };
    const socket = socketRef.current;
    if (!socket) return;

    note(`typing ${source.length} characters…`);
    /* Ground truth first, exactly as a real client does on mount. */
    socket.emit("editor.snapshot", { matchId, seq: 0, text: "" });

    let seq = 0;
    let offset = 0;
    while (offset < source.length) {
      /* A burst of 3–9 characters, then a pause — the shape §6.4's pulse line
         is built to show, and the shape that produces multi-change batches. */
      const burst = 3 + Math.floor(Math.random() * 7);
      const chunk = source.slice(offset, offset + burst);
      const changes = [...chunk].map((ch, i) => ({
        offset: offset + i,
        length: 0,
        text: ch,
      }));
      seq += 1;
      socket.emit("editor.delta", {
        matchId,
        seq,
        changes,
        origin: "type",
        inserted: chunk.length,
        removed: 0,
      });
      offset += chunk.length;
      await new Promise((r) => setTimeout(r, 60 + Math.random() * 90));
    }
    setSource(source);
    note(`typed ${source.length} characters in ${seq} batches`);
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 px-6 py-10">
      <header>
        <p className="font-display text-fg-faint text-12 font-bold tracking-[var(--track-hud)] uppercase">
          dev · not part of the product
        </p>
        <h1 className="font-display text-fg mt-1 text-34 leading-none font-extrabold tracking-[var(--track-display)] uppercase">
          Sparring partner
        </h1>
        <p className="text-fg-dim mt-3 max-w-xl text-13 leading-relaxed">
          A second player you drive by hand. Open <span className="tabular text-fg">/play</span> in
          another window, queue there, then queue here — you will pair with each other.
        </p>
      </header>

      <div className="flex items-center gap-4">
        <span
          className={cn(
            "font-display text-12 font-bold tracking-[var(--track-hud)] uppercase",
            connected ? "text-player" : "text-fail",
          )}
        >
          {connected ? `connected · ${handle}` : "offline"}
        </span>
        <span className="tabular text-fg-faint text-12">{state}</span>
        {problemSlug && <span className="tabular text-fg-faint text-12">{problemSlug}</span>}
      </div>

      <Card title="Queue">
        <div className="flex flex-wrap gap-2">
          <Button variant="solid" tone="player" onClick={() => emit("queue.join", { mode: "RANKED" })} disabled={!connected}>
            Join queue
          </Button>
          <Button variant="outline" onClick={() => emit("queue.leave")} disabled={!connected}>
            Leave queue
          </Button>
          <Button
            variant="outline"
            onClick={() => matchId && emit("match.accept", { matchId })}
            disabled={!matchId}
          >
            Accept
          </Button>
        </div>
      </Card>

      <Card
        title="Submit"
        aside={<span className="text-fg-faint text-12">one outstanding at a time (§6.8b)</span>}
      >
        <p className="text-fg-dim mb-3 text-12 leading-relaxed">
          <span className="text-fg">§6.7b hold:</span> click <span className="text-fg">Time limit</span>{" "}
          here first, then submit a correct solution from your own window. This side&apos;s receipt is
          first but its verdict lands last, so the hold renders and receipt order is what decides.{" "}
          <span className="text-fg">Receipt order between two passes:</span> click{" "}
          <span className="text-fg">Correct (reference)</span> in both windows a second apart.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="solid"
            tone="player"
            onClick={() => void submitReference()}
            disabled={!matchId || !problemSlug}
          >
            Correct (reference)
          </Button>
          <Button variant="outline" onClick={() => void typeReference()}>
            Type it (streams deltas)
          </Button>
          <Button variant="outline" onClick={() => submit("PYTHON3", WRONG_PY, "wrong")} disabled={!matchId}>
            Wrong answer
          </Button>
          <Button variant="outline" onClick={() => submit("PYTHON3", TIMEOUT_PY, "timeout")} disabled={!matchId}>
            Time limit
          </Button>
        </div>

        <label className="mt-4 flex flex-col gap-1.5">
          <span className="font-display text-fg-dim text-12 font-bold tracking-[var(--track-hud)] uppercase">
            Or paste anything
          </span>
          <textarea
            value={source}
            onChange={(e) => setSource(e.target.value)}
            rows={6}
            spellCheck={false}
            className="focus-ring border-line text-fg tabular border bg-elevated px-3 py-2 text-12"
          />
        </label>
        <div className="mt-2 flex items-center gap-2">
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as "PYTHON3" | "CPP17")}
            className="focus-ring border-line text-fg border bg-elevated px-2 py-1.5 text-12"
          >
            <option value="PYTHON3">Python 3</option>
            <option value="CPP17">C++17</option>
          </select>
          <Button variant="outline" onClick={() => submit(language, source, "pasted")} disabled={!matchId}>
            Submit pasted
          </Button>
        </div>
      </Card>

      <Card title="Connection">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              socketRef.current?.disconnect();
              note("forced disconnect — reconnection grace should start on the other side", "out");
            }}
            disabled={!connected}
          >
            Drop socket
          </Button>
          <Button variant="outline" onClick={() => socketRef.current?.connect()} disabled={connected}>
            Reconnect
          </Button>
        </div>
        <p className="text-fg-faint mt-3 text-12 leading-relaxed">
          Dropping the socket is how to see §6.5&apos;s disconnected nameplate and the 45s grace
          countdown from the other window without closing a browser tab.
        </p>
      </Card>

      <section>
        <p className="font-display text-fg-faint mb-1.5 text-12 font-bold tracking-[var(--track-hud)] uppercase">
          Events
        </p>
        <div className="border-line h-64 overflow-y-auto border bg-surface p-3">
          {log.length === 0 ? (
            <p className="text-fg-faint text-12">Nothing yet.</p>
          ) : (
            log.map((line, i) => (
              <p
                key={i}
                className={cn(
                  "tabular text-12 leading-relaxed",
                  line.tone === "bad" ? "text-fail" : line.tone === "out" ? "text-player" : "text-fg-dim",
                )}
              >
                {line.at} {line.text}
              </p>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
