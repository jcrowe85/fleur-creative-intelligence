import { NextResponse } from "next/server";
import { apiRequireUser } from "@/lib/dal";
import { setSaveStatus, type SaveStatus } from "@/lib/reference/saves";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID: SaveStatus[] = ["saved", "dismissed", "filmed"];

/** Record a swipe decision: { assetId, status }. */
export async function POST(req: Request) {
  const auth = await apiRequireUser();
  if ("error" in auth) return auth.error;

  const { assetId, status } = (await req.json().catch(() => ({}))) as {
    assetId?: string;
    status?: SaveStatus;
  };
  if (!assetId || !status || !VALID.includes(status)) {
    return NextResponse.json({ error: "assetId and a valid status are required" }, { status: 400 });
  }

  await setSaveStatus(auth.user.id, assetId, status);
  return NextResponse.json({ ok: true });
}
