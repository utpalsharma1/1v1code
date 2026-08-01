/* ============================================================================
   pnpm db:timing — is the bank still sound ON THIS HOST?

   Four sessions of work made the bank sound. All of it was measured on one x86
   laptop, and almost none of the conclusions travel:

   - Every problem's 5000 ms limit was set against x86 timings. A correct
     solution that fits in 4 s here could exceed the limit on a slower host,
     which does not merely fail one submission — it silently makes the problem
     HARDER, and §8 calibrates problem ratings against solve rate. The bank
     would mis-rate itself and matchmaking would select wrongly, with nothing
     visibly broken.
   - `gcd-pair`'s subtractive Euclid is recorded in `audit-wrong.ts` as
     ACCEPTABLE rather than a defect, and that record rests entirely on one
     measurement: 0.50 s against a 5000 ms limit. If a host is slow enough that
     the margin closes, a recorded non-defect quietly becomes a live one.

   So the timing facts have to re-derive themselves per host rather than sit in
   a comment. This runs on the current machine and fails if any margin is
   thinner than the threshold below.

   THE MODEL. The judge gives each submission `--cpus 0.5`, so a CPU-bound
   program's wall clock is roughly twice its CPU time. Raw CPU is measured here
   and the effective wall clock the judge would see is derived from it, because
   measuring wall directly on an unloaded host measures the wrong machine.

   THE THRESHOLD: a reference solution may use at most 40% of the time limit in
   effective wall clock — 2.5x headroom.

   Chosen on the following reasoning, not by taste:

   - The move under consideration is x86 to ARM at half a core. ARM Ampere is
     roughly 1.3-1.7x slower per clock than this host for scalar integer work,
     so 2x headroom would be spent almost entirely by the move itself, leaving
     nothing for load, noise or a future host.
   - 2.5x absorbs that move and still leaves ~50% margin.
   - Beyond ~3x the threshold starts failing problems that are genuinely fine,
     and a gate that cries wolf is one that gets ignored — the lesson from
     `db:samples` being stricter than the judge.

   The references are PYTHON, which is the slowest correct solution anyone can
   submit. A C++ submission is an order of magnitude faster, so a passing report
   here means every language fits. A failing one means Python submitters are
   locked out of that problem, which is a fairness bug rather than a crash.
   ========================================================================= */

import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROBLEMS } from "./problems.ts";
import { solutionFor } from "./solutions.ts";

/** Every seeded problem uses the schema default. */
const LIMIT_MS = 5000;

/** The judge's `--cpus 0.5` (§11). Wall clock ~= CPU time / quota. */
const CPU_QUOTA = 0.5;

/** A reference may use at most this fraction of the limit. See the header. */
const MAX_FRACTION = 0.4;

interface Measurement {
  cpuMs: number;
  wallMs: number;
  ok: boolean;
  detail: string;
}

/** Runs a command under /usr/bin/time and reports user+sys CPU. */
function measure(argv: string[], input: string): Promise<Measurement> {
  return new Promise((resolve) => {
    const child = spawn("/usr/bin/time", ["-f", "%U %S %e", ...argv]);
    let err = "";
    let killed = false;
    /* A generous ceiling: this is a measurement, not the judge. Anything that
       hits it is catastrophically over the limit and the number does not
       matter. */
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, 120_000);

    child.stdout.on("data", () => undefined);
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", (e) =>
      resolve({ cpuMs: 0, wallMs: 0, ok: false, detail: String(e) }),
    );
    child.on("close", () => {
      clearTimeout(timer);
      if (killed) {
        resolve({ cpuMs: 0, wallMs: 0, ok: false, detail: "did not finish in 120s" });
        return;
      }
      const line = err.trim().split("\n").at(-1) ?? "";
      const m = /^([\d.]+) ([\d.]+) ([\d.]+)$/.exec(line.trim());
      if (!m) {
        resolve({ cpuMs: 0, wallMs: 0, ok: false, detail: `unparsable: ${line}` });
        return;
      }
      resolve({
        cpuMs: (Number(m[1]) + Number(m[2])) * 1000,
        wallMs: Number(m[3]) * 1000,
        ok: true,
        detail: "",
      });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(input);
  });
}

