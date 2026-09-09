// Server-side session + password primitives.
//
// Sessions are DB-backed (see the Session model): the cookie carries an opaque
// random token, and every request resolves it against the database. That costs
// one indexed lookup per request but means revoking a user takes effect
// immediately rather than whenever their JWT happens to expire.
//
// Passwords use scrypt from node:crypto — no extra dependency, and it is the
// memory-hard KDF Node ships for exactly this.

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { db } from "@/lib/db";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

export const AUTH_COOKIE = "fleur_creative_session";
export const SESSION_DAYS = 30;
const KEYLEN = 64;

// ── passwords ───────────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEYLEN);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, "hex");
  const derived = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

// ── tokens ──────────────────────────────────────────────────────────────────

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

// ── session lifecycle ───────────────────────────────────────────────────────

export async function createSession(userId: string): Promise<string> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await db.session.create({ data: { token, userId, expiresAt } });

  const jar = await cookies();
  jar.set(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
    path: "/",
  });

  // Opportunistic cleanup so expired rows do not accumulate.
  db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});

  return token;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(AUTH_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { token } }).catch(() => {});
  jar.delete(AUTH_COOKIE);
}
