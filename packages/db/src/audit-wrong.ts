/* ============================================================================
   pnpm db:audit — does the test set AGREE with a wrong algorithm?

   `db:verify` proves the reference solution agrees with every expected output.
   That is a check on the ANSWERS. It says nothing about whether the test set
   can tell a correct solution from a plausible wrong one, and those are
   different properties.

   The gap was found on `coin-change-min`. Its five test cases used the coin
   systems {1,2,5}, {2}, {1,3}, {1} and {1,5,10,25} — every one of which is a
   system on which the greedy "take the largest coin that fits" is OPTIMAL. So
   greedy passed 5 of 5, and every match on that problem could have been won by
   a wrong solution. That is a judge defect, not a documentation gap: the judge
   was accepting wrong code.

   So: for each problem, implement the wrong approach a human actually writes,
   and run it against the problem's own hidden tests.

     SURVIVED  the wrong approach matched every expected output.
               THE TEST SET IS DEFECTIVE. It licenses wrong code.
     caught    some test disagreed with it. That test is doing its job, and
               which one is reported, because that is the case worth keeping.

   This is §12's known-incorrect-solution idea used as an AUDIT rather than as
   bot material. The two want the same artefact for opposite reasons: the bot
   wants a wrong solution that looks like a near-miss, and the audit wants one
   that the tests catch.

   NOTE ON SCOPE. This measures WRONG ANSWERS, not slow ones. An approach that
   computes the right answer too slowly (trial division for gcd, O(n^2) LIS) is
   a separate defect class — the tests are simply too small to time it — and is
   reported at the bottom from the largest input each problem actually carries,
   never guessed at.
   ========================================================================= */

import { spawn } from "node:child_process";
import { PROBLEMS } from "./problems.ts";
import { solutionFor } from "./solutions.ts";
import { getValidator } from "./validators.ts";

const nums = (s: string): number[] => s.trim().split(/\s+/).filter(Boolean).map(Number);
const words = (s: string): string[] => s.trim().split(/\s+/).filter(Boolean);

interface Wrong {
  /** What a human wrote, in their words. */
  name: string;
  /** Why someone writes it — this is what makes it PLAUSIBLE rather than silly. */
  why: string;
  solve: (input: string) => string;
  /* AN INPUT THAT PROVES THE APPROACH IS ACTUALLY WRONG.

     Required of anything that survives the test set, and checked rather than
     trusted: the input is run through the problem's own validator, then
     through the reference solution, and the claim only stands if the wrong
     approach disagrees with the reference on an input the constraints permit.

     Without this the audit would report a defect on `sum-of-two` for using a
     32-bit accumulator — which is not wrong, because the constraints cap the
     sum at 2e9 and `int` holds 2.147e9. Three of the thirteen first-pass
     survivors were that: valid solutions the audit had mislabelled. An audit
     that cries wolf is the same failure as a checker stricter than the judge,
     and it costs more here, because the output of this tool is a list of
     problems somebody is about to go and change.

     No expected output is written here. The reference derives it. */
  counterexample?: string;
  /* SET WHEN THE APPROACH IS SLOW RATHER THAN WRONG.

     These are a different defect and must not be reported as the same one.
     Subtractive Euclid computes the CORRECT gcd; it just takes a/b steps
     instead of log steps. Reporting it as a wrong answer would be false — the
     first version of this tool did exactly that, because a five-million-step
     guard tripped and the partial state got printed as though it were the
     approach's answer. The guard's artefact is not a finding.

     For these, the proof is the step count on the counterexample, not a
     differing answer. */
  slowNotWrong?: string;
  /** Set once an approach has been investigated and found ACCEPTABLE. */
  notADefect?: string;
}

/* ---------------------------------------------------------------------------
   The wrong approaches. One entry per mistake a real person makes.

   The bar for inclusion is that someone could submit it BELIEVING it correct.
   A solution that prints a constant is not an audit, it is a straw man, and a
   test set that catches only straw men has been proven nothing about.
   ------------------------------------------------------------------------ */

/* A chain long enough that the true distance passes 2^31: 3000 edges at weight
   1e6 is 3e9. Generated rather than typed — it is 3000 lines. */
const DIJKSTRA_OVERFLOW = (() => {
  const n = 3001;
  const lines = [`${n} ${n - 1}`];
  for (let i = 1; i < n; i++) lines.push(`${i} ${i + 1} 1000000`);
  lines.push(`1 ${n}`);
  return `${lines.join("\n")}\n`;
})();

