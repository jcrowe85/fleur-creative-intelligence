import { NextResponse } from "next/server";
import { apiRequireCreator } from "@/lib/dal";
import { buildFeed } from "@/lib/reference/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The single gap-weighted, pillar-interleaved swipe feed for this creator. */
export async function GET() {
  const auth = await apiRequireCreator();
  if ("error" in auth) return auth.error;
  return NextResponse.json({ cards: await buildFeed(auth.user.id) });
}