const effectiveWall = (cpuMs: number): number => cpuMs / CPU_QUOTA;

const scratch = mkdtempSync(join(tmpdir(), "1v1-timing-"));
let failures = 0;
const locked: string[] = [];
const softLocked: string[] = [];

console.log(
  `Timing the bank on this host\n` +
    `  limit ${LIMIT_MS} ms per test, judge CPU quota ${CPU_QUOTA}\n` +
    `  a reference may use at most ${(MAX_FRACTION * 100).toFixed(0)}% of the limit ` +
    `(${(1 / MAX_FRACTION).toFixed(1)}x headroom)\n`,
);

console.log(
  "  " +
    "problem".padEnd(32) +
    "input".padStart(9) +
    "cpu ms".padStart(9) +
    "eff wall".padStart(10) +
    "of limit".padStart(10) +
    "  verdict",
);
console.log("  " + "-".repeat(78));

for (const problem of PROBLEMS.slice().sort((a, b) => a.rating - b.rating)) {
  /* The largest test is the one that decides whether the problem fits. */
  const worst = problem.tests.reduce((a, b) => (b.input.length > a.input.length ? b : a));
  const file = join(scratch, `${problem.slug}.py`);
  writeFileSync(file, solutionFor(problem.slug));

  const m = await measure(["python3", file], worst.input);
  if (!m.ok) {
    console.log(`  ${problem.slug.padEnd(32)} ${"—".padStart(46)}  MEASURE FAILED: ${m.detail}`);
    failures += 1;
    continue;
  }
  const eff = effectiveWall(m.cpuMs);
  const frac = eff / LIMIT_MS;
  const over = frac > MAX_FRACTION;

  /* TWO DIFFERENT FAILURES, and conflating them would hide both.

     HOST-THIN  the margin closed because this machine is slower. Actionable:
                re-measure, raise a limit, or do not serve traffic from here.
     LOCKED     the problem is beyond Python at ANY host speed, which is a
                language-parity fact about the constraints and not about the
                machine. Recorded on the problem, so it neither fails the gate
                silently nor disappears. */
  let verdict: string;
  if (!over) verdict = "ok";
  else if (problem.pythonLocked) {
    verdict = `LOCKED (needs ${(frac / MAX_FRACTION).toFixed(1)}x)`;
    locked.push(problem.slug);
  } else {
    verdict = "HOST-THIN";
    failures += 1;
  }
  console.log(
    "  " +
      problem.slug.padEnd(32) +
      `${(worst.input.length / 1024).toFixed(0)}K`.padStart(9) +
      m.cpuMs.toFixed(0).padStart(9) +
      `${eff.toFixed(0)} ms`.padStart(10) +
      `${(frac * 100).toFixed(1)}%`.padStart(10) +
      `  ${verdict}`,
  );

  /* A pythonLocked problem whose TESTS fit is the good state, not an error.

     The note is a claim about the CONSTRAINTS — `coin-change-min` admits target
     10^6 with n = 100, which is 10^8 DP steps and beyond Python whatever we
     seed. The tests are a choice, and choosing not to sit at the worst legal
     point is exactly right: it keeps judge cost down and keeps Python viable
     for every input we actually pose.

     An earlier version of this check demanded the note be REMOVED when the
     tests fit, which would have deleted a true statement about the problem on
     the strength of a measurement that does not bear on it. It also matters for
     §6.8: a hack-phase counter-test may legally supply the worst input even
     though no seeded test does. */
  if (!over && problem.pythonLocked) softLocked.push(problem.slug);
}