const WRONG: Record<string, Wrong[]> = {
  /* sum-of-two has NO wrong approach, and that is the answer rather than a
     gap. A 32-bit accumulator was modelled here and removed: the constraints
     cap |a + b| at 2e9 and `int` holds 2.147e9, so it is CORRECT. The problem
     exists as an I/O format check (its own statement says so) and there is
     nothing in it to get wrong. */
  "sum-of-two": [],

  "trailing-zeros": [
    {
      name: "count only the multiples of 5",
      why: "One zero per factor of five, and 25 quietly contributes two.",
      solve: (s) => String(Math.floor(nums(s)[0]! / 5)),
    },
    {
      name: "compute the factorial, then count zeros",
      why: "Reads straight off the statement, and is the reason the statement warns about it.",
      solve: (s) => {
        const n = nums(s)[0]!;
        if (n > 4000) throw new Error("would not finish — a real judge reports TIME_LIMIT");
        let f = 1n;
        for (let i = 2n; i <= BigInt(n); i++) f *= i;
        const digits = f.toString();
        let z = 0;
        for (let i = digits.length - 1; i >= 0 && digits[i] === "0"; i--) z++;
        return String(z);
      },
    },
  ],

  "equalise-cost": [
    {
      name: "move everything to the mean",
      why: "The average is the obvious target, and it is the wrong one — one outlier drags it.",
      solve: (s) => {
        const [, ...a] = nums(s);
        const mean = Math.round(a.reduce((t, x) => t + x, 0) / a.length);
        return String(a.reduce((t, x) => t + Math.abs(x - mean), 0));
      },
    },
    {
      name: "move everything to the midpoint of min and max",
      why: "Another plausible centre, and also not the one that minimises total distance.",
      solve: (s) => {
        const [, ...a] = nums(s);
        const mid = Math.round((Math.min(...a) + Math.max(...a)) / 2);
        return String(a.reduce((t, x) => t + Math.abs(x - mid), 0));
      },
    },
  ],

  "coin-ways": [
    {
      name: "totals on the outside, coins on the inside",
      why: "The natural loop order, and it counts ORDERINGS rather than combinations.",
      solve: (s) => {
        const all = nums(s);
        const target = all[1]!;
        const coins = all.slice(2);
        const MOD = 1_000_000_007n;
        const dp = new Array<bigint>(target + 1).fill(0n);
        dp[0] = 1n;
        for (let v = 1; v <= target; v++) {
          for (const c of coins) if (c <= v) dp[v] = (dp[v]! + dp[v - c]!) % MOD;
        }
        return String(dp[target]);
      },
    },
  ],

  "count-vowels": [
    {
      name: "y counts as a vowel",
      why: 'English teaches "a, e, i, o, u and sometimes y".',
      solve: (s) => String((s.trim().match(/[aeiouy]/g) ?? []).length),
    },
    {
      name: "distinct vowels, via a set",
      counterexample: "banana\n",
      why: "Reaching for a set instead of a counter — the single most common slip when the word is 'count'.",
      solve: (s) => {
        const seen = new Set<string>();
        for (const c of s.trim()) if ("aeiou".includes(c)) seen.add(c);
        return String(seen.size);
      },
    },
  ],

  "fizzbuzz-count": [
    {
      name: "no inclusion-exclusion",
      why: "Adds the multiples of 3 to the multiples of 5 and double-counts the multiples of 15.",
      solve: (s) => {
        const n = nums(s)[0]!;
        return String(Math.floor(n / 3) + Math.floor(n / 5));
      },
    },
    {
      name: "half-open range [1, n)",
      why: "An exclusive loop bound; the classic off-by-one at the stated maximum.",
      solve: (s) => {
        const n = nums(s)[0]! - 1;
        return String(Math.floor(n / 3) + Math.floor(n / 5) - Math.floor(n / 15));
      },
    },
  ],

  "max-subarray-sum": [
    {
      name: "best seeded at 0",
      why: "Allows the empty subarray, so an all-negative array answers 0.",
      solve: (s) => {
        const [, ...a] = nums(s);
        let best = 0;
        let cur = 0;
        for (const v of a) {
          cur = Math.max(0, cur + v);
          best = Math.max(best, cur);
        }
        return String(best);
      },
    },
    {
      name: "32-bit accumulator",
      counterexample: "3\n1000000000 1000000000 1000000000\n",
      why: "n up to 1e5 at 1e9 each reaches 1e14, which overflows `int`.",
      solve: (s) => {
        const [, ...a] = nums(s);
        let best = a[0]! | 0;
        let cur = a[0]! | 0;
        for (let i = 1; i < a.length; i++) {
          cur = Math.max(a[i]! | 0, (cur + a[i]!) | 0) | 0;
          best = Math.max(best, cur) | 0;
        }
        return String(best);
      },
    },
  ],

  "gcd-pair": [
    {
      name: "subtractive Euclid",
      counterexample: "1000000000 1\n",
      slowNotWrong: "a - b per step instead of a mod b",
      /* MEASURED, AND DISMISSED — but the measurement lives in `pnpm db:timing`,
         not here.

         This entry used to carry a hand-typed "0.50s in C++ against a 5000ms
         limit". That number was true on the laptop it was taken on and is a
         claim about a HOST, so writing it down froze it: move to a slower
         machine and a recorded non-defect silently becomes a live one, with a
         comment still asserting otherwise.

         `db:timing` now compiles this exact approach, runs it at (10^9, 1) —
         the worst input `1 <= a, b <= 10^9` permits — and re-derives the verdict
         on whatever host it runs on. If the margin ever closes, it says so and
         tells you that gcd-pair should GAIN a test rather than keep this entry.

         The claim, restated so it is falsifiable rather than numeric: at these
         constraints the work is capped at 10^9 iterations, and if that fits
         inside the limit the approach is legitimate and NO test can catch it. */
      why: "The textbook version before the modulo refinement. The answer is right; the step count is not.",
      solve: (s) => {
        /* Returns the STEP COUNT, because that is the quantity in question.
           No test in this problem makes it exceed 2. */
        let [a, b] = nums(s) as [number, number];
        let steps = 0;
        while (a !== b && steps < 2_000_000_000) {
          if (a > b) a -= b;
          else b -= a;
          steps++;
        }
        return String(steps);
      },
    },
  ],

  "longest-common-prefix": [
    {
      name: "prefix seeded empty",
      why: "Builds the answer by comparing word i against word i-1, so a single word has nothing to compare against.",
      solve: (s) => {
        const list = words(s).slice(1);
        if (list.length < 2) return "0";
        let k = 0;
        const first = list[0]!;
        outer: for (; k < first.length; k++) {
          for (const w of list) if (w[k] !== first[k]) break outer;
        }
        return String(k);
      },
    },
    {
      name: "first two words only",
      why: "Assumes the first pair constrains the rest.",
      solve: (s) => {
        const list = words(s).slice(1);
        const [a, b] = [list[0] ?? "", list[1] ?? list[0] ?? ""];
        let k = 0;
        while (k < a.length && k < b.length && a[k] === b[k]) k++;
        return String(k);
      },
    },
  ],

  "sieve-count": [
    {
      name: "1 counted as prime",
      why: "A sieve that marks the whole array prime and only crosses out multiples never excludes 1.",
      solve: (s) => {
        const n = nums(s)[0]!;
        const sieve = new Uint8Array(n + 1);
        let count = 1; // the bug: 1 counted
        for (let i = 2; i <= n; i++) {
          if (!sieve[i]) {
            count++;
            for (let j = i * i; j <= n; j += i) sieve[j] = 1;
          }
        }
        return String(count);
      },
    },
    {
      name: "primes strictly below n",
      why: "An exclusive upper bound; off-by-one at the stated maximum.",
      solve: (s) => {
        const n = nums(s)[0]! - 1;
        const sieve = new Uint8Array(Math.max(2, n + 1));
        let count = 0;
        for (let i = 2; i <= n; i++) {
          if (!sieve[i]) {
            count++;
            for (let j = i * i; j <= n; j += i) sieve[j] = 1;
          }
        }
        return String(count);
      },
    },
  ],

  "activity-selection": [
    {
      name: "sort by start time",
      why: "The obvious ordering, and wrong: one long early activity blocks everything.",
      solve: (s) => intervalGreedy(s, (x, y) => x[0] - y[0]),
    },
    {
      name: "sort by shortest duration",
      counterexample: "3\n0 10\n9 11\n10 20\n",
      why: "Feels optimal — take the cheapest first — and is the classic wrong greedy for this problem.",
      solve: (s) => intervalGreedy(s, (x, y) => x[1] - x[0] - (y[1] - y[0])),
    },
    {
      name: "touching endpoints treated as overlapping",
      why: "Uses `start > last` where the statement says an activity may begin exactly when another ends.",
      solve: (s) => intervalGreedy(s, (x, y) => x[1] - y[1], true),
    },
  ],

  "connected-components": [
    {
      name: "only vertices named by an edge",
      why: "Iterates the edge list rather than 1..n, so isolated vertices vanish.",
      solve: (s) => {
        const all = nums(s);
        const m = all[1]!;
        const parent = new Map<number, number>();
        const find = (x: number): number => {
          if (!parent.has(x)) parent.set(x, x);
          while (parent.get(x) !== x) {
            parent.set(x, parent.get(parent.get(x)!)!);
            x = parent.get(x)!;
          }
          return x;
        };
        for (let e = 0; e < m; e++) {
          const a = find(all[2 + e * 2]!);
          const b = find(all[3 + e * 2]!);
          if (a !== b) parent.set(a, b);
        }
        const roots = new Set<number>();
        for (const v of parent.keys()) roots.add(find(v));
        return String(roots.size);
      },
    },
    {
      name: "n minus the edge count",
      why: "True for a forest, and people reach for it before noticing cycles and duplicate edges.",
      solve: (s) => {
        const all = nums(s);
        return String(all[0]! - all[1]!);
      },
    },
  ],

  "fractional-knapsack": [
    {
      name: "0/1 knapsack — never cuts an item",
      why: "Solves the knapsack everyone learns first.",
      solve: (s) => {
        const all = nums(s);
        const n = all[0]!;
        let cap = all[1]!;
        const items: [number, number][] = [];
        for (let i = 0; i < n; i++) items.push([all[2 + i * 2]!, all[3 + i * 2]!]);
        items.sort((a, b) => b[0] / b[1] - a[0] / a[1]);
        let total = 0;
        for (const [value, weight] of items) {
          if (weight <= cap) {
            total += value;
            cap -= weight;
          }
        }
        return String(Math.floor(total));
      },
    },
    {
      name: "sort by value, not by value per weight",
      why: "Greedy on the wrong key — the mistake the ratio exists to prevent.",
      solve: (s) => fractional(s, (a, b) => b[0] - a[0]),
    },
    {
      name: "sort by weight ascending",
      why: "Fit the most items in — a different wrong key, same family.",
      solve: (s) => fractional(s, (a, b) => a[1] - b[1]),
    },
  ],

  "coin-change-min": [
    {
      name: "greedy — largest coin that fits",
      why: "Correct for every coin system in daily use, wrong in general. THIS IS THE ONE THAT GOT THROUGH.",
      solve: (s) => {
        const all = nums(s);
        let target = all[1]!;
        const coins = all.slice(2).sort((a, b) => b - a);
        let n = 0;
        for (const c of coins) {
          n += Math.floor(target / c);
          target %= c;
        }
        return String(target === 0 ? n : -1);
      },
    },
  ],

  "min-platforms": [
    {
      name: "departure sorts before arrival at equal times",
      why: "A tie-break decision that is invisible until two trains meet at one instant.",
      solve: (s) => platforms(s, false),
    },
  ],

  "shortest-path-bfs": [
    {
      name: "DFS instead of BFS",
      counterexample: "4 4\n1 2\n2 3\n3 4\n1 4\n1 4\n",
      why: "Both 'search the graph'; only one finds the SHORTEST path.",
      solve: (s) => {
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
        const seen = new Uint8Array(n + 1);
        let answer = -1;
        const walk = (u: number, d: number): boolean => {
          if (u === dst) {
            answer = d;
            return true;
          }
          seen[u] = 1;
          for (const v of adj[u]!) if (!seen[v] && walk(v, d + 1)) return true;
          return false;
        };
        walk(src, 0);
        return String(answer);
      },
    },
  ],

  "topological-order": [
    {
      name: "one visited set, no recursion colouring",
      counterexample: "4 4\n1 2\n1 3\n2 4\n3 4\n",
      why: "Reports a cycle whenever a vertex is reached twice — but a DAG reaches a vertex twice all the time.",
      solve: (s) => {
        const { n, adj } = digraph(s);
        const seen = new Uint8Array(n + 1);
        let cyclic = false;
        const walk = (u: number): void => {
          if (seen[u]) {
            cyclic = true;
            return;
          }
          seen[u] = 1;
          for (const v of adj[u]!) walk(v);
        };
        for (let v = 1; v <= n && !cyclic; v++) if (!seen[v]) walk(v);
        return cyclic ? "NO" : "YES";
      },
    },
    {
      name: "edges treated as undirected",
      counterexample: "4 4\n1 2\n1 3\n2 4\n3 4\n",
      why: "Forgetting direction while hunting for a cycle.",
      solve: (s) => {
        const { n, adj } = digraph(s);
        const und: number[][] = Array.from({ length: n + 1 }, () => []);
        for (let u = 1; u <= n; u++) {
          for (const v of adj[u]!) {
            und[u]!.push(v);
            und[v]!.push(u);
          }
        }
        const seen = new Uint8Array(n + 1);
        let cyclic = false;
        const walk = (u: number, parent: number): void => {
          seen[u] = 1;
          for (const v of und[u]!) {
            if (v === parent) continue;
            if (seen[v]) cyclic = true;
            else walk(v, u);
          }
        };
        for (let v = 1; v <= n; v++) if (!seen[v]) walk(v, 0);
        return cyclic ? "NO" : "YES";
      },
    },
  ],

  "kth-smallest-pair": [
    {
      name: "0-indexed kth",
      why: "The single most common off-by-one there is.",
      solve: (s) => {
        const all = nums(s);
        const k = all[1]!;
        const a = all.slice(2).sort((x, y) => x - y);
        return String(a[k] ?? -1);
      },
    },
    {
      name: "lexicographic sort",
      why: "JavaScript's default `.sort()`, and reading numbers as strings elsewhere.",
      solve: (s) => {
        const all = nums(s);
        const k = all[1]!;
        const a = all.slice(2).map(String).sort();
        return String(a[k - 1]);
      },
    },
    {
      name: "duplicates removed first",
      why: "Reading 'kth smallest' as 'kth distinct smallest'.",
      solve: (s) => {
        const all = nums(s);
        const k = all[1]!;
        const a = [...new Set(all.slice(2))].sort((x, y) => x - y);
        return String(a[k - 1] ?? -1);
      },
    },
  ],

  "longest-increasing-subsequence": [
    {
      name: "longest contiguous run",
      why: "Reading 'subsequence' as 'substring'.",
      solve: (s) => {
        const [, ...a] = nums(s);
        let best = 1;
        let run = 1;
        for (let i = 1; i < a.length; i++) {
          run = a[i]! > a[i - 1]! ? run + 1 : 1;
          best = Math.max(best, run);
        }
        return String(a.length === 0 ? 0 : best);
      },
    },
    {
      name: "non-strict — equal values extend the run",
      counterexample: "5\n1 2 2 3 4\n",
      why: "`<=` where the problem says strictly increasing. Invisible without duplicates.",
      solve: (s) => {
        const [, ...a] = nums(s);
        const tails: number[] = [];
        for (const v of a) {
          let lo = 0;
          let hi = tails.length;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (tails[mid]! <= v) lo = mid + 1;
            else hi = mid;
          }
          tails[lo] = v;
        }
        return String(tails.length);
      },
    },
  ],

  "edit-distance": [
    {
      name: "Hamming distance",
      why: "Counts substitutions only, and pads the length difference.",
      solve: (s) => {
        const [a, b] = words(s) as [string, string];
        let d = Math.abs(a.length - b.length);
        for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) d++;
        return String(d);
      },
    },
    {
      name: "insert and delete only, no substitution",
      why: "The LCS-based distance — a real metric, and not this one.",
      solve: (s) => {
        const [a, b] = words(s) as [string, string];
        let prev = new Array<number>(b.length + 1).fill(0);
        for (let i = 1; i <= a.length; i++) {
          const cur = [0];
          for (let j = 1; j <= b.length; j++) {
            cur[j] =
              a[i - 1] === b[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, cur[j - 1]!);
          }
          prev = cur;
        }
        return String(a.length + b.length - 2 * prev[b.length]!);
      },
    },
  ],

  "palindrome-min-cut": [
    {
      name: "greedy — take the longest palindromic prefix",
      counterexample: "aaabaa\n",
      why: "Greedy on a partitioning problem. Feels right and is not.",
      solve: (s) => {
        let str = s.trim();
        const isPal = (t: string): boolean => t === [...t].reverse().join("");
        let cuts = -1;
        while (str.length > 0) {
          let take = str.length;
          while (take > 1 && !isPal(str.slice(0, take))) take--;
          str = str.slice(take);
          cuts++;
        }
        return String(Math.max(0, cuts));
      },
    },
  ],

  "dijkstra-shortest": [
    {
      name: "32-bit distances",
      /* The statement WARNS about this in so many words — "total path weight
         can exceed 32 bits" — and not one test goes near it. The largest total
         any test reaches is 18. A problem that documents a trap and then never
         springs it is worse than one that says nothing. */
      counterexample: DIJKSTRA_OVERFLOW,
      why: "`int` distances, where m up to 2e5 edges at weight 1e6 reaches 2e11.",
      solve: (s) => {
        const g = weighted(s);
        const dist = new Array<number>(g.n + 1).fill(Infinity);
        dist[g.src] = 0;
        const heap: [number, number][] = [[0, g.src]];
        while (heap.length > 0) {
          heap.sort((a, b) => a[0] - b[0]);
          const [d, u] = heap.shift()!;
          if (d > dist[u]!) continue;
          for (const [v, w] of g.adj[u]!) {
            const next = (d + w) | 0;
            if (next < dist[v]!) {
              dist[v] = next;
              heap.push([next, v]);
            }
          }
        }
        return String(dist[g.dst] === Infinity ? -1 : dist[g.dst]);
      },
    },
    {
      name: "BFS, ignoring the weights",
      why: "Counts hops rather than cost.",
      solve: (s) => {
        const g = weighted(s);
        const dist = new Array<number>(g.n + 1).fill(-1);
        dist[g.src] = 0;
        const queue = [g.src];
        for (let i = 0; i < queue.length; i++) {
          const u = queue[i]!;
          for (const [v] of g.adj[u]!)
            if (dist[v] === -1) {
              dist[v] = dist[u]! + 1;
              queue.push(v);
            }
        }
        return String(dist[g.dst]);
      },
    },
    {
      name: "settled on push instead of on pop",
      why: "Marks a vertex final the first time it is seen, so a cheaper route found later is discarded.",
      solve: (s) => {
        const g = weighted(s);
        const dist = new Array<number>(g.n + 1).fill(Infinity);
        const settled = new Uint8Array(g.n + 1);
        dist[g.src] = 0;
        settled[g.src] = 1;
        const heap: [number, number][] = [[0, g.src]];
        while (heap.length > 0) {
          heap.sort((a, b) => a[0] - b[0]);
          const [d, u] = heap.shift()!;
          for (const [v, w] of g.adj[u]!)
            if (!settled[v]) {
              settled[v] = 1;
              dist[v] = d + w;
              heap.push([dist[v]!, v]);
            }
        }
        return String(dist[g.dst] === Infinity ? -1 : dist[g.dst]);
      },
    },
    {
      name: "walk to the nearest unvisited neighbour",
      counterexample: "3 3\n1 2 1\n2 3 100\n1 3 5\n1 3\n",
      why: "'Always go to the closest one' — Dijkstra misremembered as a walk rather than a frontier.",
      solve: (s) => {
        const g = weighted(s);
        const seen = new Uint8Array(g.n + 1);
        let at = g.src;
        let total = 0;
        seen[at] = 1;
        while (at !== g.dst) {
          let best: [number, number] | null = null;
          for (const [v, w] of g.adj[at]!) if (!seen[v] && (best === null || w < best[1])) best = [v, w];
          if (best === null) return "-1";
          seen[best[0]] = 1;
          total += best[1];
          at = best[0];
        }
        return String(total);
      },
    },
  ],

  "modular-power": [
    {
      name: "exponentiate, then take the modulus",
      why: "Reads straight off the statement. Overflows, or in a bignum language, hangs.",
      solve: (s) => {
        const [a, b, m] = nums(s) as [number, number, number];
        if (b > 4096) throw new Error("would not finish — a real judge reports TIME_LIMIT");
        return String(Number(a ** b % m));
      },
    },
    /* "64-bit multiply without reducing first" was modelled here and removed
       for the same reason as sum-of-two's: m <= 2e9, so the product of two
       reduced operands is under 4e18 and a signed 64-bit integer holds
       9.22e18. It is correct. The statement's warning that "intermediate
       products exceed 32 bits" is precisely right — 32, not 64. */
    {
      name: "b = 0 returns 1 without reducing",
      counterexample: "5 0 1\n",
      why: "Special-cases the exponent before remembering that m may be 1.",
      solve: (s) => {
        const [a, b, m] = nums(s).map(BigInt) as [bigint, bigint, bigint];
        if (b === 0n) return "1";
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
    },
  ],
};

