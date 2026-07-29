/* Test identities for local development.

   IDEMPOTENT ON PURPOSE. The previous version called `session.deleteMany`
   before creating a new session, so every run rotated all three tokens and
   silently invalidated any cookie already sitting in a browser. That turned
   "re-run the seed" into "log everyone out" — and it is a miserable thing to
   debug, because the symptom (server rejects a cookie the browser is holding)
   is indistinguishable from a cookie-delivery bug.

   Now it reuses any session with enough life left and only mints a new one when
   there isn't one. Re-running is safe. */

import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const scryptAsync = promisify(scrypt) as (p: string, s: Buffer, k: number) => Promise<Buffer>;

async function hash(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${derived.toString("base64")}`;
}

const PASSWORD = "dev-password-1v1";
const SESSION_DAYS = 30;
/** Reuse an existing session only if it still has this long to run. */
const MIN_REMAINING_MS = 24 * 60 * 60 * 1000;

const USERS = [
  { handle: "arjun_dev", email: "arjun@example.com", rating: 1442 },
  { handle: "rohan_x", email: "rohan@example.com", rating: 1478 },
  { handle: "bot_ada", email: "bot@example.com", rating: 1460 },
];

async function main() {
  for (const u of USERS) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      create: { ...u, passwordHash: await hash(PASSWORD) },
      update: { rating: u.rating },
    });

    const existing = await prisma.session.findFirst({
      where: { userId: user.id, expiresAt: { gt: new Date(Date.now() + MIN_REMAINING_MS) } },
      orderBy: { expiresAt: "desc" },
      select: { id: true },
    });

    let token = existing?.id;
    if (!token) {
      token = randomBytes(32).toString("base64url");
      await prisma.session.create({
        data: {
          id: token,
          userId: user.id,
          expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
        },
      });
    }

    console.log(
      `  ${u.handle.padEnd(12)} rating ${u.rating}  ${existing ? "(reused existing session)" : "(new session)"}`,
    );
    console.log(`    email ${u.email}   password ${PASSWORD}`);
    console.log(`    token ${token}`);
  }

  console.log(
    [
      "",
      "SIGN IN THROUGH THE UI: http://localhost:3000/login",
      "There is no cookie to paste and no console step — use the email and password above.",
      "",
      "The tokens exist only for headless probes. Re-running this seed does NOT rotate them.",
    ].join("\n"),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
