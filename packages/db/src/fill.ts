/* ============================================================================
   pnpm db:fill — derive every empty `expected` from the reference solution.

   `db:samples` covers samples and takes candidates on stdin. This covers the
   other case: a test whose input is GENERATED, where the whole point is that
   nobody typed the input either, so nobody can paste it into another tool.

   It runs the problem's own reference over the exact input the seed will ship —
   the same `PROBLEMS` object, not a copy — and prints the literal to paste. An
   input that reached this point has already passed its generator's assertions
   at module load, which is what stops the reference from confidently answering
   the wrong question.

   Placeholder is `expected: ""`. Nothing else is touched.
   ========================================================================= */

import { spawn } from "node:child_process";
import { PROBLEMS } from "./problems.ts";
import { solutionFor } from "./solutions.ts";
import { getValidator } from "./validators.ts";

const normalise = (t: string): string =>
  t.trim().split("\n").map((l) => l.replace(/\s+$/, "")).join("\n");

function runReference(source: string, input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["-c", source]);
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("reference did not finish in 120s"));
    }, 120_000);
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", () => {
      clearTimeout(timer);
      if (err.trim().length > 0) reject(new Error(err.trim()));
      else resolve(normalise(out));
    });
    child.stdin.end(input);
  });
}

let filled = 0;
let failed = 0;

for (const problem of PROBLEMS) {
  const pending = problem.tests
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.expected === "");
  if (pending.length === 0) continue;

  console.log(`\n${problem.slug}  (${problem.rating})`);
  const validate = getValidator(problem.validatorKey);

  for (const { t, i } of pending) {
    const check = validate(t.input);
    if (!check.ok) {
      console.error(`  test ${i}: INPUT REJECTED BY THE VALIDATOR — ${check.reason}`);
      failed += 1;
      continue;
    }
    try {
      const derived = await runReference(solutionFor(problem.slug), t.input);
      const head =
        t.input.length > 40 ? `${t.input.slice(0, 40).replace(/\n/g, "\\n")}… (${t.input.length}B)` : JSON.stringify(t.input);
      console.log(`  test ${i}  ${head}\n           expected: ${JSON.stringify(derived)}`);
      filled += 1;
    } catch (error) {
      console.error(`  test ${i}: reference failed — ${String(error)}`);
      failed += 1;
    }
  }
}

console.log(
  `\n${filled} derived, ${failed} failed. Paste them in; nothing was written automatically.`,
);
process.exit(failed === 0 ? 0 : 1);
