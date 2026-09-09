import { NextResponse } from "next/server";
import { apiRequireUser } from "@/lib/dal";
import { campaignCreatives } from "@/lib/creative/campaigns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await apiRequireUser();
  if ("error" in auth) return auth.error;
  const since = new URL(req.url).searchParams.get("since") ?? undefined;
  return NextResponse.json({ campaigns: await campaignCreatives({ since }) });
}
