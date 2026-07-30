/* ============================================================================
   Seed verification

   Reference solutions for every seeded problem, run against every seeded test
   case. Hand-written expected outputs rot silently — two were already wrong on
   first authoring — and a wrong expected output means a correct submission is
   judged WRONG_ANSWER, which is the worst possible bug in a competitive judge.

   Also runs every test input through that problem's validator: a test case the
   validator rejects means the constraints and the data disagree, and the hack
   phase (§6.8) would be policing a contract the problem itself violates.

   Run with:  pnpm --filter @1v1/db verify
   ========================================================================= */

import { PROBLEMS, assertSeedIntegrity, type SeedProblem } from "./problems.ts";
import { VALIDATOR_KEYS, getValidator } from "./validators.ts";

type Solver = (input: string) => string;

const nums = (s: string): number[] =>
  s.trim().split(/\s+/).filter(Boolean).map(Number);
const words = (s: string): string[] => s.trim().split(/\s+/).filter(Boolean);

const SOLVERS: Record<string, Solver> = {
  "sum-of-two": (s) => {
    const [a, b] = nums(s);
    return String(a! + b!);
  },

  "gcd-pair": (s) => {
    let [a, b] = nums(s) as [number, number];
    while (b) [a, b] = [b, a % b];
    return String(a);
  },

  "fizzbuzz-count": (s) => {
    const n = nums(s)[0]!;
    return String(Math.floor(n / 3) + Math.floor(n / 5) - Math.floor(n / 15));
  },

  "sieve-count": (s) => {
    const n = nums(s)[0]!;
    const sieve = new Uint8Array(n + 1);
    let count = 0;
    for (let i = 2; i <= n; i++) {
      if (!sieve[i]) {
        count++;
        for (let j = i * i; j <= n; j += i) sieve[j] = 1;
      }
    }
    return String(count);
  },

  "modular-power": (s) => {
    const [a, b, m] = nums(s).map(BigInt) as [bigint, bigint, bigint];
    let base = a % m;
    let exp = b;
    let acc = 1n % m;
    while (exp > 0n) {
      if (exp & 1n) acc = (acc * base) % m;
      base = (base * base) % m;
      exp >>= 1n;
    }
    return String(acc);
  },

  "count-vowels": (s) => String((s.trim().match(/[aeiou]/g) ?? []).length),

  "longest-common-prefix": (s) => {
    const parts = words(s);
    const list = parts.slice(1);
    let k = 0;
    const first = list[0] ?? "";
    outer: for (; k < first.length; k++) {
      for (const w of list) if (w[k] !== first[k]) break outer;
    }
    return String(k);
  },

  "edit-distance": (s) => {
    const [a, b] = words(s) as [string, string];
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(
          prev[j]! + 1,
          cur[j - 1]! + 1,
          prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
      }
      prev = cur;
    }
    return String(prev[b.length]);
  },

  "max-subarray-sum": (s) => {
    const [, ...a] = nums(s);
    let best = a[0]!;
    let cur = a[0]!;
    for (let i = 1; i < a.length; i++) {
      cur = Math.max(a[i]!, cur + a[i]!);
      best = Math.max(best, cur);
    }
    return String(best);
  },

  "coin-change-min": (s) => {
    const all = nums(s);
    const target = all[1]!;
    const coins = all.slice(2);
    const dp = new Array<number>(target + 1).fill(Infinity);
    dp[0] = 0;
    for (let v = 1; v <= target; v++) {
      for (const c of coins) if (c <= v && dp[v - c]! + 1 < dp[v]!) dp[v] = dp[v - c]! + 1;
    }
    return String(dp[target] === Infinity ? -1 : dp[target]);
  },

  "longest-increasing-subsequence": (s) => {
    const [, ...a] = nums(s);
    const tails: number[] = [];
    for (const v of a) {
      let lo = 0;
      let hi = tails.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (tails[mid]! < v) lo = mid + 1;
        else hi = mid;
      }
      tails[lo] = v;
    }
    return String(tails.length);
  },

  "kth-smallest-pair": (s) => {
    const all = nums(s);
    const k = all[1]!;
    const a = all.slice(2).sort((x, y) => x - y);
    return String(a[k - 1]);
  },

  "palindrome-min-cut": (s) => {
    const str = s.trim();
    const n = str.length;
    const pal = Array.from({ length: n }, () => new Uint8Array(n));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = i; j < n; j++) {
        if (str[i] === str[j] && (j - i < 2 || pal[i + 1]![j - 1])) pal[i]![j] = 1;
      }
    }
    const dp = new Array<number>(n).fill(Infinity);
    for (let j = 0; j < n; j++) {
      if (pal[0]![j]) dp[j] = 0;
      else for (let i = 1; i <= j; i++) if (pal[i]![j]) dp[j] = Math.min(dp[j]!, dp[i - 1]! + 1);
    }
    return String(dp[n - 1]);
  },

  "activity-selection": (s) => {
    const all = nums(s);
    const n = all[0]!;
    const iv: [number, number][] = [];
    for (let i = 0; i < n; i++) iv.push([all[1 + i * 2]!, all[2 + i * 2]!]);
    iv.sort((x, y) => x[1] - y[1]);
    let count = 0;
    let last = -Infinity;
    for (const [start, end] of iv) {
      if (start >= last) {
        count++;
        last = end;
      }
    }
    return String(count);
  },

  "min-platforms": (s) => {
    const all = nums(s);
    const n = all[0]!;
    const events: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      events.push([all[1 + i * 2]!, 1]);
      events.push([all[2 + i * 2]!, -1]);
    }
    // Arrivals sort before departures at equal time: a train departing at t and
    // another arriving at t DO overlap, per the statement.
    events.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    let cur = 0;
    let best = 0;
    for (const [, delta] of events) {
      cur += delta;
      best = Math.max(best, cur);
    }
    return String(best);
  },

  "fractional-knapsack": (s) => {
    const all = nums(s);
    const n = all[0]!;
    let cap = all[1]!;
    const items: [number, number][] = [];
    for (let i = 0; i < n; i++) items.push([all[2 + i * 2]!, all[3 + i * 2]!]);
    items.sort((a, b) => b[0] / b[1] - a[0] / a[1]);
    let total = 0;
    for (const [value, weight] of items) {
      if (cap <= 0) break;
      const take = Math.min(cap, weight);
      total += (value * take) / weight;
      cap -= take;
    }
    return String(Math.floor(total + 1e-9));
  },

  "connected-components": (s) => {
    const all = nums(s);
    const n = all[0]!;
    const m = all[1]!;
    const parent = Array.from({ length: n + 1 }, (_, i) => i);
    const find = (x: number): number => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]!]!;
        x = parent[x]!;
      }
      return x;
    };
    for (let e = 0; e < m; e++) {
      const a = find(all[2 + e * 2]!);
      const b = find(all[3 + e * 2]!);
      if (a !== b) parent[a] = b;
    }
    const roots = new Set<number>();
    for (let v = 1; v <= n; v++) roots.add(find(v));
    return String(roots.size);
  },

  "shortest-path-bfs": (s) => {
    const all = nums(s);
    const n = all[0]!;
    const m = all[1]!;
    const adj: number[][] = Array.from({ length: n + 1 }, () => []);
    for (let e = 0; e < m; e++) {
      const u = all[2 + e * 2]!;
      const v = all[3 + e * 2]!;
      adj[u]!.push(v);
      adj[v]!.push(u);
    }
    const src = all[2 + m * 2]!;
    const dst = all[3 + m * 2]!;
    const dist = new Array<number>(n + 1).fill(-1);
    dist[src] = 0;
    const queue = [src];
    for (let head = 0; head < queue.length; head++) {
      const u = queue[head]!;
      for (const v of adj[u]!) {
        if (dist[v] === -1) {
          dist[v] = dist[u]! + 1;
          queue.push(v);
        }
      }
    }
    return String(dist[dst]);
  },

  "topological-order": (s) => {
    const all = nums(s);
    const n = all[0]!;
    const m = all[1]!;
    const adj: number[][] = Array.from({ length: n + 1 }, () => []);
    const indeg = new Array<number>(n + 1).fill(0);
    for (let e = 0; e < m; e++) {
      const u = all[2 + e * 2]!;
      const v = all[3 + e * 2]!;
      adj[u]!.push(v);
      indeg[v]!++;
    }
    const queue: number[] = [];
    for (let v = 1; v <= n; v++) if (indeg[v] === 0) queue.push(v);
    let seen = 0;
    for (let head = 0; head < queue.length; head++) {
      seen++;
      for (const v of adj[queue[head]!]!) if (--indeg[v]! === 0) queue.push(v);
    }
    return seen === n ? "YES" : "NO";
  },

  "dijkstra-shortest": (s) => {
    const all = nums(s);
    const n = all[0]!;
    const m = all[1]!;
    const adj: [number, number][][] = Array.from({ length: n + 1 }, () => []);
    for (let e = 0; e < m; e++) {
      const u = all[2 + e * 3]!;
      const v = all[3 + e * 3]!;
      const w = all[4 + e * 3]!;
      adj[u]!.push([v, w]);
      adj[v]!.push([u, w]);
    }
    const src = all[2 + m * 3]!;
    const dst = all[3 + m * 3]!;
    const dist = new Array<number>(n + 1).fill(Infinity);
    dist[src] = 0;
    // n is small in the seed set, so an O(n^2) scan is fine as a reference.
    const done = new Array<boolean>(n + 1).fill(false);
    for (let iter = 0; iter < n; iter++) {
      let best = -1;
      for (let v = 1; v <= n; v++) if (!done[v] && (best === -1 || dist[v]! < dist[best]!)) best = v;
      if (best === -1 || dist[best] === Infinity) break;
      done[best] = true;
      for (const [v, w] of adj[best]!) {
        if (dist[best]! + w < dist[v]!) dist[v] = dist[best]! + w;
      }
    }
    return String(dist[dst] === Infinity ? -1 : dist[dst]);
  },
};

