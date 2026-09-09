import { NextResponse } from "next/server";
import { apiRequireUser } from "@/lib/dal";
import { buildPortfolio } from "@/lib/creative/portfolio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await apiRequireUser();
  if ("error" in auth) return auth.error;
  const since = new URL(req.url).searchParams.get("since") ?? undefined; // YYYY-MM-DD
  return NextResponse.json(await buildPortfolio(since));
}
