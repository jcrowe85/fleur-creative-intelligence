import { NextResponse } from "next/server";
import { apiRequireUser } from "@/lib/dal";
import { findReferences } from "@/lib/reference/lookup";
import { actionedAssetIds } from "@/lib/reference/saves";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The swipe deck for a pillar: durable reference ads the user hasn't swiped yet. */
export async function GET(req: Request) {
  const auth = await apiRequireUser();
  if ("error" in auth) return auth.error;

  const params = new URL(req.url).searchParams;
  const pillar = params.get("pillar");
  if (!pillar) return NextResponse.json({ error: "pillar is required" }, { status: 400 });

  const persona = params.get("persona") ?? undefined;
  const funnel = params.get("funnel") ?? undefined;

  const [matches, actioned] = await Promise.all([
    findReferences({ pillar, persona, funnel, limit: 60 }),
    actionedAssetIds(auth.user.id),
  ]);

  return NextResponse.json({ cards: matches.filter((m) => !actioned.has(m.id)) });
}
