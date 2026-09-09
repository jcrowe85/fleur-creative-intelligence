import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/auth";
import { db } from "@/lib/db";
import { RUN_ID, STALE_MS, getRunState, runDetached } from "@/lib/creative/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Backstop for the self-chaining worker. If a link dies — a deploy mid-run, a
 * dropped fetch, a cold-start timeout — the run would otherwise sit at
 * "running" forever. This notices the stale heartbeat and restarts the chain
 * with the existing token, so it resumes exactly where it stopped.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return new NextResponse("Unauthorized", { status: 401 });

  const run = await db.creativeRun.findUnique({ where: { id: RUN_ID } });
  if (!run || run.status !== "running" || !run.token) {
    return NextResponse.json({ revived: false, status: run?.status ?? "idle" });
  }

  const age = run.heartbeatAt ? Date.now() - run.heartbeatAt.getTime() : Infinity;
  if (age <= STALE_MS) {
    return NextResponse.json({ revived: false, reason: "chain is alive", ageMs: age });
  }

  await db.creativeRun.update({ where: { id: RUN_ID }, data: { heartbeatAt: new Date() } });
  runDetached(run.token, new URL(req.url).origin);
  return NextResponse.json({ revived: true, ageMs: age, ...(await getRunState()) });
}
