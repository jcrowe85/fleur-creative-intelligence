// Reference-library ingest: TrendTrack → our database + storage.
//
// For each durable video ad TrendTrack returns:
//   1. upsert the ReferenceAsset row (all fields + the raw payload),
//   2. mirror the video (and thumbnail) into our Supabase bucket so it stays
//      playable after TrendTrack's signed URL expires,
//   3. classify it against the taxonomy with the same model the app uses,
//   4. upsert the ReferenceAnalysis row.
//
// Idempotent and cheap to re-run: keyed on ttAdId, it refreshes metrics every
// time but only mirrors / classifies work that is missing, unless forced. That
// makes it safe as a scheduled sync and safe to resume after a crash.

import type { Prisma } from "@prisma/client";
import { analyzeCreative } from "@/lib/creative/analyze";
import { db } from "@/lib/db";
import { storageConfigured, uploadToStorage } from "./storage";
import { queryAds, toAssetRow, type AdsQuery, type TrendTrackAd } from "./trendtrack";

const MODEL = "claude-sonnet-4-6";

export interface IngestOptions extends AdsQuery {
  /** Re-mirror even if we already hold a permanent URL. */
  reMirror?: boolean;
  /** Re-classify even if an analysis already exists. */
  reAnalyze?: boolean;
}

export interface AssetResult {
  ttAdId: string;
  brand: string;
  daysRunning: number | null;
  reach: number | null;
  variants: number | null;
  mirrored: boolean;
  analyzed: boolean;
  pillar?: string;
  pillarConf?: number;
  persona?: string;
  hook?: string;
  funnel?: string;
  format?: string;
  error?: string;
}

export interface IngestSummary {
  requested: number;
  returned: number;
  creditsCost: string | null;
  creditsRemaining: string | null;
  results: AssetResult[];
}

async function download(url: string): Promise<{ buf: Buffer; contentType: string } | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const contentType = r.headers.get("content-type") ?? "application/octet-stream";
    const buf = Buffer.from(await r.arrayBuffer());
    // An HTML error page or a streaming manifest is not media.
    if (buf.byteLength < 10_000 || contentType.includes("text") || contentType.includes("mpegurl")) {
      return null;
    }
    return { buf, contentType };
  } catch {
    return null;
  }
}

const extFor = (contentType: string): string =>
  contentType.includes("webm") ? "webm" : contentType.includes("quicktime") ? "mov" : "mp4";

/** Mirror the video (and thumbnail if present) and return our permanent URLs. */
async function mirror(
  ttAdId: string,
  ad: TrendTrackAd,
): Promise<{ mediaUrl: string; thumbUrl: string | null; bytes: number; videoBuf: Buffer }> {
  const src = ad.media?.mediaUrl;
  if (!src) throw new Error("no source media url");
  const dl = await download(src);
  if (!dl) throw new Error("video download failed or not media");

  const mediaUrl = await uploadToStorage(`video/${ttAdId}.${extFor(dl.contentType)}`, dl.buf, dl.contentType);

  let thumbUrl: string | null = null;
  if (ad.media?.thumbnailUrl) {
    const t = await download(ad.media.thumbnailUrl).catch(() => null);
    if (t) thumbUrl = await uploadToStorage(`thumb/${ttAdId}.jpg`, t.buf, t.contentType).catch(() => null as never);
  }
  return { mediaUrl, thumbUrl, bytes: dl.buf.byteLength, videoBuf: dl.buf };
}

