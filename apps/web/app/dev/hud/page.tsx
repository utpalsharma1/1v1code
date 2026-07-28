"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import {
  Button,
  ClutchEdge,
  Countdown,
  EmoteStream,
  EmoteWheel,
  MatchHUD,
  MotionTuningProvider,
  ProblemPanel,
  QueueCard,
  QueuePop,
  ShakeStage,
  VerdictPanel,
  VictoryOverlay,
  cn,
  useMotion,
  useMotionTuning,
  useScreenShake,
  type Side,
} from "@1v1/ui";
import { TuningPanel } from "./TuningPanel";
import { TOTAL_TESTS, useMatchSim } from "./useMatchSim";

export default function HudDevPage() {
  return (
    <MotionTuningProvider>
      <Simulator />
    </MotionTuningProvider>
  );
}

const PROBLEM = {
  title: "Kth Smallest In Two Sorted Arrays",
  rating: 1540,
  statement: `Given two sorted integer arrays a and b, return the k-th smallest value
of their union, 1-indexed.

Constraints
  1 ≤ |a|, |b| ≤ 10^5
  1 ≤ k ≤ |a| + |b|
  -10^9 ≤ a[i], b[i] ≤ 10^9

A solution in O(log(|a|+|b|)) exists. O(|a|+|b|) will pass the
sample set but time out on the hidden tests.`,
};

