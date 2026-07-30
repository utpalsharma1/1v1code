/* Idempotent seed. Safe to re-run; upserts by slug. */

import { PrismaClient, type Topic } from "@prisma/client";
import { PROBLEMS, assertSeedIntegrity } from "../src/problems.ts";
import { VALIDATOR_KEYS } from "../src/validators.ts";

const prisma = new PrismaClient();

async function main() {
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
