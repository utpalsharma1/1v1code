/* ============================================================================
   Seed problem set (Phase 2A)

   20 problems across the five topics in §7's radar, rated 800–2000 on the
   player scale (§8). Ratings are seeded estimates — §8 says they converge on
   real solve data, so treat every number here as a starting guess, not a fact.

   Every problem carries a validatorKey. There is no path to adding one without.
   ========================================================================= */

export type SeedTopic = "DP" | "GRAPHS" | "GREEDY" | "STRINGS" | "MATH";

export interface SeedTest {
  input: string;
  expected: string;
  isSample?: boolean;
}

/* THE CODEFORCES STRUCTURE, and it is not optional.

   A statement without an input format is not a problem, it is a riddle. A
   competitive programmer cannot begin without knowing whether input is space-
   or newline-separated, whether the first line is a count, or whether trailing
   whitespace matters — and guessing costs minutes in an eight-minute match.

   Every field below is required, and `verify-seed.ts` fails the seed if any is
   missing or if a problem has fewer than two samples. That check is the forcing
   function: a problem cannot enter the bank half-written. */
export interface SeedProblem {
  slug: string;
  title: string;
  topic: SeedTopic;
  rating: number;
  validatorKey: string;
  /** The setup and the task. Not the I/O contract — that goes below. */
  statement: string;
  /** Exactly what arrives on stdin, line by line, including any leading count.
   *
   *  OPTIONAL IN THE TYPE, REQUIRED BY `verify-seed`. The 20 seeded problems
   *  predate this format and none of them has it yet, so making it a compile
   *  error would stop the repo building rather than stop bad problems shipping.
   *  `pnpm db:verify` fails while any problem is incomplete, which is the check
   *  that actually matters — and it names every offender rather than the first. */
  inputFormat?: string;
  /** Exactly what to print, including formatting and trailing-whitespace rules. */
  outputFormat?: string;
  /** Every bound, one per entry. STRUCTURED DATA, not markup in a string.
   *
   *  A single string invites divergence — one author writes `1 ≤ n ≤ 10^5`, the
   *  next writes `1 <= n <= 100000`, and the renderer cannot reconcile them
   *  because the formatting is already baked in. As an array the AUTHOR supplies
   *  facts and the RENDERER owns typography, so all 20 look the same by
   *  construction rather than by everyone remembering a convention.
   *
   *  MUST agree with the validator, which is the source of truth — the statement
   *  may not promise something the validator would reject, or §6.8's hack phase
   *  would police a broken promise. One of the original 20 had test data that
   *  violated its own stated constraint, caught by running rather than reading. */
  constraints: string[];
  /** Why each sample produces its output. This is the part that teaches the
   *  format and the part most likely to be skipped. Required by `verify-seed`. */
  note?: string;
  /** WHICH WRONG APPROACH DOES A SAMPLE EXPOSE? Durable, and auditable.
   *
   *  `note` is prose a player reads; this is a one-line claim a reviewer can
   *  check. The two are not the same job: without this, an audit of "do all 20
   *  actually have a discriminating sample" means re-reading twenty paragraphs
   *  and forming an opinion, which is exactly the kind of check that never
   *  happens.
   *
   *  Set it to `null` when a problem genuinely has no plausible wrong approach a
   *  sample can expose — some 800-rated problems are one expression and there is
   *  nothing to discriminate. `null` is an ANSWER, and stating it is the point;
   *  inventing a discriminator to fill the field would be worse than admitting
   *  there isn't one. `verify-seed` requires the field to be present either way. */
  discriminator?: string | null;

  /** WHICH STATED BOUNDS DO NO TEST REACH, AND WHY IS THAT ACCEPTABLE?

   *  Keyed by the bound as `db:coverage` names it — `"n <= 100000"`, `"|s| <=
   *  100000"` — with the reason as the value. A bound with no test reaching it
   *  and no entry here is a gap the coverage gate refuses.
   *
   *  Same shape as `discriminator: null`: it forces the decision to be recorded
   *  instead of letting an omission pass as an oversight. */
  coverageExemptions?: Record<string, string>;

  /** WHY CAN THE REFERENCE LANGUAGE NOT FIT INSIDE THIS PROBLEM'S TIME LIMIT?

   *  `db:timing` measures the Python reference against the largest test and
   *  fails if it needs more than 40% of the limit. A problem may legitimately
   *  be beyond Python — a tight O(target * n) DP at 10^8 steps is a C++
   *  problem whatever we do — but that must be STATED, because §8 hands
   *  problems out without knowing which language the player writes, so a
   *  Python player drawn onto one of these cannot win.
   *
   *  Same shape as `discriminator: null` and `coverageExemptions`: the field
   *  forces the decision to be recorded rather than letting it pass unnoticed.
   *  The structural fix is per-language time limits, which is not built yet. */
  pythonLocked?: string;
  /** Samples (`isSample: true`) are PUBLIC — shown in the statement and run as
   *  the first tests, so a player gets fast feedback on whether they understood
   *  the format. Everything else is hidden. At least two samples are required. */
  tests: SeedTest[];
}

/* GENERATED TEST DATA — the one place "derive, never type" does not protect.

   `db:samples` makes a wrong expected output nearly impossible, because the
   reference computes it. That guarantee is conditional on the INPUT being what
   we meant. Feed the reference a generator's mistake and it faithfully computes
   the right answer to the wrong question: the validator passes (the input is in
   spec, just not the input intended), `db:verify` passes (reference and
   expected agree), and the test is wrong while everything agrees with it. A
   chain of 2000 edges instead of 3000 would sail through every gate we have and
   silently stop testing 32-bit overflow, which is the only reason it exists.

   So a generated input must assert THE PROPERTY IT EXISTS TO TEST, by
   independent arithmetic, never by running a solution. If the reason for the
   test is "the answer exceeds 2^31", then say so in code: 3000 edges times
   10^6 must exceed 2^31, and a generator that emits 2000 fails at import.

   These run at module load, so a broken generator fails everything that touches
   the seed — `db:verify`, `db:seed`, the gateway — rather than producing a
   quietly weaker test set. */
function generated(
  label: string,
  build: () => string,
  properties: Record<string, (input: string) => boolean>,
): string {
  const input = build();
  for (const [name, holds] of Object.entries(properties)) {
    if (!holds(input)) {
      throw new Error(
        `generated test "${label}" does not satisfy "${name}". ` +
          "The generator is wrong, and every gate downstream would have agreed with it.",
      );
    }
  }
  return input;
}

/* A path of 3000 edges at weight 10^6, so the shortest distance is 3*10^9 and
   overflows a signed 32-bit accumulator. Generated because the literal is 51 KB
   — and a generated input is more auditable than a wall of digits, since the
   property it is testing is legible in the lines that build it. */
const EDGES = 3000;
const OVERFLOW_CHAIN = generated(
  "dijkstra 32-bit overflow chain",
  () => {
    const n = EDGES + 1;
    const lines = [`${n} ${EDGES}`];
    for (let i = 1; i < n; i++) lines.push(`${i} ${i + 1} 1000000`);
    lines.push(`1 ${n}`);
    return `${lines.join("\n")}\n`;
  },
  {
    /* THE REASON THE TEST EXISTS, asserted without solving anything. */
    "the true distance exceeds 2^31": () => EDGES * 1_000_000 > 2 ** 31,
    "it is a simple path, so that distance is forced": (input) => {
      const lines = input.trim().split("\n");
      const edges = lines.slice(1, -1);
      return edges.every((line, i) => line === `${i + 1} ${i + 2} 1000000`);
    },
    "the header agrees with the edges written": (input) => {
      const lines = input.trim().split("\n");
      return lines[0] === `${EDGES + 1} ${EDGES}` && lines.length === EDGES + 2;
    },
    "the query runs end to end": (input) =>
      input.trim().split("\n").at(-1) === `1 ${EDGES + 1}`,
  },
);


/* ---------------------------------------------------------------------------
   Max-scale inputs, one per stated bound.

   COVER EACH BOUND WITH THE CHEAPEST TEST THAT REACHES IT, not one giant input
   that reaches several. `longest-common-prefix` permits n = 1000 words of 1000
   characters; posing both at once is a 1 MB test, and posing them separately is
   two 2 KB tests that cover exactly the same two bounds. Coverage asks whether
   each bound is reached, not whether they are reached simultaneously.

   Every one asserts the property it exists to test — see `generated` above.
   ------------------------------------------------------------------------ */

const lines = (input: string): string[] => input.trim().split("\n");
const firstToken = (input: string, index: number): string =>
  lines(input)[0]!.split(" ")[index]!;

/** A word of exactly `n` letters, `vowels` of which are vowels. */
const VOWELS_MAX = generated(
  "count-vowels at |s| = 100000",
  () => `${"ba".repeat(50_000)}\n`,
  {
    "|s| is exactly 100000": (i) => i.trim().length === 100_000,
    "it is lowercase letters only": (i) => /^[a-z]+$/.test(i.trim()),
    "half of them are vowels, so the answer is not degenerate": (i) =>
      (i.trim().match(/[aeiou]/g) ?? []).length === 50_000,
  },
);

