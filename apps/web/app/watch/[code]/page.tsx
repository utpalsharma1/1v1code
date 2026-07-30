"use client";

import Editor from "@monaco-editor/react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { Button, Card, cn } from "@1v1/ui";
import type { EditorChange } from "@1v1/proto";

/* ============================================================================
   /watch/<code> — the shareable spectator link (§7).

   THE REAL PATH. `/dev/spectate` stays as a debug tool that takes a match id;
   this takes the 10-character code that a player can actually send someone.

   NO ACCOUNT REQUIRED. §7 is explicit: a shared link reaching a stranger who
   watches a live match is the best growth path the product has, and a
   registration wall in front of it converts that stranger into a bounce. The
   socket authenticates with an anonymous ticket that can watch and nothing
   else, enforced at the gateway.

   Every visibility rule from §10 still applies and is still server-side. In
   particular a competitor cannot open their own match's link — they hold the
   code by construction, so this is the obvious bypass, and the refusal arrives
   as `SELF_SPECTATE` rather than as a hidden button.
   ========================================================================= */

const GATEWAY = process.env["NEXT_PUBLIC_GATEWAY_URL"] ?? "http://localhost:4000";

interface DocState {
  text: string;
  seq: number;
}

interface Ready {
  matchId: string;
  code: string;
  p1: { handle: string; rating: number };
  p2: { handle: string; rating: number };
  problem: { title: string; rating: number } | null;
  delayMs: number;
  state: string;
}

const emptyDoc = (): DocState => ({ text: "", seq: 0 });

function applyChanges(text: string, changes: EditorChange[]): string {
  let next = text;
  for (const change of changes) {
    const start = Math.min(change.offset, next.length);
    const end = Math.min(start + change.length, next.length);
    next = next.slice(0, start) + change.text + next.slice(end);
  }
  return next;
}

type Status = "connecting" | "watching" | "refused" | "gone" | "ended" | "archived";

interface Ending {
  kind: string;
  winner?: "p1" | "p2";
  reason?: string;
  elapsedMs: number;
}

interface Archived {
  p1: string;
  p2: string;
  problem: string;
  outcomeKind: string;
  finishedAt: string | null;
}

/** Final test counts per side, so the ending can show 8/10 vs 5/10. */
type Counts = Record<"p1" | "p2", { passed: number; total: number }>;