export async function ingestReference(opts: IngestOptions = {}): Promise<IngestSummary> {
  if (!storageConfigured()) {
    throw new Error(
      "Supabase storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  const limit = opts.limit ?? 25;
  const { ads, cost, remaining } = await queryAds(opts);
  const results: AssetResult[] = [];

  for (const ad of ads) {
    if (ad.id == null) continue;
    const ttAdId = String(ad.id);
    const row = toAssetRow(ad);
    const brand = row.advertiserName ?? "(unknown)";

    const result: AssetResult = {
      ttAdId,
      brand,
      daysRunning: row.daysRunning,
      reach: row.reach,
      variants: row.variants,
      mirrored: false,
      analyzed: false,
    };

    try {
      // 1. Upsert the row. Metrics always refresh; raw keeps the full payload.
      const asset = await db.referenceAsset.upsert({
        where: { ttAdId },
        create: { ...row, raw: ad as unknown as Prisma.InputJsonValue },
        update: { ...row, raw: ad as unknown as Prisma.InputJsonValue, lastSeen: new Date() },
        include: { analysis: true },
      });

      if (row.mediaType !== "video" || !row.sourceMediaUrl) {
        result.error = "not a downloadable video";
        results.push(result);
        continue;
      }

      // 2. Mirror media (unless we already hold it and aren't forcing).
      let videoBuf: Buffer | null = null;
      if (asset.mediaUrl && !opts.reMirror) {
        result.mirrored = true;
      } else {
        const m = await mirror(ttAdId, ad);
        await db.referenceAsset.update({
          where: { id: asset.id },
          data: { mediaUrl: m.mediaUrl, thumbUrl: m.thumbUrl, mediaBytes: m.bytes, attempts: 0, lastError: null },
        });
        videoBuf = m.videoBuf;
        result.mirrored = true;
      }

      // 3. Classify (unless already done and not forcing).
      if (asset.analysis && !opts.reAnalyze) {
        const a = asset.analysis;
        Object.assign(result, {
          analyzed: true,
          pillar: a.pillar,
          pillarConf: a.pillarConf,
          persona: a.persona,
          hook: a.hook,
          funnel: a.funnel,
          format: a.format,
        });
        results.push(result);
        continue;
      }

      // Reuse the buffer from mirroring; only re-download if we skipped it.
      if (!videoBuf) {
        const dl = await download(row.sourceMediaUrl);
        if (!dl) throw new Error("re-download for analysis failed");
        videoBuf = dl.buf;
      }

      const a = await analyzeCreative({
        videoBuffer: videoBuf,
        adName: brand,
        headline: row.title ?? undefined,
        primaryText: row.body ?? undefined,
        destinationUrl: row.landingPageUrl ?? undefined,
        // TrendTrack ships a transcript — use it and skip Whisper.
        transcript: row.transcript ?? undefined,
      });

      const analysisRow = {
        synopsis: a.synopsis,
        hookText: a.hookText,
        pillar: a.pillar.id,
        pillarConf: a.pillar.confidence,
        pillarReason: a.pillar.reasoning,
        secondaryPillar: a.secondaryPillar?.id ?? null,
        persona: a.persona.id,
        personaConf: a.persona.confidence,
        hook: a.hook.id,
        hookConf: a.hook.confidence,
        funnel: a.funnel.id,
        funnelConf: a.funnel.confidence,
        awareness: a.awareness.id,
        format: a.format.id,
        production: a.production.id,
        placementFit: a.placementFit.id,
        hookStrength: a.scores.hookStrength,
        messageClarity: a.scores.messageClarity,
        differentiation: a.scores.differentiation,
        productionQuality: a.scores.productionQuality,
        placementNativeness: a.scores.placementNativeness,
        complianceFlags: a.complianceFlags,
        critique: a.critique,
        suggestedAdjacent: a.suggestedAdjacent,
        model: MODEL,
      };

      await db.referenceAnalysis.upsert({
        where: { assetId: asset.id },
        create: { assetId: asset.id, ...analysisRow },
        update: { ...analysisRow, analyzedAt: new Date() },
      });

      Object.assign(result, {
        analyzed: true,
        pillar: a.pillar.id,
        pillarConf: a.pillar.confidence,
        persona: a.persona.id,
        hook: a.hook.id,
        funnel: a.funnel.id,
        format: a.format.id,
      });
    } catch (e) {
      result.error = (e as Error).message;
      await db.referenceAsset
        .update({
          where: { ttAdId },
          data: { attempts: { increment: 1 }, lastError: result.error },
        })
        .catch(() => {});
    }

    results.push(result);
  }

  return {
    requested: limit,
    returned: ads.length,
    creditsCost: cost,
    creditsRemaining: remaining,
    results,
  };
}
