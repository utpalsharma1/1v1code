"use client";

import { AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import {
  Button,
  Card,
  Countdown,
  MotionTuningProvider,
  QueueCard,
  QueuePop,
  cn,
  type Division,
  type Side,
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
    p1: PlayerCard;
    p2: PlayerCard;
    problemRating: number;
  } | null>(null);
  const [accepted, setAccepted] = useState({ p1: false, p2: false });
  const [beat, setBeat] = useState<3 | 2 | 1 | 0 | null>(null);
  const [problem, setProblem] = useState<{ title: string; rating: number } | null>(null);
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
      setProblem({ title: payload.problem.title, rating: payload.problem.rating });
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
        p1: payload.p1,
        p2: payload.p2,
        problemRating: payload.problem?.rating ?? 0,
      });
      setAccepted(payload.accepted);
      setRemainingMs(payload.remainingMs);
      setPhase(payload.state === "LIVE" ? "live" : payload.state === "COUNTDOWN" ? "countdown" : "found");
      note(`resynced into ${payload.state}`);
    });
    socket.on("match.end", (payload) => {
      setPhase("ended");
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
            Sign in to play. Identity comes from a real session cookie issued by{" "}
            <span className="tabular text-fg">/register</span> — there is no console step and no
            cookie to paste.
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

  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col gap-6 px-6 py-10">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <p className="font-display text-fg-faint text-12 font-bold tracking-[var(--track-hud)] uppercase">
            Phase 2B-2 · gateway
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
          />
          <p className="text-fg-faint mt-3 text-12">
            Band {queue.ratingBand[0]}–{queue.ratingBand[1]} · {queue.inQueue} in queue ·{" "}
            {queue.widening ? "widening" : "at ceiling"}
          </p>
        </div>
      )}

      {phase === "found" && match && (
        <div className="flex flex-col gap-4">
          <Button variant="solid" tone="player" onClick={() => emit("match.accept", { matchId: match.matchId })}>
            Accept
          </Button>
          <p className="text-fg-dim text-13">
            {accepted.p1 ? "P1 ready" : "P1 waiting"} · {accepted.p2 ? "P2 ready" : "P2 waiting"}
          </p>
        </div>
      )}

      {phase === "live" && problem && (
        <Card title="Live" aside={<span className="tabular text-fg-faint text-12">{problem.rating}</span>}>
          <p className="font-display text-fg text-20 font-bold uppercase">{problem.title}</p>
          <p className="tabular text-fg-dim mt-2 text-26">
            {String(Math.floor(remainingMs / 60000)).padStart(2, "0")}:
            {String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, "0")}
          </p>
          <p className="text-fg-faint mt-2 text-12">
            The match screen and editor are 2B-3. This proves the flow reaches LIVE.
          </p>
        </Card>
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
          />
        )}
      </AnimatePresence>

      <Countdown beat={beat} />
    </main>
  );
}
