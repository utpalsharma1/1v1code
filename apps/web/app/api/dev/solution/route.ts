import { solutionFor } from "@1v1/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* Dev-only: hand the sparring page the known-correct reference solution for a
   problem, so a developer can make a second player actually WIN without
   hand-writing a solution mid-match.

   These are the same reviewed solutions the seed verifier runs through the real
   judge (`pnpm db:solutions`), so a correct submission here is correct for the
   same reason the seed data is trustworthy. */

export async function GET(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "not available" }, { status: 404 });
  }

  const slug = new URL(request.url).searchParams.get("slug");
  if (!slug) return Response.json({ error: "slug is required" }, { status: 400 });

  try {
    return Response.json({ slug, language: "PYTHON3", source: solutionFor(slug) });
  } catch {
    return Response.json({ error: `no reference solution for ${slug}` }, { status: 404 });
  }
}
