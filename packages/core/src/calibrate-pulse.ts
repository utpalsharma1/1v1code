/* ============================================================================
   Re-derive PULSE_FULL_SCALE from real matches, not from a model.

   The constant started as a guess, then became a simulation against Poisson
   keystrokes, and simulation is a decent model rather than a person. Real
   deltas now land in the replay log, so this reads them and reports what the
   candidate scales actually do to real human typing.

   It is a MEASUREMENT TOOL, not a tuner. It prints the numbers and says how
   large the corpus is; it deliberately does not pick a value, because the final
   call is by eye (§13.7) and because a corpus of two matches should not be
   allowed to move a constant with confidence.

   Run with:  pnpm pulse:calibrate
   ========================================================================= */

import { readFileSync, readdirSync } from "node:fs";
import { replayDir } from "./paths.ts";
import { join } from "node:path";
import { PULSE_FALL, PULSE_RISE, PULSE_SAMPLE_MS } from "./pulse.ts";

const CANDIDATES = [1.0, 1.25, 1.5, 2.0, 2.5];

/* SELECTING REAL TYPING, which is not the same as selecting volume.

   The first version of this filter took any side with >= 200 characters
   inserted, and that selected exactly the wrong thing: the probes and browser
   tests paste an entire solution in ONE delta, so they cleared the bar
   instantly and reported 182 chars/sec while the one genuine human session
   (47 characters, typed) was excluded. The corpus was 100% synthetic and the
   headline number was meaningless.

   Human typing is identifiable by its SHAPE, not its size: many batches, each
   carrying about one character. A paste is one batch carrying hundreds. */
const MIN_BATCHES = 40;
/** Mean characters per batch. Typing is ~1; anything much above is machine. */
const MAX_CHARS_PER_BATCH = 4;

interface Sample {
  match: string;
  side: string;
  batches: number;
  chars: number;
  spanMs: number;
  counts: number[];
}

function collect(dir: string): Sample[] {
  const out: Sample[] = [];
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return out;
  }

  for (const file of files) {
    const bySide = new Map<string, { offsetMs: number; inserted: number }[]>();
    let text: string;
    try {
      text = readFileSync(join(dir, file), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line.includes('"editor.delta"')) continue;
      try {
        const event = JSON.parse(line) as {
          offsetMs: number;
          type: string;
          payload: { side: string; inserted: number };
        };
        if (event.type !== "editor.delta") continue;
        const list = bySide.get(event.payload.side) ?? [];
        list.push({ offsetMs: event.offsetMs, inserted: event.payload.inserted });
        bySide.set(event.payload.side, list);
      } catch {
        // A torn final line is normal for an append-only log caught mid-write.
      }
    }

    for (const [side, events] of bySide) {
      if (events.length < 2) continue;
      const first = events[0]!.offsetMs;
      const last = events.at(-1)!.offsetMs;
      const ticks = Math.floor((last - first) / PULSE_SAMPLE_MS) + 1;
      const counts = new Array<number>(ticks).fill(0);
      let chars = 0;
      for (const event of events) {
        counts[Math.floor((event.offsetMs - first) / PULSE_SAMPLE_MS)]! += 1;
        chars += event.inserted;
      }
      out.push({ match: file.slice(0, 8), side, batches: events.length, chars, spanMs: last - first, counts });
    }
  }
  return out;
}

function level(counts: number[], full: number): number[] {
  let value = 0;
  return counts.map((count) => {
    const target = Math.min(1, count / full);
    value += (target - value) * (target > value ? PULSE_RISE : PULSE_FALL);
    return Math.max(0, Math.min(1, value));
  });
}

function stats(series: number[]) {
  const sorted = [...series].sort((a, b) => a - b);
  const n = series.length;
  let jag = 0;
  for (let i = 1; i < n; i += 1) jag += Math.abs(series[i]! - series[i - 1]!);
  return {
    mean: series.reduce((a, b) => a + b, 0) / n,
    p50: sorted[Math.floor(n * 0.5)]!,
    p95: sorted[Math.floor(n * 0.95)]!,
    jag: jag / Math.max(1, n - 1),
    flat: series.filter((v) => v < 0.05).length / n,
    pinned: series.filter((v) => v > 0.95).length / n,
  };
}

const dir = replayDir();
const all = collect(dir);
const human = all.filter(
  (s) => s.batches >= MIN_BATCHES && s.chars / s.batches <= MAX_CHARS_PER_BATCH,
);
const machine = all.filter((s) => !human.includes(s));

console.log(`Replay logs scanned in ${dir}`);
console.log(`  sides with any deltas:        ${all.length}`);
console.log(`  look like human typing:       ${human.length}`);
console.log(`  look machine-generated:       ${machine.length}  (excluded)`);

if (all.length === 0) {
  console.log("\nNo delta records yet. Play a match and re-run.");
  process.exit(0);
}

/* Report the rate first, because it is the assumption the whole model rests on
   and it is the one a single match CAN speak to. */
const active = human.reduce(
  (acc, s) => {
    const nonEmpty = s.counts.filter((c) => c > 0).length;
    return {
      chars: acc.chars + s.chars,
      activeMs: acc.activeMs + nonEmpty * PULSE_SAMPLE_MS,
      totalMs: acc.totalMs + s.counts.length * PULSE_SAMPLE_MS,
    };
  },
  { chars: 0, activeMs: 0, totalMs: 0 },
);
console.log(
  `\nMeasured typing rate while active: ${(active.chars / (active.activeMs / 1000)).toFixed(1)} chars/sec`,
);
console.log(
  `Duty cycle (ticks with any typing): ${((active.activeMs / active.totalMs) * 100).toFixed(0)}%`,
);

if (human.length === 0) {
  console.log(
    "\nNO HUMAN-TYPED SIDES YET. Every logged side looks machine-generated —\n" +
      "probes and browser tests paste whole solutions in one delta. Play a match\n" +
      "by hand and re-run; refusing to report a number is the honest answer here.",
  );
  process.exit(0);
}
const corpus = human;

console.log(`\nCandidate scales over ${corpus.length} side(s):`);
console.log("  scale   mean    p50     p95     jag     <0.05   >0.95");
for (const full of CANDIDATES) {
  const merged = corpus.flatMap((s) => level(s.counts, full));
  const st = stats(merged);
  console.log(
    `  ${full.toFixed(2).padEnd(6)}  ${st.mean.toFixed(3)}  ${st.p50.toFixed(3)}  ${st.p95.toFixed(3)}  ` +
      `${st.jag.toFixed(3)}  ${(st.flat * 100).toFixed(0).padStart(4)}%  ${(st.pinned * 100).toFixed(0).padStart(4)}%`,
  );
}

console.log(
  `\nWhat to look for: ordinary typing mid-range (mean 0.3-0.5), bursts reaching\n` +
    `p95 ~0.9 with little time pinned above 0.95, and pauses still falling below\n` +
    `0.05. A scale that pins the graph leaves a burst nowhere to go; one that is\n` +
    `too high makes working look like idling, which inverts §6.4.`,
);
if (corpus.length < 10) {
  console.log(
    `\nCORPUS IS SMALL (${corpus.length}). This does not yet justify moving the constant —\n` +
      `re-run as matches accumulate.`,
  );
}
