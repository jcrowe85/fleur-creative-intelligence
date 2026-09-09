import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/auth";
import { isWorkingLocally, runDetached } from "@/lib/creative/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Starts (or revives) the analysis chain. Not user-facing — authorised by
 * CRON_SECRET so the control endpoint and the cron sweep can call it.
 *
 * Returns immediately. The work runs detached from this request, because Next
 * kills a handler the moment its client disconnects and the whole point here is
 * to survive that.
 */
export async function POST(req: Request) {
  if (!isCronAuthorized(req)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const { token } = (await req.json().catch(() => ({}))) as { token?: string };
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });

  if (isWorkingLocally()) {
    return NextResponse.json({ accepted: false, reason: "already working in this process" });
  }
  runDetached(token, new URL(req.url).origin);
  return NextResponse.json({ accepted: true }, { status: 202 });
}
