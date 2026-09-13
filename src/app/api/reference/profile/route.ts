import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { apiRequireCreator } from "@/lib/dal";
import { CONTENT_TYPE_KEYS } from "@/lib/reference/contentTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The creator's saved onboarding content-type selection. */
export async function GET() {
  const auth = await apiRequireCreator();
  if ("error" in auth) return auth.error;
  const u = await db.user.findUnique({ where: { id: auth.user.id }, select: { contentTypes: true } });
  return NextResponse.json({ contentTypes: u?.contentTypes ?? [] });
}

/** Save the creator's content-type selection ({ contentTypes: string[] }). Seeds
 *  the feed. Unknown keys are dropped. */
export async function POST(req: Request) {
  const auth = await apiRequireCreator();
  if ("error" in auth) return auth.error;

  const body = (await req.json().catch(() => ({}))) as { contentTypes?: unknown };
  const raw = Array.isArray(body.contentTypes) ? body.contentTypes : [];
  const contentTypes = [
    ...new Set(raw.filter((x): x is string => typeof x === "string" && CONTENT_TYPE_KEYS.has(x))),
  ];

  await db.user.update({ where: { id: auth.user.id }, data: { contentTypes } });
  return NextResponse.json({ contentTypes });
}
