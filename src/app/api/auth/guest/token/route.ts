import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createSessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Native-app guest onboarding. Mints a lightweight guest User + session and
 * returns the session token as JSON. The Expo app stores it in SecureStore and
 * sends it as `Authorization: Bearer <token>` on every /api/reference/* call —
 * the same guest row the web flow creates, so saves and swipe-learning work.
 *
 * Body (optional): { src?: string } — acquisition channel tag.
 */
export async function POST(req: Request) {
  let src: string | null = null;
  try {
    const body = (await req.json()) as { src?: unknown };
    if (typeof body?.src === "string") src = body.src.slice(0, 60);
  } catch {
    // no/invalid body is fine
  }

  const email = `guest_${randomBytes(9).toString("base64url")}@guest.fleur`;
  const user = await db.user.create({ data: { email, status: "guest", source: src } });
  const token = await createSessionToken(user.id);

  return NextResponse.json({ token, userId: user.id });
}
