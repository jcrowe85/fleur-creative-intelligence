import { NextResponse } from "next/server";
import { apiRequireUser } from "@/lib/dal";
import { getRunState, processSlice, startRun, stopRun } from "@/lib/creative/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Progress. Safe to poll; the client uses this instead of driving the loop. */
export async function GET() {
  const auth = await apiRequireUser();
  if ("error" in auth) return auth.error;
  return NextResponse.json(await getRunState());
}

/**
 * `action: "start"` kicks off a server-side run and returns immediately — the
 * work continues regardless of what the browser does next. `"stop"` halts it
 * after the asset in flight. `force` restarts a run whose heartbeat went stale.
 */
export async function POST(req: Request) {
  const auth = await apiRequireUser();
  if ("error" in auth) return auth.error;

  const { action = "start", force } = (await req.json().catch(() => ({}))) as {
    action?: "start" | "stop";
    force?: boolean;
  };

  if (action === "stop") {
    await stopRun();
    return NextResponse.json(await getRunState());
  }

  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { error: "CRON_SECRET must be set — the worker chain authenticates with it." },
      { status: 500 },
    );
  }

  const token = await startRun(Boolean(force));
  if (!token) {
    return NextResponse.json(
      { error: "A run is already in progress.", ...(await getRunState()) },
      { status: 409 },
    );
  }

  // Work one slice inline so the user sees movement straight away; the cron
  // picks it up from there. Not awaited to completion of the whole queue —
  // processSlice returns at its own time budget.
  await processSlice(token);
  return NextResponse.json(await getRunState());
}
