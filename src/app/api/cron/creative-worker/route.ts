import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/auth";
import { processSlice } from "@/lib/creative/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Processes one slice of the analysis queue. Not user-facing — authorised by
 * CRON_SECRET so the cron can call it.
 *
 * The work is **awaited inside the request** on purpose. An earlier version
 * detached it and returned 202 immediately, which works on a long-lived Node
 * server and silently does nothing on Vercel: the instance is frozen the moment
 * the response is sent, so the detached promise never runs. The symptom was a
 * run that reported "running" while nothing progressed.
 *
 * The caller here is the cron, which does not hang up early, so awaiting is
 * safe. Each invocation stays inside maxDuration and the cron drives the next.
 */
export async function POST(req: Request) {
  if (!isCronAuthorized(req)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const { token } = (await req.json().catch(() => ({}))) as { token?: string };
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });

  const result = await processSlice(token);
  return NextResponse.json(result);
}
