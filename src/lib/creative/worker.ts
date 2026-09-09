// Server-driven analysis worker.
//
// The run state lives in Postgres, not in a browser tab, so refreshing the
// page, closing it, or sleeping the laptop no longer kills the job. The client
// only starts, stops and polls.
//
// Serverless functions cannot run for hours, so one invocation processes assets
// until it approaches its time budget, then hands off by calling the same
// endpoint again without awaiting it. Each link in the chain is a fresh
// invocation well inside the limit, and the chain continues until the queue
// drains or someone stops it. A cron sweep restarts the chain if a link dies.

import { db } from "@/lib/db";
import { analyzeCreative } from "./analyze";
import { downloadAsset, videoSourceUrl } from "./ingest";

export const RUN_ID = "singleton";
export const MODEL = "claude-sonnet-4-6";
/** Give up on an asset after this many failures so the queue can drain. */
export const MAX_ATTEMPTS = 3;
/** Hand off before the 300s function ceiling, leaving room for one more asset
 *  plus the handoff call itself. */
const TIME_BUDGET_MS = 210_000;
/** A run whose heartbeat is older than this is treated as crashed. */
export const STALE_MS = 10 * 60_000;

export interface RunState {
  status: string;
  processed: number;
  failed: number;
  analyzed: number;
  pending: number;
  abandoned: number;
  total: number;
  startedAt: Date | null;
  heartbeatAt: Date | null;
  lastError: string | null;
  stale: boolean;
}

export async function getRunState(): Promise<RunState> {
  const [run, analyzed, pending, abandoned, total] = await Promise.all([
    db.creativeRun.findUnique({ where: { id: RUN_ID } }),
    db.creativeAnalysis.count(),
    db.creativeAsset.count({ where: { analysis: null, attempts: { lt: MAX_ATTEMPTS } } }),
    db.creativeAsset.count({ where: { analysis: null, attempts: { gte: MAX_ATTEMPTS } } }),
    db.creativeAsset.count(),
  ]);
  const heartbeatAt = run?.heartbeatAt ?? null;
  const stale =
    run?.status === "running" &&
    heartbeatAt !== null &&
    Date.now() - heartbeatAt.getTime() > STALE_MS;
  return {
    status: run?.status ?? "idle",
    processed: run?.processed ?? 0,
    failed: run?.failed ?? 0,
    analyzed,
    pending,
    abandoned,
    total,
    startedAt: run?.startedAt ?? null,
    heartbeatAt,
    lastError: run?.lastError ?? null,
    stale,
  };
}

/** Starts a run and returns the chain token, or null if one is already live. */
export async function startRun(force = false): Promise<string | null> {
  const existing = await db.creativeRun.findUnique({ where: { id: RUN_ID } });
  const live =
    existing?.status === "running" &&
    existing.heartbeatAt !== null &&
    Date.now() - existing.heartbeatAt.getTime() <= STALE_MS;
  if (live && !force) return null;

  const token = crypto.randomUUID();
  await db.creativeRun.upsert({
    where: { id: RUN_ID },
    create: {
      id: RUN_ID, status: "running", startedAt: new Date(), heartbeatAt: new Date(),
      processed: 0, failed: 0, lastError: null, token,
    },
    update: {
      status: "running", startedAt: new Date(), heartbeatAt: new Date(),
      finishedAt: null, processed: 0, failed: 0, lastError: null, token,
    },
  });
  return token;
}

export async function stopRun(): Promise<void> {
  await db.creativeRun.upsert({
    where: { id: RUN_ID },
    create: { id: RUN_ID, status: "stopped", finishedAt: new Date() },
    update: { status: "stopped", finishedAt: new Date(), token: null },
  });
}

/** One asset, start to finish. Throws so the caller can record the failure. */
async function analyzeOne(asset: {
  id: string; assetKey: string; assetType: string; name: string;
  thumbUrl: string | null; headline: string | null;
  primaryText: string | null; destinationUrl: string | null;
}) {
  let videoBuffer: Buffer | undefined;
  let imageBuffer: Buffer | undefined;

  if (asset.assetType === "video") {
    const src = await videoSourceUrl(asset.assetKey.replace(/^v:/, ""));
    if (src) videoBuffer = await downloadAsset(src);
    else if (asset.thumbUrl) imageBuffer = await downloadAsset(asset.thumbUrl);
    else throw new Error("No downloadable source or thumbnail for this video");
  } else if (asset.thumbUrl) {
    imageBuffer = await downloadAsset(asset.thumbUrl);
  } else {
    throw new Error("No image URL for this asset");
  }

  const a = await analyzeCreative({
    videoBuffer, imageBuffer,
    adName: asset.name,
    headline: asset.headline ?? undefined,
    primaryText: asset.primaryText ?? undefined,
    destinationUrl: asset.destinationUrl ?? undefined,
  });

  const row = {
    transcript: a.transcript, synopsis: a.synopsis, hookText: a.hookText,
    pillar: a.pillar.id, pillarConf: a.pillar.confidence, pillarReason: a.pillar.reasoning,
    secondaryPillar: a.secondaryPillar?.id ?? null,
    persona: a.persona.id, personaConf: a.persona.confidence,
    hook: a.hook.id, hookConf: a.hook.confidence,
    funnel: a.funnel.id, funnelConf: a.funnel.confidence,
    awareness: a.awareness.id, format: a.format.id,
    production: a.production.id, placementFit: a.placementFit.id,
    hookStrength: a.scores.hookStrength, messageClarity: a.scores.messageClarity,
    differentiation: a.scores.differentiation,
    productionQuality: a.scores.productionQuality,
    placementNativeness: a.scores.placementNativeness,
    complianceFlags: a.complianceFlags, critique: a.critique,
    suggestedAdjacent: a.suggestedAdjacent, model: MODEL,
  };

  await db.creativeAnalysis.upsert({
    where: { assetId: asset.id },
    create: { assetId: asset.id, ...row },
    update: { ...row, analyzedAt: new Date(), reviewedBy: null, reviewedAt: null },
  });
  await db.creativeAsset.update({
    where: { id: asset.id },
    data: { attempts: 0, lastError: null },
  });
}

