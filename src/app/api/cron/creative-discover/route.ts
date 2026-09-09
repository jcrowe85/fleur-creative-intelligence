import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/auth";
import { db } from "@/lib/db";
import { syncAssets } from "@/lib/creative/ingest";
import { MAX_ATTEMPTS, getRunState, startRun } from "@/lib/creative/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily: find new creative in the ad account, then put it to work.
 *
 * Both halves matter. Discovery alone would leave new assets sitting
 * unclassified forever, because the analysis cron only acts while a run is
 * `running` and a finished run stays `done`. So this starts a run whenever it
 * finds unclassified work, and the every-minute worker drains it from there.
 *
 * `startRun` returns null if a run is already live, so a long-running queue is
 * never interrupted by the next day's discovery.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return new NextResponse("Unauthorized", { status: 401 });

  const log = await db.syncLog.create({ data: { source: "creative-discover", status: "running" } });
  try {
    const found = await syncAssets();

    // Assets that failed MAX_ATTEMPTS times are excluded: retrying them daily
    // would restart the run forever and never finish.
    const pending = await db.creativeAsset.count({
      where: { analysis: null, attempts: { lt: MAX_ATTEMPTS } },
    });

    let started = false;
    if (pending > 0) {
      started = (await startRun()) !== null;
    }

    await db.syncLog.update({
      where: { id: log.id },
      data: { status: "success", finishedAt: new Date(), recordsUpserted: found.created },
    });

    return NextResponse.json({ ...found, analysisStarted: started, ...(await getRunState()) });
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 500) : "discovery failed";
    await db.syncLog.update({
      where: { id: log.id },
      data: { status: "error", finishedAt: new Date(), errorMessage: message },
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
