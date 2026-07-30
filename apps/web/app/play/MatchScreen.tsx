"use client";

import Editor from "@monaco-editor/react";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  ClutchEdge,
  MatchHUD,
  ShakeStage,
  VerdictPanel,
  VictoryOverlay,
  cn,
  useMotion,
  useScreenShake,
  type CellState,
  type Division,
  type HUDPlayer,
  type Side,
  type Status,
  type Tier,
} from "@1v1/ui";
import { PULSE_SAMPLE_MS } from "@1v1/core/pulse";
import type { EditorChange } from "@1v1/proto";

/* ============================================================================
   The match screen — Phase 1's cinematics driven by real gateway events.

   Every beat here fires because something actually happened on the server, not
   because a button on /dev/hud was pressed. The mapping is deliberately
   one-to-one with §6 so there is no second vocabulary to keep in sync:

     test.result        -> a cell resolves (§6.4, §6.6 sequential reveal)
     opponent.status    -> compile pulse and the opponent's bar (§6.5)
     opponent.pulse     -> the typing pulse line (§6.4)
     match.judging      -> the §6.7b hold
     submission.verdict -> the §6.6 verdict panel
     match.end          -> §6.7 victory / defeat, with the real rating delta

   §5 holds throughout: the editor's own content is never animated. All drama
   happens in the HUD around it.
   ========================================================================= */

export interface MatchPlayer {
  handle: string;
  rating: number;
  tier: string;
  division: string | null;
  isBot: boolean;
}

export interface MatchScreenProps {
  matchId: string;
  /** §7: the shareable spectator code. Empty until the gateway sends it. */
  spectatorCode: string;
  you: Side;
  p1: MatchPlayer;
  p2: MatchPlayer;
  problem: { title: string; statement: string; constraints: string; rating: number };
  remainingMs: number;
  /** Per-side test cells, owned by the page so a resync can replace them. */
  cells: { p1: CellState[]; p2: CellState[] };
  totalTests: number;
  statuses: { p1: Status; p2: Status };
  pulses: { p1: number[]; p2: number[] };
  compileKeys: { p1: number; p2: number };
  shatterKeys: { p1: number; p2: number };
  /** §6.7b — sides still owing a verdict. Empty means nobody is holding. */
  holding: Side[];
  verdict: {
    side: Side;
    verdict: string;
    passed: number;
    total: number;
    failedAt: number | null;
    message: string | null;
  } | null;
  ending: {
    kind: string;
    winner?: Side;
    reason?: string;
    ratings: { side: Side; before: number; after: number }[];
  } | null;
  inFlight: boolean;
  onSubmit: (language: "CPP17" | "PYTHON3", source: string) => void;
  onKeystrokes: (count: number) => void;
  /** One ~50ms batch of Monaco changes (§10). */
  onDelta: (batch: { seq: number; changes: EditorChange[]; origin: string }) => void;
  /** Ground truth, sent on mount and after any desync. */
  onSnapshot: (seq: number, text: string) => void;
  /** Bumped by the page when the gateway reports a gap. */
  desyncKey: number;
  onRematch: () => void;
  onHub: () => void;
}

const STARTERS: Record<"CPP17" | "PYTHON3", string> = {
  PYTHON3: `import sys

def main():
    data = sys.stdin.read().split()
    # your solution here
    print()

main()
`,
  CPP17: `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    // your solution here
    return 0;
}
`,
};

