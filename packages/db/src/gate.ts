/* ============================================================================
   pnpm db:verify — the bank gate. Every pass, every time.

   Nothing enters the problem bank without clearing all of these:

     1. verify-seed   the format is complete, and every expected output agrees
                      with the reference solution and passes the validator
     2. audit-wrong   no plausible wrong approach survives the test set
     3. coverage      every stated numeric bound is reached by a test, or
                      exempted with a recorded reason

   WHY THESE ARE SEPARATE PROCESSES, and not three function calls.

   Last session the format check inside verify-seed ended in a hard
   `process.exit(1)` placed before the reference-solution loop. One problem
   missing a `note` therefore took the check that catches WRONG EXPECTED OUTPUTS
   offline for all twenty problems — the weaker gate silently disabling the
   stronger one. It was fixed by reordering, and reordering is a promise that
   the next edit can quietly break: any `process.exit`, any early `return`, any
   thrown error in pass 1 puts pass 2 back to sleep, and the symptom is a green
   tick rather than a failure.

   A child process cannot exit another child process. Running each pass in its
   own process makes the guarantee structural rather than disciplinary: pass 2
   runs even if pass 1 segfaults, and the exit code accounts for all three no
   matter how any one of them dies. That is the difference between a bug that
   was fixed and a bug that cannot recur.

   Each pass also stays runnable on its own — `pnpm db:audit`, `pnpm
   db:coverage` — because when one fails you want to iterate on it alone.
   ========================================================================= */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

interface Pass {
  name: string;
  script: string;
  /** What a failure here means, in one line. */
  meaning: string;
}

const PASSES: Pass[] = [
  {
    name: "verify-seed",
    script: "verify-seed.ts",
    meaning: "a problem is unsolvable as presented, or an expected output is wrong",
  },
  {
    name: "audit-wrong",
    script: "audit-wrong.ts",
    meaning: "a plausible wrong approach passes the tests — the judge accepts wrong code",
  },
  {
    name: "coverage",
    script: "coverage.ts",
    meaning: "a stated bound is never posed by any test, and is not exempted",
  },
];

function run(pass: Pass): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", join(here, pass.script)],
      { stdio: "inherit" },
    );
    /* `close`, not `exit`, so inherited output has finished flushing. A signal
       death reports as a failure rather than as a 0. */
    child.on("close", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
    child.on("error", () => resolve(1));
  });
}

const results: { pass: Pass; code: number }[] = [];

for (const pass of PASSES) {
  console.log(`\n${"=".repeat(78)}\n  ${pass.name}\n${"=".repeat(78)}`);
  /* Sequential and unconditional. No `break`, no early return — a failing pass
     must not stop a later one from reporting, because the whole point is to see
     every problem with the bank at once rather than one per run. */
  results.push({ pass, code: await run(pass) });
}

console.log(`\n${"=".repeat(78)}\n  bank gate\n${"=".repeat(78)}`);
for (const { pass, code } of results) {
  console.log(`  ${code === 0 ? "pass" : "FAIL"}  ${pass.name.padEnd(14)} ${pass.meaning}`);
}

const failed = results.filter((r) => r.code !== 0);
if (failed.length === 0) {
  console.log("\nThe bank is sound: presentable, correct, discriminating, and covered.");
} else {
  console.error(`\n${failed.length} of ${PASSES.length} pass(es) failed. Nothing was seeded.`);
}
process.exit(failed.length === 0 ? 0 : 1);
