import { createSession, login } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const { email, password } = (body ?? {}) as Record<string, unknown>;
  if (typeof email !== "string" || typeof password !== "string") {
    return Response.json({ error: "email and password are required" }, { status: 400 });
  }

  const result = await login(email, password);
  // Deliberately does not say which field was wrong, so the endpoint cannot be
  // used to enumerate who has an account.
  if (!result.ok) return Response.json({ error: result.error }, { status: 401 });

  await createSession(result.userId);
  return Response.json({ ok: true });
}
