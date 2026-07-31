import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/* NOTHING ENTERS THE BANK WITHOUT SURVIVING THE GATE.

   `db:verify` runs all three passes (format + reference correctness, the
   wrong-approach audit, constraint coverage) in separate child processes, so no
   pass can take another offline. Seeding runs it first and refuses on failure,
   because a tool you have to remember to run is one you will eventually forget
   on the day it mattered.

   THERE IS NO OVERRIDE, AND THAT IS DELIBERATE. There used to be one —
   ALLOW_UNSOUND_BANK — which existed for the weeks the bank was knowingly
   incomplete and refusing to seed would have made the app unrunnable. The gate
   is green now, so the flag has been DELETED rather than left in place
   disabled. A soundness override with no current purpose is exactly what gets
   re-enabled during a deploy problem at 2am, by someone who needs the seed to
   work and will not read why it was refused. If a future bank is again
   knowingly incomplete, reintroduce it then, deliberately, with the same
   production refusal it had. */

/* Idempotent seed. Safe to re-run; upserts by slug. */

import { PrismaClient, type Topic } from "@prisma/client";
import { PROBLEMS, assertSeedIntegrity } from "../src/problems.ts";
import { VALIDATOR_KEYS } from "../src/validators.ts";

const prisma = new PrismaClient();

async function main() {
  /* THE OVERRIDE CANNOT EXIST IN PRODUCTION, and that is enforced here rather
     than trusted to a checklist.

     A flag that disables a soundness gate is exactly the kind of thing that
     survives into a deploy script: someone hits the gate while setting up
     staging, exports it to get unblocked, and it is still in the environment
     six months later when it is silently seeding a bank nobody has verified.
     The failure is invisible — seeding SUCCEEDS, which is the whole problem.

     So production refuses the override outright and says why. A checklist entry
     asks a human to remember; this makes remembering unnecessary. The checklist
     entry stays too (see PROGRESS.md, Phase 2E), because defence in depth on a
     control whose failure mode is silence is cheap. */
  const gate = spawnSync(
    process.execPath,
    ["--experimental-strip-types", join(dirname(fileURLToPath(import.meta.url)), "../src/gate.ts")],
    { stdio: "inherit" },
  );
  if (gate.status !== 0) {
    console.error("\nThe bank gate failed, so nothing was seeded. Fix what it reported above.");
    process.exit(1);
  }

  // Refuse to write a problem set that doesn't hold together.
  assertSeedIntegrity(VALIDATOR_KEYS);

  for (const problem of PROBLEMS) {
    const row = await prisma.problem.upsert({
      where: { slug: problem.slug },
      create: {
        slug: problem.slug,
        title: problem.title,
        topic: problem.topic as Topic,
        statement: problem.statement,
        inputFormat: problem.inputFormat ?? "",
        outputFormat: problem.outputFormat ?? "",
        note: problem.note ?? "",
        constraints: problem.constraints.join("\n"),
        rating: problem.rating,
        validatorKey: problem.validatorKey,
      },
      update: {
        title: problem.title,
        topic: problem.topic as Topic,
        statement: problem.statement,
        inputFormat: problem.inputFormat ?? "",
        outputFormat: problem.outputFormat ?? "",
        note: problem.note ?? "",
        constraints: problem.constraints.join("\n"),
        rating: problem.rating,
        validatorKey: problem.validatorKey,
      },
    });

    // Replace test cases wholesale — they're derived data, and partial updates
    // would leave orphans when a problem's test count shrinks.
    await prisma.testCase.deleteMany({ where: { problemId: row.id } });
    await prisma.testCase.createMany({
      data: problem.tests.map((test, ordinal) => ({
        problemId: row.id,
        ordinal,
        input: test.input,
        expected: test.expected,
        isSample: test.isSample ?? false,
      })),
    });

    console.log(
      `  ${problem.slug.padEnd(32)} ${String(problem.rating).padStart(4)}  ${problem.topic.padEnd(8)} ${problem.tests.length} tests`,
    );
  }

  console.log(`\nSeeded ${PROBLEMS.length} problems.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