export function MatchScreen(props: MatchScreenProps) {
  const {
    matchId,
    spectatorCode,
    you,
    p1,
    p2,
    problem,
    remainingMs,
    cells,
    totalTests,
    statuses,
    pulses,
    compileKeys,
    shatterKeys,
    holding,
    verdict,
    ending,
    inFlight,
    onSubmit,
    onKeystrokes,
    onDelta,
    onSnapshot,
    desyncKey,
    onRematch,
    onHub,
  } = props;

  const m = useMotion();
  const [language, setLanguage] = useState<"CPP17" | "PYTHON3">("PYTHON3");
  const [source, setSource] = useState(STARTERS.PYTHON3);
  const seq = useRef(0);
  const pending = useRef<EditorChange[]>([]);
  const pendingOrigin = useRef<string>("type");
  const sourceRef = useRef(STARTERS.PYTHON3);
  const pasteArmed = useRef(false);
  const { controls: shakeControls, fire } = useScreenShake();
  const keystrokes = useRef(0);
  const opponent: Side = you === "p1" ? "p2" : "p1";

  /* §6.4: report keystroke COUNTS on a fixed cadence — never content. This is
     what makes the pulse line show thinking pauses versus typing bursts
     without leaking a character of code.

     125ms, not 500ms: §6.4 asks for ~8fps, and a 500ms window smears a burst's
     leading edge across four samples, which is the one thing the asymmetric
     smoothing downstream exists to preserve. */
  useEffect(() => {
    const id = setInterval(() => {
      onKeystrokes(keystrokes.current);
      keystrokes.current = 0;
    }, PULSE_SAMPLE_MS);
    return () => clearInterval(id);
  }, [onKeystrokes]);

  /* §10: Monaco deltas, batched at ~50ms and sequence-numbered.
     Only emitted when there is something to say — an idle editor is silent. */
  useEffect(() => {
    const id = setInterval(() => {
      if (pending.current.length === 0) return;
      seq.current += 1;
      onDelta({ seq: seq.current, changes: pending.current, origin: pendingOrigin.current });
      pending.current = [];
      pendingOrigin.current = "type";
    }, 50);
    return () => clearInterval(id);
  }, [onDelta]);

  // Ground truth on mount, and again whenever the gateway reports a gap.
  useEffect(() => {
    seq.current = 0;
    pending.current = [];
    onSnapshot(0, sourceRef.current);
  }, [onSnapshot, desyncKey]);

  // A submitted pass shakes the screen (§6.6.4). Failure does not — it stings
  // for a second and gets out of the way rather than punishing with motion.
  useEffect(() => {
    if (verdict?.side === you && verdict.verdict === "ACCEPTED") fire(5, m.dur.decay);
  }, [verdict, you, fire, m]);

  const hudPlayer = useCallback(
    (side: Side, player: MatchPlayer): HUDPlayer => ({
      handle: player.handle,
      rating: player.rating,
      tier: player.tier as Tier,
      division: (player.division ?? undefined) as Division | undefined,
      cells: cells[side],
      status: statuses[side],
      pulse: pulses[side],
      plate: ending?.winner === side ? "winner" : ending?.winner ? "loser" : "active",
      compileKey: compileKeys[side],
      flashKey: 0,
      shatterKey: shatterKeys[side],
    }),
    [cells, statuses, pulses, compileKeys, shatterKeys, ending],
  );

  /* §6.5 clutch: the opponent above 80% develops a breathing edge glow on
     their side. It encodes live state, so it stops the moment they drop back
     below the threshold — it is not decoration (§5). */
  const opponentProgress = useMemo(() => {
    const filled = cells[opponent].filter((c) => c === "pass").length;
    return totalTests === 0 ? 0 : filled / totalTests;
  }, [cells, opponent, totalTests]);

  const submitting = inFlight || holding.includes(you);

  return (
    <ShakeStage controls={shakeControls}>
      {/* The match id, discoverable without a log scrape — /dev/spectate needs
          it and so does anything automating this screen. */}
      <span data-match-id={matchId} hidden />
      <ClutchEdge side={opponent} progress={opponentProgress} />

      <div className="flex min-h-dvh flex-col">
        <MatchHUD
          p1={hudPlayer("p1", p1)}
          p2={hudPlayer("p2", p2)}
          totalTests={totalTests}
          clockMs={remainingMs}
          // §6.7b: the clock is meaningless during the hold — the match is
          // already decided, it just is not known yet.
          clockPending={holding.length > 0}
          mode="RANKED"
          endgame={ending?.winner ?? null}
        />

        <div className="grid flex-1 gap-px lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <section className="border-line overflow-y-auto border-r bg-surface p-5 max-lg:border-r-0 max-lg:border-b">
            <p className="font-display text-fg-faint text-12 font-bold tracking-[var(--track-hud)] uppercase">
              Problem · {problem.rating}
            </p>
            <h1 className="font-display text-fg mt-1 text-20 leading-tight font-extrabold tracking-[var(--track-display)] uppercase">
              {problem.title}
            </h1>
            <div className="text-fg-dim mt-4 space-y-3 text-13 leading-relaxed whitespace-pre-wrap">
              {problem.statement}
            </div>
            <p className="font-display text-fg-faint mt-5 mb-1 text-12 font-bold tracking-[var(--track-hud)] uppercase">
              Constraints
            </p>
            <div className="tabular text-fg-dim text-12 leading-relaxed whitespace-pre-wrap">
              {problem.constraints}
            </div>
          </section>

          <section className="relative flex min-h-[24rem] flex-col" data-side={you}>
            <div className="border-line flex items-center justify-between gap-3 border-b bg-surface px-4 py-2">
              <div className="flex gap-1">
                {(["PYTHON3", "CPP17"] as const).map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => {
                      setLanguage(lang);
                      setSource(STARTERS[lang]);
                      sourceRef.current = STARTERS[lang];
                      // The whole document was replaced; re-establish ground
                      // truth rather than emitting a delta nobody can apply.
                      seq.current = 0;
                      pending.current = [];
                      onSnapshot(0, STARTERS[lang]);
                    }}
                    className={cn(
                      "focus-ring font-display px-2.5 py-1 text-12 font-bold tracking-[var(--track-hud)] uppercase",
                      "transition-colors duration-[160ms]",
                      language === lang
                        ? "text-ink bg-player"
                        : "text-fg-faint hover:text-fg-dim",
                    )}
                  >
                    {lang === "PYTHON3" ? "Python 3" : "C++17"}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                {spectatorCode && <WatchLink code={spectatorCode} />}
                <Button
                variant="solid"
                tone="player"
                side={you}
                onClick={() => onSubmit(language, source)}
                disabled={submitting || !!ending}
              >
                {/* §6.8b: the in-flight lock IS the cost of a wrong answer, so
                    it has to be legible rather than a silently dead button. */}
                {submitting ? "Judging…" : "Submit"}
                </Button>
              </div>
            </div>

            {/* §5: the editor is a workspace and stays calm. It dims and blurs
                on submit because it is out of your hands, and that is the only
                thing that ever happens to it. */}
            <motion.div
              className="relative flex-1"
              animate={{
                opacity: submitting || ending ? 0.45 : 1,
                filter: submitting || ending ? "blur(4px)" : "blur(0px)",
              }}
              transition={m.tween(m.dur.fast)}
            >
              <Editor
                height="100%"
                theme="vs-dark"
                language={language === "PYTHON3" ? "python" : "cpp"}
                value={source}
                onMount={(editor) => {
                  /* §10 paste detection: capture the DATA, build no response.
                     Monaco tells us a paste happened separately from the change
                     itself, so flag the next batch. */
                  editor.onDidPaste(() => {
                    pasteArmed.current = true;
                  });
                }}
                onChange={(value, event) => {
                  keystrokes.current += 1;
                  const next = value ?? "";
                  sourceRef.current = next;
                  setSource(next);

                  /* Monaco emits a single event's changes in DESCENDING offset
                     order, and absolute offsets make applying them a pure
                     string splice on the far side. Keep the order. */
                  for (const change of event?.changes ?? []) {
                    pending.current.push({
                      offset: change.rangeOffset,
                      length: change.rangeLength,
                      text: change.text,
                    });
                  }
                  if (pasteArmed.current) {
                    pendingOrigin.current = "paste";
                    pasteArmed.current = false;
                  }
                }}
                options={{
                  fontFamily: "var(--ff-code)",
                  fontSize: 14,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  smoothScrolling: false,
                  readOnly: submitting || !!ending,
                  padding: { top: 16 },
                }}
              />
            </motion.div>
          </section>
        </div>
      </div>

      {/* §6.6 — the verdict panel, resolving one test at a time. */}
      <AnimatePresence>
        {verdict && verdict.side === you && !ending && (
          <div key="verdict" className="pointer-events-none fixed inset-x-0 top-24 z-40 grid place-items-center">
            <VerdictPanel
              side={you}
              cells={cells[you]}
              failedIndex={verdict.failedAt}
              outcome={verdict.verdict === "ACCEPTED" ? "pass" : "fail"}
              burstKey={1}
            />
          </div>
        )}
      </AnimatePresence>

      {/* §6.7b — the hold. A beat, not a spinner. */}
      <AnimatePresence>
        {holding.length > 0 && !ending && <JudgingHold you={you} holding={holding} verdict={verdict} />}
      </AnimatePresence>

      {/* §6.7 — victory or defeat, with the real rating delta. */}
      <AnimatePresence>
        {ending && (
          <MatchEnding key="end" you={you} ending={ending} onRematch={onRematch} onHub={onHub} />
        )}
      </AnimatePresence>
    </ShakeStage>
  );
}

