import { destroySession } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  await destroySession();
  return Response.json({ ok: true });
}