const SUBARRAY_MAX = generated(
  "max-subarray-sum at n = 100000 with both value extremes",
  () => {
    const a: number[] = [];
    for (let i = 0; i < 100_000; i++) a.push(i % 2 === 0 ? 1_000_000_000 : -1_000_000_000);
    a[0] = -1_000_000_000;
    a[99_999] = 1_000_000_000;
    return `100000\n${a.join(" ")}\n`;
  },
  {
    "n is exactly 100000": (i) => firstToken(i, 0) === "100000",
    "the array really has n entries": (i) => lines(i)[1]!.split(" ").length === 100_000,
    "it reaches the lower value bound": (i) => i.includes("-1000000000"),
    "it reaches the upper value bound": (i) => lines(i)[1]!.split(" ").includes("1000000000"),
  },
);

const LCP_WIDE = generated(
  "longest-common-prefix at n = 1000",
  () => {
    /* Letters only — the validator rejects digits, and it was right to: the
       first version of this generator emitted `common0` and was refused. */
    /* THREE letters, not two: 999 / 26 is 38, which runs past `z` and emits
       control characters. The generator's own assertion caught that on the very
       next run, which is the entire argument for having them. */
    const letter = (n: number): string =>
      String.fromCharCode(97 + Math.floor(n / 676)) +
      String.fromCharCode(97 + (Math.floor(n / 26) % 26)) +
      String.fromCharCode(97 + (n % 26));
    const words = Array.from({ length: 1000 }, (_, i) => `common${letter(i)}`);
    return `1000\n${words.join("\n")}\n`;
  },
  {
    "n is exactly 1000": (i) => lines(i)[0] === "1000",
    "there are n words after the count": (i) => lines(i).length === 1001,
    "every word is lowercase letters only": (i) =>
      lines(i).slice(1).every((w) => /^[a-z]+$/.test(w)),
    "the words are distinct, so the shared prefix is not accidental": (i) =>
      new Set(lines(i).slice(1)).size === 1000,
  },
);

const LCP_LONG = generated(
  "longest-common-prefix at |word_i| = 1000",
  () => `2\n${"a".repeat(1000)}\n${"a".repeat(999)}b\n`,
  {
    "both words are exactly 1000 long": (i) => lines(i).slice(1).every((w) => w.length === 1000),
    "they differ only at the last character, so the answer is 999": (i) =>
      lines(i)[1]!.slice(0, 999) === lines(i)[2]!.slice(0, 999) && lines(i)[1] !== lines(i)[2],
  },
);

const ACTIVITY_MAX = generated(
  "activity-selection at n = 100000 with end = 10^9",
  () => {
    const out = ["100000"];
    for (let i = 0; i < 99_999; i++) out.push(`${i * 2} ${i * 2 + 1}`);
    out.push(`999999999 1000000000`);
    return `${out.join("\n")}\n`;
  },
  {
    "n is exactly 100000": (i) => lines(i)[0] === "100000",
    "there are n intervals": (i) => lines(i).length === 100_001,
    "one interval ends exactly at the bound": (i) => lines(i).at(-1) === "999999999 1000000000",
    "every interval is well formed (start <= end)": (i) =>
      lines(i).slice(1).every((l) => {
        const [a, b] = l.split(" ").map(Number);
        return a! <= b!;
      }),
  },
);

const COMPONENTS_MAX = generated(
  "connected-components at n = 100000, m = 200000",
  () => {
    const out = ["100000 200000"];
    /* Two edges per vertex pair keeps m at exactly 2*10^5 while leaving the
       component count easy to reason about: one big cycle. */
    for (let i = 1; i <= 100_000; i++) {
      const j = (i % 100_000) + 1;
      out.push(`${i} ${j}`, `${i} ${j}`);
    }
    return `${out.join("\n")}\n`;
  },
  {
    "n is exactly 100000": (i) => firstToken(i, 0) === "100000",
    "m is exactly 200000": (i) => firstToken(i, 1) === "200000",
    "there are m edges after the header": (i) => lines(i).length === 200_001,
    "every vertex is in range": (i) =>
      lines(i).slice(1).every((l) =>
        l.split(" ").every((v) => Number(v) >= 1 && Number(v) <= 100_000),
      ),
  },
);

const KNAPSACK_MAX = generated(
  "fractional-knapsack at n = 100000 with both item bounds",
  () => {
    const out = ["100000 1000000000"];
    for (let i = 0; i < 99_999; i++) out.push(`1 1`);
    out.push("1000000 1000000");
    return `${out.join("\n")}\n`;
  },
  {
    "n is exactly 100000": (i) => firstToken(i, 0) === "100000",
    "capacity is exactly 10^9": (i) => firstToken(i, 1) === "1000000000",
    "there are n items": (i) => lines(i).length === 100_001,
    "one item reaches both value and weight bounds": (i) =>
      lines(i).at(-1) === "1000000 1000000",
  },
);

const COINS_WIDE = generated(
  "coin-change-min at n = 100",
  () => {
    const coins = Array.from({ length: 100 }, (_, i) => i + 1);
    /* target 20000, not 10^6. The bound this test exists to cover is n = 100;
       `target <= 10^6` is covered by the `1 1000000` test, which is a 10^6-step
       DP rather than a 10^8-step one. Sitting at the worst legal point of BOTH
       bounds at once cost 23.5 CPU-seconds in the reference and bought no extra
       coverage. */
    return `100 20000\n${coins.join(" ")}\n`;
  },
  {
    "n is exactly 100": (i) => firstToken(i, 0) === "100",
    "the target is small enough for the reference language to finish": (i) =>
      Number(firstToken(i, 1)) * 100 <= 5_000_000,
    "there are n denominations": (i) => lines(i)[1]!.split(" ").length === 100,
    "every denomination is in range": (i) =>
      lines(i)[1]!.split(" ").every((c) => Number(c) >= 1 && Number(c) <= 1_000_000),
  },
);

const PLATFORMS_MAX = generated(
  "min-platforms at n = 100000 with depart = 10^9",
  () => {
    const out = ["100000"];
    for (let i = 0; i < 99_999; i++) out.push(`${i * 2} ${i * 2 + 1}`);
    out.push("0 1000000000");
    return `${out.join("\n")}\n`;
  },
  {
    "n is exactly 100000": (i) => lines(i)[0] === "100000",
    "there are n trains": (i) => lines(i).length === 100_001,
    "one departure is exactly at the bound": (i) => lines(i).at(-1) === "0 1000000000",
    "every train arrives before it departs": (i) =>
      lines(i).slice(1).every((l) => {
        const [a, b] = l.split(" ").map(Number);
        return a! <= b!;
      }),
  },
);

const BFS_MAX = generated(
  "shortest-path-bfs at n = 100000, m = 200000",
  () => {
    const out = ["100000 200000"];
    for (let i = 1; i < 100_000; i++) out.push(`${i} ${i + 1}`);
    for (let i = 0; i < 100_001; i++) out.push(`1 2`);
    out.push("1 100000");
    return `${out.join("\n")}\n`;
  },
  {
    "n is exactly 100000": (i) => firstToken(i, 0) === "100000",
    "m is exactly 200000": (i) => firstToken(i, 1) === "200000",
    "there are m edges plus the query line": (i) => lines(i).length === 200_002,
    "the path from 1 to n exists and is 99999 hops": (i) =>
      lines(i).slice(1, 100_000).every((l, k) => l === `${k + 1} ${k + 2}`),
  },
);

const TOPO_DAG = generated(
  "topological-order at n = 100000, m = 200000, acyclic",
  () => {
    const out = ["100000 200000"];
    for (let i = 1; i < 100_000; i++) out.push(`${i} ${i + 1}`);
    for (let i = 0; i < 100_001; i++) out.push(`1 100000`);
    return `${out.join("\n")}\n`;
  },
  {
    "n is exactly 100000": (i) => firstToken(i, 0) === "100000",
    "m is exactly 200000": (i) => firstToken(i, 1) === "200000",
    "every edge points from lower to higher, so it MUST be acyclic": (i) =>
      lines(i).slice(1).every((l) => {
        const [u, v] = l.split(" ").map(Number);
        return u! < v!;
      }),
  },
);

const KTH_MAX = generated(
  "kth-smallest-pair at n = 100000",
  () => {
    const a = Array.from({ length: 100_000 }, (_, i) => 100_000 - i);
    return `100000 100000\n${a.join(" ")}\n`;
  },
  {
    "n is exactly 100000": (i) => firstToken(i, 0) === "100000",
    "there are n values": (i) => lines(i)[1]!.split(" ").length === 100_000,
    "k equals n, the far edge of the k range": (i) => firstToken(i, 1) === "100000",
  },
);

const LIS_MAX = generated(
  "longest-increasing-subsequence at n = 100000 with both value extremes",
  () => {
    const a: number[] = [];
    for (let i = 0; i < 100_000; i++) a.push(i % 2 === 0 ? -1_000_000_000 : 1_000_000_000);
    return `100000\n${a.join(" ")}\n`;
  },
  {
    "n is exactly 100000": (i) => lines(i)[0] === "100000",
    "there are n values": (i) => lines(i)[1]!.split(" ").length === 100_000,
    "it reaches both value bounds": (i) =>
      i.includes("-1000000000") && lines(i)[1]!.split(" ").includes("1000000000"),
  },
);

const EDIT_MAX = generated(
  "edit-distance at |a| = |b| = 2000",
  () => `${"a".repeat(2000)}\n${"b".repeat(2000)}\n`,
  {
    "both strings are exactly 2000 long": (i) => lines(i).every((w) => w.length === 2000),
    "they share no character, so the answer is exactly 2000": (i) =>
      new Set(lines(i)[0]).size === 1 &&
      new Set(lines(i)[1]).size === 1 &&
      lines(i)[0]![0] !== lines(i)[1]![0],
  },
);

