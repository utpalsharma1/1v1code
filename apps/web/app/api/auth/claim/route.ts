import { currentUser } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { claimGuest } from "@/lib/guest";
import { parseBody } from "../body";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ============================================================================
   Claim a guest account (§7).

   The SAME row becomes a registered account, so match history, submissions and
   rating events follow by identity rather than migration. That is the entire
   reason to claim rather than create a second account.

   AUTHORISED BY HOLDING THE GUEST'S SESSION. Without it there is no way to prove
   the claimant is that guest, and allowing a claim by handle alone would let
   anyone adopt any guest's history. So a claim after the session expires is
   refused, and the caller is told to register normally instead — a new account,
   described honestly as one, rather than a silent failure.
   ========================================================================= */

export async function POST(request: Request): Promise<Response> {
  const user = await currentUser();
  if (!user) {
    return Response.json(
      {
        error:
          "This offer is tied to the browser session you played in, and it has expired. You can still create a normal account — it just won't carry that match.",
      },
      { status: 401 },
    );
  }

  const body = await parseBody(request);
  if (!body) return Response.json({ error: "unreadable request body" }, { status: 400 });
  const { handle, email, password } = body.fields;
  if (!handle || !email || !password) {
    return Response.json({ error: "handle, email and password are required" }, { status: 400 });
  }
  if (password.length < 10) {
    return Response.json({ error: "password must be at least 10 characters" }, { status: 400 });
  }

  const result = await claimGuest(user.id, {
    handle,
    email,
    passwordHash: await hashPassword(password),
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ ok: true, handle });
}
