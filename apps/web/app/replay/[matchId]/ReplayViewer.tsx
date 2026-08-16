"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Handle, TestBar, type Tier } from "@1v1/ui";
import {
  documentsAt,
  markersOf,
  parseReplay,
  progressAt,
  type LogEvent,
  type Marker,
  type ReplayMeta,
} from "@1v1/core/replay";

/* ============================================================================
   The replay viewer (§7) — the first consumer the event log has ever had.

   Everything on screen is computed by `@1v1/core/replay` from the log bytes.
   Nothing here queries anything: the handles, the ratings, the problem title
   are all in the file since schemaVersion 1, which is what makes §10's "replay
   is a pure function of the log" true rather than aspirational.

   MOTION (§2 rule 3): a scrubber is a tool, not a moment. Dragging is
   instantaneous and nothing animates on a seek — the drama in a replay is what
   the players did, and a viewer that performs while you scrub is fighting it.
   ========================================================================= */

const SPEEDS = [0.5, 1, 2, 4, 8] as const;

export function ReplayViewer({ matchId }: { matchId: string }) {
  const [raw, setRaw] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [atMs, setAtMs] = useState(0);
  const [speed, setSpeed] = useState<number>(1);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch(`/api/replay/${matchId}`);
      const text = await response.text();
      if (cancelled) return;
      if (!response.ok) {
        /* The route answers JSON on failure and NDJSON on success, so a failure
           body is parsed defensively rather than assumed — the same lesson as
           the registration 500 that reached a player as a parser exception. */
        try {
          setError((JSON.parse(text) as { error?: string }).error ?? `Failed (${response.status})`);
        } catch {
          setError(`Failed (${response.status})`);
        }
        return;
      }
      setRaw(text);
    })();
    return () => {
      cancelled = true;
    };
  }, [matchId]);

  const load = useMemo(() => (raw === null ? null : parseReplay(raw)), [raw]);

  /* Playback advances offsetMs in real time, scaled. It is a timer over the
     log's own clock rather than a replay of wall time, so a match recorded on a
     host whose clock jumped still plays smoothly. */
  useEffect(() => {
    if (!playing || !load?.ok) return;
    const started = performance.now();
    const from = atMs;
    const id = setInterval(() => {
      const next = from + (performance.now() - started) * speed;
      if (next >= load.endMs) {
        setAtMs(load.endMs);
        setPlaying(false);
      } else setAtMs(next);
    }, 50);
    return () => clearInterval(id);
    // `atMs` is the seek origin, deliberately not a dependency: including it
    // would restart the timer on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, speed, load]);

  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="font-display text-fg text-26 font-extrabold tracking-[var(--track-display)] uppercase">
          No replay
        </h1>
        <p className="text-fg-dim mt-3 text-14">{error}</p>
        <Link href="/" className="text-p1 focus-ring mt-5 inline-block text-13 underline underline-offset-2">
          Back to the hub
        </Link>
      </main>
    );
  }
  if (!load) return <Shell>Loading the log…</Shell>;
  if (!load.ok) return <Shell>{load.reason}</Shell>;

  const { meta, events, endMs, markers } = load;
  const docs = documentsAt(events, atMs);
  const progress = progressAt(events, atMs);

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-display text-fg text-20 font-extrabold tracking-[var(--track-display)] uppercase">
          Replay
        </h1>
        <p className="text-fg-dim text-13">
          {meta.problem.title} · <span className="tabular">{meta.problem.rating}</span> ·{" "}
          {meta.mode.toLowerCase()}
        </p>
      </header>

      <div className="grid gap-3 lg:grid-cols-2">
        {(["p1", "p2"] as const).map((side) => (
          <section key={side} data-side={side} className="border-line clip-corner border bg-surface">
            <div className="border-line flex items-baseline justify-between gap-3 border-b px-4 py-2">
              <span className="text-14">
                <span className="font-display text-player mr-2 text-11 font-bold tracking-[var(--track-hud)] uppercase">
                  {side}
                </span>
                {/* §4: a replay shows a live HUD, so handles are NOT tier
                    coloured here — identity comes from the P1/P2 chip. */}
                <Handle handle={meta[side].handle} inMatch />
              </span>
              <span className="text-fg-faint tabular text-12">{meta[side].rating}</span>
            </div>
            <div className="px-4 py-2">
              <TestBar
                side={side}
                passed={progress[side].passed}
                total={progress[side].total || 1}
              />
            </div>
            <pre className="text-fg-dim max-h-[46vh] overflow-auto px-4 py-3 text-12 leading-relaxed [font-family:var(--ff-code)]">
              {docs[side] || " "}
            </pre>
          </section>
        ))}
      </div>

      <Scrubber
        atMs={atMs}
        endMs={endMs}
        markers={markers}
        onSeek={(ms) => {
          setPlaying(false);
          setAtMs(ms);
        }}
      />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          className="focus-ring clip-p1 font-display text-ink bg-p1 px-5 py-2 text-12 font-extrabold tracking-[var(--track-hud)] uppercase transition-transform duration-[160ms] hover:scale-[1.02] active:scale-[0.97]"
        >
          {playing ? "Pause" : "Play"}
        </button>
        <div className="flex gap-1">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpeed(s)}
              aria-pressed={s === speed}
              className={`focus-ring font-display border px-2.5 py-1.5 text-11 font-bold tabular transition-colors duration-[160ms] ${
                s === speed ? "border-line-hot text-fg bg-elevated" : "border-line text-fg-faint hover:text-fg-dim"
              }`}
            >
              {s}×
            </button>
          ))}
        </div>
        <span className="text-fg-faint tabular ml-auto text-12">
          {clock(atMs)} / {clock(endMs)}
        </span>
      </div>
    </main>
  );
}