const PALINDROME_MAX = generated(
  "palindrome-min-cut at |s| = 2000",
  () => `${"ab".repeat(1000)}\n`,
  {
    "|s| is exactly 2000": (i) => i.trim().length === 2000,
    "no two adjacent characters match, so every part is a single letter": (i) =>
      [...i.trim()].every((c, k, all) => k === 0 || c !== all[k - 1]),
  },
);

const EQUALISE_MAX = generated(
  "equalise-cost at n = 100000 with both value extremes",
  () => {
    const a: number[] = [];
    for (let i = 0; i < 100_000; i++) a.push(i % 2 === 0 ? -1_000_000_000 : 1_000_000_000);
    return `100000\n${a.join(" ")}\n`;
  },
  {
    "n is exactly 100000": (i) => lines(i)[0] === "100000",
    "there are n values": (i) => lines(i)[1]!.split(" ").length === 100_000,
    "it reaches both value bounds": (i) =>
      i.includes("-1000000000") && lines(i)[1]!.split(" ").includes("1000000000"),
  },
);

const DIJKSTRA_MAX = generated(
  "dijkstra-shortest at n = 100000, m = 200000",
  () => {
    const out = ["100000 200000"];
    for (let i = 1; i < 100_000; i++) out.push(`${i} ${i + 1} 1000000`);
    for (let i = 0; i < 100_001; i++) out.push(`1 2 1000000`);
    out.push("1 100000");
    return `${out.join("\n")}\n`;
  },
  {
    "n is exactly 100000": (i) => firstToken(i, 0) === "100000",
    "m is exactly 200000": (i) => firstToken(i, 1) === "200000",
    "there are m edges plus the query line": (i) => lines(i).length === 200_002,
    "the answer far exceeds 2^31": () => 99_999 * 1_000_000 > 2 ** 31,
  },
);

