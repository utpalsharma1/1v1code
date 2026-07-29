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

export async function POST(request: Request): Promise<Response> {
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
