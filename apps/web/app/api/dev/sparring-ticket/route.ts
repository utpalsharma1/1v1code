import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import Redis from "ioredis";
import { prisma } from "@1v1/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ============================================================================
   Dev-only: a socket ticket for a SECOND identity.

   §13.6's reasoning, applied to a phase that no longer has a bot: you cannot
   judge what you cannot reproduce. 2B-4 is human vs human, so every beat now
   needs two players and coordinated timing — and the §6.7b hold specifically
   needs two submissions whose verdicts return in the *opposite* order to their
   receipt, which is close to impossible to stage by hand.

   This is NOT a bot and must never become one. It has no solve model, no
   rating integrity rules, no labelling, and no human-like typing. It is a
   second account that a developer can drive from a page, and it lives behind a
   production guard so it cannot leak into the product.
   ========================================================================= */

const REDIS_URL = process.env["REDIS_URL"] ?? "redis://localhost:6379";
const TICKET_TTL_SECONDS = 60;

/* Deliberately its own account, so it never borrows the developer's identity
   and never collides with the seeded users a human might be signed in as.

   One identity PER TAB, not one shared account. A single shared partner made
   two tabs — or two automated tests — fight over the same session: whichever
   one was still in a match silently swallowed the other's queue.join, because
   the gateway keys everything on user id. Per-tab identities also mean you can
   open three and stage a three-way. */
const SPARRING_PREFIX = "sparring";

const scryptAsync = promisify(scrypt) as (p: string, s: Buffer, k: number) => Promise<Buffer>;

let client: Redis | null = null;
function redis(): Redis {
  client ??= new Redis(REDIS_URL, { maxRetriesPerRequest: 2 });
  return client;
}

export async function POST(request: Request): Promise<Response> {
  // The one guard that matters. Everything else here is a convenience.
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "not available" }, { status: 404 });
  }

  /* `?as=` lets a tab keep a stable identity across reloads, which is what you
     want when watching a rating move. Without it each tab gets a fresh one. */
  const requested = new URL(request.url).searchParams.get("as");
  const suffix = (requested ?? randomBytes(3).toString("hex")).replace(/[^a-z0-9_]/gi, "").slice(0, 12);
  const handle = `${SPARRING_PREFIX}_${suffix || "x"}`;
  const email = `${handle}@example.invalid`;

  const salt = randomBytes(16);
  const derived = await scryptAsync(randomBytes(24).toString("hex"), salt, 64);

  const user = await prisma.user.upsert({
    where: { email },
    create: {
      handle,
      email,
      // No usable password: this account is only ever reachable through this
      // route, which does not exist in production.
      passwordHash: `scrypt$${salt.toString("base64")}$${derived.toString("base64")}`,
      rating: 1200,
    },
    update: {},
    select: { id: true, handle: true, rating: true },
  });

  const ticket = randomBytes(32).toString("base64url");
  await redis().set(`socket:ticket:${ticket}`, user.id, "EX", TICKET_TTL_SECONDS);

  return Response.json({ ticket, handle: user.handle, rating: user.rating });
}
