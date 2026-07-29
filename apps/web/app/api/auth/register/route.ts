import { createSession, register } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* Route handlers rather than server actions, deliberately.

   A server action can only be invoked through the RSC protocol, which means it
   cannot be driven by a test without reproducing that protocol — so the sign-in
   path was untestable, and it broke exactly there. The form now posts JSON to
   this endpoint, so the end-to-end test drives the same code the browser does.
   That is the whole point: a test that exercises a different entry point than
   the UI can pass while the UI is broken. */

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const { handle, email, password } = (body ?? {}) as Record<string, unknown>;
  if (typeof handle !== "string" || typeof email !== "string" || typeof password !== "string") {
    return Response.json({ error: "handle, email and password are required" }, { status: 400 });
  }

  const result = await register({ handle, email, password });
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });

  await createSession(result.userId);
  return Response.json({ ok: true, handle });
}