export default function WatchPage() {
  const params = useParams<{ code: string }>();
  const code = (params?.code ?? "").toString();
  const socketRef = useRef<Socket | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [reason, setReason] = useState<string | null>(null);
  const [ready, setReady] = useState<Ready | null>(null);
  const [ending, setEnding] = useState<Ending | null>(null);
  const [archived, setArchived] = useState<Archived | null>(null);
  const [holding, setHolding] = useState<("p1" | "p2")[]>([]);
  const [counts, setCounts] = useState<Counts>({
    p1: { passed: 0, total: 0 },
    p2: { passed: 0, total: 0 },
  });
  const [docs, setDocs] = useState<{ p1: DocState; p2: DocState }>({
    p1: emptyDoc(),
    p2: emptyDoc(),
  });

  const resync = useCallback((side: "p1" | "p2", matchId: string) => {
    socketRef.current?.emit("editor.resync", { matchId, side });
  }, []);

  useEffect(() => {
    let socket: Socket | null = null;
    let cancelled = false;
    let matchId = "";

    void (async () => {
      // Anonymous: §7. No session, no prompt, no wall.
      const response = await fetch("/api/watch-ticket", { method: "POST" });
      if (!response.ok) {
        if (!cancelled) {
          setStatus("refused");
          setReason("Could not reach the server.");
        }
        return;
      }
      const { ticket } = (await response.json()) as { ticket: string };
      if (cancelled) return;

      socket = io(GATEWAY, { transports: ["websocket"], auth: { ticket } });
      socketRef.current = socket;

      socket.on("connect", () => socket?.emit("spectate.watch", { code }));

      socket.on("spectate.ready", (p: Ready) => {
        matchId = p.matchId;
        setReady(p);
        setStatus("watching");
      });

      socket.on("editor.snapshot", (p: { side: "p1" | "p2"; seq: number; text: string }) => {
        setDocs((prev) => ({ ...prev, [p.side]: { text: p.text, seq: p.seq } }));
      });

      socket.on("editor.delta", (p: { side: "p1" | "p2"; seq: number; changes: EditorChange[] }) => {
        setDocs((prev) => {
          const doc = prev[p.side];
          // A gap is never papered over: ask for a snapshot and leave the
          // document alone. Applying to the wrong base shows plausible code
          // that was never written, which is worse than a visible pause.
          if (p.seq !== doc.seq + 1) {
            resync(p.side, matchId);
            return prev;
          }
          return { ...prev, [p.side]: { text: applyChanges(doc.text, p.changes), seq: p.seq } };
        });
      });

      socket.on("spectate.ended", (p: Archived) => {
        setArchived(p);
        setStatus("archived");
      });

      socket.on(
        "opponent.status",
        (p: { side: "p1" | "p2"; passed: number; total: number }) => {
          if (p.total > 0) setCounts((prev) => ({ ...prev, [p.side]: { passed: p.passed, total: p.total } }));
        },
      );

      // §6.7b: the hold reaches spectators too. Two people waiting on verdicts
      // is the tensest moment in the product; it must not look frozen.
      socket.on("match.judging", (p: { outstanding: ("p1" | "p2")[] }) => setHolding(p.outstanding));

      socket.on(
        "match.end",
        (p: { outcome: { kind: string; winner?: "p1" | "p2"; reason?: string }; elapsedMs: number }) => {
          setHolding([]);
          setEnding({ ...p.outcome, elapsedMs: p.elapsedMs ?? 0 });
          setStatus("ended");
        },
      );

      socket.on("error", (p: { code: string; message: string }) => {
        if (p.code === "NO_LIVE_MATCH") {
          setStatus("gone");
        } else if (p.code === "SELF_SPECTATE") {
          setStatus("refused");
          setReason("You are playing in this match. You cannot watch your own game.");
        } else {
          setStatus("refused");
          setReason(p.message);
        }
      });
    })();

    return () => {
      cancelled = true;
      socket?.close();
      socketRef.current = null;
    };
  }, [code, resync]);

  if (status === "archived" && archived) {
    /* A VALID code whose match has finished. Distinct from an unknown code
       because this one grants access — so confirming it exists leaks nothing,
       and a friend three minutes late gets a real answer instead of something
       indistinguishable from a broken link. */
    return (
      <Shell code={code}>
        <Card title="This match has finished" tone="elevated">
          <p className="text-fg-dim text-13 leading-relaxed">
            <span className="text-fg">{archived.p1}</span> vs{" "}
            <span className="text-fg">{archived.p2}</span> on {archived.problem} —{" "}
            {describeOutcome(archived.outcomeKind)}.
          </p>
          <p className="text-fg-faint mt-3 text-12 leading-relaxed">
            Replay lands in Phase 3. The match is recorded and nothing is lost — there is just no
            player for it yet.
          </p>
          <div className="mt-5 flex gap-2">
            <a href="/watch">
              <Button variant="solid" tone="player">
                Watch another
              </Button>
            </a>
            <a href="/">
              <Button variant="outline">Back to 1v1.code</Button>
            </a>
          </div>
        </Card>
      </Shell>
    );
  }

  if (status === "gone") {
    return (
      <Shell code={code}>
        <Card title="No live match" tone="elevated">
          <p className="text-fg-dim text-13 leading-relaxed">
            This link does not point at a match that is running right now. Either it finished, or the
            code is wrong. Live matches are only watchable while they are live — the replay archive
            is a later feature.
          </p>
          <div className="mt-5">
            <a href="/">
              <Button variant="outline">Back to 1v1.code</Button>
            </a>
          </div>
        </Card>
      </Shell>
    );
  }

  if (status === "refused") {
    return (
      <Shell code={code}>
        <Card title="Can't watch this" tone="elevated">
          <p className="text-fg-dim text-13 leading-relaxed">{reason ?? "Refused."}</p>
          <div className="mt-5">
            <a href="/">
              <Button variant="outline">Back to 1v1.code</Button>
            </a>
          </div>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell code={code}>
      {ready && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <span data-side="p1" className="font-display text-player text-16 font-extrabold uppercase">
              {ready.p1.handle}
            </span>
            <span className="text-fg-faint font-display text-12">vs</span>
            <span data-side="p2" className="font-display text-player text-16 font-extrabold uppercase">
              {ready.p2.handle}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {ready.problem && (
              <span className="border-line text-fg-dim tabular border px-2 py-1 text-12">
                {ready.problem.title} · {ready.problem.rating}
              </span>
            )}
            {/* §7: show the delay openly. Hiding it would make the stream look
                broken rather than deliberately delayed. */}
            {ready.delayMs > 0 && (
              <span className="border-line text-clock tabular border px-2 py-1 text-12">
                {Math.round(ready.delayMs / 1000)}s delay
              </span>
            )}
            {status === "ended" && (
              <span className="border-line text-fg-faint border px-2 py-1 text-12 uppercase">
                finished
              </span>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-px lg:grid-cols-2">
        {(["p1", "p2"] as const).map((side) => (
          <section key={side} data-side={side} className="border-line flex flex-col border">
            <div className="border-line flex items-center justify-between border-b bg-surface px-3 py-2">
              <span className="font-display text-player text-12 font-extrabold tracking-[var(--track-hud)] uppercase">
                {side === "p1" ? ready?.p1.handle ?? "P1" : ready?.p2.handle ?? "P2"}
              </span>
              <span className="tabular text-fg-faint text-12">{docs[side].text.length} chars</span>
            </div>
            <div className="h-[30rem]">
              <Editor
                height="100%"
                theme="vs-dark"
                language="python"
                value={docs[side].text}
                options={{
                  readOnly: true,
                  domReadOnly: true,
                  fontSize: 13,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                }}
              />
            </div>
          </section>
        ))}
      </div>

      {status === "connecting" && <p className="text-fg-faint mt-4 text-12">Connecting…</p>}

      {/* §6.7b — the hold, for a spectator. */}
      {holding.length > 0 && !ending && (
        <div className="pointer-events-none fixed inset-x-0 bottom-8 grid place-items-center">
          <div className="border-line clip-lean flex flex-col items-center gap-1 border bg-elevated px-8 py-4">
            <p className="font-display text-fg text-20 font-extrabold tracking-[var(--track-display)] uppercase">
              Awaiting verdict
            </p>
            <p className="text-fg-faint text-12">
              {holding.length === 2
                ? "both submissions are being judged"
                : `${holding[0] === "p1" ? ready?.p1.handle ?? "P1" : ready?.p2.handle ?? "P2"} is being judged`}
            </p>
          </div>
        </div>
      )}

      {ending && ready && (
        <SpectatorEnding ending={ending} ready={ready} counts={counts} />
      )}
    </Shell>
  );
}

/** §6.7 for someone who was not playing: the outcome, not the consequence. */
function SpectatorEnding({
  ending,
  ready,
  counts,
}: {
  ending: Ending;
  ready: Ready;
  counts: Counts;
}) {
  const winner = ending.winner ?? null;
  const seconds = Math.round(ending.elapsedMs / 1000);
  const elapsed = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[var(--scrim)] p-6">
      <div className="border-line clip-lean w-full max-w-2xl border bg-surface p-8">
        <p className="font-display text-fg-faint text-12 font-bold tracking-[var(--track-hud)] uppercase">
          match over
        </p>
        <h2 className="font-display text-fg mt-2 text-34 leading-none font-extrabold tracking-[var(--track-display)] uppercase">
          {winner ? `${winner === "p1" ? ready.p1.handle : ready.p2.handle} wins` : outcomeTitle(ending.kind)}
        </h2>
        <p className="text-fg-dim mt-3 text-13 leading-relaxed">{outcomeBody(ending)}</p>

        {/* Both plates resolve: the winner's side saturates, the loser's goes
            grey. Spectators get no rating delta — their §6.7 is the outcome,
            not the consequence. */}
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {(["p1", "p2"] as const).map((side) => {
            const won = winner === side;
            const lost = winner !== null && !won;
            return (
              <div
                key={side}
                data-side={side}
                className={cn(
                  "clip-lean border p-4 transition-all duration-[420ms]",
                  won && "border-player bg-elevated",
                  lost && "border-line opacity-55 grayscale",
                  winner === null && "border-line",
                )}
              >
                <p className="font-display text-player text-16 font-extrabold uppercase">
                  {side === "p1" ? ready.p1.handle : ready.p2.handle}
                </p>
                <p className="tabular text-fg-dim mt-1 text-13">
                  {counts[side].total > 0
                    ? `${counts[side].passed}/${counts[side].total} tests`
                    : "no submission"}
                </p>
              </div>
            );
          })}
        </div>

        <p className="tabular text-fg-faint mt-4 text-12">Elapsed {elapsed}</p>

        <div className="mt-6 flex gap-2">
          <a href="/watch">
            <Button variant="solid" tone="player">
              Watch another
            </Button>
          </a>
          <a href="/">
            <Button variant="outline">Stop watching</Button>
          </a>
        </div>
      </div>
    </div>
  );
}

function outcomeTitle(kind: string): string {
  if (kind === "DRAW") return "Draw";
  if (kind === "VOID") return "No contest";
  if (kind === "CANCELED") return "Match canceled";
  return kind;
}

/** Every way a match can end while somebody is watching gets a real sentence. */
function outcomeBody(ending: Ending): string {
  switch (ending.kind) {
    case "WIN":
      return ending.reason === "FORFEIT"
        ? "Their opponent disconnected and did not return within the grace period."
        : ending.reason === "OPPONENT_ABANDONED"
          ? "Their opponent never accepted the match."
          : "Solved it first. Receipt order decides, so the earlier submission wins even if its verdict landed second.";
    case "DRAW":
      return "Neither player solved it before the clock ran out.";
    case "CANCELED":
      return "The match was called off before it could finish. Nobody's rating moved.";
    case "VOID":
      /* VOID must not look like a crash. It is OUR failure and saying so is
         the whole reason it is a separate outcome from CANCELED. */
      return "A verdict was lost on our side, so the match is void — our infrastructure failed, not either player. No rating changed for anyone.";
    default:
      return "The match ended.";
  }
}

function describeOutcome(kind: string): string {
  switch (kind) {
    case "WIN":
      return "someone solved it";
    case "DRAW":
      return "it was a draw";
    case "VOID":
      return "it was voided by an error on our side";
    case "CANCELED":
      return "it was canceled";
    default:
      return "it has ended";
  }
}

function Shell({ code, children }: { code: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col px-6 py-8">
      <header className="mb-5 flex items-end justify-between gap-4">
        <div>
          <p className="font-display text-fg-faint text-12 font-bold tracking-[var(--track-hud)] uppercase">
            spectating · live
          </p>
          <h1 className="font-display text-fg mt-1 text-26 leading-none font-extrabold tracking-[var(--track-display)] uppercase">
            1v1<span className="text-player">.</span>code
          </h1>
        </div>
        <span className="border-line text-fg-dim tabular border px-2.5 py-1 text-13">{code}</span>
      </header>
      {children}
    </main>
  );
}