/* --- shared helpers, so a wrong approach differs from the reference in
       exactly the one way it is supposed to ------------------------------- */

function intervalGreedy(
  s: string,
  order: (a: [number, number], b: [number, number]) => number,
  strict = false,
): string {
  const all = nums(s);
  const n = all[0]!;
  const iv: [number, number][] = [];
  for (let i = 0; i < n; i++) iv.push([all[1 + i * 2]!, all[2 + i * 2]!]);
  iv.sort(order);
  let count = 0;
  let last = -Infinity;
  for (const [start, end] of iv) {
    if (strict ? start > last : start >= last) {
      count++;
      last = end;
    }
  }
  return String(count);
}

function fractional(s: string, order: (a: [number, number], b: [number, number]) => number): string {
  const all = nums(s);
  const n = all[0]!;
  let cap = all[1]!;
  const items: [number, number][] = [];
  for (let i = 0; i < n; i++) items.push([all[2 + i * 2]!, all[3 + i * 2]!]);
  items.sort(order);
  let total = 0;
  for (const [value, weight] of items) {
    if (cap <= 0) break;
    const take = Math.min(cap, weight);
    total += (value * take) / weight;
    cap -= take;
  }
  return String(Math.floor(total + 1e-9));
}

function platforms(s: string, arrivalFirst: boolean): string {
  const all = nums(s);
  const n = all[0]!;
  const events: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    events.push([all[1 + i * 2]!, 1]);
    events.push([all[2 + i * 2]!, -1]);
  }
  events.sort((a, b) => a[0] - b[0] || (arrivalFirst ? b[1] - a[1] : a[1] - b[1]));
  let cur = 0;
  let best = 0;
  for (const [, delta] of events) {
    cur += delta;
    best = Math.max(best, cur);
  }
  return String(best);
}

