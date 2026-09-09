import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/auth";
import { syncMeta } from "@/lib/sync/meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Pulls the Meta entity tree and recent delivery into this app's own tables. */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return new NextResponse("Unauthorized", { status: 401 });
  const days = Number(new URL(req.url).searchParams.get("days") ?? 7);
  try {
    return NextResponse.json(await syncMeta(Number.isFinite(days) ? days : 7));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "sync failed" },
      { status: 500 },
    );
  }
}
