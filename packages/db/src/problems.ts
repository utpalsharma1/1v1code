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
  /** Every bound, explicitly. MUST agree with the validator, which is the
   *  source of truth — the statement is not allowed to promise something the
   *  validator would reject, or §6.8's hack phase would police a broken promise. */
  constraints: string;
  /** Why each sample produces its output. This is the part that teaches the
   *  format and the part most likely to be skipped. Required by `verify-seed`. */
  note?: string;
  /** Samples (`isSample: true`) are PUBLIC — shown in the statement and run as
   *  the first tests, so a player gets fast feedback on whether they understood
   *  the format. Everything else is hidden. At least two samples are required. */
  tests: SeedTest[];
}

export const PROBLEMS: SeedProblem[] = [
  /* ── MATH ───────────────────────────────────────────────────────────── */
  {
    slug: "sum-of-two",
    title: "Sum Of Two",
    topic: "MATH",
    rating: 800,
    validatorKey: "two-ints",
    statement:
      "Read two integers a and b on one line and print their sum.\n\nInput: a b\nOutput: a single integer.",
    constraints: "-10^9 <= a, b <= 10^9",
    tests: [
      { input: "2 3\n", expected: "5", isSample: true },
      { input: "-5 5\n", expected: "0", isSample: true },
      { input: "1000000000 1000000000\n", expected: "2000000000" },
      { input: "-1000000000 -1000000000\n", expected: "-2000000000" },
      { input: "0 0\n", expected: "0" },
    ],
  },
  {
    slug: "gcd-pair",
    title: "Greatest Common Divisor",
    topic: "MATH",
    rating: 1050,
    validatorKey: "gcd-pair",
    statement:
      "Print gcd(a, b).\n\nInput: a b\nOutput: a single integer.",
    constraints: "1 <= a, b <= 10^9",
    tests: [
      { input: "12 18\n", expected: "6", isSample: true },
      { input: "7 13\n", expected: "1", isSample: true },
      { input: "1000000000 500000000\n", expected: "500000000" },
      { input: "1 1\n", expected: "1" },
      { input: "999999937 999999937\n", expected: "999999937" },
    ],
  },
  {
    slug: "fizzbuzz-count",
    title: "Divisible Count",
    topic: "MATH",
    rating: 900,
    validatorKey: "single-n-small",
    statement:
      "Count the integers in [1, n] divisible by 3 or 5.\n\nInput: n\nOutput: a single integer.",
    constraints: "1 <= n <= 10^6",
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
      "Count primes less than or equal to n.\n\nInput: n\nOutput: a single integer.\n\nA linear scan of trial divisions will time out at the upper bound.",
    constraints: "2 <= n <= 10^6",
    tests: [
      { input: "10\n", expected: "4", isSample: true },
      { input: "2\n", expected: "1", isSample: true },
      { input: "100\n", expected: "25" },
      { input: "1000000\n", expected: "78498" },
      { input: "9973\n", expected: "1229" },
    ],
  },
  {
    slug: "modular-power",
    title: "Modular Exponentiation",
    topic: "MATH",
    rating: 2000,
    validatorKey: "modpow-triple",
    statement:
      "Print a^b mod m.\n\nInput: a b m\nOutput: a single integer.\n\nb can be 10^9, so repeated multiplication will time out. Intermediate products exceed 32 bits.",
    constraints: "0 <= a, b <= 10^9, 1 <= m <= 2*10^9",
    tests: [
      { input: "2 10 1000\n", expected: "24", isSample: true },
      { input: "3 0 7\n", expected: "1", isSample: true },
      { input: "999999937 1000000000 999999999\n", expected: "764693479" },
      { input: "0 5 13\n", expected: "0" },
      { input: "7 1000000000 1000000007\n", expected: "312556845" },
      { input: "123456789 987654321 1000000007\n", expected: "652541198" },
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
      "Count the vowels (a, e, i, o, u) in s.\n\nInput: a single lowercase word s\nOutput: a single integer.",
    constraints: "1 <= |s| <= 10^5, s consists of lowercase letters",
    tests: [
      { input: "hello\n", expected: "2", isSample: true },
      { input: "xyz\n", expected: "0", isSample: true },
      { input: "aeiou\n", expected: "5" },
      { input: "a\n", expected: "1" },
      { input: "bcdfghjklmnpqrstvwxyz\n", expected: "0" },
    ],
  },
  {
    slug: "longest-common-prefix",
    title: "Longest Common Prefix",
    topic: "STRINGS",
    rating: 1100,
    validatorKey: "word-list",
    statement:
      "Print the length of the longest common prefix of all n words.\n\nInput: n, then n lowercase words, one per line\nOutput: a single integer.",
    constraints: "1 <= n <= 1000, 1 <= |word| <= 1000",
    tests: [
      { input: "3\nflower\nflow\nflight\n", expected: "2", isSample: true },
      { input: "2\ndog\ncat\n", expected: "0", isSample: true },
      { input: "1\nalone\n", expected: "5" },
      { input: "3\nsame\nsame\nsame\n", expected: "4" },
      { input: "2\nprefix\npre\n", expected: "3" },
    ],
  },
  {
    slug: "edit-distance",
    title: "Edit Distance",
    topic: "STRINGS",
    rating: 1650,
    validatorKey: "two-words",
    statement:
      "Print the minimum number of single-character insertions, deletions or substitutions that turn a into b.\n\nInput: a then b, one per line\nOutput: a single integer.",
    constraints: "1 <= |a|, |b| <= 2000, lowercase letters",
    tests: [
      { input: "kitten\nsitting\n", expected: "3", isSample: true },
      { input: "abc\nabc\n", expected: "0", isSample: true },
      { input: "a\nb\n", expected: "1" },
      { input: "intention\nexecution\n", expected: "5" },
      { input: "abcdef\nazced\n", expected: "3" },
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
      "Print the largest sum of any non-empty contiguous subarray.\n\nInput: n, then n integers\nOutput: a single integer.",
    constraints: "1 <= n <= 10^5, -10^9 <= a[i] <= 10^9",
    tests: [
      { input: "5\n-2 1 -3 4 -1\n", expected: "4", isSample: true },
      { input: "3\n-5 -2 -8\n", expected: "-2", isSample: true },
      { input: "1\n7\n", expected: "7" },
      { input: "4\n1 2 3 4\n", expected: "10" },
      { input: "6\n-2 -3 4 -1 -2 5\n", expected: "6" },
    ],
  },
  {
    slug: "coin-change-min",
    title: "Minimum Coins",
    topic: "DP",
    rating: 1400,
    validatorKey: "coins-target",
    statement:
      "Using unlimited coins of the given denominations, print the fewest coins summing exactly to target, or -1 if impossible.\n\nInput: n target, then n denominations\nOutput: a single integer.",
    constraints: "1 <= n <= 100, 1 <= target <= 10^6, 1 <= coin <= 10^6",
    tests: [
      { input: "3 11\n1 2 5\n", expected: "3", isSample: true },
      { input: "1 3\n2\n", expected: "-1", isSample: true },
      { input: "2 6\n1 3\n", expected: "2" },
      { input: "1 1000000\n1\n", expected: "1000000" },
      { input: "4 27\n1 5 10 25\n", expected: "3" },
    ],
  },
  {
    slug: "longest-increasing-subsequence",
    title: "Longest Increasing Subsequence",
    topic: "DP",
    rating: 1600,
    validatorKey: "int-array",
    statement:
      "Print the length of the longest strictly increasing subsequence.\n\nInput: n, then n integers\nOutput: a single integer.\n\nO(n^2) will time out at the upper bound.",
    constraints: "1 <= n <= 10^5, -10^9 <= a[i] <= 10^9",
    tests: [
      { input: "6\n10 9 2 5 3 7\n", expected: "3", isSample: true },
      { input: "1\n5\n", expected: "1", isSample: true },
      { input: "5\n5 4 3 2 1\n", expected: "1" },
      { input: "5\n1 2 3 4 5\n", expected: "5" },
      { input: "8\n0 8 4 12 2 10 6 14\n", expected: "4" },
    ],
  },
  {
    slug: "kth-smallest-pair",
    title: "Kth Smallest",
    topic: "DP",
    rating: 1540,
    validatorKey: "int-array-k",
    statement:
      "Print the k-th smallest element of the array, 1-indexed.\n\nInput: n k, then n integers\nOutput: a single integer.",
    constraints: "1 <= n <= 10^5, 1 <= k <= n, 1 <= a[i] <= 10^9",
    tests: [
      { input: "5 2\n7 10 4 3 20\n", expected: "4", isSample: true },
      { input: "1 1\n42\n", expected: "42", isSample: true },
      { input: "5 5\n1 2 3 4 5\n", expected: "5" },
      { input: "6 3\n9 9 9 1 1 1\n", expected: "1" },
      { input: "4 1\n1000000000 1 500 2\n", expected: "1" },
    ],
  },
  {
    slug: "palindrome-min-cut",
    title: "Palindrome Partitioning",
    topic: "DP",
    rating: 1850,
    validatorKey: "word",
    statement:
      "Print the minimum number of cuts needed to split s so that every part is a palindrome.\n\nInput: a single lowercase word s\nOutput: a single integer.",
    constraints: "1 <= |s| <= 2000, lowercase letters",
    tests: [
      { input: "aab\n", expected: "1", isSample: true },
      { input: "a\n", expected: "0", isSample: true },
      { input: "abcde\n", expected: "4" },
      { input: "racecar\n", expected: "0" },
      { input: "abacdc\n", expected: "1" },
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
      "Given n intervals, print the maximum number that can be chosen with no two overlapping. Touching endpoints do not overlap.\n\nInput: n, then n pairs start end\nOutput: a single integer.",
    constraints: "1 <= n <= 10^5, 0 <= start <= end <= 10^9",
    tests: [
      { input: "3\n1 2\n2 3\n1 3\n", expected: "2", isSample: true },
      { input: "1\n0 0\n", expected: "1", isSample: true },
      { input: "4\n1 3\n2 4\n3 5\n4 6\n", expected: "2" },
      { input: "3\n1 10\n2 3\n4 5\n", expected: "2" },
      { input: "2\n5 5\n5 5\n", expected: "2" },
    ],
  },
  {
    slug: "min-platforms",
    title: "Minimum Platforms",
    topic: "GREEDY",
    rating: 1400,
    validatorKey: "intervals",
    statement:
      "Given n arrival/departure intervals, print the maximum number that overlap at any instant. A train departing at time t and another arriving at t do overlap.\n\nInput: n, then n pairs arrive depart\nOutput: a single integer.",
    constraints: "1 <= n <= 10^5, 0 <= arrive <= depart <= 10^9",
    tests: [
      { input: "3\n1 5\n2 6\n7 8\n", expected: "2", isSample: true },
      { input: "1\n0 100\n", expected: "1", isSample: true },
      { input: "3\n1 2\n3 4\n5 6\n", expected: "1" },
      { input: "4\n1 10\n1 10\n1 10\n1 10\n", expected: "4" },
      { input: "2\n1 5\n5 9\n", expected: "2" },
    ],
  },
  {
    slug: "fractional-knapsack",
    title: "Fractional Knapsack",
    topic: "GREEDY",
    rating: 1350,
    validatorKey: "knapsack-fractional",
    statement:
      "Items may be taken fractionally. Print the maximum total value, rounded down to an integer.\n\nInput: n capacity, then n pairs value weight\nOutput: a single integer.",
    constraints: "1 <= n <= 10^5, 0 <= capacity <= 10^9, 1 <= value, weight <= 10^6",
    tests: [
      { input: "3 50\n60 10\n100 20\n120 30\n", expected: "240", isSample: true },
      { input: "1 0\n10 5\n", expected: "0", isSample: true },
      { input: "1 10\n10 5\n", expected: "10" },
      { input: "2 15\n10 10\n30 10\n", expected: "35" },
      { input: "2 5\n100 10\n1 1\n", expected: "50" },
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
      "Print the number of connected components in an undirected graph.\n\nInput: n m, then m edges u v\nOutput: a single integer.",
    constraints: "1 <= n <= 10^5, 0 <= m <= 2*10^5, 1 <= u, v <= n",
    tests: [
      { input: "5 2\n1 2\n3 4\n", expected: "3", isSample: true },
      { input: "1 0\n", expected: "1", isSample: true },
      { input: "4 4\n1 2\n2 3\n3 4\n4 1\n", expected: "1" },
      { input: "3 0\n", expected: "3" },
      { input: "6 3\n1 2\n2 3\n4 5\n", expected: "3" },
    ],
  },
  {
    slug: "shortest-path-bfs",
    title: "Shortest Path",
    topic: "GRAPHS",
    rating: 1450,
    validatorKey: "graph-query",
    statement:
      "Print the fewest edges from source to target in an unweighted undirected graph, or -1 if unreachable.\n\nInput: n m, then m edges u v, then source target\nOutput: a single integer.",
    constraints: "1 <= n <= 10^5, 0 <= m <= 2*10^5",
    tests: [
      { input: "4 3\n1 2\n2 3\n3 4\n1 4\n", expected: "3", isSample: true },
      { input: "2 0\n1 2\n", expected: "-1", isSample: true },
      { input: "1 0\n1 1\n", expected: "0" },
      { input: "5 4\n1 2\n1 3\n2 4\n3 5\n1 5\n", expected: "2" },
      { input: "6 5\n1 2\n2 3\n3 4\n4 5\n5 6\n1 6\n", expected: "5" },
    ],
  },
  {
    slug: "topological-order",
    title: "Topological Order Exists",
    topic: "GRAPHS",
    rating: 1500,
    validatorKey: "graph",
    statement:
      'Edges are directed from u to v. Print "YES" if a topological order exists, otherwise "NO".\n\nInput: n m, then m edges u v\nOutput: YES or NO.',
    constraints: "1 <= n <= 10^5, 0 <= m <= 2*10^5",
    tests: [
      { input: "3 2\n1 2\n2 3\n", expected: "YES", isSample: true },
      { input: "3 3\n1 2\n2 3\n3 1\n", expected: "NO", isSample: true },
      { input: "1 0\n", expected: "YES" },
      { input: "2 2\n1 2\n2 1\n", expected: "NO" },
      { input: "4 3\n1 2\n1 3\n1 4\n", expected: "YES" },
    ],
  },
  {
    slug: "dijkstra-shortest",
    title: "Weighted Shortest Path",
    topic: "GRAPHS",
    rating: 1900,
    validatorKey: "graph-weighted",
    statement:
      "Print the minimum total weight from source to target in an undirected weighted graph, or -1 if unreachable.\n\nInput: n m, then m edges u v w, then source target\nOutput: a single integer.\n\nTotal path weight can exceed 32 bits.",
    constraints: "1 <= n <= 10^5, 0 <= m <= 2*10^5, 1 <= w <= 10^6",
    tests: [
      { input: "4 4\n1 2 1\n2 3 1\n1 3 5\n3 4 2\n1 4\n", expected: "4", isSample: true },
      { input: "2 0\n1 2\n", expected: "-1", isSample: true },
      { input: "1 0\n1 1\n", expected: "0" },
      { input: "3 3\n1 2 1000000\n2 3 1000000\n1 3 1\n1 3\n", expected: "1" },
      { input: "5 4\n1 2 3\n2 3 4\n3 4 5\n4 5 6\n1 5\n", expected: "18" },
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
