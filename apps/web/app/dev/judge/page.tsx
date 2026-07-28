import { prisma } from "@1v1/db";
import { JudgeConsole } from "./JudgeConsole";

export const dynamic = "force-dynamic";

/**
 * §12 Phase 2A — see the judge work before it is buried under networking, for
 * the same reason /dev/hud exists.
 */
export default async function JudgeDevPage() {
  let problems: { slug: string; title: string; rating: number; topic: string; statement: string; constraints: string; tests: number }[] = [];
  let dbError: string | null = null;

  try {
    const rows = await prisma.problem.findMany({
      orderBy: { rating: "asc" },
      select: {
        slug: true,
        title: true,
        rating: true,
        topic: true,
        statement: true,
        constraints: true,
        _count: { select: { testCases: true } },
      },
    });
    problems = rows.map((r) => ({
      slug: r.slug,
      title: r.title,
      rating: r.rating,
      topic: r.topic,
      statement: r.statement,
      constraints: r.constraints,
      tests: r._count.testCases,
    }));
  } catch (error) {
    dbError = error instanceof Error ? error.message : String(error);
  }

  return <JudgeConsole problems={problems} dbError={dbError} />;
}
