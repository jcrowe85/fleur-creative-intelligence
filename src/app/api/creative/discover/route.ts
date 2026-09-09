import { NextResponse } from "next/server";
import { apiRequireUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { discoverAssets } from "@/lib/creative/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Walks the ad account and upserts one row per distinct creative asset.
 * Safe to re-run: existing assets have their ad list and lastSeen refreshed,
 * and their analysis is left alone.
 */
export async function POST(req: Request) {
  const auth = await apiRequireUser();
  if ("error" in auth) return auth.error;

  try {
    const { activeOnly } = (await req.json().catch(() => ({}))) as { activeOnly?: boolean };
    const found = await discoverAssets({ activeOnly: Boolean(activeOnly) });

    let created = 0;
    let updated = 0;
    for (const a of found) {
      const existing = await db.creativeAsset.findUnique({
        where: { assetKey: a.assetKey },
        select: { id: true },
      });
      if (existing) {
        await db.creativeAsset.update({
          where: { assetKey: a.assetKey },
          data: {
            adIds: a.adIds,
            lastSeen: new Date(),
            // Backfill copy that was missing when first discovered, but never
            // overwrite what is already recorded.
            headline: a.headline ?? undefined,
            primaryText: a.primaryText ?? undefined,
            destinationUrl: a.destinationUrl ?? undefined,
            thumbUrl: a.thumbUrl ?? undefined,
          },
        });
        updated++;
      } else {
        await db.creativeAsset.create({
          data: {
            assetKey: a.assetKey,
            assetType: a.assetType,
            name: a.name,
            adIds: a.adIds,
            thumbUrl: a.thumbUrl,
            headline: a.headline,
            primaryText: a.primaryText,
            destinationUrl: a.destinationUrl,
          },
        });
        created++;
      }
    }

    const unanalyzed = await db.creativeAsset.count({ where: { analysis: null } });
    return NextResponse.json({ discovered: found.length, created, updated, unanalyzed });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Discovery failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
