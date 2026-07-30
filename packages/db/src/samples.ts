/* ============================================================================
   pnpm db:samples <slug> — DERIVE sample outputs, never type them.

   The known failure mode, caught on the very first retrofit: I hand-wrote a
   Connected Components case with n = 6 and asserted 4 components when the answer
   is 5, because I forgot a vertex. `db:verify` caught it, but only after it was
   already written down — and a wrong SAMPLE is worse than a wrong hidden test,
   because a player reads it and trusts it.

   So this converts the standard from a discipline into a mechanism, the same
   move as the payload constructors and the unreachable lobby: it runs the
   problem's own reference solution over each input and prints what to paste. An
   expected output that was never typed cannot be mistyped.

   IT VALIDATES AS WELL AS GENERATES. Every input goes through the problem's own
   validator first, because a sample that violates the stated constraints teaches
   the wrong contract — the same class as the seeded problem whose test data
   broke its own stated bound. A sample is the most authoritative thing a player
   reads; it must be inside the rules it is demonstrating.

   Usage:
     pnpm db:samples connected-components          # existing samples
     pnpm db:samples connected-components --stdin  # candidate inputs on stdin,
                                                   # blank line between cases
   ========================================================================= */

import { spawn } from "node:child_process";
import { PROBLEMS } from "./problems.ts";
import { solutionFor } from "./solutions.ts";
import { getValidator } from "./validators.ts";

interface Case {
  input: string;
  /** What the problem currently claims, when checking an existing sample. */
  claimed?: string;
}

/** Runs the reference solution over one input, in-process, via python3. */
function runReference(source: string, input: string): Promise<{ out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["-c", source], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("reference solution did not finish in 10s"));
    }, 10_000);

    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve({ out, err });
    });
    child.stdin.end(input);
  });
}

/** Escape a string for pasting straight into the seed file. */
function asLiteral(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

async function main(): Promise<void> {
  const slug = process.argv[2];
  const fromStdin = process.argv.includes("--stdin");

  if (!slug) {
    console.error("usage: pnpm db:samples <slug> [--stdin]");
    process.exit(2);
  }

  const problem = PROBLEMS.find((p) => p.slug === slug);
  if (!problem) {
    console.error(`unknown problem "${slug}"`);
    console.error(`known: ${PROBLEMS.map((p) => p.slug).join(", ")}`);
    process.exit(2);
  }

  let source: string;
  try {
    source = solutionFor(slug);
  } catch {
    console.error(`no reference solution for ${slug} — write it before its samples`);
    process.exit(2);
  }

  const validator = getValidator(problem.validatorKey);
  if (!validator) {
    console.error(`unknown validator "${problem.validatorKey}" for ${slug}`);
    process.exit(2);
  }

  let cases: Case[];
  if (fromStdin) {
    const raw = await new Promise<string>((resolve) => {
      let buf = "";
      process.stdin.on("data", (d) => (buf += d.toString()));
      process.stdin.on("end", () => resolve(buf));
    });
    cases = raw
      .split(/\n\s*\n/)
      .map((block) => block.trim())
      .filter((block) => block.length > 0)
      .map((block) => ({ input: `${block}\n` }));
  } else {
    cases = problem.tests
      .filter((t) => t.isSample)
      .map((t) => ({ input: t.input, claimed: t.expected }));
  }

  if (cases.length === 0) {
    console.error(`${slug} has no samples yet — pass candidates with --stdin`);
    process.exit(2);
  }

  console.log(`${problem.title} (${slug}), rated ${problem.rating}`);
  console.log(`validator: ${problem.validatorKey}\n`);

  let failures = 0;

  for (const [index, testCase] of cases.entries()) {
    const label = `sample ${index + 1}`;

    /* VALIDATE FIRST. Generating an output for an input the problem forbids
       would produce a confidently wrong sample. */
    const verdict = validator(testCase.input);
    if (!verdict.ok) {
      console.error(`  ${label}: INPUT REJECTED BY THE VALIDATOR — ${verdict.reason}`);
      console.error(`    ${asLiteral(testCase.input)}`);
      console.error("    A sample must obey the constraints it demonstrates.\n");
      failures += 1;
      continue;
    }

    let result: { out: string; err: string };
    try {
      result = await runReference(source, testCase.input);
    } catch (error) {
      console.error(`  ${label}: reference solution failed — ${String(error)}\n`);
      failures += 1;
      continue;
    }
    if (result.err.trim().length > 0) {
      console.error(`  ${label}: reference wrote to stderr — ${result.err.trim()}\n`);
      failures += 1;
      continue;
    }

    const derived = result.out;
    const drift = testCase.claimed !== undefined && testCase.claimed !== derived;

    console.log(`  ${label}`);
    console.log(`    input:    ${asLiteral(testCase.input)}`);
    console.log(`    expected: ${asLiteral(derived)}   <- paste this`);
    if (drift) {
      console.error(`    MISMATCH: the seed currently claims ${asLiteral(testCase.claimed!)}`);
      failures += 1;
    }
    console.log("");
  }

  if (failures > 0) {
    console.error(`${failures} problem(s). Nothing was written — fix and re-run.`);
    process.exit(1);
  }
  console.log(
    cases.length === 1
      ? "1 sample: input validates, output derived from the reference."
      : `${cases.length} samples: every input validates, every output derived from the reference.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