function digraph(s: string): { n: number; adj: number[][] } {
  const all = nums(s);
  const n = all[0]!;
  const m = all[1]!;
  const adj: number[][] = Array.from({ length: n + 1 }, () => []);
  for (let e = 0; e < m; e++) adj[all[2 + e * 2]!]!.push(all[3 + e * 2]!);
  return { n, adj };
}

function weighted(s: string): { n: number; adj: [number, number][][]; src: number; dst: number } {
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
  return { n, adj, src: all[2 + m * 3]!, dst: all[3 + m * 3]! };
}

/* --- the audit ---------------------------------------------------------- */

interface Row {
  slug: string;
  rating: number;
  approach: string;
  why: string;
  survived: boolean;
  caughtBy: string;
  counterexample?: string;
  slowNotWrong?: string;
  notADefect?: string;
  solve: (input: string) => string;
  /** Empty until proven. A survivor with no proof is a CLAIM, not a finding. */
  proof: string;
}

/* Same normaliser the judge uses (apps/judge/images/runner.py). */
const normalise = (t: string): string =>
  t.trim().split("\n").map((l) => l.replace(/\s+$/, "")).join("\n");

function runReference(source: string, input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["-c", source]);
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("reference did not finish in 30s"));
    }, 30_000);
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", () => { clearTimeout(timer); resolve(normalise(out)); });
    child.stdin.end(input);
  });
}