/* ---------------------------------------------------------------------------
   Timing claims that are not about references.

   `audit-wrong.ts` records `gcd-pair`'s subtractive Euclid as ACCEPTABLE — not
   a defect — purely because it finishes comfortably inside the limit at the
   worst input the constraints permit. That is a claim about a HOST, and it is
   re-derived here rather than believed.

   If it ever stops holding, the consequence is not a broken build: it means the
   approach has become catchable, and `gcd-pair` should GAIN a test rather than
   keep the exemption. The report says so.
   ------------------------------------------------------------------------ */

const SUBTRACTIVE_EUCLID = `#include <cstdio>
int main(){long long a,b;
 if(scanf("%lld %lld",&a,&b)!=2) return 1;
 while(a!=b){ if(a>b) a-=b; else b-=a; }
 printf("%lld\\n",a); return 0;}
`;

console.log("\n  Timing claims recorded elsewhere in the bank:\n");

const src = join(scratch, "sub.cpp");
const bin = join(scratch, "sub");
writeFileSync(src, SUBTRACTIVE_EUCLID);
const compile = await measure(["g++", "-O2", "-o", bin, src], "");

if (!compile.ok) {
  console.error(`  gcd-pair: could not compile the subtractive Euclid — ${compile.detail}`);
  failures += 1;
} else {
  /* (10^9, 1) is the worst input `1 <= a, b <= 10^9` permits: 10^9 steps. */
  const run = await measure([bin], "1000000000 1\n");
  const eff = effectiveWall(run.cpuMs);
  const inside = eff < LIMIT_MS;
  console.log(
    `  gcd-pair / subtractive Euclid at (10^9, 1)\n` +
      `    compile ${compile.cpuMs.toFixed(0)} ms cpu, run ${run.cpuMs.toFixed(0)} ms cpu\n` +
      `    effective wall ${eff.toFixed(0)} ms against a ${LIMIT_MS} ms limit ` +
      `(${((eff / LIMIT_MS) * 100).toFixed(1)}% of it)\n` +
      `    ${
        inside
          ? "INSIDE the limit — the approach is legitimate here, so no test can catch\n" +
            "    it and audit-wrong's ACCEPTABLE record still holds on this host."
          : "OUTSIDE the limit — audit-wrong's ACCEPTABLE record NO LONGER HOLDS on this\n" +
            "    host. The approach has become catchable, so gcd-pair should gain a test\n" +
            "    at (10^9, 1) and the notADefect entry should be replaced by it."
      }`,
  );
  if (!inside) failures += 1;
}

rmSync(scratch, { recursive: true, force: true });

if (softLocked.length > 0) {
  console.log(
    `\n  Beyond Python by CONSTRAINT but not by any seeded test: ${softLocked.join(", ")}.\n` +
      "  Every input we actually pose is solvable in Python; a legal input exists that is\n" +
      "  not. That is the intended state, and §6.8's hack phase could still supply one.",
  );
}
if (locked.length > 0) {
  console.error(
    `\n  ${locked.length} problem(s) are beyond Python at ANY host speed: ${locked.join(", ")}.\n` +
      "  Each carries a recorded `pythonLocked` reason. This is a real fairness hole —\n" +
      "  §8 selects problems without knowing the player's language, so a Python player\n" +
      "  drawn onto one of these cannot win. The structural fix is per-language time\n" +
      "  limits (a multiplier on the Python side), which is NOT built yet.\n",
  );
}
if (failures === 0) {
  console.log(
    `\n  Every reference fits inside ${(MAX_FRACTION * 100).toFixed(0)}% of the limit on this ` +
      `host (or is a recorded\n  pythonLocked exception), and every recorded timing claim still ` +
      "holds.\n  The bank is sound HERE.",
  );
} else {
  console.error(
    `\n  ${failures} timing problem(s) on this host. A bank that is sound on one machine\n` +
      "  is not sound on another: re-check before serving traffic from it.\n",
  );
}
process.exit(failures === 0 ? 0 : 1);
