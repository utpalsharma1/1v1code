"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { playCue, type CellState, type Emote, type FloatingEmote, type Side, type Status } from "@1v1/ui";
import { FakeTypist } from "./fakeTyping";

/* ============================================================================
   The Moment Simulator's state (§12 Phase 1)

   No networking, no auth, no judge — every input is faked. This exists so the
   feel of §6 can be tuned by one person, which is the highest-leverage thing in
   the whole build.
   ========================================================================= */

export const TOTAL_TESTS = 10;
export const MATCH_MS = 462_000;

export type Overlay =
  | null
  | "queue"
  | "pop"
  | "countdown"
  | "verdict"
  | "victory";

export interface PlayerSim {
  cells: CellState[];
  status: Status;
  pulse: number[];
  compileKey: number;
  flashKey: number;
  shatterKey: number;
  accepted: boolean;
}

const emptyCells = (): CellState[] => Array<CellState>(TOTAL_TESTS).fill("idle");

function newPlayer(pulse: number[] = []): PlayerSim {
  return {
    cells: emptyCells(),
    status: { kind: "idle" },
    pulse,
    compileKey: 0,
    flashKey: 0,
    shatterKey: 0,
    accepted: false,
  };
}

const PULSE_WINDOW = 60;

export function useMatchSim() {
  // P2 is the spikier typist, so the two traces never look like the same signal.
  const typists = useRef({
    p1: new FakeTypist({ spikiness: 1 }),
    p2: new FakeTypist({ spikiness: 1.5 }),
  });

  const [overlay, setOverlay] = useState<Overlay>(null);
  const [p1, setP1] = useState<PlayerSim>(() =>
    newPlayer(typists.current.p1.history(PULSE_WINDOW)),
  );
  const [p2, setP2] = useState<PlayerSim>(() =>
    newPlayer(typists.current.p2.history(PULSE_WINDOW)),
  );
  const [clockMs, setClockMs] = useState(MATCH_MS);
  const [clockRunning, setClockRunning] = useState(false);
  const [clockPending, setClockPending] = useState(true);
  const [countdownBeat, setCountdownBeat] = useState<3 | 2 | 1 | 0 | null>(null);
  const [problemRevealed, setProblemRevealed] = useState(false);
  const [editorsIn, setEditorsIn] = useState(false);
  const [verdict, setVerdict] = useState<{
    side: Side;
    outcome: "pass" | "fail" | null;
    failedIndex: number | null;
    cells: CellState[];
    burstKey: number;
  } | null>(null);
  const [victory, setVictory] = useState<{
    winner: Side;
    rankUp: boolean;
    burstKey: number;
  } | null>(null);
  const [emotes, setEmotes] = useState<FloatingEmote[]>([]);
  const [soundLog, setSoundLog] = useState<{ id: number; name: string }[]>([]);
  const [speed, setSpeed] = useState(1);

  const speedRef = useRef(speed);
  speedRef.current = speed;
  const seq = useRef(0);
  const cancelled = useRef(false);
  const emoteId = useRef(0);

  /**
   * The full library is Phase 4. A handful of placeholder oscillator tones are
   * pulled forward because §6.3 and §6.6 are timed to rhythm and that cannot be
   * tuned in silence. Cues with no tone yet are still logged.
   */
  const cue = useCallback((name: string) => {
    playCue(name);
    setSoundLog((log) => [{ id: ++seq.current, name }, ...log].slice(0, 14));
  }, []);

  /** Sleep that respects the global speed control. */
  const wait = useCallback(
    (ms: number) =>
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, ms / speedRef.current);
      }),
    [],
  );

  /* ── Clock ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!clockRunning) return;
    const id = window.setInterval(() => {
      setClockMs((v) => Math.max(0, v - 1000));
    }, 1000 / speed);
    return () => window.clearInterval(id);
  }, [clockRunning, speed]);

  /* ── Pulse lines ───────────────────────────────────────────────────
     ~8fps, per §6.4. Bursts and flatlines rather than noise: a long flat
     stretch followed by a burst is the whole point of the graph. */
  useEffect(() => {
    if (overlay !== null && overlay !== "verdict") return;
    const id = window.setInterval(() => {
      const a = typists.current.p1.next();
      const b = typists.current.p2.next();
      setP1((p) => ({ ...p, pulse: [...p.pulse.slice(1), a] }));
      setP2((p) => ({ ...p, pulse: [...p.pulse.slice(1), b] }));
    }, 125 / speed);
    return () => window.clearInterval(id);
  }, [overlay, speed]);

  /* ── Individual beats ──────────────────────────────────────────────── */

  const reset = useCallback(() => {
    cancelled.current = true;
    setOverlay(null);
    setP1(newPlayer(typists.current.p1.history(PULSE_WINDOW)));
    setP2(newPlayer(typists.current.p2.history(PULSE_WINDOW)));
    setClockMs(MATCH_MS);
    setClockRunning(false);
    setClockPending(true);
    setCountdownBeat(null);
    setProblemRevealed(false);
    setEditorsIn(false);
    setVerdict(null);
    setVictory(null);
    setEmotes([]);
    window.setTimeout(() => {
      cancelled.current = false;
    }, 40);
  }, []);

  const enterQueue = useCallback(() => {
    setOverlay("queue");
  }, []);

  const queuePop = useCallback(async () => {
    cue("queue_pop");
    setP1((p) => ({ ...p, accepted: false, flashKey: p.flashKey + 1 }));
    setP2((p) => ({ ...p, accepted: false, flashKey: p.flashKey + 1 }));
    setOverlay("pop");
    await wait(600);
    setP1((p) => ({ ...p, accepted: true }));
    await wait(500);
    setP2((p) => ({ ...p, accepted: true }));
  }, [cue, wait]);

  const countdown = useCallback(async () => {
    setOverlay("countdown");
    for (const beat of [3, 2, 1] as const) {
      setCountdownBeat(beat);
      cue("countdown_tick");
      await wait(800);
    }
    setCountdownBeat(0);
    cue("countdown_tick_final");
    await wait(600);
    setCountdownBeat(null);
    setOverlay(null);
    // §6.3 — editors slide in, problem unfolds, and only then does the clock
    // start. The clock does not run during the reveal.
    setEditorsIn(true);
    setProblemRevealed(true);
    await wait(900);
    setClockPending(false);
    setClockRunning(true);
  }, [cue, wait]);

  const setStatus = useCallback((side: Side, status: Status) => {
    (side === "p1" ? setP1 : setP2)((p) => ({ ...p, status }));
  }, []);

  const passTest = useCallback(
    (side: Side) => {
      cue("test_pass");
      (side === "p1" ? setP1 : setP2)((p) => {
        const cells = [...p.cells];
        const i = cells.findIndex((c) => c === "idle");
        if (i === -1) return p;
        cells[i] = "pass";
        const passed = cells.filter((c) => c === "pass").length;
        return { ...p, cells, status: { kind: "result", passed, total: TOTAL_TESTS } };
      });
    },
    [cue],
  );

  const failTest = useCallback(
    (side: Side) => {
      cue("test_fail");
      (side === "p1" ? setP1 : setP2)((p) => {
        const cells = [...p.cells];
        const i = cells.findIndex((c) => c === "idle");
        if (i === -1) return p;
        cells[i] = "fail";
        return { ...p, cells };
      });
    },
    [cue],
  );

  const compile = useCallback(
    (side: Side) => {
      cue("compile");
      (side === "p1" ? setP1 : setP2)((p) => ({
        ...p,
        compileKey: p.compileKey + 1,
        status: { kind: "compiling" },
      }));
      window.setTimeout(
        () => setStatus(side, { kind: "typing" }),
        700 / speedRef.current,
      );
    },
    [cue, setStatus],
  );

  /** §6.5 — clutch. Fills the opponent to 8/10, then 9/10. */
  const clutch = useCallback(
    (side: Side, level: 8 | 9) => {
      cue("clutch_ambient");
      (side === "p1" ? setP1 : setP2)((p) => {
        const cells = emptyCells().map((_, i): CellState => (i < level ? "pass" : "idle"));
        return { ...p, cells, status: { kind: "result", passed: level, total: TOTAL_TESTS } };
      });
    },
    [cue],
  );

  /** §6.5 — near-miss. The best spectator moment in the product. */
  const nearMiss = useCallback(
    (side: Side) => {
      cue("test_fail");
      (side === "p1" ? setP1 : setP2)((p) => ({
        ...p,
        shatterKey: p.shatterKey + 1,
        status: { kind: "failed" },
      }));
    },
    [cue],
  );

  /** §6.6 — sequential resolution, ~120ms apart. Never batched. */
  const submit = useCallback(
    async (side: Side, outcome: "pass" | "fail") => {
      cue("submit");
      setStatus(side, { kind: "submitted" });
      const failAt = outcome === "fail" ? 6 : -1;
      let cells = emptyCells();
      setVerdict({ side, outcome: null, failedIndex: null, cells, burstKey: 0 });
      setOverlay("verdict");
      await wait(260);

      for (let i = 0; i < TOTAL_TESTS; i++) {
        if (cancelled.current) return;
        cells = [...cells];
        if (i === failAt) {
          cells[i] = "fail";
          cue("test_fail");
          setVerdict((v) => (v ? { ...v, cells, outcome: "fail", failedIndex: i } : v));
          await wait(900);
          setOverlay(null);
          setVerdict(null);
          setStatus(side, { kind: "typing" });
          return;
        }
        cells[i] = "pass";
        cue("test_pass");
        setVerdict((v) => (v ? { ...v, cells } : v));
        await wait(120);
      }

      cue("victory_sting");
      setVerdict((v) => (v ? { ...v, outcome: "pass", burstKey: Date.now() } : v));
      (side === "p1" ? setP1 : setP2)((p) => ({
        ...p,
        cells: Array<CellState>(TOTAL_TESTS).fill("pass"),
      }));
    },
    [cue, setStatus, wait],
  );

  const showVictory = useCallback(
    (winner: Side, rankUp = false) => {
      cue(winner === "p1" ? "victory" : "defeat");
      if (rankUp) cue("rank_up");
      setClockRunning(false);
      setOverlay("victory");
      setVictory({ winner, rankUp, burstKey: Date.now() });
    },
    [cue],
  );

  const sendEmote = useCallback(
    (emote: Emote, side: Side = "p1") => {
      cue("emote");
      const id = ++emoteId.current;
      setEmotes((list) => [...list, { id, emote, side }]);
      window.setTimeout(
        () => setEmotes((list) => list.filter((e) => e.id !== id)),
        2400 / speedRef.current,
      );
    },
    [cue],
  );

  /* ── The whole match, end to end ───────────────────────────────────── */
  const playAll = useCallback(async () => {
    reset();
    await wait(120);
    enterQueue();
    await wait(1600);
    await queuePop();
    await wait(1200);
    setOverlay(null);
    await countdown();
    await wait(600);

    compile("p1");
    await wait(900);
    for (let i = 0; i < 4; i++) {
      passTest("p1");
      await wait(500);
    }
    compile("p2");
    await wait(700);
    sendEmote("🔥", "p2");
    await wait(600);

    clutch("p2", 8);
    await wait(1800);
    clutch("p2", 9);
    await wait(1600);

    nearMiss("p2");
    await wait(1600);

    await submit("p1", "fail");
    await wait(900);
    for (let i = 4; i < TOTAL_TESTS; i++) {
      passTest("p1");
      await wait(280);
    }
    await submit("p1", "pass");
    await wait(1400);
    showVictory("p1", true);
  }, [
    reset,
    wait,
    enterQueue,
    queuePop,
    countdown,
    compile,
    passTest,
    clutch,
    nearMiss,
    submit,
    showVictory,
    sendEmote,
  ]);

  return {
    overlay,
    setOverlay,
    p1,
    p2,
    clockMs,
    clockPending,
    clockRunning,
    setClockRunning,
    countdownBeat,
    problemRevealed,
    editorsIn,
    verdict,
    victory,
    emotes,
    soundLog,
    speed,
    setSpeed,
    // beats
    reset,
    enterQueue,
    queuePop,
    countdown,
    compile,
    passTest,
    failTest,
    clutch,
    nearMiss,
    submit,
    showVictory,
    sendEmote,
    setStatus,
    playAll,
  };
}
