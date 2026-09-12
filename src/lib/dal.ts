import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { AUTH_COOKIE } from "@/lib/session";

/** The session token from either the cookie (web) or an Authorization: Bearer
 *  header (the native app). Lets the same API serve both clients. */
async function sessionToken(): Promise<string | null> {
  const auth = (await headers()).get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim() || null;
  return (await cookies()).get(AUTH_COOKIE)?.value ?? null;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  isAdmin: boolean;
}

/** Resolve the session cookie to a user, or null. Never throws or redirects. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(AUTH_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { token },
    include: { user: { select: { id: true, email: true, name: true, isAdmin: true, status: true } } },
  });
  if (!session || session.expiresAt < new Date()) return null;
  if (session.user.status !== "active") return null;
  const { status: _status, ...user } = session.user;
  void _status;
  return user;
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Route-handler guard. This app has a single gate — you are either signed in or
 * you are not — because it holds only creative data. Fleur Financials keeps the
 * partitioned permission model; nothing here needs it.
 */
export async function apiRequireUser(): Promise<{ user: SessionUser } | { error: Response }> {
  const user = await getCurrentUser();
  if (!user) return { error: Response.json({ error: "Not signed in" }, { status: 401 }) };
  return { user };
}

// ── Creator app: guests welcome ───────────────────────────────────────────────
// The creator studio is open — a visitor gets a lightweight guest account. These
// resolvers accept "active" (team) OR "guest" users, so the studio works without
// a login while the dashboard (getCurrentUser/requireUser) stays team-only.

export interface CreatorUser extends SessionUser {
  isGuest: boolean;
}

export const getCreatorUser = cache(async (): Promise<CreatorUser | null> => {
  const token = await sessionToken();
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { token },
    include: { user: { select: { id: true, email: true, name: true, isAdmin: true, status: true } } },
  });
  if (!session || session.expiresAt < new Date()) return null;
  const { status, ...user } = session.user;
  if (status !== "active" && status !== "guest") return null;
  return { ...user, isGuest: status === "guest" };
});

export async function apiRequireCreator(): Promise<{ user: CreatorUser } | { error: Response }> {
  const user = await getCreatorUser();
  if (!user) return { error: Response.json({ error: "No session" }, { status: 401 }) };
  return { user };
}
