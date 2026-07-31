/* ============================================================================
   pnpm db:coverage — does any test actually REACH each stated bound?

   The wrong-approach audit finds a defective test set only if somebody first
   guesses the right wrong approach. This finds a large subset of the same
   defects mechanically, with nobody guessing anything, because the evidence is
   already written down: the constraints promise a difficulty, and the tests
   either pose it or they do not.

   Two of the eleven defects were exactly this and were visible without any
   knowledge of algorithms at all:

     dijkstra-shortest  says "total path weight can exceed 32 bits".
                        Largest total in its test set: 18.
     longest-increasing-subsequence
                        says STRICTLY increasing.
                        Not one test contained a duplicate.

   A problem that documents a trap and never springs it is worse than one that
   says nothing, because it reads as though it were tested.

   THE EXEMPTION IS THE POINT. A bound with no test reaching it is not
   automatically a bug — `1 <= n` is reached by almost any test, and some upper
   bounds are genuinely impractical to place in a seed file. So a gap is closed
   EITHER by a test that reaches the bound OR by an entry in the problem's
   `coverageExemptions` giving a reason. What is not allowed is silence. This is
   the `discriminator: null` shape: the field forces a decision to be recorded
   rather than permitting an omission to pass unnoticed.
   ========================================================================= */

import { PROBLEMS, type SeedProblem } from "./problems.ts";

/** `10^5`, `2*10^5`, `-10^9`, `1000` — the forms the seed constraints use. */
function parseNumber(text: string): number | null {
  const t = text.trim().replace(/\s+/g, "");
  let m = /^(-?\d+)\*(\d+)\^(\d+)$/.exec(t);
  if (m) return Number(m[1]) * Number(m[2]) ** Number(m[3]);
  m = /^(-?\d+)\^(\d+)$/.exec(t);
  if (m) return Number(m[1]) ** Number(m[2]);
  m = /^-?\d+$/.exec(t);
  if (m) return Number(t);
  return null;
}

interface Bound {
  /** The numeric value a test has to reach. */
  value: number;
  /** What it bounds — `n`, `a_i`, `|s|`. Used only for the report. */
  subject: string;
  /** `lower` bounds are reached from above, `upper` from below. */
  side: "lower" | "upper";
  /** The constraint line it came from, verbatim. */
  source: string;
  /** A `|s|`-style bound is about a LENGTH, not a value. */
  isLength: boolean;
}

/** Pulls every numeric endpoint out of a `x <= y <= z` chain. */
function boundsOf(constraint: string): Bound[] {
  const out: Bound[] = [];
  for (const clause of constraint.split(",")) {
    const parts = clause.split(/<=|</).map((p) => p.trim());
    if (parts.length < 2) continue;

    for (const [i, part] of parts.entries()) {
      const value = parseNumber(part);
      if (value === null) continue;

      /* The subject is whichever neighbouring term is symbolic. A numeric term
         on the left bounds what is to its right, and vice versa. */
      const neighbour = i === 0 ? parts[1] : parts[i - 1];
      if (neighbour === undefined || parseNumber(neighbour) !== null) continue;
      const subject = neighbour.replace(/\s+/g, " ").trim();
      if (subject.length === 0) continue;

      out.push({
        value,
        subject,
        side: i === 0 ? "lower" : "upper",
        source: constraint,
        isLength: /^\|.*\|$/.test(subject),
      });
    }
  }
  return out;
}

/** Every integer token appearing in a test input. */
function tokensOf(input: string): number[] {
  return (input.match(/-?\d+/g) ?? []).map(Number).filter((n) => Number.isFinite(n));
}

/** Lengths a `|x|` bound could plausibly refer to: whole lines, and words. */
function lengthsOf(input: string): number[] {
  const lines = input.split("\n").filter((l) => l.length > 0);
  return [...lines.map((l) => l.trim().length), ...input.trim().split(/\s+/).map((w) => w.length)];
}

