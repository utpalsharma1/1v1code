/* ============================================================================
   Input validators (§6.8)

   A validator answers one question: does this input satisfy the constraints the
   problem statement actually promises?

   This is what makes the hack phase a real mechanic instead of a garbage
   contest. Without it, "hacking" means feeding `n = -1` to a problem that says
   `1 ≤ n ≤ 1e5` — which breaks every correct solution including the attacker's,
   and tests nothing. With it, a landed hack means exactly one thing: the
   opponent's code is wrong on an input the problem explicitly permits.

   Validators live in reviewed source rather than in a database column. The
   Problem row stores a key into REGISTRY; it never stores executable code.
   ========================================================================= */

export interface ValidationOk {
  ok: true;
}
export interface ValidationFail {
  ok: false;
  reason: string;
}
export type ValidationResult = ValidationOk | ValidationFail;

export type Validator = (input: string) => ValidationResult;

class Invalid extends Error {}

const fail = (reason: string): never => {
  throw new Invalid(reason);
};

/** Whitespace-delimited token reader with range-checked accessors. */
class Reader {
  private tokens: string[];
  private i = 0;

  constructor(raw: string) {
    // Reject anything that isn't plain ASCII text up front: a validator that
    // accepts control characters is a validator that can smuggle a payload.
    if (/[^\x09\x0a\x0d\x20-\x7e]/.test(raw)) fail("input contains non-printable characters");
    /* 8 MB, matching the judge's own `--ulimit fsize=8388608` (§11) rather than
       being a second arbitrary number beside it.

       It was 2 MB, and that made three problems' STATED CONSTRAINTS
       unsatisfiable: `m <= 2*10^5` edges with weights is about 2.8 MB of text,
       so `connected-components`, `topological-order` and `dijkstra-shortest`
       could not carry a test at their own upper bound. `db:coverage` demanded
       one, `db:fill` generated one, and the validator refused it — which is the
       three gates disagreeing, and the constraint being a promise the platform
       could not keep.

       n <= 10^5 with m <= 2*10^5 is an ordinary competitive-programming size.
       The cap is ours, so the cap is what was wrong. Raising it costs a larger
       maximum hack-phase input (§6.8), which is bounded, CPU-billed (§11) and
       not yet built; leaving it costs a constraint the judge would enforce and
       the problem could never demonstrate. */
    if (raw.length > 8_388_608) fail("input exceeds 8 MB");
    this.tokens = raw.trim().split(/\s+/).filter(Boolean);
  }

  int(min: number, max: number, label = "value"): number {
    if (this.i >= this.tokens.length) fail(`expected ${label}, found end of input`);
    const token = this.tokens[this.i++]!;
    if (!/^-?\d+$/.test(token)) fail(`${label} "${token}" is not an integer`);
    const value = Number(token);
    if (!Number.isSafeInteger(value)) fail(`${label} "${token}" is out of safe integer range`);
    if (value < min || value > max) fail(`${label} ${value} outside [${min}, ${max}]`);
    return value;
  }

  word(maxLen: number, pattern: RegExp, label = "token"): string {
    if (this.i >= this.tokens.length) fail(`expected ${label}, found end of input`);
    const token = this.tokens[this.i++]!;
    if (token.length > maxLen) fail(`${label} longer than ${maxLen}`);
    if (!pattern.test(token)) fail(`${label} "${token}" has disallowed characters`);
    return token;
  }

  end(): void {
    if (this.i !== this.tokens.length) {
      fail(`${this.tokens.length - this.i} unexpected trailing token(s)`);
    }
  }
}

function validator(body: (r: Reader) => void): Validator {
  return (input: string): ValidationResult => {
    try {
      const reader = new Reader(input);
      body(reader);
      reader.end();
      return { ok: true };
    } catch (error) {
      if (error instanceof Invalid) return { ok: false, reason: error.message };
      return { ok: false, reason: "validator error" };
    }
  };
}

/* ── Shapes ───────────────────────────────────────────────────────────── */

/** A fixed sequence of integers, each with its own range. */
const fixedInts = (specs: [number, number, string][]): Validator =>
  validator((r) => {
    for (const [min, max, label] of specs) r.int(min, max, label);
  });

/** `n` followed by n integers. */
const intArray = (
  nMin: number,
  nMax: number,
  vMin: number,
  vMax: number,
): Validator =>
  validator((r) => {
    const n = r.int(nMin, nMax, "n");
    for (let i = 0; i < n; i++) r.int(vMin, vMax, `a[${i}]`);
  });

/** `n k` followed by n integers. */
const intArrayWithK = (
  nMin: number,
  nMax: number,
  vMin: number,
  vMax: number,
  kMin: number,
  kMax: number,
): Validator =>
  validator((r) => {
    const n = r.int(nMin, nMax, "n");
    r.int(kMin, kMax, "k");
    for (let i = 0; i < n; i++) r.int(vMin, vMax, `a[${i}]`);
  });

