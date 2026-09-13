import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { apiRequireCreator } from "@/lib/dal";
import { CONTENT_TYPES } from "@/lib/reference/contentTypes";
import { toCard, type AssetWithAnalysis } from "@/lib/reference/lookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The onboarding content-type menu, each with a real example clip (the highest-
 * reach corpus video of that lane) so the creator sees exactly what it looks like.
 */
export async function GET() {
  const auth = await apiRequireCreator();
  if ("error" in auth) return auth.error;

  const types = await Promise.all(
    CONTENT_TYPES.map(async (ct) => {
      const asset = await db.referenceAsset.findFirst({
        where: { mediaUrl: { not: null }, analysis: { format: { in: ct.formats } } },
        orderBy: [{ reach: "desc" }],
        include: { analysis: true },
      });
      const card = asset?.analysis ? toCard(asset as AssetWithAnalysis) : null;
      return { key: ct.key, label: ct.label, description: ct.description, card };
    }),
  );

  return NextResponse.json({ types });
}