interface Gap {
  slug: string;
  rating: number;
  bound: Bound;
  best: number;
}

const gaps: Gap[] = [];
const exempted: Gap[] = [];
let checked = 0;

for (const problem of PROBLEMS.slice().sort((a, b) => a.rating - b.rating) as SeedProblem[]) {
  for (const constraint of problem.constraints) {
    for (const bound of boundsOf(constraint)) {
      checked += 1;

      const observed = problem.tests.flatMap((t) =>
        bound.isLength ? lengthsOf(t.input) : tokensOf(t.input),
      );
      /* REACHED MEANS EXACTLY EQUAL, not "some number got at least this big".

         The first version compared against the largest token in the test, and
         it over-credited in the one direction that matters: it called a bound
         covered when it was not. `max-subarray-sum` states `1 <= n <= 10^5`,
         and adding a test whose VALUES were 10^9 made the checker consider
         `n <= 100000` reached — because 10^9 >= 10^5 and it had no idea which
         token was n.

         Exact matching is both tighter and truer to what a boundary test is:
         to exercise `n <= 100000` you write a test with n = 100000, and the
         token 100000 appears. A 10^9 value no longer satisfies a 10^5 count.

         It is still a heuristic — a 100000 belonging to some other variable
         would credit this bound — but it errs toward reporting a gap that is
         not there, which costs a look, rather than hiding one that is, which
         costs a defect. */
      /* A LOOP, not `Math.max(...observed)`. Spreading blew the call stack the
         moment the scale tests landed — a 100000-element array is more
         arguments than a call frame holds, and it surfaced as a RangeError
         that the gate correctly reported as a failing pass but that had
         nothing to do with coverage. */
      let best = bound.side === "upper" ? -Infinity : Infinity;
      let reached = false;
      for (const value of observed) {
        if (value === bound.value) reached = true;
        if (bound.side === "upper" ? value > best : value < best) best = value;
      }
      if (reached) continue;

      const key = `${bound.subject} ${bound.side === "upper" ? "<=" : ">="} ${bound.value}`;
      const gap: Gap = { slug: problem.slug, rating: problem.rating, bound, best };
      if (problem.coverageExemptions?.[key]) exempted.push(gap);
      else gaps.push(gap);
    }
  }
}

console.log(`Constraint coverage: ${checked} numeric bound(s) across ${PROBLEMS.length} problems\n`);

for (const gap of gaps) {
  const key = `${gap.bound.subject} ${gap.bound.side === "upper" ? "<=" : ">="} ${gap.bound.value}`;
  console.log(`  UNREACHED  ${String(gap.rating).padStart(4)}  ${gap.slug.padEnd(32)} ${key}`);
  console.log(
    `             constraint: "${gap.bound.source}"; ` +
      `the furthest any test goes is ${Number.isFinite(gap.best) ? gap.best : "nothing"}`,
  );
}

if (exempted.length > 0) {
  console.log(`\n${exempted.length} bound(s) exempted with a recorded reason:`);
  for (const gap of exempted) {
    const key = `${gap.bound.subject} ${gap.bound.side === "upper" ? "<=" : ">="} ${gap.bound.value}`;
    const problem = PROBLEMS.find((p) => p.slug === gap.slug) as SeedProblem;
    console.log(`  ${gap.slug.padEnd(32)} ${key} — ${problem.coverageExemptions![key]}`);
  }
}

if (gaps.length === 0) {
  console.log("Every stated bound is reached by a test, or exempted with a reason.");
} else {
  console.error(
    `\n${gaps.length} bound(s) are promised by a statement and never posed by a test.\n` +
      "Add a test that reaches the bound, or record why it cannot be reached in the\n" +
      "problem's `coverageExemptions`. Silence is the one option that is not available.\n",
  );
}

process.exit(gaps.length === 0 ? 0 : 1);