/** A single token of lowercase letters. */
const word = (maxLen: number): Validator =>
  validator((r) => {
    r.word(maxLen, /^[a-z]+$/, "s");
  });

/** `n` followed by n lowercase words. */
const wordList = (nMin: number, nMax: number, maxLen: number): Validator =>
  validator((r) => {
    const n = r.int(nMin, nMax, "n");
    for (let i = 0; i < n; i++) r.word(maxLen, /^[a-z]+$/, `s[${i}]`);
  });

/**
 * `n m` then m edges. Vertices are 1-indexed and must be in range — an edge
 * pointing at a vertex that doesn't exist is the single most common way a
 * hand-written "hack" input is simply malformed rather than clever.
 */
const graph = (
  nMax: number,
  mMax: number,
  opts: { weighted?: boolean; wMax?: number } = {},
): Validator =>
  validator((r) => {
    const n = r.int(1, nMax, "n");
    const m = r.int(0, mMax, "m");
    for (let e = 0; e < m; e++) {
      r.int(1, n, `edge ${e} u`);
      r.int(1, n, `edge ${e} v`);
      if (opts.weighted) r.int(1, opts.wMax ?? 1_000_000, `edge ${e} w`);
    }
  });

/** `n` then n `[start, end]` pairs with start ≤ end. */
const intervals = (nMax: number, vMax: number): Validator =>
  validator((r) => {
    const n = r.int(1, nMax, "n");
    for (let i = 0; i < n; i++) {
      const s = r.int(0, vMax, `interval ${i} start`);
      const e = r.int(0, vMax, `interval ${i} end`);
      if (e < s) fail(`interval ${i} ends (${e}) before it starts (${s})`);
    }
  });

/* ── Registry ─────────────────────────────────────────────────────────── */

export const REGISTRY: Record<string, Validator> = {
  "two-ints": fixedInts([
    [-1_000_000_000, 1_000_000_000, "a"],
    [-1_000_000_000, 1_000_000_000, "b"],
  ]),
  "gcd-pair": fixedInts([
    [1, 1_000_000_000, "a"],
    [1, 1_000_000_000, "b"],
  ]),
  "single-n-small": fixedInts([[1, 1_000_000, "n"]]),
  "single-n-sieve": fixedInts([[2, 1_000_000, "n"]]),
  // m goes to 2e9 so the canonical 1e9+7 modulus is in range. The statement's
  // constraints say the same thing — if these two ever disagree, the hack phase
  // is policing a contract the problem itself breaks.
  "modpow-triple": fixedInts([
    [0, 1_000_000_000, "a"],
    [0, 1_000_000_000, "b"],
    [1, 2_000_000_000, "m"],
  ]),

  "int-array": intArray(1, 100_000, -1_000_000_000, 1_000_000_000),
  "int-array-positive": intArray(1, 100_000, 1, 1_000_000_000),
  "int-array-k": intArrayWithK(1, 100_000, 1, 1_000_000_000, 1, 1_000_000_000),

  word: word(100_000),
  "word-list": wordList(1, 1_000, 1_000),
  "two-words": validator((r) => {
    r.word(2_000, /^[a-z]+$/, "a");
    r.word(2_000, /^[a-z]+$/, "b");
  }),

  graph: graph(100_000, 200_000),
  "graph-query": validator((r) => {
    const n = r.int(1, 100_000, "n");
    const m = r.int(0, 200_000, "m");
    for (let e = 0; e < m; e++) {
      r.int(1, n, `edge ${e} u`);
      r.int(1, n, `edge ${e} v`);
    }
    r.int(1, n, "source");
    r.int(1, n, "target");
  }),
  "graph-weighted": validator((r) => {
    const n = r.int(1, 100_000, "n");
    const m = r.int(0, 200_000, "m");
    for (let e = 0; e < m; e++) {
      r.int(1, n, `edge ${e} u`);
      r.int(1, n, `edge ${e} v`);
      r.int(1, 1_000_000, `edge ${e} w`);
    }
    r.int(1, n, "source");
    r.int(1, n, "target");
  }),

  intervals: intervals(100_000, 1_000_000_000),

  "coins-target": validator((r) => {
    const n = r.int(1, 100, "n");
    r.int(1, 1_000_000, "target");
    for (let i = 0; i < n; i++) r.int(1, 1_000_000, `coin[${i}]`);
  }),

  "knapsack-fractional": validator((r) => {
    const n = r.int(1, 100_000, "n");
    r.int(0, 1_000_000_000, "capacity");
    for (let i = 0; i < n; i++) {
      r.int(1, 1_000_000, `item ${i} value`);
      r.int(1, 1_000_000, `item ${i} weight`);
    }
  }),
};

export function getValidator(key: string): Validator {
  const found = REGISTRY[key];
  if (!found) {
    // A problem with no validator can never be used in a hack mode, and
    // silently allowing one is how the mechanic rots. Fail loudly.
    throw new Error(`No validator registered for key "${key}"`);
  }
  return found;
}

export const VALIDATOR_KEYS = Object.keys(REGISTRY);