export interface SliceResult {
  done: number;
  failed: number;
  remaining: number;
  /** True when the queue is empty or the run was stopped — no handoff needed. */
  finished: boolean;
}

/**
 * Processes assets until the time budget runs out, the queue empties, or the
 * run is stopped. Returns whether the chain should continue.
 */
export async function processSlice(token: string): Promise<SliceResult> {
  const deadline = Date.now() + TIME_BUDGET_MS;
  let done = 0;
  let failed = 0;

  for (;;) {
    const run = await db.creativeRun.findUnique({ where: { id: RUN_ID } });
    // Someone stopped it, or a newer chain took over — stand down.
    if (!run || run.status !== "running" || run.token !== token) {
      return { done, failed, remaining: await pendingCount(), finished: true };
    }
    if (Date.now() > deadline) {
      return { done, failed, remaining: await pendingCount(), finished: false };
    }

    const asset = await db.creativeAsset.findFirst({
      where: { analysis: null, attempts: { lt: MAX_ATTEMPTS } },
      orderBy: { firstSeen: "asc" },
    });

    if (!asset) {
      await db.creativeRun.update({
        where: { id: RUN_ID },
        data: { status: "done", finishedAt: new Date(), heartbeatAt: new Date(), token: null },
      });
      return { done, failed, remaining: 0, finished: true };
    }

    try {
      await analyzeOne(asset);
      done++;
      await db.creativeRun.update({
        where: { id: RUN_ID },
        data: { processed: { increment: 1 }, heartbeatAt: new Date() },
      });
    } catch (e) {
      failed++;
      const message = e instanceof Error ? e.message.slice(0, 500) : "Analysis failed";
      await db.creativeAsset.update({
        where: { id: asset.id },
        data: { attempts: { increment: 1 }, lastError: message },
      });
      await db.creativeRun.update({
        where: { id: RUN_ID },
        data: { failed: { increment: 1 }, lastError: message, heartbeatAt: new Date() },
      });
    }
  }
}

function pendingCount() {
  return db.creativeAsset.count({
    where: { analysis: null, attempts: { lt: MAX_ATTEMPTS } },
  });
}

/**
 * Kicks a slice off **detached** from any HTTP request.
 *
 * This matters more than it looks. Next aborts a route handler as soon as the
 * client disconnects, so work awaited inside the handler dies the moment the
 * caller hangs up — which is exactly what happens when a browser tab is closed
 * or a chain link times out. Holding the promise at module scope instead keeps
 * it alive independently of the request that started it, and the route can
 * answer immediately.
 *
 * The reference is retained so the promise is not garbage collected, and the
 * cron sweep revives the chain if the process is recycled mid-slice.
 */
const inFlight = new Set<Promise<unknown>>();

export function runDetached(token: string, origin: string): void {
  const p: Promise<unknown> = (async () => {
    try {
      const result = await processSlice(token);
      if (!result.finished) {
        // Continue the chain in this same process rather than over HTTP: one
        // less thing that can be severed. The cron sweep still covers a crash.
        runDetached(token, origin);
      }
    } catch (e) {
      await db.creativeRun
        .update({
          where: { id: RUN_ID },
          data: {
            status: "error",
            lastError: e instanceof Error ? e.message.slice(0, 500) : "Worker crashed",
            finishedAt: new Date(),
          },
        })
        .catch(() => {});
    }
  })();
  inFlight.add(p);
  // Cleared here rather than in a `finally` so the binding is definitely
  // assigned before anything references it.
  void p.finally(() => inFlight.delete(p));
}

/** True when this process is already working the run — used to avoid two
 *  chains after a cron sweep lands on a healthy instance. */
export function isWorkingLocally(): boolean {
  return inFlight.size > 0;
}