const rows: Row[] = [];
const noWrongApproach: string[] = [];
const deliberatelyNone: string[] = [];

for (const problem of PROBLEMS.slice().sort((a, b) => a.rating - b.rating)) {
  const attempts = WRONG[problem.slug];
  if (!attempts) {
    noWrongApproach.push(problem.slug);
    continue;
  }
  /* An EMPTY array is an answer — "we looked, there is nothing plausible to get
     wrong here" — and a missing key is a gap. Same distinction as a
     `discriminator` of null versus a `discriminator` that was never written.
     Collapsing the two would let an unaudited problem hide among the audited. */
  if (attempts.length === 0) {
    deliberatelyNone.push(problem.slug);
    continue;
  }

  for (const attempt of attempts) {
    /* A complexity entry reports step counts, not answers, so comparing it to
       the expected outputs is meaningless — it always "differs" and would be
       reported as caught. It goes straight to the proof pass. */
    let survived = true;
    let caughtBy = "";

    for (const [i, test] of attempt.slowNotWrong ? [] : problem.tests.entries()) {
      let actual: string;
      try {
        actual = attempt.solve(test.input).trim();
      } catch (error) {
        survived = false;
        caughtBy = `test ${i} (threw: ${error instanceof Error ? error.message : String(error)})`;
        break;
      }
      if (actual !== test.expected.trim()) {
        survived = false;
        caughtBy = `test ${i}${test.isSample ? " (a sample)" : ""}: said "${actual}", answer is "${test.expected.trim()}"`;
        break;
      }
    }

    rows.push({
      slug: problem.slug,
      rating: problem.rating,
      approach: attempt.name,
      why: attempt.why,
      survived,
      caughtBy,
      counterexample: attempt.counterexample,
      slowNotWrong: attempt.slowNotWrong,
      notADefect: attempt.notADefect,
      solve: attempt.solve,
      proof: "",
    });
  }
}

