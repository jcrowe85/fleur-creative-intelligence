import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/auth";
import { db } from "@/lib/db";
import { detectEvents } from "@/lib/creative/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Recompute what changed in the account.
 *
 * Runs daily rather than weekly even though the detector only emits on complete
 * weeks. It is pure computation over MetaInsightDaily — no model calls, no Meta
 * requests — and it is idempotent, so a daily tick simply recomputes the same
 * weeks until a new one closes, and the log updates the morning a week
 * completes instead of whenever a weekly cron happens to land.
 *
 * Scheduled after creative-discover so a day's new creative is already in the
 * library before the events for that week are recomputed.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const log = await db.syncLog.create({ data: { source: "detect-events", status: "running" } });
  try {
    const run = await detectEvents();
    await db.syncLog.update({
      where: { id: log.id },
      data: { status: "done", finishedAt: new Date(), recordsUpserted: run.events },
    });
    return NextResponse.json(run);
  } catch (e) {
    const message = (e as Error).message.slice(0, 500);
    await db.syncLog.update({
      where: { id: log.id },
      data: { status: "error", finishedAt: new Date(), errorMessage: message },
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
