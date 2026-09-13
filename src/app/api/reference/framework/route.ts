import { NextResponse } from "next/server";
import { apiRequireCreator } from "@/lib/dal";
import { getOrCreateFramework } from "@/lib/reference/framework";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Generating a framework runs 30-80s depending on the clip, and 90s was close
// enough to the ceiling that slower ones were killed mid-flight and surfaced as
// "couldn't break this into sections" in the app.
export const maxDuration = 300;

/** The creative framework for a saved video (?assetId=). Generated + cached on
 *  first request, so the first open is slower and every open after is instant. */
export async function GET(req: Request) {
  const auth = await apiRequireCreator();
  if ("error" in auth) return auth.error;

  const assetId = new URL(req.url).searchParams.get("assetId");
  if (!assetId) return NextResponse.json({ error: "assetId is required" }, { status: 400 });

  try {
    return NextResponse.json({ framework: await getOrCreateFramework(assetId) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