/* PROVE EVERY SURVIVOR. A survivor is only a defect if the approach is really
   wrong, and "really wrong" means: on an input the problem's own validator
   accepts, it disagrees with the problem's own reference solution. Both halves
   are checked here, and the expected value is derived, never typed. */
for (const row of rows.filter((r) => r.survived)) {
  const problem = PROBLEMS.find((p) => p.slug === row.slug)!;
  if (!row.counterexample) {
    row.proof = "UNPROVEN — no counterexample supplied";
    continue;
  }
  if (row.notADefect) {
    row.proof = `ACCEPTABLE — ${row.notADefect}`;
    continue;
  }
  if (row.slowNotWrong) {
    const steps = Number(row.solve(row.counterexample));
    const worst = Math.max(
      ...problem.tests.map((t) => Number(row.solve(t.input))),
    );
    row.proof =
      `COMPLEXITY, not a wrong answer (${row.slowNotWrong}). ` +
      `Worst existing test costs ${worst} step(s); ` +
      `${JSON.stringify(row.counterexample)} costs ${steps.toLocaleString("en-US")}.`;
    continue;
  }
  const check = getValidator(problem.validatorKey)(row.counterexample);
  if (!check.ok) {
    row.proof = `UNPROVEN — the counterexample breaks the constraints: ${check.reason}`;
    continue;
  }
  let truth: string;
  try {
    truth = await runReference(solutionFor(row.slug), row.counterexample);
  } catch (error) {
    row.proof = `UNPROVEN — reference failed: ${String(error)}`;
    continue;
  }
  let got: string;
  try {
    got = normalise(row.solve(row.counterexample));
  } catch (error) {
    got = `threw: ${error instanceof Error ? error.message : String(error)}`;
  }
  const head = row.counterexample.length > 42
    ? `${row.counterexample.slice(0, 42).replace(/\n/g, "\\n")}… (${row.counterexample.length} bytes)`
    : JSON.stringify(row.counterexample);
  row.proof =
    got === truth
      ? `NOT A DEFECT — agrees with the reference on ${head}; the approach is valid here`
      : `PROVEN on ${head}: it says "${got}", the answer is "${truth}"`;
}

