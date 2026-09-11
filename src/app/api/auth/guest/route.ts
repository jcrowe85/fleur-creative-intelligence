import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCreatorUser } from "@/lib/dal";
import { createSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Only ever redirect within the app. */
function safeNext(n: string | null): string {
  if (!n || !n.startsWith("/") || n.startsWith("//")) return "/tools/creator";
  return n;
}

/**
 * Instant guest access for the creator studio: if there's no session yet, mint a
 * lightweight guest account + session, then continue to `next`. The guest is a
 * real User row (status "guest") so saves and the swipe-learning work
 * immediately, and "claiming" it later is just adding an email to the same row.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get("next"));
  const source = url.searchParams.get("src")?.slice(0, 60) || null;

  const existing = await getCreatorUser();
  if (!existing) {
    const email = `guest_${randomBytes(9).toString("base64url")}@guest.fleur`;
    const user = await db.user.create({ data: { email, status: "guest", source } });
    await createSession(user.id); // sets the session cookie
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
