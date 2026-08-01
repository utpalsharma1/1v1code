import { createSession, register } from "@/lib/auth";
import { formRedirect, parseBody } from "../body";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* Route handlers rather than server actions, deliberately.

   A server action can only be invoked through the RSC protocol, which means it
   cannot be driven by a test without reproducing that protocol — so the sign-in
   path was untestable, and it broke exactly there. The form now posts to this
   endpoint, so the end-to-end test drives the same code the browser does. That
   is the whole point: a test that exercises a different entry point than the UI
   can pass while the UI is broken.

   It accepts a JSON fetch and a native form post, because the form must still
   work when JavaScript does not. See ../body.ts. */

/* NOTHING MAY LEAVE THIS ROUTE AS A 500 WITH AN EMPTY BODY.

   That is what an unhandled throw becomes in a Next route handler, and it is
   the single worst shape a failure can take here: the client calls
   `response.json()`, gets "Unexpected end of JSON input", and the real error
   exists only in a server log nobody is reading. It cost a registration outage
   that looked like a client bug.

   Two distinct cases are handled below, and they are different in kind:

   - A DUPLICATE HANDLE OR EMAIL IS NOT AN ERROR. Somebody picking a taken name
     is an ordinary event and gets a 409 with a sentence they can act on.
     `register()` already checks for a clash, but that check and the insert are
     not atomic, so two simultaneous signups can both pass it and one will hit
     the unique index. Prisma raises P2002 for that, and it must land in the
     same place as the polite check rather than as a server error.

   - ANYTHING ELSE IS OURS. A missing DATABASE_URL, a dead connection, a bug —
     the player gets a 500 with a readable JSON message and a marker, and the
     real cause is logged server-side with the marker so the two can be matched
     up. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export async function POST(request: Request): Promise<Response> {
  try {
    return await handle(request);
  } catch (cause) {
    if (isUniqueViolation(cause)) {
      return Response.json(
        { error: "That handle or email is already taken." },
        { status: 409 },
      );
    }
    const marker = Math.random().toString(36).slice(2, 8);
    console.error(`[register:${marker}] unhandled failure`, cause);
    return Response.json(
      { error: `Something went wrong on our side. Reference ${marker}.` },
      { status: 500 },
    );
  }
}

async function handle(request: Request): Promise<Response> {
  const body = await parseBody(request);
  if (!body) return Response.json({ error: "unreadable request body" }, { status: 400 });

  const { fields, isFormPost } = body;
  const { handle, email, password } = fields;

  if (!handle || !email || !password) {
    const error = "handle, email and password are required";
    return isFormPost
      ? formRedirect(request, "/register", error)
      : Response.json({ error }, { status: 400 });
  }

  const result = await register({ handle, email, password });
  if (!result.ok) {
    return isFormPost
      ? formRedirect(request, "/register", result.error)
      : Response.json({ error: result.error }, { status: 400 });
  }

  await createSession(result.userId);
  return isFormPost ? formRedirect(request, "/play") : Response.json({ ok: true, handle });
}