console.log(`Auditing ${PROBLEMS.length} problems with ${rows.length} wrong approaches\n`);

for (const row of rows) {
  const mark = row.survived ? "SURVIVED" : "caught  ";
  console.log(`  ${mark}  ${String(row.rating).padStart(4)}  ${row.slug.padEnd(32)} ${row.approach}`);
  if (row.survived) {
    console.log(`            ${row.why}`);
    console.log(`            ${row.proof}`);
  } else console.log(`            ${row.caughtBy}`);
}

const survivors = rows.filter((r) => r.survived && r.proof.startsWith("PROVEN"));
const slow = rows.filter((r) => r.survived && r.proof.startsWith("COMPLEXITY"));
const acceptable = rows.filter((r) => r.survived && r.proof.startsWith("ACCEPTABLE"));
const unproven = rows.filter(
  (r) =>
    r.survived &&
    !r.proof.startsWith("PROVEN") &&
    !r.proof.startsWith("COMPLEXITY") &&
    !r.proof.startsWith("ACCEPTABLE"),
);

/* Largest input each problem actually carries, so the complexity claim below
   is measured rather than asserted. A problem whose biggest test is a handful
   of numbers cannot time anything, whatever its constraints say. */
console.log("\nLargest test input per problem (bytes), against what the constraints permit:");
for (const problem of PROBLEMS.slice().sort((a, b) => a.rating - b.rating)) {
  const biggest = Math.max(...problem.tests.map((t) => t.input.length));
  console.log(
    `  ${String(biggest).padStart(9)}  ${problem.slug.padEnd(32)} ${problem.constraints[0] ?? ""}`,
  );
}

