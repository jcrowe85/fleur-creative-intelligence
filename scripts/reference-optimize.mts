// Backfill: re-optimise already-mirrored videos for smooth streaming.
//
// Videos mirrored before the faststart step have their moov atom at the end (so
// they stall until fully downloaded) and were uploaded without a cache-control
// header (so they never edge cache). This walks existing ReferenceAssets,
// downloads our stored copy, applies faststart (fast, no re-encode), optionally
// downscales oversized outliers to 720p, and re-uploads with cache-control (set
// in storage.ts). Idempotent and resumable.
//
//   npm run reference:optimize                # faststart all, concurrency 4
//   npm run reference:optimize -- 6           # concurrency 6
//   npm run reference:optimize -- 4 20        # also 720p-downscale files > 20 MB
//
// Best run when the bulk ingest isn't also going (shares CPU + storage).

import { db } from "../src/lib/db";
import { storageConfigured, uploadToStorage } from "../src/lib/reference/storage";
import { downscale720p, faststartRemux } from "../src/lib/reference/transcode";

const DONE = "opt-done"; // marker written to lastError once a video has been optimized
const concurrency = Math.max(1, Math.min(8, Number(process.argv[2] ?? 4)));
// Files larger than this get a full 720p re-encode; everything gets faststart.
const downscaleAboveMB = process.argv[3] ? Number(process.argv[3]) : Infinity;

async function pool<T>(items: T[], n: number, fn: (t: T, i: number) => Promise<void>) {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

async function main() {
  if (!storageConfigured()) throw new Error("Supabase storage not configured");

  // When a downscale threshold is given, only touch the files that actually need
  // it (bytes above the threshold), largest first — so the worst stall offenders
  // clear soonest. Videos at/below the threshold were already faststarted at
  // ingest, so there's nothing to do for them. With no threshold, faststart all.
  const targets = await db.referenceAsset.findMany({
    where: {
      mediaUrl: { not: null },
      // Skip ones already downscaled in a prior pass (marked below), so re-runs only
      // retry stragglers/failures and never re-encode a finished (long) video. Note:
      // `{ not: DONE }` alone drops NULL lastError in SQL, so include NULL explicitly.
      OR: [{ lastError: null }, { lastError: { not: DONE } }],
      ...(Number.isFinite(downscaleAboveMB) ? { mediaBytes: { gt: Math.round(downscaleAboveMB * 1e6) } } : {}),
    },
    orderBy: { mediaBytes: "desc" },
    select: { id: true, ttAdId: true, mediaUrl: true, mediaBytes: true, advertiserName: true },
  });
  console.log(
    `Optimising ${targets.length} videos — faststart all` +
      (Number.isFinite(downscaleAboveMB) ? `, 720p-downscale > ${downscaleAboveMB}MB` : "") +
      `, concurrency ${concurrency}\n`,
  );

  let done = 0;
  let savedBytes = 0;
  let failed = 0;

  const skipped = 0; // re-runs skip naturally: shrunk files drop below the query threshold
  await pool(targets, concurrency, async (a) => {
    try {
      // Retry the download — under high concurrency Supabase occasionally drops a
      // connection ("fetch failed"); a couple of backed-off retries recover it.
      let before: Buffer | null = null;
      for (let attempt = 0; ; attempt++) {
        try {
          const r = await fetch(a.mediaUrl!);
          if (!r.ok) throw new Error(`fetch ${r.status}`);
          before = Buffer.from(await r.arrayBuffer());
          break;
        } catch (e) {
          if (attempt >= 6) throw e;
          await new Promise((res) => setTimeout(res, 800 * (attempt + 1))); // up to ~5s backoff
        }
      }
      const heavy = before.byteLength / 1e6 > downscaleAboveMB;
      const after = heavy ? await downscale720p(before) : await faststartRemux(before);
      // Re-upload to the same path; storage.ts stamps the cache-control header.
      await uploadToStorage(`video/${a.ttAdId}.mp4`, after, "video/mp4");
      await db.referenceAsset.update({ where: { id: a.id }, data: { mediaBytes: after.byteLength, lastError: DONE } });
      savedBytes += before.byteLength - after.byteLength;
      done += 1;
      if (done % 20 === 0)
        console.log(`  [${done}/${targets.length}] ${a.advertiserName ?? ""}  ${(before.byteLength / 1e6).toFixed(1)}→${(after.byteLength / 1e6).toFixed(1)}MB`);
    } catch (e) {
      failed += 1;
      console.log(`  FAIL ${a.advertiserName ?? a.ttAdId}: ${(e as Error).message}`);
    }
  });

  console.log(`\nDone: optimised ${done}, skipped ${skipped} (already good), failed ${failed}. Reclaimed ~${(savedBytes / 1e9).toFixed(2)}GB.`);
  return failed;
}

main()
  // Exit non-zero if anything failed so the wrapper loop re-runs and retries the
  // stragglers (finished videos are marked, so a re-run is cheap). Clean pass = 0.
  .then((failed) => process.exit(failed > 0 ? 1 : 0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
