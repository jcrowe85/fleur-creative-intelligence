import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/auth";
import { db } from "@/lib/db";
import { RUN_ID, getRunState, processSlice } from "@/lib/creative/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Drives the analysis queue.
 *
 * Serverless cannot hold a background loop — an instance is frozen as soon as it
 * responds — so the cron is the engine rather than a safety net. Each run works
 * a slice inside its own invocation and returns; the next tick continues.
 *
 * A heartbeat lock keeps slices from overlapping: with a minute-by-minute
 * schedule and slices that last minutes, several invocations would otherwise
 * work the same queue and analyse the same asset twice.
 */
const LOCK_MS = 90_000;

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return new NextResponse("Unauthorized", { status: 401 });

  const run = await db.creativeRun.findUnique({ where: { id: RUN_ID } });
  if (!run || run.status !== "running" || !run.token) {
    return NextResponse.json({ worked: false, status: run?.status ?? "idle" });
  }

  const age = run.heartbeatAt ? Date.now() - run.heartbeatAt.getTime() : Infinity;
  if (age < LOCK_MS) {
    return NextResponse.json({ worked: false, reason: "another slice is active", ageMs: age });
  }

  // Claim the slice before doing any work, so a concurrent tick sees a fresh
  // heartbeat and stands down.
  await db.creativeRun.update({ where: { id: RUN_ID }, data: { heartbeatAt: new Date() } });
  const result = await processSlice(run.token);
  return NextResponse.json({ worked: true, ...result, ...(await getRunState()) });
}