function Scrubber({
  atMs,
  endMs,
  markers,
  onSeek,
}: {
  atMs: number;
  endMs: number;
  markers: Marker[];
  onSeek: (ms: number) => void;
}) {
  return (
    <div className="relative">
      <input
        type="range"
        min={0}
        max={Math.max(1, endMs)}
        value={Math.round(atMs)}
        onChange={(e) => onSeek(Number(e.target.value))}
        aria-label="Scrub the match"
        className="focus-ring bg-elevated h-2 w-full appearance-none rounded-[2px] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-2 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:bg-[var(--p1)]"
      />
      {/* §7's timeline markers. Positioned, never animated.

          COLOURED BY SIDE THROUGH `data-side`, not by branching: the marker
          inherits `--player` exactly like every other owned element in the
          product (§4), so P1 and P2 are distinguishable at a glance without
          reading a word. Markers that belong to neither side — the start and
          the end — take the neutral tone.

          The title is what happened AND who: "P1 wrong answer 7/10". A tick
          you have to guess at is a decoration. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-2">
        {markers.map((m, i) => (
          <span
            key={i}
            {...(m.side ? { "data-side": m.side } : {})}
            title={`${clock(m.offsetMs)} — ${m.side ? `${m.side.toUpperCase()} ` : ""}${m.label}`}
            style={{ left: `${(m.offsetMs / Math.max(1, endMs)) * 100}%` }}
            className={`pointer-events-auto absolute top-0 h-2 w-[2px] ${
              m.side ? "bg-player" : MARKER_TONE[m.kind]
            } ${m.kind === "idle" ? "opacity-50" : ""}`}
          />
        ))}
      </div>
    </div>
  );
}

const MARKER_TONE: Record<Marker["kind"], string> = {
  start: "bg-fg-faint",
  submit: "bg-info",
  verdict: "bg-p1",
  idle: "bg-fg-faint/50",
  disconnect: "bg-fail",
  end: "bg-fg-dim",
};

function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <p className="text-fg-dim text-14">{children}</p>
    </main>
  );
}
