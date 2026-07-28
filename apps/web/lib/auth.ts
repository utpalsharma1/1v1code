import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { prisma } from "@1v1/db";

/* ============================================================================
   Email/password auth (Phase 2A). No OAuth yet.

   Hashing uses node:crypto's scrypt rather than bcrypt/argon2, and sessions are
   opaque database rows rather than JWTs. Both choices avoid a dependency (§13.3)
   without weakening anything that matters: scrypt is memory-hard and in the
   standard library, and a DB-backed session can actually be revoked, which a
   stateless JWT cannot.
   ========================================================================= */

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LEN = 64;
const SESSION_COOKIE = "1v1_session";
const SESSION_DAYS = 30;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, KEY_LEN);
  return `scrypt$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  const derived = await scryptAsync(password, salt, expected.length);
  // Constant-time: a length-varying or short-circuiting compare leaks the hash
  // one byte at a time to anyone who can measure response latency.
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export interface Credentials {
  handle: string;
  email: string;
  password: string;
}

export type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; error: string };

const HANDLE = /^[a-zA-Z0-9_]{3,20}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function register(input: Credentials): Promise<AuthResult> {
  if (!HANDLE.test(input.handle)) {
    return { ok: false, error: "Handle must be 3–20 characters: letters, digits, underscore." };
  }
  if (!EMAIL.test(input.email)) return { ok: false, error: "That email doesn't look right." };
  if (input.password.length < 10) {
    return { ok: false, error: "Password must be at least 10 characters." };
  }

  const clash = await prisma.user.findFirst({
    where: { OR: [{ handle: input.handle }, { email: input.email.toLowerCase() }] },
    select: { id: true },
  });
  if (clash) return { ok: false, error: "That handle or email is already taken." };

  const user = await prisma.user.create({
    data: {
      handle: input.handle,
      email: input.email.toLowerCase(),
      passwordHash: await hashPassword(input.password),
    },
    select: { id: true },
  });
  return { ok: true, userId: user.id };
}

export async function login(email: string, password: string): Promise<AuthResult> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, passwordHash: true },
  });

  // Hash even when the user doesn't exist, so signup state can't be probed by
  // timing the response.
  const hash = user?.passwordHash ?? (await hashPassword("dummy-for-constant-time"));
  const valid = await verifyPassword(password, hash);

  if (!user || !valid) return { ok: false, error: "Wrong email or password." };
  return { ok: true, userId: user.id };
}

export async function createSession(userId: string): Promise<void> {
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const session = await prisma.session.create({
    data: { userId, expiresAt },
    select: { id: true },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (id) await prisma.session.deleteMany({ where: { id } });
  jar.delete(SESSION_COOKIE);
}

export interface CurrentUser {
  id: string;
  handle: string;
  rating: number;
}

export async function currentUser(): Promise<CurrentUser | null> {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (!id) return null;

  const session = await prisma.session.findUnique({
    where: { id },
    select: { expiresAt: true, user: { select: { id: true, handle: true, rating: true } } },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.deleteMany({ where: { id } });
    return null;
  }
  return session.user;
}
