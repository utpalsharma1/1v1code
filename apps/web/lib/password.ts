import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/* ============================================================================
   Password primitives — deliberately free of any framework import.

   These were originally inside auth.ts alongside the cookie handling, which
   imports next/headers. That made them unusable and untestable anywhere except
   inside a Next request, including from the gateway. Pure crypto has no reason
   to depend on a request context.

   scrypt from node:crypto rather than bcrypt or argon2: it is memory-hard, it
   is in the standard library, and it avoids a dependency (§13.3).
   ========================================================================= */

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LEN = 64;

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

/** Opaque bearer token for a session row. Never a cuid — see auth.ts. */
export const newSessionToken = (): string => randomBytes(32).toString("base64url");
