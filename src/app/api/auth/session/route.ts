import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createSession, destroySession, hashPassword, verifyPassword } from "@/lib/session";

// Bootstrap credentials. Used exactly once — the first successful login on an
// empty user table creates the owner account. After that every login goes
// through the database.
const BOOTSTRAP_EMAIL = process.env.AUTH_EMAIL ?? "team@tryfleur.com";
const BOOTSTRAP_PASSWORD = process.env.AUTH_PASSWORD ?? "";

export async function POST(req: Request) {
  const { email, password } = (await req.json()) as { email?: string; password?: string };
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }
  const normalised = email.trim().toLowerCase();

  const userCount = await db.user.count();
  if (userCount === 0) {
    if (
      !BOOTSTRAP_PASSWORD ||
      normalised !== BOOTSTRAP_EMAIL.toLowerCase() ||
      password !== BOOTSTRAP_PASSWORD
    ) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }
    const owner = await db.user.create({
      data: {
        email: normalised,
        name: "Owner",
        passwordHash: await hashPassword(password),
        isAdmin: true,
        status: "active",
        lastLoginAt: new Date(),
      },
    });
    await createSession(owner.id);
    return NextResponse.json({ ok: true, redirectTo: "/" });
  }

  const user = await db.user.findUnique({ where: { email: normalised } });
  // Same response for unknown user and wrong password, and always run a hash
  // comparison so timing does not reveal which case it was.
  const ok = await verifyPassword(password, user?.passwordHash ?? null);
  if (!user || !ok) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  if (user.status !== "active") {
    return NextResponse.json({ error: "Account is not active" }, { status: 403 });
  }

  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await createSession(user.id);
  return NextResponse.json({ ok: true, redirectTo: "/" });
}

export async function DELETE() {
  await destroySession();
  return NextResponse.json({ ok: true });
}
