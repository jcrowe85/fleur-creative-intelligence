import { NextResponse, after } from "next/server";
import { apiRequireCreator } from "@/lib/dal";
import { setSaveStatus, type SaveStatus } from "@/lib/reference/saves";
import { getOrCreateFramework } from "@/lib/reference/framework";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90; // room for the post-response framework pre-generate

const VALID: SaveStatus[] = ["saved", "dismissed", "filmed"];

/** Record a swipe decision: { assetId, status }. */
export async function POST(req: Request) {
  const auth = await apiRequireCreator();
  if ("error" in auth) return auth.error;

  const { assetId, status } = (await req.json().catch(() => ({}))) as {
    assetId?: string;
    status?: SaveStatus;
  };
  if (!assetId || !status || !VALID.includes(status)) {
    return NextResponse.json({ error: "assetId and a valid status are required" }, { status: 400 });
  }

  await setSaveStatus(auth.user.id, assetId, status);

  // On a save (swipe-right), warm the creative framework in the background so
  // it's ready the instant the creator opens their shot list. Runs after the
  // response, and getOrCreateFramework is cached so it's a no-op if already done.
  if (status === "saved") {
    after(() => getOrCreateFramework(assetId).catch(() => {}));
  }

  return NextResponse.json({ ok: true });
}
