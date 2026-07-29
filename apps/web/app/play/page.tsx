"use client";

import { AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { CURRENT_PHASE } from "@/lib/phase";
import { MatchScreen, type MatchPlayer } from "./MatchScreen";
import {
  Button,
  Card,
  Countdown,
  MotionTuningProvider,
  QueueCard,
  QueuePop,
  cn,
  type CellState,
  type Division,
  type Side,
  type Status,
  type Tier,
} from "@1v1/ui";

/* ============================================================================
   /play — the first time Phase 1's cinematics fire on a real match.

   Everything here is driven by gateway events, not by buttons: the queue pop
   happens because somebody else actually joined. The match screen itself is
   2B-3; this takes the flow as far as LIVE.
   ========================================================================= */

const GATEWAY = process.env["NEXT_PUBLIC_GATEWAY_URL"] ?? "http://localhost:4000";

type Phase = "idle" | "queued" | "found" | "countdown" | "live" | "ended";

interface PlayerCard {
  userId: string;
  handle: string;
  rating: number;
  tier: string;
  division: string | null;
  isBot: boolean;
}

interface QueueStatus {
  elapsedMs: number;
  ratingBand: [number, number];
  widening: boolean;
  inQueue: number;
  /** Nobody else is in the pool. There is no bot fallback in 2B-4, so the
   *  queue card stops performing a search rather than sweeping over nobody. */
  alone: boolean;
}

export default function PlayPage() {
  return (
    <MotionTuningProvider>
      <Play />
    </MotionTuningProvider>
  );
}

function Play() {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [queue, setQueue] = useState<QueueStatus | null>(null);
  const [match, setMatch] = useState<{
    matchId: string;
    you: Side;
    p1: PlayerCard;
    p2: PlayerCard;
    problemRating: number;
  } | null>(null);
  const [accepted, setAccepted] = useState({ p1: false, p2: false });
  const [acceptDeadline, setAcceptDeadline] = useState<number | null>(null);
  const [acceptRemainingMs, setAcceptRemainingMs] = useState<number | undefined>(undefined);
  const [beat, setBeat] = useState<3 | 2 | 1 | 0 | null>(null);
  const [problem, setProblem] = useState<{
    title: string;
    rating: number;
    statement: string;
    constraints: string;
  } | null>(null);
  const [totalTests, setTotalTests] = useState(0);
  const [cells, setCells] = useState<{ p1: CellState[]; p2: CellState[] }>({ p1: [], p2: [] });
  const [statuses, setStatuses] = useState<{ p1: Status; p2: Status }>({
    p1: { kind: "typing" },
    p2: { kind: "typing" },
  });
  const [pulses, setPulses] = useState<{ p1: number[]; p2: number[] }>({ p1: [], p2: [] });
  const [compileKeys, setCompileKeys] = useState({ p1: 0, p2: 0 });
  const [shatterKeys, setShatterKeys] = useState({ p1: 0, p2: 0 });
  const [holding, setHolding] = useState<Side[]>([]);
  const [verdict, setVerdict] = useState<{
    side: Side;
    verdict: string;
    passed: number;
    total: number;
    failedAt: number | null;
    message: string | null;
  } | null>(null);
  const [ending, setEnding] = useState<{
    kind: string;
    winner?: Side;
    reason?: string;
    ratings: { side: Side; before: number; after: number }[];
  } | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const [remainingMs, setRemainingMs] = useState(0);
  const [presence, setPresence] = useState<{ side: Side; graceMs: number } | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const note = useCallback((line: string) => {
    setLog((prev) => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev].slice(0, 12));
  }, []);

  useEffect(() => {
    let socket: Socket | null = null;
    let cancelled = false;

    /* Fetch a ticket from OUR OWN origin first, where the session cookie is
       unambiguously sent, then hand it to the gateway. Nothing here depends on
       a cookie surviving a cross-origin WebSocket upgrade — which is exactly
       what could not be observed from the server when this was broken. */
    void (async () => {
      let ticket: string | null = null;
      try {
        const response = await fetch("/api/socket-ticket", {
          method: "POST",
          credentials: "same-origin",
        });
        if (response.status === 401) {
          if (!cancelled) setAuthError("NOT_SIGNED_IN");
          return;
        }
        if (response.ok) {
          ticket = ((await response.json()) as { ticket: string }).ticket;
        }
      } catch {
        if (!cancelled) setAuthError("Could not reach the app server for a socket ticket.");
        return;
      }
      if (cancelled) return;

      socket = io(GATEWAY, {
        withCredentials: true,
        transports: ["websocket", "polling"],
        auth: ticket ? { ticket } : {},
      });
      socketRef.current = socket;
      wire(socket);
    })();

    function wire(socket: Socket) {

    socket.on("connect", () => {
      setConnected(true);
      setAuthError(null);
      note("connected to gateway");
    });
    socket.on("connect_error", (error) => {
      setConnected(false);
      // A transport failure is NOT an auth failure. Conflating them made a
      // gateway that was simply unreachable render as "Not signed in", which
      // sent the last debugging session in the wrong direction entirely.
      const message = error.message || "";
      const isAuth = /unauthenticated/i.test(message);
      setAuthError(isAuth ? message : `GATEWAY_UNREACHABLE:${message}`);
      note(isAuth ? `rejected: ${message}` : `gateway unreachable: ${message}`);
    });
    socket.on("disconnect", () => {
      setConnected(false);
      note("disconnected");
    });

    socket.on("queue.status", (payload: QueueStatus) => {
      setQueue(payload);
      setPhase("queued");
    });
    socket.on("queue.left", () => {
      setPhase("idle");
      setQueue(null);
      note("left queue");
    });

    socket.on("match.found", (payload) => {
      setMatch(payload);
      setAccepted({ p1: false, p2: false });
      // performance.now(), not Date.now() — §11 time discipline applies in the
      // browser too, and this deadline drives a visible countdown.
      setAcceptDeadline(performance.now() + payload.acceptMs);
      setPhase("found");
      note(`match found vs ${payload.p2.handle} — problem rated ${payload.problemRating}`);
    });
    socket.on("match.accept.progress", (payload) => {
      setAccepted({ p1: payload.p1, p2: payload.p2 });
    });
    socket.on("match.countdown", (payload: { beat: number }) => {
      setPhase("countdown");
      setBeat(payload.beat as 3 | 2 | 1 | 0);
    });
    socket.on("match.start", (payload) => {
      setBeat(null);
      setPhase("live");
      setProblem({
        title: payload.problem.title,
        rating: payload.problem.rating,
        statement: payload.problem.statement,
        constraints: payload.problem.constraints,
      });
      setEnding(null);
      setVerdict(null);
      setHolding([]);
      note(`LIVE — ${payload.problem.title}`);
    });
    socket.on("match.clock", (payload: { remainingMs: number }) =>
      setRemainingMs(payload.remainingMs),
    );
    socket.on("match.presence", (payload) => {
      setPresence(payload.connected ? null : { side: payload.side, graceMs: payload.graceRemainingMs });
      note(`${payload.side} ${payload.connected ? "reconnected" : "dropped"}`);
    });
    socket.on("match.resync", (payload) => {
      setMatch({
        matchId: payload.matchId,
        you: payload.you,
        p1: payload.p1,
        p2: payload.p2,
        problemRating: payload.problem?.rating ?? 0,
      });
      setAccepted(payload.accepted);
      setRemainingMs(payload.remainingMs);

      /* The problem HAS to come back too.

         It did not, and that stranded a reloading player: the match screen
         only renders when `problem` is set, so after a reload the page fell
         through to the lobby layout — which draws nothing at all for a live
         match and offers Play only in `idle`. The match then ended into a
         screen that could not render its own ending. */
      if (payload.problem) {
        setProblem({
          title: payload.problem.title,
          rating: payload.problem.rating,
          statement: payload.problem.statement,
          constraints: payload.problem.constraints,
        });
      }

      // JUDGING is still the match, not the lobby: §6.7b's hold is a beat of
      // the match screen and the player must not be thrown out of it.
      const live = payload.state === "LIVE" || payload.state === "JUDGING";
      setPhase(live ? "live" : payload.state === "COUNTDOWN" ? "countdown" : "found");
      note(`resynced into ${payload.state}`);
    });
    socket.on("submission.ack", (payload: { total: number; side: Side }) => {
      setTotalTests(payload.total);
      // A fresh submission clears the bar: these are THIS attempt's cells.
      setCells((prev) => ({ ...prev, [payload.side]: Array(payload.total).fill("idle") }));
      setVerdict(null);
      setInFlight(true);
      note(`submitted — ${payload.total} tests`);
    });

    /* §6.6: cells resolve one at a time, in the order the judge sends them.
       Never batched — the staggered reveal is the entire drama. */
    socket.on(
      "test.result",
      (payload: { side: Side; ordinal: number; verdict: string; total: number }) => {
        setTotalTests((t) => Math.max(t, payload.total));
        setCells((prev) => {
          const next = [...(prev[payload.side] ?? [])];
          while (next.length < payload.total) next.push("idle");
          next[payload.ordinal] = payload.verdict === "ACCEPTED" ? "pass" : "fail";
          return { ...prev, [payload.side]: next };
        });
      },
    );

    socket.on(
      "submission.verdict",
      (payload: {
        side: Side;
        verdict: string;
        passed: number;
        total: number;
        failedAt: number | null;
        message: string | null;
      }) => {
        setVerdict(payload);
        setInFlight(false);
        // §6.4: the ticker shows activity, never content. After a verdict it
        // reports the score and then goes back to plain activity.
        setStatuses((prev) => ({
          ...prev,
          [payload.side]:
            payload.total > 0
              ? { kind: "result", passed: payload.passed, total: payload.total }
              : { kind: "failed" },
        }));
        // §6.5 near-miss: a failed submission cracks that player's bar. The
        // relief is the opponent's; the pain is well earned.
        if (payload.verdict !== "ACCEPTED") {
          setShatterKeys((prev) => ({ ...prev, [payload.side]: prev[payload.side] + 1 }));
        }
        note(`verdict ${payload.side}: ${payload.verdict} ${payload.passed}/${payload.total}`);
      },
    );

    socket.on("match.judging", (payload: { outstanding: Side[] }) => setHolding(payload.outstanding));

    socket.on("opponent.pulse", (payload: { side: Side; keys: number }) => {
      // Fixed-length window so the sparkline scrolls rather than growing.
      setPulses((prev) => ({
        ...prev,
        [payload.side]: [...prev[payload.side], payload.keys].slice(-120),
      }));
    });

    socket.on(
      "opponent.status",
      (payload: { side: Side; status: string; passed: number; total: number }) => {
        const status: Status =
          payload.status === "running" && payload.total > 0
            ? { kind: "result", passed: payload.passed, total: payload.total }
            : ({ kind: payload.status } as Status);
        setStatuses((prev) => ({ ...prev, [payload.side]: status }));
        // §6.5 compile pulse: a shockwave across that player's half.
        if (payload.status === "compiling") {
          setCompileKeys((prev) => ({ ...prev, [payload.side]: prev[payload.side] + 1 }));
        }
        if (payload.total > 0) {
          setTotalTests((t) => Math.max(t, payload.total));
          setCells((prev) => {
            const next = Array<CellState>(payload.total).fill("idle");
            for (let i = 0; i < payload.passed; i += 1) next[i] = "pass";
            return { ...prev, [payload.side]: next };
          });
        }
      },
    );

    socket.on("match.end", (payload) => {
      setPhase("ended");
      setAcceptDeadline(null);
      setHolding([]);
      setEnding({
        kind: payload.outcome.kind,
        winner: payload.outcome.winner,
        reason: payload.outcome.reason,
        ratings: payload.ratings ?? [],
      });
      note(`match ended: ${payload.outcome.kind}`);
    });
    socket.on("error", (payload: { code: string; message: string }) =>
      note(`error ${payload.code}: ${payload.message}`),
    );

    }

    return () => {
      cancelled = true;
      socket?.close();
      socketRef.current = null;
    };
  }, [note]);

  /* A terminal match ALWAYS returns the client to idle.

     The ending screen offers Rematch and Back, and that was the only route
     out — so any gap that stopped it rendering left the client stuck in match
     state with Play disabled and nothing to click. That happened: a reload
     mid-match dropped `problem`, the match screen could not render, and the
     ending had nowhere to go.

     The resync gap is fixed above, but the class of bug is "client parked in a
     state nothing tells it to leave", the same shape as the QueuePop overlay
     covering Accept. So this is a rule rather than a repair: if the match has
     ended and we cannot show the ending, go back to idle rather than sit
     there. Play is usable either way. */
  const canShowEnding = Boolean(match && problem);
  useEffect(() => {
    if (phase !== "ended" || canShowEnding) return;
    setPhase("idle");
    setMatch(null);
    setEnding(null);
    note("match ended — back to the lobby");
  }, [phase, canShowEnding, note]);

  // Ticks the accept window down for display. Stops the moment the window
  // closes, so nothing loops without live state behind it (§5).
  useEffect(() => {
    if (phase !== "found" || acceptDeadline === null) {
      setAcceptRemainingMs(undefined);
      return;
    }
    const tick = () => setAcceptRemainingMs(Math.max(0, acceptDeadline - performance.now()));
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [phase, acceptDeadline]);

  const emit = (event: string, payload: unknown = {}) => socketRef.current?.emit(event, payload);

  if (authError?.startsWith("GATEWAY_UNREACHABLE")) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <Card title="Gateway unreachable" tone="elevated">
          <p className="text-fail text-13">{authError.replace("GATEWAY_UNREACHABLE:", "") || "connection failed"}</p>
          <p className="text-fg-dim mt-3 text-13 leading-relaxed">
            You are signed in — this is a transport problem, not an authentication one. Start the
            gateway with{" "}
            <span className="tabular text-fg">
              node --experimental-strip-types apps/gateway/src/index.ts
            </span>{" "}
            and reload.
          </p>
        </Card>
      </main>
    );
  }

  if (authError) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <Card title="Not signed in" tone="elevated">
          <p className="text-fg-dim text-13 leading-relaxed">
            Create an account to queue for a match. It takes a handle, an email and a password.
          </p>
          <div className="mt-4 flex gap-2">
            <a href="/register">
              <Button variant="solid" tone="player">
                Create account
              </Button>
            </a>
            <a href="/login">
              <Button variant="outline">Sign in</Button>
            </a>
          </div>
        </Card>
      </main>
    );
  }

  /* Once the match is live the match screen owns the viewport. The queue view
     is a lobby, not a frame around the match — §6.4 requires the HUD to be
     fixed to the top and never scroll away, which it cannot be inside a
     centered max-w-4xl column. */
  if ((phase === "live" || phase === "ended") && match && problem) {
    const asPlayer = (card: PlayerCard): MatchPlayer => ({
      handle: card.handle,
      rating: card.rating,
      tier: card.tier,
      division: card.division,
      isBot: card.isBot,
    });
    return (
      <MatchScreen
        you={match.you}
        p1={asPlayer(match.p1)}
        p2={asPlayer(match.p2)}
        problem={problem}
        remainingMs={remainingMs}
        cells={cells}
        totalTests={totalTests}
        statuses={statuses}
        pulses={pulses}
        compileKeys={compileKeys}
        shatterKeys={shatterKeys}
        holding={holding}
        verdict={verdict}
        ending={ending}
        inFlight={inFlight}
        onSubmit={(language, source) =>
          emit("code.submit", { matchId: match.matchId, language, source })
        }
        onKeystrokes={(keys) => emit("pulse.report", { matchId: match.matchId, keys })}
        onRematch={() => {
          setPhase("idle");
          setEnding(null);
          setMatch(null);
          emit("queue.join", { mode: "RANKED" });
        }}
        onHub={() => {
          setPhase("idle");
          setEnding(null);
          setMatch(null);
        }}
      />
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col gap-6 px-6 py-10">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <p className="font-display text-fg-faint text-12 font-bold tracking-[var(--track-hud)] uppercase">
            {CURRENT_PHASE.label}
          </p>
          <h1 className="font-display text-fg mt-1 text-34 leading-none font-extrabold tracking-[var(--track-display)] uppercase">
            Play
          </h1>
        </div>
        <span
          className={cn(
            "font-display text-12 font-bold tracking-[var(--track-hud)] uppercase",
            connected ? "text-player" : "text-fail",
          )}
        >
          {connected ? "connected" : "offline"}
        </span>
      </header>

      {phase === "idle" && (
        <Button
          variant="solid"
          tone="player"
          size="lg"
          onClick={() => emit("queue.join", { mode: "RANKED" })}
          disabled={!connected}
        >
          Play
        </Button>
      )}

      {phase === "queued" && queue && (
        <div className="max-w-md">
          <QueueCard
            rating={Math.round((queue.ratingBand[0] + queue.ratingBand[1]) / 2)}
            tier="gold"
            division="II"
            onCancel={() => emit("queue.leave")}
            live={{
              elapsedMs: queue.elapsedMs,
              band: queue.ratingBand,
              widening: queue.widening,
              inQueue: queue.inQueue,
              alone: queue.alone ?? false,
            }}
          />
        </div>
      )}

      {presence && (
        <Card title="Opponent disconnected" tone="elevated">
          <p className="text-fg-dim text-13">
            {presence.side} dropped. The clock keeps running — grace does not buy thinking time.
            Forfeit in {Math.ceil(presence.graceMs / 1000)}s if they do not return.
          </p>
        </Card>
      )}

      <section>
        <p className="font-display text-fg-faint mb-1.5 text-12 font-bold tracking-[var(--track-hud)] uppercase">
          Socket events
        </p>
        <div className="border-line h-48 overflow-y-auto border bg-surface p-3">
          {log.length === 0 ? (
            <p className="text-fg-faint text-12">Nothing yet.</p>
          ) : (
            log.map((line, i) => (
              <p key={i} className="tabular text-fg-dim text-12 leading-relaxed">
                {line}
              </p>
            ))
          )}
        </div>
      </section>

      {/* Phase 1's cinematics, fired by real socket events. */}
      <AnimatePresence>
        {phase === "found" && match && (
          <QueuePop
            key="pop"
            p1={{
              handle: match.p1.handle,
              rating: match.p1.rating,
              tier: match.p1.tier as Tier,
              division: (match.p1.division ?? undefined) as Division | undefined,
              accepted: accepted.p1,
            }}
            p2={{
              handle: match.p2.handle,
              rating: match.p2.rating,
              tier: match.p2.tier as Tier,
              division: (match.p2.division ?? undefined) as Division | undefined,
              accepted: accepted.p2,
            }}
            head2head={match.p2.isBot ? "vs the bot" : "first meeting"}
            flashKey={1}
            you={match.you}
            acceptRemainingMs={acceptRemainingMs}
            onAccept={() => emit("match.accept", { matchId: match.matchId })}
          />
        )}
      </AnimatePresence>

      <Countdown beat={beat} />
    </main>
  );
}
