/* Test identities for 2B-2. Registration UI lands in 2B-3; until then these
   let the gateway exercise real session cookies instead of a stubbed id. */
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

const USERS = [
  { handle: "arjun_dev", email: "arjun@example.com", rating: 1442 },
  { handle: "rohan_x", email: "rohan@example.com", rating: 1478 },
  { handle: "bot_ada", email: "bot@example.com", rating: 1460 },
];

async function main() {
  const passwordHash = await hash("dev-password-1v1");
  for (const u of USERS) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      create: { ...u, passwordHash },
      update: { rating: u.rating },
    });
    const token = randomBytes(32).toString("base64url");
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.session.create({
      data: {
        id: token,
        userId: user.id,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    console.log(`  ${u.handle.padEnd(12)} rating ${u.rating}`);
    console.log(`    document.cookie = "1v1_session=${token}; path=/"`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
