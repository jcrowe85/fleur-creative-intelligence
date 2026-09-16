import { NextResponse } from "next/server";
import { apiRequireCreator } from "@/lib/dal";
import { getOrCreateBrief } from "@/lib/reference/brief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Same ceiling as the framework route: generation downloads the video, extracts
// frames and makes one or two model calls, which ran 37-66s in testing.
export const maxDuration = 300;

/**
 * The creator brief for a saved video (?assetId=), in the CreatorBrief format.
 *
 * Deliberately a separate route from /api/reference/framework rather than a
 * replacement. That route still serves the shape the creator app renders today;
 * pointing it here would regenerate every existing asset — changing what
 * creators see and spending a model call each — as a side effect of a deploy.
 * The UI opts in per surface instead.
 */
export async function GET(req: Request) {
  const auth = await apiRequireCreator();
  if ("error" in auth) return auth.error;

  const assetId = new URL(req.url).searchParams.get("assetId");
  if (!assetId) return NextResponse.json({ error: "assetId is required" }, { status: 400 });

  try {
    return NextResponse.json({ brief: await getOrCreateBrief(assetId) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
