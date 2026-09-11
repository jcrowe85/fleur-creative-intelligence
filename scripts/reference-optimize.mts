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

  const targets = await db.referenceAsset.findMany({
    where: { mediaUrl: { not: null } },
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

  let skipped = 0;
  await pool(targets, concurrency, async (a) => {
    try {
      // Skip work already done: a HEAD shows if it's cached (backfilled) and its
      // size. Cached + within the downscale threshold → nothing to do. Keeps
      // re-runs cheap and avoids hammering storage into 429s.
      const head = await fetch(a.mediaUrl!, { method: "HEAD" });
      const cached = (head.headers.get("cache-control") ?? "").includes("max-age=31536000");
      const sizeMB = Number(head.headers.get("content-length") ?? a.mediaBytes ?? 0) / 1e6;
      if (cached && sizeMB <= downscaleAboveMB) {
        skipped += 1;
        return;
      }

      const r = await fetch(a.mediaUrl!);
      if (!r.ok) throw new Error(`fetch ${r.status}`);
      const before = Buffer.from(await r.arrayBuffer());
      const heavy = before.byteLength / 1e6 > downscaleAboveMB;
      const after = heavy ? await downscale720p(before) : await faststartRemux(before);
      // Re-upload to the same path; storage.ts stamps the cache-control header.
      await uploadToStorage(`video/${a.ttAdId}.mp4`, after, "video/mp4");
      await db.referenceAsset.update({ where: { id: a.id }, data: { mediaBytes: after.byteLength } });
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
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