function verify(): number {
  assertSeedIntegrity(VALIDATOR_KEYS);

  let failures = 0;
  const note = (message: string) => {
    console.log(`  FAIL ${message}`);
    failures++;
  };

  /* THE FORMAT IS ENFORCED, not encouraged.

   A problem missing its input format, output format, note, or a second sample
   is not solvable as presented, and 20 problems shipped in exactly that state.
   Failing the seed is the forcing function: an incomplete problem cannot enter
   the bank, so the gap cannot accumulate silently again. */
const formatFailures: string[] = [];
for (const problem of PROBLEMS) {
  const missing = (["inputFormat", "outputFormat", "note"] as const).filter(
    (field) => !problem[field] || problem[field].trim().length === 0,
  );
  if (missing.length > 0) {
    formatFailures.push(`${problem.slug}: missing ${missing.join(", ")}`);
  }
  const samples = problem.tests.filter((t) => t.isSample).length;
  if (samples < 2) {
    formatFailures.push(`${problem.slug}: has ${samples} sample(s), needs at least 2`);
  }
  /* The discriminator must be PRESENT, and `null` is a valid answer. Requiring
     presence rather than truthiness is the whole point: it forces the author to
     decide whether a discriminating sample exists, instead of leaving the
     question unasked. */
  if (!("discriminator" in problem)) {
    formatFailures.push(
      `${problem.slug}: missing discriminator (a one-line claim, or null if none exists)`,
    );
  }
}
if (formatFailures.length > 0) {
  console.error("\nPROBLEM FORMAT INCOMPLETE — these are not solvable as presented:");
  for (const f of formatFailures) console.error(`  ${f}`);
  console.error(
    `\n${formatFailures.length} issue(s). Every problem needs a statement, an input format,\n` +
      "an output format, constraints, a note explaining the samples, and >= 2 samples.\n" +
      "Samples are also verified byte-for-byte against the reference solution below.\n",
  );
  /* A HARD exit, not `exitCode`. The final `process.exit(failures === 0 …)`
     below overwrote it, which made this check advisory — it printed a wall of
     real problems and then reported success. An incomplete problem set must
     stop the seed, and reporting it while exiting 0 is the same class of bug as
     a green tick on a meaningless result. */
  process.exit(1);
}

for (const problem of PROBLEMS as SeedProblem[]) {
    const solver = SOLVERS[problem.slug];
    const validate = getValidator(problem.validatorKey);
    const marks: string[] = [];

    if (!solver) {
      note(`${problem.slug}: no reference solution`);
      continue;
    }

    for (const [i, test] of problem.tests.entries()) {
      const check = validate(test.input);
      if (!check.ok) {
        note(`${problem.slug} test ${i}: validator rejects its own test data — ${check.reason}`);
        marks.push("V");
        continue;
      }
      let actual: string;
      try {
        actual = solver(test.input).trim();
      } catch (error) {
        note(`${problem.slug} test ${i}: reference solution threw — ${String(error)}`);
        marks.push("E");
        continue;
      }
      if (actual !== test.expected.trim()) {
        note(
          `${problem.slug} test ${i}: expected "${test.expected.trim()}" but reference produces "${actual}"`,
        );
        marks.push("X");
      } else {
        marks.push(".");
      }
    }

    console.log(
      `  ${marks.join("")}  ${problem.slug.padEnd(32)} ${String(problem.rating).padStart(4)}  ${problem.topic}`,
    );
  }

  return failures;
}

console.log(`Verifying ${PROBLEMS.length} seeded problems\n`);
const failures = verify();
console.log(
  failures === 0
    ? `\nAll ${PROBLEMS.reduce((n, p) => n + p.tests.length, 0)} test cases agree with their reference solution and pass their validator.`
    : `\n${failures} problem(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