function Simulator() {
  const sim = useMatchSim();
  const m = useMotion();
  const { speed, setSpeed } = useMotionTuning();
  const { controls, fire } = useScreenShake();

  // The simulator's speed and the motion system's speed are the same control.
  // Depend on the setter, not on `sim` — the hook returns a fresh object every
  // render, which would re-fire this effect forever.
  const { setSpeed: setSimSpeed } = sim;
  useEffect(() => {
    setSimSpeed(speed);
  }, [speed, setSimSpeed]);

  const p1Progress = sim.p1.cells.filter((c) => c === "pass").length / TOTAL_TESTS;
  const p2Progress = sim.p2.cells.filter((c) => c === "pass").length / TOTAL_TESTS;

  const beat = {
    queue: () => sim.enterQueue(),
    pop: async () => {
      await sim.queuePop();
      fire(m.shake.light, 180);
    },
    countdown: () => sim.countdown(),
    compileP1: () => sim.compile("p1"),
    compileP2: () => sim.compile("p2"),
    passP1: () => sim.passTest("p1"),
    passP2: () => sim.passTest("p2"),
    failP1: () => sim.failTest("p1"),
    clutch8: () => sim.clutch("p2", 8),
    clutch9: () => sim.clutch("p2", 9),
    nearMiss: () => sim.nearMiss("p2"),
    submitPass: async () => {
      await sim.submit("p1", "pass");
      fire(m.shake.hard, 220);
    },
    submitFail: () => sim.submit("p1", "fail"),
    victory: () => {
      sim.showVictory("p1", false);
      fire(m.shake.hard, 260);
    },
    defeat: () => sim.showVictory("p2", false),
    rankUp: () => {
      sim.showVictory("p1", true);
      fire(m.shake.hard, 260);
    },
    playAll: () => sim.playAll(),
    reset: () => sim.reset(),
  };

  return (
    <div className="flex min-h-dvh max-xl:flex-col">
      {/* ── Stage ───────────────────────────────────────────────────── */}
      <ShakeStage controls={controls} className="relative flex min-w-0 flex-1 flex-col">
        <MatchHUD
          p1={{
            handle: "arjun_dev",
            rating: 1442,
            tier: "gold",
            division: "II",
            ...sim.p1,
            plate: sim.victory?.winner === "p1" ? "winner" : sim.victory ? "loser" : "active",
          }}
          p2={{
            handle: "rohan_x",
            rating: 1478,
            tier: "platinum",
            division: "IV",
            ...sim.p2,
            plate: sim.victory?.winner === "p2" ? "winner" : sim.victory ? "loser" : "active",
          }}
          totalTests={TOTAL_TESTS}
          clockMs={sim.clockMs}
          clockPending={sim.clockPending}
          won={{ p1: 1, p2: 0 }}
        />

        <main className="grid min-h-0 flex-1 grid-cols-[1fr_minmax(280px,360px)_1fr] gap-3 p-3 max-lg:grid-cols-1">
          <FakeEditor side="p1" handle="arjun_dev" in={sim.editorsIn} dim={!!sim.verdict} />
          <ProblemPanel
            title={PROBLEM.title}
            rating={PROBLEM.rating}
            statement={PROBLEM.statement}
            revealed={sim.problemRevealed}
            className="max-lg:order-first"
          />
          <FakeEditor side="p2" handle="rohan_x" in={sim.editorsIn} dim={!!sim.verdict} />
        </main>

        <ClutchEdge side="p1" progress={p1Progress} />
        <ClutchEdge side="p2" progress={p2Progress} />
        <EmoteStream emotes={sim.emotes} />
        <EmoteWheel onSend={(e) => sim.sendEmote(e, "p1")} />

        <AnimatePresence>
          {sim.overlay === "queue" && (
            <motion.div
              key="queue"
              className="fixed inset-0 z-40 grid place-items-center p-6"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className="absolute inset-0 bg-[var(--scrim)]" />
              <div className="relative w-full max-w-md">
                <QueueCard
                  rating={1442}
                  tier="gold"
                  division="II"
                  onCancel={() => sim.setOverlay(null)}
                />
              </div>
            </motion.div>
          )}

          {sim.overlay === "pop" && (
            <QueuePop
              key="pop"
              p1={{
                handle: "arjun_dev",
                rating: 1442,
                tier: "gold",
                division: "II",
                accepted: sim.p1.accepted,
              }}
              p2={{
                handle: "rohan_x",
                rating: 1478,
                tier: "platinum",
                division: "IV",
                accepted: sim.p2.accepted,
              }}
              head2head="4–6 vs @rohan_x"
              flashKey={sim.p1.flashKey}
            />
          )}

          {sim.overlay === "verdict" && sim.verdict && (
            <VerdictPanel
              key="verdict"
              side={sim.verdict.side}
              cells={sim.verdict.cells}
              failedIndex={sim.verdict.failedIndex}
              outcome={sim.verdict.outcome}
              burstKey={sim.verdict.burstKey}
            />
          )}

          {sim.overlay === "victory" && sim.victory && (
            <VictoryOverlay
              key="victory"
              winner={sim.victory.winner}
              ratingFrom={1442}
              ratingTo={sim.victory.winner === "p1" ? 1458 : 1428}
              burstKey={sim.victory.burstKey}
              rankUp={
                sim.victory.rankUp ? { from: "gold", to: "platinum", division: "IV" } : null
              }
              onRematch={beat.reset}
              onQueue={beat.queue}
              onHub={beat.reset}
              onReplay={beat.reset}
            />
          )}
        </AnimatePresence>

        <Countdown beat={sim.countdownBeat} />
      </ShakeStage>

      {/* ── Control rail ────────────────────────────────────────────── */}
      <aside className="border-line w-[380px] shrink-0 overflow-y-auto border-l bg-ink p-5 max-xl:w-full max-xl:border-t max-xl:border-l-0">
        <header className="mb-5">
          <p className="font-display text-fg-faint text-12 font-bold tracking-[var(--track-hud)] uppercase">
            Phase 1
          </p>
          <h1 className="font-display text-fg mt-1 text-26 leading-none font-extrabold tracking-[var(--track-display)] uppercase">
            Moment simulator
          </h1>
          <p className="text-fg-faint mt-2 text-12 leading-snug">
            Every beat of §6, fired on demand. No networking, no judge — every input is faked.
          </p>
        </header>

        <div className="mb-6 flex flex-col gap-4">
          <div className="flex gap-2">
            <Button variant="solid" tone="player" onClick={beat.playAll} full>
              Play full match
            </Button>
            <Button variant="outline" onClick={beat.reset}>
              Reset
            </Button>
          </div>

          <BeatGroup title="Queue">
            <Beat label="Enter queue" onClick={beat.queue} />
            <Beat label="Queue pop" onClick={beat.pop} />
            <Beat label="Countdown + reveal" onClick={beat.countdown} />
          </BeatGroup>

          <BeatGroup title="In match">
            <Beat label="P1 compile" onClick={beat.compileP1} />
            <Beat label="P2 compile" onClick={beat.compileP2} />
            <Beat label="P1 test pass" onClick={beat.passP1} />
            <Beat label="P1 test fail" onClick={beat.failP1} />
            <Beat label="P2 test pass" onClick={beat.passP2} />
            <Beat label="Clutch 80%" onClick={beat.clutch8} />
            <Beat label="Clutch 90%" onClick={beat.clutch9} />
            <Beat label="Near-miss shatter" onClick={beat.nearMiss} />
            <Beat label="Emote 🔥" onClick={() => sim.sendEmote("🔥", "p2")} />
          </BeatGroup>

          <BeatGroup title="Resolution">
            <Beat label="Submit — pass" onClick={beat.submitPass} />
            <Beat label="Submit — fail" onClick={beat.submitFail} />
          </BeatGroup>

          <BeatGroup title="Endgame">
            <Beat label="Victory" onClick={beat.victory} />
            <Beat label="Defeat" onClick={beat.defeat} />
            <Beat label="Victory + rank-up" onClick={beat.rankUp} />
          </BeatGroup>

          <div>
            <p className="font-display text-fg-faint mb-1.5 text-12 font-bold tracking-[var(--track-hud)] uppercase">
              Sound cues (Phase 4)
            </p>
            <div className="border-line h-24 overflow-y-auto border bg-surface p-2">
              {sim.soundLog.length === 0 ? (
                <p className="text-fg-faint text-12">No cues yet.</p>
              ) : (
                sim.soundLog.map((c) => (
                  <p key={c.id} className="tabular text-fg-dim text-12">
                    ♪ {c.name}
                  </p>
                ))
              )}
            </div>
            <p className="text-fg-faint mt-1 text-12 leading-snug">
              The library is Phase 4, but §6.3 and §6.6 are timed to sound — the cues are logged so
              the timing can still be tuned.
            </p>
          </div>
        </div>

        <TuningPanel />
      </aside>
    </div>
  );
}

function BeatGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-display text-fg-faint mb-1.5 text-12 font-bold tracking-[var(--track-hud)] uppercase">
        {title}
      </p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Beat({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button size="sm" variant="outline" onClick={onClick}>
      {label}
    </Button>
  );
}

/**
 * Stands in for Monaco. §5: the editor is a workspace and stays calm — its
 * content never animates. The panel slides in on reveal and dims/blurs on
 * submit (§6.6), and that is all it ever does.
 */
function FakeEditor({
  side,
  handle,
  in: slidIn,
  dim,
}: {
  side: Side;
  handle: string;
  in: boolean;
  dim: boolean;
}) {
  const m = useMotion();
  const lines = [
    "def kth(a, b, k):",
    "    lo, hi = 0, min(len(a), k)",
    "    while lo < hi:",
    "        mid = (lo + hi) // 2",
    "        if a[mid] < b[k - mid - 1]:",
    "            lo = mid + 1",
    "        else:",
    "            hi = mid",
    "    return max(...)",
  ];

  return (
    <motion.section
      data-side={side}
      className={cn("clip-lean border-line flex min-h-0 flex-col border bg-surface")}
      initial={m.reduced ? { opacity: 0 } : { opacity: 0, x: side === "p1" ? -120 : 120 }}
      animate={
        slidIn
          ? m.reduced
            ? { opacity: 1, filter: dim ? "blur(4px)" : "blur(0px)" }
            : { opacity: dim ? 0.5 : 1, x: 0, filter: dim ? "blur(4px)" : "blur(0px)" }
          : { opacity: 0 }
      }
      transition={m.reduced ? m.t({}) : slidIn ? m.spring.heavy : m.tween(m.dur.fast)}
    >
      <header className="border-line flex items-center justify-between border-b px-3 py-2">
        <span className="font-display text-fg-dim text-12 font-bold tracking-[var(--track-hud)] uppercase">
          {handle}
        </span>
        <span className="text-fg-faint text-12">python3</span>
      </header>
      <pre className="text-fg-dim overflow-auto px-3 py-2 text-12 leading-relaxed">
        {lines.map((l, i) => (
          <div key={i} className="flex gap-3">
            <span className="tabular text-fg-faint w-5 shrink-0 text-right">{i + 1}</span>
            <span className="tabular">{l}</span>
          </div>
        ))}
      </pre>
    </motion.section>
  );
}
