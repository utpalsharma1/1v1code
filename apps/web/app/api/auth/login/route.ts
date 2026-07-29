import { createSession, login } from "@/lib/auth";
import { formRedirect, parseBody } from "../body";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const body = await parseBody(request);
  if (!body) return Response.json({ error: "unreadable request body" }, { status: 400 });

  const { fields, isFormPost } = body;
  const { email, password } = fields;

  if (!email || !password) {
    const error = "email and password are required";
    return isFormPost
      ? formRedirect(request, "/login", error)
      : Response.json({ error }, { status: 400 });
  }

  const result = await login(email, password);
  // Deliberately does not say which field was wrong, so the endpoint cannot be
  // used to enumerate who has an account.
  if (!result.ok) {
    return isFormPost
      ? formRedirect(request, "/login", result.error)
      : Response.json({ error: result.error }, { status: 401 });
  }

  await createSession(result.userId);
  return isFormPost ? formRedirect(request, "/play") : Response.json({ ok: true });
}
