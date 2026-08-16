"use client";

import { AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import {
  ChallengeLink,
  MatchScreen,
  type MatchPlayer,
  type MatchScreenProps,
} from "./MatchScreen";
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
import { PULSE_WINDOW, pulseStep } from "@1v1/core/pulse";
import { gatewayTarget } from "../../lib/gateway.ts";

/* ============================================================================
   /play — the first time Phase 1's cinematics fire on a real match.

   Everything here is driven by gateway events, not by buttons: the queue pop
   happens because somebody else actually joined. The match screen itself is
   2B-3; this takes the flow as far as LIVE.
   ========================================================================= */



/* `challenge` is its own phase, not a flavour of `queued`.

   Arriving from a challenge link used to land in `idle` — the lobby, with a PLAY
   button — until `challenge.waiting` came back from the gateway. So the one path
   that cannot afford friction opened on a button that meant something else: PLAY
   is the matchmaking queue, and there is nothing to queue for when you are
   already paired with a named person. A stranger clicking a Discord link decides
   in about four seconds and that press was in the way of all four of them.

   Making it a phase rather than a flag means the lobby is unreachable on this
   path by construction, so PLAY cannot be pressed and cannot mean two things. */
type Phase = "idle" | "challenge" | "queued" | "found" | "countdown" | "live" | "ended";

interface PlayerCard {
  handle: string;
  rating: number;
  tier: string;
  division: string | null;
  isBot: boolean;
  /** §7: a credential-less account. Drives the claim offer on the result
   *  screen and, via isRated, the unrated disclosure before the countdown. */
  isGuest: boolean;
}

interface QueueStatus {
  elapsedMs: number;
  ratingBand: [number, number];
  widening: boolean;
  inQueue: number;
  /** Nobody else is in the pool. There is no bot fallback in 2B-4, so the
   *  queue card stops performing a search rather than sweeping over nobody. */
  alone: boolean;
  ceiling: number;
  nextStepMs: number | null;
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
  /* Read the code BEFORE the first paint decides what to render, so a challenge
     arrival never flashes the lobby. */
  const initialChallenge =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("challenge");

  /* §7 Phase 2D. `?challenge=<code>` means we arrived from /c/<code> having
     already redeemed it — emit challenge.join once connected. The gateway pairs
     whoever is waiting on that code through the SAME createMatch matchmaking
     uses, which is what probe:lifecycle asserts. */
  const [challengeCode, setChallengeCode] = useState<string | null>(
    initialChallenge === "new" ? null : initialChallenge,
  );

  /* THE HUB'S PLAY BUTTON CARRIES ITS INTENT HERE.

     §6.1 is explicit that pressing PLAY starts searching — it does not take you
     to a screen with another PLAY button on it. The Hub owns the giant control
     and this screen owns the socket, so the intent travels as `?queue=1` and is
     acted on the moment the connection is up. Without it the player presses
     PLAY twice for one decision, which is the exact friction §6.1 exists to
     remove. */
  /* Read inside socket handlers, which capture their closure once — a piece of
     state would be stale there. */
  const matchRef = useRef<string | null>(null);

  const autoQueue =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("queue") === "1";

  /* `?challenge=new` is the Hub's "create a link" control. It is NOT a code —
     `new` is a sentinel, and it is checked before `initialChallenge` is used so
     it can never be mistaken for one. */
  const autoChallenge = initialChallenge === "new";

  /* One implementation, two callers: the button on this screen and the Hub's
     "Create a link" control arriving as `?challenge=new`. Duplicating it would
     be a second path to the same state, which is how the challenge waiting-slot
     bug happened. */
  const createChallengeLink = useCallback(async () => {
    setLinkError(null);
    const response = await fetch("/api/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = (await response.json()) as {
      code?: string;
      ratingMin?: number;
      ratingMax?: number;
      error?: string;
    };
    if (!response.ok || !body.code) {
      setLinkError(body.error ?? "Could not create a link.");
      return;
    }
    setLink({ code: body.code, band: [body.ratingMin ?? 800, body.ratingMax ?? 2000] });
    /* Register the host on their own challenge immediately, or the friend
       arrives and nothing pairs until the host presses something. */
    setChallengeCode(body.code);
    setPhase("challenge");
    socketRef.current?.emit("challenge.join", { code: body.code });
  }, []);

  const [challengeWait, setChallengeWait] = useState<{ host: string; youAreHost: boolean } | null>(
    null,
  );
  const [link, setLink] = useState<{ code: string; band: [number, number] } | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>(initialChallenge ? "challenge" : "idle");
  const [queue, setQueue] = useState<QueueStatus | null>(null);
  const [match, setMatch] = useState<{
    matchId: string;
    spectatorCode: string;
    rated: boolean;
    you: Side;
    p1: PlayerCard;
    p2: PlayerCard;
    problemRating: number;
  } | null>(null);
  const [accepted, setAccepted] = useState({ p1: false, p2: false });
  const [acceptDeadline, setAcceptDeadline] = useState<number | null>(null);
  const [acceptRemainingMs, setAcceptRemainingMs] = useState<number | undefined>(undefined);
  const [beat, setBeat] = useState<3 | 2 | 1 | 0 | null>(null);
  const [problem, setProblem] = useState<MatchScreenProps["problem"] | null>(null);
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
  // Bumped when the gateway reports a delta gap, which makes the editor
  // re-send ground truth. Recovery is a snapshot, never a guess (§10).
  const [desyncKey, setDesyncKey] = useState(0);
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

      socket = io(gatewayTarget(), {
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
      if (challengeCode) {
        socket.emit("challenge.join", { code: challengeCode });
        note(`joining challenge ${challengeCode}`);
      } else if (matchRef.current) {
        /* WE THINK WE ARE IN A MATCH — ask whether the server agrees.
           A gateway restart empties its in-memory match map, so the normal
           reconnect path finds nothing and says nothing, and this screen would
           sit with a running clock over a match that no longer exists. The
           answer is a resync, a match.end, or an error; never silence. */
        socket.emit("match.rejoin", { matchId: matchRef.current });
        note("asking whether the match is still live");
      } else if (autoChallenge) {
        void createChallengeLink();
        window.history.replaceState({}, "", "/play");
      } else if (autoQueue) {
        socket.emit("queue.join", { mode: "RANKED" });
        note("queueing from the hub");
        /* Drop the parameter so a reload is not a second queue attempt. */
        window.history.replaceState({}, "", "/play");
      }
    });

    socket.on("challenge.waiting", (payload: { host: string; youAreHost: boolean }) => {
      setChallengeWait(payload);
      setPhase("challenge");
      note(payload.youAreHost ? "waiting for your opponent" : `waiting for ${payload.host}`);
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
      // A challenge waiter is not in the matchmaking queue and must never be
      // shown the queue card, whatever else arrives.
      setPhase((prev) => (prev === "challenge" ? prev : "queued"));
    });
    socket.on("queue.left", () => {
      setPhase("idle");
      setQueue(null);
      note("left queue");
    });

    socket.on("match.found", (payload) => {
      matchRef.current = payload.matchId;
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
      setProblem(payload.problem);
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
        spectatorCode: payload.spectatorCode ?? "",
        rated: payload.rated ?? true,
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
      // The whole problem, not a hand-picked subset. Copying fields here is how
      // the resync path drifted from match.start in the first place.
      if (payload.problem) setProblem(payload.problem);

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

    /* §6.5 near-miss, from the ALLOWLISTED opponent view. It carries pass/fail
       and counts — never the verdict kind, never which test broke them, never
       compiler output. See relay.ts. */
    socket.on(
      "opponent.verdict",
      (payload: { side: Side; outcome: "pass" | "fail"; passed: number; total: number }) => {
        setStatuses((prev) => ({
          ...prev,
          [payload.side]:
            payload.total > 0
              ? { kind: "result", passed: payload.passed, total: payload.total }
              : { kind: "failed" },
        }));
        if (payload.outcome === "fail") {
          setShatterKeys((prev) => ({ ...prev, [payload.side]: prev[payload.side] + 1 }));
        }
      },
    );

    socket.on("match.judging", (payload: { outstanding: Side[] }) => setHolding(payload.outstanding));

    socket.on("editor.desync", (payload: { expected: number; got: number }) => {
      note(`editor desync (expected ${payload.expected}, got ${payload.got}) — resending`);
      setDesyncKey((k) => k + 1);
    });

    socket.on("opponent.pulse", (payload: { side: Side; keys: number }) => {
      /* Raw keystroke counts go in; a smoothed 0–1 level comes out.

         Feeding PulseLine the counts directly was wrong — it clamps to 0–1, so
         every sample with any typing in it pinned to full scale and the graph
         became a binary comb with no burst structure at all. `pulseStep` does
         the normalisation and the §6.4 asymmetric smoothing that makes an
         onset read as an onset. */
      setPulses((prev) => {
        const series = prev[payload.side];
        const level = pulseStep(series.at(-1) ?? 0, payload.keys);
        return { ...prev, [payload.side]: [...series, level].slice(-PULSE_WINDOW) };
      });
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
      matchRef.current = null;
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
  }, [note, challengeCode]);

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

  /* The gateway derives challenge membership from the row rather than holding a
     waiting slot, so it answers "waiting" when the other side is not connected
     yet. Re-ask every couple of seconds until it pairs — the same shape as the
     queue's own attempt loop, and it stops the moment a match is found. */
  useEffect(() => {
    if (!challengeCode || !connected || phase !== "challenge") return;
    const id = setInterval(() => {
      socketRef.current?.emit("challenge.join", { code: challengeCode });
    }, 2000);
    return () => clearInterval(id);
  }, [challengeCode, connected, phase]);

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
        matchId={match.matchId}
        spectatorCode={match.spectatorCode}
        isGuest={match[match.you].isGuest ?? false}
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
        onDelta={(batch) => emit("editor.delta", { matchId: match.matchId, ...batch })}
        onSnapshot={(seq, text) => emit("editor.snapshot", { matchId: match.matchId, seq, text })}
        desyncKey={desyncKey}
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
          {/* The build-phase label that was here is gone. It said "Phase 2E —
              Deployment" above the word Play, which is a note to the person
              writing the code. */}
          <h1 className="font-display text-fg text-34 leading-none font-extrabold tracking-[var(--track-display)] uppercase">
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
        <div className="flex flex-col gap-5">
          <Button
            variant="solid"
            tone="player"
            size="lg"
            onClick={() => emit("queue.join", { mode: "RANKED" })}
            disabled={!connected}
          >
            Play
          </Button>

          {/* §7: the launch feature. A link needs exactly two people who already
              know each other, so it brings its own audience into an empty
              product — unlike a queue, which needs a crowd to work at all. */}
          <Card
            title="Challenge a friend"
            aside={<span className="text-fg-faint text-12">no account needed to accept</span>}
          >
            {link ? (
              <div className="flex flex-col gap-3">
                <p className="text-fg-dim text-13 leading-relaxed">
                  Send this. The first person to open it joins, it works for 24 hours, and they can
                  play without registering.
                </p>
                <ChallengeLink code={link.code} />
                <p className="tabular text-fg-faint text-12">
                  Difficulty {link.band[0]}–{link.band[1]} · unlisted · no spectator delay
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-fg-dim text-13 leading-relaxed">
                  Generates a link you can paste anywhere. Difficulty defaults around your rating.
                </p>
                <div>
                  <Button
                    variant="outline"
                    onClick={() => void createChallengeLink()}
                  >
                    Create a challenge link
                  </Button>
                </div>
                {linkError && (
                  <p className="text-fail text-13" role="alert">
                    {linkError}
                  </p>
                )}
              </div>
            )}
          </Card>
        </div>
      )}

      {phase === "challenge" && (
        <Card
          title={
            challengeWait?.youAreHost === false && challengeWait.host
              ? `${challengeWait.host} challenged you`
              : "Challenge ready"
          }
          tone="elevated"
        >
          {/* Accept is the ONLY action on this screen. §6.2's accept step stays,
              because it is what stops a match starting against an empty chair —
              but nothing precedes it. */}
          <p className="text-fg-dim text-13 leading-relaxed">
            {challengeWait?.youAreHost
              ? "Your link is live. The moment someone opens it, the accept screen appears here — you do not need to do anything else."
              : challengeWait
                ? `Waiting for ${challengeWait.host} to open the match. It will start as soon as they are here.`
                : "Connecting to the challenge…"}
          </p>
          {challengeCode && (
            <div className="mt-4">
              {challengeWait?.youAreHost ? (
                <ChallengeLink code={challengeCode} />
              ) : (
                <p className="tabular text-fg-faint text-12">challenge {challengeCode}</p>
              )}
            </div>
          )}
          <p className="text-fg-faint mt-3 text-12 leading-relaxed">
            This match is unrated — nobody&apos;s rating moves.
          </p>
          <div className="mt-5">
            <Button
              variant="outline"
              onClick={() => {
                setChallengeCode(null);
                setChallengeWait(null);
                setPhase("idle");
              }}
            >
              Leave
            </Button>
          </div>
        </Card>
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
              ceiling: queue.ceiling ?? 400,
              nextStepMs: queue.nextStepMs ?? null,
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

      {/* THE SOCKET EVENT LOG LIVED HERE and has been removed from the player
          path. It was a debugging tool — raw event names, side labels, gateway
          state transitions — and it was the largest thing on the screen after
          the Play button, so it was the first thing a new player read. It told
          them nothing they wanted and quite a lot they should not have to
          think about.

          The information still exists where it belongs: `/dev/sparring` shows
          the same stream, and the JSONL event log on disk is the authoritative
          record (§10). Nothing was lost except a player having to look at it. */}

      {/* Phase 1's cinematics, fired by real socket events. */}
      <AnimatePresence>
        {phase === "found" && match && (
          <QueuePop
            key="pop"
            p1={{
              handle: match.p1.handle,
              rating: match.p1.rating,
              tier: (match.p1.tier ?? "iron") as Tier,
              division: (match.p1.division ?? undefined) as Division | undefined,
              accepted: accepted.p1,
            }}
            p2={{
              handle: match.p2.handle,
              rating: match.p2.rating,
              tier: (match.p2.tier ?? "iron") as Tier,
              division: (match.p2.division ?? undefined) as Division | undefined,
              accepted: accepted.p2,
            }}
            head2head={match.p2.isBot ? "vs the bot" : "first meeting"}
            flashKey={1}
            rated={match.rated}
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