/* ── §7 the shareable watch link ───────────────────────────────────────── */

/**
 * A monospace code chip that copies its own full URL.
 *
 * Designed into the toolbar rather than bolted on: the product's language is
 * terminals and monospace type (§4), so a 10-character code in `--ff-code` with
 * a clipped corner reads as native. The alternative — a labelled "Share" button
 * — would be the generic dashboard move §2 exists to avoid.
 *
 * It shows the code, not the URL, because the code is the thing worth reading at
 * a glance and the URL is long. Clicking copies the whole link.
 */
function WatchLink({ code }: { code: string }) {
  const m = useMotion();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const url = `${window.location.origin}/watch/${code}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard can be refused (permissions, insecure context). A selectable
      // fallback beats a silently dead button.
      window.prompt("Copy this link", url);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      // aria-label, not just title: the visible text is the code, so without
      // this the accessible name is the code and the control's PURPOSE is
      // invisible to a screen reader (and to anything matching by role+name).
      aria-label={`Copy the spectator link for ${code}`}
      title={`Copy the spectator link for ${code}`}
      className={cn(
        "focus-ring clip-lean-sm border-line group flex items-center gap-2 border px-2.5 py-1",
        "transition-colors duration-[160ms] hover:border-[var(--player)]",
      )}
    >
      <span aria-hidden className="text-fg-faint group-hover:text-player text-12 leading-none">
        ⧉
      </span>
      <span className="tabular text-fg-dim group-hover:text-fg text-12 leading-none tracking-wide">
        {copied ? "copied" : code}
      </span>
      {/* One-shot confirmation, not a resting glow (§4). */}
      {copied && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[var(--flash-soft)]"
          initial={{ opacity: 0.5 }}
          animate={{ opacity: 0 }}
          transition={m.tween(m.dur.decay)}
        />
      )}
    </button>
  );
}

/* ── §6.7b the judging hold ────────────────────────────────────────────── */

function JudgingHold({
  you,
  holding,
  verdict,
}: {
  you: Side;
  holding: Side[];
  verdict: MatchScreenProps["verdict"];
}) {
  const m = useMotion();
  const yoursIsIn = verdict?.side === you;
  const yoursPassed = yoursIsIn && verdict?.verdict === "ACCEPTED";

  /* The same screen carries opposite charges and the difference is one chip.
     If you passed, the question is whether they beat you on receipt order. If
     you failed, it inverts — you are now hoping they failed too. One screen,
     not two. */
  return (
    <motion.div
      className="pointer-events-none fixed inset-x-0 bottom-10 z-40 grid place-items-center"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: m.tween(m.dur.fast, m.ease.in) }}
      transition={m.t(m.tween(m.dur.base, m.ease.out))}
    >
      <div className="border-line clip-lean flex flex-col items-center gap-2 border bg-elevated px-8 py-4">
        <p className="font-display text-fg text-20 font-extrabold tracking-[var(--track-display)] uppercase">
          Awaiting verdict
        </p>
        {yoursIsIn && (
          <span
            data-side={you}
            className={cn(
              "clip-lean-sm font-display px-2 py-0.5 text-12 leading-none font-extrabold uppercase",
              "tracking-[var(--track-hud)]",
              yoursPassed ? "text-ink bg-player" : "text-ink bg-[var(--fail)]",
            )}
          >
            {yoursPassed ? `you passed ${verdict.passed}/${verdict.total}` : "you failed"}
          </span>
        )}
        <p className="text-fg-faint text-12">
          {holding.includes(you) ? "your submission is still judging" : "their submission is still judging"}
        </p>
      </div>
    </motion.div>
  );
}

/* ── §6.7 ending ───────────────────────────────────────────────────────── */

function MatchEnding({
  you,
  ending,
  onRematch,
  onHub,
}: {
  you: Side;
  ending: NonNullable<MatchScreenProps["ending"]>;
  onRematch: () => void;
  onHub: () => void;
}) {
  const mine = ending.ratings.find((r) => r.side === you);

  /* A draw, a cancellation and a void are not victories or defeats and must
     not borrow that cinematic. §6.9 is explicit that a VOID is a no-contest
     with no rating change — dressing it as a loss would be a lie about whose
     fault it was. */
  if (ending.kind !== "WIN") {
    return <NonResult kind={ending.kind} reason={ending.reason} onRematch={onRematch} onHub={onHub} />;
  }

  return (
    <VictoryOverlay
      winner={ending.winner === you ? "p1" : "p2"}
      ratingFrom={mine?.before ?? 0}
      ratingTo={mine?.after ?? 0}
      burstKey={1}
      onRematch={onRematch}
      onQueue={onRematch}
      onHub={onHub}
    />
  );
}

function NonResult({
  kind,
  reason,
  onRematch,
  onHub,
}: {
  kind: string;
  reason?: string;
  onRematch: () => void;
  onHub: () => void;
}) {
  const m = useMotion();
  const copy: Record<string, { title: string; body: string }> = {
    DRAW: {
      title: "Draw",
      body: "Neither of you solved it before the clock ran out. Ratings barely move on a draw, which is what a draw means.",
    },
    CANCELED: {
      title: "Match canceled",
      body:
        reason === "NEVER_STARTED"
          ? "The accept window closed before both players were ready. Nothing was rated."
          : "Both players left. Nothing was rated.",
    },
    VOID: {
      title: "No contest",
      body: "A verdict was lost on our side, so the match is void. No rating change for either player — losing rating because our infrastructure failed would be indefensible.",
    },
  };
  const text = copy[kind] ?? { title: kind, body: "" };

  return (
    <motion.div
      className="fixed inset-0 z-50 grid place-items-center bg-[var(--scrim)]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={m.tween(m.dur.base)}
    >
      <div className="border-line clip-lean max-w-md border bg-surface p-8 text-center">
        <h2 className="font-display text-fg text-34 leading-none font-extrabold tracking-[var(--track-display)] uppercase">
          {text.title}
        </h2>
        <p className="text-fg-dim mt-4 text-13 leading-relaxed">{text.body}</p>
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="solid" tone="player" onClick={onRematch}>
            Queue again
          </Button>
          <Button variant="outline" onClick={onHub}>
            Back
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

/* ── §7 challenge link, host side ──────────────────────────────────────── */

/**
 * The generated challenge URL, copyable in one click.
 *
 * Same idiom as the spectator chip: a monospace code in a clipped border, in
 * §4's language rather than a generic Share button. It shows the code because
 * that is the readable part, and copies the whole URL because that is the
 * useful part.
 */
export function ChallengeLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const url = `${window.location.origin}/c/${code}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copy this link", url);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className={cn(
        "focus-ring clip-lean border-line group flex w-full items-center justify-between gap-3",
        "border bg-elevated px-4 py-3 transition-colors duration-[160ms] hover:border-[var(--player)]",
      )}
    >
      <span className="tabular text-fg text-16 tracking-[0.14em]">{code}</span>
      <span className="font-display text-fg-faint group-hover:text-player text-12 font-bold tracking-[var(--track-hud)] uppercase">
        {copied ? "copied" : "copy link"}
      </span>
    </button>
  );
}
