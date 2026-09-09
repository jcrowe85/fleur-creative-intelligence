import { NextResponse } from "next/server";
import { apiRequireUser } from "@/lib/dal";
import { syncAssets } from "@/lib/creative/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** The "Pull assets from Meta" button. Same code path as the daily cron. */
export async function POST(req: Request) {
  const auth = await apiRequireUser();
  if ("error" in auth) return auth.error;
  try {
    const { activeOnly } = (await req.json().catch(() => ({}))) as { activeOnly?: boolean };
    return NextResponse.json(await syncAssets({ activeOnly: Boolean(activeOnly) }));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Discovery failed" },
      { status: 500 },
    );
  }
}