if (survivors.length > 0) {
  console.error(
    `\n${survivors.length} wrong approach(es) SURVIVED the test set. Each one is a problem\n` +
      "whose judge accepts wrong code — the same defect class as coin-change-min:\n",
  );
  for (const row of survivors) console.error(`  ${row.slug} — ${row.approach}`);
  console.error("");
}
if (acceptable.length > 0) {
  console.log(
    `\n${acceptable.length} approach(es) survive and are ACCEPTABLE — investigated, ` +
      "not defects:",
  );
  for (const row of acceptable) console.log(`  ${row.slug} — ${row.approach}: ${row.notADefect}`);
}
if (slow.length > 0) {
  console.error(
    `${slow.length} approach(es) survive by being SLOW rather than wrong — a separate\n` +
      "defect, fixed with a bigger test rather than a different one:\n",
  );
  for (const row of slow) console.error(`  ${row.slug} — ${row.approach}`);
  console.error("");
}
if (unproven.length > 0) {
  console.error(
    `${unproven.length} survivor(s) NOT counted as defects — see the reasons above.\n`,
  );
}
if (deliberatelyNone.length > 0) {
  console.log(
    `Audited and found nothing plausible to get wrong: ${deliberatelyNone.join(", ")}.`,
  );
}
if (noWrongApproach.length > 0) {
  console.error(
    `NOT YET AUDITED: ${noWrongApproach.join(", ")}. ` +
      "This is a gap in the audit, not a clean bill of health.",
  );
}

process.exit(survivors.length === 0 ? 0 : 1);
