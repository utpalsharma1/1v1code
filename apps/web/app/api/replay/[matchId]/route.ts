import { readFile } from "node:fs/promises";
import { replayDir } from "@1v1/core/paths";
import { join } from "node:path";
import { prisma } from "@1v1/db";

/* ============================================================================
   Serves a match's raw event log to the replay viewer.

   THE LOG IS THE REPLAY (§10), so the viewer gets the file rather than a
   pre-digested summary — anything this route computed would be a second
   implementation of playback that could disagree with the first.

   WHO MAY READ IT. A replay is of a FINISHED match, and §10's visibility table
   says both sides' source is public once the match ends. So a finished match's
   log is readable by anyone, exactly like `/watch/<code>` after the fact.

   A LIVE MATCH IS REFUSED. Serving its log would hand over both editors' source
   in real time, bypassing §7's 45-second ranked delay and §10's rule that a
   player may not spectate their own live match — a hole worth more than the
   whole spectator design, opened by a convenience route.
   ========================================================================= */

export const dynamic = "force-dynamic";

/* A match id is a UUID. The schema says so now — it used to declare a
   `@default(cuid())` that never fired, and this regex, written from the schema,
   rejected every real match with a 400. */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ matchId: string }> },
): Promise<Response> {
  const { matchId } = await params;

  /* The id indexes a filename, so it is validated as a shape before it is ever
     joined to a path. `join` with "../.." would otherwise walk out of the
     replay directory. */
  if (!ID.test(matchId)) {
    return Response.json({ error: "not a match id" }, { status: 400 });
  }

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: { state: true },
  });
  if (!match) return Response.json({ error: "no such match" }, { status: 404 });
  if (match.state !== "FINISHED" && match.state !== "ABANDONED") {
    return Response.json(
      { error: "this match is still live — replays exist only after a match ends" },
      { status: 409 },
    );
  }

  try {
    /* RESOLVE AGAINST THE REPO ROOT, NOT `process.cwd()`.
       The gateway writes `var/replays` relative to the repo root because that
       is where it runs; the Next server's cwd is `apps/web`, so the same
       relative path pointed at `apps/web/var/replays` and every finished match
       reported "no log was recorded". Two processes sharing a relative path
       only agree while they share a working directory. */
    const jsonl = await readFile(join(replayDir(), `${matchId}.jsonl`), "utf8");
    return new Response(jsonl, {
      headers: { "content-type": "application/x-ndjson; charset=utf-8" },
    });
  } catch {
    /* A finished match with no log on disk is possible — the gateway may have
       died before flushing. Say that, rather than 500ing. */
    return Response.json({ error: "no log was recorded for this match" }, { status: 404 });
  }
}
