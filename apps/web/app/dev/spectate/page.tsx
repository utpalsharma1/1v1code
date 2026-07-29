"use client";

import Editor from "@monaco-editor/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { Button, Card, cn } from "@1v1/ui";
import type { EditorChange } from "@1v1/proto";

/* ============================================================================
   /dev/spectate — both editors, side by side, as a spectator will see them.

   This is what makes 2C-1 verifiable by eye, the same argument as /dev/hud and
   /dev/sparring. It is NOT the spectator feature: §7's tiered fanout (200ms,
   500ms on ranked), the delay badge, the late-joiner path and the viewer count
   are 2C-2 and Phase 3. This consumes the relay at player cadence with one
   viewer, which is exactly the case where the batching tiers would be
   unobservable anyway.

   It also demonstrates the visibility rule from the outside: a spectator sees
   both documents live, and a competing player cannot obtain either. The
   gateway refuses `spectate.join` from someone playing in the match, so
   opening this page as a competitor shows the refusal rather than the code.
   ========================================================================= */

const GATEWAY = process.env["NEXT_PUBLIC_GATEWAY_URL"] ?? "http://localhost:4000";

interface DocState {
  text: string;
  seq: number;
  gaps: number;
}

const emptyDoc = (): DocState => ({ text: "", seq: 0, gaps: 0 });

/** Absolute-offset splice — the mirror of the gateway's applier. */
function applyChanges(text: string, changes: EditorChange[]): string {
  let next = text;
  for (const change of changes) {
    const start = Math.min(change.offset, next.length);
    const end = Math.min(start + change.length, next.length);
    next = next.slice(0, start) + change.text + next.slice(end);
  }
  return next;
}

export default function SpectatePage() {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [matchId, setMatchId] = useState("");
  const [joined, setJoined] = useState<string | null>(null);
  /* A ref, not the state value, because the socket effect must NOT depend on
     it: adding `joined` to the deps tore the socket down and rebuilt it the
     moment you clicked Watch, which threw away the spectate.join that had just
     been sent on the old one. The page connected, joined nothing, and showed
     two empty editors forever. */
  const joinedRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [docs, setDocs] = useState<{ p1: DocState; p2: DocState }>({
    p1: emptyDoc(),
    p2: emptyDoc(),
  });
  const [log, setLog] = useState<string[]>([]);

  const note = useCallback((line: string) => {
    setLog((prev) => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev].slice(0, 40));
  }, []);

  useEffect(() => {
    let socket: Socket | null = null;
    let cancelled = false;

    void (async () => {
      const response = await fetch("/api/dev/sparring-ticket?as=spectator", { method: "POST" });
      if (!response.ok) {
        note(`could not mint a ticket (${response.status})`);
        return;
      }
      const { ticket } = (await response.json()) as { ticket: string };
      if (cancelled) return;

      socket = io(GATEWAY, { transports: ["websocket"], auth: { ticket } });
      socketRef.current = socket;

      socket.on("connect", () => {
        setConnected(true);
        note("connected");
      });
      socket.on("disconnect", () => setConnected(false));

      socket.on(
        "editor.snapshot",
        (p: { side: "p1" | "p2"; seq: number; text: string }) => {
          setDocs((prev) => ({ ...prev, [p.side]: { ...prev[p.side], text: p.text, seq: p.seq } }));
          note(`snapshot ${p.side} @seq ${p.seq} (${p.text.length} chars)`);
        },
      );

      socket.on(
        "editor.delta",
        (p: { side: "p1" | "p2"; seq: number; changes: EditorChange[] }) => {
          setDocs((prev) => {
            const doc = prev[p.side];
            /* A gap must never be papered over. Applying a delta to the wrong
               base yields plausible code that was never written, which is
               strictly worse than a visible hole — so count it, ask for a
               snapshot, and leave the document alone until one arrives. */
            if (p.seq !== doc.seq + 1) {
              socketRef.current?.emit("editor.resync", { matchId: joinedRef.current, side: p.side });
              return { ...prev, [p.side]: { ...doc, gaps: doc.gaps + 1 } };
            }
            return {
              ...prev,
              [p.side]: { ...doc, text: applyChanges(doc.text, p.changes), seq: p.seq },
            };
          });
        },
      );

      socket.on("match.end", () => note("match ended"));
      socket.on("error", (p: { code: string; message: string }) => {
        setError(`${p.code}: ${p.message}`);
        note(`! ${p.code}: ${p.message}`);
      });
    })();

    return () => {
      cancelled = true;
      socket?.close();
      socketRef.current = null;
    };
  }, [note]);

  const join = () => {
    const id = matchId.trim();
    if (!id) return;
    setError(null);
    setDocs({ p1: emptyDoc(), p2: emptyDoc() });
    setJoined(id);
    joinedRef.current = id;
    socketRef.current?.emit("spectate.join", { matchId: id });
    note(`joining ${id}`);
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-5 px-6 py-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="font-display text-fg-faint text-12 font-bold tracking-[var(--track-hud)] uppercase">
            dev · not the spectator feature
          </p>
          <h1 className="font-display text-fg mt-1 text-34 leading-none font-extrabold tracking-[var(--track-display)] uppercase">
            Spectate
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

      <Card title="Match">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="font-display text-fg-dim text-12 font-bold tracking-[var(--track-hud)] uppercase">
              Match id
            </span>
            <input
              value={matchId}
              onChange={(e) => setMatchId(e.target.value)}
              placeholder="paste from the gateway log or /play"
              spellCheck={false}
              className="focus-ring border-line text-fg tabular w-full border bg-elevated px-3 py-2 text-13"
            />
          </label>
          <Button variant="solid" tone="player" onClick={join} disabled={!connected}>
            Watch
          </Button>
        </div>
        {error && (
          <p className="text-fail mt-3 text-13" role="alert">
            {error}
          </p>
        )}
        <p className="text-fg-faint mt-3 text-12 leading-relaxed">
          The gateway logs <span className="tabular text-fg">[gateway] match &lt;id&gt;: …</span> when a
          match starts. A player in the match cannot watch it — the gateway refuses by identity,
          because otherwise this page would be a one-click bypass of the visibility rule.
        </p>
      </Card>

      <div className="grid gap-px lg:grid-cols-2">
        {(["p1", "p2"] as const).map((side) => (
          <section key={side} data-side={side} className="border-line flex flex-col border">
            <div className="border-line flex items-center justify-between border-b bg-surface px-3 py-2">
              <span className="font-display text-player text-12 font-extrabold tracking-[var(--track-hud)] uppercase">
                {side}
              </span>
              <span className="tabular text-fg-faint text-12">
                seq {docs[side].seq} · {docs[side].text.length} chars
                {docs[side].gaps > 0 && ` · ${docs[side].gaps} gap(s) recovered`}
              </span>
            </div>
            <div className="h-[28rem]">
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

      <section>
        <p className="font-display text-fg-faint mb-1.5 text-12 font-bold tracking-[var(--track-hud)] uppercase">
          Relay events
        </p>
        <div className="border-line h-40 overflow-y-auto border bg-surface p-3">
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
    </main>
  );
}