export const PROBLEMS: SeedProblem[] = [
  /* ── MATH ───────────────────────────────────────────────────────────── */
  {
    slug: "trailing-zeros",
    title: "Trailing Zeros",
    topic: "MATH",
    rating: 900,
    validatorKey: "single-n-small",
    statement:
      "Consider n factorial — the product 1 x 2 x 3 x ... x n. Written out in " +
      "full it usually ends in a run of zeros.\n\n" +
      "Report how many zeros that run contains. You are not asked for the " +
      "factorial itself, which for n in the thousands has more digits than you " +
      "could print.",
    inputFormat: "One line containing the integer n.",
    outputFormat:
      "Print one integer: how many zeros n! ends with. A trailing newline is " +
      "fine; trailing whitespace is ignored.",
    constraints: ["1 <= n <= 10^6"],
    discriminator:
      "Sample 3 (n = 25) answers 6, not 5, so it rejects counting only the " +
      "multiples of 5 — 25 contributes two factors of five by itself.",
    note:
      "For n = 5, 5! is 120, which ends in one zero.\n\n" +
      "For n = 3, 3! is 6, which ends in none.\n\n" +
      "A zero at the end comes from a factor of 10, and 10 is 2 x 5. Between 1 " +
      "and n there are always more factors of 2 than of 5, so the answer is " +
      "just how many factors of five the product contains.\n\n" +
      "The third sample is where the obvious count fails. Among 1..25 there are " +
      "five multiples of 5, but 25 is 5 x 5 and contributes two. So count the " +
      "multiples of 5, then of 25, then of 125, and so on.\n\n" +
      "n reaches 10^6, so 10^6! cannot be computed — the answer has to come from " +
      "counting factors, not from multiplying.",
    tests: [
      { input: "5\n", expected: "1", isSample: true },
      { input: "3\n", expected: "0", isSample: true },
      { input: "25\n", expected: "6", isSample: true },
      { input: "1\n", expected: "0" },
      { input: "10\n", expected: "2" },
      { input: "1000000\n", expected: "249998" },
    ],
  },

  {
    slug: "equalise-cost",
    title: "Equalise the Array",
    topic: "GREEDY",
    rating: 1200,
    validatorKey: "int-array",
    statement:
      "You are given an array of n integers. In one move you may add 1 to any " +
      "single element, or subtract 1 from it.\n\n" +
      "Report the fewest moves needed to make every element equal. You choose " +
      "what they all end up equal to.",
    inputFormat:
      "The first line contains the integer n.\n" +
      "The second line contains n integers a_1 ... a_n, separated by single spaces.",
    outputFormat:
      "Print one integer: the fewest moves. A trailing newline is fine; " +
      "trailing whitespace is ignored.",
    constraints: ["1 <= n <= 10^5", "-10^9 <= a_i <= 10^9"],
    discriminator:
      "Sample 3 answers 8, so it rejects moving everything to the MEAN: the " +
      "mean of 1, 2, 3, 100 is 26.5 and costs 122 either side of it.",
    note:
      "In the first sample, moving everything to 2 costs 1 + 0 + 1 = 2, and " +
      "nothing is cheaper.\n\n" +
      "The second sample is already equal, so the answer is 0.\n\n" +
      "The third sample is the one that separates the two natural guesses. The " +
      "target that minimises the total distance is the MEDIAN, not the mean — " +
      "moving to 2 costs 1 + 0 + 1 + 98 = 100, while the mean of 26.5 costs far " +
      "more. Intuitively, one far-away value drags the mean but cannot drag the " +
      "median.\n\n" +
      "The total reaches 10^5 x 2 x 10^9, so accumulate in a 64-bit integer.",
    tests: [
      { input: "3\n1 2 3\n", expected: "2", isSample: true },
      { input: "4\n7 7 7 7\n", expected: "0", isSample: true },
      { input: "4\n1 2 3 100\n", expected: "100", isSample: true },
      { input: "1\n5\n", expected: "0" },
      { input: "2\n-1000000000 1000000000\n", expected: "2000000000" },
      { input: "5\n-5 -1 0 1 5\n", expected: "12" },
      { input: "4\n10 10 20 20\n", expected: "20" },
      /* SCALE. Last, because the runner stops at the first failure. */
      { input: EQUALISE_MAX, expected: "100000000000000" },
    ],
  },

  {
    slug: "coin-ways",
    title: "Counting Change",
    topic: "DP",
    rating: 1700,
    validatorKey: "coins-target",
    statement:
      "You have an unlimited supply of coins in each of n denominations. Count " +
      "the number of distinct ways to make exactly `target`.\n\n" +
      "Two ways are the same if they use the same number of each denomination — " +
      "order does not matter, so 1 + 2 and 2 + 1 are one way, not two.\n\n" +
      "The count can be enormous, so report it modulo 1000000007.",
    inputFormat:
      "The first line contains two integers n and target, separated by a space.\n" +
      "The second line contains n integers c_1 ... c_n, the denominations, " +
      "separated by single spaces.",
    outputFormat:
      "Print one integer: the number of distinct ways, modulo 1000000007. A " +
      "trailing newline is fine; trailing whitespace is ignored.",
    constraints: ["1 <= n <= 100", "1 <= target <= 10^6", "1 <= c_i <= 10^6"],
    discriminator:
      "Sample 1 answers 4, not 7, so it rejects looping over the target on the " +
      "outside and the coins on the inside — that counts ORDERINGS, which is a " +
      "different and larger number.",
    note:
      "With coins 1, 2 and 3 and a target of 4 the four ways are 1+1+1+1, " +
      "1+1+2, 2+2 and 1+3. Note that 1+3 and 3+1 are the SAME way.\n\n" +
      "This is the trap the problem exists for. The obvious loop — for each " +
      "total, try every coin — counts 1+3 and 3+1 separately and answers 7. " +
      "Putting the coins on the OUTSIDE and the totals on the inside fixes it: " +
      "each coin is considered once, for all totals, so a combination can only " +
      "be built in the order the coins are iterated.\n\n" +
      "The second sample cannot be made at all, so the answer is 0. The third " +
      "makes 0 from an empty selection, which is one way.\n\n" +
      "Reduce modulo 1000000007 as you go rather than at the end.",
    tests: [
      { input: "3 4\n1 2 3\n", expected: "4", isSample: true },
      { input: "1 7\n5\n", expected: "0", isSample: true },
      { input: "2 10\n2 5\n", expected: "2", isSample: true },
      { input: "1 1000000\n1\n", expected: "1" },
      { input: "4 27\n1 5 10 25\n", expected: "13" },
      { input: "2 12\n3 4\n", expected: "2" },
      { input: "1 1000000\n1000000\n", expected: "1" },
      { input: "3 1000\n7 11 13\n", expected: "515" },
      { input: "100 200\n1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 48 49 50 51 52 53 54 55 56 57 58 59 60 61 62 63 64 65 66 67 68 69 70 71 72 73 74 75 76 77 78 79 80 81 82 83 84 85 86 87 88 89 90 91 92 93 94 95 96 97 98 99 100\n", expected: "546578315" },
    ],
  },

  {
    slug: "sum-of-two",
    title: "Sum Of Two",
    topic: "MATH",
    rating: 800,
    validatorKey: "two-ints",
    statement:
      "You are given two integers. Report what they add up to.\n\n" +
      "This is the smallest problem in the bank and it exists to be a format check: " +
      "if you can read the input and print the answer, your I/O is wired correctly.",
    inputFormat:
      "A single line containing two integers a and b, separated by one space.",
    outputFormat:
      "Print one integer: the sum a + b. A trailing newline is fine; trailing " +
      "whitespace is ignored.",
    constraints: ["-10^9 <= a, b <= 10^9"],
    discriminator: null,
    note:
      "In the first sample, 2 + 3 = 5.\n\n" +
      "The second sample is the reason the bounds are worth reading: both values are " +
      "at the negative limit, so the sum is -2000000000. That still fits in a 64-bit " +
      "integer, but it does not fit in a 32-bit one — in C++, `int` overflows here and " +
      "`long long` does not.",
    tests: [
      { input: "2 3\n", expected: "5\n", isSample: true },
      { input: "-1000000000 -1000000000\n", expected: "-2000000000\n", isSample: true },
      { input: "0 0\n", expected: "0\n" },
      { input: "1000000000 1000000000\n", expected: "2000000000\n" },
      { input: "-5 12\n", expected: "7\n" },
    ],
  },
    {
    slug: "gcd-pair",
    title: "Greatest Common Divisor",
    topic: "MATH",
    rating: 1050,
    validatorKey: "gcd-pair",
    statement:
      "You are given two positive integers a and b. Report the largest integer " +
      "that divides both of them exactly.",
    inputFormat: "One line containing two integers a and b, separated by a space.",
    outputFormat:
      "Print one integer: gcd(a, b). A trailing newline is fine; trailing " +
      "whitespace is ignored.",
    constraints: ["1 <= a, b <= 10^9"],
    /* Genuinely none, and saying so beats inventing one. The wrong approach here
       is trial division up to min(a, b), which produces the RIGHT answer and
       merely takes too long — a sample cannot show elapsed time. The hidden
       tests at 10^9 are what catch it, and they catch it as a timeout. */
    discriminator: null,
    note:
      "In the first sample the divisors common to 12 and 18 are 1, 2, 3 and 6, " +
      "so the answer is 6.\n\n" +
      "In the second sample 7 and 13 are both prime and different, so their only " +
      "common divisor is 1. Note that the answer is never 0: every pair of " +
      "positive integers shares the divisor 1.\n\n" +
      "Both values go up to 10^9, so checking every candidate divisor one at a " +
      "time is far too slow. Use the Euclidean algorithm.",
    tests: [
      { input: "12 18\n", expected: "6", isSample: true },
      { input: "7 13\n", expected: "1", isSample: true },
      { input: "1000000000 500000000\n", expected: "500000000" },
      { input: "1 1\n", expected: "1" },
      { input: "999999937 999999937\n", expected: "999999937" },
      { input: "832040 514229\n", expected: "1" },
    ],
  },
    {
    slug: "fizzbuzz-count",
    title: "Divisible Count",
    topic: "MATH",
    rating: 900,
    validatorKey: "single-n-small",
    statement:
      "Count how many integers from 1 to n inclusive are divisible by 3, by 5, " +
      "or by both.",
    inputFormat: "One line containing the integer n.",
    outputFormat:
      "Print one integer: how many values in [1, n] are divisible by 3 or by 5. " +
      "A trailing newline is fine; trailing whitespace is ignored.",
    constraints: ["1 <= n <= 10^6"],
    discriminator:
      "Sample 1 (n = 15) answers 7, not 8, so it rejects counting multiples of 3 " +
      "and of 5 separately and double-counting the multiples of 15.",
    note:
      "For n = 15 the qualifying numbers are 3, 5, 6, 9, 10, 12 and 15 — seven of " +
      "them. Adding the five multiples of 3 to the three multiples of 5 gives 8, " +
      "which is wrong: 15 is divisible by both and must be counted once.\n\n" +
      "For n = 1 there is nothing to count, so the answer is 0.",
    tests: [
      { input: "15\n", expected: "7", isSample: true },
      { input: "1\n", expected: "0", isSample: true },
      { input: "1000000", expected: "466667" },
      { input: "3\n", expected: "1" },
      { input: "5\n", expected: "2" },
    ],
  },
    {
    slug: "sieve-count",
    title: "Prime Count",
    topic: "MATH",
    rating: 1150,
    validatorKey: "single-n-sieve",
    statement:
      "Count how many prime numbers are less than or equal to n.\n\n" +
      "A prime is an integer greater than 1 whose only positive divisors are 1 " +
      "and itself.",
    inputFormat: "One line containing the integer n.",
    outputFormat:
      "Print one integer: how many primes are at most n. A trailing newline is " +
      "fine; trailing whitespace is ignored.",
    constraints: ["2 <= n <= 10^6"],
    discriminator:
      "Sample 2 (n = 2) answers 1, so it rejects a solution that counts 1 as a " +
      "prime, which would answer 2.",
    note:
      "For n = 10 the primes are 2, 3, 5 and 7, so the answer is 4.\n\n" +
      "For n = 2 the answer is 1: 2 itself is prime, and 1 is not. This is the " +
      "usual off-by-one — a sieve that starts every entry marked prime and only " +
      "crosses out multiples will report 1 as prime unless you exclude it.\n\n" +
      "n goes up to 10^6, so testing each number for primality by trial division " +
      "is too slow. Sieve once over the whole range instead.",
    tests: [
      { input: "10\n", expected: "4", isSample: true },
      { input: "2\n", expected: "1", isSample: true },
      { input: "100\n", expected: "25" },
      { input: "1000000\n", expected: "78498" },
      { input: "9973\n", expected: "1229" },
      { input: "3\n", expected: "2" },
    ],
  },
  {
    slug: "modular-power",
    title: "Modular Exponentiation",
    topic: "MATH",
    rating: 2000,
    validatorKey: "modpow-triple",
    statement:
      "You are given three integers a, b and m. Report the remainder when a " +
      "raised to the power b is divided by m.\n\n" +
      "Treat 0^0 as 1, which is the usual convention.",
    inputFormat:
      "One line containing three integers a, b and m, separated by single spaces.",
    outputFormat:
      "Print one integer: a^b mod m, which is always in the range 0 to m - 1. A " +
      "trailing newline is fine; trailing whitespace is ignored.",
    constraints: ["0 <= a <= 10^9", "0 <= b <= 10^9", "1 <= m <= 2 * 10^9"],
    discriminator:
      "Sample 3 has m = 1 and answers 0, so it rejects special-casing b = 0 with " +
      "a bare `return 1` — every value is 0 modulo 1.",
    note:
      "In the first sample 2^10 is 1024, and 1024 mod 1000 is 24.\n\n" +
      "In the second sample the exponent is 0, so the power is 1 and 1 mod 7 is " +
      "1.\n\n" +
      "The third sample is the edge case. The constraints allow m = 1, and every " +
      "integer is 0 modulo 1 — including 1 itself. So an exponent of 0 does not " +
      "simply mean \"print 1\": it means print 1 mod m. The answer here is 0.\n\n" +
      "Two things about size. b reaches 10^9, so multiplying a by itself b times " +
      "will not finish — use exponentiation by squaring, which needs about 30 " +
      "steps. And m reaches 2 * 10^9, so a product of two values below m reaches " +
      "4 * 10^18: that fits in a signed 64-bit integer but nowhere near a 32-bit " +
      "one. Reduce modulo m after every multiplication.",
    tests: [
      { input: "2 10 1000\n", expected: "24", isSample: true },
      { input: "3 0 7\n", expected: "1", isSample: true },
      { input: "999999937 1000000000 999999999\n", expected: "764693479" },
      { input: "0 5 13\n", expected: "0" },
      { input: "7 1000000000 1000000007\n", expected: "312556845" },
      { input: "123456789 987654321 1000000007\n", expected: "652541198" },
      /* m = 1, where every answer is 0. A solution that special-cases b = 0 and
         returns a bare 1 passed every other test. A sample: the constraints
         permit m = 1 and it is easy to read past. */
      { input: "5 0 1\n", expected: "0", isSample: true },
      { input: "1000000000 1000000000 2000000000\n", expected: "0" },
      { input: "0 0 1000000007\n", expected: "1" },
      { input: "2 1 2000000000\n", expected: "2" },
      { input: "1000000000 0 2000000000\n", expected: "1" },
    ],
  },

  /* ── STRINGS ────────────────────────────────────────────────────────── */
    {
    slug: "count-vowels",
    title: "Count Vowels",
    topic: "STRINGS",
    rating: 820,
    validatorKey: "word",
    statement:
      "You are given a single word made of lowercase English letters. Count how " +
      "many of its letters are vowels.\n\n" +
      "The vowels are exactly a, e, i, o and u.",
    inputFormat: "One line containing the word s, with no spaces.",
    outputFormat:
      "Print one integer: how many letters of s are vowels. A trailing newline " +
      "is fine; trailing whitespace is ignored.",
    constraints: ["1 <= |s| <= 10^5", "s consists of lowercase English letters only"],
    discriminator:
      "Sample 2 (`xyz`) contains a `y` and answers 0, so it rejects the common " +
      "mistake of treating y as a vowel.",
    note:
      "In the first sample, `hello` has `e` and `o`, so the answer is 2.\n\n" +
      "The second sample is `xyz`, and the answer is 0 — note that `y` does NOT " +
      "count. English teaches \"a, e, i, o, u and sometimes y\"; this problem " +
      "means the five letters listed above and nothing else.",
    tests: [
      { input: "hello\n", expected: "2", isSample: true },
      { input: "xyz\n", expected: "0", isSample: true },
      { input: "aeiou\n", expected: "5" },
      { input: "a\n", expected: "1" },
      { input: "bcdfghjklmnpqrstvwxyz\n", expected: "0" },
      /* Every other test uses each vowel at most once, so counting DISTINCT
         vowels with a set passed all five. `banana` is the separation. */
      { input: "banana\n", expected: "3" },
      /* SCALE. Last, because the runner stops at the first failure. */
      { input: VOWELS_MAX, expected: "50000" },
    ],
  },
    {
    slug: "longest-common-prefix",
    title: "Longest Common Prefix",
    topic: "STRINGS",
    rating: 1100,
    validatorKey: "word-list",
    statement:
      "You are given n words. A common prefix is a string that every one of the " +
      "n words starts with.\n\n" +
      "Report the length of the longest common prefix. If the words share no " +
      "first letter, that length is 0.",
    inputFormat:
      "The first line contains the integer n.\n" +
      "Each of the next n lines contains one word.",
    outputFormat:
      "Print one integer: the length of the longest common prefix of all n " +
      "words. A trailing newline is fine; trailing whitespace is ignored.",
    constraints: [
      "1 <= n <= 1000",
      "1 <= |word_i| <= 1000",
      "every word consists of lowercase English letters only",
    ],
    discriminator:
      "Sample 3 has n = 1 and answers 5, so it rejects a solution that compares " +
      "words pairwise and has nothing to compare, or that seeds its prefix at the " +
      "empty string.",
    note:
      "In the first sample all three words begin `fl`, and the third breaks away " +
      "at the next letter, so the answer is 2.\n\n" +
      "In the second sample the two words differ at the very first letter, so the " +
      "answer is 0.\n\n" +
      "The third sample is the edge case: n may be 1. A single word is a prefix of " +
      "itself, so the answer is its full length, 5. Seed the prefix from the first " +
      "word and shrink it against the rest — a solution that seeds it empty, or " +
      "that only ever compares one word against another, answers 0 here.",
    tests: [
      { input: "3\nflower\nflow\nflight\n", expected: "2", isSample: true },
      { input: "2\ndog\ncat\n", expected: "0", isSample: true },
      { input: "1\nalone\n", expected: "5", isSample: true },
      { input: "3\nsame\nsame\nsame\n", expected: "4" },
      { input: "2\nprefix\npre\n", expected: "3" },
      /* SCALE. Last, because the runner stops at the first failure. */
      { input: LCP_WIDE, expected: "6" },
      { input: LCP_LONG, expected: "999" },
    ],
  },
  {
    slug: "edit-distance",
    pythonLocked:
      "|a| = |b| = 2000 is a 4 * 10^6 cell DP, about 3.7 CPU-seconds in Python " +
      "against a limit that allows 2. C++ does it in milliseconds.",
    title: "Edit Distance",
    topic: "STRINGS",
    rating: 1650,
    validatorKey: "two-words",
    statement:
      "You are given two words, a and b. One edit is any of these, applied to a " +
      "single character:\n\n" +
      "- insert a character anywhere,\n" +
      "- delete a character,\n" +
      "- substitute one character for another.\n\n" +
      "Report the fewest edits that turn a into b.",
    inputFormat:
      "The first line contains the word a.\nThe second line contains the word b.",
    outputFormat:
      "Print one integer: the fewest edits that turn a into b. A trailing " +
      "newline is fine; trailing whitespace is ignored.",
    constraints: [
      "1 <= |a| <= 2000",
      "1 <= |b| <= 2000",
      "both words consist of lowercase English letters only",
    ],
    discriminator:
      "Sample 1 (`kitten` to `sitting`) answers 3, so it rejects both a distance " +
      "that only counts substitutions — the words differ in length — and one that " +
      "only inserts and deletes, which needs 5.",
    note:
      "The first sample takes three edits: substitute k for s, substitute e for " +
      "i, then insert g. Two of those are substitutions, and a solution that " +
      "cannot substitute has to delete and re-insert instead, costing 5.\n\n" +
      "The second sample is two identical words, so no edits are needed and the " +
      "answer is 0.\n\n" +
      "The words may have different lengths, so any approach that walks them in " +
      "lockstep and counts mismatches is measuring something else.",
    tests: [
      { input: "kitten\nsitting\n", expected: "3", isSample: true },
      { input: "abc\nabc\n", expected: "0", isSample: true },
      { input: "a\nb\n", expected: "1" },
      { input: "intention\nexecution\n", expected: "5" },
      { input: "abcdef\nazced\n", expected: "3" },
      { input: "a\naaaa\n", expected: "3" },
      { input: "abcd\ndcba\n", expected: "4" },
      { input: "sunday\nsaturday\n", expected: "3" },
      /* SCALE. Last, because the runner stops at the first failure. */
      { input: EDIT_MAX, expected: "2000" },
    ],
  },

  /* ── DP ─────────────────────────────────────────────────────────────── */
    {
    slug: "max-subarray-sum",
    title: "Maximum Subarray Sum",
    topic: "DP",
    rating: 1000,
    validatorKey: "int-array",
    statement:
      "You are given an array of n integers. Consider every contiguous block of " +
      "one or more elements and add up the numbers in it.\n\n" +
      "Report the largest total any such block achieves. The block must not be " +
      "empty.",
    inputFormat:
      "The first line contains the integer n.\n" +
      "The second line contains n integers a_1 … a_n, separated by single spaces.",
    outputFormat:
      "Print one integer: the largest sum of a non-empty contiguous block. A " +
      "trailing newline is fine; trailing whitespace is ignored.",
    constraints: ["1 <= n <= 10^5", "-10^9 <= a_i <= 10^9"],
    discriminator:
      "Sample 2 is all negative and answers -2, so it rejects the common mistake " +
      "of seeding the running best at 0, which would answer 0 by silently " +
      "choosing the empty block. Sample 3 answers 3000000000, which does not " +
      "fit in a 32-bit integer.",
    note:
      "In the first sample the best block is the single element 4, so the answer " +
      "is 4.\n\n" +
      "The second sample is entirely negative. Every block has a negative total, " +
      "and the least bad is the single element -2. A solution that starts its " +
      "answer at 0 reports 0 here, which would mean taking nothing — but the " +
      "block may not be empty.\n\n" +
      "The third sample is a size warning rather than an algorithm one. With n " +
      "up to 10^5 and values up to 10^9 the answer reaches 10^14, so accumulate " +
      "in a 64-bit integer — `long long` in C++, `long` in Java. Python is fine " +
      "as it is.",
    tests: [
      { input: "5\n-2 1 -3 4 -1\n", expected: "4", isSample: true },
      { input: "3\n-5 -2 -8\n", expected: "-2", isSample: true },
      { input: "1\n7\n", expected: "7" },
      { input: "4\n1 2 3 4\n", expected: "10" },
      { input: "6\n-2 -3 4 -1 -2 5\n", expected: "6" },
      /* The answer exceeds 32 bits. No other test's total gets past 10, so an
         `int` accumulator passed the whole set. */
      { input: "3\n1000000000 1000000000 1000000000\n", expected: "3000000000", isSample: true },
      /* SCALE. Last, because the runner stops at the first failure. */
      { input: SUBARRAY_MAX, expected: "2000000000" },
    ],
  },
    {
    slug: "coin-change-min",
    pythonLocked:
      "The worst legal input is target 10^6 with n = 100, which is 10^8 DP steps. " +
      "No Python solution completes that in 5 s and no choice of test data changes " +
      "it — the constraints themselves are beyond the language.",
    title: "Minimum Coins",
    topic: "DP",
    rating: 1400,
    validatorKey: "coins-target",
    statement:
      "You have an unlimited supply of coins in each of n denominations. Choose " +
      "coins adding up to exactly `target`, using as few coins as possible; the " +
      "same denomination may be used any number of times.\n\n" +
      "Report the fewest coins that sum to exactly `target`, or -1 if no " +
      "selection sums to it.",
    inputFormat:
      "The first line contains two integers n and target, separated by a space.\n" +
      "The second line contains n integers c_1 … c_n, the denominations, " +
      "separated by single spaces.",
    outputFormat:
      "Print one integer: the fewest coins summing to exactly `target`, or -1 if " +
      "that is impossible. A trailing newline is fine; trailing whitespace is " +
      "ignored.",
    constraints: ["1 <= n <= 100", "1 <= target <= 10^6", "1 <= c_i <= 10^6"],
    discriminator:
      "Sample 3 answers 2, so it rejects taking the largest coin that fits at " +
      "each step: that greedy takes 4 + 1 + 1 and answers 3. It was ADDED with " +
      "this retrofit — see the note below.",
    note:
      "In the first sample, 5 + 5 + 1 = 11 uses three coins and nothing uses " +
      "two.\n\n" +
      "In the second sample every total reachable with 2s is even, so 3 is " +
      "impossible and the answer is -1.\n\n" +
      "The third sample is the one that matters. Repeatedly taking the largest " +
      "coin that fits gives 4 + 1 + 1, three coins — but 3 + 3 is two. Greedy is " +
      "correct for the coin systems people actually use and wrong in general, so " +
      "it will pass the first two samples and fail here.",
    tests: [
      { input: "3 11\n1 2 5\n", expected: "3", isSample: true },
      { input: "1 3\n2\n", expected: "-1", isSample: true },
      /* ADDED, not promoted. Every other problem in this pass already had its
         discriminating case sitting in the hidden tests and only needed it
         surfaced. This one did not: {1,2,5}, {1,3}, {1} and {1,5,10,25} are all
         canonical systems on which the greedy is OPTIMAL, so the whole test set
         agreed with the wrong algorithm and a greedy submission passed. That is
         a defect in the problem, not in its documentation — the sample is the
         fix's visible half, this test case is the half that has teeth. */
      { input: "3 6\n1 3 4\n", expected: "2", isSample: true },
      { input: "2 6\n1 3\n", expected: "2" },
      { input: "1 1000000\n1\n", expected: "1000000" },
      { input: "4 27\n1 5 10 25\n", expected: "3" },
      { input: "3 7\n4 5 6\n", expected: "-1" },
      /* SCALE. Last, because the runner stops at the first failure. */
      { input: COINS_WIDE, expected: "200" },
    ],
  },
  {
    slug: "longest-increasing-subsequence",
    title: "Longest Increasing Subsequence",
    topic: "DP",
    rating: 1600,
    validatorKey: "int-array",
    statement:
      "You are given an array of n integers. A subsequence is what remains after " +
      "deleting any number of elements (possibly none) without reordering the " +
      "rest — the elements need NOT be next to each other in the original " +
      "array.\n\n" +
      "Report the length of the longest subsequence whose values increase " +
      "STRICTLY: every element must be greater than the one before it, so equal " +
      "values cannot both be used.",
    inputFormat:
      "The first line contains the integer n.\n" +
      "The second line contains n integers a_1 … a_n, separated by single spaces.",
    outputFormat:
      "Print one integer: the length of the longest strictly increasing " +
      "subsequence. A trailing newline is fine; trailing whitespace is ignored.",
    constraints: ["1 <= n <= 10^5", "-10^9 <= a_i <= 10^9"],
    discriminator:
      "Sample 3 (`1 2 2 3 4`) answers 4, so it rejects a solution that allows " +
      "equal values to extend the run — that answers 5.",
    note:
      "In the first sample, `2 5 7` and `2 3 7` both have length 3, and nothing " +
      "longer works. Note that they are not contiguous: this is a subsequence, " +
      "not a block.\n\n" +
      "The second sample is a single element, which is a subsequence of length " +
      "1.\n\n" +
      "The third sample is the one to read carefully. `1 2 2 3 4` contains two " +
      "2s, and only one of them may be used because the increase must be strict. " +
      "The answer is 4, not 5 — a solution built on `<=` instead of `<` answers 5 " +
      "and passes every sample that has no repeated value.\n\n" +
      "With n up to 10^5 an O(n^2) solution will exceed the time limit. The " +
      "standard approach is O(n log n).",
    tests: [
      { input: "6\n10 9 2 5 3 7\n", expected: "3", isSample: true },
      { input: "1\n5\n", expected: "1", isSample: true },
      { input: "5\n5 4 3 2 1\n", expected: "1" },
      { input: "5\n1 2 3 4 5\n", expected: "5" },
      { input: "8\n0 8 4 12 2 10 6 14\n", expected: "4" },
      /* The statement says STRICTLY increasing and not one test contained a
         duplicate, so `<=` passed everything. Here `1 2 2 3 4` is 4, not 5. */
      { input: "5\n1 2 2 3 4\n", expected: "4", isSample: true },
      { input: "4\n7 7 7 7\n", expected: "1" },
      { input: "6\n1 3 2 4 3 5\n", expected: "4" },
      /* SCALE. Last, because the runner stops at the first failure. */
      { input: LIS_MAX, expected: "2" },
    ],
  },
  {
    slug: "kth-smallest-pair",
    title: "Kth Smallest",
    topic: "DP",
    rating: 1540,
    validatorKey: "int-array-k",
    /* NOTE ON THE SLUG. It says "pair" and the problem is about a single array;
       the reference has always been "sort, take the k-th". The slug is wrong and
       is deliberately NOT being changed here: it is the primary key in Postgres,
       it appears in the seeded rows, in match history and in any replay log
       already on disk, so renaming it is a migration rather than an edit. The
       TITLE is what a player reads, and that is correct. */
    statement:
      "You are given an array of n integers. If you sorted it from smallest to " +
      "largest, some value would sit in position k.\n\n" +
      "Report that value. Positions are counted from 1, so k = 1 asks for the " +
      "smallest value. Equal values each occupy their own position: in " +
      "`5 5 5`, every position from 1 to 3 holds 5.",
    inputFormat:
      "The first line contains two integers n and k.\n" +
      "The second line contains n integers a_1 … a_n, separated by single spaces.",
    outputFormat:
      "Print one integer: the k-th smallest value. A trailing newline is fine; " +
      "trailing whitespace is ignored.",
    constraints: ["1 <= n <= 10^5", "1 <= k <= n", "1 <= a_i <= 10^9"],
    discriminator:
      "Sample 1 asks for k = 2 and answers 4, the second smallest — so it rejects " +
      "indexing the sorted array with k directly, which answers 7.",
    note:
      "Sorting the first sample gives `3 4 7 10 20`. Position 2 holds 4.\n\n" +
      "The second sample has one element and asks for position 1, so the answer " +
      "is that element.\n\n" +
      "k counts from 1 and array indices usually count from 0, so the sorted " +
      "array's position k is at index k - 1. Getting that backwards answers 7 on " +
      "the first sample. Note also that duplicates are not collapsed — with " +
      "`9 9 9 1 1 1`, positions 1 to 3 all hold 1.",
    tests: [
      { input: "5 2\n7 10 4 3 20\n", expected: "4", isSample: true },
      { input: "1 1\n42\n", expected: "42", isSample: true },
      { input: "5 5\n1 2 3 4 5\n", expected: "5" },
      { input: "6 3\n9 9 9 1 1 1\n", expected: "1" },
      { input: "4 1\n1000000000 1 500 2\n", expected: "1" },
      { input: "3 2\n5 5 5\n", expected: "5" },
      { input: "2 2\n1000000000 1\n", expected: "1000000000" },
      /* SCALE. Last, because the runner stops at the first failure. */
      { input: KTH_MAX, expected: "100000" },
    ],
  },
  {
    slug: "palindrome-min-cut",
    title: "Palindrome Partitioning",
    topic: "DP",
    rating: 1850,
    validatorKey: "word",
    statement:
      "A palindrome reads the same forwards and backwards; a single letter is " +
      "always one.\n\n" +
      "You are given a lowercase word s. Cut it into consecutive pieces so that " +
      "every piece is a palindrome. Report the fewest cuts needed. If s is " +
      "already a palindrome the answer is 0, and cutting between every pair of " +
      "letters always works, so the answer never exceeds |s| - 1.",
    inputFormat: "One line containing the word s.",
    outputFormat:
      "Print one integer: the fewest cuts. A trailing newline is fine; trailing " +
      "whitespace is ignored.",
    constraints: ["1 <= |s| <= 2000", "s consists of lowercase English letters only"],
    discriminator:
      "Sample 3 (`aaabaa`) answers 1, so it rejects taking the longest " +
      "palindromic prefix at each step: that cuts `aaa|b|aa` and answers 2.",
    note:
      "The first sample cuts `aa|b`, and both pieces are palindromes, so the " +
      "answer is 1.\n\n" +
      "The second sample is a single letter, which is already a palindrome. No " +
      "cuts, so 0.\n\n" +
      "The third sample is where the obvious greedy fails. Taking the longest " +
      "palindromic prefix of `aaabaa` grabs `aaa`, leaving `baa`, which needs two " +
      "more pieces — two cuts in total. The answer is 1: cut after the first " +
      "letter and `a|aabaa` works, because `aabaa` is itself a palindrome. " +
      "Choosing greedily at each step can strand the rest of the word, so the " +
      "cuts have to be chosen together rather than one at a time.",
    tests: [
      { input: "aab\n", expected: "1", isSample: true },
      { input: "a\n", expected: "0", isSample: true },
      { input: "abcde\n", expected: "4" },
      { input: "racecar\n", expected: "0" },
      { input: "abacdc\n", expected: "1" },
      /* Greedy — take the longest palindromic prefix — passed all five earlier
         tests. It cuts `aaa|b|aa` for 2. The answer is `a|aabaa` for 1, so it
         is a sample: a greedy solver sees its own answer contradicted. */
      { input: "aaabaa\n", expected: "1", isSample: true },
      { input: "aaaa\n", expected: "0" },
      { input: "abcbadd\n", expected: "1" },
      { input: "ab\n", expected: "1" },
      /* SCALE. Last, because the runner stops at the first failure. */
      { input: PALINDROME_MAX, expected: "1" },
    ],
  },

  /* ── GREEDY ─────────────────────────────────────────────────────────── */
    {
    slug: "activity-selection",
    title: "Activity Selection",
    topic: "GREEDY",
    rating: 1250,
    validatorKey: "intervals",
    statement:
      "You are given n activities, each with a start time and an end time. You " +
      "can attend two activities if they do not overlap; an activity that ends at " +
      "the exact moment another starts does NOT overlap it.\n\n" +
      "Report the largest number of activities you can attend.",
    inputFormat:
      "The first line contains the integer n.\n" +
      "Each of the next n lines contains two integers start_i and end_i, " +
      "separated by a space.",
    outputFormat:
      "Print one integer: the largest number of pairwise non-overlapping " +
      "activities. A trailing newline is fine; trailing whitespace is ignored.",
    constraints: ["1 <= n <= 10^5", "0 <= start_i <= end_i <= 10^9"],
    discriminator:
      "Sample 3 answers 2, so it rejects the natural wrong greedy of taking " +
      "activities in order of START time: that takes the long `1 10` first and " +
      "answers 1.",
    note:
      "In the first sample, `1 2` and `2 3` can both be attended — they touch but " +
      "do not overlap — and `1 3` clashes with both, so the answer is 2. A " +
      "solution that treats a shared endpoint as an overlap answers 1 here.\n\n" +
      "The second sample shows that an activity may have zero length.\n\n" +
      "The third sample is the one to think about. Sorting by start time takes " +
      "`1 10` first and then nothing else fits, giving 1. The answer is 2: skip " +
      "the long activity and take `2 3` and `4 5`. Sort by END time instead — " +
      "finishing early is what leaves room for what follows.\n\n" +
      "Taking the SHORTEST activity first is the other tempting rule, and it is " +
      "also wrong: one brief activity can straddle the boundary between two long " +
      "ones and block them both.",
    tests: [
      { input: "3\n1 2\n2 3\n1 3\n", expected: "2", isSample: true },
      { input: "1\n0 0\n", expected: "1", isSample: true },
      { input: "3\n1 10\n2 3\n4 5\n", expected: "2", isSample: true },
      { input: "4\n1 3\n2 4\n3 5\n4 6\n", expected: "2" },
      { input: "2\n5 5\n5 5\n", expected: "2" },
      /* The OTHER wrong greedy: shortest activity first. It passed all five
         earlier tests. Here it takes `9 11` and blocks both of the others. */
      { input: "3\n0 10\n9 11\n10 20\n", expected: "2" },
      /* SCALE. Last, because the runner stops at the first failure. */
      { input: ACTIVITY_MAX, expected: "100000" },
    ],
  },
  {
    slug: "min-platforms",
    title: "Minimum Platforms",
    topic: "GREEDY",
    rating: 1400,
    validatorKey: "intervals",
    statement:
      "A station has one platform per train that is present. Each train arrives " +
      "at a time and departs at a later one (or the same one), and it occupies a " +
      "platform for that whole interval, endpoints included.\n\n" +
      "Report the smallest number of platforms the station needs so that every " +
      "train has one for its entire stay.\n\n" +
      "A train departing at time t and another arriving at time t DO overlap: " +
      "both need a platform at t.",
    inputFormat:
      "The first line contains the integer n, the number of trains.\n" +
      "Each of the next n lines contains two integers arrive_i and depart_i, " +
      "separated by a space.",
    outputFormat:
      "Print one integer: the greatest number of trains present at any single " +
      "instant. A trailing newline is fine; trailing whitespace is ignored.",
    constraints: ["1 <= n <= 10^5", "0 <= arrive_i <= depart_i <= 10^9"],
    discriminator:
      "Sample 3 (`1 5` and `5 9`) answers 2, so it rejects the tie-break where a " +
      "departure at time t is processed before an arrival at t — that ordering " +
      "answers 1.",
    note:
      "In the first sample the first two trains overlap between times 2 and 5, so " +
      "two platforms are needed; the third is alone.\n\n" +
      "The second sample has a single train, so the answer is 1.\n\n" +
      "The third sample is the one to be careful with. One train departs at 5 and " +
      "the next arrives at 5. The statement says that counts as an overlap, so the " +
      "answer is 2, not 1. If you sort arrivals and departures into one event " +
      "list, arrivals must come first when the times are equal.",
    tests: [
      { input: "3\n1 5\n2 6\n7 8\n", expected: "2", isSample: true },
      { input: "1\n0 100\n", expected: "1", isSample: true },
      { input: "3\n1 2\n3 4\n5 6\n", expected: "1" },
      { input: "4\n1 10\n1 10\n1 10\n1 10\n", expected: "4" },
      { input: "2\n1 5\n5 9\n", expected: "2", isSample: true },
      { input: "3\n1 3\n2 5\n4 6\n", expected: "2" },
      { input: "2\n0 0\n0 0\n", expected: "2" },
      /* SCALE. Last, because the runner stops at the first failure. */
      { input: PLATFORMS_MAX, expected: "2" },
    ],
  },
    {
    slug: "fractional-knapsack",
    title: "Fractional Knapsack",
    topic: "GREEDY",
    rating: 1350,
    validatorKey: "knapsack-fractional",
    statement:
      "You have a bag that holds a total weight of `capacity`, and n items, each " +
      "with a value and a weight. Unlike the classic knapsack, you may cut an " +
      "item: taking a fraction f of an item costs f of its weight and yields f of " +
      "its value.\n\n" +
      "Report the greatest total value the bag can hold, rounded DOWN to an " +
      "integer.",
    inputFormat:
      "The first line contains two integers n and capacity, separated by a " +
      "space.\n" +
      "Each of the next n lines contains two integers value_i and weight_i, " +
      "separated by a space.",
    outputFormat:
      "Print one integer: the greatest achievable total value, rounded down. A " +
      "trailing newline is fine; trailing whitespace is ignored.",
    constraints: [
      "1 <= n <= 10^5",
      "0 <= capacity <= 10^9",
      "1 <= value_i <= 10^6",
      "1 <= weight_i <= 10^6",
    ],
    discriminator:
      "Sample 3 answers 50, so it rejects a 0/1 knapsack that never cuts an item: " +
      "the only item that fits whole is worth 1.",
    note:
      "In the first sample, take both smaller items whole (60 + 100 for 30 " +
      "weight) and two thirds of the third (80 for the remaining 20), giving " +
      "240.\n\n" +
      "The second sample has a capacity of 0, so nothing fits and the answer is " +
      "0.\n\n" +
      "The third sample is where cutting matters. The first item weighs 10 and " +
      "the bag holds 5, so a solution that only takes whole items has to settle " +
      "for the second item and answers 1. Taking half of the first item yields " +
      "50. Sort by value per unit weight, take the best until the bag is full, " +
      "and cut the last one.\n\n" +
      "Round down at the end, not per item.",
    tests: [
      { input: "3 50\n60 10\n100 20\n120 30\n", expected: "240", isSample: true },
      { input: "1 0\n10 5\n", expected: "0", isSample: true },
      { input: "2 5\n100 10\n1 1\n", expected: "50", isSample: true },
      { input: "1 10\n10 5\n", expected: "10" },
      { input: "2 15\n10 10\n30 10\n", expected: "35" },
      { input: "2 1000000000\n1000000 1000000\n1 1\n", expected: "1000001" },
      /* SCALE. Last, because the runner stops at the first failure. */
      { input: KNAPSACK_MAX, expected: "1099999" },
    ],
  },

  /* ── GRAPHS ─────────────────────────────────────────────────────────── */
  {
    slug: "connected-components",
    title: "Connected Components",
    topic: "GRAPHS",
    rating: 1300,
    validatorKey: "graph",
    statement:
      "You are given an undirected graph with n vertices, numbered 1 through n, and " +
      "m edges. Two vertices are in the same component if you can walk from one to " +
      "the other along edges.\n\n" +
      "Count the components. A vertex with no edges at all is a component on its own.",
    inputFormat:
      "The first line contains two integers n and m, separated by a space: the number " +
      "of vertices and the number of edges.\n" +
      "Each of the next m lines contains two integers u and v, separated by a space, " +
      "describing an undirected edge between u and v.\n" +
      "When m is 0 there are no further lines.\n" +
      "Edges may repeat, and an edge may join a vertex to itself.",
    outputFormat:
      "Print one integer: the number of connected components. A trailing newline is " +
      "fine; trailing whitespace is ignored.",
    constraints: [
      "1 <= n <= 10^5",
      "0 <= m <= 2 * 10^5",
      "1 <= u, v <= n",
    ],
    discriminator:
      "Sample 2 (`4 0`) exposes a solution that only counts vertices appearing " +
      "in the edge list: it prints 0 where the answer is 4.",
    note:
      "In the first sample n is 5 and the edges are 1-2, 2-3 and 4-5. Vertices " +
      "{1, 2, 3} form one component and {4, 5} form another, so the answer is 2.\n\n" +
      "The second sample has n = 4 and m = 0, so there are no edges at all and every " +
      "vertex is its own component: the answer is 4. That case is worth reading " +
      "carefully, because a solution that only counts vertices it has seen in the edge " +
      "list will print 0 here.",
    tests: [
      { input: "5 3\n1 2\n2 3\n4 5\n", expected: "2\n", isSample: true },
      { input: "4 0\n", expected: "4\n", isSample: true },
      { input: "1 0\n", expected: "1\n" },
      { input: "3 3\n1 2\n2 3\n1 3\n", expected: "1\n" },
      { input: "6 3\n1 1\n2 2\n3 4\n", expected: "5\n" },
      { input: "4 4\n1 2\n1 2\n1 2\n3 4\n", expected: "2\n" },
      /* SCALE. Last, because the runner stops at the first failure. */
      { input: COMPONENTS_MAX, expected: "1" },
    ],
  },
  {
    slug: "shortest-path-bfs",
    title: "Shortest Path",
    topic: "GRAPHS",
    rating: 1450,
    validatorKey: "graph-query",
    statement:
      "You are given an undirected graph with n vertices and m edges. Every edge " +
      "costs the same to cross.\n\n" +
      "Report the fewest edges on any route from the source vertex to the target " +
      "vertex, or -1 if no route exists. A vertex reaches itself in 0 edges.",
    inputFormat:
      "The first line contains two integers n and m.\n" +
      "Each of the next m lines contains two integers u and v, an edge joining " +
      "those two vertices.\n" +
      "The last line contains two integers: the source and the target.",
    outputFormat:
      "Print one integer: the fewest edges from source to target, or -1 if the " +
      "target is unreachable. A trailing newline is fine; trailing whitespace is " +
      "ignored.",
    constraints: ["1 <= n <= 10^5", "0 <= m <= 2 * 10^5", "1 <= u, v <= n"],
    discriminator:
      "Sample 3 answers 1 because vertices 1 and 4 are joined directly, so it " +
      "rejects a depth-first search: DFS walks 1-2-3-4 first and answers 3.",
    note:
      "In the first sample the only route from 1 to 4 goes the long way round, so " +
      "the answer is 3.\n\n" +
      "In the second sample there are no edges at all and the target is a " +
      "different vertex, so the answer is -1.\n\n" +
      "The third sample adds the edge 1-4 to that same path. The answer is now 1. " +
      "Searching depth-first finds the route 1-2-3-4 and reports 3, which is a " +
      "valid route but not the shortest one. Breadth-first search is what finds " +
      "the fewest edges, because it reaches every vertex at its own distance " +
      "before going any deeper.",
    tests: [
      { input: "4 3\n1 2\n2 3\n3 4\n1 4\n", expected: "3", isSample: true },
      { input: "2 0\n1 2\n", expected: "-1", isSample: true },
      { input: "1 0\n1 1\n", expected: "0" },
      { input: "5 4\n1 2\n1 3\n2 4\n3 5\n1 5\n", expected: "2" },
      { input: "6 5\n1 2\n2 3\n3 4\n4 5\n5 6\n1 6\n", expected: "5" },
      /* A DFS passed all five earlier tests, because in each of them the first
         branch it explored happened to be a shortest path. Here the direct edge
         1-4 is the answer and DFS walks 1-2-3-4 first. */
      { input: "4 4\n1 2\n2 3\n3 4\n1 4\n1 4\n", expected: "1", isSample: true },
      { input: "3 2\n1 2\n1 3\n2 3\n", expected: "2" },
      /* SCALE. Last, because the runner stops at the first failure. */
      { input: BFS_MAX, expected: "99999" },
    ],
  },
  {
    slug: "topological-order",
    title: "Topological Order Exists",
    topic: "GRAPHS",
    rating: 1500,
    validatorKey: "graph",
    statement:
      "You are given a directed graph with n vertices and m edges; each edge " +
      "points from u to v. A topological order is an arrangement of all n " +
      "vertices in a line such that every edge points forwards along it.\n\n" +
      "Report whether such an order exists. It does exactly when the graph has no " +
      "directed cycle.",
    inputFormat:
      "The first line contains two integers n and m.\n" +
      "Each of the next m lines contains two integers u and v, a directed edge " +
      "from u to v.",
    outputFormat:
      'Print `YES` if a topological order exists, or `NO` if it does not. Case ' +
      "matters. A trailing newline is fine; trailing whitespace is ignored.",
    constraints: ["1 <= n <= 10^5", "0 <= m <= 2 * 10^5", "1 <= u, v <= n"],
    discriminator:
      "Sample 3 is a diamond and answers YES, so it rejects both common bugs at " +
      "once: cycle detection that flags any second visit to a vertex, and cycle " +
      "detection that ignores edge direction. Either answers NO.",
    note:
      "The first sample is a chain, 1 to 2 to 3, which is already in order.\n\n" +
      "The second sample is a three-vertex cycle. No arrangement can point every " +
      "edge forwards, so the answer is NO.\n\n" +
      "The third sample is the one that separates a correct solution from a " +
      "plausible one. Vertex 4 is reached from both 2 and 3, so a depth-first " +
      "search arrives at it twice — but visiting a vertex twice is NOT a cycle, " +
      "and `1 2 3 4` is a perfectly good order. Detecting a cycle needs the " +
      "vertices currently on the recursion stack, not merely the ones already " +
      "seen. Note also that ignoring direction turns this diamond into a loop, " +
      "which is why the answer would flip to NO.",
    tests: [
      { input: "3 2\n1 2\n2 3\n", expected: "YES", isSample: true },
      { input: "3 3\n1 2\n2 3\n3 1\n", expected: "NO", isSample: true },
      { input: "1 0\n", expected: "YES" },
      { input: "2 2\n1 2\n2 1\n", expected: "NO" },
      { input: "4 3\n1 2\n1 3\n1 4\n", expected: "YES" },
      /* THE DIAMOND, and it is a sample because reaching a vertex twice is not
         a cycle — which is exactly what both surviving wrong approaches
         believed. Cycle detection needs the recursion stack, not just a visited
         set, and it has to respect edge direction: undirected, this is a cycle;
         directed, it is a DAG. */
      { input: "4 4\n1 2\n1 3\n2 4\n3 4\n", expected: "YES", isSample: true },
      { input: "4 4\n1 2\n2 3\n3 4\n4 2\n", expected: "NO" },
      /* SCALE. Last, because the runner stops at the first failure. */
      { input: TOPO_DAG, expected: "YES" },
    ],
  },
  {
    slug: "dijkstra-shortest",
    title: "Weighted Shortest Path",
    topic: "GRAPHS",
    rating: 1900,
    validatorKey: "graph-weighted",
    statement:
      "You are given an undirected graph with n vertices and m edges, where each " +
      "edge has a positive weight — the cost of crossing it. The cost of a route " +
      "is the sum of the weights of the edges it uses.\n\n" +
      "Report the cheapest cost from the source vertex to the target vertex, or " +
      "-1 if no route exists. A vertex reaches itself at cost 0.",
    inputFormat:
      "The first line contains two integers n and m.\n" +
      "Each of the next m lines contains three integers u, v and w: an edge " +
      "joining u and v that costs w to cross.\n" +
      "The last line contains two integers: the source and the target.",
    outputFormat:
      "Print one integer: the cheapest total cost, or -1 if the target is " +
      "unreachable. A trailing newline is fine; trailing whitespace is ignored.",
    constraints: [
      "1 <= n <= 10^5",
      "0 <= m <= 2 * 10^5",
      "1 <= u, v <= n",
      "1 <= w <= 10^6",
    ],
    discriminator:
      "Sample 3 answers 5, so it rejects walking to the nearest unvisited " +
      "neighbour at each step: that takes the cheap edge 1-2 first and then has " +
      "to pay 100, answering 101.",
    note:
      "In the first sample, 1 to 2 to 3 to 4 costs 1 + 1 + 2 = 4, which beats " +
      "taking the direct edge 1-3 at cost 5.\n\n" +
      "The second sample has no edges and the target is a different vertex, so " +
      "the answer is -1.\n\n" +
      "The third sample is the trap. From vertex 1 the cheapest edge available " +
      "goes to vertex 2 for 1, but continuing from there costs another 100. " +
      "Going straight to 3 for 5 is better. The rule is not \"always step to the " +
      "nearest neighbour\" — it is to settle whichever vertex in the whole " +
      "frontier is currently cheapest to reach.\n\n" +
      "With up to 2 * 10^5 edges at weight 10^6, a total can reach 2 * 10^11. " +
      "That does not fit in a 32-bit integer, so accumulate distances in a 64-bit " +
      "type — `long long` in C++, `long` in Java.",
    tests: [
      { input: "4 4\n1 2 1\n2 3 1\n1 3 5\n3 4 2\n1 4\n", expected: "4", isSample: true },
      { input: "2 0\n1 2\n", expected: "-1", isSample: true },
      { input: "1 0\n1 1\n", expected: "0" },
      { input: "3 3\n1 2 1000000\n2 3 1000000\n1 3 1\n1 3\n", expected: "1" },
      { input: "5 4\n1 2 3\n2 3 4\n3 4 5\n4 5 6\n1 5\n", expected: "18" },
      /* Walking to the nearest unvisited neighbour costs 101 here and the
         answer is 5. A sample, because "always go to the closest one" is the
         most common way Dijkstra is misremembered. */
      { input: "3 3\n1 2 1\n2 3 100\n1 3 5\n1 3\n", expected: "5", isSample: true },
      /* The statement warns that the total exceeds 32 bits and NO test went
         near it — the largest total in the set was 18. Generated rather than
         written out: it is 3000 lines. */
      { input: OVERFLOW_CHAIN, expected: "3000000000" },
      { input: "3 2\n1 2 1000000\n2 3 1000000\n1 3\n", expected: "2000000" },
      { input: "2 1\n1 2 1\n2 1\n", expected: "1" },
      /* SCALE. Last, because the runner stops at the first failure. */
      { input: DIJKSTRA_MAX, expected: "99999000000" },
    ],
  },
];

/** Fails loudly at seed time rather than at match time. */
export function assertSeedIntegrity(validKeys: readonly string[]): void {
  const problems = new Set<string>();
  for (const p of PROBLEMS) {
    if (problems.has(p.slug)) throw new Error(`duplicate slug ${p.slug}`);
    problems.add(p.slug);
    if (!validKeys.includes(p.validatorKey)) {
      throw new Error(`${p.slug} names unknown validator "${p.validatorKey}"`);
    }
    if (p.rating < 800 || p.rating > 2000) {
      throw new Error(`${p.slug} rating ${p.rating} outside the seeded 800–2000 band`);
    }
    if (p.tests.length < 4) throw new Error(`${p.slug} has fewer than 4 tests`);
    if (!p.tests.some((t) => t.isSample)) throw new Error(`${p.slug} has no sample test`);
  }
}
